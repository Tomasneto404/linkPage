// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Administrator moderation of guest contributions.
 *
 * Settings endpoint (mode + retention), guest list, per-guest delete, delete
 * all, and the retention sweep.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, db;
const PASSWORD = 'a-long-enough-password';

before(async () => { c = await harness.start(); db = require('../src/models'); });
after(harness.stop);

const anyone = () => c.api('/api/settings/contributions', { method: 'PUT', json: { mode: 'anyone' } });

describe('settings', () => {
  test('are admin-only, and never guess who called', async () => {
    assert.equal((await c.pub('/api/settings/contributions')).status, 401);
    assert.equal((await c.pub('/api/settings/contributions', { method: 'PUT', json: { mode: 'anyone' }, headers: { Origin: c.baseUrl } })).status, 401);
  });

  test('default is off, with retention off, zero guests', async () => {
    const res = await c.api('/api/settings/contributions');
    assert.deepEqual(res.body, { mode: 'off', retention_days: 0, guest_count: 0 });
  });

  test('an invalid mode is refused', async () => {
    assert.equal((await c.api('/api/settings/contributions', { method: 'PUT', json: { mode: 'everyone' } })).status, 400);
  });

  test('setting mode and retention sticks, and shows up on /api/settings for the page', async () => {
    const res = await c.api('/api/settings/contributions', { method: 'PUT', json: { mode: 'anyone', retention_days: 7 } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { mode: 'anyone', retention_days: 7, guest_count: 0 });
    assert.equal((await c.pub('/api/settings')).body.contribution_mode, 'anyone');
  });

  test('retention zero means forever, and is stored as absence', async () => {
    await c.api('/api/settings/contributions', { method: 'PUT', json: { retention_days: 0 } });
    assert.equal(db.readSetting('guest_retention_days'), null);
  });

  test('setting mode off removes the setting rather than storing "off"', async () => {
    await c.api('/api/settings/contributions', { method: 'PUT', json: { mode: 'off' } });
    assert.equal(db.readSetting('contribution_mode'), null);
  });
});

async function makeGuestWithLink(name = 'Guest link') {
  await anyone();
  const s = c.session();
  const form = new FormData();
  form.append('name', name);
  form.append('url', `https://${Math.random().toString(36).slice(2, 8)}.example.com/`);
  const res = await s.fetch('/api/guest/links', { method: 'POST', form });
  assert.equal(res.status, 201, res.text);
  return s;
}

describe('listing and deleting guests', () => {
  test('the list carries counts and dates', async () => {
    await makeGuestWithLink();
    const list = (await c.api('/api/guests')).body.guests;
    assert.ok(list.length >= 1);
    const g = list[0];
    assert.equal(typeof g.id, 'number');
    assert.equal(typeof g.group_count, 'number');
    assert.equal(typeof g.link_count, 'number');
    assert.ok(g.created_at && g.last_seen_at);
  });

  test('deleting one removes their content; another guest is left alone', async () => {
    await makeGuestWithLink();
    await makeGuestWithLink();
    const before = (await c.api('/api/guests')).body.guests;
    assert.ok(before.length >= 2);

    const victim = before[0];
    const res = await c.api(`/api/guests/${victim.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    const after = (await c.api('/api/guests')).body.guests;
    assert.equal(after.find(g => g.id === victim.id), undefined);
    assert.ok(after.length === before.length - 1);
    assert.equal(db.getGuestById(victim.id), null);
  });

  test('an unknown guest id is 404', async () => {
    assert.equal((await c.api('/api/guests/999999', { method: 'DELETE' })).status, 404);
  });

  test('"remove every guest" clears them all', async () => {
    await makeGuestWithLink();
    const res = await c.api('/api/guests', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.ok(res.body.removed >= 1);
    assert.equal((await c.api('/api/guests')).body.guests.length, 0);
  });

  test('the audit log names what was done', async () => {
    await makeGuestWithLink();
    const victim = (await c.api('/api/guests')).body.guests[0];
    await c.api(`/api/guests/${victim.id}`, { method: 'DELETE' });
    const entries = (await c.api('/api/audit?limit=200')).body.entries || (await c.api('/api/audit?limit=200')).body;
    assert.ok(entries.some(e => e.action === 'guest.delete' || /Removed guest/.test(e.summary || '')));
  });
});

describe('retention sweep', () => {
  const { sweepStaleGuests } = require('../src/controllers/guestAdminController');

  test('with retention off it keeps everybody, however old', async () => {
    await c.api('/api/settings/contributions', { method: 'PUT', json: { retention_days: 0 } });
    await makeGuestWithLink();
    const before = (await c.api('/api/guests')).body.guests.length;
    const far = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const result = await sweepStaleGuests(far);
    assert.equal(result.removed, 0);
    assert.equal((await c.api('/api/guests')).body.guests.length, before);
  });

  test('with retention on it prunes guests last seen past the cutoff', async () => {
    await c.api('/api/settings/contributions', { method: 'PUT', json: { retention_days: 1 } });
    await makeGuestWithLink();
    const before = (await c.api('/api/guests')).body.guests.length;
    const far = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const result = await sweepStaleGuests(far);
    assert.equal(result.removed, before);
    assert.equal((await c.api('/api/guests')).body.guests.length, 0);
  });

  test('and keeps guests seen inside the window', async () => {
    await c.api('/api/settings/contributions', { method: 'PUT', json: { retention_days: 30 } });
    await makeGuestWithLink();
    const result = await sweepStaleGuests(Date.now());
    assert.equal(result.removed, 0);
    assert.ok((await c.api('/api/guests')).body.guests.length >= 1);
  });
});
