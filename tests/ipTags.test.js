// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** IP attribution tags: the known-IP feed and tag CRUD. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, link, group;

before(async () => {
  c = await harness.start();
  group = await c.makeGroup({ name: 'Tagged' });
  link  = await c.makeLink({ name: 'Clicked from somewhere', groups: [group.id] });
});
after(harness.stop);

const rows = async () => (await c.api('/api/ip-tags')).body.ips;
const rowFor = async ip => (await rows()).find(r => r.ip_address === ip);

describe('known IPs', () => {
  test('an IP that clicked a link shows up with its activity', async () => {
    await c.pub(`/r/${link.id}`, { headers: { 'X-Forwarded-For': '203.0.113.20' } });
    await c.pub(`/r/${link.id}`, { headers: { 'X-Forwarded-For': '203.0.113.20' } });

    const row = await rowFor('203.0.113.20');
    assert.ok(row, 'listed');
    assert.equal(row.tag, null, 'untagged to begin with');
    assert.ok(row.event_count >= 2);
    assert.ok(row.last_seen);
  });

  test('an IP that only submitted a request also shows up', async () => {
    await c.api('/api/settings/requests-enabled', { method: 'POST', json: { enabled: true } });
    await c.pub('/api/link-requests', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.21' },
      json: { name: 'From a request', url: 'https://fromreq.invalid/x', group_id: group.id },
    });

    assert.ok(await rowFor('203.0.113.21'), 'request submitters count as known IPs');
  });
});

describe('tag CRUD', () => {
  test('upsert stores a tag and the feed reports it', async () => {
    const res = await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: '203.0.113.20', tag: '  Reception  ' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.ip_address, '203.0.113.20');
    assert.equal(res.body.tag, 'Reception', 'trimmed');

    assert.equal((await rowFor('203.0.113.20')).tag, 'Reception');
  });

  test('a second upsert overwrites instead of duplicating', async () => {
    await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: '203.0.113.20', tag: 'Front desk' } });
    const matches = (await rows()).filter(r => r.ip_address === '203.0.113.20');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].tag, 'Front desk');
  });

  test('an IP can be tagged before it has been seen', async () => {
    const res = await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: '10.0.0.5', tag: 'Office NAT' } });
    assert.equal(res.status, 200);
    assert.equal((await rowFor('10.0.0.5')).tag, 'Office NAT');
  });

  test('missing ip_address or an empty tag is a 400', async () => {
    const noIp = await c.api('/api/ip-tags', { method: 'POST', json: { tag: 'Nobody' } });
    assert.equal(noIp.status, 400);
    assert.match(noIp.body.error, /ip_address/);

    for (const tag of ['', '   ', undefined]) {
      const res = await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: '10.0.0.6', tag } });
      assert.equal(res.status, 400, JSON.stringify(tag));
      assert.match(res.body.error, /empty/i);
    }
  });

  test('delete removes the tag but keeps the IP in the feed', async () => {
    const del = await c.api('/api/ip-tags/203.0.113.20', { method: 'DELETE' });
    assert.equal(del.status, 204);

    const row = await rowFor('203.0.113.20');
    assert.ok(row, 'still known — it has clicks');
    assert.equal(row.tag, null);
  });

  test('deleting a tag that does not exist is a 404', async () => {
    assert.equal((await c.api('/api/ip-tags/203.0.113.99', { method: 'DELETE' })).status, 404);
  });

  test('tags survive an IPv6-style address', async () => {
    const ip = '2001:db8::1';
    const res = await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: ip, tag: 'v6 client' } });
    assert.equal(res.status, 200);
    assert.equal((await rowFor(ip)).tag, 'v6 client');

    const del = await c.api(`/api/ip-tags/${encodeURIComponent(ip)}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
  });

  test('tag writes are audited', async () => {
    await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: '10.0.0.7', tag: 'Audited tag' } });
    const top = (await c.api('/api/audit')).body.entries[0];
    assert.match(top.summary, /Tagged IP 10\.0\.0\.7 as "Audited tag"/);
  });
});
