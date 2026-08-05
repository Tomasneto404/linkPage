// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * IP attribution: maps a known IP address to a human-readable tag (a person's
 * name) so clicks and link requests can be attributed to who made them.
 */

const { db } = require('../config/db');

/** Returns the tag row for an IP, or undefined. */
function getIpTag(ipAddress) {
  return db.prepare('SELECT ip_address, tag, created_at, updated_at FROM ip_tags WHERE ip_address = ?')
    .get(ipAddress);
}

/** Returns every tag as a plain { ip_address: tag } map — cheap to look up. */
function getIpTagMap() {
  const out = {};
  for (const row of db.prepare('SELECT ip_address, tag FROM ip_tags').all()) {
    out[row.ip_address] = row.tag;
  }
  return out;
}

/**
 * Creates or updates the tag for an IP (upsert). Stamps updated_at on change.
 */
function setIpTag(ipAddress, tag) {
  db.prepare(`
    INSERT INTO ip_tags (ip_address, tag)
    VALUES (?, ?)
    ON CONFLICT(ip_address) DO UPDATE SET tag = excluded.tag, updated_at = CURRENT_TIMESTAMP
  `).run(ipAddress, tag);
  return getIpTag(ipAddress);
}

/** Removes the tag for an IP. Returns the number of rows deleted. */
function deleteIpTag(ipAddress) {
  return db.prepare('DELETE FROM ip_tags WHERE ip_address = ?').run(ipAddress).changes;
}

/**
 * Returns every IP the app has seen — from link clicks and link-request
 * submissions — merged with its tag (if any), an activity count, and the most
 * recent time it was seen. IPs that are tagged but currently have no recorded
 * activity are still included (event_count 0) so admins can review them.
 * Newest activity first; tagged-but-inactive IPs sort last.
 */
function getKnownIps() {
  const active = db.prepare(`
    SELECT ip AS ip_address, COUNT(*) AS event_count, MAX(seen_at) AS last_seen
    FROM (
      SELECT ip_address AS ip, clicked_at AS seen_at FROM link_clicks   WHERE ip_address IS NOT NULL AND ip_address <> ''
      UNION ALL
      SELECT ip_address AS ip, created_at AS seen_at FROM link_requests WHERE ip_address IS NOT NULL AND ip_address <> ''
    )
    GROUP BY ip
  `).all();

  const tags = getIpTagMap();
  const byIp = new Map();
  for (const row of active) {
    byIp.set(row.ip_address, {
      ip_address:  row.ip_address,
      tag:         tags[row.ip_address] ?? null,
      event_count: row.event_count,
      last_seen:   row.last_seen,
    });
  }
  // Include tagged IPs with no recorded activity.
  for (const [ip, tag] of Object.entries(tags)) {
    if (!byIp.has(ip)) {
      byIp.set(ip, { ip_address: ip, tag, event_count: 0, last_seen: null });
    }
  }

  return [...byIp.values()].sort((a, b) => {
    if (!a.last_seen && !b.last_seen) return 0;
    if (!a.last_seen) return 1;
    if (!b.last_seen) return -1;
    return a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : 0;
  });
}

module.exports = { getIpTag, getIpTagMap, setIpTag, deleteIpTag, getKnownIps };
