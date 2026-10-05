// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * One member cannot reach another's links. Not read them, not change them, not
 * reorder them, not fetch their files — by any route, with any id.
 *
 * This is the test the separate-tables design exists to make pass. Two
 * members, Ana and Bruno, each build a page. Then Bruno tries every personal
 * route with Ana's ids, and every answer must be the one he would get for an id
 * that does not exist at all: 404. Not 403 — a 403 would tell him the id is
 * real and simply not his.
 *
 * And beyond the personal routes: nothing of Ana's may surface anywhere a
 * stranger or an administrator can see — the shared listings, the public file
 * directory, the export, the audit log.
 */

const fs   = require('node:fs');
const path = require('node:path');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { pngBytes } = harness;

let c, ana, bruno;
const PASSWORD = 'a-long-enough-password';

/** What Ana owns, for Bruno to aim at. */
const anas = {};

before(async () => {
  c = await harness.start();

  await c.makeUser({ email: 'ana@example.test',   password: PASSWORD });
  await c.makeUser({ email: 'bruno@example.test', password: PASSWORD });

  ana   = c.session(); await ana.login('ana@example.test', PASSWORD);
  bruno = c.session(); await bruno.login('bruno@example.test', PASSWORD);

  // Ana builds a page with one of everything.
  anas.group = (await ana.fetch('/api/my/groups', {
    method: 'POST', json: { name: "Ana's private group", color: '#ff2d55' },
  })).body;

  anas.section = (await ana.fetch(`/api/my/groups/${anas.group.id}/sections`, {
    method: 'POST', json: { name: "Ana's section" },
  })).body;

  const form = new FormData();
  form.append('name', "Ana's diagnosis letter");
  form.append('groups', JSON.stringify([{ group_id: anas.group.id, section_id: anas.section.id }]));
  form.append('image', new Blob([pngBytes()], { type: 'image/png' }), 'icon.png');
  form.append('file',  new Blob(['# Private\n\nNobody else reads this.'], { type: 'text/markdown' }), 'letter.md');
  anas.link = (await ana.fetch('/api/my/links', { method: 'POST', form })).body;

  anas.urlLink = (await ana.fetch('/api/my/links', {
    method: 'POST', form: formOf({ name: 'Ana bank', url: 'https://ana-bank.example/login' }),
  })).body;

  assert.ok(anas.link?.id && anas.urlLink?.id && anas.group?.id && anas.section?.id,
            'fixture built');
});
after(harness.stop);

function formOf(fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

describe("Bruno's own view", () => {
  test('contains none of what Ana made', async () => {
    const mine = await bruno.fetch('/api/my/data');
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.groups, [], 'no groups');
    assert.deepEqual(mine.body.links, [],  'no links');
    assert.equal(mine.body.storage.used, 0, 'and none of her bytes counted against him');
  });
});

describe('every personal route, aimed at Ana\'s ids', () => {
  const routes = () => [
    ['PUT',    `/api/my/groups/${anas.group.id}`,              { json: { name: 'Taken over' } }],
    ['DELETE', `/api/my/groups/${anas.group.id}`,              {}],
    ['POST',   `/api/my/groups/${anas.group.id}/sections`,     { json: { name: 'Planted' } }],
    ['PUT',    `/api/my/sections/${anas.section.id}`,          { json: { name: 'Taken over' } }],
    ['DELETE', `/api/my/sections/${anas.section.id}`,          {}],
    ['PUT',    `/api/my/links/${anas.link.id}`,                { form: formOf({ name: 'Taken over', url: 'https://evil.example' }) }],
    ['DELETE', `/api/my/links/${anas.link.id}`,                {}],
    ['GET',    `/api/my/links/${anas.link.id}/icon`,           {}],
    ['GET',    `/api/my/links/${anas.link.id}/file`,           {}],
    ['GET',    `/api/my/links/${anas.link.id}/file?raw=1`,     {}],
    ['GET',    `/api/my/links/${anas.urlLink.id}/favicon`,     {}],
  ];

  test('every one answers as though the id did not exist', async () => {
    const wrong = [];
    for (const [method, url, opts] of routes()) {
      const res = await bruno.fetch(url, { method, ...opts });
      if (res.status !== 404) wrong.push(`${method} ${url} → ${res.status}`);
    }
    assert.deepEqual(wrong, [], `these did not 404:\n  ${wrong.join('\n  ')}`);
  });

  test('and afterwards, everything of Ana\'s is exactly as she left it', async () => {
    const hers = (await ana.fetch('/api/my/data')).body;

    const group = hers.groups.find(g => g.id === anas.group.id);
    assert.ok(group, 'her group still exists');
    assert.equal(group.name, "Ana's private group", 'and is not renamed');
    assert.equal(group.sections.length, 1, 'with only her one section — nothing planted');
    assert.equal(group.sections[0].name, "Ana's section");

    const link = hers.links.find(l => l.id === anas.link.id);
    assert.ok(link, 'her link still exists');
    assert.equal(link.name, "Ana's diagnosis letter", 'and is not renamed');
    assert.ok(link.file_path, 'with its file');
    assert.ok(link.image_path, 'and its icon');
  });
});

