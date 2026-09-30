// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Who is making this request, and are they allowed to.
 *
 * Two kinds of principal reach the server:
 *
 *   - A signed-in user, identified by a session cookie. Has an id, a role, and
 *     an account that can be disabled.
 *   - The admin token, in the X-Admin-Token header. Has no id and no account.
 *     It predates accounts entirely and stays as the way back in when nobody
 *     can sign in — a lost password, an empty users table, a fresh container.
 *
 * attachUser resolves whichever is present onto req.user and never rejects;
 * the guards below decide what to do about it. Session first, so that an admin
 * who is signed in *and* has a token in their browser is recorded in the audit
 * log as themselves rather than as the token.
 */

const crypto = require('crypto');

const { getAdminToken } = require('../config/secrets');
const db = require('../models');
const { resolveSession } = require('../services/sessionService');

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

/**
 * Resolves the caller onto req.user. Global, and never rejects — a request
 * with no credentials is simply anonymous.
 *
 * Costs nothing when there is no session cookie and no token header, which is
 * the common case on a public page.
 */
function attachUser(req, res, next) {
  req.user = null;
  req.isAdminToken = false;

  const session = resolveSession(req, res);
  if (session) {
    req.session = session;
    req.user = {
      id:                   session.user_id,
      email:                session.email,
      display_name:         session.display_name,
      role:                 session.role,
      must_change_password: !!session.must_change_password,
      via:                  'session',
    };
    return next();
  }

  if (isValidAdminToken(req.headers['x-admin-token'])) {
    req.isAdminToken = true;
    // No id: the token is not an account. Anything that records or compares
    // "who" has to cope with that, which is why it is null rather than 0.
    req.user = { id: null, email: null, display_name: null, role: 'admin', via: 'token' };
  }

  next();
}

/** Rejects anyone who is not signed in. */
function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Sign in required', code: 'auth_required' });
}

/**
 * Rejects anyone who is not an administrator, by either route: an admin
 * account, or the admin token.
 */
function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(401).json({
    error: 'Unauthorized',
    code:  req.user ? 'forbidden' : 'auth_required',
  });
}

/**
 * Rejects requests that do not include a valid admin token header.
 *
 * Kept for routes that must be reachable *only* by the token, and kept
 * separate from requireAdmin so that "this needs the break-glass credential"
 * is greppable rather than implied.
 */
function requireAdminToken(req, res, next) {
  if (isValidAdminToken(req.headers['x-admin-token'])) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Marks a route whose *response* depends on who is asking, without requiring
 * anybody. attachUser has already done the work; this is documentation that
 * the route reads req.user, and it is what the API description keys on to say
 * so. Leave it on such routes even though it does nothing.
 */
function optionalAuth(req, res, next) {
  next();
}

/**
 * Rejects requests if a public password is configured and not provided correctly.
 *
 * Anyone attachUser recognised — a signed-in user, or the admin token — is
 * already past it, so the admin panel always works and a member is never asked
 * for the password on top of their own.
 */
function requirePublicAuth(req, res, next) {
  // Anyone who has already proved who they are is past this gate: the public
  // password exists to keep strangers out, and they are not a stranger.
  if (req.user) return next();

  const publicPassword = db.readSetting('public_password');
  if (!publicPassword) return next(); // No password configured — open access

  const provided = req.headers['x-public-password'] || '';
  if (isValidPublicPassword(provided)) return next();

  res.status(401).json({ error: 'Password required' });
}

module.exports = {
  isValidAdminToken,
  isValidPublicPassword,
  attachUser,
  requireAuth,
  requireAdmin,
  requireAdminToken,
  requirePublicAuth,
  optionalAuth,
};
