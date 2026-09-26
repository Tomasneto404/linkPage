// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** A markdown link that opens itself when its group is opened. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, group;

before(async () => {
  c = await harness.start();
  group = await c.makeGroup({ name: 'Handbook' });
});
after(harness.stop);

const MD = Buffer.from('# Read me first\n\nSomething worth leading with.\n');

/** A markdown-backed link, optionally asking to open itself. */
async function makeDoc({ name = 'Doc', autoOpen, fileName = 'doc.md' } = {}) {
  const form = new FormData();
  form.append('name', name);
  form.append('groups', JSON.stringify([{ group_id: group.id, section_id: null }]));
  if (autoOpen !== undefined) form.append('auto_open', String(autoOpen));
  form.append('file', new Blob([MD], { type: 'text/markdown' }), fileName);

  const res = await c.api('/api/links', { method: 'POST', form });
  return res;
}

/** Re-reads a link from the list, since there is no single-link GET. */
const linkById = async id => (await c.api('/api/links')).body.find(l => l.id === id);

describe('setting it on a markdown link', () => {
  test('it is off unless asked for', async () => {
    const res = await makeDoc({ name: 'Quiet doc' });
    assert.equal(res.status, 201);
    assert.equal(res.body.auto_open, 0);
  });

  test('it can be switched on at creation', async () => {
    const res = await makeDoc({ name: 'Leading doc', autoOpen: true });
    assert.equal(res.status, 201);
    assert.equal(res.body.auto_open, 1);
  });

  test('it can be switched on and off again later', async () => {
    const { body: link } = await makeDoc({ name: 'Toggled' });

    const on = await c.api(`/api/links/${link.id}`, {
      method: 'PUT',
      form: (() => { const f = new FormData(); f.append('name', link.name); f.append('url', ''); f.append('auto_open', 'true'); return f; })(),
    });
    assert.equal(on.status, 200);
    assert.equal(on.body.auto_open, 1);

    const off = await c.api(`/api/links/${link.id}`, {
      method: 'PUT',
      form: (() => { const f = new FormData(); f.append('name', link.name); f.append('url', ''); f.append('auto_open', 'false'); return f; })(),
    });
    assert.equal(off.body.auto_open, 0);
  });

  test('omitting the field leaves it as it was', async () => {
    const { body: link } = await makeDoc({ name: 'Untouched', autoOpen: true });

    const form = new FormData();
    form.append('name', 'Untouched, renamed');
    form.append('url', '');
    const res = await c.api(`/api/links/${link.id}`, { method: 'PUT', form });

    assert.equal(res.status, 200);
    assert.equal(res.body.auto_open, 1, 'still on');
  });

  test('the public page is told about it', async () => {
    const { body: link } = await makeDoc({ name: 'Public flag', autoOpen: true });
    const seen = (await c.pub('/api/links')).body.find(l => l.id === link.id);
    assert.equal(seen.auto_open, 1);
  });
});

describe('it only makes sense on a markdown link', () => {
  test('asking for it on a URL link is refused', async () => {
    const form = new FormData();
    form.append('name', 'Just a URL');
    form.append('url', 'https://example.invalid/x');
    form.append('auto_open', 'true');

    const res = await c.api('/api/links', { method: 'POST', form });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /markdown/i);
  });

  test('asking for it on a PDF is refused', async () => {
    const form = new FormData();
    form.append('name', 'A report');
    form.append('auto_open', 'true');
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'r.pdf');

    const res = await c.api('/api/links', { method: 'POST', form });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /markdown/i);
  });

  test('swapping the markdown out for something else turns it off', async () => {
    const { body: link } = await makeDoc({ name: 'Was markdown', autoOpen: true });
    assert.equal(link.auto_open, 1);

    const form = new FormData();
    form.append('name', link.name);
    form.append('url', '');
    form.append('file', new Blob([Buffer.from('%PDF-1.4\n')], { type: 'application/pdf' }), 'now.pdf');
    const res = await c.api(`/api/links/${link.id}`, { method: 'PUT', form });

    assert.equal(res.status, 200);
    assert.equal(res.body.auto_open, 0, 'it cannot lead a group with a PDF');
  });

  test('a refused create leaves no link behind', async () => {
    const before = (await c.api('/api/links')).body.length;
    const form = new FormData();
    form.append('name', 'Rejected');
    form.append('url', 'https://example.invalid/y');
    form.append('auto_open', 'true');
    await c.api('/api/links', { method: 'POST', form });

    assert.equal((await c.api('/api/links')).body.length, before);
  });
});

describe('export and import', () => {
  test('the flag survives a round trip', async () => {
    await makeDoc({ name: 'Exported doc', autoOpen: true });

    const dump = (await c.api('/api/links/export')).body;
    const row  = dump.links.find(l => l.name === 'Exported doc');
    assert.equal(row.auto_open, true);

    const res = await c.api('/api/links/import', {
      method: 'POST',
      json: { links: [{ name: 'Imported doc', file_path: '/uploads/x.md', file_name: 'x.md', auto_open: true }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);

    const imported = (await c.api('/api/links')).body.find(l => l.name === 'Imported doc');
    assert.equal(imported.auto_open, 1);
  });

  test('an imported flag on a non-markdown link is dropped rather than failing the row', async () => {
    const res = await c.api('/api/links/import', {
      method: 'POST',
      json: { links: [{ name: 'Imported URL', url: 'https://imported.invalid/x', auto_open: true }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);

    const imported = (await c.api('/api/links')).body.find(l => l.name === 'Imported URL');
    assert.equal(imported.auto_open, 0);
  });
});
