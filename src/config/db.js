// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Database connection and schema migrations.
 *
 * Uses Node's built-in SQLite module (unflagged from Node 22.13). Opens the single shared
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

const CURRENT_SCHEMA_VERSION = 20;

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
  {
    version: 11,
    name:    'Custom link slugs',
    apply: () => {
      // Optional human-readable id used by /f/<slug>. Nullable: a link without
      // a slug keeps working at /r/<id> exactly as before, so this migration
      // changes nothing for existing rows.
      addColumnIfMissing('links', 'slug', 'TEXT');
      // Partial index: uniqueness applies only to links that actually have a
      // slug, so any number of rows may leave it NULL.
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_slug
        ON links(slug) WHERE slug IS NOT NULL
      `);
    },
  },
  {
    version: 12,
    name:    'File and change link requests',
    apply: () => {
      // A request used to be one thing: "please publish this URL". It now also
      // covers "here is a file, please publish it" and "please change this
      // existing link", told apart by `kind`. Existing rows are plain link
      // requests, which is what the default gives them.
      addColumnIfMissing('link_requests', 'kind', "TEXT NOT NULL DEFAULT 'link'");
      // kind='file': the visitor's upload. The `url` column stays NOT NULL and
      // holds '' for these, exactly as a file-backed link's url does.
      addColumnIfMissing('link_requests', 'file_path', 'TEXT');
      addColumnIfMissing('link_requests', 'file_name', 'TEXT');
      // kind='change': which link is being changed, and why. The name/url/
      // description columns carry the *proposed* values.
      addColumnIfMissing('link_requests', 'target_link_id', 'INTEGER');
      addColumnIfMissing('link_requests', 'note', 'TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_link_requests_kind ON link_requests(kind)');
    },
  },
  {
    version: 13,
    name:    'Auto-open markdown links',
    apply: () => {
      // A markdown link can ask to open itself when its group is opened, so a
      // group can lead with a document. Off for everything that already
      // exists, which is what the default gives them.
      addColumnIfMissing('links', 'auto_open', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 14,
    name:    'User accounts, sessions and invites',
    apply: () => {
      // Identity. Until this version the app had exactly one: the admin token.
      //
      // Nothing here inserts a row, and nothing touches links, groups or
      // sections — an existing install upgrades to a schema that simply has
      // somewhere to put accounts, and carries on behaving exactly as it did.
      // The first admin user is created at boot by seedAdminUser, not here,
      // because a migration cannot know whether this is a fresh install.
      //
      // email_key is the lowercased address and the thing uniqueness is
      // enforced on; email keeps whatever capitalisation the person typed, so
      // it can be shown back to them as they wrote it.
      //
      // password_hash is nullable on purpose: an account provisioned by an
      // external identity provider has no password of its own.
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          email                TEXT NOT NULL,
          email_key            TEXT NOT NULL UNIQUE,
          display_name         TEXT,
          role                 TEXT NOT NULL DEFAULT 'user',
          password_hash        TEXT,
          is_active            INTEGER NOT NULL DEFAULT 1,
          must_change_password INTEGER NOT NULL DEFAULT 0,
          storage_used         INTEGER NOT NULL DEFAULT 0,
          storage_quota        INTEGER,
          created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login_at        DATETIME
        )
      `);

      // Sessions are server-side so they can be revoked. The primary key is a
      // hash of the cookie value, never the value itself: a copy of this file
      // then hands over no working sessions.
      //
      // Two expiries. expires_at slides forward while someone keeps using the
      // session; absolute_expires_at never moves, so a session cannot live
      // forever by being touched.
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash          TEXT PRIMARY KEY,
          user_id             INTEGER NOT NULL,
          created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at          DATETIME NOT NULL,
          absolute_expires_at DATETIME NOT NULL,
          ip_address          TEXT,
          user_agent          TEXT
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

      // Invites and password resets are the same thing wearing two hats: a
      // single-use secret, handed to one person, that expires. One table means
      // one expiry rule, one redemption guard and one revoke path rather than
      // two of each drifting apart.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_tokens (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          kind               TEXT NOT NULL,
          token_hash         TEXT NOT NULL UNIQUE,
          label              TEXT,
          role               TEXT NOT NULL DEFAULT 'user',
          user_id            INTEGER,
          created_by_user_id INTEGER,
          created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at         DATETIME NOT NULL,
          redeemed_at        DATETIME,
          redeemed_user_id   INTEGER,
          revoked_at         DATETIME
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_tokens_kind ON user_tokens(kind)');

      // The seam for an external identity provider. Empty until one is
      // configured; it exists now so that adding one later is a new row rather
      // than a new migration on a live database.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_identities (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       INTEGER NOT NULL,
          provider      TEXT NOT NULL,
          subject       TEXT NOT NULL,
          email         TEXT,
          created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login_at DATETIME
        )
      `);
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_subject '
            + 'ON user_identities(provider, subject)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id)');

      // Who did it. With a single shared token there was nobody to record, so
      // the log never had an actor. Existing rows keep NULL, which reads back
      // as the admin token — the only thing it could have been.
      addColumnIfMissing('audit_log', 'actor_type',    'TEXT');
      addColumnIfMissing('audit_log', 'actor_user_id', 'INTEGER');
      addColumnIfMissing('audit_log', 'actor_label',   'TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_user_id)');

      // Unrelated to accounts, but this table has never had an index and every
      // analytics query groups over it.
      db.exec('CREATE INDEX IF NOT EXISTS idx_link_clicks_link ON link_clicks(link_id)');
    },
  },
  {
    version: 15,
    name:    'Personal links, groups and favourites',
    apply: () => {
      // Each member's own links live in tables of their own, not in links and
      // groups with an owner column.
      //
      // That is the whole design, so it is worth saying why. With an owner
      // column, every query anyone ever writes against links has to remember to
      // filter on it, and the failure mode of forgetting is publishing somebody's
      // private links to the internet. Fifteen places in the shared models would
      // need that filter today, and the list only grows. Separate tables make
      // the mistake impossible for the shared set: the rows are not there.
      //
      // Every table below carries its owner on the row itself — user_sections
      // included, though it could work it out from its group — so that no
      // ownership check ever needs a join, and every statement that touches a
      // row can say `AND owner_user_id = ?` in the same breath.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_groups (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_user_id INTEGER NOT NULL,
          name          TEXT NOT NULL,
          color         TEXT NOT NULL DEFAULT '#0071e3',
          position      INTEGER NOT NULL DEFAULT 0,
          created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_groups_owner ON user_groups(owner_user_id)');

      db.exec(`
        CREATE TABLE IF NOT EXISTS user_sections (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_user_id     INTEGER NOT NULL,
          group_id          INTEGER NOT NULL,
          name              TEXT NOT NULL,
          position          INTEGER NOT NULL DEFAULT 0,
          parent_section_id INTEGER,
          created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_sections_owner ON user_sections(owner_user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_sections_group ON user_sections(group_id)');

      // The file columns are bare filenames inside private-uploads/, never
      // /uploads/ paths, and they are named differently from the shared table's
      // on purpose. Identical names with different meanings is how a future
      // "publish this to everyone" feature copies a private filename into a
      // column the public static server will happily serve.
      //
      // image_path is the exception: it only ever holds a shared icon-library
      // path, which is already public, so it means exactly what it means on
      // links and keeps the name.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_links (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_user_id   INTEGER NOT NULL,
          name            TEXT NOT NULL,
          url             TEXT NOT NULL DEFAULT '',
          description     TEXT,
          image_path      TEXT,
          icon_file       TEXT,
          favicon_file    TEXT,
          attachment_file TEXT,
          file_name       TEXT,
          stored_bytes    INTEGER NOT NULL DEFAULT 0,
          position        INTEGER NOT NULL DEFAULT 0,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_links_owner ON user_links(owner_user_id)');

      db.exec(`
        CREATE TABLE IF NOT EXISTS user_link_groups (
          user_link_id  INTEGER NOT NULL,
          group_id      INTEGER NOT NULL,
          section_id    INTEGER,
          owner_user_id INTEGER NOT NULL,
          PRIMARY KEY (user_link_id, group_id)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_link_groups_group ON user_link_groups(group_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_link_groups_owner ON user_link_groups(owner_user_id)');

      // A favourite points at a *shared* link. Created now so the schema for
      // personal content lands in one step; nothing writes to it yet.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_favorites (
          user_id    INTEGER NOT NULL,
          link_id    INTEGER NOT NULL,
          position   INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, link_id)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_favorites_link ON user_favorites(link_id)');
    },
  },
  {
    version: 16,
    name:    'Per-file sizes on personal links',
    apply: () => {
      // A link can hold up to three files — an icon, a fetched favicon, an
      // attachment — and replacing one must free exactly what that one cost.
      // v15 kept a single running total, which cannot say how much of it
      // belonged to the file being replaced. One column per file can, and a
      // person's usage is then simply their sum, with no total to drift.
      //
      // user_links.stored_bytes from v15 is left in place and no longer read.
      addColumnIfMissing('user_links', 'icon_bytes',       'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing('user_links', 'favicon_bytes',    'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing('user_links', 'attachment_bytes', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 17,
    name:    'Sign-in throttling that survives a restart',
    apply: () => {
      // Failed sign-in attempts, counted per key: an address ("login-ip:…") or
      // an account ("login-account:…"). Kept here rather than in memory, where
      // they were: a restart used to hand an attacker a fresh budget, and the
      // per-account count could not exist at all without somewhere to keep it.
      //
      // Only the sign-in family lives here. The click and request limiters stay
      // in memory — they are about load, not about guessing passwords, and a
      // write per click is not worth what it would buy.
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_throttle (
          key          TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL,
          count        INTEGER NOT NULL DEFAULT 0
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_auth_throttle_window ON auth_throttle(window_start)');
    },
  },
  {
    version: 18,
    name:    'Sign-ins in flight at an identity provider',
    apply: () => {
      // One row per trip to the identity provider and back, from the moment the
      // browser is sent there until it returns or ten minutes pass. It holds
      // what must survive the round trip without being trusted to the browser:
      // the PKCE verifier and the nonce. Keyed by a hash of the state value,
      // which the browser carries in a cookie and the provider echoes back.
      // link_user_id is set when a signed-in member is connecting their account
      // rather than signing in.
      db.exec(`
        CREATE TABLE IF NOT EXISTS oidc_logins (
          state_hash    TEXT PRIMARY KEY,
          nonce         TEXT NOT NULL,
          code_verifier TEXT NOT NULL,
          redirect_uri  TEXT NOT NULL,
          next_path     TEXT,
          link_user_id  INTEGER,
          created_at    INTEGER NOT NULL
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_oidc_logins_created ON oidc_logins(created_at)');
    },
  },
  {
    version: 19,
    name:    'Group admins',
    apply: () => {
      // Members an administrator has trusted with one shared group: they may
      // add links to it, and change or remove links that live only in groups
      // they manage. The group itself — its name, colour, password — stays
      // the administrators'.
      db.exec(`
        CREATE TABLE IF NOT EXISTS group_managers (
          group_id   INTEGER NOT NULL,
          user_id    INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (group_id, user_id)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_group_managers_user ON group_managers(user_id)');
    },
  },
  {
    version: 20,
    name:    'Guest contributions',
    apply: () => {
      // A guest is a browser, not an account: identified by a cookie hashed
      // here, with nothing else known about them unless they type a name. One
      // row per browser that has ever contributed; a stray guest with no
      // content is tidied away by the cleanup job. The whole feature is off
      // until an administrator turns it on in Settings → Contributions.
      db.exec(`
        CREATE TABLE IF NOT EXISTS guests (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          cookie_hash     TEXT UNIQUE NOT NULL,
          display_name    TEXT,
          user_agent      TEXT,
          ip_address      TEXT,
          storage_used    INTEGER NOT NULL DEFAULT 0,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_seen_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_guests_last_seen ON guests(last_seen_at)');

      // Mirror of the user_* tables, owned by a guest id. Separate tables so a
      // forgotten owner filter cannot leak guest content into a signed-in
      // member's view, or the other way round.
      db.exec(`
        CREATE TABLE IF NOT EXISTS guest_groups (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_guest_id  INTEGER NOT NULL,
          name            TEXT NOT NULL,
          color           TEXT,
          position        INTEGER NOT NULL DEFAULT 0,
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_guest_groups_owner ON guest_groups(owner_guest_id)');

      db.exec(`
        CREATE TABLE IF NOT EXISTS guest_sections (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_guest_id     INTEGER NOT NULL,
          group_id           INTEGER NOT NULL,
          name               TEXT NOT NULL,
          position           INTEGER NOT NULL DEFAULT 0,
          parent_section_id  INTEGER,
          created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_guest_sections_owner ON guest_sections(owner_guest_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_guest_sections_group ON guest_sections(group_id)');

      db.exec(`
        CREATE TABLE IF NOT EXISTS guest_links (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_guest_id     INTEGER NOT NULL,
          name               TEXT NOT NULL,
          url                TEXT NOT NULL DEFAULT '',
          description        TEXT,
          image_path         TEXT,
          icon_file          TEXT,
          favicon_file       TEXT,
          attachment_file    TEXT,
          file_name          TEXT,
          icon_bytes         INTEGER NOT NULL DEFAULT 0,
          favicon_bytes      INTEGER NOT NULL DEFAULT 0,
          attachment_bytes   INTEGER NOT NULL DEFAULT 0,
          position           INTEGER NOT NULL DEFAULT 0,
          created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_guest_links_owner ON guest_links(owner_guest_id)');

      db.exec(`
        CREATE TABLE IF NOT EXISTS guest_link_groups (
          guest_link_id   INTEGER NOT NULL,
          group_id        INTEGER NOT NULL,
          section_id      INTEGER,
          owner_guest_id  INTEGER NOT NULL,
          PRIMARY KEY (guest_link_id, group_id)
        )
      `);
      db.exec('CREATE INDEX IF NOT EXISTS idx_guest_link_groups_owner ON guest_link_groups(owner_guest_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_guest_link_groups_group ON guest_link_groups(group_id)');
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
 * Returns true when this was a brand-new database.
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

  return fresh;
}

// True when this process created the database. Startup uses it to decide
// whether to add the first-run example content (see services/seedFirstRun.js).
const isFreshInstall = runMigrations();

module.exports = { db, isFreshInstall };