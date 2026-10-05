// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Favourites: shared links a member has starred, in their own order.
 *
 * The property everything here rests on: a star is never a way round what the
 * administrator decides. A favourite points at a shared link, and that link can
 * be hidden, deleted, or moved behind a password after it was starred. The
 * favourites list is filtered on every read through the exact rule the public
 * listing uses, so it can never show a link the listing would not — and when
 * the administrator undoes it, the star is still there.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, me;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c = await harness.start();
  await c.makeUser({ email: 'fan@example.test', password: PASSWORD });
  me = c.session();
  await me.login('fan@example.test', PASSWORD);
});
after(harness.stop);

const star   = id => me.fetch(`/api/my/favorites/${id}`, { method: 'POST' });
const unstar = id => me.fetch(`/api/my/favorites/${id}`, { method: 'DELETE' });
const mine   = async () => (await me.fetch('/api/my/favorites')).body.link_ids;

describe('starring', () => {
  test('a link a member can see', async () => {
    const link = await c.makeLink({ name: 'Starred' });
    const res = await star(link.id);
    assert.equal(res.status, 200);
    assert.ok((await mine()).includes(link.id));
  });

  test('comes back with the rest of the member\'s page', async () => {
    const link = await c.makeLink({ name: 'In the bundle' });
    await star(link.id);
    const data = await me.fetch('/api/my/data');
    assert.ok(data.body.favorites.includes(link.id), 'no third request needed');
  });

  test('twice is not an error, and is still one star', async () => {
    const link = await c.makeLink({ name: 'Twice' });
    await star(link.id);
    assert.equal((await star(link.id)).status, 200);
    assert.equal((await mine()).filter(id => id === link.id).length, 1);
  });

  test('unstarring takes it out, and unstarring nothing is harmless', async () => {
    const link = await c.makeLink({ name: 'Unstarred' });
    await star(link.id);
    assert.equal((await unstar(link.id)).status, 200);
    assert.ok(!(await mine()).includes(link.id));
    assert.equal((await unstar(link.id)).status, 200, 'again, harmlessly');
  });

  test('a link that does not exist cannot be starred', async () => {
    assert.equal((await star(999999)).status, 404);
  });
});

describe('what the administrator decides still wins', () => {
  test('a hidden link cannot be starred', async () => {
    const link = await c.makeLink({ name: 'Hidden already' });
    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });

    const res = await star(link.id);
    assert.equal(res.status, 404, 'answered as though it did not exist');

    const { db } = require('../src/config/db');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_favorites WHERE link_id = ?')
                   .get(link.id).n, 0, 'and nothing was stored');
  });

  test('hiding a starred link takes it out of favourites, and unhiding puts it back', async () => {
    const link = await c.makeLink({ name: 'Hidden later' });
    await star(link.id);

    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });
    assert.ok(!(await mine()).includes(link.id), 'gone while hidden');

    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: false } });
    assert.ok((await mine()).includes(link.id), 'and the star was kept for when it came back');
  });

  test('a link moved behind a password drops out until it is unlocked', async () => {
    const group = await c.makeGroup({ name: 'Locked later' });
    const link  = await c.makeLink({ name: 'Behind a password', groups: [group.id] });
    await star(link.id);
    assert.ok((await mine()).includes(link.id));

    await c.api(`/api/groups/${group.id}`, {
      method: 'PUT', json: { name: group.name, color: group.color, password: 'group-secret' },
    });
    assert.ok(!(await mine()).includes(link.id), 'locked: not shown');

    const unlock = await me.fetch(`/api/groups/${group.id}/unlock`, {
      method: 'POST', json: { password: 'group-secret' },
    });
    assert.equal(unlock.status, 200);
    assert.ok((await mine()).includes(link.id), 'unlocked: shown again');
  });

  test('a link in a locked group cannot be starred until it is unlocked', async () => {
    const group = await c.makeGroup({ name: 'Locked from the start' });
    await c.api(`/api/groups/${group.id}`, {
      method: 'PUT', json: { name: group.name, color: group.color, password: 'another-secret' },
    });
    const link = await c.makeLink({ name: 'Locked away', groups: [group.id] });

    assert.equal((await star(link.id)).status, 404);
  });

  test('deleting a starred link removes the star with it', async () => {
    const link = await c.makeLink({ name: 'Doomed' });
    await star(link.id);

    await c.api(`/api/links/${link.id}`, { method: 'DELETE' });

    const { db } = require('../src/config/db');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_favorites WHERE link_id = ?')
                   .get(link.id).n, 0, 'no orphan row waiting for the id to be reused');
  });

  test('deleting several links at once removes their stars too', async () => {
    const a = await c.makeLink({ name: 'Bulk A' });
    const b = await c.makeLink({ name: 'Bulk B' });
    await star(a.id);
    await star(b.id);

    const res = await c.api('/api/links/bulk-delete', { method: 'POST', json: { ids: [a.id, b.id] } });
    assert.equal(res.status, 200);

    const { db } = require('../src/config/db');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_favorites WHERE link_id IN (?, ?)')
                   .get(a.id, b.id).n, 0);
  });
});

