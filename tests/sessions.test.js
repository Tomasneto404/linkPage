// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Signing in, staying signed in, and being signed out.
 *
 * The properties worth holding onto:
 *
 *   - What is stored is not a credential. The cookie value never appears in the
 *     database, so a copy of links.db is not a set of working logins.
 *   - Signing out ends the session on the server, not just in the browser. A
 *     cookie someone kept a copy of must stop working.
 *   - Role and account state are read fresh on every request, so disabling
 *     somebody takes effect immediately rather than whenever their session
 *     happens to lapse.
 *   - Failures do not say which part was wrong, so this cannot be used to find
 *     out who has an account here.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const PASSWORD = 'a-long-enough-password';

describe('signing in', () => {
  test('a correct email and password sets an HttpOnly cookie', async () => {
    const user = await c.makeUser({ email: 'sam@example.test', password: PASSWORD });
    const s = c.session();

    const res = await s.login('sam@example.test', PASSWORD);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'sam@example.test');
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.id, user.id);

    const setCookie = (res.headers.getSetCookie?.() ?? []).find(v => v.startsWith('lp_sess='));
    assert.ok(setCookie, 'a session cookie is issued');
    assert.match(setCookie, /HttpOnly/,      'not readable by page scripts');
    assert.match(setCookie, /SameSite=Lax/,  'not sent on a cross-site POST');
    assert.match(setCookie, /Path=\//);
  });

  test('the address is not case-sensitive', async () => {
    await c.makeUser({ email: 'Case@Example.Test', password: PASSWORD });
    const res = await c.session().login('CASE@example.test', PASSWORD);
    assert.equal(res.status, 200);
  });

  test('the password is never echoed back, nor is the hash', async () => {
    const s = c.session();
    const res = await s.login('sam@example.test', PASSWORD);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(PASSWORD), 'no password in the response');
    assert.ok(!text.includes('scrypt'),  'no hash in the response');
    assert.equal(res.body.user.password_hash, undefined);
  });

  test('a wrong password is refused', async () => {
    const res = await c.session().login('sam@example.test', 'not the password');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'bad_credentials');
  });

  test('an address with no account is refused the same way', async () => {
    // Identical body and status to a wrong password: answering differently
    // would turn this endpoint into a list of who has an account here.
    const missing = await c.session().login('nobody@example.test', PASSWORD);
    const wrong   = await c.session().login('sam@example.test', 'wrong');

    assert.equal(missing.status, wrong.status);
    assert.deepEqual(missing.body, wrong.body);
  });

  test('a disabled account cannot sign in', async () => {
    const user = await c.makeUser({ email: 'gone@example.test', password: PASSWORD });
    require('../src/models').updateUser(user.id, { isActive: false });

    const res = await c.session().login('gone@example.test', PASSWORD);
    assert.equal(res.status, 401);
  });

  test('a missing password does not crash it', async () => {
    for (const body of [{}, { email: 'sam@example.test' }, { email: null, password: null }]) {
      const res = await c.pub('/api/auth/login', {
        method: 'POST', json: body, headers: { Origin: c.baseUrl },
      });
      assert.equal(res.status, 401, JSON.stringify(body));
    }
  });
});

