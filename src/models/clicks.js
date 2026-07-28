/** Click tracking and aggregate stats. */

const { db } = require('../config/db');

/** Records a single click on a link. */
function recordClick(linkId, ipAddress, userAgent) {
  db.prepare('INSERT INTO link_clicks (link_id, ip_address, user_agent) VALUES (?, ?, ?)')
    .run(linkId, ipAddress, userAgent ?? null);
}

/**
 * Returns aggregate stats for every link that has been clicked.
 * Links with zero clicks are not included — the caller treats missing entries as zeros.
 */
function getAllStats() {
  return db.prepare(`
    SELECT
      link_id,
      COUNT(*)                   AS total_clicks,
      COUNT(DISTINCT ip_address) AS unique_visitors,
      MAX(clicked_at)            AS last_clicked,
      SUM(CASE WHEN clicked_at >= datetime('now', '-1 day')  THEN 1 ELSE 0 END) AS clicks_today,
      SUM(CASE WHEN clicked_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS clicks_this_week
    FROM link_clicks
    GROUP BY link_id
  `).all();
}

/** Returns the most recent clicks for a link, newest first. */
function getRecentClicks(linkId, limit = 25) {
  return db.prepare(`
    SELECT ip_address, user_agent, clicked_at
    FROM link_clicks
    WHERE link_id = ?
    ORDER BY clicked_at DESC
    LIMIT ?
  `).all(linkId, limit);
}

/** Returns IP addresses ranked by how many times they clicked a link. */
function getTopIps(linkId, limit = 10) {
  return db.prepare(`
    SELECT ip_address, COUNT(*) AS click_count
    FROM link_clicks
    WHERE link_id = ?
    GROUP BY ip_address
    ORDER BY click_count DESC
    LIMIT ?
  `).all(linkId, limit);
}

module.exports = { recordClick, getAllStats, getRecentClicks, getTopIps };
