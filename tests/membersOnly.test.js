// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Members-only mode: an instance whose public page only signed-in people see.
 *
 * Two halves, and the second matters as much as the first. A stranger must be
 * turned away from everything that shows what is on the page — every listing,
 * every door, the request form, the live channel. And everything signing in
 * itself needs must keep working for that same stranger, or the sign-in page
 * becomes a wall nobody can get past.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, link, group;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c = await harness.start();
  group = await c.makeGroup({ name: 'Members area' });
  link  = await c.makeLink({ name: 'Members only', groups: [group.id] });
  await c.api(`/api/links/${link.id}/slug`, { method: 'PUT', json: { slug: 'members' } }).catch(() => {});
  await c.makeUser({ email: 'member@example.test', password: PASSWORD });
});
after(harness.stop);

const turnOn  = () => c.api('/api/settings/require-login', { method: 'POST', json: { enabled: true } });
const turnOff = () => c.api('/api/settings/require-login', { method: 'POST', json: { enabled: false } });

describe('off, which is how every install starts', () => {
  test('a stranger sees the page exactly as before', async () => {
    assert.equal((await c.pub('/api/settings')).body.require_login, false);
    assert.equal((await c.pub('/api/links')).status, 200);
    assert.equal((await c.pub('/api/groups')).status, 200);
    assert.equal((await c.pub(`/r/${link.id}`)).status, 302);
  });
});

describe('on', () => {
  before(async () => { assert.equal((await turnOn()).status, 200); });
  after(turnOff);

  test('the public settings say so, for the page to act on', async () => {
    assert.equal((await c.pub('/api/settings')).body.require_login, true);
  });

  test('a stranger is refused every listing', async () => {
    for (const url of ['/api/links', '/api/groups']) {
      const res = await c.pub(url);
      assert.equal(res.status, 401, url);
      assert.equal(res.body.code, 'login_required', url);
    }
  });

  test('nothing about the page leaks in the refusal', async () => {
    const res = await c.pub('/api/groups');
    assert.ok(!res.text.includes('Members area'));
  });

  test('a stranger following a link is sent to sign in, and back again afterwards', async () => {
    const res = await c.pub(`/r/${link.id}`);
    assert.equal(res.status, 302);
    const to = new URL(res.headers.get('location'), c.baseUrl);
    assert.equal(to.pathname, '/login/');
    assert.equal(to.searchParams.get('next'), `/r/${link.id}`, 'and lands where it was going');
  });

  test('the same for a slug', async () => {
    const res = await c.pub('/f/anything-at-all');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login\/\?next=/);
  });

  test('a stranger cannot unlock groups, send requests or watch the live channel', async () => {
    await c.api('/api/settings/requests-enabled', { method: 'POST', json: { enabled: true } });

    const unlock = await c.pub(`/api/groups/${group.id}/unlock`, {
      method: 'POST', json: { password: 'x' }, headers: { Origin: c.baseUrl },
    });
    assert.equal(unlock.status, 401);

    const form = new FormData();
    form.append('kind', 'link'); form.append('name', 'Sneaky');
    form.append('url', 'https://example.com'); form.append('group_id', String(group.id));
    const request = await c.pub('/api/link-requests', { method: 'POST', form });
    assert.equal(request.status, 401);

    const events = await c.pub('/api/events');
    assert.equal(events.status, 401);
  });

  test('a member sees everything, and follows links normally', async () => {
    const s = c.session();
    await s.login('member@example.test', PASSWORD);

    const links = await s.fetch('/api/links');
    assert.equal(links.status, 200);
    assert.ok(links.body.some(l => l.id === link.id));
    assert.equal((await s.fetch('/api/groups')).status, 200);

    const go = await s.fetch(`/r/${link.id}`);
    assert.equal(go.status, 302);
    assert.doesNotMatch(go.headers.get('location'), /\/login\//, 'straight to the link');
  });

  test('the admin token still reaches everything', async () => {
    assert.equal((await c.api('/api/links')).status, 200);
    assert.equal((await c.api('/api/groups')).status, 200);
  });

  test('everything signing in needs still works for a stranger', async () => {
    // Otherwise the sign-in page is a wall: these are what it is built from.
    assert.equal((await c.pub('/api/settings')).status, 200, 'its look');
    assert.equal((await c.pub('/api/auth/me')).status, 200, 'who am I');
    assert.equal((await c.pub('/api/auth/providers')).status, 200, 'how to sign in');
    assert.equal((await c.pub('/login/')).status, 200, 'the page itself');

    const login = await c.session().login('member@example.test', PASSWORD);
    assert.equal(login.status, 200, 'and signing in');

    const invite = await c.api('/api/invites', { method: 'POST', json: {} });
    const token = new URL(invite.body.url).searchParams.get('invite');
    assert.equal((await c.pub(`/api/tokens/${token}`)).status, 200, 'and accepting an invite');
  });
});

describe('turning it on', () => {
  test('only an administrator can', async () => {
    const s = c.session();
    await s.login('member@example.test', PASSWORD);
    const res = await s.fetch('/api/settings/require-login', { method: 'POST', json: { enabled: true } });
    assert.equal(res.status, 401);
    assert.equal((await c.pub('/api/settings')).body.require_login, false);
  });

  test('is refused while nobody could sign in', async () => {
    const db = require('../src/models');
    const users = db.getAllUsers();
    for (const u of users) db.updateUser(u.id, { isActive: false });
    try {
      const res = await turnOn();
      assert.equal(res.status, 409, 'a sign-in page nobody can pass is not a setting');
      assert.equal((await c.pub('/api/settings')).body.require_login, false);
    } finally {
      for (const u of users) db.updateUser(u.id, { isActive: u.is_active });
    }
  });

  test('turning it off forgets it rather than storing "off"', async () => {
    await turnOn();
    await turnOff();
    assert.equal(require('../src/models').readSetting('require_login'), null);
  });
});
