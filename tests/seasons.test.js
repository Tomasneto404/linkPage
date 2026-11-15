// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../public/season-calendar');
const harness = require('./helpers/harness');

describe('annual seasonal calendar', () => {
  const schedule = () => ({ ...calendar.defaults(), enabled: true });
  const on = day => new Date(`${day}T12:00:00Z`);
  test('holidays win over seasons, with inclusive dates and a winter spanning New Year', () => {
    for (const [day, expected] of [
      ['2026-12-01', 'christmas'], ['2026-12-31', 'christmas'], ['2027-01-01', 'winter'],
      ['2027-02-28', 'winter'], ['2028-02-29', 'winter'], ['2026-03-01', 'spring'],
      ['2026-06-01', 'summer'], ['2026-09-01', 'autumn'], ['2026-10-24', 'halloween'],
      ['2026-10-31', 'halloween'], ['2026-11-01', 'autumn'],
    ]) assert.equal(calendar.resolve('none', schedule(), on(day)), expected, day);
  });
  test('Easter moves each year and respects before/after boundaries', () => {
    assert.equal(calendar.easter(2026).toISOString().slice(0, 10), '2026-04-05');
    assert.equal(calendar.easter(2027).toISOString().slice(0, 10), '2027-03-28');
    for (const [day, expected] of [['2026-03-28', 'spring'], ['2026-03-29', 'easter'], ['2026-04-06', 'easter'], ['2026-04-07', 'spring'], ['2027-03-28', 'easter']]) {
      assert.equal(calendar.resolve('none', schedule(), on(day)), expected, day);
    }
  });
  test('time zone controls midnight, including daylight saving', () => {
    assert.equal(calendar.resolve('none', schedule(), new Date('2026-05-31T23:01:00Z')), 'summer');
    const s = schedule(); s.timezone = 'America/New_York';
    assert.equal(calendar.resolve('none', s, new Date('2026-06-01T02:00:00Z')), 'spring');
  });
  test('disabled calendars, disabled rules, fallback and explicit priority', () => {
    const s = schedule(); s.rules.forEach(r => { r.enabled = false; });
    assert.equal(calendar.resolve('christmas', s, on('2026-04-05')), 'christmas');
    assert.equal(calendar.resolve('none', s, on('2026-04-05')), 'none');
    s.rules = calendar.defaults().rules.reverse();
    assert.equal(calendar.resolve('none', s, on('2026-12-25')), 'winter');
    s.enabled = false;
    assert.equal(calendar.resolve('easter', s, on('2026-12-25')), 'easter');
  });
  test('rejects bad dates, duplicate themes, zones, types and offsets', () => {
    for (const modify of [
      s => { s.timezone = 'Mars/Olympus'; }, s => { s.enabled = 'true'; },
      s => { s.rules[0].start = '02-30'; }, s => { s.rules[0].end = '13-01'; },
      s => { s.rules[1].before = 61; }, s => { s.rules[1].after = 1.5; },
      s => { s.rules[1].theme = 'christmas'; }, s => { s.rules.pop(); },
    ]) { const s = schedule(); modify(s); assert.throws(() => calendar.validate(s)); }
    assert.deepEqual(calendar.validate(schedule()), schedule());
  });
});

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);
describe('seasonal settings API', () => {
  test('preserves legacy manual selection and exposes a disabled calendar by default', async () => {
    const initial = await c.pub('/api/settings');
    assert.equal(initial.body.season_theme, 'none');
    assert.equal(initial.body.season_schedule.enabled, false);
    assert.equal(initial.body.season_effects, true);
    assert.equal(initial.body.season_background, 'minimal');
    const res = await c.api('/api/settings/season', { method: 'POST', json: { name: 'christmas' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.season_theme, 'christmas');
    assert.equal(res.body.season_manual_theme, 'christmas');
  });
  test('persists and resolves a calendar, rejects invalid edits without partial writes', async () => {
    const schedule = calendar.defaults(); schedule.enabled = true;
    schedule.rules.forEach(r => { r.enabled = false; });
    schedule.rules[0] = { theme: 'christmas', enabled: true, start: '01-01', end: '12-31' };
    const json = { name: 'winter', schedule };
    const res = await c.api('/api/settings/season', { method: 'POST', json });
    assert.equal(res.status, 200);
    const settings = (await c.pub('/api/settings')).body;
    assert.equal(settings.season_theme, 'christmas');
    assert.equal(settings.season_manual_theme, 'winter');
    assert.deepEqual(settings.season_schedule, schedule);
    const invalid = structuredClone(schedule); invalid.rules[0].end = '02-30';
    assert.equal((await c.api('/api/settings/season', { method: 'POST', json: { name: 'easter', schedule: invalid } })).status, 400);
    const after = (await c.pub('/api/settings')).body;
    assert.equal(after.season_manual_theme, 'winter');
    assert.deepEqual(after.season_schedule, schedule);
    assert.equal((await c.api('/api/settings/season', { method: 'POST', json: { name: 'bogus' } })).status, 400);
  });
  test('only an administrator may save a calendar', async () => {
    const res = await c.pub('/api/settings/season', { method: 'POST', json: { name: 'none', schedule: calendar.defaults() } });
    assert.equal(res.status, 401);
  });
  test('effects persist, survive legacy requests and validate before any writes', async () => {
    const off = await c.api('/api/settings/season', { method: 'POST', json: { name: 'spring', effects: false } });
    assert.equal(off.status, 200);
    assert.equal(off.body.season_effects, false);
    assert.equal((await c.pub('/api/settings')).body.season_effects, false);
    await c.api('/api/settings/season', { method: 'POST', json: { name: 'autumn' } });
    assert.equal((await c.pub('/api/settings')).body.season_effects, false, 'omitting effects preserves the preference');
    for (const effects of ['false', 0, null, {}]) {
      const invalid = await c.api('/api/settings/season', { method: 'POST', json: { name: 'winter', effects } });
      assert.equal(invalid.status, 400);
      const settings = (await c.pub('/api/settings')).body;
      assert.equal(settings.season_manual_theme, 'autumn');
      assert.equal(settings.season_effects, false);
    }
    const on = await c.api('/api/settings/season', { method: 'POST', json: { name: 'spring', effects: true } });
    assert.equal(on.body.season_effects, true);
  });
  test('background modes persist independently and reject invalid values without partial writes', async () => {
    for (const background of ['static', 'animated', 'minimal']) {
      const res = await c.api('/api/settings/season', { method: 'POST', json: { name: 'summer', background, effects: false } });
      assert.equal(res.status, 200);
      assert.equal(res.body.season_background, background);
      assert.equal((await c.pub('/api/settings')).body.season_background, background);
    }
    await c.api('/api/settings/season', { method: 'POST', json: { name: 'spring', background: 'animated' } });
    await c.api('/api/settings/season', { method: 'POST', json: { name: 'autumn' } });
    assert.equal((await c.pub('/api/settings')).body.season_background, 'animated');
    for (const background of ['gif', 'bad', false, null]) {
      const res = await c.api('/api/settings/season', { method: 'POST', json: { name: 'winter', background, effects: true } });
      assert.equal(res.status, 400);
      const settings = (await c.pub('/api/settings')).body;
      assert.equal(settings.season_background, 'animated');
      assert.equal(settings.season_manual_theme, 'autumn');
      assert.equal(settings.season_effects, false);
    }
  });
});
