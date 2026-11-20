import { formatPrice } from '../shared/catalog.js';
import { loadConfig } from '../server/config.js';
import { markSent } from '../server/orders.js';
import { openOrders } from '../server/store.js';

const [action, argument] = process.argv.slice(2);
if (!['list', 'mark-sent'].includes(action)) {
  console.error('Usage: node --env-file-if-exists=.env scripts/orders.mjs list [pending|processing|failed|paid]');
  console.error('       node --env-file-if-exists=.env scripts/orders.mjs mark-sent CVX-ORDERREFERENCE');
  process.exit(1);
}
const store = await openOrders(loadConfig());
try {
  if (action === 'list') {
    console.table((await store.list(argument)).map((order) => ({
      order: order.ref, reg: order.registration, email: order.email, package: order.packageTitle,
      total: formatPrice(order.amount), payment: order.status, fulfilment: order.fulfilment,
      emailAlerts: order.notifications.map((notice) => notice.key + '=' + notice.state).join(', '),
      placedAt: new Date(order.createdAt).toISOString(),
    })));
  } else {
    const order = await markSent(store, argument ?? '');
    console.log(order.ref + ' · report marked sent.');
  }
} finally {
  await store.close();
}
