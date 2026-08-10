// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Groups, sections/subsections and the per-group password gate. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

/** Pulls the lp_grp_<id> cookie out of a Set-Cookie header. */
function unlockCookie(headers, groupId) {
  const raw = headers.getSetCookie?.() ?? [headers.get('set-cookie')].filter(Boolean);
  const hit = raw.find(v => v.startsWith(`lp_grp_${groupId}=`));
  return hit ? hit.split(';')[0] : null;
}

describe('group CRUD', () => {
  test('creates with a name and colour', async () => {
    const { status, body } = await c.api('/api/groups', { method: 'POST', json: { name: '  Docs  ', color: '#Ff9F0a' } });
    assert.equal(status, 201);
    assert.equal(body.name, 'Docs', 'trimmed');
    assert.match(body.color, /^#[0-9a-fA-F]{6}$/);
    assert.equal(body.is_protected, false);
    assert.equal(body.unlock_mode, 'timeout', 'default mode');
    assert.ok(!('password_hash' in body), 'the hash never goes over the wire');
  });

  test('rejects an empty name and falls back on a bad colour', async () => {
    const noName = await c.api('/api/groups', { method: 'POST', json: { name: '   ' } });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/i);

    const badColor = await c.api('/api/groups', { method: 'POST', json: { name: 'Fallback', color: 'chartreuse' } });
    assert.equal(badColor.status, 201);
    assert.equal(badColor.body.color, '#0071e3', 'invalid colour falls back to the default');
  });

  test('updates name, colour and unlock mode', async () => {
    const group = await c.makeGroup({ name: 'Before' });
    const { status, body } = await c.api(`/api/groups/${group.id}`, {
      method: 'PUT',
      json: { name: 'After', color: '#30d158', unlock_mode: 'session' },
    });
    assert.equal(status, 200);
    assert.equal(body.name, 'After');
    assert.equal(body.color, '#30d158');
    assert.equal(body.unlock_mode, 'session');
  });

  test('an unknown unlock mode is coerced to the default', async () => {
    const group = await c.makeGroup({ name: 'Mode' });
    const { body } = await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Mode', unlock_mode: 'forever' } });
    assert.equal(body.unlock_mode, 'timeout');
  });

  test('updating or deleting a missing group is a 404', async () => {
    assert.equal((await c.api('/api/groups/9999', { method: 'PUT', json: { name: 'x' } })).status, 404);
    assert.equal((await c.api('/api/groups/9999', { method: 'DELETE' })).status, 404);
  });

  test('list is public and reports link counts', async () => {
    const group = await c.makeGroup({ name: 'Counted' });
    await c.makeLink({ name: 'One', groups: [group.id] });
    await c.makeLink({ name: 'Two', groups: [group.id] });

    const { status, body } = await c.pub('/api/groups');
    assert.equal(status, 200);
    const found = body.find(g => g.id === group.id);
    assert.equal(found.link_count, 2);
  });

  test('reorder rewrites positions', async () => {
    const a = await c.makeGroup({ name: 'Order A' });
    const b = await c.makeGroup({ name: 'Order B' });

    const res = await c.api('/api/groups/reorder', { method: 'POST', json: { order: [b.id, a.id] } });
    assert.equal(res.status, 204);

    const groups = (await c.pub('/api/groups')).body.filter(g => [a.id, b.id].includes(g.id));
    assert.deepEqual(groups.map(g => g.id), [b.id, a.id]);
  });

  test('deleting a group drops its memberships and sections', async () => {
    const group   = await c.makeGroup({ name: 'Doomed' });
    const section = await c.makeSection(group.id, 'Gone soon');
    const link    = await c.makeLink({ name: 'Orphan to be', groups: [{ group_id: group.id, section_id: section.id }] });

    const del = await c.api(`/api/groups/${group.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const groups = (await c.pub('/api/groups')).body;
    assert.ok(!groups.some(g => g.id === group.id));

    const links = (await c.api('/api/links')).body;
    const orphan = links.find(l => l.id === link.id);
    assert.ok(orphan, 'the link itself survives');
    assert.deepEqual(orphan.group_ids, [], 'but loses the membership');

    assert.equal((await c.api(`/api/sections/${section.id}`, { method: 'PUT', json: { name: 'x' } })).status, 404,
      'the section went with the group');
  });
});

describe('sections and subsections', () => {
  test('creates a section, then one level of subsection', async () => {
    const group   = await c.makeGroup({ name: 'Nested' });
    const section = await c.makeSection(group.id, 'Top');
    assert.equal(section.group_id, group.id);
    assert.equal(section.parent_section_id, null);

    const sub = await c.makeSection(group.id, 'Child', section.id);
    assert.equal(sub.parent_section_id, section.id);

    const listed = (await c.pub('/api/groups')).body.find(g => g.id === group.id);
    assert.ok(listed.sections.some(s => s.id === section.id));
  });

  test('refuses a second nesting level', async () => {
    const group   = await c.makeGroup({ name: 'Deep' });
    const section = await c.makeSection(group.id, 'Top');
    const sub     = await c.makeSection(group.id, 'Child', section.id);

    const res = await c.api(`/api/groups/${group.id}/sections`, { method: 'POST', json: { name: 'Grandchild', parent_section_id: sub.id } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /subsections cannot have/i);
  });

  test('refuses a parent from another group', async () => {
    const a = await c.makeGroup({ name: 'Group A' });
    const b = await c.makeGroup({ name: 'Group B' });
    const inA = await c.makeSection(a.id, 'In A');

    const res = await c.api(`/api/groups/${b.id}/sections`, { method: 'POST', json: { name: 'Cross', parent_section_id: inA.id } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /does not belong/i);
  });

  test('validates name and group', async () => {
    const group = await c.makeGroup({ name: 'Validation' });
    assert.equal((await c.api(`/api/groups/${group.id}/sections`, { method: 'POST', json: { name: '  ' } })).status, 400);
    assert.equal((await c.api('/api/groups/9999/sections', { method: 'POST', json: { name: 'x' } })).status, 404);
  });

  test('renames, reorders and deletes', async () => {
    const group = await c.makeGroup({ name: 'Editable sections' });
    const one   = await c.makeSection(group.id, 'One');
    const two   = await c.makeSection(group.id, 'Two');

    const renamed = await c.api(`/api/sections/${one.id}`, { method: 'PUT', json: { name: 'Renamed' } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, 'Renamed');

    const order = await c.api('/api/sections/reorder', { method: 'POST', json: { order: [two.id, one.id] } });
    assert.equal(order.status, 204);

    const del = await c.api(`/api/sections/${two.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const listed = (await c.pub('/api/groups')).body.find(g => g.id === group.id);
    assert.ok(!listed.sections.some(s => s.id === two.id));
  });

  test('deleting a parent section takes its subsections with it', async () => {
    const group = await c.makeGroup({ name: 'Cascade' });
    const top   = await c.makeSection(group.id, 'Top');
    const sub   = await c.makeSection(group.id, 'Child', top.id);

    assert.equal((await c.api(`/api/sections/${top.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await c.api(`/api/sections/${sub.id}`, { method: 'PUT', json: { name: 'x' } })).status, 404);
  });
});

describe('password-protected groups', () => {
  test('setting a password marks the group protected without leaking the hash', async () => {
    const group = await c.makeGroup({ name: 'Private' });
    const { status, body } = await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Private', password: 'hunter2' } });
    assert.equal(status, 200);
    assert.equal(body.is_protected, true);
    assert.ok(!('password_hash' in body));

    const listed = (await c.pub('/api/groups')).body.find(g => g.id === group.id);
    assert.equal(listed.is_protected, true);
    assert.equal(listed.is_unlocked, false, 'locked for a visitor with no cookie');
  });

  test('links in a protected group are hidden until the group is unlocked', async () => {
    const group = await c.makeGroup({ name: 'Vault' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Vault', password: 'open-sesame' } });
    const link = await c.makeLink({ name: 'Treasure', groups: [group.id] });

    const locked = await c.pub('/api/links');
    assert.ok(!locked.body.some(l => l.id === link.id), 'not served while locked');

    const wrong = await c.pub(`/api/groups/${group.id}/unlock`, { method: 'POST', json: { password: 'nope' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, { valid: false, error: 'Wrong password' });

    const ok = await c.pub(`/api/groups/${group.id}/unlock`, { method: 'POST', json: { password: 'open-sesame' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.valid, true);
    assert.equal(ok.body.unlock_mode, 'timeout');
    assert.ok(ok.body.expires_at > Date.now());

    const cookie = unlockCookie(ok.headers, group.id);
    assert.ok(cookie, 'an HMAC-signed cookie is issued');

    const unlocked = await c.pub('/api/links', { headers: { Cookie: cookie } });
    assert.ok(unlocked.body.some(l => l.id === link.id), 'served with the cookie');

    const asAdmin = await c.api('/api/links');
    assert.ok(asAdmin.body.some(l => l.id === link.id), 'the admin always sees it');
  });

  test('a forged cookie does not unlock anything', async () => {
    const group = await c.makeGroup({ name: 'Forged' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Forged', password: 'pw' } });
    const link = await c.makeLink({ name: 'Hidden', groups: [group.id] });

    const forged = `lp_grp_${group.id}=${Date.now() + 60000}.deadbeef`;
    const res = await c.pub('/api/links', { headers: { Cookie: forged } });
    assert.ok(!res.body.some(l => l.id === link.id));
  });

  test('lock clears the cookie', async () => {
    const group = await c.makeGroup({ name: 'Lockable' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Lockable', password: 'pw' } });

    const res = await c.pub(`/api/groups/${group.id}/lock`, { method: 'POST', json: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const cleared = (res.headers.getSetCookie?.() ?? []).find(v => v.startsWith(`lp_grp_${group.id}=`));
    assert.match(cleared, /Max-Age=0/);
  });

  test('session mode issues a browser-session cookie with a longer server TTL', async () => {
    const group = await c.makeGroup({ name: 'Session' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Session', password: 'pw', unlock_mode: 'session' } });

    const ok = await c.pub(`/api/groups/${group.id}/unlock`, { method: 'POST', json: { password: 'pw' } });
    assert.equal(ok.body.unlock_mode, 'session');
    assert.ok(ok.body.ttl_ms > 60_000, 'session unlocks last well beyond the 30 s timeout mode');
    const raw = (ok.headers.getSetCookie?.() ?? []).find(v => v.startsWith(`lp_grp_${group.id}=`));
    assert.ok(!/Max-Age/.test(raw), 'no Max-Age → the browser drops it when the session ends');
  });

  test('clearing the password reopens the group', async () => {
    const group = await c.makeGroup({ name: 'Reopened' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Reopened', password: 'pw' } });
    const link = await c.makeLink({ name: 'Inside', groups: [group.id] });
    assert.ok(!(await c.pub('/api/links')).body.some(l => l.id === link.id));

    // An empty string is the documented "remove the password" signal.
    const cleared = await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Reopened', password: '' } });
    assert.equal(cleared.body.is_protected, false);
    assert.ok((await c.pub('/api/links')).body.some(l => l.id === link.id));
  });

  test('unlocking a group that has no password just succeeds', async () => {
    const group = await c.makeGroup({ name: 'Open' });
    const res = await c.pub(`/api/groups/${group.id}/unlock`, { method: 'POST', json: { password: '' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, true);
  });

  test('unlock validates the group id', async () => {
    assert.equal((await c.pub('/api/groups/abc/unlock', { method: 'POST', json: {} })).status, 400);
    assert.equal((await c.pub('/api/groups/9999/unlock', { method: 'POST', json: {} })).status, 404);
  });
});
