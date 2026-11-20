// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Aggregate click stats and the analytics dashboard payload. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, popular, quiet;

before(async () => {
  c = await harness.start();
  popular = await c.makeLink({ name: 'Popular', url: 'https://popular.invalid/x' });
  quiet   = await c.makeLink({ name: 'Quiet',   url: 'https://quiet.invalid/x' });

  // 4 visits to the popular link from 3 different visitors, 1 to the quiet one.
  const visits = [
    [popular.id, '198.51.100.1'], [popular.id, '198.51.100.1'],
    [popular.id, '198.51.100.2'], [popular.id, '198.51.100.3'],
    [quiet.id,   '198.51.100.4'],
  ];
  for (const [id, ip] of visits) {
    await c.pub(`/r/${id}`, { headers: { 'X-Forwarded-For': ip, 'User-Agent': 'analytics-test' } });
  }
});
after(harness.stop);

/** /api/stats returns one row per clicked link; zero-click links are omitted. */
const statsFor = (rows, id) => rows.find(r => r.link_id === id);

describe('GET /api/stats', () => {
  test('reports totals and unique visitors per link', async () => {
    const { status, body } = await c.api('/api/stats');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));

    assert.equal(statsFor(body, popular.id).total_clicks, 4);
    assert.equal(statsFor(body, popular.id).unique_visitors, 3);
    assert.equal(statsFor(body, quiet.id).total_clicks, 1);
  });

  test('exposes today and week counters', async () => {
    const row = statsFor((await c.api('/api/stats')).body, popular.id);
    for (const key of ['total_clicks', 'unique_visitors', 'last_clicked', 'clicks_today', 'clicks_this_week']) {
      assert.ok(key in row, `missing ${key}`);
    }
    assert.equal(row.clicks_today, 4, 'the clicks were just made');
    assert.equal(row.clicks_this_week, 4);
  });

  test('a link nobody clicked is simply absent', async () => {
    const untouched = await c.makeLink({ name: 'Never clicked' });
    assert.equal(statsFor((await c.api('/api/stats')).body, untouched.id), undefined);
  });
});

describe('GET /api/links/:id/clicks', () => {
  test('lists recent clicks newest-first with top IPs', async () => {
    const { status, body } = await c.api(`/api/links/${popular.id}/clicks`);
    assert.equal(status, 200);
    assert.equal(body.recentClicks.length, 4);
    assert.ok(body.recentClicks.every(row => row.ip_address && row.clicked_at));

    assert.equal(body.topIps[0].ip_address, '198.51.100.1');
    assert.equal(body.topIps[0].click_count, 2);
  });

  test('a missing link is a 404', async () => {
    assert.equal((await c.api('/api/links/9999/clicks')).status, 404);
  });
});

describe('GET /api/analytics', () => {
  test('returns the dashboard payload for the default period', async () => {
    const { status, body } = await c.api('/api/analytics');
    assert.equal(status, 200);
    assert.equal(body.period, '30d');
    for (const key of ['period', 'totals', 'top_links', 'top_users', 'trend']) {
      assert.ok(key in body, `missing ${key}`);
    }
    assert.equal(body.totals.total_clicks, 5);
    assert.equal(body.totals.unique_visitors, 4);
    assert.ok(body.totals.total_links >= 2);
    assert.equal(body.totals.clicks_today, 5);
  });

  test('ranks the busiest links and visitors', async () => {
    const { body } = await c.api('/api/analytics');
    assert.equal(body.top_links[0].id, popular.id);
    assert.equal(body.top_links[0].total_clicks, 4);
    assert.equal(body.top_links[0].unique_visitors, 3);
    assert.equal(body.top_users[0].ip_address, '198.51.100.1');
    assert.equal(body.top_users[0].click_count, 2);
    assert.equal(body.top_users[0].tag, null, 'untagged until an IP tag is set');
  });

  test('the trend series is per-day and covers the window', async () => {
    const { body } = await c.api('/api/analytics');
    assert.ok(Array.isArray(body.trend));
    assert.ok(body.trend.length > 0);
    assert.ok(body.trend.every(p => 'day' in p && 'clicks' in p));
    assert.equal(body.trend.reduce((sum, p) => sum + p.clicks, 0), 5);
  });

  test('known periods are honoured and unknown ones fall back to 30d', async () => {
    for (const period of ['today', '7d', '30d', '90d', 'all']) {
      const { body } = await c.api(`/api/analytics?period=${period}`);
      assert.equal(body.period, period, period);
    }
    // Anything outside the allow-list is coerced, so no caller-supplied string
    // ever reaches the SQL time filter.
    for (const period of ['bogus', '', '180d', "1' OR '1'='1"]) {
      const { body } = await c.api(`/api/analytics?period=${encodeURIComponent(period)}`);
      assert.equal(body.period, '30d', `"${period}" must not reach SQL`);
    }
  });

  test('an IP tag decorates the top-visitor rows', async () => {
    await c.api('/api/ip-tags', { method: 'POST', json: { ip_address: '198.51.100.1', tag: 'Front desk' } });
    const { body } = await c.api('/api/analytics');
    assert.equal(body.top_users[0].tag, 'Front desk');
  });
});

