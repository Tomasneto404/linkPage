// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Invites and password resets.
 *
 * Both are one mechanism — a single-use secret with an expiry — so these tests
 * lean on the properties that mechanism has to hold:
 *
 *   - The link is shown once. After that only its hash exists, so nothing can
 *     hand it back, including this API.
 *   - It works exactly once. Two people racing the same link produce one
 *     account, not two, and not an error that leaves the link half-spent.
 *   - Every way of being unusable looks the same from outside. Expired,
 *     revoked, already used and never existed are one answer, or the endpoint
 *     becomes a way to probe which links once existed.
 *   - Nothing about the instance leaks to whoever is holding the link. It may
 *     have been forwarded.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const PASSWORD = 'a-long-enough-password';

/** The secret out of an invite or reset URL. */
const secretOf = url => new URL(url).search.replace(/^\?(invite|reset)=/, '');

async function newInvite(body = {}) {
  const res = await c.api('/api/invites', { method: 'POST', json: body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

describe('issuing an invite', () => {
  test('it comes back as a link to hand over', async () => {
    const invite = await newInvite({ label: 'Sam from accounts' });
    assert.match(invite.url, /\/login\/\?invite=[A-Za-z0-9_-]+$/);
    assert.equal(invite.role, 'user');
    assert.ok(invite.expires_at);
  });

  test('the link is never recoverable afterwards', async () => {
    const invite = await newInvite({ label: 'Only once' });
    const secret = secretOf(invite.url);

    const listed = await c.api('/api/invites');
    const row = listed.body.invites.find(i => i.id === invite.id);
    assert.ok(row, 'the invite is listed');

    const text = JSON.stringify(row);
    assert.ok(!text.includes(secret), 'the secret is not in the listing');
    assert.ok(!text.includes('token_hash'), 'nor is its hash');
  });

  test('it can grant admin, deliberately', async () => {
    const invite = await newInvite({ role: 'admin', label: 'A deputy' });
    assert.equal(invite.role, 'admin');
  });

  test('an ordinary member cannot issue one', async () => {
    await c.makeUser({ email: 'nobody@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('nobody@example.test', PASSWORD);

    assert.equal((await s.fetch('/api/invites', { method: 'POST', json: {} })).status, 401);
    assert.equal((await s.fetch('/api/invites')).status, 401);
  });

  test('an anonymous caller cannot issue one either', async () => {
    const res = await c.pub('/api/invites', {
      method: 'POST', json: {}, headers: { Origin: c.baseUrl },
    });
    assert.equal(res.status, 401);
  });
});

describe('accepting an invite', () => {
  test('it creates the account and signs the person straight in', async () => {
    const invite = await newInvite({ label: 'New starter' });
    const s = c.session();

    const res = await s.fetch(`/api/tokens/${secretOf(invite.url)}/redeem`, {
      method: 'POST',
      json:   { email: 'starter@example.test', password: PASSWORD, display_name: 'A Starter' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'starter@example.test');
    assert.equal(res.body.user.role, 'user');

    // Signed in already — no second trip through the login form.
    const me = await s.fetch('/api/auth/me');
    assert.equal(me.body.authenticated, true);
    assert.equal(me.body.user.email, 'starter@example.test');
  });

  test('an admin invite makes an administrator', async () => {
    const invite = await newInvite({ role: 'admin' });
    const s = c.session();
    await s.fetch(`/api/tokens/${secretOf(invite.url)}/redeem`, {
      method: 'POST', json: { email: 'deputy@example.test', password: PASSWORD },
    });

    assert.equal((await s.fetch('/api/audit')).status, 200);
  });

  test('the same link cannot be used twice', async () => {
    const invite = await newInvite();
    const secret = secretOf(invite.url);

    const first = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'first@example.test', password: PASSWORD },
    });
    assert.equal(first.status, 200);

    const second = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'second@example.test', password: PASSWORD },
    });
    assert.equal(second.status, 400);
    assert.equal(db().getUserByEmail('second@example.test'), null, 'no second account');
  });

  test('two people racing the same link produce one account', async () => {
    const invite = await newInvite();
    const secret = secretOf(invite.url);

    const results = await Promise.all([
      c.session().fetch(`/api/tokens/${secret}/redeem`, {
        method: 'POST', json: { email: 'racer-a@example.test', password: PASSWORD },
      }),
      c.session().fetch(`/api/tokens/${secret}/redeem`, {
        method: 'POST', json: { email: 'racer-b@example.test', password: PASSWORD },
      }),
    ]);

    const won = results.filter(r => r.status === 200);
    assert.equal(won.length, 1, 'exactly one of them got it');

    const accounts = ['racer-a@example.test', 'racer-b@example.test']
      .filter(email => db().getUserByEmail(email));
    assert.equal(accounts.length, 1);
  });

  test('a revoked link stops working', async () => {
    const invite = await newInvite({ label: 'Changed my mind' });
    assert.equal((await c.api(`/api/invites/${invite.id}`, { method: 'DELETE' })).status, 200);

    const res = await c.session().fetch(`/api/tokens/${secretOf(invite.url)}/redeem`, {
      method: 'POST', json: { email: 'revoked@example.test', password: PASSWORD },
    });
    assert.equal(res.status, 400);
  });

  test('an expired link stops working', async () => {
    const invite = await newInvite();
    const { db: raw } = require('../src/config/db');
    raw.prepare("UPDATE user_tokens SET expires_at = datetime('now', '-1 day') WHERE id = ?")
       .run(invite.id);

    const res = await c.session().fetch(`/api/tokens/${secretOf(invite.url)}/redeem`, {
      method: 'POST', json: { email: 'late@example.test', password: PASSWORD },
    });
    assert.equal(res.status, 400);
  });

  test('every kind of bad link answers identically', async () => {
    // Expired, revoked, used and invented must be one answer. Anything else
    // tells a stranger which links once existed.
    const used = await newInvite();
    await c.session().fetch(`/api/tokens/${secretOf(used.url)}/redeem`, {
      method: 'POST', json: { email: 'used@example.test', password: PASSWORD },
    });

    const revoked = await newInvite();
    await c.api(`/api/invites/${revoked.id}`, { method: 'DELETE' });

    const expired = await newInvite();
    require('../src/config/db').db
      .prepare("UPDATE user_tokens SET expires_at = datetime('now', '-1 day') WHERE id = ?")
      .run(expired.id);

    const answers = [];
    for (const secret of [secretOf(used.url), secretOf(revoked.url), secretOf(expired.url),
                          'completely-made-up-value']) {
      const res = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
        method: 'POST', json: { email: `x-${Math.random()}@example.test`, password: PASSWORD },
      });
      answers.push(`${res.status} ${JSON.stringify(res.body)}`);
    }

    assert.equal(new Set(answers).size, 1, `four different answers: ${answers.join(' | ')}`);
  });

  test('an address that already has an account is refused, and the link survives', async () => {
    await c.makeUser({ email: 'taken@example.test', password: PASSWORD });
    const invite = await newInvite();
    const secret = secretOf(invite.url);

    const clash = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'taken@example.test', password: PASSWORD },
    });
    assert.equal(clash.status, 409);

    // The invite was not spent on somebody's typo.
    const retry = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'nottaken@example.test', password: PASSWORD },
    });
    assert.equal(retry.status, 200);
  });

  test('a short password is refused, and the link survives', async () => {
    const invite = await newInvite();
    const secret = secretOf(invite.url);

    const short = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'shortpw@example.test', password: 'abc' },
    });
    assert.equal(short.status, 400);
    assert.match(short.body.error, /at least/i);

    const retry = await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'shortpw@example.test', password: PASSWORD },
    });
    assert.equal(retry.status, 200);
  });

  test('a nonsense address is refused, and the link survives', async () => {
    const invite = await newInvite();
    const secret = secretOf(invite.url);

    assert.equal((await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'not an address', password: PASSWORD },
    })).status, 400);

    assert.equal((await c.session().fetch(`/api/tokens/${secret}/redeem`, {
      method: 'POST', json: { email: 'fine@example.test', password: PASSWORD },
    })).status, 200);
  });
});

