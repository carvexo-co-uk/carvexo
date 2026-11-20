import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { adminAuth } from './admin-auth.js';
import { checkGateway } from './gateways.js';
import { markSent, RequestError } from './orders.js';
import { getSettings, validateSettings } from './settings.js';
import { updateOrder } from './store.js';

const allowedStatuses = ['pending', 'processing', 'paid', 'failed', 'cancelled'];

function adminOrder(order) {
  const { ref, registration, email, packageTitle, amount, currency, status, fulfilment, paymentMode, createdAt, sentAt, notifications } = order;
  return { ref, registration, email, packageTitle, amount, currency, status, fulfilment, paymentMode, createdAt, sentAt,
    notifications: notifications.map(({ key, state, attempts, error, payload }) =>
      ({ key, state, attempts, error, ...(payload ? { preview: { subject: payload.subject, to: payload.to, text: payload.text } } : {}) })),
  };
}

export function adminRoutes({ config, store, stripe, paypal, gateways, wake }) {
  const routes = Router();
  const auth = adminAuth(config);
  const loginLimit = rateLimit({
    limit: 8, windowMs: 10 * 60_000, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
  });
  routes.use(auth.sameSite);
  routes.get('/session', auth.session);
  routes.post('/login', loginLimit, auth.login);
  routes.post('/logout', auth.logout);
  routes.use(auth.require);
  routes.get('/settings', async (_req, res) => res.json({
    settings: await getSettings(store, config), gateways, mailMode: config.emailMode,
  }));
  routes.put('/settings', async (req, res) => {
    const next = validateSettings(req.body);
    const previous = await getSettings(store, config);
    if (next.payment.provider && next.payment.provider !== previous.payment.provider) {
      await checkGateway(next.payment.provider, gateways, config, stripe, paypal);
    }
    if (!await store.saveSettings(next, req.body.revision)) {
      throw new RequestError(409, 'Settings changed in another session. Reload before saving.');
    }
    res.json({ settings: next });
  });
  routes.post('/payments/:provider/check', async (req, res) => {
    res.json(await checkGateway(req.params.provider, gateways, config, stripe, paypal));
  });
  routes.get('/orders', async (req, res) => {
    const { status, q, page } = req.query;
    const query = typeof q === 'string' ? q.trim().slice(0, 254) : '';
    const offset = typeof page === 'string' && /^\d{1,5}$/.test(page) ? Number(page) * 50 : 0;
    const matches = await store.list(allowedStatuses.includes(status) ? status : '', query, offset);
    res.json({ orders: matches.slice(0, 50).map(adminOrder), hasMore: matches.length > 50 });
  });
  routes.post('/orders/:ref/sent', async (req, res) => {
    res.json({ order: adminOrder(await markSent(store, req.params.ref)) });
  });
  routes.post('/orders/:ref/retry-email', async (req, res) => {
    const order = await updateOrder(store, req.params.ref, row => {
      let changed = false;
      for (const item of row.notifications) {
        if (item.error && item.leaseUntil <= Date.now() && ['queued', 'needs_review'].includes(item.state)) {
          item.state = 'queued';
          item.nextAt = Date.now();
          changed = true;
        }
      }
      return changed ? row : null;
    });
    if (!order) throw new RequestError(404, 'Order not found.');
    await wake(order.ref);
    res.json({ order: adminOrder(await store.get(order.ref)) });
  });
  return routes;
}
