// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin token, token rotation and the public password gate. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

describe('admin token', () => {
  test('a fresh install writes a 64-char hex token to DATA_DIR', () => {
    const onDisk = fs.readFileSync(path.join(c.dataDir, 'admin-token.txt'), 'utf8').trim();
    assert.match(onDisk, /^[0-9a-f]{64}$/);
    assert.equal(onDisk, c.token);
  });

  test('verify accepts the real token', async () => {
    const { status, body } = await c.pub('/api/auth/verify', { method: 'POST', json: { token: c.token } });
    assert.equal(status, 200);
    assert.deepEqual(body, { valid: true });
  });

  test('verify rejects a wrong token, a short one and a missing one', async () => {
    for (const json of [{ token: 'f'.repeat(64) }, { token: 'nope' }, {}]) {
      const { status, body } = await c.pub('/api/auth/verify', { method: 'POST', json });
      assert.equal(status, 200, `payload ${JSON.stringify(json)}`);
      assert.deepEqual(body, { valid: false });
    }
  });

  test('admin routes reject a missing or wrong token with JSON 401', async () => {
    const routes = [
      ['GET',    '/api/links/export'],
      ['GET',    '/api/icons'],
      ['GET',    '/api/audit'],
      ['GET',    '/api/analytics'],
      ['GET',    '/api/stats'],
      ['GET',    '/api/version'],
      ['GET',    '/api/ip-tags'],
      ['GET',    '/api/link-requests'],
      ['POST',   '/api/settings/site-title'],
      ['POST',   '/api/groups'],
      ['DELETE', '/api/settings/favicon'],
    ];
    for (const [method, url] of routes) {
      const anon = await c.pub(url, { method, json: {} });
      assert.equal(anon.status, 401, `${method} ${url} without a token`);
      assert.deepEqual(anon.body, { error: 'Unauthorized' });

      const wrong = await c.pub(url, { method, json: {}, headers: { 'X-Admin-Token': 'a'.repeat(64) } });
      assert.equal(wrong.status, 401, `${method} ${url} with a wrong token`);
    }
  });

  test('rotate-token issues a new token, persists it and retires the old one', async () => {
    const old = c.token;
    const { status, body } = await c.api('/api/auth/rotate-token', { method: 'POST' });
    assert.equal(status, 200);
    assert.match(body.token, /^[0-9a-f]{64}$/);
    assert.notEqual(body.token, old);

    assert.equal(fs.readFileSync(path.join(c.dataDir, 'admin-token.txt'), 'utf8').trim(), body.token);

    const withOld = await c.pub('/api/icons', { headers: { 'X-Admin-Token': old } });
    assert.equal(withOld.status, 401, 'the previous token must stop working');

    const withNew = await c.pub('/api/icons', { headers: { 'X-Admin-Token': body.token } });
    assert.equal(withNew.status, 200);

    c.refreshToken();   // keep the shared client usable for the tests below
    assert.equal(c.token, body.token);
  });
});

describe('public password gate', () => {
  test('verify-public passes while no password is configured', async () => {
    const { status, body } = await c.pub('/api/auth/verify-public', { method: 'POST', json: { password: 'anything' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { valid: true });
  });

  test('public reads are open before a password is set', async () => {
    const { status } = await c.pub('/api/links');
    assert.equal(status, 200);
  });

  test('an empty password is rejected', async () => {
    const { status, body } = await c.api('/api/settings/public-password', { method: 'POST', json: { password: '' } });
    assert.equal(status, 400);
    assert.match(body.error, /empty/i);
  });

  test('setting a password gates public reads but not the admin token', async () => {
    const set = await c.api('/api/settings/public-password', { method: 'POST', json: { password: 's3cret' } });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { set: true });

    const settings = await c.pub('/api/settings');
    assert.equal(settings.body.public_password_required, true, '/api/settings stays public and advertises the gate');

    const anon = await c.pub('/api/links');
    assert.equal(anon.status, 401);
    assert.deepEqual(anon.body, { error: 'Password required' });

    const wrong = await c.pub('/api/links', { headers: { 'X-Public-Password': 'nope' } });
    assert.equal(wrong.status, 401);

    const right = await c.pub('/api/links', { headers: { 'X-Public-Password': 's3cret' } });
    assert.equal(right.status, 200);

    const asAdmin = await c.api('/api/links');
    assert.equal(asAdmin.status, 200, 'the admin token bypasses the public gate');
  });

  test('verify-public separates right from wrong once a password exists', async () => {
    const ok   = await c.pub('/api/auth/verify-public', { method: 'POST', json: { password: 's3cret' } });
    const bad  = await c.pub('/api/auth/verify-public', { method: 'POST', json: { password: 'wrong' } });
    const none = await c.pub('/api/auth/verify-public', { method: 'POST', json: {} });
    assert.deepEqual(ok.body,   { valid: true });
    assert.deepEqual(bad.body,  { valid: false });
    assert.deepEqual(none.body, { valid: false });
  });

  test('the stored password is a scrypt hash, never cleartext', () => {
    const { readSetting } = require('../src/models');
    const stored = readSetting('public_password');
    assert.ok(stored.startsWith('scrypt$'), `expected a scrypt hash, got ${stored.slice(0, 12)}…`);
    assert.ok(!stored.includes('s3cret'));
  });

  test('removing the password reopens public reads', async () => {
    const del = await c.api('/api/settings/public-password', { method: 'DELETE' });
    assert.equal(del.status, 204);

    const anon = await c.pub('/api/links');
    assert.equal(anon.status, 200);
  });
});
