import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import Stripe from 'stripe';
import { adminRoutes } from './admin.js';
import { applyPayPalEvent, applyStripeSession, gatewayState, makePayPal, reconcilePayPal, selectedMode, startGatewayPayment } from './gateways.js';
import { drainNotifications } from './mail.js';
import { availablePackages, getSettings } from './settings.js';
import { updateOrder } from './store.js';
import {
  applyStripeEvent, authorisedOrder, createOrder, orderView, RequestError, setPayment,
} from './orders.js';

export function makeApp({ config, store, wake = () => {}, stripe, paypal, staticDirectory }) {
  const app = express();
  const gateways = gatewayState(config);
  if (!stripe && gateways.stripe.configured) {
    stripe = new Stripe(config.secretKey, { maxNetworkRetries: 1, timeout: 12000 });
  }
  if (!paypal && gateways.paypal.configured) paypal = makePayPal(config);
  app.disable('x-powered-by');
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops);
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://*.tawk.to'], ["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://*.tawk.to'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://*.tawk.to'],
        fontSrc: ["'self'", 'data:', 'https://*.tawk.to'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tawk.to', 'https://*.stripe.com'],
        connectSrc: ["'self'", 'https://*.stripe.com', 'https://*.tawk.to', 'wss://*.tawk.to'],
        frameSrc: ["'self'", 'https://*.stripe.com', 'https://*.tawk.to'],
        mediaSrc: ["'self'", 'https://*.tawk.to'],
        upgradeInsecureRequests: config.live ? [] : null,
      },
    },
    strictTransportSecurity: config.live,
  }));
  app.use((req, res, next) => {
    res.set('Referrer-Policy', 'no-referrer');
    if (!config.allowRobots || /^\/(?:admin|api|checkout|confirmation)(?:\/|$)/.test(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
    if (!stripe) return res.sendStatus(404);
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.get('Stripe-Signature') ?? '', config.webhookSecret);
    } catch {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }
    await applyStripeEvent(store, event, { live: gateways.stripe.live,
      mode: gateways.stripe.live ? 'stripe-live' : 'stripe-test' });
    await applyStripeSession(store, event, gateways.stripe);
    wake(event.data?.object?.client_reference_id ?? event.data?.object?.metadata?.orderRef);
    res.json({ received: true });
  });

  app.use('/api', express.json({ limit: '160kb' }));
  app.use('/api/admin', adminRoutes({
    config, store, stripe, paypal, gateways, wake: ref => drainNotifications(store, config, ref),
  }));
  const checkoutLimit = rateLimit({
    limit: 45, windowMs: 60_000, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many checkout attempts. Please wait a minute before retrying.' },
  });
  app.post(['/api/orders', '/api/orders/:ref/payment', '/api/orders/:ref/return'], checkoutLimit);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, storage: config.mongoUri ? 'mongodb' : 'local-file' });
  });
  app.get('/api/outbox', async (req, res) => {
    if (!config.cronSecret || req.get('Authorization') !== 'Bearer ' + config.cronSecret) return res.sendStatus(404);
    await drainNotifications(store, config);
    res.json({ ok: true });
  });
  app.get('/api/catalog', async (_req, res) => {
    const settings = await getSettings(store, config);
    res.json({
      packages: availablePackages(settings), mode: selectedMode(settings.payment, gateways),
      tawkWidget: config.tawkWidget, content: settings.content,
      turnaround: settings.content.turnaround,
    });
  });
  app.post('/api/orders', async (req, res) => {
    const settings = await getSettings(store, config);
    const order = await createOrder(store, req.body, req.get('Authorization'),
      selectedMode(settings.payment, gateways), settings);
    wake(order.ref);
    res.json({ order: orderView(order) });
  });
  app.post('/api/orders/:ref/payment', async (req, res) => {
    const order = await authorisedOrder(store, req.params.ref, req.get('Authorization'));
    const settings = await getSettings(store, config);
    const mode = selectedMode(settings.payment, gateways);
    if (!/^(stripe|paypal)-(test|live)$/.test(mode) || order.paymentMode !== mode) {
      throw new RequestError(409, 'Start a new checkout for the current payment method.');
    }
    if (order.paymentIntentId && !order.gatewayOrderId) {
      throw new RequestError(409, 'Contact support before starting a new payment for this order.');
    }
    res.json(await startGatewayPayment(store, config, order, stripe, paypal));
  });
  app.post('/api/orders/:ref/return', async (req, res) => {
    let order = await authorisedOrder(store, req.params.ref, req.get('Authorization'));
    if (order.gatewayOrderId && order.status !== 'paid') {
      if (req.body?.cancelled === true) {
        order = await updateOrder(store, order.ref, row => setPayment(row, 'cancelled'));
      } else if (order.paymentMode.startsWith('paypal') && paypal
        && order.paymentMode === (gateways.paypal.live ? 'paypal-live' : 'paypal-test')) {
        order = await reconcilePayPal(store, paypal, await paypal.get(order.gatewayOrderId), gateways.paypal, true) ?? order;
      }
    }
    wake(order.ref);
    res.json({ order: orderView(order) });
  });
  app.post('/api/webhooks/paypal', async (req, res) => {
    if (!paypal || !config.paypal.webhookId) return res.sendStatus(404);
    if (!await paypal.verify(req)) throw new RequestError(400, 'Invalid webhook signature.');
    const order = await applyPayPalEvent(store, paypal, req.body, gateways.paypal);
    if (order) wake(order.ref);
    res.json({ received: true });
  });
  app.get('/api/orders/:ref', async (req, res) => {
    const order = await authorisedOrder(store, req.params.ref, req.get('Authorization'));
    res.json({ order: orderView(order) });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Page not found.' }));

  if (staticDirectory && existsSync(join(staticDirectory, 'index.html'))) {
    app.use(express.static(staticDirectory, { index: false }));
    const layout = readFileSync(join(staticDirectory, 'index.html'), 'utf8');
    app.get('/{*path}', async (req, res) => {
      const { content } = await getSettings(store, config);
      const path = req.path.replace(/\/$/, '') || '/';
      const meta = Object.hasOwn(content.seo, path) ? content.seo[path] : content.seo['/'];
      const escape = value => String(value).replace(/[&<>"']/g, char => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
      ));
      const html = layout.replace(/<title>.*?<\/title>/, () => '<title>' + escape(meta.title) + '</title>')
        .replace(/<meta name="description"[^>]*>/, () => '<meta name="description" content="' + escape(meta.description) + '">')
        .replace(/<meta property="og:title"[^>]*>/, () => '<meta property="og:title" content="' + escape(meta.title) + '">')
        .replace(/<meta property="og:description"[^>]*>/, () => '<meta property="og:description" content="' + escape(meta.description) + '">')
        .replace('</head>', () => '<meta name="keywords" content="' + escape(meta.keywords) + '"></head>');
      res.set('Cache-Control', 'no-cache').status(path === '/admin' || Object.hasOwn(content.seo, path) ? 200 : 404).type('html').send(html);
    });
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid request.' });
    }
    console.error('Carvexo API request failed:', error.name);
    res.status(500).json({ error: 'We couldn’t complete that request. Please try again.' });
  });
  return app;
}
