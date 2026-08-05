// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Small, dependency-free HTTP/validation helpers. */

/**
 * Extracts the real client IP address.
 * Checks X-Forwarded-For first so it works correctly behind reverse proxies.
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
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

module.exports = { getClientIp, isValidHttpUrl, isValidHexColor, parseCookies };
