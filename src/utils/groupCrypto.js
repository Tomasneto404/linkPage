/** HMAC signing + verification of per-group "unlocked" cookies. */

const crypto = require('crypto');

const { GROUP_SECRET } = require('../config/secrets');
const { parseCookies } = require('./http');

/**
 * Builds an unlock cookie value: `<expiry-ms>.<hmac>`.
 * The expiry is part of the signed payload, so a client can't bump it.
 */
function signGroupUnlock(groupId, expMs) {
  const hmac = crypto
    .createHmac('sha256', GROUP_SECRET)
    .update(`${groupId}:${expMs}`)
    .digest('hex');
  return `${expMs}.${hmac}`;
}

/**
 * Returns a Map of group_id → expiry-timestamp-ms for every group the request
 * has successfully unlocked and whose token hasn't expired yet.
 */
function getUnlockedGroupExpiries(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const now     = Date.now();
  const out     = new Map();

  for (const [name, value] of Object.entries(cookies)) {
    const match = name.match(/^lp_grp_(\d+)$/);
    if (!match) continue;

    const gid = Number(match[1]);
    const dot = value.indexOf('.');
    if (dot < 0) continue;

    const expMs = Number(value.slice(0, dot));
    const sig   = value.slice(dot + 1);
    if (!Number.isFinite(expMs) || expMs <= now) continue;

    const expected = crypto
      .createHmac('sha256', GROUP_SECRET)
      .update(`${gid}:${expMs}`)
      .digest('hex');

    if (sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      out.set(gid, expMs);
    }
  }
  return out;
}

/** Convenience wrapper that returns just the Set of unlocked IDs. */
function getUnlockedGroupIds(req) {
  return new Set(getUnlockedGroupExpiries(req).keys());
}

module.exports = { signGroupUnlock, getUnlockedGroupExpiries, getUnlockedGroupIds };
