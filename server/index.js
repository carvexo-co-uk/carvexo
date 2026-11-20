import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openOrders } from './store.js';
import { makeApp } from './app.js';
import { startOutbox } from './mail.js';

const config = loadConfig();
const store = await openOrders(config);
const app = makeApp({
  config,
  store,
  wake: startOutbox(store, config),
  staticDirectory: fileURLToPath(new URL('../dist/', import.meta.url)),
});
const server = app.listen(config.port, () =>
  console.log('Carvexo API ready on port ' + config.port + ' (' + config.mode + ').'));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(async () => {
      await store.close();
      process.exit(0);
    });
  });
}
