const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function loadConfig(env = process.env) {
  const mode = env.CARVEXO_PAYMENT_MODE || 'demo';
  const emailMode = env.CARVEXO_MAIL_MODE || 'capture';
  const publicOrigin = env.CARVEXO_PUBLIC_ORIGIN || '';
  const live = mode === 'stripe-live' || env.CARVEXO_PRODUCTION_APPROVED === 'true';
  if (!['demo', 'stripe-test', 'stripe-live'].includes(mode)) throw new Error('Invalid CARVEXO_PAYMENT_MODE.');
  if (!['capture', 'resend'].includes(emailMode)) throw new Error('Invalid CARVEXO_MAIL_MODE.');
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.origin !== publicOrigin || !['https:', 'http:'].includes(url.protocol)) {
      throw new Error('CARVEXO_PUBLIC_ORIGIN must be a plain website origin with no trailing slash.');
    }
  }
  if (emailMode === 'resend' && (!env.RESEND_API_KEY || !env.CARVEXO_MAIL_FROM)) {
    throw new Error('Resend requires its API key and an authorized From address.');
  }
  if (env.CARVEXO_OWNER_EMAIL && !emailPattern.test(env.CARVEXO_OWNER_EMAIL)) throw new Error('Invalid owner email.');
  if (env.VERCEL && !env.MONGODB_URI) throw new Error('Vercel requires MONGODB_URI for durable orders.');
  const liveReady = env.CARVEXO_PRODUCTION_APPROVED === 'true' && !!env.MONGODB_URI
    && publicOrigin.startsWith('https://') && emailMode === 'resend';
  if (mode === 'stripe-live' && !liveReady) {
    throw new Error('Live checkout requires production approval, MongoDB, a secure origin and verified email delivery.');
  }
  if (env.CARVEXO_TAWK_WIDGET && !/^[a-f0-9]+\/[a-z0-9]+$/i.test(env.CARVEXO_TAWK_WIDGET)) {
    throw new Error('Enter the Tawk.to widget as propertyId/widgetId.');
  }
  const implicitOrigin = env.VERCEL_URL ? 'https://' + env.VERCEL_URL : '';
  return {
    mode, emailMode, live, liveReady,
    publicOrigin: publicOrigin || implicitOrigin,
    allowRobots: liveReady && env.CARVEXO_ALLOW_INDEXING === 'true',
    mongoUri: env.MONGODB_URI || '',
    captureInStore: !!env.VERCEL,
    dataDirectory: env.CARVEXO_DATA_DIR || '.data',
    secretKey: env.STRIPE_SECRET_KEY || '',
    publishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    paypal: {
      environment: env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox',
      clientId: env.PAYPAL_CLIENT_ID || '',
      secret: env.PAYPAL_CLIENT_SECRET || '',
      webhookId: env.PAYPAL_WEBHOOK_ID || '',
    },
    mailKey: env.RESEND_API_KEY,
    from: env.CARVEXO_MAIL_FROM || 'Carvexo <carvexo@example.test>',
    ownerEmail: env.CARVEXO_OWNER_EMAIL,
    admin: {
      email: env.CARVEXO_ADMIN_EMAIL || '',
      hash: env.CARVEXO_ADMIN_PASSWORD_HASH || '',
      sessionSecret: env.CARVEXO_ADMIN_SESSION_SECRET || '',
      secure: env.NODE_ENV === 'production' || !!env.VERCEL || publicOrigin.startsWith('https:'),
    },
    cronSecret: env.CRON_SECRET || '',
    tawkWidget: env.CARVEXO_TAWK_WIDGET || '',
    port: Number(env.PORT || 3000),
    trustProxyHops: Number(env.CARVEXO_TRUST_PROXY_HOPS || (env.VERCEL ? 1 : 0)),
  };
}
