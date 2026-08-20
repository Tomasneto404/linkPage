// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public link requests: feature flag, submission, review, duplicate handling. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { fileForm, svgBytes } = harness;

let c, group;

before(async () => {
  c = await harness.start();
  group = await c.makeGroup({ name: 'Requested into' });
});
after(harness.stop);

const enable  = () => c.api('/api/settings/requests-enabled', { method: 'POST', json: { enabled: true } });
const disable = () => c.api('/api/settings/requests-enabled', { method: 'POST', json: { enabled: false } });

// The public endpoint is throttled to 10 submissions per 10 minutes per IP, so
// every submission comes from its own address unless a test pins one on purpose
// (see "throttling" below, which exercises the limiter deliberately).
let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

/** Submits a request as a visitor. */
const submit = (json, headers = {}) =>
  c.pub('/api/link-requests', {
    method: 'POST',
    json,
    headers: { 'X-Forwarded-For': nextIp(), ...headers },
  });

describe('feature flag', () => {
  test('submissions are refused while the feature is off', async () => {
    await disable();
    const res = await submit({ name: 'Nope', url: 'https://nope.invalid/x', group_id: group.id });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /not enabled/i);
  });

  test('enabling it lets a visitor submit', async () => {
    await enable();
    const res = await submit({ name: 'First request', url: 'https://first.invalid/x', group_id: group.id, description: 'please add' });
    assert.equal(res.status, 201);
    assert.ok(res.body.id > 0);
    assert.equal(res.body.ok, true);
  });
});

describe('submission validation', () => {
  before(enable);

  test('name and a valid http(s) URL are required', async () => {
    const noName = await submit({ url: 'https://x.invalid/a', group_id: group.id });
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/i);

    for (const url of [undefined, '', 'ftp://x.invalid', 'nonsense']) {
      const res = await submit({ name: 'Bad url', url, group_id: group.id });
      assert.equal(res.status, 400, String(url));
      assert.match(res.body.error, /valid http/i);
    }
  });

  test('the group must exist', async () => {
    for (const group_id of [undefined, 0, 9999]) {
      const res = await submit({ name: 'Bad group', url: 'https://x.invalid/a', group_id });
      assert.equal(res.status, 400, String(group_id));
      assert.match(res.body.error, /group/i);
    }
  });

  test('a section must belong to the chosen group', async () => {
    const other   = await c.makeGroup({ name: 'Other group' });
    const section = await c.makeSection(other.id, 'Elsewhere');

    const res = await submit({ name: 'Cross section', url: 'https://x.invalid/a', group_id: group.id, section_id: section.id });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /does not belong/i);
  });

  test('a section inside the chosen group is accepted and echoed in the list', async () => {
    const section = await c.makeSection(group.id, 'Inbox');
    const res = await submit({ name: 'Sectioned', url: 'https://sectioned.invalid/a', group_id: group.id, section_id: section.id });
    assert.equal(res.status, 201);

    const list = await c.api('/api/link-requests?status=pending');
    const row  = list.body.requests.find(r => r.id === res.body.id);
    assert.equal(row.section_id, section.id);
    assert.equal(row.section_name, 'Inbox');
  });

  test('an uploaded icon is stored and registered in the library', async () => {
    const form = fileForm('image', { name: 'req.svg', type: 'image/svg+xml', bytes: svgBytes('#e0115f') }, {
      name: 'With icon', url: 'https://reqicon.invalid/a', group_id: String(group.id),
    });
    const res = await c.pub('/api/link-requests', { method: 'POST', form, headers: { 'X-Forwarded-For': nextIp() } });
    assert.equal(res.status, 201);

    const list = await c.api('/api/link-requests?status=pending');
    const row  = list.body.requests.find(r => r.id === res.body.id);
    assert.match(row.image_path, /^\/uploads\//);
    assert.ok(row.icon_id > 0, 'the admin prefill flow needs the library id');
  });

  test('the submitter IP is recorded', async () => {
    const res = await submit(
      { name: 'From an IP', url: 'https://fromip.invalid/a', group_id: group.id },
      { 'X-Forwarded-For': '203.0.113.9' },
    );
    const list = await c.api('/api/link-requests?status=pending');
    assert.equal(list.body.requests.find(r => r.id === res.body.id).ip_address, '203.0.113.9');
  });
});

