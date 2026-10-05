// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * User accounts.
 *
 * An address is stored twice: `email` as the person typed it, so it can be
 * shown back to them that way, and `email_key` lowercased, which is what
 * uniqueness and every lookup use. Anything entering this module goes through
 * normalizeEmail first.
 *
 * `password_hash` never leaves here. safeUser() strips it, and every function
 * that returns a row returns a safe one — the hash is handed out only by
 * getUserByEmailWithHash, whose name is the warning.
 */

const { db } = require('../config/db');
const { USER_ROLES: ROLES } = require('../config/constants');

/** Lowercased and trimmed: the form uniqueness and lookups are based on. */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * A rough shape check, not a promise the address exists. Deliberately
 * permissive — anything stricter rejects real addresses, and the only thing
 * this app does with an address is identify a row.
 */
function isValidEmail(email) {
  const value = normalizeEmail(email);
  return value.length > 0 && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Strips the password hash. Use this whenever a row leaves the data layer. */
function safeUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return {
    ...rest,
    is_active:            !!rest.is_active,
    must_change_password: !!rest.must_change_password,
    has_password:         !!password_hash,
  };
}

const SELECT = `
  SELECT id, email, email_key, display_name, role, password_hash, is_active,
         must_change_password, storage_used, storage_quota,
         created_at, updated_at, last_login_at
  FROM users
`;

function getUserById(id) {
  return safeUser(db.prepare(`${SELECT} WHERE id = ?`).get(id));
}

function getUserByEmail(email) {
  return safeUser(db.prepare(`${SELECT} WHERE email_key = ?`).get(normalizeEmail(email)));
}

/**
 * The one function that hands out a password hash, for the login path only.
 * Everything else uses getUserByEmail.
 */
function getUserByEmailWithHash(email) {
  return db.prepare(`${SELECT} WHERE email_key = ?`).get(normalizeEmail(email)) || null;
}

function getAllUsers() {
  return db.prepare(`${SELECT} ORDER BY role ASC, email_key ASC`).all().map(safeUser);
}

/** How many admins could still sign in. Guards the last-admin rules. */
function countActiveAdmins() {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
  ).get().n;
}

/** Accounts that could sign in today. */
function countActiveUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active = 1').get().n;
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

/**
 * Creates an account. `passwordHash` may be null for an account that will only
 * ever sign in through an external identity provider.
 *
 * Throws on a duplicate address — the unique index on email_key is the real
 * guard, so two simultaneous creates cannot both win.
 */
function createUser({ email, displayName = null, passwordHash = null, role = 'user',
                      mustChangePassword = false, storageQuota = null }) {
  const key = normalizeEmail(email);
  const result = db.prepare(`
    INSERT INTO users (email, email_key, display_name, role, password_hash,
                       must_change_password, storage_quota)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(email).trim(), key, displayName || null,
    ROLES.includes(role) ? role : 'user',
    passwordHash, mustChangePassword ? 1 : 0,
    Number.isFinite(storageQuota) ? storageQuota : null,
  );
  return getUserById(result.lastInsertRowid);
}

/** Updates only the fields present in `fields`. Returns the updated row. */
function updateUser(id, fields = {}) {
  const sets   = [];
  const params = [];

  if (fields.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(fields.displayName || null);
  }
  if (fields.role !== undefined && ROLES.includes(fields.role)) {
    sets.push('role = ?');
    params.push(fields.role);
  }
  if (fields.isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(fields.isActive ? 1 : 0);
  }
  if (fields.mustChangePassword !== undefined) {
    sets.push('must_change_password = ?');
    params.push(fields.mustChangePassword ? 1 : 0);
  }
  if (fields.storageQuota !== undefined) {
    sets.push('storage_quota = ?');
    params.push(Number.isFinite(fields.storageQuota) ? fields.storageQuota : null);
  }

  if (sets.length === 0) return getUserById(id);

  sets.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getUserById(id);
}

/**
 * Sets a new password hash. Clears must_change_password, because the change it
 * was asking for has now happened.
 */
function setUserPassword(id, passwordHash) {
  db.prepare(`
    UPDATE users
       SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `).run(passwordHash, id);
  return getUserById(id);
}

function recordLogin(id) {
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

/**
 * Deletes an account and everything hanging off it.
 *
 * No table in this database declares a foreign key, so every cascade is spelled
 * out. Sessions must go first and unconditionally: leaving one behind leaves a
 * working credential pointing at an id that no longer exists, and the next
 * account to take that id inherits it.
 */
function deleteUser(id) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  // Tokens issued *to* this person are void; tokens they issued to others stay,
  // with the trail of who created them broken rather than the row removed.
  db.prepare('DELETE FROM user_tokens WHERE user_id = ?').run(id);
  db.prepare('UPDATE user_tokens SET created_by_user_id = NULL WHERE created_by_user_id = ?').run(id);
  db.prepare('DELETE FROM user_identities WHERE user_id = ?').run(id);
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = {
  normalizeEmail, isValidEmail, safeUser,
  getUserById, getUserByEmail, getUserByEmailWithHash, getAllUsers,
  countActiveAdmins, countActiveUsers, countUsers,
  createUser, updateUser, setUserPassword, recordLogin, deleteUser,
};
