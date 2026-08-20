// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Icon library: upload, usage counts, deletion rules, export/import. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');
const { fileForm, pngBytes, svgBytes } = harness;

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const onDisk = stored => path.join(c.dataDir, 'uploads', path.basename(stored));

describe('upload + list', () => {
  test('an upload lands in the library with its metadata', async () => {
    const bytes = svgBytes('#34c759');
    const icon = await c.makeIcon({ name: 'leaf.svg', bytes });
    assert.ok(icon.id > 0);
    assert.match(icon.file_path, /^\/uploads\/.+\.svg$/);
    assert.equal(icon.original_name, 'leaf.svg');
    assert.equal(icon.mime_type, 'image/svg+xml');
    assert.equal(icon.file_size, bytes.length);
    assert.ok(fs.existsSync(onDisk(icon.file_path)));

    const list = await c.api('/api/icons');
    assert.equal(list.status, 200);
    const row = list.body.find(i => i.id === icon.id);
    assert.equal(row.usage_count, 0);
  });

  test('a request with no file is a 400', async () => {
    const res = await c.api('/api/icons', { method: 'POST', form: new FormData() });
    assert.equal(res.status, 400);
  });

  test('a non-image upload is refused', async () => {
    const res = await c.api('/api/icons', {
      method: 'POST',
      form: fileForm('image', { name: 'x.txt', type: 'text/plain', bytes: Buffer.from('nope') }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /only image files/i);
  });

  test('usage_count follows the links that adopt the icon', async () => {
    const icon = await c.makeIcon({ name: 'shared.svg' });

    const form = new FormData();
    form.append('name', 'Uses the icon');
    form.append('url', 'https://uses.invalid/a');
    form.append('icon_id', String(icon.id));
    const link = (await c.api('/api/links', { method: 'POST', form })).body;
    assert.equal(link.image_path, icon.file_path);

    const after = (await c.api('/api/icons')).body.find(i => i.id === icon.id);
    assert.equal(after.usage_count, 1);
  });
});

describe('deletion', () => {
  test('deleting an icon clears it from the links that used it', async () => {
    const icon = await c.makeIcon({ name: 'doomed.svg' });
    const form = new FormData();
    form.append('name', 'Loses its icon');
    form.append('url', 'https://loses.invalid/a');
    form.append('icon_id', String(icon.id));
    const link = (await c.api('/api/links', { method: 'POST', form })).body;

    const del = await c.api(`/api/icons/${icon.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const refreshed = (await c.api('/api/links')).body.find(l => l.id === link.id);
    assert.equal(refreshed.image_path, null, 'the link falls back to its favicon');
    assert.ok(!fs.existsSync(onDisk(icon.file_path)), 'the file is gone too');
    assert.ok(!(await c.api('/api/icons')).body.some(i => i.id === icon.id));
  });

  test('deleting an unknown icon is a 404, a bad id a 400', async () => {
    assert.equal((await c.api('/api/icons/9999', { method: 'DELETE' })).status, 404);
    assert.equal((await c.api('/api/icons/abc', { method: 'DELETE' })).status, 400);
  });

  test('bulk-delete removes many and validates its input', async () => {
    const a = await c.makeIcon({ name: 'bulk-a.svg' });
    const b = await c.makeIcon({ name: 'bulk-b.svg' });

    const bad = await c.api('/api/icons/bulk-delete', { method: 'POST', json: { ids: 'nope' } });
    assert.equal(bad.status, 400);

    const res = await c.api('/api/icons/bulk-delete', { method: 'POST', json: { ids: [a.id, b.id, 9999] } });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 2);
    const ids = (await c.api('/api/icons')).body.map(i => i.id);
    assert.ok(!ids.includes(a.id) && !ids.includes(b.id));
  });

  test('a file still used as the favicon survives leaving the library', async () => {
    const upload = await c.api('/api/settings/favicon', {
      method: 'POST',
      form: fileForm('favicon', { name: 'fav.png', type: 'image/png', bytes: pngBytes() }),
    });
    const stored = upload.body.favicon;
    const icon = (await c.api('/api/icons')).body.find(i => i.file_path === stored);
    assert.ok(icon, 'the Settings favicon is registered in the library');

    assert.equal((await c.api(`/api/icons/${icon.id}`, { method: 'DELETE' })).status, 204);

    assert.ok(fs.existsSync(onDisk(stored)), 'the file stays because a setting points at it');
    assert.equal((await c.pub('/api/settings')).body.favicon, stored, 'and the favicon keeps working');
  });

  test('the same protection applies to the header brand icon', async () => {
    const res = await c.api('/api/settings/brand-icon', {
      method: 'POST',
      form: fileForm('icon', { name: 'brand.svg', type: 'image/svg+xml', bytes: svgBytes() }),
    });
    const stored = res.body.brand_icon;
    const icon = (await c.api('/api/icons')).body.find(i => i.file_path === stored);

    await c.api('/api/icons/bulk-delete', { method: 'POST', json: { ids: [icon.id] } });
    assert.ok(fs.existsSync(onDisk(stored)));
    assert.equal((await c.pub('/api/settings')).body.brand_icon, stored);
  });
});

describe('export / import', () => {
  test('export embeds the bytes inline', async () => {
    const bytes = svgBytes('#5856d6');
    await c.makeIcon({ name: 'exported.svg', bytes });

    const res = await c.api('/api/icons/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /icon-library-\d{4}-\d{2}-\d{2}\.json/);
    assert.equal(res.body.version, 1);
    const entry = res.body.icons.find(i => i.original_name === 'exported.svg');
    assert.ok(entry, 'the icon is in the bundle');
    assert.equal(Buffer.from(entry.data, 'base64').toString('utf8'), bytes.toString('utf8'));
    assert.equal(entry.file_ext, '.svg');
  });

  test('importing the same bundle twice de-dupes by content', async () => {
    const bundle = (await c.api('/api/icons/export')).body;
    const before = (await c.api('/api/icons')).body.length;

    const first = await c.api('/api/icons/import', { method: 'POST', json: bundle });
    assert.equal(first.status, 200);
    assert.equal(first.body.imported, 0, 'every icon is already present');
    assert.ok(first.body.skipped >= 1);
    assert.equal((await c.api('/api/icons')).body.length, before);
  });

  test('importing a fresh icon adds exactly one entry', async () => {
    const before = (await c.api('/api/icons')).body.length;
    const res = await c.api('/api/icons/import', {
      method: 'POST',
      json: {
        version: 1,
        icons: [{
          original_name: 'brand-new.svg',
          mime_type: 'image/svg+xml',
          file_ext: '.svg',
          data: svgBytes('#ff375f').toString('base64'),
        }],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);

    const list = (await c.api('/api/icons')).body;
    assert.equal(list.length, before + 1);
    const added = list.find(i => i.original_name === 'brand-new.svg');
    assert.ok(fs.existsSync(onDisk(added.file_path)));
    assert.equal((await c.pub(added.file_path)).status, 200);
  });

  test('a malformed bundle is rejected', async () => {
    for (const json of [{}, { icons: 'nope' }, { icons: {} }]) {
      const res = await c.api('/api/icons/import', { method: 'POST', json });
      assert.equal(res.status, 400, JSON.stringify(json));
    }
  });

  test('entries with a disallowed extension are skipped, not written', async () => {
    const res = await c.api('/api/icons/import', {
      method: 'POST',
      json: { icons: [{ original_name: 'evil.sh', file_ext: '.sh', data: Buffer.from('rm -rf /').toString('base64') }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 0);
    assert.ok(!(await c.api('/api/icons')).body.some(i => i.original_name === 'evil.sh'));
  });
});

describe('favicon preview', () => {
  test('rejects a missing or invalid URL without touching the network', async () => {
    assert.equal((await c.api('/api/favicon-preview')).status, 400);
    assert.equal((await c.api('/api/favicon-preview?url=not-a-url')).status, 400);
  });
});
