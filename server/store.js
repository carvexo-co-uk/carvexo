import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mongoose from 'mongoose';

class FileOrders {
  constructor(directory) {
    this.file = join(directory, 'orders.json');
    this.settingsFile = join(directory, 'settings.json');
    this.settingsWrites = Promise.resolve();
    this.ready = mkdir(directory, { recursive: true, mode: 0o700 });
    this.writes = Promise.resolve();
  }

  async all() {
    await this.ready;
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  write(operation) {
    const result = this.writes.then(async () => {
      const orders = await this.all();
      const value = operation(orders);
      await writeFile(this.file + '.tmp', JSON.stringify(orders, null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      return value;
    });
    this.writes = result.catch(() => {});
    return result;
  }

  insert(order) {
    return this.write((orders) => {
      const existing = orders.find((row) => row.attemptId === order.attemptId);
      if (existing) return existing;
      orders.push(order);
      return order;
    });
  }

  async findAttempt(attemptId) {
    return (await this.all()).find(row => row.attemptId === attemptId) ?? null;
  }

  async get(ref) {
    return (await this.all()).find((row) => row.ref === ref) ?? null;
  }

  compareAndSwap(next, revision) {
    return this.write((rows) => {
      const index = rows.findIndex((row) => row.ref === next.ref && row.revision === revision);
      if (index < 0) return false;
      rows[index] = next;
      return true;
    });
  }

  async due(now) {
    return (await this.all()).filter((order) =>
      order.notifications.some((notice) => notice.state === 'queued' && notice.nextAt <= now
        && (!notice.leaseUntil || notice.leaseUntil <= now))).slice(0, 24);
  }

  async list(status, query = '', offset = 0) {
    return (await this.all()).filter((order) => (!status || order.status === status)
      && [order.ref, order.registration, order.registrationKey, order.email].some(value => value?.toLowerCase().includes(query.toLowerCase())))
      .sort((a, b) => b.createdAt - a.createdAt).slice(offset, offset + 51);
  }

  async getSettings() {
    await this.ready;
    try { return JSON.parse(await readFile(this.settingsFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  saveSettings(settings, revision) {
    const write = this.settingsWrites.then(async () => {
      const previous = await this.getSettings();
      if ((previous?.revision ?? 0) !== revision) return false;
      await writeFile(this.settingsFile + '.tmp', JSON.stringify(settings), { mode: 0o600 });
      await rename(this.settingsFile + '.tmp', this.settingsFile);
      return true;
    });
    this.settingsWrites = write.catch(() => {});
    return write;
  }

  async close() {}
}

async function mongodbOrders(uri) {
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 7000 }).asPromise();
  const notice = new mongoose.Schema({
    key: String, state: String, attempts: Number, nextAt: Number,
    leaseUntil: Number, leaseToken: String, sentAt: Number, error: String, payload: mongoose.Schema.Types.Mixed,
  }, { _id: false });
  const schema = new mongoose.Schema({
    ref: { type: String, required: true, unique: true },
    attemptId: { type: String, required: true, unique: true },
    authHash: { type: String, required: true },
    revision: Number, registration: String, registrationKey: String, email: String,
    packageKey: String, packageTitle: String, packageFeatures: [String], amount: Number, currency: String, emailSettings: mongoose.Schema.Types.Mixed,
    status: String, fulfilment: String, sentAt: Number, paidAt: Number, createdAt: Number,
    updatedAt: Number, paymentIntentId: String, paymentMode: String, paymentVersion: Number,
    gatewayOrderId: String, gatewayUrl: String, gatewayCapturedId: String, notifications: [notice],
  }, { versionKey: false });
  schema.index({ 'notifications.state': 1, 'notifications.nextAt': 1 });
  schema.index({ status: 1, createdAt: -1 });
  const Order = connection.model('Order', schema);
  const Settings = connection.model('SiteSettings', new mongoose.Schema({
    _id: String, revision: Number, packages: mongoose.Schema.Types.Mixed,
    payment: mongoose.Schema.Types.Mixed, notifications: mongoose.Schema.Types.Mixed, content: mongoose.Schema.Types.Mixed,
  }, { versionKey: false }));
  await Order.init();
  const withoutId = { _id: 0 };
  return {
    async insert(order) {
      try {
        await Order.create(order);
        return order;
      } catch (error) {
        if (error.code !== 11000) throw error;
        const existing = await Order.findOne({ attemptId: order.attemptId }, withoutId).lean();
        if (!existing) throw error;
        return existing;
      }
    },
    findAttempt(attemptId) {
      return Order.findOne({ attemptId }, withoutId).lean();
    },
    get(ref) {
      return Order.findOne({ ref }, withoutId).lean();
    },
    async compareAndSwap(next, revision) {
      const result = await Order.updateOne({ ref: next.ref, revision }, { $set: next });
      return result.modifiedCount === 1;
    },
    due(now) {
      return Order.find({
        notifications: { $elemMatch: { state: 'queued', nextAt: { $lte: now }, leaseUntil: { $lte: now } } },
      }, withoutId).limit(24).lean();
    },
    list(status, query = '', offset = 0) {
      const search = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      return Order.find({
        ...(status ? { status } : {}),
        ...(query ? { $or: ['ref', 'registration', 'registrationKey', 'email'].map(key => ({ [key]: search })) } : {}),
      }, withoutId).sort({ createdAt: -1 }).skip(offset).limit(51).lean();
    },
    getSettings() {
      return Settings.findById('site', withoutId).lean();
    },
    async saveSettings(settings, revision) {
      if (revision === 0) {
        try { await Settings.create({ _id: 'site', ...settings }); }
        catch (error) { if (error.code === 11000) return false; throw error; }
        return true;
      }
      const result = await Settings.updateOne({ _id: 'site', revision }, { $set: settings });
      return result.modifiedCount === 1;
    },
    close() {
      return connection.close();
    },
  };
}

export async function openOrders(config) {
  return config.mongoUri ? mongodbOrders(config.mongoUri) : new FileOrders(config.dataDirectory);
}

export async function updateOrder(store, ref, change) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const current = await store.get(ref);
    if (!current) return null;
    const next = change(structuredClone(current));
    if (!next) return current;
    next.revision = current.revision + 1;
    next.updatedAt = Date.now();
    if (await store.compareAndSwap(next, current.revision)) return next;
  }
  throw new Error('Concurrent update, please retry.');
}
