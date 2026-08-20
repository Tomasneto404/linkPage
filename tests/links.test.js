// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Link CRUD, visibility, ordering, bulk actions, import/export, file editor. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');
const { fileForm, svgBytes } = harness;

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

describe('create', () => {
  test('a URL link comes back decorated with its groups', async () => {
    const group = await c.makeGroup({ name: 'Docs' });
    const link  = await c.makeLink({ name: 'Handbook', url: 'https://handbook.invalid/start', groups: [group.id] });

    assert.ok(link.id > 0);
    assert.equal(link.name, 'Handbook');
    assert.equal(link.url, 'https://handbook.invalid/start');
    assert.deepEqual(link.group_ids, [group.id]);
    assert.equal(link.groups[0].name, 'Docs');
    assert.equal(link.is_hidden, 0);
  });

  test('a link can live in several groups, one of them inside a section', async () => {
    const a = await c.makeGroup({ name: 'A' });
    const b = await c.makeGroup({ name: 'B' });
    const section = await c.makeSection(b.id, 'Reading');

    const link = await c.makeLink({
      name: 'Multi',
      groups: [{ group_id: a.id, section_id: null }, { group_id: b.id, section_id: section.id }],
    });

    assert.deepEqual(link.group_ids.sort(), [a.id, b.id].sort());
    const inB = link.groups.find(g => g.id === b.id);
    assert.equal(inB.section_id, section.id);
    assert.equal(inB.section_name, 'Reading');
  });

  test('a file upload becomes a file-backed link', async () => {
    const link = await c.makeFileLink({ name: 'Spec', fileName: 'spec.html', bytes: Buffer.from('<p>spec</p>') });
    assert.match(link.file_path, /^\/uploads\//);
    assert.equal(link.file_name, 'spec.html');
    // url mirrors the file path so /r/:id stays uniform.
    assert.equal(link.url, link.file_path);

    const served = await c.pub(link.file_path);
    assert.equal(served.status, 200);
    assert.equal(served.text, '<p>spec</p>');
  });

  test('validation: name required, URL or file required, scheme checked', async () => {
    const noName = await c.api('/api/links', { method: 'POST', form: (() => { const f = new FormData(); f.append('url', 'https://x.invalid'); return f; })() });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/i);

    const noTarget = await c.api('/api/links', { method: 'POST', form: (() => { const f = new FormData(); f.append('name', 'Empty'); return f; })() });
    assert.equal(noTarget.status, 400);
    assert.match(noTarget.body.error, /URL or upload/i);

    for (const url of ['ftp://x.invalid', 'javascript:alert(1)', 'not-a-url']) {
      const bad = await c.api('/api/links', { method: 'POST', form: (() => { const f = new FormData(); f.append('name', 'Bad'); f.append('url', url); return f; })() });
      assert.equal(bad.status, 400, url);
      assert.match(bad.body.error, /http/i);
    }
  });

  test('a URL link kicks off a favicon fetch, a file-backed one does not', async () => {
    const before = c.faviconCalls.length;

    const link = await c.makeLink({ name: 'Fetches its favicon', url: 'https://favicon-me.invalid/x' });
    const call = c.faviconCalls.at(-1);
    assert.equal(c.faviconCalls.length, before + 1);
    assert.equal(call.linkId, link.id);
    assert.equal(call.url, 'https://favicon-me.invalid/x');

    await c.makeFileLink({ name: 'No favicon needed', fileName: 'x.txt', type: 'text/plain', bytes: Buffer.from('x') });
    assert.equal(c.faviconCalls.length, before + 1, 'file links have nothing to fetch');
  });

  test('a custom icon can be adopted from the library by icon_id', async () => {
    const icon = await c.makeIcon({ name: 'star.svg' });
    const form = new FormData();
    form.append('name', 'With icon');
    form.append('url', 'https://icon.invalid/x');
    form.append('icon_id', String(icon.id));
    const { status, body } = await c.api('/api/links', { method: 'POST', form });
    assert.equal(status, 201);
    assert.equal(body.image_path, icon.file_path);
  });
});

