// Web Push for phone alerts, no dependencies: VAPID (RFC 8292) and aes128gcm payload
// encryption (RFC 8291), using Node's built-in crypto. Subscriptions and keys live in data/push.json.
// Browsers only allow push on https:// pages (or http://localhost).

'use strict';
const crypto = require('crypto');
const path = require('path');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = s => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 8291 §3.4 and RFC 8188: encrypt one record for a subscription's p256dh/auth keys.
function encrypt(payload, p256dh, authSecret) {
  const uaPublic = fromB64u(p256dh), auth = fromB64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const prkKey = hmac(auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// For tests: the receiving side of encrypt().
function decrypt(buf, uaPrivate, uaPublic, authSecret) {
  const salt = buf.subarray(0, 16), idlen = buf[20], asPublic = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const d = crypto.createDecipheriv('aes-128-gcm', hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16), hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const out = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return out.subarray(0, out.lastIndexOf(2)).toString();
}

function createPush({ dataDir, readJSON, writeJSON }) {
  const FILE = path.join(dataDir, 'push.json');
  let db = readJSON(FILE, null);
  if (!db || !db.privateJwk) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    db = { privateJwk: privateKey.export({ format: 'jwk' }), publicJwk: publicKey.export({ format: 'jwk' }), subs: [] };
    writeJSON(FILE, db);
  }
  const privateKey = crypto.createPrivateKey({ key: db.privateJwk, format: 'jwk' });
  const publicKeyRaw = Buffer.concat([Buffer.from([4]), fromB64u(db.publicJwk.x), fromB64u(db.publicJwk.y)]);
  const save = () => writeJSON(FILE, db);

  function vapidHeader(endpoint) {
    const aud = new URL(endpoint).origin;
    const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://github.com/Gamface/Bot-Agents-HQ' }));
    const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${head}.${claims}.${b64u(sig)}, k=${b64u(publicKeyRaw)}`;
  }

  function subscribe(sub, label) {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw Object.assign(new Error('Not a push subscription'), { code: 400 });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, label: String(label || 'Device').slice(0, 80), added: new Date().toISOString() });
    save();
    return { devices: db.subs.length };
  }
  function unsubscribe(endpoint) { db.subs = db.subs.filter(s => s.endpoint !== endpoint); save(); return { devices: db.subs.length }; }

  // Sends to every device; drops subscriptions the push service says are gone.
  async function send(message) {
    const payload = JSON.stringify(message);
    const results = await Promise.all(db.subs.map(async s => {
      try {
        const r = await fetch(s.endpoint, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: vapidHeader(s.endpoint) },
          body: encrypt(payload, s.keys.p256dh, s.keys.auth),
        });
        if (r.status === 404 || r.status === 410) return { gone: s.endpoint };
        if (!r.ok) return { error: `${s.label}: push service said ${r.status} ${(await r.text()).slice(0, 120)}` };
        return { ok: true };
      } catch (err) { return { error: `${s.label}: ${err.message}` }; }
    }));
    const gone = results.filter(r => r.gone).map(r => r.gone);
    if (gone.length) { db.subs = db.subs.filter(s => !gone.includes(s.endpoint)); save(); }
    const errors = results.filter(r => r.error).map(r => r.error);
    errors.forEach(e => console.warn('Push:', e));
    return { sent: results.filter(r => r.ok).length, removed: gone.length, errors };
  }

  return {
    publicKey: b64u(publicKeyRaw), subscribe, unsubscribe, send,
    devices: () => db.subs.map(s => ({ label: s.label, added: s.added, endpoint: s.endpoint })),
  };
}

module.exports = { createPush, encrypt, decrypt };
