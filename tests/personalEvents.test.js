// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Live updates for a member's own links.
 *
 * An edit to someone's personal page should reach their other open pages — the
 * second tab, the phone — and nobody else's. Over real event streams, opened
 * the way a browser would: one for the member, one for another member, one for
 * a stranger.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
const PASSWORD = 'a-long-enough-password';

before(async () => { c = await harness.start(); });
after(harness.stop);

/**
 * Opens /api/events, optionally as a signed-in member, and collects everything
 * it says until closed.
 */
async function openStream(cookie) {
  const controller = new AbortController();
  const res = await fetch(`${c.baseUrl}/api/events`, {
    signal: controller.signal,
    headers: cookie ? { Cookie: cookie } : {},
  });
  const reader = c.trackReader(res.body.getReader());
  const decoder = new TextDecoder();
  let text = '';
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    } catch { /* aborted */ }
  })();
  return { said: () => text, close: () => controller.abort() };
}

const settle = () => new Promise(r => setTimeout(r, 150));

async function member(email) {
  await c.makeUser({ email, password: PASSWORD });
  const s = c.session();
  await s.login(email, PASSWORD);
  return s;
}

describe('a personal edit', () => {
  test('reaches every one of that member\'s open pages, and no one else\'s', async () => {
    const ana   = await member('ana-live@example.test');
    const bruno = await member('bruno-live@example.test');

    const anaTab   = await openStream(`lp_sess=${ana.sessionCookie}`);
    const anaPhone = await openStream(`lp_sess=${ana.sessionCookie}`);
    const brunos   = await openStream(`lp_sess=${bruno.sessionCookie}`);
    const stranger = await openStream();
    await settle();

    try {
      await ana.fetch('/api/my/groups', { method: 'POST', json: { name: 'Live' } });
      await settle();

      assert.match(anaTab.said(),   /event: personal/, 'her tab hears it');
      assert.match(anaPhone.said(), /event: personal/, 'so does her phone');
      assert.doesNotMatch(brunos.said(),   /event: personal/, 'another member does not');
      assert.doesNotMatch(stranger.said(), /event: personal/, 'nor does a stranger');

      // And none of them is told a *shared* change happened.
      for (const s of [anaTab, anaPhone, brunos, stranger]) {
        assert.doesNotMatch(s.said(), /event: data/);
      }
    } finally {
      for (const s of [anaTab, anaPhone, brunos, stranger]) s.close();
    }
  });

  test('a shared edit still reaches everyone, members included', async () => {
    const carla = await member('carla-live@example.test');
    const hers = await openStream(`lp_sess=${carla.sessionCookie}`);
    const anyone = await openStream();
    await settle();

    try {
      await c.makeLink({ name: 'Shared change', url: 'https://example.com/shared' });
      await settle();
      assert.match(hers.said(),   /event: data/);
      assert.match(anyone.said(), /event: data/);
    } finally {
      hers.close(); anyone.close();
    }
  });

  test('a stream opened with the admin token hears nothing personal', async () => {
    // The token is not an account, so it owns no personal page.
    const dee = await member('dee-live@example.test');
    const controller = new AbortController();
    const res = await fetch(`${c.baseUrl}/api/events`, {
      signal: controller.signal, headers: { 'X-Admin-Token': c.token },
    });
    const reader = c.trackReader(res.body.getReader());
    let text = '';
    const pump = (async () => {
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } }
      catch {}
    })();
    await settle();

    try {
      await dee.fetch('/api/my/groups', { method: 'POST', json: { name: 'Not the token\'s' } });
      await settle();
      assert.doesNotMatch(text, /event: personal/);
    } finally {
      controller.abort();
      await pump;
    }
  });
});
