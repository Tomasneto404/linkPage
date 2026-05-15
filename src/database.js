/**
 * Database setup and all data access functions.
 *
 * Uses Node's built-in SQLite module (Node 24+).
 * Every query uses parameterized statements — no string interpolation in SQL —
 * which prevents SQL injection completely.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'links.db'));

// Create all tables on first run.
// IF NOT EXISTS makes this safe to run on every startup.
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    name       TEXT     NOT NULL,
    color      TEXT     NOT NULL DEFAULT '#0071e3',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS links (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    name        TEXT     NOT NULL,
    url         TEXT     NOT NULL,
    description TEXT,
    image_path  TEXT,
    group_id    INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS link_clicks (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    link_id     INTEGER  NOT NULL,
    ip_address  TEXT     NOT NULL,
    user_agent  TEXT,
    clicked_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: older databases won't have group_id yet.
const linkColumns = db.prepare('PRAGMA table_info(links)').all().map(col => col.name);
if (!linkColumns.includes('group_id')) {
  db.exec('ALTER TABLE links ADD COLUMN group_id INTEGER');
}

// Reusable SQL fragment that joins links with their group data.
// Every link query uses this so callers always get group name and color.
const LINKS_WITH_GROUP_SQL = `
  SELECT
    links.*,
    groups.name  AS group_name,
    groups.color AS group_color
  FROM links
  LEFT JOIN groups ON links.group_id = groups.id
`;

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Returns the stored value for a key, or null if it doesn't exist. */
function readSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** Saves a value for a key, inserting or overwriting as needed. */
function writeSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

/** Removes a settings key entirely. */
function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ─── Links ────────────────────────────────────────────────────────────────────

/** Returns every link, newest first, with its group data joined in. */
function getAllLinks() {
  return db.prepare(`${LINKS_WITH_GROUP_SQL} ORDER BY links.created_at DESC`).all();
}

/** Returns a single link by ID, with group data joined in. */
function getLinkById(id) {
  return db.prepare(`${LINKS_WITH_GROUP_SQL} WHERE links.id = ?`).get(id);
}

/** Inserts a new link and returns the SQLite run result (use .lastInsertRowid). */
function createLink({ name, url, description, imagePath, groupId }) {
  return db
    .prepare(`
      INSERT INTO links (name, url, description, image_path, group_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(name, url, description ?? null, imagePath ?? null, groupId ?? null);
}

/**
 * Updates an existing link.
 * If removeImage is true, clears the image column.
 * If a new imagePath is provided, it replaces the old one.
 * Otherwise, COALESCE keeps the existing image unchanged.
 */
function updateLink(id, { name, url, description, imagePath, groupId, removeImage }) {
  if (removeImage) {
    return db
      .prepare(`
        UPDATE links
        SET name=?, url=?, description=?, image_path=NULL, group_id=?
        WHERE id=?
      `)
      .run(name, url, description ?? null, groupId ?? null, id);
  }

  return db
    .prepare(`
      UPDATE links
      SET name=?, url=?, description=?, image_path=COALESCE(?, image_path), group_id=?
      WHERE id=?
    `)
    .run(name, url, description ?? null, imagePath ?? null, groupId ?? null, id);
}

/** Deletes a link and all its recorded clicks. */
function deleteLink(id) {
  db.prepare('DELETE FROM link_clicks WHERE link_id = ?').run(id);
  return db.prepare('DELETE FROM links WHERE id = ?').run(id);
}

// ─── Groups ───────────────────────────────────────────────────────────────────

/** Returns all groups with a link_count field showing how many links belong to each. */
function getAllGroups() {
  return db.prepare(`
    SELECT groups.*, COUNT(links.id) AS link_count
    FROM groups
    LEFT JOIN links ON links.group_id = groups.id
    GROUP BY groups.id
    ORDER BY groups.created_at ASC
  `).all();
}

/** Returns a single group by ID. */
function getGroupById(id) {
  return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
}

/** Inserts a new group and returns the SQLite run result. */
function createGroup({ name, color }) {
  return db
    .prepare('INSERT INTO groups (name, color) VALUES (?, ?)')
    .run(name, color ?? '#0071e3');
}

/** Updates a group's name and color. */
function updateGroup(id, { name, color }) {
  return db
    .prepare('UPDATE groups SET name=?, color=? WHERE id=?')
    .run(name, color, id);
}

/**
 * Deletes a group and un-assigns all links that belonged to it.
 * Links are not deleted — they become "ungrouped".
 */
function deleteGroup(id) {
  db.prepare('UPDATE links SET group_id = NULL WHERE group_id = ?').run(id);
  return db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

// ─── Clicks ───────────────────────────────────────────────────────────────────

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

module.exports = {
  readSetting, writeSetting, deleteSetting,
  getAllLinks, getLinkById, createLink, updateLink, deleteLink,
  getAllGroups, getGroupById, createGroup, updateGroup, deleteGroup,
  recordClick, getAllStats, getRecentClicks, getTopIps,
};
