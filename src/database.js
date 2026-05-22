/**
 * Database setup and all data access functions.
 *
 * Uses Node's built-in SQLite module (Node 24+).
 * Every query uses parameterized statements — no string interpolation in SQL —
 * which prevents SQL injection completely.
 */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
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
    position   INTEGER  DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS links (
    id              INTEGER  PRIMARY KEY AUTOINCREMENT,
    name            TEXT     NOT NULL,
    url             TEXT     NOT NULL,
    description     TEXT,
    image_path      TEXT,
    favicon_path    TEXT,
    group_id        INTEGER,
    position        INTEGER  DEFAULT 0,
    is_broken       INTEGER  DEFAULT 0,
    last_checked_at DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS link_groups (
    link_id    INTEGER NOT NULL,
    group_id   INTEGER NOT NULL,
    section_id INTEGER,
    PRIMARY KEY (link_id, group_id)
  );

  CREATE INDEX IF NOT EXISTS idx_link_groups_link  ON link_groups(link_id);
  CREATE INDEX IF NOT EXISTS idx_link_groups_group ON link_groups(group_id);

  CREATE TABLE IF NOT EXISTS sections (
    id         INTEGER  PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER  NOT NULL,
    name       TEXT     NOT NULL,
    position   INTEGER  DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sections_group ON sections(group_id);

  CREATE TABLE IF NOT EXISTS link_clicks (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    link_id     INTEGER  NOT NULL,
    ip_address  TEXT     NOT NULL,
    user_agent  TEXT,
    clicked_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add new columns to existing databases without breaking them.
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('links',  'group_id',        'INTEGER');
addColumnIfMissing('links',  'position',        'INTEGER DEFAULT 0');
addColumnIfMissing('links',  'favicon_path',    'TEXT');
addColumnIfMissing('links',  'is_broken',       'INTEGER DEFAULT 0');
addColumnIfMissing('links',  'last_checked_at', 'DATETIME');
addColumnIfMissing('links',  'is_hidden',       'INTEGER DEFAULT 0');
addColumnIfMissing('links',  'file_path',       'TEXT');
addColumnIfMissing('links',  'file_name',       'TEXT');
addColumnIfMissing('groups', 'position',        'INTEGER DEFAULT 0');
addColumnIfMissing('groups', 'password_hash',   'TEXT');
addColumnIfMissing('link_groups', 'section_id',  'INTEGER');

// One-time migration: copy any existing single group_id into the new link_groups
// join table. Safe to run on every startup — INSERT OR IGNORE skips duplicates.
db.exec(`
  INSERT OR IGNORE INTO link_groups (link_id, group_id)
  SELECT id, group_id FROM links WHERE group_id IS NOT NULL
`);

// ─── Group membership helpers ─────────────────────────────────────────────────

/**
 * Returns a Map of link_id → array of group objects, each with the section
 * the link is assigned to within that group (if any).
 * Groups are ordered by their own position so the "primary" group is stable.
 */
function loadAllMemberships() {
  const rows = db.prepare(`
    SELECT link_groups.link_id,
           link_groups.section_id,
           groups.id     AS group_id,
           groups.name   AS group_name,
           groups.color  AS group_color,
           sections.name AS section_name
    FROM link_groups
    JOIN groups ON groups.id = link_groups.group_id
    LEFT JOIN sections ON sections.id = link_groups.section_id
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all();

  const byLink = new Map();
  for (const r of rows) {
    if (!byLink.has(r.link_id)) byLink.set(r.link_id, []);
    byLink.get(r.link_id).push({
      id:           r.group_id,
      name:         r.group_name,
      color:        r.group_color,
      section_id:   r.section_id ?? null,
      section_name: r.section_name ?? null,
    });
  }
  return byLink;
}

/** Returns the group/section memberships for a single link. */
function loadMembershipsForLink(linkId) {
  const rows = db.prepare(`
    SELECT groups.id     AS group_id,
           groups.name   AS group_name,
           groups.color  AS group_color,
           link_groups.section_id,
           sections.name AS section_name
    FROM link_groups
    JOIN groups ON groups.id = link_groups.group_id
    LEFT JOIN sections ON sections.id = link_groups.section_id
    WHERE link_groups.link_id = ?
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all(linkId);

  return rows.map(r => ({
    id:           r.group_id,
    name:         r.group_name,
    color:        r.group_color,
    section_id:   r.section_id ?? null,
    section_name: r.section_name ?? null,
  }));
}

/**
 * Attaches `groups`, `group_ids`, and legacy `group_id`/`group_name`/`group_color`
 * fields (first group) to a link row. Keeps the public API compatible with code
 * that only knows about a single group.
 */
function decorateLink(linkRow, memberships) {
  if (!linkRow) return linkRow;
  const groups = memberships ?? loadMembershipsForLink(linkRow.id);
  const first  = groups[0] || null;
  return {
    ...linkRow,
    groups,
    group_ids:   groups.map(g => g.id),
    group_id:    first ? first.id    : null,
    group_name:  first ? first.name  : null,
    group_color: first ? first.color : null,
  };
}

/**
 * Replaces the full set of group memberships for a link.
 * `assignments` accepts either:
 *   - an array of numeric IDs (legacy):       [1, 2, 3]
 *   - an array of { group_id, section_id }:   [{group_id: 1, section_id: 7}, {group_id: 2}]
 * Invalid entries are silently skipped. Section IDs that don't belong to the
 * given group are nulled out (defensive — keeps section/group consistent).
 */
function setLinkGroups(linkId, assignments) {
  const clear = db.prepare('DELETE FROM link_groups WHERE link_id = ?');
  const ins   = db.prepare(
    'INSERT OR IGNORE INTO link_groups (link_id, group_id, section_id) VALUES (?, ?, ?)'
  );
  clear.run(linkId);
  if (!Array.isArray(assignments)) return;

  const sectionGroupMap = new Map(
    db.prepare('SELECT id, group_id FROM sections').all().map(s => [s.id, s.group_id])
  );

  const seen = new Set();
  for (const raw of assignments) {
    let gid, sid = null;
    if (typeof raw === 'number' || typeof raw === 'string') {
      gid = Number(raw);
    } else if (raw && typeof raw === 'object') {
      gid = Number(raw.group_id);
      sid = (raw.section_id === null || raw.section_id === undefined)
        ? null
        : Number(raw.section_id);
    } else continue;

    if (!Number.isFinite(gid) || gid <= 0 || seen.has(gid)) continue;
    seen.add(gid);

    // Drop section_id if it doesn't belong to this group.
    if (sid !== null && (!Number.isFinite(sid) || sectionGroupMap.get(sid) !== gid)) {
      sid = null;
    }
    ins.run(linkId, gid, sid);
  }
}

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

/** Returns every link ordered by position, with all its groups attached. */
function getAllLinks() {
  const rows         = db.prepare('SELECT * FROM links ORDER BY position ASC, created_at DESC').all();
  const memberships  = loadAllMemberships();
  return rows.map(r => decorateLink(r, memberships.get(r.id) || []));
}

/** Returns a single link by ID, with its groups attached. */
function getLinkById(id) {
  const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id);
  return decorateLink(row);
}

/**
 * Returns the first link that has the same URL, or null if none exists.
 * Pass excludeId to skip the current link when editing.
 */
function checkDuplicateUrl(url, excludeId = null) {
  if (excludeId) {
    return db.prepare('SELECT id, name FROM links WHERE url = ? AND id != ?').get(url, excludeId);
  }
  return db.prepare('SELECT id, name FROM links WHERE url = ?').get(url);
}

/**
 * Inserts a new link placed at the end of the position list.
 * For URL-backed links pass `url`; for file-backed links pass `filePath` (and
 * optionally `fileName` for display) — in that case `url` may be an empty string.
 */
function createLink({ name, url, description, imagePath, groupIds, filePath, fileName }) {
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM links').get().max;
  const result = db
    .prepare(`
      INSERT INTO links (name, url, description, image_path, position, file_path, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(name, url ?? '', description ?? null, imagePath ?? null, maxPos + 1,
         filePath ?? null, fileName ?? null);

  setLinkGroups(result.lastInsertRowid, groupIds);
  return result;
}

/**
 * Updates an existing link and replaces its group memberships.
 *   removeImage = true → clears image_path.
 *   filePath supplied   → replaces the existing file (caller deletes the old file on disk).
 *   clearFile  = true   → clears file_path and file_name (link reverts to URL-only).
 * Pass groupIds=undefined to leave memberships untouched, [] to clear them.
 */
function updateLink(id, { name, url, description, imagePath, groupIds, removeImage,
                          filePath, fileName, clearFile }) {
  if (removeImage) {
    db.prepare(`
      UPDATE links
      SET name=?, url=?, description=?, image_path=NULL
      WHERE id=?
    `).run(name, url ?? '', description ?? null, id);
  } else {
    db.prepare(`
      UPDATE links
      SET name=?, url=?, description=?, image_path=COALESCE(?, image_path)
      WHERE id=?
    `).run(name, url ?? '', description ?? null, imagePath ?? null, id);
  }

  if (clearFile) {
    db.prepare('UPDATE links SET file_path = NULL, file_name = NULL WHERE id = ?').run(id);
  } else if (filePath !== undefined) {
    db.prepare('UPDATE links SET file_path = ?, file_name = ? WHERE id = ?')
      .run(filePath, fileName ?? null, id);
  }

  if (groupIds !== undefined) setLinkGroups(id, groupIds);
  return { changes: 1 };
}

/** Deletes a link and all its recorded clicks and group memberships. */
function deleteLink(id) {
  db.prepare('DELETE FROM link_clicks WHERE link_id = ?').run(id);
  db.prepare('DELETE FROM link_groups WHERE link_id = ?').run(id);
  return db.prepare('DELETE FROM links WHERE id = ?').run(id);
}

/** Stores the path of the server-cached favicon for a link. */
function updateLinkFavicon(id, faviconPath) {
  db.prepare('UPDATE links SET favicon_path = ? WHERE id = ?').run(faviconPath, id);
}

/** Soft-hides or un-hides a link without touching anything else. */
function updateLinkVisibility(id, isHidden) {
  db.prepare('UPDATE links SET is_hidden = ? WHERE id = ?')
    .run(isHidden ? 1 : 0, id);
}

/** Records the result of a health check for a link. */
function updateLinkBrokenStatus(id, isBroken) {
  db.prepare('UPDATE links SET is_broken = ?, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isBroken ? 1 : 0, id);
}

/** Returns id and url for every link — used by the health checker. */
function getAllLinksForHealthCheck() {
  // File-backed links are local resources — skip them since fetch() on a
  // relative path would fail anyway.
  return db.prepare('SELECT id, url FROM links WHERE file_path IS NULL').all();
}

/** Updates the position of all links at once from a full ordered ID array. */
function reorderLinks(orderedIds) {
  const update = db.prepare('UPDATE links SET position = ? WHERE id = ?');
  orderedIds.forEach((id, index) => update.run(index, id));
}

// ─── Groups ───────────────────────────────────────────────────────────────────

/**
 * Strips the password hash from a group row and adds an `is_protected` boolean.
 * Use this whenever a group row leaves the database layer — the hash should
 * never reach the wire.
 */
function safeGroup(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return { ...rest, is_protected: !!password_hash };
}

/** Hashes a password using scrypt. Format: scrypt$<saltHex>$<hashHex>. */
function hashGroupPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Returns true if the password matches the stored hash for the given group. */
function verifyGroupPassword(groupId, password) {
  if (typeof password !== 'string' || password.length === 0) return false;

  const row = db.prepare('SELECT password_hash FROM groups WHERE id = ?').get(groupId);
  if (!row || !row.password_hash) return false;

  const [scheme, saltHex, hashHex] = row.password_hash.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const salt     = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual   = crypto.scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Returns all groups ordered by position, with a link_count and a sections
 * array attached. Each section includes its own link_count for that group.
 */
function getAllGroups() {
  const rows = db.prepare(`
    SELECT groups.*, COUNT(link_groups.link_id) AS link_count
    FROM groups
    LEFT JOIN link_groups ON link_groups.group_id = groups.id
    GROUP BY groups.id
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all();

  const sectionRows = db.prepare(`
    SELECT sections.*, COUNT(link_groups.link_id) AS link_count
    FROM sections
    LEFT JOIN link_groups
      ON link_groups.section_id = sections.id
     AND link_groups.group_id   = sections.group_id
    GROUP BY sections.id
    ORDER BY sections.position ASC, sections.created_at ASC
  `).all();

  const sectionsByGroup = new Map();
  for (const s of sectionRows) {
    if (!sectionsByGroup.has(s.group_id)) sectionsByGroup.set(s.group_id, []);
    sectionsByGroup.get(s.group_id).push({
      id:         s.id,
      name:       s.name,
      position:   s.position,
      link_count: s.link_count,
    });
  }

  return rows.map(g => ({
    ...safeGroup(g),
    sections: sectionsByGroup.get(g.id) || [],
  }));
}

/** Returns a single group by ID, hash stripped. */
function getGroupById(id) {
  return safeGroup(db.prepare('SELECT * FROM groups WHERE id = ?').get(id));
}

/**
 * Inserts a new group placed at the end of the position list.
 * Pass `password` as a non-empty string to protect the group.
 */
function createGroup({ name, color, password }) {
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM groups').get().max;
  const hash   = (typeof password === 'string' && password.length > 0)
    ? hashGroupPassword(password)
    : null;
  return db
    .prepare('INSERT INTO groups (name, color, position, password_hash) VALUES (?, ?, ?, ?)')
    .run(name, color ?? '#0071e3', maxPos + 1, hash);
}

/**
 * Updates a group's name and color, and optionally its password.
 *   password === undefined → leave password unchanged
 *   password === null or '' → clear the password (group becomes public)
 *   password = '<string>'   → set a new password
 */
function updateGroup(id, { name, color, password }) {
  db.prepare('UPDATE groups SET name=?, color=? WHERE id=?').run(name, color, id);

  if (password === undefined) return { changes: 1 };

  if (password === null || password === '') {
    db.prepare('UPDATE groups SET password_hash = NULL WHERE id = ?').run(id);
  } else if (typeof password === 'string') {
    db.prepare('UPDATE groups SET password_hash = ? WHERE id = ?').run(hashGroupPassword(password), id);
  }
  return { changes: 1 };
}

/**
 * Deletes a group, its sections, and the link memberships in it.
 * Links that belonged to the group lose only this membership — any other
 * groups they belong to are preserved.
 */
function deleteGroup(id) {
  db.prepare('DELETE FROM link_groups WHERE group_id = ?').run(id);
  db.prepare('DELETE FROM sections   WHERE group_id = ?').run(id);
  // Also clear the legacy single-group column on any link that pointed here.
  db.prepare('UPDATE links SET group_id = NULL WHERE group_id = ?').run(id);
  return db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

/** Updates the position of all groups at once from a full ordered ID array. */
function reorderGroups(orderedIds) {
  const update = db.prepare('UPDATE groups SET position = ? WHERE id = ?');
  orderedIds.forEach((id, index) => update.run(index, id));
}

// ─── Sections ─────────────────────────────────────────────────────────────────

/** Returns every section for a group, ordered by position. */
function getSectionsForGroup(groupId) {
  return db.prepare(`
    SELECT * FROM sections
    WHERE group_id = ?
    ORDER BY position ASC, created_at ASC
  `).all(groupId);
}

/** Returns a single section. */
function getSectionById(id) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
}

/** Inserts a new section at the end of its group's position list. */
function createSection({ groupId, name }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM sections WHERE group_id = ?')
    .get(groupId).max;
  return db
    .prepare('INSERT INTO sections (group_id, name, position) VALUES (?, ?, ?)')
    .run(groupId, name, maxPos + 1);
}

/** Renames a section. */
function updateSection(id, { name }) {
  return db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, id);
}

/**
 * Deletes a section. Any link memberships pointing at it have their section_id
 * cleared so the links fall back to "no section" inside the same group.
 */
function deleteSection(id) {
  db.prepare('UPDATE link_groups SET section_id = NULL WHERE section_id = ?').run(id);
  return db.prepare('DELETE FROM sections WHERE id = ?').run(id);
}

/** Updates section positions from a full ordered ID array. */
function reorderSections(orderedIds) {
  const update = db.prepare('UPDATE sections SET position = ? WHERE id = ?');
  orderedIds.forEach((id, index) => update.run(index, id));
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
  getAllLinks, getLinkById, checkDuplicateUrl, createLink, updateLink, deleteLink,
  updateLinkFavicon, updateLinkBrokenStatus, updateLinkVisibility, getAllLinksForHealthCheck, reorderLinks,
  getAllGroups, getGroupById, createGroup, updateGroup, deleteGroup, reorderGroups,
  verifyGroupPassword,
  getSectionsForGroup, getSectionById, createSection, updateSection, deleteSection, reorderSections,
  recordClick, getAllStats, getRecentClicks, getTopIps,
};
