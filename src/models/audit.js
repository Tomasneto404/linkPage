// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin audit-log data access. */

const { db } = require('../config/db');

/**
 * Appends a single entry to the admin audit log. Best-effort — wrapped by the
 * caller so a logging failure never breaks the underlying mutation.
 */
function recordAudit({ action, entityType, entityId, summary, ipAddress, userAgent }) {
  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, summary, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    action,
    entityType ?? null,
    Number.isFinite(entityId) ? entityId : null,
    summary ?? null,
    ipAddress ?? null,
    userAgent ?? null,
  );
}

/**
 * Returns audit entries newest-first, with optional filters.
 *   opts.limit       — max rows (default 200, capped at 1000)
 *   opts.beforeId    — keyset pagination: only rows with id < beforeId
 *   opts.afterId     — only rows with id > afterId (live "new entries" polling)
 *   opts.entityType  — filter by entity type
 *   opts.search      — case-insensitive substring match on action/summary
 */
function getAuditLog(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 1000);
  const where = [];
  const params = [];
  if (Number.isFinite(opts.beforeId)) { where.push('id < ?'); params.push(opts.beforeId); }
  if (Number.isFinite(opts.afterId))  { where.push('id > ?'); params.push(opts.afterId); }
  if (opts.entityType)                { where.push('entity_type = ?'); params.push(opts.entityType); }
  if (opts.search) {
    where.push('(LOWER(action) LIKE ? OR LOWER(summary) LIKE ?)');
    const q = `%${String(opts.search).toLowerCase()}%`;
    params.push(q, q);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, action, entity_type, entity_id, summary, ip_address, user_agent, created_at
    FROM audit_log
    ${clause}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limit);
}

/**
 * Returns ALL audit entries matching the optional type/search filter, newest
 * first, with no pagination cap — used for export. Bounded by a hard ceiling
 * so a runaway log can't exhaust memory.
 */
function getAuditLogForExport(opts = {}) {
  const where = [];
  const params = [];
  if (opts.entityType) { where.push('entity_type = ?'); params.push(opts.entityType); }
  if (opts.search) {
    where.push('(LOWER(action) LIKE ? OR LOWER(summary) LIKE ?)');
    const q = `%${String(opts.search).toLowerCase()}%`;
    params.push(q, q);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, action, entity_type, entity_id, summary, ip_address, user_agent, created_at
    FROM audit_log
    ${clause}
    ORDER BY id DESC
    LIMIT 100000
  `).all(...params);
}

/** Total number of audit entries (for the header count). */
function getAuditCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
}

/** Deletes all audit entries. Returns the number removed. */
function clearAuditLog() {
  return db.prepare('DELETE FROM audit_log').run().changes;
}

/** Deletes audit entries older than `days` days. Returns rows removed. */
function pruneAuditLog(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return db.prepare(
    `DELETE FROM audit_log WHERE created_at < datetime('now', ?)`
  ).run(`-${d} days`).changes;
}

module.exports = {
  recordAudit, getAuditLog, getAuditLogForExport, getAuditCount,
  clearAuditLog, pruneAuditLog,
};
