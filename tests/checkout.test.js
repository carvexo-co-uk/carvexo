import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import Stripe from 'stripe';
import { registrationFrom } from '../shared/catalog.js';
import { makeApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { gatewayState, makePayPal } from '../server/gateways.js';
import { drainNotifications } from '../server/mail.js';
import { hashPassword } from '../server/admin-auth.js';
import { openOrders } from '../server/store.js';

function buyer(registration = 'ab12  cde', packageKey = 'full') {
  return {
    credentials: 'Bearer ' + randomBytes(32).toString('hex'),
    input: { registration, packageKey, email: 'buyer@example.test', attemptId: randomUUID(), amount: 1 },
  };
}

async function harness(context, env = {}, stripe, paypal) {
  const directory = await mkdtemp(join(tmpdir(), 'carvexo-checkout-'));
  const config = loadConfig({ CARVEXO_DATA_DIR: directory, ...env });
  const store = await openOrders(config);
  const server = makeApp({ config, store, stripe, paypal }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function request(path, { input, credentials, method = 'GET', stripeSignature, cookie, admin, headers } = {}) {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
      method,
      headers: {
        ...(input ? { 'Content-Type': 'application/json' } : {}),
        ...(credentials ? { Authorization: credentials } : {}),
        ...(stripeSignature ? { 'Stripe-Signature': stripeSignature } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(admin ? { 'X-Carvexo-Admin': '1' } : {}),
        ...headers,
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], ...(await res.json().catch(() => ({}))) };
  }
  return { config, store, request, directory };
}

test('registration normalisation accepts private and older formats', () => {
  assert.deepEqual(registrationFrom(' ab12  cde '), { key: 'AB12CDE', display: 'AB12 CDE' });
  assert.equal(registrationFrom('K1 NG').key, 'K1NG');
  assert.equal(registrationFrom('A123 ABC').key, 'A123ABC');
  assert.equal(registrationFrom('123 ABC').key, '123ABC');
  assert.equal(registrationFrom('ABZ 1234').key, 'ABZ1234');
  assert.equal(registrationFrom('1234567A'), null);
  assert.equal(registrationFrom('plate'), null);
  assert.equal(registrationFrom('A1*BCD'), null);
});

async function demoSequence(context, env = {}) {
  const { request, store, config, directory } = await harness(context, env);
  const customer = buyer();
  const post = { method: 'POST', ...customer };
  const invalid = await request('/orders', { ...post, input: { ...customer.input, email: 'bad' } });
  assert.equal(invalid.status, 400);
  const responses = await Promise.all([request('/orders', post), request('/orders', post)]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].order.ref, responses[1].order.ref);
  const { ref, registration, amount } = responses[0].order;
  assert.equal(registration, 'AB12 CDE');
  assert.equal(amount, 3000);
  assert.equal((await request('/orders/' + ref)).status, 401);
  assert.equal((await request('/orders/' + ref, { credentials: buyer().credentials })).status, 404);
  assert.equal((await request('/orders', { ...post, input: { ...customer.input, packageKey: 'basic' } })).status, 409);

  const basic = await request('/orders', { method: 'POST', ...buyer('K1 NG', 'basic') });
  assert.equal(basic.order.amount, 2000);
  assert.equal(basic.order.status, 'pending');

  await Promise.all([drainNotifications(store, config), drainNotifications(store, config)]);
  const files = (await readdir(join(directory, 'mail'))).sort();
  assert.deepEqual(files, [ref, basic.order.ref].flatMap(orderRef =>
    ['demo-customer', 'demo-owner', 'pending-owner'].map(key => orderRef + '-' + key + '.json')).sort());
  const customerEmail = JSON.parse(await readFile(join(directory, 'mail', ref + '-demo-customer.json')));
  const ownerEmail = JSON.parse(await readFile(join(directory, 'mail', ref + '-demo-owner.json')));
  assert.equal(customerEmail.to[0], 'buyer@example.test');
  assert.equal(customerEmail.reply_to, 'carvexo.co.uk@gmail.com');
  assert.equal(ownerEmail.to[0], 'carvexo.co.uk@gmail.com');
  assert.equal(customerEmail.subject, 'Your CARVEXO order is confirmed');
  assert.match(customerEmail.text, /Cash on Delivery \(demo\)/);
  assert.match(customerEmail.text, /Finance check/);
  assert.match(ownerEmail.text, /Payment status: Pending/);
  assert.equal((await store.get(ref)).notifications.every(notice => notice.state === 'captured' && notice.attempts === 1), true);
  assert.equal((await request('/orders/' + ref + '/demo-payment', { method: 'POST', credentials: customer.credentials })).status, 404);

  if (!config.mongoUri) {
    const reopened = await openOrders(config);
    assert.equal((await reopened.get(ref)).fulfilment, 'awaiting_payment');
    assert.equal((await reopened.get(basic.order.ref)).status, 'pending');
  }
}

test('demo checkout preserves orders, both prices, statuses and distinct notifications', (context) => demoSequence(context));
test('MongoDB handles the same checkout lifecycle', { skip: !process.env.CARVEXO_TEST_MONGODB_URI }, (context) =>
  demoSequence(context, { MONGODB_URI: process.env.CARVEXO_TEST_MONGODB_URI }));

test('signed Stripe test event changes the order once and late failures cannot regress it', async (context) => {
  const secret = 'whsec_carvexo_fixture';
  const client = new Stripe('sk_test_carvexo_fixture');
  const fixture = { id: 'cs_carvexo_fixture', status: 'open', url: 'https://checkout.stripe.com/demo' };
  const stripe = { webhooks: client.webhooks, checkout: { sessions: {
    create: async () => fixture, retrieve: async () => fixture,
  } } };
  const { request, store, config, directory } = await harness(context, {
    CARVEXO_PAYMENT_MODE: 'stripe-test', STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', STRIPE_WEBHOOK_SECRET: secret,
    CARVEXO_PUBLIC_ORIGIN: 'https://carvexo.example.test',
  }, stripe);
  const customer = buyer('AB12 CDE', 'basic');
  const placed = await request('/orders', { ...customer, method: 'POST' });
  const { ref } = placed.order;
  const started = await request('/orders/' + ref + '/payment', {
    method: 'POST', input: {}, credentials: customer.credentials,
  });
  assert.equal(started.url, fixture.url);
  assert.equal((await store.get(ref)).status, 'pending');
  function event(type, changes = {}, signed = true) {
    const input = { id: 'evt_fixture', type, livemode: false, data: { object: {
      ...fixture, status: 'complete', payment_status: 'paid', amount_total: 2000, currency: 'gbp',
      client_reference_id: ref, ...changes,
    } } };
    const stripeSignature = signed ? client.webhooks.generateTestHeaderString({
      payload: JSON.stringify(input), secret,
    }) : 'invalid-test-signature';
    return request('/webhooks/stripe', { method: 'POST', input, stripeSignature });
  }
  assert.equal((await event('checkout.session.completed', {}, false)).status, 400);
  await event('checkout.session.completed', { amount_total: 1999 });
  await event('checkout.session.completed', { currency: 'usd' });
  await event('checkout.session.completed', { id: 'cs_other_fixture' });
  assert.equal((await store.get(ref)).status, 'pending');
  await event('checkout.session.completed', { payment_status: 'unpaid' });
  assert.equal((await store.get(ref)).status, 'processing');
  await Promise.all([event('checkout.session.completed'), event('checkout.session.completed')]);
  await event('checkout.session.expired', { status: 'expired' });
  const paid = await store.get(ref);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.fulfilment, 'sandbox_payment');
  assert.equal(paid.notifications.length, 3);
  await drainNotifications(store, config);
  assert.equal((await readdir(join(directory, 'mail'))).length, 3);
});

