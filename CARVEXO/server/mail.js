import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatPrice } from '../shared/catalog.js';
import { updateOrder } from './store.js';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
));

export function messageFor(order, key, config) {
  const isCustomer = key.endsWith('-customer');
  const demo = key.startsWith('demo-');
  const lead = key === 'pending-owner';
  const paid = key.startsWith('paid-');
  const sandbox = order.paymentMode.endsWith('-test');
  const heading = isCustomer ? (demo ? 'Order confirmed' : 'Payment confirmed')
    : lead ? 'New checkout lead' : demo ? 'New demo order confirmed' : 'Report order paid';
  const intro = demo
    ? 'Your Cash on Delivery demo order has been recorded. Payment is pending. This demo does not collect payment or dispatch a report.'
    : paid && sandbox ? 'The sandbox provider confirmed this test payment. No report will be dispatched.'
      : lead ? 'A customer submitted a CARVEXO checkout. Payment is awaiting confirmation.'
      : isCustomer ? 'Thank you for ordering from CARVEXO. Our team will email your vehicle history report to the address you provided.'
        : 'The payment provider confirmed this order. Prepare the report and email it to the customer address below.';
  const details = order.emailSettings ?? {
    ownerEmail: config.ownerEmail || 'carvexo.co.uk@gmail.com', replyTo: 'carvexo.co.uk@gmail.com',
  };
  const rows = [
    ['Order reference', order.ref], ['Vehicle registration', order.registration],
    ['Report package', order.packageTitle], [paid ? 'Amount paid' : 'Order total', formatPrice(order.amount) + ' GBP'],
    ['Payment method', order.paymentMode === 'demo' ? 'Cash on Delivery (demo)' : order.paymentMode.startsWith('paypal') ? 'PayPal' : 'Stripe'],
    ['Payment status', paid ? (sandbox ? 'Paid (sandbox)' : 'Paid') : 'Pending'],
    ...(!isCustomer ? [['Customer email', order.email]] : []),
    ...(isCustomer && order.packageFeatures?.length ? [['Included checks', order.packageFeatures.join(', ')]] : []),
    ...(!isCustomer && paid ? [['Payment reference', order.gatewayCapturedId || order.paymentIntentId]] : []),
    ...(isCustomer && paid && details.turnaround ? [['Expected delivery', details.turnaround]] : []),
  ];
  const support = isCustomer && details.replyTo ? 'For help, reply to this email or contact ' + details.replyTo + '.' : '';
  const subject = key === 'demo-customer' ? 'Your CARVEXO order is confirmed' : 'CARVEXO · ' + heading + ' · ' + order.ref;
  const text = [heading, intro, '', ...rows.map(([label, value]) => label + ': ' + value), '', support]
    .filter((line) => line !== undefined).join('\n').trim();
  const identity = config.publicOrigin
    ? '<img width="156" height="18" alt="Carvexo" style="display:block" src="' + escapeHtml(config.publicOrigin) + '/brand/primary.png">'
    : '<strong style="letter-spacing:0.2em;color:#f1eeea">CARVEXO</strong>';
  const table = rows.map(([label, value]) =>
    '<tr><td style="padding:8px 12px 8px 0;color:#595c60">' + escapeHtml(label)
    + '</td><td style="padding:8px 0;font-weight:600">' + escapeHtml(value) + '</td></tr>').join('');
  const html = '<!doctype html><html lang="en-GB"><meta charset="utf-8"><body style="margin:0;background:#efeeeb;color:#15191c;font-family:Arial,sans-serif">'
    + '<div style="max-width:560px;margin:auto;background:#fff"><header style="padding:24px;background:#0d1114;border-bottom:3px solid #ffa581">'
    + identity + '</header><main style="padding:26px"><h1 style="font-size:26px;margin:0 0 14px">'
    + heading + '</h1><p style="line-height:1.55">' + escapeHtml(intro)
    + '</p><table style="font-size:15px;border-collapse:collapse">' + table
    + '</table><p style="line-height:1.55">' + escapeHtml(support) + '</p></main></div></body></html>';
  return {
    from: config.from,
    to: [isCustomer ? order.email : details.ownerEmail],
    ...(details.replyTo ? { reply_to: details.replyTo } : {}),
    subject,
    text,
    html,
  };
}

async function deliver(message, identity, config) {
  if (config.captureInStore && config.emailMode === 'capture') return;
  if (config.emailMode === 'capture') {
    const folder = join(config.dataDirectory, 'mail');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, identity + '.json');
    const temporary = file + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(message, null, 2), { mode: 0o600 });
    await rename(temporary, file);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.mailKey,
      'Content-Type': 'application/json',
      'Idempotency-Key': identity,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Email provider returned HTTP ' + response.status);
}

function claim(store, ref, key, token) {
  return updateOrder(store, ref, (order) => {
    const notice = order.notifications.find((item) => item.key === key);
    const now = Date.now();
    if (!notice || notice.state !== 'queued' || notice.nextAt > now || notice.leaseUntil > now) return null;
    notice.leaseToken = token;
    notice.leaseUntil = now + 45000;
    return order;
  });
}

export async function drainNotifications(store, config, ref) {
  const orders = ref ? [await store.get(ref)].filter(Boolean) : await store.due(Date.now());
  for (const order of orders) {
    await Promise.all(order.notifications.map(async (notice) => {
      if (notice.state !== 'queued' || notice.nextAt > Date.now()) return;
      const token = randomUUID();
      const claimed = await claim(store, order.ref, notice.key, token);
      const active = claimed?.notifications.find((item) => item.key === notice.key);
      if (active?.leaseToken !== token) return;
      const message = active.payload || messageFor(claimed, notice.key, config);
      let failure = '';
      try {
        await deliver(message, order.ref + '-' + notice.key, config);
      } catch (error) {
        failure = error.message.slice(0, 140);
      }
      await updateOrder(store, order.ref, (latest) => {
        const item = latest.notifications.find((candidate) => candidate.key === notice.key);
        if (item.leaseToken !== token) return null;
        item.attempts++;
        item.leaseUntil = 0;
        item.leaseToken = '';
        item.error = failure;
        if (config.emailMode === 'capture') item.payload = message;
        if (!failure) {
          item.state = config.emailMode === 'capture' ? 'captured' : 'sent';
          item.sentAt = Date.now();
        } else if (item.attempts >= 10) {
          item.state = 'needs_review';
        } else {
          item.nextAt = Date.now() + Math.min(60 * 60 * 1000, 30000 * 2 ** (item.attempts - 1));
        }
        return latest;
      });
    }));
  }
}

export function startOutbox(store, config) {
  let working = false;
  let again = false;
  function wake() {
    if (working) { again = true; return; }
    working = true;
    drainNotifications(store, config).catch((error) => {
      console.error('Email queue processing failed:', error.name);
    }).finally(() => {
      working = false;
      if (again) { again = false; wake(); }
    });
  }
  const timer = setInterval(wake, 5000);
  timer.unref();
  wake();
  return wake;
}
