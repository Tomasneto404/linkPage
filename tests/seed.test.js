// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * First-run content: one hidden, ungrouped "Buy me a coffee" link.
 *
 * The favicon service is stubbed by the harness, so the seed always takes its
 * offline branch and writes the built-in orange coffee cup — which is exactly
 * the path an install with no outbound network would take.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');

let c, seed;

before(async () => {
  c = await harness.start();
  seed = require('../src/services/seedFirstRun');
});
after(harness.stop);

/** The seed writes its icon asynchronously; give it a moment to land. */
async function settle(predicate, tries = 40) {
  for (let i = 0; i < tries && !predicate(); i++) await new Promise(r => setTimeout(r, 25));
}

describe('seedFirstRunContent', () => {
  test('creates exactly one link: hidden, ungrouped, pointing at Buy Me a Coffee', async () => {
    seed.seedFirstRunContent();

    const links = (await c.api('/api/links')).body;
    assert.equal(links.length, 1);

    const [link] = links;
    assert.equal(link.name, 'Buy me a coffee');
    assert.equal(link.url, 'https://buymeacoffee.com/tomasneto26');
    assert.equal(link.is_hidden, 1, 'admin-only');
    assert.deepEqual(link.group_ids, [], 'no group is created');
    assert.match(link.description, /open source/i);
  });

  test('it never reaches the public page', async () => {
    assert.deepEqual((await c.pub('/api/links')).body, []);
    assert.deepEqual((await c.pub('/api/groups')).body, []);
  });

  test('the icon is stored as the link\'s own image and registered in the library', async () => {
    const linkOf = async () => (await c.api('/api/links')).body[0];
    await settle(async () => (await linkOf()).image_path !== null);

    const link = await linkOf();
    assert.match(link.image_path, /^\/uploads\/seed-buy-me-a-coffee\./);
    assert.equal(link.favicon_path, null, 'image_path survives a later re-save, favicon_path would not');

    const onDisk = path.join(c.dataDir, 'uploads', path.basename(link.image_path));
    assert.ok(fs.existsSync(onDisk));

    const icons = (await c.api('/api/icons')).body;
    assert.ok(icons.some(i => i.file_path === link.image_path), 'the library owns the file lifecycle');
    assert.equal((await c.pub(link.image_path)).status, 200);
  });

  test('the offline fallback is the orange coffee cup', async () => {
    const link = (await c.api('/api/links')).body[0];
    assert.match(link.image_path, /\.svg$/, 'no fetch succeeded, so the built-in glyph was used');

    const svg = fs.readFileSync(path.join(c.dataDir, 'uploads', path.basename(link.image_path)), 'utf8');
    assert.match(svg, /stroke="#ff9f0a"/, 'orange');
    assert.match(svg, /viewBox="0 0 24 24"/, 'same line-icon style as the stock set');
  });

  test('running it again is a no-op', async () => {
    const before = (await c.api('/api/links')).body;
    seed.seedFirstRunContent();
    assert.deepEqual((await c.api('/api/links')).body.map(l => l.id), before.map(l => l.id));
  });

  test('it bails out when the install already has a link', async () => {
    await c.api(`/api/links/${(await c.api('/api/links')).body[0].id}`, { method: 'DELETE' });
    await c.makeLink({ name: 'A real link of my own' });

    seed.seedFirstRunContent();

    const links = (await c.api('/api/links')).body;
    assert.equal(links.length, 1);
    assert.equal(links[0].name, 'A real link of my own', 'the example is not re-added');
  });

});

describe('the boot gate', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');

  /**
   * Boots the app in a separate process against `dir`, exactly as server.js
   * does (seed only when the database is brand new), and reports what it found.
   */
  function boot(dir, { deleteLinksFirst = false } = {}) {
    const script = `
      process.env.DATA_DIR = ${JSON.stringify(dir)};
      // The migration/seed banners would otherwise mix into the JSON below.
      console.log = console.warn = console.error = () => {};
      const { isFreshInstall, db: raw } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'config', 'db'))});
      const db = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'models'))});
      if (${deleteLinksFirst}) raw.exec('DELETE FROM links');
      const before = db.getAllLinks().length;
      if (isFreshInstall) require(${JSON.stringify(path.join(__dirname, '..', 'src', 'services', 'seedFirstRun'))}).seedFirstRunContent();
      process.stdout.write(JSON.stringify({ isFreshInstall, before, after: db.getAllLinks().length }));
    `;
    const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  }

  test('seeds on a brand-new database and never again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkpage-boot-'));
    try {
      const first = boot(dir);
      assert.equal(first.isFreshInstall, true);
      assert.equal(first.after, 1, 'the example link is created on the very first boot');

      const second = boot(dir);
      assert.equal(second.isFreshInstall, false, 'the database already existed');
      assert.equal(second.after, 1, 'no duplicate');

      // The user deletes the example, then restarts: it must stay deleted.
      const third = boot(dir, { deleteLinksFirst: true });
      assert.equal(third.isFreshInstall, false);
      assert.equal(third.after, 0, 'gone for good');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