describe('IP attribution feed', () => {
  test('every visitor IP shows up in the known-IP list', async () => {
    const { status, body } = await c.api('/api/ip-tags');
    assert.equal(status, 200);
    const seen = body.ips.map(r => r.ip_address);
    for (const ip of ['198.51.100.1', '198.51.100.4']) assert.ok(seen.includes(ip), `missing ${ip}`);

    const busiest = body.ips.find(r => r.ip_address === '198.51.100.1');
    assert.ok(busiest.event_count >= 2);
    assert.ok(busiest.last_seen);
  });
});

describe('filtered analytics and comparisons',()=>{
  let group,second,used,unused;
  before(async()=>{
    group=await c.makeGroup({name:'Analytics scope'});second=await c.makeGroup({name:'Overlapping group'});
    used=await c.makeLink({name:'=Report, with commas',groups:[group.id,second.id]});unused=await c.makeLink({name:'No activity in selection',groups:[group.id]});
    const {db}=require('../src/config/db'),insert=db.prepare('INSERT INTO link_clicks(link_id,ip_address,user_agent,clicked_at) VALUES(?,?,?,?)');
    const date=days=>new Date(Date.now()-days*86400000).toISOString().slice(0,19).replace('T',' ');
    for(let index=0;index<3;index++)insert.run(used.id,'203.0.113.1','Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36',date(0));
    for(let index=0;index<2;index++)insert.run(used.id,'203.0.113.2','Mozilla/5.0 (iPhone; CPU iPhone OS 18) AppleWebKit Mobile Safari/605',date(0));
    insert.run(used.id,'203.0.113.3','ExampleCrawler/1.0',date(0));
    for(let index=0;index<2;index++)insert.run(used.id,'203.0.113.1','Mozilla/5.0 Chrome/140.0',date(8));
  });
  test('group scopes do not double-count links shared across groups and compare equal periods',async()=>{
    const {status,body}=await c.api('/api/analytics?period=7d&group_id='+group.id);assert.equal(status,200);
    assert.equal(body.totals.total_clicks,6);assert.equal(body.totals.total_links,2);assert.equal(body.totals.active_links,1);assert.equal(body.totals.unclicked_links,1);assert.equal(body.comparison.previous.total_clicks,2);assert.equal(body.comparison.clicks_change,200);
    assert.equal(body.trend.reduce((sum,row)=>sum+row.clicks,0),6);assert.equal(body.previous_trend.reduce((sum,row)=>sum+row.clicks,0),2);assert.equal(body.heatmap.flat().reduce((sum,n)=>sum+n,0),6);assert.equal(body.top_groups.length,1);assert.equal(body.top_groups[0].clicks,6);
    assert.equal(body.unclicked_links[0].id,unused.id);assert.equal(body.window.timezone,'UTC');assert.equal(body.recent.length,6);
  });
  test('devices, browsers and automation are estimates from recorded agents, and can be filtered',async()=>{
    const data=(await c.api('/api/analytics?period=7d&group_id='+group.id)).body;assert.equal(data.totals.automated_clicks,1);assert.equal(data.devices.find(row=>row.name==='Mobile').clicks,2);assert.equal(data.devices.find(row=>row.name==='Desktop').clicks,3);assert.equal(data.browsers.find(row=>row.name==='Chrome').clicks,3);
    const filtered=(await c.api('/api/analytics?period=7d&exclude_bots=true&group_id='+group.id)).body;assert.equal(filtered.totals.total_clicks,5);assert.equal(filtered.totals.automated_clicks,0);assert.equal(filtered.totals.unique_visitors,2);assert.equal(filtered.recent.some(row=>row.automated),false);
  });
  test('empty scopes and all-time totals have no invented percentage changes',async()=>{
    const empty=await c.makeGroup({name:'Unused analytics group'}),zero=(await c.api('/api/analytics?group_id='+empty.id)).body;
    assert.equal(zero.totals.total_clicks,0);assert.equal(zero.totals.clicks_per_visitor,0);assert.equal(zero.comparison.clicks_change,null);
    const lifetime=(await c.api('/api/analytics?period=all&group_id='+group.id)).body;assert.equal(lifetime.totals.total_clicks,8);assert.equal(lifetime.comparison,null);
    assert.equal((await c.api('/api/analytics?group_id=999999')).status,400);assert.equal((await c.api('/api/analytics?group_id=bad')).status,400);
  });
  test('CSV export uses the same selection, includes zero-click links and escapes spreadsheet formulae',async()=>{
    const exported=await c.api('/api/analytics/export?period=7d&exclude_bots=true&group_id='+group.id);assert.equal(exported.status,200);assert.match(exported.headers.get('content-type'),/text\/csv/);assert.match(exported.text,/No activity in selection/);assert.match(exported.text,/'=Report/);assert.match(exported.text,/,5,2,/);
    assert.equal((await c.pub('/api/analytics/export')).status,401);const user=await c.makeUser(),session=c.session();await session.login(user.email,user.password);assert.equal((await session.fetch('/api/analytics/export')).status,401);
  });
});
