/**
 * Post-mutation side effects.
 *
 * Fires broadcastDataUpdate() + records an audit entry after any successful
 * admin mutation on /api/*. Skips read-only methods, auth flows, the SSE
 * endpoint itself, and the publicly-callable group unlock.
 */

const { writeAuditFromRequest } = require('../services/auditService');
const { broadcastDataUpdate }   = require('../services/sseService');

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
]);

function auditAndBroadcast(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (SSE_BROADCAST_SKIP.has(req.path)) return next();
  if (/^\/api\/groups\/\d+\/unlock$/.test(req.path)) return next();

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    writeAuditFromRequest(req);
    if (!AUDIT_ONLY_PATHS.has(req.path)) broadcastDataUpdate();
  });
  next();
}

module.exports = { auditAndBroadcast };