test('live payment refuses to start without approved launch data', () => {
  assert.throws(() => loadConfig({
    CARVEXO_PAYMENT_MODE: 'stripe-live', STRIPE_SECRET_KEY: 'sk_live_fixture',
    STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  }), /Live checkout requires/);
});

async function owner(context, env, stripe, paypal) {
  const password = 'carvexo testing fixture';
  const email = 'owner@example.test';
  const { request, ...rest } = await harness(context, {
    CARVEXO_ADMIN_EMAIL: email, CARVEXO_ADMIN_PASSWORD_HASH: await hashPassword(password),
    CARVEXO_ADMIN_SESSION_SECRET: randomBytes(32).toString('hex'), ...env,
  }, stripe, paypal);
  assert.equal((await request('/admin/settings')).status, 401);
  assert.equal((await request('/admin/login', { method: 'POST', input: { email, password } })).status, 403);
  const session = await request('/admin/login', { method: 'POST', input: { email, password }, admin: true });
  assert.equal(session.status, 200);
  const admin = (path, options) => request('/admin' + path, { ...options, admin: true, cookie: session.cookie });
  return { request, admin, ...rest };
}

test('admin edits publish, order snapshots survive edits, and parallel saves detect conflicts', async context => {
  const { request, store, admin } = await owner(context);
  const customer = buyer('AB12 CDE', 'basic');
  const post = { method: 'POST', ...customer };
  const old = (await request('/orders', post)).order;
  const { settings } = await admin('/settings');
  settings.packages[0].title = 'Basic revised';
  settings.packages[0].amount = 2125;
  settings.packages[0].features = ['Mileage only'];
  settings.content.home.heading = 'The edited homepage';
  settings.content.info.about.body = ['An editable About page.'];
  settings.content.seo['/about'].title = 'Edited SEO title';
  settings.content.phone = '+44 20 1234 5678';
  settings.content.socials = [{ name: 'Instagram', url: 'https://www.instagram.com/carvexo/' }];
  const saves = await Promise.all([admin('/settings', { method: 'PUT', input: settings }),
    admin('/settings', { method: 'PUT', input: settings })]);
  assert.deepEqual(saves.map(result => result.status).sort(), [200, 409]);
  assert.equal((await request('/catalog')).content.seo['/about'].title, 'Edited SEO title');
  assert.equal((await request('/catalog')).content.home.heading, 'The edited homepage');
  assert.equal((await request('/orders', post)).order.amount, 2000);
  assert.deepEqual((await store.get(old.ref)).packageFeatures, ['Ads history', 'Mileage', 'Plate changes', 'Owner history', 'Value']);
  const newer = (await request('/orders', { method: 'POST', ...buyer('BT14 TES', 'basic') })).order;
  assert.equal(newer.amount, 2125);
  assert.equal(newer.packageTitle, 'Basic revised');
  assert.equal((await admin('/orders?q=AB12CDE')).orders[0].ref, old.ref);
  assert.equal((await admin('/orders?q=%5B')).orders.length, 0);
  assert.equal((await admin('/orders/' + old.ref + '/sent', { method: 'POST' })).status, 409);
});

