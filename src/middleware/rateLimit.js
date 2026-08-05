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

  // Clean up expired entries periodically to prevent memory growth
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now - entry.windowStart > windowMs) store.delete(ip);
    }
  }, windowMs);

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
 * Returns an object with two methods:
 *   isLimited(req)    → true if this IP has used up its failure budget
 *   recordFailure(req) → increments the counter for this IP
 */
function createFailureRateLimiter(maxFailures, windowMs) {
  const store = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now - entry.windowStart > windowMs) store.delete(ip);
    }
  }, windowMs);

  return {
    isLimited(req) {
      const entry = store.get(getClientIp(req));
      if (!entry) return false;
      if (Date.now() - entry.windowStart > windowMs) return false;
      return entry.count >= maxFailures;
    },
    recordFailure(req) {
      const ip  = getClientIp(req);
      const now = Date.now();
      const entry = store.get(ip);
      if (!entry || now - entry.windowStart > windowMs) {
        store.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count++;
      }
    },
  };
}

const authRateLimit  = createRateLimiter(10, 5 * 60 * 1000); // 10 per 5 minutes (legacy)
const clickRateLimit = createRateLimiter(30, 60 * 1000);      // 30 per minute

const adminAuthLimiter    = createFailureRateLimiter(20, 5 * 60 * 1000);
const publicAuthLimiter   = createFailureRateLimiter(20, 5 * 60 * 1000);
const groupUnlockLimiter  = createFailureRateLimiter(15, 5 * 60 * 1000);
const requestAuthLimiter  = createFailureRateLimiter(15, 5 * 60 * 1000);

// Throttles public link-request submissions so the open endpoint can't be
// spammed into filling the DB. 10 submissions per 10 minutes per IP.
const requestSubmitLimiter = createRateLimiter(10, 10 * 60 * 1000);

module.exports = {
  createRateLimiter,
  createFailureRateLimiter,
  authRateLimit,
  clickRateLimit,
  adminAuthLimiter,
  publicAuthLimiter,
  groupUnlockLimiter,
  requestAuthLimiter,
  requestSubmitLimiter,
};
