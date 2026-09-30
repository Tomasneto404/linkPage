// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Environment configuration and shared paths.
 *
 * Every environment variable the app reads is resolved here once, with its
 * default, so no other module re-reads process.env or recomputes a path (which
 * previously drifted between server.js and database.js).
 */

const path = require('path');
const fs   = require('fs');

const { version: CURRENT_VERSION } = require('../../package.json');

const PORT = process.env.PORT || 3000;

const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, '..', '..', 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, '..', '..', 'public');

// Where to look for new releases. Overridable so forks/private mirrors can
// point at their own repo.
const RELEASES_REPO = process.env.RELEASES_REPO || 'Tomasneto404/linkPage';

/**
 * How far to trust X-Forwarded-For when working out who a request came from.
 *
 * Defaults to one hop, because the shipped docker-compose puts the app behind
 * a reverse proxy and that is how nearly every install runs — and because it
 * is what the app already did, unconditionally, before this knob existed.
 *
 * It matters more than it looks: the client IP is what the rate limiters count
 * and what the audit log records. An instance exposed directly to the internet
 * should set TRUST_PROXY=0, or a caller can spoof the header and both of those
 * become whatever the caller says they are.
 *
 * Accepts 0/false to trust nothing, a hop count, true, or any value Express
 * itself understands ("loopback", a subnet list).
 */
function parseTrustProxy(raw) {
  if (raw === undefined || raw === '') return 1;
  const value = String(raw).trim().toLowerCase();
  if (value === '0' || value === 'false' || value === 'off' || value === 'no') return false;
  if (value === 'true' || value === 'on' || value === 'yes') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return raw;                       // a subnet list or a named preset
}
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const divider = '─'.repeat(54);

module.exports = {
  PORT,
  DATA_DIR,
  UPLOADS_DIR,
  PUBLIC_DIR,
  RELEASES_REPO,
  TRUST_PROXY,
  CURRENT_VERSION,
  divider,
};
