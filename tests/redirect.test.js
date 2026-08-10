// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** /r/:id — click tracking, visibility rules and file streaming. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

/** Follows nothing: we assert on the 302 itself. */
const hit = (id, { ip = '198.51.100.10', headers = {} } = {}) =>
  c.pub(`/r/${id}`, { headers: { 'X-Forwarded-For': ip, 'User-Agent': 'test-agent', ...headers } });

describe('happy path', () => {
  test('redirects to the target and records the click', async () => {
    const link = await c.makeLink({ name: 'Tracked', url: 'https://tracked.invalid/page' });

    const res = await hit(link.id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://tracked.invalid/page');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

    const stats = await c.api('/api/stats');
    assert.equal(stats.body.find(r => r.link_id === link.id).total_clicks, 1);

    const clicks = await c.api(`/api/links/${link.id}/clicks`);
    assert.equal(clicks.status, 200);
    assert.equal(clicks.body.recentClicks.length, 1);
    assert.equal(clicks.body.recentClicks[0].ip_address, '198.51.100.10');
    assert.match(clicks.body.recentClicks[0].user_agent, /test-agent/);
  });

  test('counts repeat visits and unique visitors separately', async () => {
    const link = await c.makeLink({ name: 'Counted' });
    await hit(link.id, { ip: '203.0.113.1' });
    await hit(link.id, { ip: '203.0.113.1' });
    await hit(link.id, { ip: '203.0.113.2' });

    const stats = (await c.api('/api/stats')).body.find(r => r.link_id === link.id);
    assert.equal(stats.total_clicks, 3);
    assert.equal(stats.unique_visitors, 2);

    const top = (await c.api(`/api/links/${link.id}/clicks`)).body.topIps;
    assert.equal(top[0].ip_address, '203.0.113.1');
    assert.equal(top[0].click_count, 2);
  });

  test('a file-backed link redirects to the stored file, which is servable', async () => {
    const link = await c.makeFileLink({ name: 'Handout', fileName: 'handout.txt', type: 'text/plain', bytes: Buffer.from('read me') });
    const res = await hit(link.id);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), link.file_path);

    const served = await c.pub(link.file_path);
    assert.equal(served.status, 200);
    assert.equal(served.text, 'read me');
  });
});

describe('bad input', () => {
  test('a non-numeric id is a 400 and an unknown id a 404', async () => {
    assert.equal((await hit('abc')).status, 400);
    assert.equal((await hit(9999)).status, 404);
  });
});

describe('visibility rules', () => {
  test('a hidden link bounces visitors home but works for the admin', async () => {
    const link = await c.makeLink({ name: 'Hidden', url: 'https://hidden.invalid/x' });
    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });

    const anon = await hit(link.id);
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/');

    const admin = await hit(link.id, { headers: { 'X-Admin-Token': c.token } });
    assert.equal(admin.headers.get('location'), 'https://hidden.invalid/x');

    const stats = (await c.api('/api/stats')).body.find(r => r.link_id === link.id);
    assert.equal(stats.total_clicks, 1, 'only the admin visit was recorded; the bounce is not a click');
  });

  test('a link in a protected group needs the unlock cookie', async () => {
    const group = await c.makeGroup({ name: 'Gated' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Gated', password: 'pw' } });
    const link = await c.makeLink({ name: 'Behind a password', url: 'https://gated.invalid/x', groups: [group.id] });

    const locked = await hit(link.id);
    assert.equal(locked.headers.get('location'), '/', 'bounced while locked');

    const unlock = await c.pub(`/api/groups/${group.id}/unlock`, { method: 'POST', json: { password: 'pw' } });
    const cookie = (unlock.headers.getSetCookie?.() ?? []).find(v => v.startsWith(`lp_grp_${group.id}=`)).split(';')[0];

    const unlocked = await hit(link.id, { headers: { Cookie: cookie } });
    assert.equal(unlocked.headers.get('location'), 'https://gated.invalid/x');

    const asAdmin = await hit(link.id, { headers: { 'X-Admin-Token': c.token } });
    assert.equal(asAdmin.headers.get('location'), 'https://gated.invalid/x');
  });

  test('a link that is also in an open group stays reachable', async () => {
    const locked = await c.makeGroup({ name: 'Locked side' });
    const open   = await c.makeGroup({ name: 'Open side' });
    await c.api(`/api/groups/${locked.id}`, { method: 'PUT', json: { name: 'Locked side', password: 'pw' } });

    const link = await c.makeLink({ name: 'Both', url: 'https://both.invalid/x', groups: [locked.id, open.id] });
    const res = await hit(link.id);
    assert.equal(res.headers.get('location'), 'https://both.invalid/x', 'one open group is enough');
  });

  test('an ungrouped link is open to everyone', async () => {
    const link = await c.makeLink({ name: 'Ungrouped', url: 'https://ungrouped.invalid/x' });
    assert.equal((await hit(link.id)).headers.get('location'), 'https://ungrouped.invalid/x');
  });
});

describe('throttling', () => {
  test('one IP gets 30 redirects per minute, then 429', async () => {
    const link = await c.makeLink({ name: 'Flooded', url: 'https://flooded.invalid/x' });
    const ip = '192.0.2.200';
    for (let i = 0; i < 30; i++) {
      assert.equal((await hit(link.id, { ip })).status, 302, `hit ${i + 1}`);
    }
    assert.equal((await hit(link.id, { ip })).status, 429);
    assert.equal((await hit(link.id, { ip: '192.0.2.201' })).status, 302, 'another visitor is unaffected');
  });
});
