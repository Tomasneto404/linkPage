// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Sessions: minting them, reading them off a request, and ending them.
 *
 * Everything about a session cookie lives here. That is deliberate and worth
 * keeping to: when an external identity provider is added later, its callback
 * calls startSession() exactly like the password login does, and inherits every
 * cookie attribute and expiry rule without restating any of them. If a second
 * place starts writing Set-Cookie, they drift, and the one that is wrong is the
 * one nobody looks at.
 *
 * The token is 32 random bytes in base64url. base64url specifically: cookie
 * values come back through parseCookies, which runs decodeURIComponent inside a
 * try/catch and silently drops anything malformed — a '%' in a token would
 * surface as being randomly signed out, which is a miserable thing to debug.
 *
 * Only sha256(token) is stored. The database therefore holds no credential.
 */

const crypto = require('node:crypto');

const db = require('../models');
const { getClientIp, parseCookies } = require('../utils/http');
const {
  SESSION_COOKIE, SESSION_IDLE_MS, SESSION_ABSOLUTE_MS, SESSION_RENEW_WITHIN_MS,
} = require('../config/constants');

/** SQLite compares DATETIME text lexically, so store the same shape it writes. */
const sqlTime = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

/**
 * True when this request reached us over HTTPS. Reads the forwarded header
 * directly rather than req.secure so the answer does not depend on whether
 * trust proxy happens to be configured the way this deployment needs.
 */
function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/**
 * Starts a session for a user and sets the cookie.
 *
 * `remember` decides only whether the cookie survives closing the browser. The
 * server-side expiry is the same either way, so a forgotten session on a shared
 * machine lapses regardless of what the person ticked.
 */
function startSession(req, res, user, { remember = true } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now   = Date.now();

  db.createSession({
    tokenHash:         hashToken(token),
    userId:            user.id,
    expiresAt:         sqlTime(now + SESSION_IDLE_MS),
    absoluteExpiresAt: sqlTime(now + SESSION_ABSOLUTE_MS),
    ipAddress:         getClientIp(req),
    userAgent:         req.headers['user-agent'] || null,
  });

  setSessionCookie(req, res, token, { remember });
  db.recordLogin(user.id);

  // A good moment to take out the rubbish: someone just proved they are here,
  // and the work is proportional to how long it has been since the last login.
  try { db.deleteExpiredSessions(); } catch { /* never fail a login over this */ }

  return token;
}

/** The only place session cookie attributes are written. */
function setSessionCookie(req, res, token, { remember = true } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  // No Max-Age means the cookie dies with the browser session.
  if (remember) parts.push(`Max-Age=${Math.floor(SESSION_ABSOLUTE_MS / 1000)}`);
  if (isSecureRequest(req)) parts.push('Secure');

  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * The raw token from this request's cookies, or null.
 *
 * Parses the header itself rather than relying on a cookie-parsing middleware
 * having run first — there isn't one, and a helper that quietly depends on
 * middleware order is a helper that works until someone reorders app.js. The
 * parse is memoised on the request, since more than one thing asks per request.
 */
function sessionTokenFrom(req) {
  if (!req._cookies) req._cookies = parseCookies(req.headers.cookie);
  return req._cookies[SESSION_COOKIE] || null;
}

/**
 * Resolves a request to its session, renewing it if it is close to lapsing.
 *
 * Returns null for no cookie, an unknown or expired token, or a disabled
 * account — the caller treats all of those the same way, as "not signed in".
 */
function resolveSession(req, res) {
  const token = sessionTokenFrom(req);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session   = db.findSession(tokenHash);
  if (!session) return null;

  const expiresAt = Date.parse(`${session.expires_at.replace(' ', 'T')}Z`);
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() < SESSION_RENEW_WITHIN_MS) {
    db.touchSession(tokenHash, sqlTime(Date.now() + SESSION_IDLE_MS));
    // Push the browser's copy out too, or a remembered cookie could expire
    // while the session behind it is still perfectly good.
    if (res) setSessionCookie(req, res, token);
  }

  return { ...session, token_hash: tokenHash };
}

/** Ends this request's session. Idempotent. */
function endSession(req, res) {
  const token = sessionTokenFrom(req);
  if (token) db.deleteSession(hashToken(token));
  clearSessionCookie(req, res);
}

module.exports = {
  startSession, resolveSession, endSession,
  setSessionCookie, clearSessionCookie,
  sessionTokenFrom, hashToken,
};
