// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Small, dependency-free HTTP/validation helpers. */

const { TRUST_PROXY } = require('../config/env');

/**
 * Extracts the real client IP address.
 *
 * X-Forwarded-For is read only when TRUST_PROXY says there is a proxy in front
 * of us (the default — see src/config/env.js). Behind one it is the only way to
 * see past the proxy's own address; in front of one it is a header the client
 * writes itself, and this value decides what the rate limiters count and what
 * the audit log records.
 */
function getClientIp(req) {
  if (TRUST_PROXY !== false) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/** Returns true if the URL uses http or https. */
function isValidHttpUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reduces a URL to a comparison key, so near-identical URLs match as duplicates.
 * Ignores the scheme (http/https serve the same page), a leading "www.", the
 * default port, trailing slashes, and the #fragment. The query string is kept —
 * a different query is usually a different resource.
 * Returns '' for empty input, and a lowercased raw string for unparseable ones.
 */
function normalizeUrlForCompare(urlString) {
  const raw = typeof urlString === 'string' ? urlString.trim() : '';
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw.toLowerCase();
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${port}${path}${u.search}`;
  } catch {
    return raw.toLowerCase();
  }
}

/** Returns true if the value is a valid 3- or 6-digit CSS hex color. */
function isValidHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);
}

/** Parses a Cookie header into an object. Tolerant of malformed input. */
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(part.slice(idx + 1).trim()); }
    catch { /* ignore malformed value */ }
  }
  return out;
}

module.exports = {
  getClientIp, isValidHttpUrl, normalizeUrlForCompare, isValidHexColor, parseCookies,
};
