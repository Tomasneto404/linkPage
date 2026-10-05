// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Signing in and out, and the two older shared-secret checks. */

const { divider } = require('../config/env');
const { rotateAdminToken } = require('../config/secrets');
const db = require('../models');
const { isValidAdminToken, isValidPublicPassword } = require('../middleware/auth');
const { adminAuthLimiter, publicAuthLimiter,
        loginLimiter, loginAccountLimiter, passwordChangeLimiter } = require('../middleware/rateLimit');
const { startSession, endSession, hashToken, sessionTokenFrom } =
  require('../services/sessionService');
const { authenticateLocal, passwordProblem, publicUser, listProviders } =
  require('../services/authService');
const { hashPassword, verifyPassword } = require('../utils/password');
const { recordAuditNow } = require('../services/auditService');
const { forgetInitialPassword } = require('../services/seedAdminUser');

function verify(req, res) {
  if (adminAuthLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  if (isValidAdminToken(token)) {
    return res.json({ valid: true });
  }
  adminAuthLimiter.recordFailure(req);
  res.json({ valid: false });
}

function verifyPublic(req, res) {
  if (publicAuthLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const stored   = db.readSetting('public_password');

  if (!stored) {
    // No password configured — always valid
    return res.json({ valid: true });
  }

  if (isValidPublicPassword(password)) {
    return res.json({ valid: true });
  }
  publicAuthLimiter.recordFailure(req);
  res.json({ valid: false });
}

/** Generates a new admin token, saves it to disk, and returns it. */
function rotateToken(req, res) {
  const newToken = rotateAdminToken();

  console.log(`\n┌${divider}┐`);
  console.log(`│  🔑 Token rotated! New token: ${newToken}`);
  console.log(`└${divider}┘\n`);

  res.json({ token: newToken });
}

// ─── Signing in ───────────────────────────────────────────────────────────────

/**
 * Exchanges an email and password for a session cookie.
 *
 * Every failure answers the same way. Saying "no such account" would let anyone
 * ask this endpoint which addresses have accounts here, and saying "your
 * account is disabled" tells a stranger they found a real one.
 */
async function login(req, res) {
  // The same answer for both limits, and for an address with no account
  // behind it: which one tripped is not the caller's business.
  if (loginLimiter.isLimited(req) || loginAccountLimiter.isLimited(req)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const email    = typeof req.body?.email === 'string' ? req.body.email : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const remember = req.body?.remember !== false;

  const user = await authenticateLocal(email, password);
  if (!user) {
    loginLimiter.recordFailure(req);
    loginAccountLimiter.recordFailure(req);
    // Logged here rather than by the middleware, which only records requests
    // that succeeded — and a failed sign-in is the one failure worth keeping.
    recordAuditNow(req, {
      action:  'auth.login_failed',
      summary: `Failed sign-in for ${email || '(no address given)'}`,
    });
    return res.status(401).json({ error: 'Wrong email or password', code: 'bad_credentials' });
  }

  // The account's count goes; the address's stays. A success proves this
  // person knows this password, not that the address is not also guessing others.
  loginAccountLimiter.clear(req);
  startSession(req, res, user, { remember });

  // The request arrived anonymous, which is what attachUser recorded. By the
  // time it finishes — which is when the audit entry is written — it is this
  // person's request, and the log should say so rather than "public".
  req.user = { ...publicUser(user), via: 'session' };
  req._auditSummary = `${user.email} signed in`;

  res.json({ user: publicUser(user) });
}

/** Ends this session. Answers the same whether or not there was one. */
function logout(req, res) {
  if (req.user?.via === 'session') req._auditSummary = `${req.user.email} signed out`;
  endSession(req, res);
  res.json({ ok: true });
}

/** Ends every other session this person has, and keeps the current one. */
function logoutEverywhere(req, res) {
  const keep = sessionTokenFrom(req);
  const result = db.deleteSessionsForUser(req.user.id, keep ? hashToken(keep) : null);
  req._auditSummary = `${req.user.email} signed out ${result.changes} other session(s)`;
  res.json({ ok: true, ended: result.changes });
}

/**
 * Who the caller is.
 *
 * Answers 200 with a null user when nobody is signed in, rather than 401. Every
 * page load asks this, including anonymous ones, and a 401 there would put an
 * error in the console of a page that is working perfectly.
 */
function me(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    authenticated: !!req.user,
    user:          publicUser(req.user),
    via:           req.user?.via || null,
    providers:     listProviders(),
  });
}

/** The ways to sign in, so the sign-in page can render its buttons. */
function providers(req, res) {
  res.json({ providers: listProviders() });
}

/** This person's own live sessions, so they can see where they are signed in. */
function listSessions(req, res) {
  const current = sessionTokenFrom(req);
  const currentHash = current ? hashToken(current) : null;

  res.json({
    sessions: db.getSessionsForUser(req.user.id).map(s => ({
      // A prefix, not the hash: enough to name one in a "sign this out" call,
      // not enough to be worth stealing.
      id:           s.token_hash.slice(0, 16),
      created_at:   s.created_at,
      last_seen_at: s.last_seen_at,
      expires_at:   s.expires_at,
      ip_address:   s.ip_address,
      user_agent:   s.user_agent,
      current:      s.token_hash === currentHash,
    })),
  });
}

/** Signs out one of this person's own sessions, by the id the list gave. */
function revokeSession(req, res) {
  const id = String(req.params.id || '');
  const match = db.getSessionsForUser(req.user.id).find(s => s.token_hash.startsWith(id));
  if (!match) return res.status(404).json({ error: 'No such session' });

  db.deleteSession(match.token_hash);
  // Signing out the session making the request means the cookie has to go too.
  if (match.token_hash === hashToken(sessionTokenFrom(req) || '')) endSession(req, res);
  res.json({ ok: true });
}

/**
 * Changes your own password.
 *
 * Every other session is ended. Changing a password is what someone does when
 * they think it is known, and leaving the sessions it opened still working
 * would make the change mostly ceremonial.
 */
async function changePassword(req, res) {
  if (passwordChangeLimiter.isLimited(req)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  if (req.user.via !== 'session') {
    return res.status(400).json({ error: 'The admin token has no password to change' });
  }

  const current = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
  const next    = req.body?.new_password;

  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: problem });

  const row = db.getUserByEmailWithHash(req.user.email);
  // An account with no password of its own — provisioned elsewhere — has
  // nothing to check the current one against.
  if (!row?.password_hash || !await verifyPassword(row.password_hash, current)) {
    passwordChangeLimiter.recordFailure(req);
    return res.status(401).json({ error: 'Current password is wrong', code: 'bad_credentials' });
  }

  db.setUserPassword(row.id, await hashPassword(next));
  // The first-run password is no longer this account's password, so the file
  // holding it is now only a liability.
  forgetInitialPassword();
  const keep = sessionTokenFrom(req);
  db.deleteSessionsForUser(row.id, keep ? hashToken(keep) : null);

  req._auditSummary = `${row.email} changed their password`;
  res.json({ ok: true });
}

module.exports = {
  verify, verifyPublic, rotateToken,
  login, logout, logoutEverywhere, me, providers,
  listSessions, revokeSession, changePassword,
};
