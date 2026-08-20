// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Click-tracking redirect (/r/:id) and the /admin SPA entry point. */

const { PUBLIC_DIR } = require('../config/env');
const path = require('path');

const db = require('../models');
const { getClientIp } = require('../utils/http');
const { getUnlockedGroupIds } = require('../utils/groupCrypto');
const { isValidAdminToken } = require('../middleware/auth');
const { truncate } = require('../services/auditService');

function redirect(req, res) {
  const linkId = parseInt(req.params.id, 10);
  if (isNaN(linkId)) return res.status(400).send('Invalid link ID');

  const link = db.getLinkById(linkId);
  if (!link) return res.status(404).send('Link not found');

  const isAdmin = isValidAdminToken(req.headers['x-admin-token']);

  // Hidden links are reachable only by admins; everyone else gets bounced home.
  if (link.is_hidden && !isAdmin) {
    return res.redirect(302, '/');
  }

  // Permissive gate: link with no groups is open; otherwise at least one of its
  // groups must be public or unlocked. Admin always bypasses.
  if (!isAdmin && (link.group_ids || []).length > 0) {
    const groups       = db.getAllGroups();
    const protectedIds = new Set(groups.filter(g => g.is_protected).map(g => g.id));
    const unlocked     = getUnlockedGroupIds(req);
    const openVia      = link.group_ids.some(gid => !protectedIds.has(gid) || unlocked.has(gid));
    if (!openVia) {
      return res.redirect(302, '/');
    }
  }

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || null;
  db.recordClick(link.id, ip, ua);

  // Also drop a line in the audit log. Tagged 'click' so it can be filtered
  // separately from admin mutations (clicks are public + higher-volume).
  try {
    db.recordAudit({
      action:     'link.click',
      entityType: 'click',
      entityId:   link.id,
      summary:    `Visited "${truncate(link.name)}"${isAdmin ? ' (admin)' : ''}`,
      ipAddress:  ip,
      userAgent:  ua,
    });
  } catch { /* never block the redirect on a logging failure */ }

  res.setHeader('Cache-Control',   'no-store, no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, link.url);
}

/** Serves the admin SPA shell. */
function adminPage(req, res) {
  res.sendFile(path.resolve(PUBLIC_DIR, 'admin', 'index.html'));
}

module.exports = { redirect, adminPage };
