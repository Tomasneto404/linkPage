// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Managing accounts.
 *
 * Most of this file is about the ways an administrator can lock themselves or
 * everybody else out, and the refusals that stop them. The admin token would
 * survive any of it, but an instance whose only way in is a 64-character string
 * in a log file is one where somebody is about to lose an afternoon.
 *
 * The other half is that an ordinary member reaches none of it.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const PASSWORD = 'a-long-enough-password';

/** An admin account with a session, since the token has no id of its own. */
async function adminSession(email) {
  const user = await c.makeUser({ email, password: PASSWORD, role: 'admin' });
  const s = c.session();
  await s.login(email, PASSWORD);
  return { user, s };
}

describe('listing accounts', () => {
  test('an administrator sees them, with no password material', async () => {
    await c.makeUser({ email: 'listed@example.test', password: PASSWORD });

    const res = await c.api('/api/users');
    assert.equal(res.status, 200);

    const row = res.body.users.find(u => u.email === 'listed@example.test');
    assert.ok(row);
    assert.equal(row.role, 'user');
    assert.equal(row.is_active, true);
    assert.equal(row.has_password, true);
    assert.equal(row.password_hash, undefined, 'the hash never leaves the data layer');
    assert.ok(!JSON.stringify(res.body).includes('scrypt'));
  });

  test('an ordinary member sees none of it', async () => {
    await c.makeUser({ email: 'curious@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('curious@example.test', PASSWORD);

    for (const [method, url] of [['GET', '/api/users'], ['GET', '/api/invites']]) {
      assert.equal((await s.fetch(url, { method })).status, 401, `${method} ${url}`);
    }
  });

  test('an anonymous caller sees none of it either', async () => {
    assert.equal((await c.pub('/api/users')).status, 401);
  });
});

describe('changing an account', () => {
  test('a display name and a role can be set', async () => {
    const user = await c.makeUser({ email: 'promote@example.test', password: PASSWORD });

    const res = await c.api(`/api/users/${user.id}`, {
      method: 'PATCH', json: { display_name: 'Promoted Person', role: 'admin' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.display_name, 'Promoted Person');
    assert.equal(res.body.role, 'admin');

    // And it takes effect immediately, with no sign-out in between.
    const s = c.session();
    await s.login('promote@example.test', PASSWORD);
    assert.equal((await s.fetch('/api/audit')).status, 200);
  });

  test('deactivating somebody ends their sessions at once', async () => {
    const user = await c.makeUser({ email: 'suspend@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('suspend@example.test', PASSWORD);

    await c.api(`/api/users/${user.id}`, { method: 'PATCH', json: { is_active: false } });

    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, false);
    assert.equal((await c.session().login('suspend@example.test', PASSWORD)).status, 401,
                 'and they cannot sign back in');
  });

  test('an unknown role is refused', async () => {
    const user = await c.makeUser({ email: 'role@example.test', password: PASSWORD });
    const res = await c.api(`/api/users/${user.id}`, { method: 'PATCH', json: { role: 'wizard' } });
    assert.equal(res.status, 400);
  });

  test('an account that does not exist is a 404', async () => {
    assert.equal((await c.api('/api/users/99999', { method: 'PATCH', json: {} })).status, 404);
  });
});

describe('the ways to lock everybody out', () => {
  test('the last administrator cannot be demoted', async () => {
    // The seeded admin is the only one in a fresh test database.
    const { user, s } = await adminSession('solo@example.test');
    const admins = (await c.api('/api/users')).body.users.filter(u => u.role === 'admin' && u.is_active);

    // Demote every other admin so this one really is the last.
    for (const other of admins) {
      if (other.id !== user.id) {
        await c.api(`/api/users/${other.id}`, { method: 'PATCH', json: { role: 'user' } });
      }
    }

    const res = await c.api(`/api/users/${user.id}`, { method: 'PATCH', json: { role: 'user' } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /only administrator/i);

    // Still an administrator, and still working.
    assert.equal((await s.fetch('/api/audit')).status, 200);
  });

  test('the last administrator cannot be deactivated', async () => {
    const res = await c.api(`/api/users/${onlyAdminId()}`, {
      method: 'PATCH', json: { is_active: false },
    });
    assert.equal(res.status, 409);
  });

  test('the last administrator cannot be deleted', async () => {
    const res = await c.api(`/api/users/${onlyAdminId()}`, { method: 'DELETE' });
    assert.equal(res.status, 409);
  });

  test('once there are two, either may go', async () => {
    // Note the order: who the last admin *is* has to be settled before a second
    // one exists, or there is no "only" to ask about.
    const wasOnly = onlyAdminId();
    const second = await c.makeUser({ email: 'second@example.test', password: PASSWORD, role: 'admin' });

    const res = await c.api(`/api/users/${wasOnly}`, { method: 'PATCH', json: { role: 'user' } });
    assert.equal(res.status, 200, 'no longer the last one');

    // Put things back for the tests that follow.
    await c.api(`/api/users/${wasOnly}`, { method: 'PATCH', json: { role: 'admin' } });
    await c.api(`/api/users/${second.id}`, { method: 'DELETE' });
  });

  test('nobody changes their own role', async () => {
    const { user, s } = await adminSession('self@example.test');
    const res = await s.fetch(`/api/users/${user.id}`, { method: 'PATCH', json: { role: 'user' } });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /your own role/i);
  });

  test('nobody deletes themselves', async () => {
    const { user, s } = await adminSession('selfdelete@example.test');
    const res = await s.fetch(`/api/users/${user.id}`, { method: 'DELETE' });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /your own account/i);
  });

  test('the admin token may still change anyone, having no account of its own', async () => {
    // It is not "somebody" — there is no self for it to protect — so only the
    // last-administrator rule applies to it.
    const user = await c.makeUser({ email: 'bytoken@example.test', password: PASSWORD, role: 'admin' });
    assert.equal((await c.api(`/api/users/${user.id}`, {
      method: 'PATCH', json: { role: 'user' },
    })).status, 200);
  });
});

describe('deleting an account', () => {
  test('it takes the sessions with it', async () => {
    const user = await c.makeUser({ email: 'bye@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('bye@example.test', PASSWORD);

    assert.equal((await c.api(`/api/users/${user.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, false);

    const { db } = require('../src/config/db');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
                   .get(user.id).n, 0, 'no orphan session rows');
  });

  test('it takes their outstanding links with it', async () => {
    const user = await c.makeUser({ email: 'links@example.test', password: PASSWORD });
    await c.api(`/api/users/${user.id}/reset-link`, { method: 'POST' });

    await c.api(`/api/users/${user.id}`, { method: 'DELETE' });

    const { db } = require('../src/config/db');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_tokens WHERE user_id = ?')
                   .get(user.id).n, 0);
  });

  test('an invite they issued survives, with the trail broken rather than the row', async () => {
    const { user } = await adminSession('issuer@example.test');
    const s = c.session();
    await s.login('issuer@example.test', PASSWORD);
    const invite = await s.fetch('/api/invites', { method: 'POST', json: { label: 'Theirs' } });

    await c.api(`/api/users/${user.id}`, { method: 'DELETE' });

    const listed = await c.api('/api/invites');
    const row = listed.body.invites.find(i => i.id === invite.body.id);
    assert.ok(row, 'the invite is still there');
    assert.equal(row.created_by_email, null, 'but no longer points at a deleted account');
  });
});

describe('helping somebody who is locked out', () => {
  test('an admin can set a password directly', async () => {
    const user = await c.makeUser({ email: 'stuck@example.test', password: PASSWORD });

    const res = await c.api(`/api/users/${user.id}/password`, {
      method: 'POST', json: { password: 'issued-by-an-admin' },
    });
    assert.equal(res.status, 200);

    assert.equal((await c.session().login('stuck@example.test', 'issued-by-an-admin')).status, 200);
    assert.equal((await c.session().login('stuck@example.test', PASSWORD)).status, 401);
  });

  test('doing so ends their sessions and asks them to change it', async () => {
    const user = await c.makeUser({ email: 'reset2@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('reset2@example.test', PASSWORD);

    await c.api(`/api/users/${user.id}/password`, {
      method: 'POST', json: { password: 'a-temporary-password' },
    });

    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, false);

    const after = c.session();
    const login = await after.login('reset2@example.test', 'a-temporary-password');
    assert.equal(login.body.user.must_change_password, true,
                 'they are told the password is not really theirs yet');
  });

  test('a short password is refused', async () => {
    const user = await c.makeUser({ email: 'shortset@example.test', password: PASSWORD });
    const res = await c.api(`/api/users/${user.id}/password`, {
      method: 'POST', json: { password: 'abc' },
    });
    assert.equal(res.status, 400);
  });

  test('an admin can sign somebody out everywhere', async () => {
    const user = await c.makeUser({ email: 'kick@example.test', password: PASSWORD });
    const phone  = c.session();
    const laptop = c.session();
    await phone.login('kick@example.test', PASSWORD);
    await laptop.login('kick@example.test', PASSWORD);

    const res = await c.api(`/api/users/${user.id}/logout-all`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ended, 2);

    assert.equal((await phone.fetch('/api/auth/me')).body.authenticated, false);
    assert.equal((await laptop.fetch('/api/auth/me')).body.authenticated, false);

    // Their account is untouched — they can sign back in.
    assert.equal((await c.session().login('kick@example.test', PASSWORD)).status, 200);
  });
});

/** The id of the one remaining active administrator. */
function onlyAdminId() {
  const admins = require('../src/models').getAllUsers()
    .filter(u => u.role === 'admin' && u.is_active);
  assert.equal(admins.length, 1, `expected exactly one admin, found ${admins.length}`);
  return admins[0].id;
}
