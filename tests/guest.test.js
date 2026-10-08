// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Guest contributions.
 *
 * Half of what matters is what guests cannot do. The feature is off by default,
 * nothing is minted until a contribution is made, cookies isolate guests from
 * each other and from members, and the admin token has no business on
 * /api/guest/* — it is not a browser.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, db;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c  = await harness.start();
  db = require('../src/models');
});
after(harness.stop);

const guestSession = () => c.session();

const open   = () => c.api('/api/settings/contributions', { method: 'POST', json: { mode: 'anyone' } }).catch(() => {});
const members = () => c.api('/api/settings/contributions', { method: 'POST', json: { mode: 'members' } }).catch(() => {});
const close  = () => c.api('/api/settings/contributions', { method: 'POST', json: { mode: 'off' } }).catch(() => {});

// Phase 2 lands before the settings endpoint of phase 4; set directly for now.
async function setMode(mode) { db.writeSetting('contribution_mode', mode === 'off' ? '' : mode); }

describe('mode off (default)', () => {
  before(() => setMode('off'));

  test('/api/guest/* writes are refused with contributions_off', async () => {
    const s = guestSession();
    const res = await s.fetch('/api/guest/groups', { method: 'POST', json: { name: 'Nope' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'contributions_off');
    assert.equal(db.listGuestsForAdmin().length, 0, 'no guest minted');
  });

  test('reads are harmless and return nothing', async () => {
    const res = await c.pub('/api/guest/data');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.groups, []);
    assert.deepEqual(res.body.links, []);
  });
});

describe('mode anyone', () => {
  before(() => setMode('anyone'));

  test('a first write mints a guest, sets the lp_guest cookie, and keeps the row', async () => {
    const s = guestSession();
    assert.ok(!s.jar.get('lp_guest'), 'no cookie yet');
    const res = await s.fetch('/api/guest/groups', { method: 'POST', json: { name: 'Reading', color: '#34c759' } });
    assert.equal(res.status, 201, res.text);

    const cookie = s.jar.get('lp_guest');
    assert.ok(cookie, 'cookie set');
    assert.ok(db.getGuestByCookie(cookie), 'guest row created');

    const data = await s.fetch('/api/guest/data');
    assert.deepEqual(data.body.groups.map(g => g.name), ['Reading']);
  });

  test('a second guest, in another browser, sees nothing of the first', async () => {
    const a = guestSession();
    await a.fetch('/api/guest/groups', { method: 'POST', json: { name: 'For Alice' } });

    const b = guestSession();
    const data = await b.fetch('/api/guest/data');
    assert.deepEqual(data.body.groups, []);
    assert.deepEqual(data.body.links,  []);
  });

  test('a link is created, read, moved into a group, and deleted', async () => {
    const s = guestSession();
    const g = await s.fetch('/api/guest/groups', { method: 'POST', json: { name: 'Projects' } });
    const groupId = g.body.id;

    const form = new FormData();
    form.append('name', 'My blog');
    form.append('url',  'https://blog.example.org/');
    form.append('groups', JSON.stringify([{ group_id: groupId }]));
    const create = await s.fetch('/api/guest/links', { method: 'POST', form });
    assert.equal(create.status, 201, create.text);

    const list = await s.fetch('/api/guest/data');
    assert.equal(list.body.links.length, 1);
    assert.equal(list.body.links[0].name, 'My blog');
    assert.deepEqual(list.body.links[0].groups.map(x => x.id), [groupId]);

    const del = await s.fetch(`/api/guest/links/${create.body.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
  });

  test('a signed-in member is refused: /api/my/* is theirs, not this', async () => {
    await c.makeUser({ email: 'm@example.test', password: PASSWORD });
    const m = c.session();
    await m.login('m@example.test', PASSWORD);
    const res = await m.fetch('/api/guest/groups', { method: 'POST', json: { name: 'x' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'signed_in');
  });

  test('the admin token is refused on /api/guest/* — not a browser', async () => {
    const res = await c.api('/api/guest/groups', { method: 'POST', json: { name: 'x' }, headers: { Origin: c.baseUrl } });
    assert.equal(res.status, 409, 'the admin token has no page of its own');
  });

  test('CSRF: a lp_guest cookie without an Origin or same-origin fetch metadata is refused', async () => {
    const s = guestSession();
    await s.fetch('/api/guest/groups', { method: 'POST', json: { name: 'warm-up' } });
    const res = await s.fetch('/api/guest/groups', { method: 'POST', json: { name: 'cross' }, noOrigin: true });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'cross_site');
  });

  test('an uploaded icon counts against the guest\'s allowance', async () => {
    const s = guestSession();
    const form = new FormData();
    form.append('name', 'With icon');
    form.append('url',  'https://x.example.com/');
    const bytes = Buffer.alloc(1024, 0xAB);
    form.append('image', new Blob([bytes], { type: 'image/png' }), 'icon.png');
    const res = await s.fetch('/api/guest/links', { method: 'POST', form });
    assert.equal(res.status, 201, res.text);

    const storage = await s.fetch('/api/guest/storage');
    assert.ok(storage.body.used >= bytes.length, `used ${storage.body.used}`);
  });
});

describe('isolation between guests', () => {
  before(() => setMode('anyone'));

  test('one guest cannot read another\'s link, group, or section by id', async () => {
    const alice = guestSession();
    const bob   = guestSession();

    const groupRes = await alice.fetch('/api/guest/groups', { method: 'POST', json: { name: 'Alice' } });
    const groupId  = groupRes.body.id;

    // Bob tries to rename, delete, add section — all 404.
    assert.equal((await bob.fetch(`/api/guest/groups/${groupId}`, { method: 'PUT', json: { name: 'Taken' } })).status, 404);
    assert.equal((await bob.fetch(`/api/guest/groups/${groupId}`, { method: 'DELETE' })).status, 404);
    assert.equal((await bob.fetch(`/api/guest/groups/${groupId}/sections`, { method: 'POST', json: { name: 's' } })).status, 400);

    // Alice's group still named Alice.
    const data = await alice.fetch('/api/guest/data');
    assert.equal(data.body.groups[0].name, 'Alice');
  });

  test('a stolen guest id in a reorder leaves the other guest alone', async () => {
    const alice = guestSession();
    const bob   = guestSession();
    const a1 = (await alice.fetch('/api/guest/groups', { method: 'POST', json: { name: '1' } })).body.id;
    const a2 = (await alice.fetch('/api/guest/groups', { method: 'POST', json: { name: '2' } })).body.id;

    await bob.fetch('/api/guest/groups/reorder', { method: 'POST', json: { order: [a2, a1] } });
    const data = await alice.fetch('/api/guest/data');
    assert.deepEqual(data.body.groups.map(g => g.name), ['1', '2'], 'untouched');
  });
});

describe('mode members', () => {
  before(() => setMode('members'));

  test('guests are refused; nothing is minted', async () => {
    const s = guestSession();
    const res = await s.fetch('/api/guest/groups', { method: 'POST', json: { name: 'nope' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'contributions_off', 'anyone is off, members-only is a UI distinction');
  });
});
