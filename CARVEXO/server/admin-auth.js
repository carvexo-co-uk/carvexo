import { createHmac, scrypt, timingSafeEqual, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { RequestError } from './orders.js';

const derive = promisify(scrypt);
const sessionAge = 8 * 60 * 60 * 1000;

function equal(first, second) {
  const a = Buffer.from(first), b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}

export function adminAuth(config) {
  const { email, hash, sessionSecret, secure } = config.admin;
  const enabled = !!email && /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(hash) && sessionSecret.length >= 32;
  const cookie = secure ? '__Host-carvexo_admin' : 'carvexo_admin';
  const options = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  const sign = body => createHmac('sha256', sessionSecret).update(hash).update(email).update(body).digest('hex');

  function valid(req) {
    if (!enabled) return false;
    const token = req.get('Cookie')?.split(/; */).find(value => value.startsWith(cookie + '='))?.slice(cookie.length + 1);
    const match = token?.match(/^(\d{13}\.[a-f0-9]{32})\.([a-f0-9]{64})$/);
    return !!match && Number(match[1].split('.')[0]) > Date.now() && equal(sign(match[1]), match[2]);
  }

  function sameSite(req, _res, next) {
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Carvexo-Admin') !== '1') return next(new RequestError(403, 'Invalid admin request.'));
    next();
  }

  return {
    sameSite,
    session(req, res) { res.json({ authenticated: valid(req), configured: enabled }); },
    async login(req, res) {
      if (!enabled) throw new RequestError(503, 'The owner must configure the admin login.');
      const candidate = req.body?.password;
      const identity = req.body?.email;
      if (typeof candidate !== 'string' || candidate.length > 256 || typeof identity !== 'string'
        || identity.length > 254) throw new RequestError(401, 'Incorrect email or password.');
      const [salt, expected] = hash.split(':');
      const derived = await derive(candidate, salt, 64);
      if (!equal(expected, derived.toString('hex')) || identity.trim().toLowerCase() !== email.toLowerCase()) {
        throw new RequestError(401, 'Incorrect email or password.');
      }
      const body = (Date.now() + sessionAge) + '.' + randomBytes(16).toString('hex');
      res.cookie(cookie, body + '.' + sign(body), { ...options, maxAge: sessionAge }).json({ authenticated: true });
    },
    logout(_req, res) { res.clearCookie(cookie, options).json({ authenticated: false }); },
    require(req, _res, next) {
      if (!valid(req)) return next(new RequestError(401, 'Sign in to continue.'));
      next();
    },
  };
}