describe('throttling', () => {
  before(enable);

  test('one IP gets 10 submissions per window, then 429', async () => {
    const ip = '192.0.2.77';
    for (let i = 0; i < 10; i++) {
      const res = await submit(
        { name: `Flood ${i}`, url: `https://flood-${i}.invalid/x`, group_id: group.id },
        { 'X-Forwarded-For': ip },
      );
      assert.equal(res.status, 201, `submission ${i + 1} should still pass`);
    }
    const blocked = await submit(
      { name: 'Flood 11', url: 'https://flood-11.invalid/x', group_id: group.id },
      { 'X-Forwarded-For': ip },
    );
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.error, /too many/i);

    // A different visitor is unaffected.
    const other = await submit({ name: 'Innocent', url: 'https://innocent.invalid/x', group_id: group.id });
    assert.equal(other.status, 201);
  });
});

describe('request password gate', () => {
  before(enable);

  test('a wrong or missing password is refused, the right one passes', async () => {
    await c.api('/api/settings/request-password', { method: 'POST', json: { password: 'letmein' } });

    const missing = await submit({ name: 'No pw', url: 'https://nopw.invalid/a', group_id: group.id });
    assert.equal(missing.status, 401);

    const wrong = await submit(
      { name: 'Bad pw', url: 'https://badpw.invalid/a', group_id: group.id },
      { 'X-Request-Password': 'nope' },
    );
    assert.equal(wrong.status, 401);

    const ok = await submit(
      { name: 'Good pw', url: 'https://goodpw.invalid/a', group_id: group.id },
      { 'X-Request-Password': 'letmein' },
    );
    assert.equal(ok.status, 201);

    await c.api('/api/settings/request-password', { method: 'DELETE' });
  });
});

