// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Authentication helpers and guards.
 *
 *  - Admin token is compared with crypto.timingSafeEqual to prevent timing attacks.
 *  - The public password gate is bypassed by a valid admin token.
 */

const crypto = require('crypto');

const { getAdminToken } = require('../config/secrets');
const db = require('../models');

/**
 * Compares a provided token against the admin token in constant time,
 * preventing timing attacks that could reveal how much of the token matched.
 */
function isValidAdminToken(providedToken) {
  if (typeof providedToken !== 'string') return false;
  const adminToken = getAdminToken();
  if (providedToken.length !== adminToken.length) return false;

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const expectedBuffer = Buffer.from(adminToken,  'utf8');
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Verifies a provided password against the stored public password.
 * Returns false if no public password is configured (meaning access is open).
 *
 * The password is stored as a scrypt hash. Values stored before hashing was
 * introduced are plaintext; those are compared in constant time and then
 * transparently re-stored as a hash on the first successful match, so an
 * existing password keeps working with no admin action and no lockout.
 */
function isValidPublicPassword(provided) {
  const stored = db.readSetting('public_password');
  if (!stored) return false;
  if (typeof provided !== 'string') return false;

  // New format: scrypt hash.
  if (stored.startsWith('scrypt$')) {
    return db.verifyScryptHash(stored, provided);
  }

  // Legacy plaintext value — constant-time compare, then upgrade to a hash.
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(stored,   'utf8');

  // If lengths differ we still run the comparison to avoid timing-based length detection
  let ok;
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    ok = false;
  } else {
    ok = crypto.timingSafeEqual(a, b);
  }
  if (ok) db.writeSetting('public_password', db.hashGroupPassword(provided));
  return ok;
}

/** Rejects requests that do not include a valid admin token header. */
function requireAdminToken(req, res, next) {
  if (isValidAdminToken(req.headers['x-admin-token'])) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Rejects requests if a public password is configured and not provided correctly.
 * Admin token always bypasses this check so the admin panel always works.
 */
function requirePublicAuth(req, res, next) {
  // Admin token bypasses the public password gate
  if (isValidAdminToken(req.headers['x-admin-token'])) return next();

  const publicPassword = db.readSetting('public_password');
  if (!publicPassword) return next(); // No password configured — open access

  const provided = req.headers['x-public-password'] || '';
  if (isValidPublicPassword(provided)) return next();

  res.status(401).json({ error: 'Password required' });
}

module.exports = {
  isValidAdminToken,
  isValidPublicPassword,
  requireAdminToken,
  requirePublicAuth,
};
