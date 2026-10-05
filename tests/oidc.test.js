// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Single sign-on through OpenID Connect, against a fake provider shaped like
 * Authentik (tests/helpers/fakeOidc.js).
 *
 * Most of this file is refusals. A sign-in that works is one test; the rest
 * is every way the return trip can be forged, replayed or misdirected, and the
 * ID tokens a hostile provider — or a man in the middle — could hand back.
 * Each must leave the browser signed out.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { startFakeOidc } = require('./helpers/fakeOidc');

let c, fake, db;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c    = await harness.start();
  fake = await startFakeOidc();
  db   = require('../src/models');
});
after(async () => { await fake?.stop(); await harness.stop(); });

const configure = body => c.api('/api/settings/oidc', { method: 'PUT', json: body });

async function enable(extra = {}) {
  const res = await configure({
    enabled: true, issuer: fake.issuer, client_id: fake.clientId, client_secret: fake.clientSecret,
    auto_create: false, link_by_email: false, ...extra,
  });
  assert.equal(res.status, 200, res.text);
}

// Every trip from an address of its own, so the per-address limit on these
// routes never becomes what a test is accidentally measuring.
let n = 1;
const nextAddress = () => `203.0.113.${n++}`;

/**
 * One whole trip: start, approve at the provider, come back. Returns what the
 * callback answered and the session that made the trip.
 */
async function trip(user, { next, tamper, s = c.session(), connect, mangle } = {}) {
  const from = { 'X-Forwarded-For': nextAddress() };
  const q = new URLSearchParams();
  if (next)    q.set('next', next);
  if (connect) q.set('connect', '1');

  const start = await s.fetch(`/api/auth/oidc/start?${q}`, { headers: from });
  assert.equal(start.status, 302);
  const to = start.headers.get('location');
  assert.ok(to.startsWith(fake.issuer.split('/application')[0]), `went to the provider, not ${to}`);

  const state = new URL(to).searchParams.get('state');
  const code  = fake.approve(to, user, { tamper });
  let params  = new URLSearchParams({ code, state });
  if (mangle) params = mangle(params);

  const back = await s.fetch(`/api/auth/oidc/callback?${params}`, { headers: from });
  assert.equal(back.status, 302);
  return { s, to, state, code, back, location: back.headers.get('location') };
}

const signedIn = async s => (await s.fetch('/api/auth/me')).body.authenticated;

