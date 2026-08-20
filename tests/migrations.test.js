// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Schema migrations: a fresh database lands on the current version, re-running
 * is a no-op, and a legacy database upgrades without losing data.
 *
 * The upgrade cases run in child processes because src/config/db.js migrates as
 * an import side effect — one database per process.
 */

const { test, before, after, describe } = require('node:test');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const harness = require('./helpers/harness');

const SRC = path.join(__dirname, '..', 'src');
const CURRENT_SCHEMA_VERSION = 10;

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

/** Opens `dir` through the app's own db module and reports what it sees. */
function inspect(dir) {
  const script = `
    process.env.DATA_DIR = ${JSON.stringify(dir)};
    console.log = console.warn = console.error = () => {};
    const { db } = require(${JSON.stringify(path.join(SRC, 'config', 'db'))});
    const models = require(${JSON.stringify(path.join(SRC, 'models'))});
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().map(r => r.name);
    process.stdout.write(JSON.stringify({
      version: models.readSetting('schema_version'),
      tables,
      indexes,
      links: models.getAllLinks().map(l => ({ id: l.id, name: l.name, group_ids: l.group_ids })),
      groups: models.getAllGroups().map(g => ({ id: g.id, name: g.name })),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'linkpage-migr-'));

describe('a fresh database', () => {
  test('records the current schema version', () => {
    const { readSetting } = require('../src/models');
    assert.equal(readSetting('schema_version'), String(CURRENT_SCHEMA_VERSION));
  });

  test('creates every table the app relies on', () => {
    const { db } = require('../src/config/db');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    for (const table of [
      'settings', 'groups', 'links', 'sections', 'link_clicks',
      'link_groups', 'icons', 'audit_log', 'link_requests', 'ip_tags',
    ]) {
      assert.ok(tables.includes(table), `missing table ${table}`);
    }
  });

  test('creates the lookup indexes', () => {
    const { db } = require('../src/config/db');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
    for (const index of [
      'idx_sections_group', 'idx_link_groups_link', 'idx_link_groups_group',
      'idx_sections_parent', 'idx_audit_created', 'idx_link_requests_status',
    ]) {
      assert.ok(indexes.includes(index), `missing index ${index}`);
    }
  });

  test('starts empty — migrations never insert content', () => {
    const { getAllLinks, getAllGroups } = require('../src/models');
    assert.deepEqual(getAllLinks(), []);
    assert.deepEqual(getAllGroups(), []);
  });
});

describe('re-running migrations', () => {
  test('is a no-op that keeps the data', () => {
    const dir = tmpDir();
    try {
      const first = inspect(dir);
      assert.equal(first.version, String(CURRENT_SCHEMA_VERSION));

      // Add content, then reopen: the same schema version, same rows.
      const seedScript = `
        process.env.DATA_DIR = ${JSON.stringify(dir)};
        console.log = console.warn = console.error = () => {};
        const db = require(${JSON.stringify(path.join(SRC, 'models'))});
        const g = db.createGroup({ name: 'Kept' });
        db.createLink({ name: 'Kept link', url: 'https://kept.invalid/x', groupIds: [{ group_id: Number(g.lastInsertRowid) }] });
      `;
      execFileSync(process.execPath, ['-e', seedScript], { stdio: 'ignore' });

      const second = inspect(dir);
      assert.equal(second.version, String(CURRENT_SCHEMA_VERSION));
      assert.equal(second.links.length, 1);
      assert.equal(second.links[0].name, 'Kept link');
      assert.equal(second.groups[0].name, 'Kept');
      assert.deepEqual(second.tables, first.tables, 'no schema drift on reopen');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('upgrading a legacy database', () => {
  test('a v1-shaped database gains the new tables and promotes memberships', () => {
    const dir = tmpDir();
    try {
      // Hand-build the v1 schema: single group_id on links, no join table, and
      // a stale schema_version so the runner replays everything after it.
      const build = `
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(${JSON.stringify(path.join(dir, 'links.db'))});
        db.exec(\`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                               color TEXT NOT NULL DEFAULT '#0071e3', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL,
                              description TEXT, image_path TEXT, group_id INTEGER,
                              created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE sections (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, name TEXT NOT NULL,
                                 position INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE link_clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, link_id INTEGER NOT NULL,
                                    ip_address TEXT NOT NULL, user_agent TEXT, clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          INSERT INTO settings (key, value) VALUES ('schema_version', '1');
          INSERT INTO groups (name) VALUES ('Legacy group');
          INSERT INTO links (name, url, group_id) VALUES ('Legacy link', 'https://legacy.invalid/x', 1);
          INSERT INTO link_clicks (link_id, ip_address) VALUES (1, '203.0.113.5');
        \`);
        db.close();
      `;
      execFileSync(process.execPath, ['-e', build], { stdio: 'ignore' });

      const after = inspect(dir);
      assert.equal(after.version, String(CURRENT_SCHEMA_VERSION), 'upgraded in one pass');
      for (const table of ['link_groups', 'icons', 'audit_log', 'link_requests', 'ip_tags']) {
        assert.ok(after.tables.includes(table), `missing ${table} after the upgrade`);
      }

      assert.equal(after.links.length, 1);
      assert.equal(after.links[0].name, 'Legacy link');
      assert.deepEqual(after.links[0].group_ids, [1], 'the old group_id became a link_groups row');
      assert.equal(after.groups[0].name, 'Legacy group');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a database with a missing schema_version row still upgrades', () => {
    const dir = tmpDir();
    try {
      const build = `
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(${JSON.stringify(path.join(dir, 'links.db'))});
        db.exec(\`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
                               color TEXT NOT NULL DEFAULT '#0071e3', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL,
                              description TEXT, image_path TEXT, group_id INTEGER,
                              created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
          INSERT INTO groups (name) VALUES ('Pre-versioned');
          INSERT INTO links (name, url, group_id) VALUES ('Pre-versioned link', 'https://old.invalid/x', 1);
        \`);
        db.close();
      `;
      execFileSync(process.execPath, ['-e', build], { stdio: 'ignore' });

      const after = inspect(dir);
      assert.equal(after.version, String(CURRENT_SCHEMA_VERSION));
      assert.deepEqual(after.links[0].group_ids, [1]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