describe('looking at a link before using it', () => {
  test('it says the link is good, and what it is for', async () => {
    const invite = await newInvite({ label: 'Sam from accounts' });
    const res = await c.pub(`/api/tokens/${secretOf(invite.url)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.kind, 'invite');
  });

  test('it gives nothing else away', async () => {
    // The person holding this may not be the person it was meant for — links
    // get forwarded. They should learn nothing about the instance from it.
    const invite = await newInvite({ label: 'Sam from accounts' });
    const res = await c.pub(`/api/tokens/${secretOf(invite.url)}`);

    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('Sam'), 'not the label the admin wrote');
    assert.ok(!text.includes('admin@'), 'not who issued it');
    assert.equal(res.body.email, null, 'and no address for an invite');
  });

  test('a bad link is simply not found', async () => {
    const res = await c.pub('/api/tokens/invented-value');
    assert.equal(res.status, 404);
    assert.equal(res.body.valid, false);
  });
});

describe('password resets', () => {
  test('an admin issues a link, and it sets a new password', async () => {
    const user = await c.makeUser({ email: 'forgot@example.test', password: PASSWORD });

    const link = await c.api(`/api/users/${user.id}/reset-link`, { method: 'POST' });
    assert.equal(link.status, 201);
    assert.match(link.body.url, /\/login\/\?reset=/);

    const s = c.session();
    const res = await s.fetch(`/api/tokens/${secretOf(link.body.url)}/redeem`, {
      method: 'POST', json: { password: 'an-entirely-new-password' },
    });
    assert.equal(res.status, 200);
    assert.equal((await s.fetch('/api/auth/me')).body.authenticated, true, 'signed in by it');

    assert.equal((await c.session().login('forgot@example.test', 'an-entirely-new-password')).status, 200);
    assert.equal((await c.session().login('forgot@example.test', PASSWORD)).status, 401);
  });

  test('checking the link shows which account it is for', async () => {
    // Unlike an invite: the person is about to type a password for an existing
    // account, and should see which one.
    const user = await c.makeUser({ email: 'whichone@example.test', password: PASSWORD });
    const link = await c.api(`/api/users/${user.id}/reset-link`, { method: 'POST' });

    const res = await c.pub(`/api/tokens/${secretOf(link.body.url)}`);
    assert.equal(res.body.kind, 'reset');
    assert.equal(res.body.email, 'whichone@example.test');
  });

  test('it ends every session that password had opened', async () => {
    const user = await c.makeUser({ email: 'kickout@example.test', password: PASSWORD });
    const stranger = c.session();
    await stranger.login('kickout@example.test', PASSWORD);
    assert.equal((await stranger.fetch('/api/auth/me')).body.authenticated, true);

    const link = await c.api(`/api/users/${user.id}/reset-link`, { method: 'POST' });
    await c.session().fetch(`/api/tokens/${secretOf(link.body.url)}/redeem`, {
      method: 'POST', json: { password: 'another-new-password' },
    });

    assert.equal((await stranger.fetch('/api/auth/me')).body.authenticated, false,
                 'whoever was in is now out, which is the point of a reset');
  });

  test('issuing a new one retires the previous one', async () => {
    const user = await c.makeUser({ email: 'twice@example.test', password: PASSWORD });

    const first  = await c.api(`/api/users/${user.id}/reset-link`, { method: 'POST' });
    const second = await c.api(`/api/users/${user.id}/reset-link`, { method: 'POST' });

    const stale = await c.session().fetch(`/api/tokens/${secretOf(first.body.url)}/redeem`, {
      method: 'POST', json: { password: 'from-the-old-link' },
    });
    assert.equal(stale.status, 400, 'only the most recent link works');

    const fresh = await c.session().fetch(`/api/tokens/${secretOf(second.body.url)}/redeem`, {
      method: 'POST', json: { password: 'from-the-new-link' },
    });
    assert.equal(fresh.status, 200);
  });
});

describe('the audit trail', () => {
  test('issuing and accepting are both recorded', async () => {
    const invite = await newInvite({ label: 'Audited' });
    await c.session().fetch(`/api/tokens/${secretOf(invite.url)}/redeem`, {
      method: 'POST', json: { email: 'audited@example.test', password: PASSWORD },
    });

    const log = await c.api('/api/audit?limit=20');
    const issued   = log.body.entries.find(e => e.summary?.includes('Invited Audited'));
    const accepted = log.body.entries.find(e => e.action === 'invite.redeem');

    assert.ok(issued,   'the invitation is in the log');
    assert.ok(accepted, 'so is its acceptance');
    assert.match(accepted.summary, /audited@example\.test/);
  });
});

/** The models, for assertions that have no API to go through. */
function db() { return require('../src/models'); }
