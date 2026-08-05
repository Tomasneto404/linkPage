// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Analytics: headline metrics derived from recorded clicks. Self-contained
 * (requires only the shared db handle) to avoid a cycle with models/index.
 *
 * All metrics are clicks-only. A `period` narrows the window for the totals and
 * the top-N rankings; the trend chart is always the last 30 days.
 */

const { db } = require('../config/db');

// period → SQLite datetime() offset, or null for "all time".
const PERIOD_OFFSETS = {
  today: '-1 day',
  '7d':  '-7 days',
  '30d': '-30 days',
  all:   null,
};

/** Coerces an incoming period to a known value (default '30d'). */
function normalizeAnalyticsPeriod(p) {
  return Object.prototype.hasOwnProperty.call(PERIOD_OFFSETS, p) ? p : '30d';
}

/** Returns { clause, params } for a time filter on the given column. */
function timeFilter(period, column = 'clicked_at') {
  const offset = PERIOD_OFFSETS[period];
  return offset
    ? { clause: `${column} >= datetime('now', ?)`, params: [offset] }
    : { clause: '', params: [] };
}

/** The N links with the most clicks in the period (INNER JOIN drops orphans). */
function getTopLinks(period, limit = 3) {
  const t = timeFilter(period, 'c.clicked_at');
  const where = t.clause ? `WHERE ${t.clause}` : '';
  return db.prepare(`
    SELECT l.id, l.name, l.url,
           COUNT(*)                     AS total_clicks,
           COUNT(DISTINCT c.ip_address) AS unique_visitors,
           MAX(c.clicked_at)            AS last_clicked
    FROM link_clicks c
    JOIN links l ON l.id = c.link_id
    ${where}
    GROUP BY c.link_id
    ORDER BY total_clicks DESC, last_clicked DESC
    LIMIT ?
  `).all(...t.params, limit);
}

/** The N IPs with the most clicks in the period, decorated with their tag. */
function getTopUsers(period, limit = 3) {
  const t = timeFilter(period, 'c.clicked_at');
  const conds = ["c.ip_address IS NOT NULL", "c.ip_address <> ''"];
  if (t.clause) conds.push(t.clause);
  return db.prepare(`
    SELECT c.ip_address,
           tg.tag,
           COUNT(*)          AS click_count,
           MAX(c.clicked_at) AS last_seen
    FROM link_clicks c
    LEFT JOIN ip_tags tg ON tg.ip_address = c.ip_address
    WHERE ${conds.join(' AND ')}
    GROUP BY c.ip_address
    ORDER BY click_count DESC, last_seen DESC
    LIMIT ?
  `).all(...t.params, limit);
}

/**
 * Headline totals. total_clicks / unique_visitors respect the period;
 * total_links is the whole catalogue; clicks_today / clicks_this_week are fixed
 * rolling windows (matching the per-link stats semantics).
 */
function getClickTotals(period) {
  const t = timeFilter(period);
  const where = t.clause ? `WHERE ${t.clause}` : '';
  const scoped = db.prepare(`
    SELECT COUNT(*) AS total_clicks, COUNT(DISTINCT ip_address) AS unique_visitors
    FROM link_clicks ${where}
  `).get(...t.params);
  const rolling = db.prepare(`
    SELECT
      SUM(CASE WHEN clicked_at >= datetime('now', '-1 day')  THEN 1 ELSE 0 END) AS clicks_today,
      SUM(CASE WHEN clicked_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS clicks_this_week
    FROM link_clicks
  `).get();
  const totalLinks = db.prepare('SELECT COUNT(*) AS n FROM links').get().n;
  return {
    total_clicks:     scoped.total_clicks || 0,
    unique_visitors:  scoped.unique_visitors || 0,
    total_links:      totalLinks,
    clicks_today:     rolling.clicks_today || 0,
    clicks_this_week: rolling.clicks_this_week || 0,
  };
}

/**
 * Clicks per day for the last `days` days (UTC day buckets). Sparse — days with
 * no clicks are omitted; the frontend fills the continuous axis.
 */
function getClickTrend(days = 30) {
  const offset = `-${Math.max(1, days) - 1} days`;
  return db.prepare(`
    SELECT date(clicked_at) AS day, COUNT(*) AS clicks
    FROM link_clicks
    WHERE clicked_at >= datetime('now', ?)
    GROUP BY day
    ORDER BY day ASC
  `).all(offset);
}

module.exports = {
  normalizeAnalyticsPeriod,
  getTopLinks,
  getTopUsers,
  getClickTotals,
  getClickTrend,
};
