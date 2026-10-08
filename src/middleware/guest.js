// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Guests: anonymous browsers who may contribute their own groups and links
 * when an administrator has opened the page to them.
 *
 * Identity is a cookie, nothing more. The cookie is hashed in the database so
 * a copy of links.db hands over no live guest sessions. A guest has no
 * password to change and nothing to sign out of; emptying cookies leaves the
 * content behind for the admin to see and prune.
 *
 * The feature is off by default. `contributionMode()` is read on every request
 * that cares, so toggling the setting takes effect at once.
 */

const crypto = require('node:crypto');

const db = require('../models');
const { parseCookies, getClientIp } = require('../utils/http');

const GUEST_COOKIE = 'lp_guest';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const MODES = ['off', 'members', 'anyone'];

/** The administrator's setting, as one of 'off' | 'members' | 'anyone'. */
function contributionMode() {
  const v = db.readSetting('contribution_mode');
  return MODES.includes(v) ? v : 'off';
}
const guestsAllowed = () => contributionMode() === 'anyone';

/**
 * Reads the cookie (if any), looks up the guest, attaches `req.guest = { id }`.
 * Does not mint — a visit without a contribution leaves no row behind.
 */
function attachGuest(req, res, next) {
  req.guest = null;
  const cookies = req._cookies || parseCookies(req.headers.cookie);
  req._cookies = cookies;
  const raw = cookies[GUEST_COOKIE];
  if (!raw) return next();
  const guest = db.getGuestByCookie(raw);
  if (!guest) return next();
  req.guest = { id: guest.id, cookie: raw };
  next();
}

function setGuestCookie(req, res, cookie) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', [
    `${GUEST_COOKIE}=${cookie}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`, ...(secure ? ['Secure'] : []),
  ].join('; '));
}

function clearGuestCookie(res) {
  res.append('Set-Cookie', `${GUEST_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * Guard for /api/guest/* writes. Refuses with 403 when guests are not
 * allowed, mints a guest on first contribution, and keeps `last_seen_at`
 * fresh. A signed-in member hitting these routes is also refused: they have
 * /api/my/* of their own, and sharing the two would blur ownership.
 */
function requireGuest(req, res, next) {
  if (!guestsAllowed()) {
    return res.status(403).json({ error: 'Contributions are not open here', code: 'contributions_off' });
  }
  // Admin token too: it is a server-side identity, not a browser contributing;
  // admins curate guest content from the panel, not by writing it themselves.
  if (req.user) {
    return res.status(409).json({ error: 'Signed-in members have a page of their own', code: 'signed_in' });
  }
  if (req.guest) {
    try { db.touchGuest(req.guest.id); } catch { /* best effort */ }
    return next();
  }
  // No cookie yet: mint one for this writer. Reads below /api/guest/data stay
  // without a guest, so a nosy GET never writes a row.
  try {
    const { id, cookie } = db.createGuest({
      userAgent: (req.headers['user-agent'] || '').slice(0, 500),
      ipAddress: getClientIp(req),
    });
    req.guest = { id, cookie };
    setGuestCookie(req, res, cookie);
    next();
  } catch (err) {
    console.warn('[guest] could not mint:', err.message);
    res.status(500).json({ error: 'Could not start a guest session' });
  }
}

/** Soft version for reads: never mints, never refuses. Attaches only if there is a guest. */
function optionalGuest(req, res, next) { attachGuest(req, res, next); }

/** How many unique guests (hash on the fly) seen in the recent window, for stats. */
function recentGuestCount(days = 7) {
  return 0;  // placeholder: not wired to any surface yet
}

module.exports = {
  GUEST_COOKIE, MODES, contributionMode, guestsAllowed,
  attachGuest, requireGuest, optionalGuest, setGuestCookie, clearGuestCookie,
  recentGuestCount,
};