test('localhost PayPal Sandbox captures on browser return without a webhook', async context => {
  const credentials = { PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture' };
  const origin = 'http://localhost:5173';
  for (const config of [
    { CARVEXO_PUBLIC_ORIGIN: 'https://carvexo.example.test' },
    { CARVEXO_PUBLIC_ORIGIN: origin, PAYPAL_ENVIRONMENT: 'live' },
    { CARVEXO_PUBLIC_ORIGIN: origin, NODE_ENV: 'production' },
  ]) {
    assert.equal(gatewayState(loadConfig({ ...credentials, ...config })).paypal.configured, false);
  }

  let payment;
  let checks = 0;
  let captures = 0;
  const paypal = {
    async checkCredentials() { checks++; },
    async create(order, urls) {
      assert.equal(urls.success, origin + '/confirmation');
      payment = {
        id: 'LOCALPAYPAL123', status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkout' }],
        purchase_units: [{ reference_id: order.ref, custom_id: order.ref,
          amount: { currency_code: 'GBP', value: '20.00' } }],
      };
      return payment;
    },
    async get() { return payment; },
    async capture() {
      captures++;
      payment.status = 'COMPLETED';
      payment.purchase_units[0].payments = { captures: [{
        id: 'LOCALCAPTURE123', status: 'COMPLETED', amount: { currency_code: 'GBP', value: '20.00' },
      }] };
    },
  };
  const { request, admin } = await owner(context, { ...credentials, CARVEXO_PUBLIC_ORIGIN: origin }, undefined, paypal);
  const check = await admin('/payments/paypal/check', { method: 'POST' });
  assert.equal(check.status, 200);
  assert.equal(check.webhookVerified, false);
  const { settings } = await admin('/settings');
  settings.payment.provider = 'paypal';
  assert.equal((await admin('/settings', { method: 'PUT', input: settings })).status, 200);
  assert.equal(checks, 2);
  const { input, credentials: buyerToken } = buyer('AB12 CDE', 'basic');
  const { order } = await request('/orders', { method: 'POST', input, credentials: buyerToken });
  const via = (path) => request('/orders/' + order.ref + path, { method: 'POST', credentials: buyerToken, input: {} });
  assert.equal((await via('/payment')).url, 'https://www.sandbox.paypal.com/checkout');
  assert.equal((await via('/return')).order.status, 'pending');
  payment.status = 'APPROVED';
  const complete = await via('/return');
  assert.equal(complete.order.status, 'paid');
  assert.equal(complete.order.fulfilment, 'sandbox_payment');
  await via('/return');
  assert.equal(captures, 1);
  assert.equal((await request('/webhooks/paypal', { method: 'POST', input: {} })).status, 404);
});

test('PayPal checks the configured recipient before returning a checkout order', async () => {
  const config = loadConfig({
    PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture',
    PAYPAL_BRAND_NAME: 'Apex Design', PAYPAL_MERCHANT_ID: 'EXPECTED12345',
  });
  let payee = 'WRONG12345678';
  const paypal = makePayPal(config, async (url, request) => {
    const path = new URL(url).pathname;
    if (path === '/v1/oauth2/token') return Response.json({ access_token: 'fixture', expires_in: 300 });
    if (path === '/v2/checkout/orders') {
      const input = JSON.parse(request.body);
      assert.equal(input.payment_source.paypal.experience_context.brand_name, 'Apex Design');
      assert.deepEqual(input.purchase_units[0].amount, { currency_code: 'GBP', value: '20.00' });
      assert.equal(input.purchase_units[0].payee, undefined);
      return Response.json({ id: 'PAYPALORD123' });
    }
    assert.equal(path, '/v2/checkout/orders/PAYPALORD123');
    return Response.json({ id: 'PAYPALORD123', purchase_units: [{ payee: { merchant_id: payee } }] });
  });
  const create = () => paypal.create({ ref: 'CVX-123', packageTitle: 'Basic', amount: 2000 }, {
    success: 'https://carvexo.example.test/confirmation', cancel: 'https://carvexo.example.test/confirmation?cancelled=1',
  });
  await assert.rejects(create, /different or unverified merchant/);
  payee = 'EXPECTED12345';
  assert.equal((await create()).id, 'PAYPALORD123');
  payee = 'WRONG12345678';
  await assert.rejects(paypal.get('PAYPALORD123'), /different or unverified merchant/);
});

test('PayPal sandbox checkout verifies the captured amount, reuses the provider order and handles cancellation', async context => {
  const id = 'PAYPALORD123';
  let payment;
  let creates = 0;
  let captures = 0;
  const paypal = {
    async webhook() { return { url: 'https://carvexo.example.test/api/webhooks/paypal', event_types: [{ name: '*' }] }; },
    async verify(req) { return req.get('paypal-transmission-id') === 'verified-fixture'; },
    async create(order) {
      creates++;
      payment = { id, status: 'PAYER_ACTION_REQUIRED', purchase_units: [{
        reference_id: order.ref, custom_id: order.ref, amount: { currency_code: 'GBP', value: '20.00' },
      }], links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkout' }] };
      return payment;
    },
    async get() { return payment; },
    async capture() {
      captures++;
      payment.status = 'COMPLETED';
      payment.purchase_units[0].payments = { captures: [{
        id: 'CAPTURE12345', status: 'COMPLETED', amount: { currency_code: 'GBP', value: '19.99' },
      }] };
      return payment;
    },
  };
  const { request, admin, store } = await owner(context, { CARVEXO_PUBLIC_ORIGIN: 'https://carvexo.example.test',
    PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture', PAYPAL_WEBHOOK_ID: 'fixture',
  }, undefined, paypal);
  const { settings } = await admin('/settings');
  settings.payment.provider = 'paypal';
  assert.equal((await admin('/settings', { method: 'PUT', input: settings })).status, 200);
  const { input, credentials } = buyer('AB12 CDE', 'basic');
  const { order } = await request('/orders', { method: 'POST', input, credentials });
  const via = (path, body) => request('/orders/' + order.ref + path, { method: 'POST', credentials, input: body });
  assert.equal((await via('/payment', {})).url, 'https://www.sandbox.paypal.com/checkout');
  assert.equal((await via('/return', { cancelled: true })).order.status, 'cancelled');
  assert.equal((await via('/payment', {})).url, 'https://www.sandbox.paypal.com/checkout');
  assert.equal(creates, 1);
  payment.status = 'APPROVED';
  assert.equal((await via('/return', { cancelled: false })).order.status, 'cancelled');
  assert.equal(captures, 1);
  const inputEvent = { event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { supplementary_data: { related_ids: { order_id: id } } } };
  assert.equal((await request('/webhooks/paypal', { method: 'POST', input: inputEvent })).status, 400);
  payment.purchase_units[0].payments.captures[0].amount.value = '20.00';
  const event = () => request('/webhooks/paypal', { method: 'POST', input: inputEvent,
    headers: { 'paypal-transmission-id': 'verified-fixture' } });
  await Promise.all([event(), event()]);
  const paid = await store.get(order.ref);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.gatewayCapturedId, 'CAPTURE12345');
  assert.equal(paid.notifications.length, 3);
});