describe('admin review', () => {
  before(enable);

  test('list filters by status and reports the pending count', async () => {
    const all     = await c.api('/api/link-requests?status=all');
    const pending = await c.api('/api/link-requests?status=pending');
    assert.equal(pending.status, 200);
    assert.equal(pending.body.pending_count, pending.body.requests.length);
    assert.ok(all.body.requests.length >= pending.body.requests.length);
    assert.ok(pending.body.requests.every(r => r.status === 'pending'));
  });

  test('approve records the published link and drops it from pending', async () => {
    const submitted = await submit({ name: 'To approve', url: 'https://approve.invalid/a', group_id: group.id });
    const link = await c.makeLink({ name: 'Published', url: 'https://approve.invalid/a', groups: [group.id] });

    const res = await c.api(`/api/link-requests/${submitted.body.id}/approve`, { method: 'POST', json: { link_id: link.id } });
    assert.equal(res.status, 200);

    const all = await c.api('/api/link-requests?status=all');
    const row = all.body.requests.find(r => r.id === submitted.body.id);
    assert.equal(row.status, 'approved');
    assert.equal(row.created_link_id, link.id);
    assert.ok(row.reviewed_at, 'stamped');
  });

  test('reject and delete', async () => {
    const a = await submit({ name: 'To reject', url: 'https://reject.invalid/a', group_id: group.id });
    const rej = await c.api(`/api/link-requests/${a.body.id}/reject`, { method: 'POST', json: {} });
    assert.equal(rej.status, 200);
    const rejected = (await c.api('/api/link-requests?status=rejected')).body.requests;
    assert.ok(rejected.some(r => r.id === a.body.id));

    const b = await submit({ name: 'To delete', url: 'https://delete.invalid/a', group_id: group.id });
    const del = await c.api(`/api/link-requests/${b.body.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    const all = (await c.api('/api/link-requests?status=all')).body.requests;
    assert.ok(!all.some(r => r.id === b.body.id));
  });

  test('acting on an unknown request is a 404', async () => {
    for (const [method, url] of [
      ['POST',   '/api/link-requests/9999/approve'],
      ['POST',   '/api/link-requests/9999/reject'],
      ['POST',   '/api/link-requests/9999/attach'],
      ['DELETE', '/api/link-requests/9999'],
    ]) {
      const res = await c.api(url, { method, json: {} });
      assert.equal(res.status, 404, `${method} ${url}`);
    }
  });
});

describe('duplicate detection', () => {
  before(enable);

  test('flags a request whose URL already exists, ignoring scheme/www/slash/fragment', async () => {
    const existing = await c.makeLink({ name: 'Youtube', url: 'https://www.youtube.com/', groups: [group.id] });

    const variants = [
      'http://youtube.com',
      'https://youtube.com/',
      'https://www.youtube.com/#anchor',
      'https://YOUTUBE.com',
    ];
    for (const url of variants) {
      const submitted = await submit({ name: `Dup ${url}`, url, group_id: group.id });
      const list = await c.api('/api/link-requests?status=pending');
      const row  = list.body.requests.find(r => r.id === submitted.body.id);
      assert.ok(row.existing_link, `expected a match for ${url}`);
      assert.equal(row.existing_link.id, existing.id);
      assert.equal(row.existing_link.name, 'Youtube');
      assert.ok(Array.isArray(row.existing_link.groups));
      assert.ok(row.existing_link.groups.every(g => typeof g.id === 'number' && typeof g.name === 'string'));
    }
  });

  test('a different path, query or port is not a duplicate', async () => {
    await c.makeLink({ name: 'Base', url: 'https://distinct.invalid/a' });

    for (const url of ['https://distinct.invalid/b', 'https://distinct.invalid/a?x=1', 'https://distinct.invalid:8443/a']) {
      const submitted = await submit({ name: `Not dup ${url}`, url, group_id: group.id });
      const list = await c.api('/api/link-requests?status=pending');
      const row  = list.body.requests.find(r => r.id === submitted.body.id);
      assert.equal(row.existing_link, null, url);
    }
  });

  test('attach adds the requested group to the existing link instead of duplicating it', async () => {
    const target = await c.makeGroup({ name: 'Attach target' });
    const existing = await c.makeLink({ name: 'Shared', url: 'https://shared.invalid/x', groups: [group.id] });
    const submitted = await submit({ name: 'Shared again', url: 'https://www.shared.invalid/x/', group_id: target.id });

    const linksBefore = (await c.api('/api/links')).body.length;
    const res = await c.api(`/api/link-requests/${submitted.body.id}/attach`, { method: 'POST', json: {} });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.added, true);
    assert.deepEqual(res.body.link.group_ids.sort(), [group.id, target.id].sort());
    assert.equal((await c.api('/api/links')).body.length, linksBefore, 'no second copy of the link');

    const all = (await c.api('/api/link-requests?status=all')).body.requests;
    const row = all.find(r => r.id === submitted.body.id);
    assert.equal(row.status, 'approved');
    assert.equal(row.created_link_id, existing.id);
    assert.equal(row.existing_link.id, existing.id);
  });

  test('attach carries the requested section over', async () => {
    const target  = await c.makeGroup({ name: 'Sectioned target' });
    const section = await c.makeSection(target.id, 'Reading');
    await c.makeLink({ name: 'Sect base', url: 'https://sectbase.invalid/x', groups: [group.id] });
    const submitted = await submit({ name: 'Sect dup', url: 'https://sectbase.invalid/x', group_id: target.id, section_id: section.id });

    const res = await c.api(`/api/link-requests/${submitted.body.id}/attach`, { method: 'POST', json: {} });
    assert.equal(res.body.added, true);
    const membership = res.body.link.groups.find(g => g.id === target.id);
    assert.equal(membership.section_id, section.id);
  });

  test('attach is idempotent when the link is already in that group', async () => {
    await c.makeLink({ name: 'Already there', url: 'https://already.invalid/x', groups: [group.id] });
    const submitted = await submit({ name: 'Already dup', url: 'https://already.invalid/x', group_id: group.id });

    const res = await c.api(`/api/link-requests/${submitted.body.id}/attach`, { method: 'POST', json: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.added, false, 'nothing changed, but the request is still approved');

    const row = (await c.api('/api/link-requests?status=all')).body.requests.find(r => r.id === submitted.body.id);
    assert.equal(row.status, 'approved');
  });

  test('attach is a 409 when no existing link matches', async () => {
    const submitted = await submit({ name: 'Unique', url: 'https://unique-nowhere.invalid/x', group_id: group.id });
    const res = await c.api(`/api/link-requests/${submitted.body.id}/attach`, { method: 'POST', json: {} });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /no existing link/i);
  });

  test('a request that produced its own link is not flagged as a duplicate of itself', async () => {
    const submitted = await submit({ name: 'Self', url: 'https://self.invalid/x', group_id: group.id });
    const link = await c.makeLink({ name: 'Self', url: 'https://self.invalid/x', groups: [group.id] });
    await c.api(`/api/link-requests/${submitted.body.id}/approve`, { method: 'POST', json: { link_id: link.id } });

    const row = (await c.api('/api/link-requests?status=all')).body.requests.find(r => r.id === submitted.body.id);
    assert.equal(row.existing_link.id, row.created_link_id, 'same link → the UI suppresses the chip');
  });
});
