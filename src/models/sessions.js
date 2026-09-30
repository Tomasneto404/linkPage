// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Sessions.
 *
 * A row is keyed by sha256 of the cookie value, so what is stored is not a
 * usable credential: a leaked copy of links.db gives an attacker hashes, and
 * nothing to send. The raw value exists only in the cookie and in memory for
 * the moment it is created. Hashing happens in sessionService; this module
 * deals in hashes and never sees a token.
 *
 * Expiry is two columns. `expires_at` slides forward while the session is in
 * use; `absolute_expires_at` never moves, so a session cannot be kept alive
 * indefinitely by touching it.
 *
 * findSession joins users, so role and is_active are read fresh on every
 * request. That is what makes a demotion or a disable take effect immediately
 * without hunting down and deleting that person's sessions.
 */

const { db } = require('../config/db');

/**
 * Looks up a live session. Returns null when it does not exist, either expiry
 * has passed, or the account behind it has been disabled — the caller cannot
 * tell those apart, and does not need to.
 */
function findSession(tokenHash) {
  const row = db.prepare(`
    SELECT s.token_hash, s.user_id, s.created_at, s.last_seen_at,
           s.expires_at, s.absolute_expires_at,
           u.email, u.display_name, u.role, u.must_change_password
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at          > CURRENT_TIMESTAMP
      AND s.absolute_expires_at > CURRENT_TIMESTAMP
      AND u.is_active = 1
  `).get(tokenHash);
  return row || null;
}

function createSession({ tokenHash, userId, expiresAt, absoluteExpiresAt,
                         ipAddress = null, userAgent = null }) {
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, absolute_expires_at,
                          ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, absoluteExpiresAt, ipAddress, userAgent);
  return tokenHash;
}

/**
 * Pushes the idle expiry out, never past the absolute one.
 *
 * The caller decides when this is worth doing — see sessionService, which only
 * calls it once a session is close to lapsing. Every request would otherwise
 * mean a write.
 */
function touchSession(tokenHash, expiresAt) {
  db.prepare(`
    UPDATE sessions
       SET last_seen_at = CURRENT_TIMESTAMP,
           expires_at   = MIN(?, absolute_expires_at)
     WHERE token_hash = ?
  `).run(expiresAt, tokenHash);
}

function deleteSession(tokenHash) {
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/**
 * Signs a user out everywhere, optionally sparing the session making the
 * request — which is what a password change wants: every other device out,
 * this one still working.
 */
function deleteSessionsForUser(userId, exceptTokenHash = null) {
  return exceptTokenHash
    ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
        .run(userId, exceptTokenHash)
    : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** A person's own sessions, newest first, for a "where am I signed in" list. */
function getSessionsForUser(userId) {
  return db.prepare(`
    SELECT token_hash, created_at, last_seen_at, expires_at, ip_address, user_agent
    FROM sessions
    WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
                      AND absolute_expires_at > CURRENT_TIMESTAMP
    ORDER BY last_seen_at DESC
  `).all(userId);
}

function countSessionsForUser(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM sessions
    WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP
  `).get(userId).n;
}

/** Drops everything lapsed. Cheap, and the table is never read for history. */
function deleteExpiredSessions() {
  return db.prepare(`
    DELETE FROM sessions
    WHERE expires_at <= CURRENT_TIMESTAMP OR absolute_expires_at <= CURRENT_TIMESTAMP
  `).run();
}

module.exports = {
  findSession, createSession, touchSession,
  deleteSession, deleteSessionsForUser,
  getSessionsForUser, countSessionsForUser, deleteExpiredSessions,
};