describe('being signed in', () => {
  test('the cookie carries across requests', async () => {
    await c.makeUser({ email: 'carry@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('carry@example.test', PASSWORD);

    const me = await s.fetch('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.authenticated, true);
    assert.equal(me.body.user.email, 'carry@example.test');
    assert.equal(me.body.via, 'session');
  });

  test('an anonymous caller is told so, not refused', async () => {
    // Every page load asks this, including anonymous ones. A 401 here would be
    // an error in the console of a page that is working perfectly.
    const res = await c.pub('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, false);
    assert.equal(res.body.user, null);
  });

  test('being signed in is not the same as being an admin', async () => {
    await c.makeUser({ email: 'ordinary@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('ordinary@example.test', PASSWORD);

    const res = await s.fetch('/api/audit');
    assert.equal(res.status, 401, 'an ordinary member cannot read the audit log');
    assert.equal(res.body.code, 'forbidden', 'signing in again would not help');
  });

  test('an admin account reaches the admin routes', async () => {
    await c.makeUser({ email: 'boss@example.test', password: PASSWORD, role: 'admin' });
    const s = c.session();
    await s.login('boss@example.test', PASSWORD);

    assert.equal((await s.fetch('/api/audit')).status, 200);
    assert.equal((await s.fetch('/api/icons')).status, 200);
  });

  test('the admin token still works, alongside accounts', async () => {
    // The whole point of keeping it: an install that never creates an account
    // carries on exactly as before.
    assert.equal((await c.api('/api/audit')).status, 200);
  });

  test('a member is not asked for the public page password', async () => {
    await c.api('/api/settings/public-password', { method: 'POST', json: { password: 'shared-secret' } });
    try {
      const anon = await c.pub('/api/links');
      assert.equal(anon.status, 401, 'a stranger still is');

      await c.makeUser({ email: 'member@example.test', password: PASSWORD });
      const s = c.session();
      await s.login('member@example.test', PASSWORD);
      assert.equal((await s.fetch('/api/links')).status, 200, 'a member is already known');
    } finally {
      await c.api('/api/settings/public-password', { method: 'DELETE' });
    }
  });
});

describe('signing out', () => {
  test('the session dies on the server, not just in the browser', async () => {
    await c.makeUser({ email: 'out@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('out@example.test', PASSWORD);

    // Keep a copy of the cookie, the way a thief would.
    const stolen = s.sessionCookie;
    assert.ok(stolen);

    await s.logout();
    assert.equal(s.sessionCookie, null, 'the browser copy is cleared');

    const replayed = await c.pub('/api/auth/me', { headers: { Cookie: `lp_sess=${stolen}` } });
    assert.equal(replayed.body.authenticated, false, 'the stolen copy is worthless');
  });

  test('signing out when not signed in is fine', async () => {
    const res = await c.pub('/api/auth/logout', { method: 'POST', headers: { Origin: c.baseUrl } });
    assert.equal(res.status, 200);
  });

  test('signing out everywhere leaves the current session alone', async () => {
    await c.makeUser({ email: 'many@example.test', password: PASSWORD });

    const phone  = c.session();
    const laptop = c.session();
    await phone.login('many@example.test', PASSWORD);
    await laptop.login('many@example.test', PASSWORD);

    const res = await laptop.fetch('/api/auth/logout-all', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ended, 1, 'one other session ended');

    assert.equal((await laptop.fetch('/api/auth/me')).body.authenticated, true, 'still here');
    assert.equal((await phone.fetch('/api/auth/me')).body.authenticated, false, 'the phone is out');
  });
});

describe('an account that changes underneath a session', () => {
  test('disabling somebody takes effect on their next request', async () => {
    const user = await c.makeUser({ email: 'soon@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('soon@example.test', PASSWORD);
    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, true);

    require('../src/models').updateUser(user.id, { isActive: false });

    // No session was hunted down and deleted: the lookup joins the account, so
    // the state is read fresh every time.
    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, false);
  });

  test('a demotion takes effect just as fast', async () => {
    const user = await c.makeUser({ email: 'demote@example.test', password: PASSWORD, role: 'admin' });
    const s = c.session();
    await s.login('demote@example.test', PASSWORD);
    assert.equal((await s.fetch('/api/audit')).status, 200);

    require('../src/models').updateUser(user.id, { role: 'user' });
    assert.equal((await s.fetch('/api/audit')).status, 401);
  });

  test('deleting an account takes its sessions with it', async () => {
    const user = await c.makeUser({ email: 'delete@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('delete@example.test', PASSWORD);

    require('../src/models').deleteUser(user.id);
    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, false);
  });
});

describe('what is stored', () => {
  test('the cookie value itself is nowhere in the database', async () => {
    await c.makeUser({ email: 'stored@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('stored@example.test', PASSWORD);

    const { db } = require('../src/config/db');
    const rows = db.prepare('SELECT token_hash FROM sessions').all();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.notEqual(row.token_hash, s.sessionCookie, 'the raw token is not the key');
      assert.match(row.token_hash, /^[0-9a-f]{64}$/, 'it is a sha256 of it');
    }
  });

  test('a forged cookie does not authenticate anybody', async () => {
    const forged = await c.pub('/api/auth/me', { headers: { Cookie: `lp_sess=${'a'.repeat(43)}` } });
    assert.equal(forged.body.authenticated, false);
  });

  test('the token is url-safe, so nothing mangles it in transit', async () => {
    // Cookie values are decodeURIComponent'd on the way back in, and anything
    // malformed is dropped silently — which would look like being randomly
    // signed out. base64url has nothing that needs escaping.
    await c.makeUser({ email: 'safe@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('safe@example.test', PASSWORD);
    assert.match(s.sessionCookie, /^[A-Za-z0-9_-]+$/);
  });
});

describe('sessions you can see and end', () => {
  test('a person sees their own, and which one they are using', async () => {
    await c.makeUser({ email: 'list@example.test', password: PASSWORD });
    const phone  = c.session();
    const laptop = c.session();
    await phone.login('list@example.test', PASSWORD);
    await laptop.login('list@example.test', PASSWORD);

    const res = await laptop.fetch('/api/auth/sessions');
    assert.equal(res.status, 200);
    assert.equal(res.body.sessions.length, 2);
    assert.equal(res.body.sessions.filter(s => s.current).length, 1);
    // A prefix, not the key: enough to name one, not enough to use one.
    for (const s of res.body.sessions) assert.equal(s.id.length, 16);
  });

  test('one can be ended by id', async () => {
    await c.makeUser({ email: 'revoke@example.test', password: PASSWORD });
    const phone  = c.session();
    const laptop = c.session();
    await phone.login('revoke@example.test', PASSWORD);
    await laptop.login('revoke@example.test', PASSWORD);

    const listed = await laptop.fetch('/api/auth/sessions');
    const other  = listed.body.sessions.find(s => !s.current);

    assert.equal((await laptop.fetch(`/api/auth/sessions/${other.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await phone.fetch('/api/auth/me')).body.authenticated, false);
    assert.equal((await laptop.fetch('/api/auth/me')).body.authenticated, true);
  });

  test('somebody else\'s session is not yours to end', async () => {
    await c.makeUser({ email: 'a@example.test', password: PASSWORD });
    await c.makeUser({ email: 'b@example.test', password: PASSWORD });

    const a = c.session();
    const b = c.session();
    await a.login('a@example.test', PASSWORD);
    await b.login('b@example.test', PASSWORD);

    const bsId = (await b.fetch('/api/auth/sessions')).body.sessions[0].id;
    const res  = await a.fetch(`/api/auth/sessions/${bsId}`, { method: 'DELETE' });

    assert.equal(res.status, 404, 'not found, rather than refused — it is not theirs to know about');
    assert.equal((await b.fetch('/api/auth/me')).body.authenticated, true, 'B is untouched');
  });

  test('signing in is refused after too many wrong guesses', async () => {
    await c.makeUser({ email: 'brute@example.test', password: PASSWORD });

    // From its own address. The limiter counts per IP, and every other test in
    // this file shares one — exhausting the shared budget here would leave the
    // rest of the file unable to sign in at all.
    const from = { 'X-Forwarded-For': '203.0.113.77' };

    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await c.pub('/api/auth/login', {
        method: 'POST', headers: { Origin: c.baseUrl, ...from },
        json:   { email: 'brute@example.test', password: `guess-${i}` },
      });
      if (res.status === 429) { limited = true; break; }
    }
    assert.ok(limited, 'the attempts are throttled');

    // And the throttle is on that address, not on the account: the real person
    // can still sign in from somewhere else.
    assert.equal((await c.session().login('brute@example.test', PASSWORD)).status, 200);
  });
});

describe('changing your own password', () => {
  test('it works, and every other session ends', async () => {
    await c.makeUser({ email: 'change@example.test', password: PASSWORD });
    const phone  = c.session();
    const laptop = c.session();
    await phone.login('change@example.test', PASSWORD);
    await laptop.login('change@example.test', PASSWORD);

    const res = await laptop.fetch('/api/auth/password', {
      method: 'POST',
      json:   { current_password: PASSWORD, new_password: 'a-brand-new-password' },
    });
    assert.equal(res.status, 200);

    assert.equal((await laptop.fetch('/api/auth/me')).body.authenticated, true, 'this one stays');
    assert.equal((await phone.fetch('/api/auth/me')).body.authenticated, false, 'the rest go');

    assert.equal((await c.session().login('change@example.test', 'a-brand-new-password')).status, 200);
    assert.equal((await c.session().login('change@example.test', PASSWORD)).status, 401);
  });

  test('the current password has to be right', async () => {
    await c.makeUser({ email: 'wrongcur@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('wrongcur@example.test', PASSWORD);

    const res = await s.fetch('/api/auth/password', {
      method: 'POST',
      json:   { current_password: 'nope', new_password: 'a-brand-new-password' },
    });
    assert.equal(res.status, 401);
  });

  test('a short new password is refused', async () => {
    await c.makeUser({ email: 'short@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('short@example.test', PASSWORD);

    const res = await s.fetch('/api/auth/password', {
      method: 'POST', json: { current_password: PASSWORD, new_password: 'short' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /at least/i);
  });

  test('the admin token has no password to change', async () => {
    const res = await c.api('/api/auth/password', {
      method: 'POST',
      json:   { current_password: 'x', new_password: 'a-brand-new-password' },
    });
    assert.equal(res.status, 400);
  });

  test('an anonymous caller is refused outright', async () => {
    const res = await c.pub('/api/auth/password', {
      method: 'POST', headers: { Origin: c.baseUrl },
      json:   { current_password: 'x', new_password: 'a-brand-new-password' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'auth_required');
  });
});

describe('the audit log', () => {
  test('an action carries who did it', async () => {
    await c.makeUser({ email: 'actor@example.test', password: PASSWORD, role: 'admin' });
    const s = c.session();
    await s.login('actor@example.test', PASSWORD);

    await s.fetch('/api/groups', { method: 'POST', json: { name: 'By a person', color: '#0071e3' } });

    const log = await s.fetch('/api/audit?limit=10');
    const entry = log.body.entries.find(e => e.action === 'group.create');
    assert.ok(entry);
    assert.equal(entry.actor_type, 'user');
    assert.equal(entry.actor_label, 'actor@example.test');
  });

  test('a sign-in is attributed to whoever signed in', async () => {
    // The request arrives anonymous — that is what signing in means — so this
    // only works because the entry is written after the session exists.
    await c.session().login('actor@example.test', PASSWORD);

    const log = await c.api('/api/audit?limit=10');
    const entry = log.body.entries.find(e => e.action === 'auth.login');
    assert.ok(entry);
    assert.equal(entry.actor_type, 'user');
    assert.equal(entry.actor_label, 'actor@example.test');
  });

  test('the admin token is recorded as itself', async () => {
    await c.api('/api/groups', { method: 'POST', json: { name: 'By the token', color: '#0071e3' } });

    const log = await c.api('/api/audit?limit=10');
    const entry = log.body.entries.find(e => e.summary?.includes('By the token'));
    assert.ok(entry);
    assert.equal(entry.actor_type, 'token');
    assert.equal(entry.actor_user_id, null, 'the token is not an account');
  });

  test('a failed sign-in is recorded, though nothing changed', async () => {
    await c.session().login('actor@example.test', 'wrong password entirely');

    const log = await c.api('/api/audit?limit=20');
    const entry = log.body.entries.find(e => e.action === 'auth.login_failed');
    assert.ok(entry, 'the attempt is in the log');
    assert.match(entry.summary, /actor@example\.test/);
  });

  test('a sign-in does not wake every open page', async () => {
    // The audit middleware broadcasts a data update after most mutations. If
    // signing in did that, every public page on the internet would refetch
    // everything because somebody logged in.
    const { sseClients } = require('../src/services/sseService');
    let woken = 0;
    const fake = { write: () => { woken++; } };
    sseClients.add(fake);
    try {
      await c.session().login('actor@example.test', PASSWORD);
      await new Promise(r => setTimeout(r, 50));
      assert.equal(woken, 0);
    } finally {
      sseClients.delete(fake);
    }
  });
});

describe('the admin view has to be asked for', () => {
  // A session is a cookie, so a browser sends it on the public page's own fetch
  // of the link list. Widening on the role alone put hidden links on the public
  // page for any administrator who had signed in to the panel.
  let hidden;

  before(async () => {
    hidden = await c.makeLink({ name: 'Hidden from visitors' });
    const res = await c.api(`/api/links/${hidden.id}/visibility`, { method: 'POST', json: { hidden: true } });
    // Pin the fixture: a link that quietly failed to hide would make every
    // assertion below about the wrong thing.
    assert.equal(res.status, 200);
    assert.equal(res.body.is_hidden, 1, 'the link really is hidden');
    assert.ok(!(await c.pub('/api/links')).body.some(l => l.id === hidden.id),
              'and a stranger really cannot see it');
  });

  test('an admin session sees the visitor view by default', async () => {
    await c.makeUser({ email: 'viewer-admin@example.test', password: PASSWORD, role: 'admin' });
    const s = c.session();
    await s.login('viewer-admin@example.test', PASSWORD);

    const plain = await s.fetch('/api/links');
    assert.ok(!plain.body.some(l => l.id === hidden.id), 'not on the public page');

    const asked = await s.fetch('/api/links?view=admin');
    assert.ok(asked.body.some(l => l.id === hidden.id), 'but there when the panel asks');
  });

  test('an ordinary member cannot ask for it', async () => {
    await c.makeUser({ email: 'viewer-member@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('viewer-member@example.test', PASSWORD);

    const asked = await s.fetch('/api/links?view=admin');
    assert.ok(!asked.body.some(l => l.id === hidden.id));
  });

  test('the token still sees everything, as it always did', async () => {
    const res = await c.api('/api/links');
    assert.ok(res.body.some(l => l.id === hidden.id));
  });

  test('an admin\'s click on a hidden link is treated like anyone\'s', async () => {
    // A click is a navigation, and carries the session. Before accounts it
    // never carried a credential at all, so it never skipped the rules.
    const s = c.session();
    await s.login('viewer-admin@example.test', PASSWORD);
    const res = await s.fetch(`/r/${hidden.id}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/', 'bounced home, as any visitor is');
  });
});
