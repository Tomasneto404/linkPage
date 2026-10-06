// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Invites and password resets.
 *
 * Both are the same thing wearing two hats: a single-use secret, handed to one
 * person, that expires. Keeping them in one table means one expiry rule, one
 * redemption guard and one revoke path, rather than two of each drifting apart
 * until the one nobody tested has a hole in it.
 *
 * As with sessions, only sha256 of the token is stored. The token itself exists
 * for the one response that hands it over and never again — an admin who closes
 * that dialog without copying the link issues a new one.
 *
 * Redemption is a guarded UPDATE rather than a read-then-write. Two people
 * clicking the same invite at the same moment both pass a read-then-write
 * check; only one of them can be the row that reports `changes === 1`.
 */

const crypto = require('node:crypto');

const { db } = require('../config/db');
const { USER_TOKEN_TTL_DAYS } = require('../config/constants');

const KINDS = ['invite', 'reset'];

const hash = token => crypto.createHash('sha256').update(token).digest('hex');

const sqlTime = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Mints a token and stores its hash. Returns the raw token alongside the row —
 * the only moment it is available.
 */
function createUserToken({ kind, label = null, role = 'user', userId = null,
                           createdByUserId = null, ttlDays = USER_TOKEN_TTL_DAYS, ttlMinutes = null }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown token kind: ${kind}`);

  const token = crypto.randomBytes(32).toString('base64url');
  // Minutes, for a link sent by email, which should not outlive the hour it
  // was asked for in; days otherwise, for one an administrator hands over.
  const lifetimeMs = ttlMinutes != null
    ? Math.min(Math.max(Number(ttlMinutes) || 60, 5), 24 * 60) * 60 * 1000
    : Math.min(Math.max(Number(ttlDays) || USER_TOKEN_TTL_DAYS, 1), 30) * 24 * 60 * 60 * 1000;
  const expiresAt = sqlTime(Date.now() + lifetimeMs);

  const result = db.prepare(`
    INSERT INTO user_tokens (kind, token_hash, label, role, user_id, created_by_user_id, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(kind, hash(token), label, role, userId, createdByUserId, expiresAt);

  return { token, id: Number(result.lastInsertRowid), expires_at: expiresAt };
}

/**
 * Looks up a token that is still good for redeeming. Returns null for expired,
 * revoked, already used and never-existed alike — the caller must not tell
 * those apart in its answer, or the endpoint becomes a way to probe them.
 */
function findRedeemableToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const row = db.prepare(`
    SELECT id, kind, label, role, user_id, expires_at
    FROM user_tokens
    WHERE token_hash  = ?
      AND redeemed_at IS NULL
      AND revoked_at  IS NULL
      AND expires_at  > CURRENT_TIMESTAMP
  `).get(hash(token));
  return row || null;
}

/**
 * Claims a token, atomically. Returns the row when this caller got it, null
 * when something else did first.
 *
 * The conditions live in the UPDATE for exactly that reason: checking them in
 * JavaScript and then writing leaves a window in which two callers both passed.
 */
function claimUserToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const tokenHash = hash(token);

  const result = db.prepare(`
    UPDATE user_tokens
       SET redeemed_at = CURRENT_TIMESTAMP
     WHERE token_hash  = ?
       AND redeemed_at IS NULL
       AND revoked_at  IS NULL
       AND expires_at  > CURRENT_TIMESTAMP
  `).run(tokenHash);

  if (result.changes !== 1) return null;
  return db.prepare(`
    SELECT id, kind, label, role, user_id, expires_at FROM user_tokens WHERE token_hash = ?
  `).get(tokenHash);
}

/** Records who the claim ended up creating, or belonging to. */
function setTokenRedeemer(id, userId) {
  db.prepare('UPDATE user_tokens SET redeemed_user_id = ? WHERE id = ?').run(userId, id);
}

/** Hands a claimed token back, when whatever it was claimed for then failed. */
function releaseUserToken(id) {
  db.prepare('UPDATE user_tokens SET redeemed_at = NULL, redeemed_user_id = NULL WHERE id = ?')
    .run(id);
}

/**
 * Marks a token unusable without deleting it, so the record of who issued what
 * survives. A revoked token then fails the claim above, indistinguishably from
 * an expired one.
 */
function revokeUserToken(id) {
  return db.prepare(
    'UPDATE user_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND redeemed_at IS NULL'
  ).run(id);
}

/** Revokes every outstanding reset for one account. */
function revokeResetsForUser(userId) {
  return db.prepare(`
    UPDATE user_tokens SET revoked_at = CURRENT_TIMESTAMP
     WHERE kind = 'reset' AND user_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL
  `).run(userId);
}

function tokenStatus(row) {
  if (row.redeemed_at) return 'redeemed';
  if (row.revoked_at)  return 'revoked';
  return Date.parse(`${row.expires_at.replace(' ', 'T')}Z`) <= Date.now() ? 'expired' : 'pending';
}

/**
 * Tokens of one kind, newest first, with a status worked out for display.
 * Never includes the hash — there is nothing an admin can do with it, and it is
 * the one column worth not putting on a screen.
 */
function getUserTokens(kind) {
  return db.prepare(`
    SELECT t.id, t.kind, t.label, t.role, t.user_id, t.created_at, t.expires_at,
           t.redeemed_at, t.revoked_at, t.redeemed_user_id,
           redeemer.email AS redeemed_email,
           target.email   AS target_email,
           creator.email  AS created_by_email
    FROM user_tokens t
    LEFT JOIN users redeemer ON redeemer.id = t.redeemed_user_id
    LEFT JOIN users target   ON target.id   = t.user_id
    LEFT JOIN users creator  ON creator.id  = t.created_by_user_id
    WHERE t.kind = ?
    ORDER BY t.id DESC
    LIMIT 200
  `).all(kind).map(row => ({ ...row, status: tokenStatus(row) }));
}

function getUserTokenById(id) {
  const row = db.prepare('SELECT * FROM user_tokens WHERE id = ?').get(id);
  if (!row) return null;
  const { token_hash, ...rest } = row;            // never hand the hash out
  return { ...rest, status: tokenStatus(rest) };
}

/** Clears out tokens that can never be used again. */
function deleteExpiredUserTokens() {
  return db.prepare(`
    DELETE FROM user_tokens
    WHERE redeemed_at IS NULL AND expires_at <= datetime('now', '-30 days')
  `).run();
}

module.exports = {
  createUserToken, findRedeemableToken, claimUserToken,
  setTokenRedeemer, releaseUserToken,
  revokeUserToken, revokeResetsForUser,
  getUserTokens, getUserTokenById, deleteExpiredUserTokens,
};
