import { fileURLToPath } from 'node:url';
import { waitUntil } from '@vercel/functions';
import { makeApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { drainNotifications } from '../server/mail.js';
import { openOrders } from '../server/store.js';

let app;
async function initialise() {
  const config = loadConfig();
  const store = await openOrders(config);
  return makeApp({
    config, store, staticDirectory: fileURLToPath(new URL('../dist/', import.meta.url)),
    wake(ref) {
      waitUntil(drainNotifications(store, config, ref).catch(error => {
        console.error('CARVEXO email queue:', error.name);
      }));
    },
  });
}

export default async function handler(req, res) {
  app ??= initialise().catch(error => {
    app = undefined;
    throw error;
  });
  let express;
  try { express = await app; }
  catch (error) {
    console.error('CARVEXO initialization failed:', error.name);
    return res.status(503).json({ error: 'CARVEXO service is temporarily unavailable.' });
  }
  return express(req, res);
}