describe('the member\'s own order', () => {
  test('is the order they were starred in, until they say otherwise', async () => {
    const s = c.session();
    await c.makeUser({ email: 'order@example.test', password: PASSWORD });
    await s.login('order@example.test', PASSWORD);

    const [a, b, d] = [await c.makeLink({ name: 'A' }), await c.makeLink({ name: 'B' }),
                       await c.makeLink({ name: 'D' })];
    for (const l of [a, b, d]) await s.fetch(`/api/my/favorites/${l.id}`, { method: 'POST' });

    assert.deepEqual((await s.fetch('/api/my/favorites')).body.link_ids, [a.id, b.id, d.id]);

    const res = await s.fetch('/api/my/favorites/reorder', {
      method: 'POST', json: { order: [d.id, a.id, b.id] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await s.fetch('/api/my/favorites')).body.link_ids, [d.id, a.id, b.id]);
  });

  test('a reorder cannot add favourites that were never starred', async () => {
    const stranger = await c.makeLink({ name: 'Never starred' });
    const before = await mine();

    await me.fetch('/api/my/favorites/reorder', { method: 'POST', json: { order: [stranger.id, ...before] } });
    assert.ok(!(await mine()).includes(stranger.id));
  });

  test('a garbage reorder is refused', async () => {
    for (const body of [{}, { order: 'x' }, { order: [1, 'two'] }]) {
      assert.equal((await me.fetch('/api/my/favorites/reorder', { method: 'POST', json: body })).status,
                   400, JSON.stringify(body));
    }
  });
});

describe('one member\'s favourites are their own', () => {
  test('another member sees none of them, and cannot reorder them', async () => {
    const link = await c.makeLink({ name: 'Mine, not yours' });
    await star(link.id);
    const before = await mine();

    await c.makeUser({ email: 'other-fan@example.test', password: PASSWORD });
    const other = c.session();
    await other.login('other-fan@example.test', PASSWORD);

    assert.deepEqual((await other.fetch('/api/my/favorites')).body.link_ids, []);

    await other.fetch('/api/my/favorites/reorder', { method: 'POST', json: { order: [...before].reverse() } });
    assert.deepEqual(await mine(), before, 'the first member\'s order is untouched');

    await other.fetch(`/api/my/favorites/${link.id}`, { method: 'DELETE' });
    assert.ok((await mine()).includes(link.id), 'and their unstar did not touch mine');
  });

  test('a stranger and the admin token have no favourites to reach', async () => {
    assert.equal((await c.pub('/api/my/favorites')).status, 401);
    assert.equal((await c.api('/api/my/favorites')).status, 401, 'the token is not a member');
  });

  test('deleting the account takes the stars with it', async () => {
    const user = await c.makeUser({ email: 'gone-fan@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('gone-fan@example.test', PASSWORD);
    const link = await c.makeLink({ name: 'Starred then gone' });
    await s.fetch(`/api/my/favorites/${link.id}`, { method: 'POST' });

    await c.api(`/api/users/${user.id}`, { method: 'DELETE' });

    const { db } = require('../src/config/db');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_favorites WHERE user_id = ?')
                   .get(user.id).n, 0);
  });
});

describe('privacy', () => {
  test('the audit log records a star without saying which link', async () => {
    const link = await c.makeLink({ name: 'A very telling link name' });
    await star(link.id);

    const log = await c.api('/api/audit?limit=50');
    const entry = log.body.entries.find(e => e.action === 'my_favorite.create');
    assert.ok(entry, 'recorded');
    assert.equal(entry.summary, 'Starred a link');

    // The link's name is in the log already — the administrator made the link,
    // and that is recorded as it should be. What must not be there is the name
    // against any of the member's own entries.
    const theirs = log.body.entries.filter(e => e.action.startsWith('my_'));
    assert.ok(theirs.length > 0);
    assert.ok(!JSON.stringify(theirs).includes('very telling'), 'not against the member');
  });

  test('starring does not wake every open page', async () => {
    const { sseClients } = require('../src/services/sseService');
    let woken = 0;
    const fake = { write: () => { woken++; } };
    sseClients.add(fake);
    try {
      const link = await c.makeLink({ name: 'Quiet star' });
      woken = 0;                                    // making the link broadcasts; that is fine
      await star(link.id);
      await new Promise(r => setTimeout(r, 50));
      assert.equal(woken, 0);
    } finally {
      sseClients.delete(fake);
    }
  });
});
