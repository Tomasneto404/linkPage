/**
 * Database connection and schema migrations.
 *
 * Uses Node's built-in SQLite module (Node 24+). Opens the single shared
 * connection and runs migrations as a load-time side effect — every model
 * module requires this file, so the schema is guaranteed ready before any
 * query runs.
 *
 * Every query in the models layer uses parameterized statements — no string
 * interpolation in SQL — which prevents SQL injection completely.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const { DATA_DIR } = require('./env');

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

const CURRENT_SCHEMA_VERSION = 10;

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
  {
    version: 9,
    name:    'Link request submitter IP',
    apply: () => {
      // Record the IP address the request was submitted from, for admin review.
      // Idempotent: a prior partial run may have added the column already.
      const hasColumn = db.prepare("PRAGMA table_info(link_requests)")
        .all().some(c => c.name === 'ip_address');
      if (!hasColumn) {
        db.exec('ALTER TABLE link_requests ADD COLUMN ip_address TEXT');
      }
    },
  },
  {
    version: 10,
    name:    'IP attribution tags',
    apply: () => {
      // Maps a known IP address to a human-readable tag (a person's name) so
      // clicks and requests can be attributed to who made them.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ip_tags (
          ip_address TEXT     PRIMARY KEY,
          tag        TEXT     NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
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
 * Returns true if this looks like a brand-new database (no user tables yet).
 * Used purely for nicer startup logging — the migrations themselves don't care.
 */
function isFreshDatabase() {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='links'"
  ).get();
  return !row;
}

/**
 * Runs every migration in order, inside a single transaction so the DB never
 * ends up half-migrated if one step throws. Each step is idempotent, so this
 * is safe to call on every startup — old DBs upgrade, new DBs do nothing.
 */
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

module.exports = { db };
