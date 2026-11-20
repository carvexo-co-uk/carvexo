import { defaults } from '../shared/site-content.js';
import { RequestError } from './orders.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const formatError = path => new RequestError(400, 'Check the value for ' + path + '.');

export async function getSettings(store, config) {
  const saved = await store.getSettings();
  if (saved) return saved;
  const settings = structuredClone(defaults);
  if (config.ownerEmail) settings.notifications.ownerEmail = config.ownerEmail;
  if (config.mode === 'stripe-test') settings.payment.provider = 'stripe';
  return { ...settings, revision: 0 };
}

function text(value, path) {
  if (typeof value !== 'string' || value.length > 6000) throw formatError(path);
  return value.trim();
}

function list(value, path, item, max = 50) {
  if (!Array.isArray(value) || value.length > max) throw formatError(path);
  return value.map(entry => item(entry, path));
}

function pair(entry, path) {
  if (!Array.isArray(entry) || entry.length !== 2) throw formatError(path);
  return entry.map(value => text(value, path));
}

function contentValue(value, sample, path) {
  if (typeof sample === 'string') return text(value, path);
  if (Array.isArray(sample)) {
    if (path === 'reviews') return list(value, path, (row, label) => ({
      name: text(row?.name, label), quote: text(row?.quote, label),
    }));
    if (path === 'socials') return list(value, path, (row, label) => {
      const name = text(row?.name, label);
      const url = text(row?.url, label);
      if (!name || !URL.canParse(url) || new URL(url).protocol !== 'https:') throw formatError(label);
      return { name, url };
    });
    return list(value, path, Array.isArray(sample[0]) ? pair : text);
  }
  if (!plain(value)) throw formatError(path);
  return Object.fromEntries(Object.entries(sample).map(([key, child]) => [
    key, contentValue(value[key] ?? child, child, key),
  ]));
}

export function validateSettings(input) {
  if (!plain(input) || !Number.isSafeInteger(input.revision) || input.revision < 0
    || !plain(input.content) || !plain(input.notifications) || !plain(input.payment)
    || !Array.isArray(input.packages) || input.packages.length !== defaults.packages.length) {
    throw formatError('settings');
  }
  const packages = defaults.packages.map(({ key }) => {
    const item = input.packages.find(candidate => candidate?.key === key);
    if (!item || !plain(item) || !Number.isInteger(item.amount) || item.amount < 100 || item.amount > 500000
      || !Number.isInteger(item.position) || item.position < 0 || item.position > 99 || typeof item.enabled !== 'boolean') {
      throw formatError(key + ' package price, display order or availability');
    }
    const title = text(item.title, key);
    const features = list(item.features, key + ' included features', text).filter(Boolean);
    if (!title || (item.enabled && !features.length)) throw formatError(key + ' package title and included features');
    return { key, title, description: text(item.description, key), features, position: item.position,
      excluded: list(item.excluded, key + ' excluded features', text).filter(Boolean), enabled: item.enabled, amount: item.amount };
  });
  const notifications = Object.fromEntries(['ownerEmail', 'replyTo'].map(key => {
    const address = text(input.notifications[key], key);
    if (address.length > 254 || !emailPattern.test(address)) throw formatError(key);
    return [key, address];
  }));
  const content = contentValue(input.content, defaults.content, 'content');
  if (content.supportEmail && (content.supportEmail.length > 254 || !emailPattern.test(content.supportEmail))) throw formatError('support email');
  if (content.phone && !/^\+?[0-9 ()-]{5,30}$/.test(content.phone)) throw formatError('phone');
  const { provider, demoEnabled } = input.payment;
  if (!['', 'stripe', 'paypal'].includes(provider) || typeof demoEnabled !== 'boolean') throw formatError('payment method');
  return { revision: input.revision + 1, packages, content, notifications, payment: { provider, demoEnabled } };
}

export function availablePackages(settings) {
  return settings.packages.filter(option => option.enabled).sort((a, b) => a.position - b.position);
}
