// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Audit log: what gets recorded, filters, pagination, export and pruning. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const entries = async (query = '') => (await c.api(`/api/audit${query}`)).body.entries;
const newest  = async (query = '') => (await entries(query))[0];

describe('what gets recorded', () => {
  test('creating a link writes a link.create entry with the name in the summary', async () => {
    await c.makeLink({ name: 'Audited link', url: 'https://audited.invalid/x' });
    const top = await newest();
    assert.equal(top.action, 'link.create');
    assert.equal(top.entity_type, 'link');
    assert.match(top.summary, /Audited link/);
    assert.ok(top.created_at);
  });

  test('group, section and settings mutations each get their own action', async () => {
    const group = await c.makeGroup({ name: 'Audited group' });
    assert.equal((await newest()).action, 'group.create');

    await c.makeSection(group.id, 'Audited section');
    assert.equal((await newest()).action, 'section.create');

    await c.api('/api/settings/site-title', { method: 'POST', json: { title: 'Audited title' } });
    const settings = await newest();
    assert.equal(settings.action, 'settings.site_title');
    assert.equal(settings.entity_type, 'settings');

    await c.api(`/api/groups/${group.id}`, { method: 'DELETE' });
    assert.equal((await newest()).action, 'group.delete');
  });

  test('a click is recorded as its own entity type', async () => {
    const link = await c.makeLink({ name: 'Clicked link' });
    await c.pub(`/r/${link.id}`, { headers: { 'X-Forwarded-For': '198.51.100.55', 'User-Agent': 'audit-agent' } });

    const click = (await entries('?type=click'))[0];
    assert.equal(click.action, 'link.click');
    assert.equal(click.entity_id, link.id);
    assert.equal(click.ip_address, '198.51.100.55');
    assert.match(click.user_agent, /audit-agent/);
  });

  test('reads and failed writes are not recorded', async () => {
    const before = (await c.api('/api/audit')).body.total;

    await c.api('/api/links');                                                   // GET
    await c.api('/api/settings');                                                // GET
    await c.api('/api/groups', { method: 'POST', json: { name: '' } });           // 400
    await c.pub('/api/groups', { method: 'POST', json: { name: 'Sneaky' } });     // 401

    assert.equal((await c.api('/api/audit')).body.total, before, 'nothing new');
  });

  test('token rotation is audited', async () => {
    await c.api('/api/auth/rotate-token', { method: 'POST' });
    c.refreshToken();
    const top = await newest();
    assert.match(top.action, /^auth\./);
  });
});

describe('querying', () => {
  test('the response carries total, count and the entries', async () => {
    const { status, body } = await c.api('/api/audit');
    assert.equal(status, 200);
    assert.ok(body.total > 0);
    assert.equal(body.count, body.entries.length);
    assert.ok(body.entries.every(e => e.id && e.action && e.created_at));
  });

  test('entries come back newest-first', async () => {
    const ids = (await entries()).map(e => e.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  });

  test('?type= filters by entity type', async () => {
    const links = await entries('?type=link');
    assert.ok(links.length > 0);
    assert.ok(links.every(e => e.entity_type === 'link'));

    assert.deepEqual(await entries('?type=nonexistent'), []);
  });

  test('?q= searches action and summary, case-insensitively', async () => {
    const hits = await entries('?q=audited%20link');
    assert.ok(hits.length > 0);
    assert.ok(hits.every(e => /audited link/i.test(e.summary)));

    const byAction = await entries('?q=SETTINGS.SITE_TITLE');
    assert.ok(byAction.length > 0);
  });

  test('?limit= caps the page and ?after= fetches only newer rows', async () => {
    const one = await entries('?limit=1');
    assert.equal(one.length, 1);

    const marker = one[0].id;
    assert.deepEqual(await entries(`?after=${marker}`), [], 'nothing newer yet');

    await c.makeLink({ name: 'Newer than the marker' });
    const incremental = await entries(`?after=${marker}`);
    assert.ok(incremental.length >= 1);
    assert.ok(incremental.every(e => e.id > marker));
  });

  test('?before= pages backwards', async () => {
    const all = await entries();
    const middle = all[1].id;
    const older = await entries(`?before=${middle}`);
    assert.ok(older.every(e => e.id < middle));
  });
});

describe('export', () => {
  test('CSV carries a header row, a BOM and the entries', async () => {
    const res = await c.api('/api/audit/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /audit-log-\d{4}-\d{2}-\d{2}\.csv/);

    const [header] = res.text.replace('﻿', '').split('\r\n');
    assert.equal(header, 'id,created_at,action,entity_type,entity_id,summary,ip_address,user_agent');
    assert.ok(res.text.includes('link.create'));

    // fetch().text() strips the BOM while decoding, so check the raw bytes.
    const raw = Buffer.from(await (await fetch(`${c.baseUrl}/api/audit/export`, {
      headers: { 'X-Admin-Token': c.token },
    })).arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel reads accents');
  });

  test('JSON export mirrors the filters', async () => {
    const res = await c.api('/api/audit/export?format=json&type=click');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.ok(res.body.count >= 1);
    assert.ok(res.body.entries.every(e => e.entity_type === 'click'));
    assert.ok(res.body.exported_at);
  });
});

describe('clearing', () => {
  test('?days= keeps recent entries', async () => {
    const before = (await c.api('/api/audit')).body.total;
    const res = await c.api('/api/audit?days=30', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.removed, 0, 'everything here was written seconds ago');
    // The prune itself is audited, so the count can only have grown by that entry.
    assert.ok((await c.api('/api/audit')).body.total >= before);
  });

  test('a bare DELETE clears the whole log', async () => {
    const res = await c.api('/api/audit', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.ok(res.body.removed > 0);

    // Only the entry recording this very clear survives.
    const after = await c.api('/api/audit');
    assert.ok(after.body.total <= 1);
    if (after.body.total === 1) assert.match(after.body.entries[0].action, /^audit\./);
  });
});