describe('reordering with somebody else\'s ids', () => {
  test('writes nothing to their rows', async () => {
    // Ana adds a second link so there is an order to disturb.
    const second = (await ana.fetch('/api/my/links', {
      method: 'POST', form: formOf({ name: 'Second', url: 'https://example.com/2' }),
    })).body;

    const before = (await ana.fetch('/api/my/data')).body.links.map(l => [l.id, l.position]);

    // Bruno posts Ana's ids, reversed, to every reorder route.
    const reversed = [second.id, anas.urlLink.id, anas.link.id];
    for (const route of ['/api/my/links/reorder', '/api/my/groups/reorder', '/api/my/sections/reorder']) {
      const res = await bruno.fetch(route, { method: 'POST', json: { order: reversed } });
      assert.equal(res.status, 200, 'accepted, as a reorder of nothing of his');
    }

    const after = (await ana.fetch('/api/my/data')).body.links.map(l => [l.id, l.position]);
    assert.deepEqual(after, before, 'Ana\'s layout is untouched');
  });
});

describe('filing into somebody else\'s group', () => {
  test('is ignored — the link ends up in none of Ana\'s groups', async () => {
    const res = await bruno.fetch('/api/my/links', {
      method: 'POST',
      form: formOf({
        name:   "Bruno's link",
        url:    'https://example.com/bruno',
        groups: JSON.stringify([{ group_id: anas.group.id, section_id: anas.section.id }]),
      }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.group_ids, [], 'not filed anywhere');

    // And Ana's group's count did not move.
    const group = (await ana.fetch('/api/my/data')).body.groups.find(g => g.id === anas.group.id);
    assert.equal(group.link_count, 1, 'only her own link in it');
  });
});

describe('outside the personal routes', () => {
  test('a stranger sees nothing of Ana\'s in the shared listings', async () => {
    const links  = await c.pub('/api/links');
    const groups = await c.pub('/api/groups');
    const text = JSON.stringify([links.body, groups.body]);

    assert.ok(!text.includes("Ana's"), 'no names');
    assert.ok(!text.includes('ana-bank.example'), 'no addresses');
  });

  test('neither does an administrator, through any shared listing', async () => {
    const text = JSON.stringify([
      (await c.api('/api/links')).body,
      (await c.api('/api/groups')).body,
      (await c.api('/api/links/export')).body,
      (await c.api('/api/icons')).body,
    ]);
    assert.ok(!text.includes("Ana's"));
    assert.ok(!text.includes('ana-bank.example'));
  });

  test('the audit log records that Ana did things, but not what they were called', async () => {
    const log = await c.api('/api/audit?limit=200');
    const text = JSON.stringify(log.body.entries);

    assert.ok(log.body.entries.some(e => e.action === 'my_link.create'), 'the creation is there');
    assert.ok(!text.includes('diagnosis'),         'the name is not');
    assert.ok(!text.includes('ana-bank.example'), 'nor the address');
  });

  test('her files are not in the public directory, by any path', async () => {
    const row = require('../src/models').getPersonalLinkRow(
      require('../src/models').getUserByEmail('ana@example.test').id, anas.link.id);
    assert.ok(row.attachment_file, 'the file is stored');

    for (const url of [
      `/uploads/${row.attachment_file}`,
      `/uploads/${row.icon_file}`,
      `/uploads/../private-uploads/${row.attachment_file}`,
      `/uploads/%2e%2e/private-uploads/${row.attachment_file}`,
      `/private-uploads/${row.attachment_file}`,
    ]) {
      const res = await c.pub(url);
      assert.equal(res.status, 404, `${url} answered ${res.status}`);
    }

    // And it really is on disk, outside the public directory.
    assert.ok(fs.existsSync(path.join(c.dataDir, 'private-uploads', row.attachment_file)));
    assert.ok(!fs.existsSync(path.join(c.dataDir, 'uploads', row.attachment_file)));
  });

  test('an anonymous caller is refused every personal route', async () => {
    for (const url of ['/api/my/data', `/api/my/links/${anas.link.id}/file`,
                       `/api/my/links/${anas.link.id}/icon`]) {
      assert.equal((await c.pub(url)).status, 401, url);
    }
  });

  test('the admin token has no personal page, and cannot read anyone\'s', async () => {
    // It is not an account. A null owner id is exactly the value that must
    // never reach these queries, so the token is turned away before it can.
    assert.equal((await c.api('/api/my/data')).status, 401);
    assert.equal((await c.api(`/api/my/links/${anas.link.id}/file`)).status, 401);
  });
});

describe('Ana herself', () => {
  test('can read every file of her own', async () => {
    assert.equal((await ana.fetch(`/api/my/links/${anas.link.id}/icon`)).status, 200);

    const page = await ana.fetch(`/api/my/links/${anas.link.id}/file`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Nobody else reads this/);

    const raw = await ana.fetch(`/api/my/links/${anas.link.id}/file?raw=1`);
    assert.equal(raw.status, 200);
    assert.match(raw.text, /^# Private/);
  });

  test('her files are marked private, so no shared cache keeps a copy', async () => {
    const res = await ana.fetch(`/api/my/links/${anas.link.id}/icon`);
    assert.match(res.headers.get('cache-control'), /private/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});
