// Access token for other devices. Requests from this computer go through without one; requests
// from anywhere else (your phone, another laptop, a tunnel) need the token, either as the
// `mc_token` cookie the dashboard sets when you sign in, or as `Authorization: Bearer <token>`
// for scripts and agents.

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'mc_token';

function createAuth({ dataDir, readJSON, writeJSON }) {
  const FILE = path.join(dataDir, 'auth.json');
  let token = (readJSON(FILE, {}) || {}).token || process.env.MC_TOKEN || null;

  const save = () => writeJSON(FILE, { token, createdAt: new Date().toISOString() });
  function rotate() { token = crypto.randomBytes(24).toString('base64url'); save(); return token; }
  function clear() { token = null; save(); }

  const same = (a, b) => {
    if (!a || !b) return false;
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };

  // A request counts as local only if it comes from this computer and wasn't relayed by a proxy or tunnel.
  function isLocal(req) {
    const ip = req.socket.remoteAddress || '';
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    const relayed = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'tailscale-user-login'].some(h => req.headers[h]);
    return loopback && !relayed;
  }

  function tokenFrom(req) {
    const h = req.headers.authorization || '';
    if (/^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, '').trim();
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
    return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : null;
  }

  // true when the request may use the API
  const allowed = req => isLocal(req) || same(tokenFrom(req), token);

  function cookieHeader(req, value) {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return value
      ? `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`
      : `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  }

  return {
    allowed, isLocal, cookieHeader, rotate, clear,
    get token() { return token; },
    check: t => same(t, token),
    // what the dashboard may know about sign-in, without revealing the token to remote devices
    info: req => ({ local: isLocal(req), tokenSet: !!token, signedIn: same(tokenFrom(req), token) }),
  };
}

module.exports = { createAuth };
