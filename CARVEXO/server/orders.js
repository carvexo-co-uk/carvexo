import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { registrationFrom, currency } from '../shared/catalog.js';
import { updateOrder } from './store.js';

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const attemptPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const refPattern = /^CVX-[A-F0-9]{20}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bearer(header) {
  const token = header?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token) throw new RequestError(401, 'The checkout session has expired. Please start again.');
  return createHash('sha256').update(token).digest('hex');
}

function hasAccess(order, authHash) {
  return timingSafeEqual(Buffer.from(order.authHash, 'hex'), Buffer.from(authHash, 'hex'));
}

export function addNotification(order, key) {
  if (order.notifications.some((notice) => notice.key === key)) return;
  order.notifications.push({
    key, state: 'queued', attempts: 0, nextAt: Date.now(),
    leaseUntil: 0, leaseToken: '', sentAt: 0, error: '',
  });
}

export async function createOrder(store, input, authorization, mode, settings) {
  const authHash = bearer(authorization);
  const option = settings.packages.find(item => item.key === input?.packageKey && item.enabled);
  const registration = registrationFrom(input?.registration);
  const email = typeof input?.email === 'string' ? input.email.trim() : '';
  if (!registration) throw new RequestError(400, 'Enter a valid-looking UK registration number.');
  if (typeof input?.attemptId !== 'string' || !attemptPattern.test(input.attemptId)) {
    throw new RequestError(400, 'The checkout session is invalid. Please start again.');
  }
  const existing = await store.findAttempt(input?.attemptId);
  if (existing) {
    if (!hasAccess(existing, authHash)) throw new RequestError(404, 'Order not found.');
    if (existing.registrationKey !== registration.key || existing.packageKey !== input.packageKey || existing.email !== email) {
      throw new RequestError(409, 'This order already has different details. Start a new checkout to change them.');
    }
    return existing;
  }
  if (mode === 'closed') throw new RequestError(503, 'Checkout is temporarily closed.');
  if (!option) throw new RequestError(400, 'Choose an available report package.');
  if (input.expectedAmount !== undefined && input.expectedAmount !== option.amount) {
    throw new RequestError(409, 'The price has changed. Refresh the page before placing your order.');
  }
  if (!emailPattern.test(email) || email.length > 254) throw new RequestError(400, 'Enter a valid email address.');
  const order = {
    ref: 'CVX-' + randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase(),
    attemptId: input.attemptId,
    authHash,
    revision: 0,
    registration: registration.display,
    registrationKey: registration.key,
    email,
    packageKey: option.key,
    packageTitle: option.title,
    packageFeatures: [...option.features],
    emailSettings: { ...settings.notifications, turnaround: settings.content.turnaround },
    amount: option.amount,
    currency,
    status: 'pending',
    fulfilment: 'awaiting_payment',
    paidAt: 0,
    sentAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    paymentIntentId: '',
    paymentVersion: 0,
    paymentMode: mode,
    notifications: [],
  };
  addNotification(order, 'pending-owner');
  if (mode === 'demo') {
    addNotification(order, 'demo-owner');
    addNotification(order, 'demo-customer');
  }
  const saved = await store.insert(order);
  if (!hasAccess(saved, authHash)) throw new RequestError(404, 'Order not found.');
  if (saved.registrationKey !== registration.key || saved.packageKey !== option.key
      || saved.email !== email) {
    throw new RequestError(409, 'This order already has different details. Start a new checkout to change them.');
  }
  return saved;
}

export async function authorisedOrder(store, ref, authorization) {
  const authHash = bearer(authorization);
  const order = refPattern.test(ref) ? await store.get(ref) : null;
  if (!order || !hasAccess(order, authHash)) throw new RequestError(404, 'Order not found.');
  return order;
}

export function orderView(order) {
  const [name, domain] = order.email.split('@');
  return {
    ref: order.ref, registration: order.registration, packageKey: order.packageKey,
    packageTitle: order.packageTitle, amount: order.amount, currency: order.currency,
    status: order.status, fulfilment: order.fulfilment, emailHint: name.slice(0, 2) + '•••@' + domain,
    mode: order.paymentMode,
  };
}

export function setPayment(order, state, intentId) {
  if (order.status === 'paid' || (state === order.status && !intentId)) return null;
  if (intentId) order.paymentIntentId = intentId;
  order.status = state;
  if (state === 'paid') {
    order.fulfilment = order.paymentMode.endsWith('-live') ? 'awaiting_report' : 'sandbox_payment';
    order.paidAt = Date.now();
    addNotification(order, 'paid-owner');
    addNotification(order, 'paid-customer');
  }
  return order;
}

export async function applyStripeEvent(store, event, config) {
  const states = {
    'payment_intent.succeeded': 'paid',
    'payment_intent.processing': 'processing',
    'payment_intent.payment_failed': 'failed',
    'payment_intent.canceled': 'cancelled',
  };
  const state = states[event.type];
  if (!state || event.livemode !== config.live) return;
  const intent = event.data.object;
  const ref = intent.metadata?.orderRef;
  if (!refPattern.test(ref ?? '')) return;
  await updateOrder(store, ref, (order) => {
    if (order.paymentMode !== config.mode || order.paymentIntentId !== intent.id
      || order.amount !== intent.amount || order.currency !== intent.currency
      || (state === 'paid' && (intent.amount_received !== order.amount || intent.status !== 'succeeded'))) {
      return null;
    }
    return setPayment(order, state);
  });
}

export async function markSent(store, ref) {
  const result = await updateOrder(store, ref, (order) => {
    if (order.status !== 'paid' || !order.paymentMode.endsWith('-live')) {
      throw new RequestError(409, 'Only a verified live order can be marked sent.');
    }
    if (order.fulfilment === 'sent') return null;
    order.fulfilment = 'sent';
    order.sentAt = Date.now();
    return order;
  });
  if (!result) throw new RequestError(404, 'Order not found.');
  return result;
}
