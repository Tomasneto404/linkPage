// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Password hashing, for every password the app stores.
 *
 * Two formats live here, on purpose.
 *
 *   scrypt$<saltHex>$<hashHex>                  — legacy, Node's default cost
 *   scrypt$N=32768,r=8,p=1$<saltHex>$<hashHex>  — current, cost written down
 *
 * The legacy form is what every group password and the public-page password
 * were written in before accounts existed, and verifying it is not optional:
 * stop reading it and every protected group on every upgraded install locks out
 * silently, with no error anywhere — just "wrong password", forever. Nothing is
 * ever bulk-rehashed; a legacy hash is simply still valid.
 *
 * The current form carries its own parameters, so the cost can be raised later
 * without a flag day: needsRehash() tells a caller when a stored hash was made
 * with something other than today's settings, and the natural moment to act on
 * it is the next successful login, where the plaintext is in hand anyway.
 *
 * Sync vs async is a deliberate split, not an accident of style:
 *
 *   - User logins go through the ASYNC pair at the higher cost. scrypt is
 *     CPU-bound, this process is single-threaded, and login is reachable by
 *     anyone; a ~100 ms synchronous hash there is a one-request denial of
 *     service. A semaphore bounds how many run at once, because each one holds
 *     tens of megabytes.
 *   - Group and public-page gates go through the SYNC pair at the old cost.
 *     They are called from synchronous handlers, they are already rate limited,
 *     and they guard a 30-second unlock rather than an identity.
 */

const crypto = require('node:crypto');

// Today's parameters for a user password. N is the work factor; doubling it
// doubles both time and memory. 2^15 costs roughly 100 ms and 32 MB per hash.
const PARAMS = { N: 32768, r: 8, p: 1 };

const KEY_LEN = 32;
const SALT_LEN = 16;

// Node's default maxmem is 32 MB, which N=2^15 sits exactly on top of — leave
// it alone and scrypt throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS on the very first
// login of a fresh deploy. Ask for enough room to raise N once without editing
// this line again.
const MAX_MEM = 96 * 1024 * 1024;

// How many hashes may be in flight at once. Each holds ~32 MB, and login is an
// unauthenticated endpoint, so this is the ceiling on what a burst can cost.
const MAX_CONCURRENT = 4;

// Past this many waiting, we stop queueing and fail fast: a caller that waits
// forever is worse than one that is told to come back.
const MAX_QUEUED = 32;

// ─── The work queue ───────────────────────────────────────────────────────────

let running = 0;
const queue = [];

function pump() {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

/** Runs `fn` when a slot is free. Rejects immediately if the queue is full. */
function schedule(fn) {
  if (queue.length >= MAX_QUEUED) {
    const err = new Error('Too many password operations in flight');
    err.status = 503;
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

// ─── Format ───────────────────────────────────────────────────────────────────

/** `N=32768,r=8,p=1` → `{ N, r, p }`, or null if it is not that. */
function parseParams(field) {
  const out = {};
  for (const part of field.split(',')) {
    const [key, value] = part.split('=');
    if (!key || value === undefined) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return null;
    out[key] = n;
  }
  return Number.isInteger(out.N) && Number.isInteger(out.r) && Number.isInteger(out.p)
    ? out
    : null;
}

/**
 * Splits a stored hash into the pieces needed to re-derive it.
 * Returns null for anything unreadable — a caller treats that as "no match",
 * never as an error, so a corrupt row cannot crash a login.
 */
function decode(stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return null;
  const parts = stored.split('$');

  // Legacy: scrypt$salt$hash, hashed with whatever Node's defaults were.
  if (parts.length === 3) {
    const [, saltHex, hashHex] = parts;
    if (!saltHex || !hashHex) return null;
    return { params: null, salt: Buffer.from(saltHex, 'hex'), expected: Buffer.from(hashHex, 'hex') };
  }

  // Current: scrypt$N=…,r=…,p=…$salt$hash.
  if (parts.length === 4) {
    const [, paramField, saltHex, hashHex] = parts;
    const params = parseParams(paramField);
    if (!params || !saltHex || !hashHex) return null;
    return { params, salt: Buffer.from(saltHex, 'hex'), expected: Buffer.from(hashHex, 'hex') };
  }

  return null;
}

function encode(salt, hash) {
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$`
       + `${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** scrypt options for a decoded hash: its own parameters, or Node's defaults. */
function optionsFor(params) {
  return params ? { ...params, maxmem: MAX_MEM } : { maxmem: MAX_MEM };
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('A password is required');
  }
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Hashes a user password at today's cost. Asynchronous and queued — see the
 * note at the top of the file about why logins must not hash on the event loop.
 */
function hashPassword(password) {
  try {
    assertPassword(password);
  } catch (err) {
    return Promise.reject(err);
  }

  return schedule(() => new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LEN);
    crypto.scrypt(password, salt, KEY_LEN, optionsFor(PARAMS), (err, hash) => {
      if (err) reject(err);
      else resolve(encode(salt, hash));
    });
  }));
}

/**
 * Verifies a password against a hash in either format. Never throws: anything
 * it cannot read is a non-match, because a corrupt or truncated row should
 * refuse a login, not take the process down.
 */
function verifyPassword(stored, password) {
  if (typeof password !== 'string' || password.length === 0) return Promise.resolve(false);
  const decoded = decode(stored);
  if (!decoded) return Promise.resolve(false);

  return schedule(() => new Promise(resolve => {
    crypto.scrypt(password, decoded.salt, decoded.expected.length, optionsFor(decoded.params),
      (err, actual) => {
        if (err || actual.length !== decoded.expected.length) return resolve(false);
        resolve(crypto.timingSafeEqual(actual, decoded.expected));
      });
  }));
}

/**
 * Hashes at the old cost, in the old format, synchronously.
 *
 * This is what the group and public-page gates use. Keeping them on the cheap
 * parameters is deliberate: they run inside synchronous handlers, and the thing
 * they protect is a short unlock rather than an account.
 */
function hashPasswordSync(password) {
  assertPassword(password);
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** The synchronous counterpart of verifyPassword. Reads both formats too. */
function verifyPasswordSync(stored, password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  const decoded = decode(stored);
  if (!decoded) return false;

  try {
    const actual = crypto.scryptSync(password, decoded.salt, decoded.expected.length,
                                     optionsFor(decoded.params));
    if (actual.length !== decoded.expected.length) return false;
    return crypto.timingSafeEqual(actual, decoded.expected);
  } catch {
    // Parameters a stored hash asks for but this machine will not allocate.
    return false;
  }
}

/**
 * True when a stored hash was not made with today's parameters, so the caller
 * should replace it next time it holds the plaintext. Anything unreadable
 * counts as "yes" — an unreadable hash is exactly what most wants replacing.
 */
function needsRehash(stored) {
  const decoded = decode(stored);
  if (!decoded || !decoded.params) return true;
  const { N, r, p } = decoded.params;
  return N !== PARAMS.N || r !== PARAMS.r || p !== PARAMS.p;
}

module.exports = {
  hashPassword, verifyPassword,
  hashPasswordSync, verifyPasswordSync,
  needsRehash,
  PARAMS,
};
