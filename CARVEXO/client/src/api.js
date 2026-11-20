import { getPackage, packages, registrationFrom } from '../../shared/catalog.js';

import { defaults } from '../../shared/site-content.js';

export const staticDemo = import.meta.env.VITE_STATIC_DEMO === 'true';
const sessionKey = 'carvexo.checkout';
let fallbackSession = {};

export function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey)) ?? fallbackSession;
  } catch {
    return fallbackSession;
  }
}

export function saveSession(values) {
  const session = { ...readSession(), ...values };
  fallbackSession = session;
  try { sessionStorage.setItem(sessionKey, JSON.stringify(session)); } catch {}
  return session;
}

function randomHex(byteCount) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteCount)), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

export function newAttempt(packageKey) {
  const text = randomHex(16);
  const attemptId = text.slice(0, 8) + '-' + text.slice(8, 12) + '-4'
    + text.slice(13, 16) + '-a' + text.slice(17, 20) + '-' + text.slice(20);
  return saveSession({ packageKey, attemptId, accessToken: randomHex(32), ref: '', previewOrder: null, returningFromPayment: false, complete: false });
}

export function choosePackage(packageKey) {
  const session = readSession();
  return session.packageKey === packageKey && session.attemptId && !session.complete
    ? session : newAttempt(packageKey);
}

export function saveRegistration(registration) {
  const old = readSession();
  const changes = old.registration !== registration ? {
    packageKey: '', attemptId: '', accessToken: '', ref: '', previewOrder: null, returningFromPayment: false, complete: false,
  } : {};
  saveSession({ ...changes, registration });
}

export async function request(path, method = 'GET', body, accessToken) {
  const response = await fetch('/api' + path, {
    method,
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(path.startsWith('/admin/') ? { 'X-Carvexo-Admin': '1' } : {}),
      ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'We couldn’t complete that request. Try again.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function catalog() {
  if (staticDemo) return { mode: 'demo', packages, tawkWidget: '', content: defaults.content, turnaround: defaults.content.turnaround };
  return request('/catalog');
}

export async function createPending(email, expectedAmount) {
  const session = readSession();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  let order;
  if (staticDemo) {
    const option = getPackage(session.packageKey);
    const registration = registrationFrom(session.registration);
    if (!option || !registration) throw new Error('Start again with a registration and report package.');
    const [user, site] = email.split('@');
    order = session.previewOrder ?? {
      ref: 'CVX-' + randomHex(10).toUpperCase(), registration: registration.display,
      packageKey: option.key, packageTitle: option.title, amount: option.amount,
      currency: 'gbp', status: 'pending', fulfilment: 'awaiting_payment', mode: 'demo',
      emailHint: user.slice(0, 2) + '•••@' + site,
    };
    saveSession({ previewOrder: order });
  } else {
    ({ order } = await request('/orders', 'POST', {
      registration: session.registration, packageKey: session.packageKey,
      email, attemptId: session.attemptId, expectedAmount,
    }, session.accessToken));
  }
  return saveSession({ ref: order.ref });
}

export async function beginOnlinePayment() {
  const session = readSession();
  return request('/orders/' + session.ref + '/payment', 'POST', {}, session.accessToken);
}

export async function paymentReturn(cancelled) {
  const session = readSession();
  if (!session.ref || !session.accessToken || staticDemo) return;
  return request('/orders/' + session.ref + '/return', 'POST', { cancelled }, session.accessToken);
}

export async function currentOrder() {
  const session = readSession();
  if (!session.ref || !session.accessToken) return null;
  if (staticDemo) return session.previewOrder;
  return (await request('/orders/' + session.ref, 'GET', null, session.accessToken)).order;
}
