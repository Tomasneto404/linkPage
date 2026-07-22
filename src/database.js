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

// ─── Schema migrations ────────────────────────────────────────────────────────
//
// Every migration step is fully idempotent (CREATE TABLE IF NOT EXISTS, the
// addColumnIfMissing helper, INSERT OR IGNORE). That means re-running them on
// an already-current schema is a no-op, and any past version upgrades cleanly
// to the latest schema in a single pass.
//
// `schema_version` is stored in the settings table as a bookkeeping hint —
// we log "migrated v2 → v3" instead of staying silent — but the migrations
// themselves do not depend on it being accurate. If the row is missing or
// stale, every migration is still safely re-applied.

const CURRENT_SCHEMA_VERSION = 8;

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const MIGRATIONS = [
  {
    version: 1,
    name:    'Base schema (settings, groups, links, sections, clicks)',
    apply: () => {
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
    },
  },
  {
    version: 2,
    name:    'Multi-group memberships, file attachments, hidden links, group passwords',
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS link_groups (
          link_id    INTEGER NOT NULL,
          group_id   INTEGER NOT NULL,
          section_id INTEGER,
          PRIMARY KEY (link_id, group_id)
        );
        CREATE INDEX IF NOT EXISTS idx_link_groups_link  ON link_groups(link_id);
        CREATE INDEX IF NOT EXISTS idx_link_groups_group ON link_groups(group_id);
      `);

      addColumnIfMissing('links',       'group_id',        'INTEGER');
      addColumnIfMissing('links',       'position',        'INTEGER DEFAULT 0');
      addColumnIfMissing('links',       'favicon_path',    'TEXT');
      addColumnIfMissing('links',       'is_broken',       'INTEGER DEFAULT 0');
      addColumnIfMissing('links',       'last_checked_at', 'DATETIME');
      addColumnIfMissing('links',       'is_hidden',       'INTEGER DEFAULT 0');
      addColumnIfMissing('links',       'file_path',       'TEXT');
      addColumnIfMissing('links',       'file_name',       'TEXT');
      addColumnIfMissing('groups',      'position',        'INTEGER DEFAULT 0');
      addColumnIfMissing('groups',      'password_hash',   'TEXT');
      addColumnIfMissing('link_groups', 'section_id',      'INTEGER');

      // Promote any pre-existing single group_id into the new join table.
      db.exec(`
        INSERT OR IGNORE INTO link_groups (link_id, group_id)
        SELECT id, group_id FROM links WHERE group_id IS NOT NULL
      `);
    },
  },
  {
    version: 3,
    name:    'Icon library',
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS icons (
          id            INTEGER  PRIMARY KEY AUTOINCREMENT,
          file_path     TEXT     NOT NULL UNIQUE,
          original_name TEXT,
          mime_type     TEXT,
          file_size     INTEGER,
          created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_used_at  DATETIME
        )
      `);

      // Backfill the library from any image already attached to a link.
      db.exec(`
        INSERT OR IGNORE INTO icons (file_path)
        SELECT DISTINCT image_path FROM links WHERE image_path IS NOT NULL AND image_path <> ''
      `);
    },
  },
  {
    version: 4,
    name:    'Subsections inside sections',
    apply: () => {
      addColumnIfMissing('sections', 'parent_section_id', 'INTEGER');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sections_parent ON sections(parent_section_id)');
    },
  },
  {
    version: 5,
    name:    'Per-group unlock mode (timeout vs browser session)',
    apply: () => {
      // 'timeout' → re-lock after 30 s (legacy default).
      // 'session' → stay unlocked for the duration of the browser session.
      addColumnIfMissing('groups', 'unlock_mode', "TEXT DEFAULT 'timeout'");
    },
  },
  {
    version: 6,
    name:    'Admin audit log',
    apply: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id          INTEGER  PRIMARY KEY AUTOINCREMENT,
          action      TEXT     NOT NULL,   -- e.g. 'link.create', 'group.delete'
          entity_type TEXT,                -- 'link' | 'group' | 'section' | 'settings' | 'icon' | 'auth'
          entity_id   INTEGER,             -- the affected row id, when known
          summary     TEXT,                -- human-readable one-liner
          ip_address  TEXT,
          user_agent  TEXT,
          created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)');
    },
  },
  {
    version: 7,
    name:    'Seed settings favicon into the icon library',
    apply: () => {
      // The "Browser Tab Icon" should be reusable as a link icon. Copy the
      // current favicon path into the icons table (idempotent via UNIQUE).
      const row = db.prepare("SELECT value FROM settings WHERE key = 'favicon'").get();
      if (row && row.value) {
        db.prepare(`
          INSERT OR IGNORE INTO icons (file_path, original_name, last_used_at)
          VALUES (?, 'Site favicon', CURRENT_TIMESTAMP)
        `).run(row.value);
      }
    },
  },
  {
    version: 8,
    name:    'Public link requests',
    apply: () => {
      // Visitor-submitted link requests, reviewed by the admin. A request is a
      // proposal for a link; on approval the admin publishes it as a real link
      // (created_link_id points at the resulting links row).
      db.exec(`
        CREATE TABLE IF NOT EXISTS link_requests (
          id              INTEGER  PRIMARY KEY AUTOINCREMENT,
          name            TEXT     NOT NULL,
          url             TEXT     NOT NULL,
          description     TEXT,
          image_path      TEXT,                        -- icon /uploads/... path (preset SVG or upload)
          group_id        INTEGER,                     -- requested group
          section_id      INTEGER,                     -- requested section/subsection (nullable)
          status          TEXT     NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          reviewed_at     DATETIME,
          created_link_id INTEGER                      -- set when approved
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_link_requests_status ON link_requests(status)');
    },
  },
];

function readSchemaVersion() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get();
    return row ? (Number(row.value) || 0) : 0;
  } catch {
    // settings table doesn't exist yet — brand-new database.
    return 0;
  }
}

function writeSchemaVersion(v) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', ?)").run(String(v));
}

/**
 * Runs every migration in order, inside a single transaction so the DB never
 * ends up half-migrated if one step throws. Each step is idempotent, so this
 * is safe to call on every startup — old DBs upgrade, new DBs do nothing.
 */
/**
 * Returns true if this looks like a brand-new database (no user tables yet).
 * Used purely for nicer startup logging — the migrations themselves don't care.
 */
function isFreshDatabase() {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='links'"
  ).get();
  return !row;
}

function runMigrations() {
  const fresh = isFreshDatabase();
  const from  = readSchemaVersion();
  const applied = [];

  db.exec('BEGIN');
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= from) continue;  // already covered per stored version
      migration.apply();
      applied.push(migration);
    }
    writeSchemaVersion(CURRENT_SCHEMA_VERSION);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    const failedAt = applied.length ? applied[applied.length - 1].version + 1 : from + 1;
    console.error(`[db] Migration failed at v${failedAt}:`, err.message);
    throw err;
  }

  if (fresh) {
    console.log(`[db] Initialised schema at v${CURRENT_SCHEMA_VERSION}`);
  } else if (applied.length > 0) {
    const label = applied.map(m => `v${m.version} (${m.name})`).join(', ');
    // `from` is 0 for older DBs that pre-date schema_version; show that as "pre-v1".
    const fromLabel = from === 0 ? 'pre-versioned' : `v${from}`;
    console.log(`[db] Migrated schema ${fromLabel} → v${CURRENT_SCHEMA_VERSION}: ${label}`);
  } else {
    console.log(`[db] Schema verified at v${CURRENT_SCHEMA_VERSION}`);
  }
}

runMigrations();

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
           groups.id          AS group_id,
           groups.name        AS group_name,
           groups.color       AS group_color,
           sections.name      AS section_name,
           sections.parent_section_id AS parent_section_id,
           parent.name        AS parent_section_name
    FROM link_groups
    JOIN groups ON groups.id = link_groups.group_id
    LEFT JOIN sections        ON sections.id = link_groups.section_id
    LEFT JOIN sections parent ON parent.id   = sections.parent_section_id
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all();

  const byLink = new Map();
  for (const r of rows) {
    if (!byLink.has(r.link_id)) byLink.set(r.link_id, []);
    byLink.get(r.link_id).push({
      id:                  r.group_id,
      name:                r.group_name,
      color:               r.group_color,
      section_id:          r.section_id ?? null,
      section_name:        r.section_name ?? null,
      parent_section_id:   r.parent_section_id ?? null,
      parent_section_name: r.parent_section_name ?? null,
    });
  }
  return byLink;
}

/** Returns the group/section memberships for a single link. */
function loadMembershipsForLink(linkId) {
  const rows = db.prepare(`
    SELECT groups.id          AS group_id,
           groups.name        AS group_name,
           groups.color       AS group_color,
           link_groups.section_id,
           sections.name      AS section_name,
           sections.parent_section_id AS parent_section_id,
           parent.name        AS parent_section_name
    FROM link_groups
    JOIN groups ON groups.id = link_groups.group_id
    LEFT JOIN sections        ON sections.id = link_groups.section_id
    LEFT JOIN sections parent ON parent.id   = sections.parent_section_id
    WHERE link_groups.link_id = ?
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all(linkId);

  return rows.map(r => ({
    id:                  r.group_id,
    name:                r.group_name,
    color:               r.group_color,
    section_id:          r.section_id ?? null,
    section_name:        r.section_name ?? null,
    parent_section_id:   r.parent_section_id ?? null,
    parent_section_name: r.parent_section_name ?? null,
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
  return {
    ...rest,
    is_protected: !!password_hash,
    // Coerce NULLs (groups created before v5 had no unlock_mode column) to
    // the historical default so the wire format never has nulls.
    unlock_mode:  rest.unlock_mode || 'timeout',
  };
}

/** Hashes a password using scrypt. Format: scrypt$<saltHex>$<hashHex>. */
function hashGroupPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Constant-time verify of a plaintext password against a stored
 * `scrypt$<saltHex>$<hashHex>` string (produced by hashGroupPassword). Works for
 * any such hash regardless of where it's stored (groups.password_hash, settings).
 */
function verifyScryptHash(storedHash, password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  if (typeof storedHash !== 'string' || !storedHash) return false;

  const [scheme, saltHex, hashHex] = storedHash.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const salt     = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual   = crypto.scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** Returns true if the password matches the stored hash for the given group. */
function verifyGroupPassword(groupId, password) {
  const row = db.prepare('SELECT password_hash FROM groups WHERE id = ?').get(groupId);
  return verifyScryptHash(row?.password_hash, password);
}

/**
 * Returns all groups ordered by position, with a `sections` array attached.
 *
 * Sections are returned as a two-level hierarchy:
 *   group.sections   = [ { id, name, position, link_count,
 *                          subsections: [ { id, name, position, link_count } ] } ]
 * Subsections are scoped to a single level (no sub-sub-sections) on purpose
 * to keep the navigation manageable.
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

  // Build a lookup once so we can attach children to parents cheaply.
  const sectionsById = new Map();
  for (const s of sectionRows) {
    sectionsById.set(s.id, {
      id:                s.id,
      group_id:          s.group_id,
      name:              s.name,
      position:          s.position,
      parent_section_id: s.parent_section_id ?? null,
      link_count:        s.link_count,
      subsections:       [],
    });
  }

  // Walk in position order: any subsection encountered slots into its parent
  // (preserving sibling order); top-level sections collect into their group.
  const topByGroup = new Map();
  for (const s of sectionRows) {
    const obj = sectionsById.get(s.id);
    if (obj.parent_section_id && sectionsById.has(obj.parent_section_id)) {
      sectionsById.get(obj.parent_section_id).subsections.push({
        id:         obj.id,
        name:       obj.name,
        position:   obj.position,
        link_count: obj.link_count,
      });
    } else {
      if (!topByGroup.has(obj.group_id)) topByGroup.set(obj.group_id, []);
      topByGroup.get(obj.group_id).push(obj);
    }
  }

  return rows.map(g => ({
    ...safeGroup(g),
    sections: (topByGroup.get(g.id) || []).map(s => ({
      id:          s.id,
      name:        s.name,
      position:    s.position,
      link_count:  s.link_count,
      subsections: s.subsections,
    })),
  }));
}

/** Returns a single group by ID, hash stripped. */
function getGroupById(id) {
  return safeGroup(db.prepare('SELECT * FROM groups WHERE id = ?').get(id));
}

/** Normalises an unlock-mode input to a known value, falling back to 'timeout'. */
function sanitizeUnlockMode(value) {
  return value === 'session' ? 'session' : 'timeout';
}

/**
 * Inserts a new group placed at the end of the position list.
 * Pass `password` as a non-empty string to protect the group, and
 * `unlockMode` ('timeout' | 'session') to choose how an unlock persists.
 */
function createGroup({ name, color, password, unlockMode }) {
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM groups').get().max;
  const hash   = (typeof password === 'string' && password.length > 0)
    ? hashGroupPassword(password)
    : null;
  const mode   = sanitizeUnlockMode(unlockMode);
  return db.prepare(`
    INSERT INTO groups (name, color, position, password_hash, unlock_mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, color ?? '#0071e3', maxPos + 1, hash, mode);
}

/**
 * Updates a group's name, color, password, and unlock mode.
 *   password === undefined → leave password unchanged
 *   password === null or '' → clear the password (group becomes public)
 *   password = '<string>'   → set a new password
 *   unlockMode === undefined → leave unchanged; otherwise normalised to a known value
 */
function updateGroup(id, { name, color, password, unlockMode }) {
  db.prepare('UPDATE groups SET name=?, color=? WHERE id=?').run(name, color, id);

  if (password !== undefined) {
    if (password === null || password === '') {
      db.prepare('UPDATE groups SET password_hash = NULL WHERE id = ?').run(id);
    } else if (typeof password === 'string') {
      db.prepare('UPDATE groups SET password_hash = ? WHERE id = ?').run(hashGroupPassword(password), id);
    }
  }

  if (unlockMode !== undefined) {
    db.prepare('UPDATE groups SET unlock_mode = ? WHERE id = ?')
      .run(sanitizeUnlockMode(unlockMode), id);
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

/** Returns every section for a group (top-level + sub), ordered by position. */
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

/**
 * Inserts a new section at the end of its sibling list. Pass `parentSectionId`
 * to create a subsection — null/undefined means top-level for the group.
 * The position is per-sibling-group (top-level sections are ordered against
 * each other within the group; subsections against their parent's children).
 */
function createSection({ groupId, name, parentSectionId }) {
  let maxPos;
  if (parentSectionId) {
    maxPos = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS max FROM sections
      WHERE group_id = ? AND parent_section_id = ?
    `).get(groupId, parentSectionId).max;
  } else {
    maxPos = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS max FROM sections
      WHERE group_id = ? AND parent_section_id IS NULL
    `).get(groupId).max;
  }
  return db.prepare(`
    INSERT INTO sections (group_id, name, position, parent_section_id)
    VALUES (?, ?, ?, ?)
  `).run(groupId, name, maxPos + 1, parentSectionId || null);
}

/** Renames a section. */
function updateSection(id, { name }) {
  return db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, id);
}

/**
 * Deletes a section. Cascade-deletes any subsections first (which in turn
 * clear their links' section_id), then clears section_id on links pointing at
 * this section, and finally removes the section row itself.
 */
function deleteSection(id) {
  const subs = db.prepare('SELECT id FROM sections WHERE parent_section_id = ?').all(id);
  for (const sub of subs) deleteSection(sub.id);   // recurse cleanly
  db.prepare('UPDATE link_groups SET section_id = NULL WHERE section_id = ?').run(id);
  return db.prepare('DELETE FROM sections WHERE id = ?').run(id);
}

/**
 * Updates section positions from a full ordered ID array. The caller is
 * expected to send siblings only (all top-level for a group, OR all
 * subsections of the same parent) — that mirrors the drag-and-drop UI which
 * never reorders across nesting boundaries.
 */
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

// ─── Icon library ─────────────────────────────────────────────────────────────

/**
 * Returns every icon in the library, newest first, with the number of links
 * that currently reference it.
 */
function getAllIcons() {
  return db.prepare(`
    SELECT icons.id,
           icons.file_path,
           icons.original_name,
           icons.mime_type,
           icons.file_size,
           icons.created_at,
           icons.last_used_at,
           (SELECT COUNT(*) FROM links WHERE links.image_path = icons.file_path) AS usage_count
    FROM icons
    ORDER BY datetime(COALESCE(icons.last_used_at, icons.created_at)) DESC, icons.id DESC
  `).all();
}

function getIconById(id) {
  return db.prepare('SELECT * FROM icons WHERE id = ?').get(id);
}

function getIconByPath(filePath) {
  return db.prepare('SELECT * FROM icons WHERE file_path = ?').get(filePath);
}

/**
 * Inserts a new icon (or returns the existing row if file_path is already
 * registered — useful when the same upload happens twice). Returns the icon row.
 */
function createIcon({ filePath, originalName, mimeType, fileSize }) {
  const existing = getIconByPath(filePath);
  if (existing) return existing;
  db.prepare(`
    INSERT INTO icons (file_path, original_name, mime_type, file_size, last_used_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(filePath, originalName ?? null, mimeType ?? null, fileSize ?? null);
  return getIconByPath(filePath);
}

/** Bumps an icon's last_used_at — call this when a link adopts it. */
function touchIcon(id) {
  db.prepare('UPDATE icons SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

/**
 * Deletes an icon row and clears `image_path` on every link that used it.
 * Returns { changes, fileToDelete } so the caller can remove the file on disk.
 */
function deleteIcon(id) {
  const icon = getIconById(id);
  if (!icon) return { changes: 0, fileToDelete: null };
  db.prepare('UPDATE links SET image_path = NULL WHERE image_path = ?').run(icon.file_path);
  const res = db.prepare('DELETE FROM icons WHERE id = ?').run(id);
  return { changes: res.changes, fileToDelete: icon.file_path };
}

// ─── Audit log ──────────────────────────────────────────────────────────────

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

// ─── Link requests (public submissions) ──────────────────────────────────────

/** Inserts a new pending link request. Returns the run result. */
function createLinkRequest({ name, url, description, imagePath, groupId, sectionId }) {
  return db.prepare(`
    INSERT INTO link_requests (name, url, description, image_path, group_id, section_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name,
    url,
    description ?? null,
    imagePath ?? null,
    Number.isFinite(groupId) ? groupId : null,
    Number.isFinite(sectionId) ? sectionId : null,
  );
}

/**
 * Returns link requests newest-first, decorated with the target group's name +
 * color and the (sub)section name + its parent name. `opts.status` filters by
 * status ('pending' | 'approved' | 'rejected'); omit for all.
 */
function getLinkRequests({ status } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('r.status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT r.*,
           g.name  AS group_name,
           g.color AS group_color,
           s.name  AS section_name,
           s.parent_section_id AS parent_section_id,
           p.name  AS parent_section_name
    FROM link_requests r
    LEFT JOIN groups   g ON g.id = r.group_id
    LEFT JOIN sections s ON s.id = r.section_id
    LEFT JOIN sections p ON p.id = s.parent_section_id
    ${clause}
    ORDER BY r.id DESC
  `).all(...params);
}

function getLinkRequestById(id) {
  return db.prepare('SELECT * FROM link_requests WHERE id = ?').get(id);
}

/**
 * Updates a request's status and stamps reviewed_at. When approving, pass
 * { linkId } to record the published link's id.
 */
function setLinkRequestStatus(id, status, { linkId } = {}) {
  return db.prepare(`
    UPDATE link_requests
    SET status = ?, reviewed_at = CURRENT_TIMESTAMP, created_link_id = ?
    WHERE id = ?
  `).run(status, Number.isFinite(linkId) ? linkId : null, id);
}

function deleteLinkRequest(id) {
  return db.prepare('DELETE FROM link_requests WHERE id = ?').run(id);
}

/** Count of pending requests — powers the admin badge. */
function countPendingRequests() {
  return db.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE status = 'pending'").get().n;
}

module.exports = {
  readSetting, writeSetting, deleteSetting,
  getAllLinks, getLinkById, checkDuplicateUrl, createLink, updateLink, deleteLink,
  updateLinkFavicon, updateLinkBrokenStatus, updateLinkVisibility, getAllLinksForHealthCheck, reorderLinks,
  getAllGroups, getGroupById, createGroup, updateGroup, deleteGroup, reorderGroups,
  verifyGroupPassword, hashGroupPassword, verifyScryptHash,
  createLinkRequest, getLinkRequests, getLinkRequestById, setLinkRequestStatus,
  deleteLinkRequest, countPendingRequests,
  getSectionsForGroup, getSectionById, createSection, updateSection, deleteSection, reorderSections,
  recordClick, getAllStats, getRecentClicks, getTopIps,
  getAllIcons, getIconById, getIconByPath, createIcon, touchIcon, deleteIcon,
  recordAudit, getAuditLog, getAuditLogForExport, getAuditCount, clearAuditLog, pruneAuditLog,
};
