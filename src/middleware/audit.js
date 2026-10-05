// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Post-mutation side effects.
 *
 * Fires broadcastDataUpdate() + records an audit entry after any successful
 * admin mutation on /api/*. Skips read-only methods, auth flows, the SSE
 * endpoint itself, and the publicly-callable group unlock.
 */

const { writeAuditFromRequest } = require('../services/auditService');
const { broadcastDataUpdate, broadcastToUser } = require('../services/sseService');

const SSE_BROADCAST_SKIP = new Set([
  '/api/events',
  '/api/auth/verify',
  '/api/auth/verify-public',
]);
// These mutate but should NOT broadcast a public data refresh (no public
// effect) — they're still audited.
const AUDIT_ONLY_PATHS = new Set([
  '/api/auth/rotate-token',
  '/api/audit',
  // Signing in changes nothing anyone else can see. Broadcasting it would make
  // every open public page refetch everything because somebody logged in.
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/logout-all',
  '/api/auth/password',
]);

/**
 * A member's own links. Recorded, because the log is a security log, and sent
 * only to that member's own open pages — never on the shared channel, where it
 * would have nothing to show anyone else and would tell everyone watching that
 * somebody was busy.
 */
const isPersonal = p => p.startsWith('/api/my/');

function auditAndBroadcast(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (SSE_BROADCAST_SKIP.has(req.path)) return next();
  if (/^\/api\/groups\/\d+\/unlock$/.test(req.path)) return next();

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    writeAuditFromRequest(req);
    if (isPersonal(req.path))                 broadcastToUser(req.user?.id);
    else if (!AUDIT_ONLY_PATHS.has(req.path)) broadcastDataUpdate();
  });
  next();
}

module.exports = { auditAndBroadcast };
