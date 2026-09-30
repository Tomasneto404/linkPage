// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Requests another site made on a visitor's behalf.
 *
 * This became a real problem the moment authentication moved into a cookie. A
 * custom header is never sent cross-site without the other end agreeing to it,
 * so the admin token could not be forged; a cookie is sent automatically, on
 * every request to this origin, including ones a page on another site caused.
 *
 * The defence is where the request says it came from. These tests hold the two
 * halves that matter: a browser-shaped request from elsewhere is refused, and
 * nothing that worked before this existed has stopped working — scripts, the
 * admin token, and the group unlock a visitor does without an account.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const PASSWORD = 'a-long-enough-password';
const EVIL = 'https://attacker.example';

/** A signed-in member, ready to be impersonated. */
async function signedIn(email) {
  await c.makeUser({ email, password: PASSWORD });
  const s = c.session();
  await s.login(email, PASSWORD);
  return s;
}

describe('a request from another site', () => {
  test('is refused when it carries a session', async () => {
    const s = await signedIn('victim@example.test');

    const res = await s.fetch('/api/auth/logout-all', { method: 'POST', origin: EVIL });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'cross_site');
  });

  test('is refused on the strength of fetch metadata too', async () => {
    // Some browsers leave Origin off requests this middleware still has to
    // judge. Sec-Fetch-Site answers the same question.
    const s = await signedIn('meta@example.test');

    const res = await s.fetch('/api/auth/logout-all', {
      method: 'POST', noOrigin: true,
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(res.status, 403);
  });

  test('cannot end somebody\'s session from elsewhere', async () => {
    const s = await signedIn('keepme@example.test');

    const res = await s.fetch('/api/auth/logout', { method: 'POST', origin: EVIL });
    assert.equal(res.status, 403);
    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, true, 'still signed in');
  });

  test('cannot change a password from elsewhere', async () => {
    const s = await signedIn('pw@example.test');

    const res = await s.fetch('/api/auth/password', {
      method: 'POST', origin: EVIL,
      json:   { current_password: PASSWORD, new_password: 'attacker-chosen-value' },
    });
    assert.equal(res.status, 403);
    assert.equal((await c.session().login('pw@example.test', PASSWORD)).status, 200,
                 'the password is unchanged');
  });

  test('cannot reach an admin route with an admin\'s own cookie', async () => {
    await c.makeUser({ email: 'chief@example.test', password: PASSWORD, role: 'admin' });
    const s = c.session();
    await s.login('chief@example.test', PASSWORD);

    const res = await s.fetch('/api/groups', {
      method: 'POST', origin: EVIL, json: { name: 'Planted', color: '#0071e3' },
    });
    assert.equal(res.status, 403);

    const groups = await c.api('/api/groups');
    assert.ok(!groups.body.some(g => g.name === 'Planted'), 'nothing was created');
  });
});

describe('a request from this site', () => {
  test('is allowed', async () => {
    const s = await signedIn('ok@example.test');
    assert.equal((await s.fetch('/api/auth/logout-all', { method: 'POST' })).status, 200);
  });

  test('is allowed when only fetch metadata says so', async () => {
    const s = await signedIn('samesite@example.test');
    const res = await s.fetch('/api/auth/logout-all', {
      method: 'POST', noOrigin: true, headers: { 'Sec-Fetch-Site': 'same-origin' },
    });
    assert.equal(res.status, 200);
  });

  test('is allowed when it is the user typing the address', async () => {
    // Sec-Fetch-Site: none is a top-level navigation the person started.
    const s = await signedIn('typed@example.test');
    const res = await s.fetch('/api/auth/logout-all', {
      method: 'POST', noOrigin: true, headers: { 'Sec-Fetch-Site': 'none' },
    });
    assert.equal(res.status, 200);
  });
});

describe('reads are never blocked', () => {
  test('a cross-site GET is fine, because it changes nothing', async () => {
    const s = await signedIn('reader@example.test');
    const res = await s.fetch('/api/auth/me', { headers: { Origin: EVIL } });
    assert.equal(res.status, 200);
  });
});

describe('what has to keep working', () => {
  test('the admin token, with no Origin at all', async () => {
    // This is the break-glass path, and the shape of every script and curl
    // command anyone has written against this API.
    const res = await c.api('/api/groups', { method: 'POST', json: { name: 'From a script', color: '#0071e3' } });
    assert.equal(res.status, 201);
  });

  test('the admin token, even claiming to come from somewhere else', async () => {
    // A header cannot be set cross-site without a preflight, so a token-bearing
    // request is not a forgery risk whatever it says about its origin. Some
    // proxies rewrite Origin, and an operator must not be locked out by one.
    const res = await c.api('/api/groups', {
      method: 'POST', headers: { Origin: EVIL }, json: { name: 'Proxied', color: '#0071e3' },
    });
    assert.equal(res.status, 201);
  });

  test('an anonymous visitor unlocking a group', async () => {
    const group = await c.makeGroup({ name: 'Locked', password: 'group-secret' });
    await c.api(`/api/groups/${group.id}`, {
      method: 'PUT', json: { name: 'Locked', color: group.color, password: 'group-secret' },
    });

    const res = await c.pub(`/api/groups/${group.id}/unlock`, {
      method: 'POST', json: { password: 'group-secret' },
    });
    assert.notEqual(res.status, 403, 'a visitor with no session is not a forgery risk');
  });

  test('a public link request, submitted by someone with no account', async () => {
    await c.api('/api/settings/requests-enabled', { method: 'POST', json: { enabled: true } });
    const group = await c.makeGroup({ name: 'Suggestions' });

    const form = new FormData();
    form.append('kind', 'link');
    form.append('name', 'A suggestion');
    form.append('url', 'https://example.com/suggested');
    form.append('group_id', String(group.id));

    const res = await c.pub('/api/link-requests', { method: 'POST', form });
    assert.equal(res.status, 201);
  });
});

describe('the boundary itself', () => {
  test('a cookie-bearing write with no evidence of origin is refused', async () => {
    // Nothing to judge it by, and it is carrying a credential the browser
    // attaches on its own. That combination is the one worth refusing.
    const s = await signedIn('silent@example.test');
    const res = await s.fetch('/api/auth/logout-all', { method: 'POST', noOrigin: true });
    assert.equal(res.status, 403);
  });

  test('non-API routes are left alone', async () => {
    // /r/:id records a click and is deliberately open to anything that can
    // follow a link, including a page on another site.
    const link = await c.makeLink({ name: 'Clickable' });
    const res = await c.pub(`/r/${link.id}`, { headers: { Origin: EVIL } });
    assert.equal(res.status, 302);
  });
});
