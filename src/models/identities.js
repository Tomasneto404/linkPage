// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Accounts as an identity provider knows them, and sign-ins on their way there.
 *
 * An identity is (provider, subject) → user. `provider` is the issuer URL, not
 * a name: a subject is only unique within the issuer that minted it, so an
 * instance that moves to a different provider must not let the new one's
 * subject "1234" sign in as whoever the old one's "1234" was.
 */

const { db } = require('../config/db');

function getIdentity(provider, subject) {
  return db.prepare(
    'SELECT id, user_id, provider, subject, email, created_at, last_login_at '
  + 'FROM user_identities WHERE provider = ? AND subject = ?'
  ).get(provider, subject) || null;
}

function getIdentitiesForUser(userId) {
  return db.prepare(
    'SELECT id, provider, subject, email, created_at, last_login_at '
  + 'FROM user_identities WHERE user_id = ? ORDER BY id'
  ).all(userId);
}

/** Which accounts have any identity at all, for the admin list. One query. */
function getUserIdsWithIdentities() {
  return new Set(db.prepare('SELECT DISTINCT user_id FROM user_identities').all().map(r => r.user_id));
}

function linkIdentity({ userId, provider, subject, email = null }) {
  db.prepare(
    'INSERT INTO user_identities (user_id, provider, subject, email, last_login_at) '
  + 'VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
  ).run(userId, provider, subject, email);
  return getIdentity(provider, subject);
}

function touchIdentity(id, email = null) {
  db.prepare(
    'UPDATE user_identities SET last_login_at = CURRENT_TIMESTAMP, email = COALESCE(?, email) WHERE id = ?'
  ).run(email, id);
}

/** Unlinks every identity an account has. The account itself stays. */
function deleteIdentitiesForUser(userId) {
  return db.prepare('DELETE FROM user_identities WHERE user_id = ?').run(userId).changes;
}

// ─── Sign-ins in flight ───────────────────────────────────────────────────────

function createOidcLogin({ stateHash, nonce, codeVerifier, redirectUri, nextPath,
                          linkUserId = null, now = Date.now() }) {
  db.prepare(
    'INSERT INTO oidc_logins (state_hash, nonce, code_verifier, redirect_uri, next_path, link_user_id, created_at) '
  + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(stateHash, nonce, codeVerifier, redirectUri, nextPath || null, linkUserId, now);
}

/**
 * Takes a pending sign-in out, so it can be used once. A DELETE … RETURNING is
 * the single-use guard: two callbacks racing on the same state cannot both get
 * the row.
 */
function takeOidcLogin(stateHash, maxAgeMs, now = Date.now()) {
  const row = db.prepare(
    'DELETE FROM oidc_logins WHERE state_hash = ? '
  + 'RETURNING nonce, code_verifier, redirect_uri, next_path, link_user_id, created_at'
  ).get(stateHash);
  if (!row || now - row.created_at > maxAgeMs) return null;
  return row;
}

function deleteStaleOidcLogins(maxAgeMs, now = Date.now()) {
  db.prepare('DELETE FROM oidc_logins WHERE created_at < ?').run(now - maxAgeMs);
}

module.exports = {
  getIdentity, getIdentitiesForUser, getUserIdsWithIdentities,
  linkIdentity, touchIdentity, deleteIdentitiesForUser,
  createOidcLogin, takeOidcLogin, deleteStaleOidcLogins,
};
