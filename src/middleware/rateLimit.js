// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Rate limiting: sliding-window request limiters and failure-only limiters for
 * auth endpoints. Prevents brute-force on auth and click spam.
 */

const { getClientIp } = require('../utils/http');

/**
 * Creates a rate limiter middleware using a sliding window per IP.
 * @param {number} maxRequests - Maximum requests allowed per window
 * @param {number} windowMs    - Window duration in milliseconds
 */
function createRateLimiter(maxRequests, windowMs) {
  const store = new Map(); // ip → { count, windowStart }

  // Clean up expired entries periodically to prevent memory growth.
  // unref'd: this only evicts cache entries, so it must never be the reason a
  // process stays alive (short-lived scripts and the test runner would hang).
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now - entry.windowStart > windowMs) store.delete(ip);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const ip  = getClientIp(req);
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    }

    entry.count++;
    return next();
  };
}

/**
 * Failure-only rate limiter for auth endpoints.
 *
 * Successful verifications must not count toward the budget — otherwise a
 * legitimate admin refreshing the page a few times exhausts the limit and
 * gets locked out of their own session. Brute-force attempts still trip the
 * limit since every wrong token is a failure.
 *
 * Counts live in the database (the auth_throttle table), not in memory, so a
 * restart does not hand anyone a fresh budget. Each limiter has a name, which
 * prefixes its keys there.
 *
 * By default a limiter counts per client address. `keyOf(req)` counts by
 * something else instead — the account being signed in to, say — and may
 * return '' to say "nothing to count", which is never limited.
 *
 *   isLimited(req)     → true if this key has used up its failure budget
 *   recordFailure(req) → counts one failure against it
 *   clear(req)         → forgets it, for after a success
 */
function createFailureRateLimiter(name, maxFailures, windowMs, { keyOf = getClientIp } = {}) {
  // Required on first use rather than at load: this module is loaded by code
  // that has no reason to open the database until someone actually signs in.
  const store = () => require('../models/throttle');
  const keyFor = req => {
    const k = keyOf(req);
    return k ? `${name}:${k}` : '';
  };

  return {
    isLimited(req) {
      const key = keyFor(req);
      if (!key) return false;
      const entry = store().getThrottle(key);
      if (!entry) return false;
      if (Date.now() - entry.window_start > windowMs) return false;
      return entry.count >= maxFailures;
    },
    recordFailure(req) {
      const key = keyFor(req);
      if (!key) return;
      const now = Date.now();
      store().recordThrottleFailure(key, windowMs, now);
      // Tidying as failures arrive keeps the table to what is live, with no
      // timer to hold a process open. The longest window here is 15 minutes.
      store().deleteStaleThrottles(STALE_AFTER_MS, now);
    },
    clear(req) {
      const key = keyFor(req);
      if (key) store().clearThrottle(key);
    },
  };
}

// Anything older than this is past every limiter's window.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * The account a sign-in names, folded the way addresses are matched. Whether
 * such an account exists plays no part: an address with no account is limited
 * exactly like one with, so the limit says nothing about which ones are real.
 */
function loginAccountKey(req) {
  const email = req.body?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 320) : '';
}

const clickRateLimit = createRateLimiter(30, 60 * 1000);      // 30 per minute

const adminAuthLimiter    = createFailureRateLimiter('admin-token',    20, 5 * 60 * 1000);
const publicAuthLimiter   = createFailureRateLimiter('public-password', 20, 5 * 60 * 1000);
const groupUnlockLimiter  = createFailureRateLimiter('group-unlock',   15, 5 * 60 * 1000);
const requestAuthLimiter  = createFailureRateLimiter('request-password', 15, 5 * 60 * 1000);

// Signing in. Tighter than the shared-secret gates above: a password guessed
// here is an account rather than a page, and a legitimate person gets it right
// in two or three tries.
const loginLimiter          = createFailureRateLimiter('login-ip',        10, 15 * 60 * 1000);
const passwordChangeLimiter = createFailureRateLimiter('password-change',  5, 15 * 60 * 1000);
const userTokenLimiter      = createFailureRateLimiter('user-token',      10, 15 * 60 * 1000);

// The same sign-in, counted by the account it names rather than the address it
// comes from — what stops a guess spread across many addresses. Looser than
// the per-address budget, since everyone trying that account shares it: the
// cost is that a stranger can hold an account's password sign-in shut for up
// to fifteen minutes at a time. The window then lapses on its own, and a
// successful sign-in clears it.
const loginAccountLimiter = createFailureRateLimiter('login-account', 20, 15 * 60 * 1000,
                                                     { keyOf: loginAccountKey });

// Trips to the identity provider and back. Each start writes a pending row and
// each callback may reach out to the provider, so neither is free to repeat.
const oidcLimiter = createRateLimiter(30, 60 * 1000);

// Throttles public link-request submissions so the open endpoint can't be
// spammed into filling the DB. 10 submissions per 10 minutes per IP.
const requestSubmitLimiter = createRateLimiter(10, 10 * 60 * 1000);

module.exports = {
  createRateLimiter,
  createFailureRateLimiter,
  clickRateLimit,
  adminAuthLimiter,
  publicAuthLimiter,
  groupUnlockLimiter,
  requestAuthLimiter,
  loginLimiter,
  loginAccountLimiter,
  passwordChangeLimiter,
  userTokenLimiter,
  requestSubmitLimiter,
  oidcLimiter,
};
