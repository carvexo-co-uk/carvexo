import { RequestError, orderView, setPayment } from './orders.js';
import { updateOrder } from './store.js';

const paypalApproval = 'CHECKOUT.ORDER.APPROVED';
const paypalEvents = [paypalApproval, 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'];
const stripeEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired'];
const refPattern = /^CVX-[A-F0-9]{20}$/;

export function makePayPal(config, fetchApi = fetch) {
  const { environment, clientId, secret, webhookId } = config.paypal;
  const base = environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const send = async (path, options) => {
    const response = await fetchApi(base + path, { ...options, signal: AbortSignal.timeout(9000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new RequestError(502, 'PayPal could not complete the request. Try again.');
    return data;
  };
  let token;
  let expiresAt = 0;
  async function call(path, body, idempotency) {
    if (Date.now() >= expiresAt) {
      const auth = await send('/v1/oauth2/token', {
        method: 'POST', headers: {
          Authorization: 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        }, body: 'grant_type=client_credentials',
      });
      token = auth.access_token;
      expiresAt = Date.now() + Math.max(0, auth.expires_in - 60) * 1000;
    }
    return send(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotency ? { 'PayPal-Request-Id': idempotency } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  return {
    get: id => call('/v2/checkout/orders/' + encodeURIComponent(id)),
    create(order, urls) {
      return call('/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: order.ref, custom_id: order.ref, description: 'CARVEXO ' + order.packageTitle,
          amount: { currency_code: 'GBP', value: (order.amount / 100).toFixed(2) } }],
        payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
          return_url: urls.success, cancel_url: urls.cancel } } },
      }, 'cvx-' + order.ref.slice(4) + '-' + (order.paymentVersion ?? 0));
    },
    capture: id => call('/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {}, 'capture-' + id),
    webhook: () => call('/v1/notifications/webhooks/' + encodeURIComponent(webhookId)),
    async verify(req) {
      const headers = ['auth-algo', 'cert-url', 'transmission-id', 'transmission-sig', 'transmission-time'];
      const values = Object.fromEntries(headers.map(key => [key.replaceAll('-', '_'), req.get('paypal-' + key)]));
      if (Object.values(values).some(value => !value)) return false;
      const result = await call('/v1/notifications/verify-webhook-signature',
        { ...values, webhook_id: webhookId, webhook_event: req.body });
      return result.verification_status === 'SUCCESS';
    },
  };
}

export function gatewayState(config) {
  const stripeTest = /^(sk|rk)_test_/.test(config.secretKey) && config.publishableKey.startsWith('pk_test_');
  const stripeLive = /^(sk|rk)_live_/.test(config.secretKey) && config.publishableKey.startsWith('pk_live_');
  const stripe = (stripeTest || stripeLive) && config.webhookSecret.startsWith('whsec_');
  const paypal = !!(config.paypal.clientId && config.paypal.secret && config.paypal.webhookId);
  return {
    stripe: { configured: stripe, live: stripeLive, ready: stripe && (!stripeLive || config.liveReady) },
    paypal: { configured: paypal, live: config.paypal.environment === 'live',
      ready: paypal && (config.paypal.environment !== 'live' || config.liveReady) },
  };
}

export function selectedMode(payment, gateways) {
  if (payment.provider) {
    const gateway = gateways[payment.provider];
    return gateway.ready ? payment.provider + (gateway.live ? '-live' : '-test') : 'closed';
  }
  return payment.demoEnabled ? 'demo' : 'closed';
}

export async function checkGateway(provider, gateways, config, stripe, paypal) {
  if (!gateways[provider]?.ready || !config.publicOrigin) {
    throw new RequestError(409, 'Configure this provider, its webhook and the public origin on the server first.');
  }
  const url = config.publicOrigin + '/api/webhooks/' + provider;
  let ready;
  if (provider === 'stripe') {
    for await (const item of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (item.url === url && item.status === 'enabled' && item.livemode === gateways.stripe.live
        && (item.enabled_events.includes('*') || stripeEvents.every(event => item.enabled_events.includes(event)))) {
        ready = true;
        break;
      }
    }
  } else {
    const endpoint = await paypal.webhook();
    const events = endpoint.event_types?.map(item => item.name) ?? [];
    ready = endpoint.url === url && (events.includes('*') || paypalEvents.every(event => events.includes(event)));
  }
  if (!ready) throw new RequestError(409, 'The required webhook is missing or misconfigured.');
  return { verified: true, environment: gateways[provider].live ? 'live' : 'sandbox' };
}

function checkoutUrls(origin) {
  if (!origin) throw new RequestError(503, 'Payment redirect has not been configured.');
  return { success: origin + '/confirmation', cancel: origin + '/confirmation?cancelled=1' };
}

export async function startGatewayPayment(store, config, order, stripe, paypal) {
  if (order.status === 'paid') return { order: orderView(order) };
  const provider = order.paymentMode.split('-')[0];
  const urls = checkoutUrls(config.publicOrigin);
  let existing;
  if (order.gatewayOrderId) {
    existing = provider === 'stripe' ? await stripe.checkout.sessions.retrieve(order.gatewayOrderId) : await paypal.get(order.gatewayOrderId);
    if (provider === 'stripe' && existing.status === 'complete') return { order: orderView(order) };
    if (provider === 'paypal' && ['APPROVED', 'COMPLETED'].includes(existing.status)) return { url: urls.success };
    if (!['expired', 'VOIDED'].includes(existing.status)) return { url: order.gatewayUrl };
    order = await updateOrder(store, order.ref, current => {
      if (current.status === 'paid' || current.gatewayOrderId !== existing.id) return null;
      current.gatewayOrderId = '';
      current.gatewayUrl = '';
      current.paymentVersion = (current.paymentVersion ?? 0) + 1;
      return current;
    });
    if (order.status === 'paid') return { order: orderView(order) };
    if (order.gatewayOrderId) return { url: order.gatewayUrl };
  }
  let session, url;
  if (provider === 'stripe') {
    session = await stripe.checkout.sessions.create({
      mode: 'payment', client_reference_id: order.ref, customer_email: order.email,
      success_url: urls.success, cancel_url: urls.cancel, payment_method_types: ['card'],
      line_items: [{ quantity: 1, price_data: { currency: order.currency, unit_amount: order.amount,
        product_data: { name: 'CARVEXO ' + order.packageTitle } } }],
    }, { idempotencyKey: 'carvexo-session-' + order.ref + '-' + (order.paymentVersion ?? 0) });
    url = session.url;
  } else {
    session = await paypal.create(order, urls);
    url = session.links?.find(link => ['approve', 'payer-action'].includes(link.rel))?.href;
  }
  if (!session.id || !url || !URL.canParse(url) || new URL(url).protocol !== 'https:') {
    throw new RequestError(502, 'The payment provider did not return a checkout link.');
  }
  const saved = await updateOrder(store, order.ref, current => {
    if (current.status === 'paid' || current.gatewayOrderId
      || current.paymentVersion !== order.paymentVersion) return null;
    current.gatewayOrderId = session.id;
    current.gatewayUrl = url;
    if (current.status === 'cancelled' || current.status === 'failed') current.status = 'pending';
    return current;
  });
  if (saved.gatewayOrderId !== session.id) throw new RequestError(409, 'The checkout changed. Please try again.');
  return { url: saved.gatewayUrl };
}

export async function applyStripeSession(store, event, gateway) {
  if (!stripeEvents.includes(event.type) || event.livemode !== gateway.live) return;
  const session = event.data.object;
  const ref = session.client_reference_id;
  if (!refPattern.test(ref ?? '')) return;
  await updateOrder(store, ref, order => {
    if (order.paymentMode !== (gateway.live ? 'stripe-live' : 'stripe-test') || order.gatewayOrderId !== session.id
      || session.amount_total !== order.amount || session.currency !== order.currency) return null;
    const state = event.type === 'checkout.session.expired' ? 'cancelled'
      : event.type === 'checkout.session.async_payment_failed' ? 'failed'
        : session.payment_status === 'paid' ? 'paid' : 'processing';
    if (state === 'paid') order.gatewayCapturedId = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;
    return setPayment(order, state);
  });
}

export async function reconcilePayPal(store, paypal, payment, gateway, capture = false) {
  const unit = payment.purchase_units?.[0];
  const ref = unit?.reference_id;
  if (!refPattern.test(ref ?? '') || unit.custom_id !== ref
    || payment.purchase_units.length !== 1) return null;
  const order = await store.get(ref);
  const expectedMode = gateway.live ? 'paypal-live' : 'paypal-test';
  if (!order || order.paymentMode !== expectedMode || order.gatewayOrderId !== payment.id
    || unit.amount?.currency_code !== 'GBP' || unit.amount.value !== (order.amount / 100).toFixed(2)) return null;
  if (order.status === 'paid') return order;
  if (capture && payment.status === 'APPROVED') {
    try { await paypal.capture(payment.id); }
    catch (error) {
      const refreshed = await paypal.get(payment.id);
      if (refreshed.status !== 'COMPLETED') throw error;
    }
    return reconcilePayPal(store, paypal, await paypal.get(payment.id), gateway);
  }
  const transaction = unit.payments?.captures?.find(item => item.amount?.currency_code === 'GBP'
    && item.amount.value === (order.amount / 100).toFixed(2));
  const state = transaction?.status === 'COMPLETED' && transaction.id ? 'paid'
    : transaction?.status === 'PENDING' ? 'processing'
      : ['DECLINED', 'FAILED'].includes(transaction?.status) ? 'failed'
        : payment.status === 'VOIDED' ? 'cancelled' : null;
  if (!state) return order;
  return updateOrder(store, ref, current => {
    if (current.gatewayOrderId !== payment.id) return null;
    if (state === 'paid') current.gatewayCapturedId = transaction.id;
    return setPayment(current, state);
  });
}

export async function applyPayPalEvent(store, paypal, event, gateway) {
  if (!paypalEvents.includes(event.event_type)) return null;
  const approved = event.event_type === paypalApproval;
  const id = approved ? event.resource?.id : event.resource?.supplementary_data?.related_ids?.order_id;
  if (typeof id !== 'string' || !/^[A-Z0-9]{8,32}$/.test(id)) return null;
  return reconcilePayPal(store, paypal, await paypal.get(id), gateway, approved);
}
