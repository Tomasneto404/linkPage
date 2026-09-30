// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Refuses state-changing requests that another site made on a visitor's behalf.
 *
 * This matters now in a way it did not before. Authentication used to be a
 * header the browser never sends on its own, so another site could not forge an
 * authenticated request no matter what it did. A session cookie *is* sent on
 * its own, on every request to this origin, including ones a different site
 * caused — so without a check, a page anywhere could submit a form here and it
 * would arrive fully authenticated.
 *
 * The check is the origin of the request, not a token:
 *
 *   - Nothing to fetch, refresh, embed in forms, or keep in sync with a page
 *     that was cached before the token rotated.
 *   - It works for multipart uploads, where a token has to be threaded through
 *     FormData by hand at every call site.
 *   - It covers routes written before anyone thought about CSRF, including the
 *     group unlock, which has been setting a cookie with no defence at all.
 *
 * SameSite=Lax on the cookie is a second layer rather than the only one: it is
 * enforced by the browser, not by us, and it does not distinguish one host on a
 * domain from another.
 */

const { isValidAdminToken } = require('./auth');
const { parseCookies } = require('../utils/http');
const { SESSION_COOKIE } = require('../config/constants');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The host this request was addressed to, honouring a proxy when trusted. */
function expectedHost(req) {
  // req.hostname already accounts for X-Forwarded-Host under `trust proxy`,
  // but it drops the port, and Origin carries one. Compare both forms.
  return [req.headers.host, req.hostname].filter(Boolean);
}

function originHost(value) {
  try { return new URL(value).host; } catch { return null; }
}

function verifySameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();

  // The admin token is not a cookie: a page on another site cannot set the
  // header without a preflight this would refuse anyway. Exempt explicitly so
  // scripts and `curl` keep working, and so an operator behind a proxy that
  // rewrites Origin still has a way in.
  if (isValidAdminToken(req.headers['x-admin-token'])) return next();

  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    const host = originHost(origin);
    if (host && expectedHost(req).includes(host)) return next();
    return refuse(res);
  }

  // Firefox and Safari omit Origin on some same-origin requests. Fetch metadata
  // answers the same question when it is present.
  const site = req.headers['sec-fetch-site'];
  if (site) {
    if (site === 'same-origin' || site === 'none') return next();
    return refuse(res);
  }

  // Neither header: not a browser, or one too old to send either. Such a client
  // cannot be carrying a cookie it did not set deliberately, so the only thing
  // worth refusing is a request that arrives *with* a session cookie and no
  // evidence of where it came from.
  const cookies = req._cookies || parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) return refuse(res);

  next();
}

function refuse(res) {
  res.status(403).json({ error: 'Cross-site request blocked', code: 'cross_site' });
}

module.exports = { verifySameOrigin };