function assertRefused(result, code) {
  const to = new URL(result.location, c.baseUrl);
  assert.equal(to.pathname, '/login/', `sent back to sign in, not to ${result.location}`);
  if (code) assert.equal(to.searchParams.get('sso_error'), code);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('settings', () => {
  test('are for administrators only', async () => {
    assert.equal((await c.pub('/api/settings/oidc')).status, 401);
    const s = c.session();
    await c.makeUser({ email: 'nosy@example.test', password: PASSWORD });
    await s.login('nosy@example.test', PASSWORD);
    assert.equal((await s.fetch('/api/settings/oidc')).status, 401);
    assert.equal((await s.fetch('/api/settings/oidc', { method: 'PUT', json: { enabled: false } })).status, 401);
  });

  test('turning it on checks the provider first', async () => {
    const res = await configure({ enabled: true, issuer: 'http://127.0.0.1:9/nothing/', client_id: 'x' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /could not be checked/);
    assert.equal((await c.api('/api/settings/oidc')).body.enabled, false);
  });

  test('and needs an issuer and a client ID', async () => {
    assert.equal((await configure({ enabled: true, issuer: '', client_id: '' })).status, 400);
    assert.equal((await configure({ issuer: 'ftp://example.test/' })).status, 400);
  });

  test('a discovery document naming a different issuer is refused', async () => {
    const res = await configure({ enabled: true, issuer: fake.issuer.replace('linkpage', 'other'),
                                  client_id: fake.clientId });
    assert.equal(res.status, 400);
  });

  test('the client secret is never handed back, anywhere', async () => {
    await enable();
    const view = await c.api('/api/settings/oidc');
    assert.equal(view.body.client_secret_set, true);
    assert.ok(!view.text.includes(fake.clientSecret));
    assert.ok(!(await c.pub('/api/settings')).text.includes(fake.clientSecret));
    assert.ok(!(await c.pub('/api/auth/providers')).text.includes(fake.clientSecret));
    const log = await c.api('/api/audit?limit=200');
    assert.ok(!log.text.includes(fake.clientSecret), 'nor written to the audit log');
  });

  test('saving without a secret keeps the one there is; null removes it', async () => {
    await configure({ label: 'Sign in with Authentik' });
    assert.equal(db.readSetting('oidc_client_secret'), fake.clientSecret);
    await configure({ client_secret: null });
    assert.equal((await c.api('/api/settings/oidc')).body.client_secret_set, false);
    await enable();
  });

  test('the sign-in page is offered a button only while it is on', async () => {
    await enable({ label: 'Sign in with Authentik' });
    let providers = (await c.pub('/api/auth/providers')).body.providers;
    assert.deepEqual(providers.find(p => p.id === 'oidc'),
                     { id: 'oidc', label: 'Sign in with Authentik', url: '/api/auth/oidc/start' });

    await configure({ enabled: false });
    providers = (await c.pub('/api/auth/providers')).body.providers;
    assert.equal(providers.some(p => p.id === 'oidc'), false);

    const start = await c.pub('/api/auth/oidc/start');
    assert.equal(start.status, 302);
    assert.match(start.headers.get('location'), /^\/login\/\?sso_error=disabled/);
  });
});

// ─── Signing in ───────────────────────────────────────────────────────────────

describe('signing in', () => {
  let member;
  before(async () => {
    await enable();
    member = await c.makeUser({ email: 'linked@example.test', password: PASSWORD });
    db.linkIdentity({ userId: member.id, provider: fake.issuer, subject: 'sub-linked' });
  });

  test('a connected account is signed in and lands where it was going', async () => {
    const r = await trip({ sub: 'sub-linked', email: 'linked@example.test' }, { next: '/?group=3' });
    assert.equal(r.location, '/?group=3');
    assert.ok(r.s.sessionCookie, 'a session cookie');
    const me = (await r.s.fetch('/api/auth/me')).body;
    assert.equal(me.user.email, 'linked@example.test');
  });

  test('the trip uses PKCE with S256, a state and a nonce', async () => {
    const r = await trip({ sub: 'sub-linked' });
    const sent = new URL(r.to).searchParams;
    assert.equal(sent.get('code_challenge_method'), 'S256');
    assert.ok(sent.get('code_challenge')?.length >= 43);
    assert.ok(sent.get('state')?.length >= 43);
    assert.ok(sent.get('nonce')?.length >= 43);
    assert.equal(sent.get('redirect_uri'), `${c.baseUrl}/api/auth/oidc/callback`);
    assert.match(sent.get('scope'), /\bopenid\b/);

    const exchange = fake.tokenRequests.at(-1);
    assert.ok(exchange.form.get('code_verifier'), 'the verifier went to the token endpoint');
    assert.match(exchange.authorization, /^Basic /, 'and the client authenticated');
    assert.equal(exchange.form.get('client_secret'), null, 'with the secret in the header, not the body');
  });

  test('the next address can only be a path on this site', async () => {
    for (const next of ['https://evil.example/', '//evil.example/', '/\\evil.example', 'javascript:alert(1)']) {
      const r = await trip({ sub: 'sub-linked' }, { next });
      assert.equal(r.location, '/', next);
    }
  });

  test('a disabled account is turned away', async () => {
    const off = await c.makeUser({ email: 'off@example.test', password: PASSWORD });
    db.linkIdentity({ userId: off.id, provider: fake.issuer, subject: 'sub-off' });
    db.updateUser(off.id, { isActive: false });
    const r = await trip({ sub: 'sub-off' });
    assertRefused(r, 'account_disabled');
    assert.equal(await signedIn(r.s), false);
  });

  test('a stranger is turned away while accounts are not created automatically', async () => {
    const r = await trip({ sub: 'sub-stranger', email: 'stranger@example.test' }, { next: '/x' });
    assertRefused(r, 'no_account');
    assert.equal(new URL(r.location, c.baseUrl).searchParams.get('next'), '/x', 'and keeps where it was going');
    assert.equal(await signedIn(r.s), false);
    assert.equal(db.getUserByEmail('stranger@example.test'), null);
  });

  test('the same subject from a different issuer is somebody else', async () => {
    db.linkIdentity({ userId: member.id, provider: 'https://another-provider.example/', subject: 'sub-elsewhere' });
    const r = await trip({ sub: 'sub-elsewhere' });
    assertRefused(r, 'no_account');
  });

  test('success and failure are both in the audit log', async () => {
    const log = (await c.api('/api/audit?limit=200')).body;
    const entries = log.entries || log;
    assert.ok(entries.some(e => e.action === 'auth.login' && /single sign-on/.test(e.summary)));
    assert.ok(entries.some(e => e.action === 'auth.login_failed' && /Single sign-on refused/.test(e.summary)));
  });
});

// ─── The return trip, forged ──────────────────────────────────────────────────

describe('the return trip', () => {
  before(() => enable());

  test('from a browser that did not set off is refused', async () => {
    // An attacker's own code and state, sent to a victim. The victim's browser
    // has no state cookie, so it must not end up signed in as the attacker.
    const attacker = c.session();
    const start = await attacker.fetch('/api/auth/oidc/start', { headers: { 'X-Forwarded-For': nextAddress() } });
    const to    = start.headers.get('location');
    const code  = fake.approve(to, { sub: 'sub-linked' });
    const state = new URL(to).searchParams.get('state');

    const victim = c.session();
    const back = await victim.fetch(`/api/auth/oidc/callback?${new URLSearchParams({ code, state })}`);
    assertRefused({ location: back.headers.get('location') }, 'expired');
    assert.equal(await signedIn(victim), false);
  });

  test('with a state that is not the one this browser was given is refused', async () => {
    const r = await trip({ sub: 'sub-linked' }, { mangle: p => { p.set('state', 'x'.repeat(43)); return p; } });
    assertRefused(r, 'expired');
    assert.equal(await signedIn(r.s), false);
  });

  test('works once', async () => {
    const r = await trip({ sub: 'sub-linked' });
    assert.equal(await signedIn(r.s), true);

    // The same state again, cookie and all.
    const again = c.session();
    again.jar.cookies.set('lp_oidc', r.state);
    const res = await again.fetch(`/api/auth/oidc/callback?${new URLSearchParams({ code: r.code, state: r.state })}`);
    assertRefused({ location: res.headers.get('location') }, 'expired');
    assert.equal(await signedIn(again), false);
  });

  test('a provider that declines sends the person back to sign in', async () => {
    const s = c.session();
    const start = await s.fetch('/api/auth/oidc/start', { headers: { 'X-Forwarded-For': nextAddress() } });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const back = await s.fetch(`/api/auth/oidc/callback?error=access_denied&state=${state}`);
    assertRefused({ location: back.headers.get('location') }, 'denied');
    assert.equal(await signedIn(s), false);
  });
});

// ─── ID tokens that must not be believed ──────────────────────────────────────

describe('a bad ID token is refused', () => {
  before(() => enable());

  const cases = {
    'signed by somebody else':          () => ({ signWith: fake.strangerKey() }),
    'claims altered after signing':     () => ({ alterClaims: { sub: 'sub-someone-else' } }),
    'unsigned (alg none)':              () => ({ alg: 'none' }),
    'from another issuer':              () => ({ claims: { iss: 'https://evil.example/' } }),
    'for another client':               () => ({ claims: { aud: 'some-other-app' } }),
    'for several clients, not via us':  () => ({ claims: { aud: [fake.clientId, 'other'], azp: 'other' } }),
    'expired':                          () => ({ claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }),
    'issued in the future':             () => ({ claims: { iat: Math.floor(Date.now() / 1000) + 3600 } }),
    'for another sign-in (nonce)':      () => ({ claims: { nonce: 'not-the-one' } }),
    'naming no key we know':            () => ({ kid: 'key-unknown' }),
  };

  for (const [name, tamper] of Object.entries(cases)) {
    test(name, async () => {
      const r = await trip({ sub: 'sub-linked' }, { tamper: tamper() });
      assertRefused(r, 'bad_token');
      assert.equal(await signedIn(r.s), false);
    });
  }

  test('one signed with the client secret is accepted, as Authentik does without a signing key', async () => {
    const r = await trip({ sub: 'sub-linked' }, { tamper: { alg: 'HS256' } });
    assert.equal(await signedIn(r.s), true);
  });

  test('but not without a secret to check it against', async () => {
    // A public client has no secret, so an HS256 token is something anybody
    // could have minted with any key at all. Checked on the verifier directly:
    // the fake provider would refuse a secretless client before it got this far.
    const { verifyIdToken } = require('../src/services/oidcService');
    const crypto = require('node:crypto');
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const input = `${enc({ alg: 'HS256' })}.${enc({ iss: fake.issuer, aud: fake.clientId, sub: 'x',
                                                   nonce: 'n', iat: now, exp: now + 60 })}`;
    const token = `${input}.${crypto.createHmac('sha256', '').update(input).digest('base64url')}`;
    const meta = { issuer: fake.issuer };

    await assert.rejects(verifyIdToken(token, { meta, clientId: fake.clientId, clientSecret: '', nonce: 'n' }),
                         /needs a client secret/);
    // The same token checks out for a client that does share that (empty) key
    // with the provider — so what refused it above was the missing secret.
    const signedWithReal = `${input}.${crypto.createHmac('sha256', 'shared').update(input).digest('base64url')}`;
    const claims = await verifyIdToken(signedWithReal, { meta, clientId: fake.clientId, clientSecret: 'shared', nonce: 'n' });
    assert.equal(claims.sub, 'x');
  });
});

// ─── Creating and linking accounts ────────────────────────────────────────────

describe('accounts', () => {
  test('are created on first sign-in when that is on, as members without a password', async () => {
    await enable({ auto_create: true });
    const r = await trip({ sub: 'sub-new', email: 'New.Person@example.test', name: 'New Person' });
    assert.equal(await signedIn(r.s), true);

    const user = db.getUserByEmail('new.person@example.test');
    assert.equal(user.role, 'user', 'never an administrator');
    assert.equal(user.has_password, false);
    assert.equal(user.display_name, 'New Person');

    const again = await trip({ sub: 'sub-new', email: 'new.person@example.test' });
    assert.equal((await again.s.fetch('/api/auth/me')).body.user.id, user.id, 'and the same account next time');
  });

  test('but not over an existing account with the same address', async () => {
    await enable({ auto_create: true, link_by_email: false });
    await c.makeUser({ email: 'taken@example.test', password: PASSWORD });
    const r = await trip({ sub: 'sub-claims-taken', email: 'taken@example.test' });
    assertRefused(r, 'email_taken');
  });

  test('nor without an address at all', async () => {
    await enable({ auto_create: true });
    const r = await trip({ sub: 'sub-no-email', email: undefined });
    assertRefused(r, 'no_email');
  });

  test('an address left out of the ID token is read from userinfo', async () => {
    await enable({ auto_create: true });
    const r = await trip({ sub: 'sub-userinfo', email: undefined,
                           userinfo: { email: 'from-userinfo@example.test', email_verified: true } });
    assert.equal(await signedIn(r.s), true);
    assert.ok(db.getUserByEmail('from-userinfo@example.test'));
  });

  test('an existing account is connected by a verified address when that is on', async () => {
    await enable({ link_by_email: true });
    const user = await c.makeUser({ email: 'by-email@example.test', password: PASSWORD });
    const r = await trip({ sub: 'sub-by-email', email: 'BY-EMAIL@example.test', email_verified: true });
    assert.equal((await r.s.fetch('/api/auth/me')).body.user.id, user.id);
    assert.equal(db.getIdentity(fake.issuer, 'sub-by-email').user_id, user.id);
  });

  test('but never by an address the provider has not verified', async () => {
    // Anyone who can edit their own address at the provider could otherwise
    // walk into any account here — the administrator's included.
    await enable({ link_by_email: true });
    await c.makeUser({ email: 'unverified@example.test', password: PASSWORD });
    const r = await trip({ sub: 'sub-unverified', email: 'unverified@example.test', email_verified: false });
    assertRefused(r, 'no_account');
    assert.equal(db.getIdentity(fake.issuer, 'sub-unverified'), null);
  });

  test('nor when linking by address is off', async () => {
    await enable({ link_by_email: false });
    await c.makeUser({ email: 'not-linked@example.test', password: PASSWORD });
    const r = await trip({ sub: 'sub-not-linked', email: 'not-linked@example.test', email_verified: true });
    assertRefused(r, 'no_account');
  });

  test('an account already connected is not connected to a second subject by address', async () => {
    await enable({ link_by_email: true });
    const r = await trip({ sub: 'sub-impostor', email: 'by-email@example.test', email_verified: true });
    assertRefused(r, 'already_linked');
  });
});

// ─── Connecting your own account ──────────────────────────────────────────────

describe('connecting your own account', () => {
  let s, user;
  before(async () => {
    await enable();
    user = await c.makeUser({ email: 'connector@example.test', password: PASSWORD });
    s = c.session();
    await s.login('connector@example.test', PASSWORD);
  });

  test('shows whether it is available and connected', async () => {
    const res = await s.fetch('/api/auth/identities');
    assert.equal(res.body.available, true);
    assert.deepEqual(res.body.identities, []);
    assert.equal(res.body.has_password, true);
  });

  test('a signed-in member connects their account', async () => {
    const r = await trip({ sub: 'sub-connector', email: 'whatever@provider.example' }, { s, connect: true });
    assert.equal(r.location, '/?account=1&sso=connected');
    assert.equal(db.getIdentity(fake.issuer, 'sub-connector').user_id, user.id);
    assert.equal((await s.fetch('/api/auth/identities')).body.identities.length, 1);

    const fresh = await trip({ sub: 'sub-connector' });
    assert.equal((await fresh.s.fetch('/api/auth/me')).body.user.id, user.id, 'and can sign in with it');
  });

  test('cannot take over a subject connected to somebody else', async () => {
    const other = c.session();
    await c.makeUser({ email: 'other-connector@example.test', password: PASSWORD });
    await other.login('other-connector@example.test', PASSWORD);
    const r = await trip({ sub: 'sub-connector' }, { s: other, connect: true });
    assert.match(r.location, /^\/\?account=1&sso_error=already_linked/);
  });

  test('needs a session to start', async () => {
    const res = await c.pub('/api/auth/oidc/start?connect=1');
    assert.match(res.headers.get('location'), /sso_error=expired/);
  });

  test('disconnecting is refused when it would leave no way in', async () => {
    const r = await (async () => { await enable({ auto_create: true }); return trip({ sub: 'sub-sso-only', email: 'sso-only@example.test' }); })();
    const res = await r.s.fetch('/api/auth/identities', { method: 'DELETE' });
    assert.equal(res.status, 409);
    assert.ok(db.getIdentity(fake.issuer, 'sub-sso-only'));
  });

  test('and allowed when there is a password', async () => {
    const res = await s.fetch('/api/auth/identities', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(db.getIdentity(fake.issuer, 'sub-connector'), null);
  });

  test('an administrator can disconnect anybody, and sees who is connected', async () => {
    const sso = db.getUserByEmail('sso-only@example.test');
    const list = (await c.api('/api/users')).body.users;
    assert.equal(list.find(u => u.id === sso.id).sso, true);
    assert.equal((await c.api(`/api/users/${sso.id}/identities`, { method: 'DELETE' })).status, 200);
    assert.equal(db.getIdentity(fake.issuer, 'sub-sso-only'), null);
  });

  test('deleting an account forgets its connection', async () => {
    await enable({ auto_create: true });
    await trip({ sub: 'sub-doomed', email: 'doomed@example.test' });
    const doomed = db.getUserByEmail('doomed@example.test');
    await c.api(`/api/users/${doomed.id}`, { method: 'DELETE' });
    assert.equal(db.getIdentity(fake.issuer, 'sub-doomed'), null);
  });
});

describe('members-only', () => {
  test('the trip is open to strangers, or nobody could sign in with it', async () => {
    await enable();
    assert.equal((await c.api('/api/settings/require-login', { method: 'POST', json: { enabled: true } })).status, 200);
    try {
      const r = await trip({ sub: 'sub-linked' }, { next: '/' });
      assert.equal(r.location, '/');
      assert.equal(await signedIn(r.s), true);
    } finally {
      await c.api('/api/settings/require-login', { method: 'POST', json: { enabled: false } });
    }
  });
});