describe('update', () => {
  test('renames, re-points and re-groups a link', async () => {
    const g1 = await c.makeGroup({ name: 'One' });
    const g2 = await c.makeGroup({ name: 'Two' });
    const link = await c.makeLink({ name: 'Before', url: 'https://before.invalid/a', groups: [g1.id] });

    const form = new FormData();
    form.append('name', 'After');
    form.append('url', 'https://after.invalid/b');
    form.append('description', 'now with a description');
    form.append('groups', JSON.stringify([{ group_id: g2.id, section_id: null }]));
    const { status, body } = await c.api(`/api/links/${link.id}`, { method: 'PUT', form });

    assert.equal(status, 200);
    assert.equal(body.name, 'After');
    assert.equal(body.url, 'https://after.invalid/b');
    assert.equal(body.description, 'now with a description');
    assert.deepEqual(body.group_ids, [g2.id]);
  });

  test('remove_image clears the custom icon', async () => {
    const icon = await c.makeIcon({ name: 'drop.svg' });
    const form = new FormData();
    form.append('name', 'Iconed');
    form.append('url', 'https://iconed.invalid/x');
    form.append('icon_id', String(icon.id));
    const created = (await c.api('/api/links', { method: 'POST', form })).body;
    assert.equal(created.image_path, icon.file_path);

    const upd = new FormData();
    upd.append('name', 'Iconed');
    upd.append('url', 'https://iconed.invalid/x');
    upd.append('remove_image', 'true');
    const { body } = await c.api(`/api/links/${created.id}`, { method: 'PUT', form: upd });
    assert.equal(body.image_path, null);

    const stillInLibrary = await c.api('/api/icons');
    assert.ok(stillInLibrary.body.some(i => i.id === icon.id), 'the library keeps the icon');
  });

  test('a missing link is a 404 and a nameless update a 400', async () => {
    const missing = await c.api('/api/links/9999', { method: 'PUT', form: new FormData() });
    assert.equal(missing.status, 404);

    const link = await c.makeLink({ name: 'Named' });
    const bad = await c.api(`/api/links/${link.id}`, { method: 'PUT', form: new FormData() });
    assert.equal(bad.status, 400);
  });
});

describe('visibility', () => {
  test('a hidden link disappears from the public list but stays for the admin', async () => {
    const group = await c.makeGroup({ name: 'Mixed' });
    const link  = await c.makeLink({ name: 'Secret', groups: [group.id] });

    const hide = await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });
    assert.equal(hide.status, 200);
    assert.equal(hide.body.is_hidden, 1);

    const anon = await c.pub('/api/links');
    assert.ok(!anon.body.some(l => l.id === link.id), 'hidden from visitors');

    const admin = await c.api('/api/links');
    assert.ok(admin.body.some(l => l.id === link.id), 'visible to the admin');

    const show = await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: false } });
    assert.equal(show.body.is_hidden, 0);
    assert.ok((await c.pub('/api/links')).body.some(l => l.id === link.id));
  });
});

