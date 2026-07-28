/** Admin audit log: list, clear/prune, export (CSV or JSON). */

const db = require('../models');
const { csvCell } = require('../utils/csv');

function list(req, res) {
  const limit      = req.query.limit ? Number(req.query.limit) : 200;
  const beforeId   = req.query.before ? Number(req.query.before) : undefined;
  const afterId    = req.query.after ? Number(req.query.after) : undefined;
  const entityType = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
  const search     = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;

  const entries = db.getAuditLog({ limit, beforeId, afterId, entityType, search });
  res.json({
    total:   db.getAuditCount(),
    count:   entries.length,
    entries,
  });
}

function clear(req, res) {
  // Optional ?days=N prunes only entries older than N days; otherwise clears all.
  if (req.query.days) {
    const removed = db.pruneAuditLog(Number(req.query.days));
    return res.json({ removed });
  }
  const removed = db.clearAuditLog();
  res.json({ removed });
}

function exportLog(req, res) {
  const entityType = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
  const search     = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
  const format     = req.query.format === 'json' ? 'json' : 'csv';

  const entries = db.getAuditLogForExport({ entityType, search });
  const stamp   = new Date().toISOString().split('T')[0];

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.json"`);
    return res.send(JSON.stringify({ exported_at: new Date().toISOString(), count: entries.length, entries }, null, 2));
  }

  const cols = ['id', 'created_at', 'action', 'entity_type', 'entity_id', 'summary', 'ip_address', 'user_agent'];
  const lines = [cols.join(',')];
  for (const e of entries) {
    lines.push(cols.map(c => csvCell(e[c])).join(','));
  }
  // Prepend a UTF-8 BOM so Excel opens accented characters correctly.
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
}

module.exports = { list, clear, exportLog };
