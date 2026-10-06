// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Exporting a member's own page, and importing it back — into the same
 * account, or another one.
 *
 * What matters most is what an import cannot do: touch anybody else's page,
 * star a link the importer cannot see, or bring a file in through the back
 * door. After that, that a round trip is faithful and a repeat is harmless.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, alice, bob, shared, hidden, db;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c  = await harness.start();
  db = require('../src/models');
  await c.makeUser({ email: 'alice@example.test', password: PASSWORD });
  await c.makeUser({ email: 'bob@example.test',   password: PASSWORD });
  alice = c.session(); await alice.login('alice@example.test', PASSWORD);
  bob   = c.session(); await bob.login('bob@example.test', PASSWORD);

  shared = await c.makeLink({ name: 'Shared docs', url: 'https://docs.example.com/' });
  hidden = await c.makeLink({ name: 'Secret', url: 'https://secret.example.com/' });

  // Alice's page: a group with a section and a subsection, a link in each,
  // an attachment-only link, and a favourite.
  const work = (await alice.fetch('/api/my/groups', { method: 'POST', json: { name: 'Work', color: '#34c759' } })).body;
  const team = (await alice.fetch(`/api/my/groups/${work.id}/sections`, { method: 'POST', json: { name: 'Team' } })).body;
  const sub  = (await alice.fetch(`/api/my/groups/${work.id}/sections`, {
    method: 'POST', json: { name: 'Rotas', parent_section_id: team.id },
  })).body;

  const link = async (fields, groups) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (groups) form.append('groups', JSON.stringify(groups));
    const res = await alice.fetch('/api/my/links', { method: 'POST', form });
    assert.equal(res.status, 201, res.text);
    return res.body;
  };
  await link({ name: 'Wiki', url: 'https://wiki.example.com/', description: 'The wiki' },
             [{ group_id: work.id, section_id: team.id }]);
  await link({ name: 'Rota', url: 'https://rota.example.com/' }, [{ group_id: work.id, section_id: sub.id }]);
  await link({ name: 'Loose', url: 'https://loose.example.com/' });
  const form = new FormData();
  form.append('name', 'Notes');
  form.append('file', new Blob(['%PDF-1.4 notes'], { type: 'application/pdf' }), 'notes.pdf');
  assert.equal((await alice.fetch('/api/my/links', { method: 'POST', form })).status, 201);

  await alice.fetch(`/api/my/favorites/${shared.id}`, { method: 'POST' });
});
after(harness.stop);

const exportOf = async s => (await s.fetch('/api/my/export')).body;
const importInto = (s, body) => s.fetch('/api/my/import', { method: 'POST', json: body });