describe('delete + bulk', () => {
  test('delete removes a single link', async () => {
    const link = await c.makeLink({ name: 'Doomed' });
    const del = await c.api(`/api/links/${link.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    assert.equal((await c.api(`/api/links/${link.id}`, { method: 'PUT', form: new FormData() })).status, 404);
  });

  test('bulk-delete removes many and validates its input', async () => {
    const a = await c.makeLink({ name: 'Bulk A' });
    const b = await c.makeLink({ name: 'Bulk B' });

    const bad = await c.api('/api/links/bulk-delete', { method: 'POST', json: { ids: ['1'] } });
    assert.equal(bad.status, 400);

    const res = await c.api('/api/links/bulk-delete', { method: 'POST', json: { ids: [a.id, b.id, 9999] } });
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, 2, 'unknown ids are skipped, not counted');

    const list = (await c.api('/api/links')).body.map(l => l.id);
    assert.ok(!list.includes(a.id) && !list.includes(b.id));
  });
});

describe('reorder', () => {
  test('an explicit order is reflected in the list', async () => {
    // Work in a fresh group so other tests' links don't interleave.
    const group = await c.makeGroup({ name: 'Ordered' });
    const first  = await c.makeLink({ name: 'First',  groups: [group.id] });
    const second = await c.makeLink({ name: 'Second', groups: [group.id] });
    const third  = await c.makeLink({ name: 'Third',  groups: [group.id] });

    const res = await c.api('/api/links/reorder', { method: 'POST', json: { order: [third.id, first.id, second.id] } });
    assert.equal(res.status, 204);

    const inGroup = (await c.api('/api/links')).body
      .filter(l => l.group_ids.includes(group.id))
      .map(l => l.id);
    assert.deepEqual(inGroup, [third.id, first.id, second.id]);
  });
});

describe('export / import', () => {
  test('export carries links with their groups and sections', async () => {
    const group   = await c.makeGroup({ name: 'Exported' });
    const section = await c.makeSection(group.id, 'Docs');
    await c.makeLink({ name: 'Exported link', url: 'https://exported.invalid/a', groups: [{ group_id: group.id, section_id: section.id }] });

    const { status, body } = await c.api('/api/links/export');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.links));
    const entry = body.links.find(l => l.url === 'https://exported.invalid/a');
    assert.ok(entry, 'the link is in the bundle');
    assert.ok(entry.groups.some(g => g.name === 'Exported'));
  });

  test('re-importing the same bundle is a no-op', async () => {
    const bundle = (await c.api('/api/links/export')).body;
    const before = (await c.api('/api/links')).body.length;

    const first = await c.api('/api/links/import', { method: 'POST', json: bundle });
    assert.equal(first.status, 200);
    assert.equal(first.body.imported, 0, 'everything already exists');
    assert.ok(first.body.skipped >= 1);

    assert.equal((await c.api('/api/links')).body.length, before, 'no duplicates created');
  });

  test('importing new links creates their missing groups', async () => {
    const res = await c.api('/api/links/import', {
      method: 'POST',
      json: {
        links: [
          { name: 'Imported one', url: 'https://imported-one.invalid/x', groups: [{ name: 'Brand New Group' }] },
          { name: 'Imported two', url: 'https://imported-two.invalid/y' },
        ],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 2);

    const groups = (await c.pub('/api/groups')).body;
    assert.ok(groups.some(g => g.name === 'Brand New Group'));
  });

  test('a malformed bundle is rejected', async () => {
    const res = await c.api('/api/links/import', { method: 'POST', json: { nope: true } });
    assert.equal(res.status, 400);
  });
});

describe('file editor', () => {
  test('reads and writes an attached text file', async () => {
    const link = await c.makeFileLink({ name: 'Editable', fileName: 'page.html', bytes: Buffer.from('<h1>one</h1>\n') });

    const read = await c.api(`/api/links/${link.id}/file`);
    assert.equal(read.status, 200);
    assert.equal(read.body.content, '<h1>one</h1>\n');
    assert.equal(read.body.file_name, 'page.html');

    const write = await c.api(`/api/links/${link.id}/file`, { method: 'PUT', json: { content: '<h1>two</h1>\n' } });
    assert.equal(write.status, 200);
    assert.ok(write.body.size > 0);

    const again = await c.api(`/api/links/${link.id}/file`);
    assert.equal(again.body.content, '<h1>two</h1>\n');

    // The change is live for visitors too (same URL, fresh bytes).
    const served = await c.pub(link.file_path);
    assert.equal(served.text, '<h1>two</h1>\n');

    const onDisk = path.join(c.dataDir, 'uploads', path.basename(link.file_path));
    assert.equal(fs.readFileSync(onDisk, 'utf8'), '<h1>two</h1>\n');
    assert.ok(!fs.existsSync(`${onDisk}.tmp`), 'the staging file is renamed away');
  });

  test('a non-text attachment is refused with 415', async () => {
    const link = await c.makeFileLink({ name: 'Binary', fileName: 'sheet.xlsx', type: 'application/vnd.ms-excel', bytes: Buffer.from([1, 2, 3]) });
    const read = await c.api(`/api/links/${link.id}/file`);
    assert.equal(read.status, 415);
    const write = await c.api(`/api/links/${link.id}/file`, { method: 'PUT', json: { content: 'x' } });
    assert.equal(write.status, 415);
  });

  test('a URL-only link has no file to edit', async () => {
    const link = await c.makeLink({ name: 'No file' });
    assert.equal((await c.api(`/api/links/${link.id}/file`)).status, 404);
  });

  test('a missing content field is a 400', async () => {
    const link = await c.makeFileLink({ name: 'Text', fileName: 'notes.txt', type: 'text/plain', bytes: Buffer.from('hi') });
    const res = await c.api(`/api/links/${link.id}/file`, { method: 'PUT', json: {} });
    assert.equal(res.status, 400);
  });
});

describe('uploads', () => {
  test('a disallowed attachment type is rejected as JSON, not an HTML stack trace', async () => {
    const form = fileForm('file', { name: 'evil.sh', type: 'application/x-sh', bytes: Buffer.from('rm -rf /') }, { name: 'Script' });
    const res  = await c.api('/api/links', { method: 'POST', form });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not allowed/i);
  });

  test('a non-image in the icon field is rejected', async () => {
    const form = fileForm('image', { name: 'note.txt', type: 'text/plain', bytes: Buffer.from('nope') }, { name: 'X', url: 'https://x.invalid' });
    const res  = await c.api('/api/links', { method: 'POST', form });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /icon must be an image/i);
  });

  test('an unexpected multipart field is rejected', async () => {
    const form = fileForm('surprise', { name: 'x.svg', type: 'image/svg+xml', bytes: svgBytes() }, { name: 'X', url: 'https://x.invalid' });
    const res  = await c.api('/api/links', { method: 'POST', form });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unexpected field/i);
  });
});