describe('export', () => {
  test('is a file to download, for members only', async () => {
    const res = await alice.fetch('/api/my/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="linkpage-my-links-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal((await c.pub('/api/my/export')).status, 401);
    assert.equal((await c.api('/api/my/export')).status, 401, 'the admin token has no page of its own');
  });

  test('holds the structure, the addresses and the favourites', async () => {
    const file = await exportOf(alice);
    assert.equal(file.kind, 'linkpage-personal');
    assert.deepEqual(file.groups, [{
      name: 'Work', color: '#34c759',
      sections: [{ name: 'Team', subsections: [{ name: 'Rotas' }] }],
    }]);
    const byName = Object.fromEntries(file.links.map(l => [l.name, l]));
    assert.deepEqual(byName.Wiki.groups, [{ name: 'Work', section: 'Team', subsection: null }]);
    assert.deepEqual(byName.Rota.groups, [{ name: 'Work', section: 'Team', subsection: 'Rotas' }]);
    assert.deepEqual(byName.Loose.groups, []);
    assert.equal(byName.Wiki.description, 'The wiki');
    assert.deepEqual(file.favorites, [{ name: 'Shared docs', url: 'https://docs.example.com/' }]);
  });

  test('but never a private file, or where one is kept', async () => {
    const file = await exportOf(alice);
    const notes = file.links.find(l => l.name === 'Notes');
    assert.equal(notes.url, null);
    assert.equal(notes.file_name, 'notes.pdf');
    assert.ok(!JSON.stringify(file).includes('/api/my/links/'), 'no private address');
    assert.ok(!JSON.stringify(file).includes('%PDF'), 'no bytes');
  });

  test('is only ever your own', async () => {
    const file = await exportOf(bob);
    assert.deepEqual(file.groups, []);
    assert.deepEqual(file.links, []);
  });
});

describe('import', () => {
  let file;
  before(async () => {
    file = await exportOf(alice);
    // The administrator hides a link after this file was made; Bob also tries
    // to smuggle it in as a favourite.
    file.favorites.push({ name: 'Secret', url: 'https://secret.example.com/' });
    await c.api(`/api/links/${hidden.id}/visibility`, { method: 'POST', json: { hidden: true } });
  });

  test('rebuilds the page in another account', async () => {
    const res = await importInto(bob, file);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.groups_created, 1);
    assert.equal(res.body.sections_created, 2);
    assert.equal(res.body.links_imported, 3);
    assert.equal(res.body.favorites_added, 1);
    assert.ok(res.body.problems.some(p => /Notes.*file is not in the export/.test(p)));

    const again = await exportOf(bob);
    const strip = f => ({ groups: f.groups, links: f.links.filter(l => l.url), favorites: f.favorites });
    const theirs = strip(await exportOf(alice));
    assert.deepEqual(strip(again), theirs, 'a faithful copy, attachment aside');
  });

  test('does not star a link the importer cannot see', async () => {
    const starred = (await bob.fetch('/api/my/favorites')).body.link_ids;
    assert.deepEqual(starred, [shared.id]);
    assert.equal(db.isFavorite(db.getUserByEmail('bob@example.test').id, hidden.id), false);
  });

  test('a second time adds nothing', async () => {
    const res = await importInto(bob, file);
    assert.equal(res.body.groups_created, 0);
    assert.equal(res.body.sections_created, 0);
    assert.equal(res.body.links_imported, 0);
    assert.equal(res.body.favorites_added, 0);
    assert.equal((await exportOf(bob)).links.length, 3);
  });

  test('leaves everybody else alone', async () => {
    const content = async () => { const { exported_at, ...rest } = await exportOf(alice); return rest; };
    const before = await content();
    await importInto(bob, { links: [{ name: 'Only Bob', url: 'https://bob.example.com/' }] });
    assert.deepEqual(await content(), before);
  });

  test('refuses what is not an export of personal links', async () => {
    assert.equal((await importInto(bob, { nothing: true })).status, 400);
    const whole = await importInto(bob, { kind: 'something-else', links: [] });
    assert.equal(whole.status, 400);
  });

  test('skips what is not a link, and says why', async () => {
    const res = await importInto(bob, { links: [
      { name: '', url: 'https://x.example.com/' },
      { name: 'Script', url: 'javascript:alert(1)' },
      { name: 'Nowhere' },
    ] });
    assert.equal(res.body.links_imported, 0);
    assert.equal(res.body.problems.length, 3);
  });

  test('takes a library icon only if the library has it, never a path from the file', async () => {
    const res = await importInto(bob, { links: [
      { name: 'Sneaky icon', url: 'https://icon.example.com/', icon: '/api/my/links/1/icon' },
      { name: 'Traversal', url: 'https://trav.example.com/', icon: '/uploads/../data/links.db' },
    ] });
    assert.equal(res.body.links_imported, 2);
    const links = (await bob.fetch('/api/my/data')).body.links;
    for (const name of ['Sneaky icon', 'Traversal']) {
      assert.equal(links.find(l => l.name === name).image_path, null, name);
    }
  });

  test('is for members only', async () => {
    assert.equal((await c.pub('/api/my/import', { method: 'POST', json: { links: [] }, headers: { Origin: c.baseUrl } })).status, 401);
  });
});
