// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Email: SMTP settings, a test message, and resetting your own password by
 * email — delivered to a fake SMTP server (tests/helpers/fakeSmtp.js).
 *
 * The reset endpoint is public and sends mail, so most of this is about what
 * it must not do: say whether an address has an account, mail a link built
 * from a forged host, fill somebody's inbox, or leave a working link behind
 * when the mail never went.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { startFakeSmtp } = require('./helpers/fakeSmtp');

let c, smtp, db, settle;
const PASSWORD = 'a-long-enough-password';
const SITE = 'https://links.example.com';

before(async () => {
  c    = await harness.start();
  smtp = await startFakeSmtp({ user: 'mailer', pass: 'smtp-secret' });
  db   = require('../src/models');
  settle = require('../src/controllers/mailController').settleResetEmails;
  await c.makeUser({ email: 'forgetful@example.test', password: PASSWORD });
});
after(async () => { await smtp?.stop(); await harness.stop(); });

const configure = body => c.api('/api/settings/mail', { method: 'PUT', json: body });

async function enable(extra = {}) {
  const res = await configure({
    site_url: SITE, host: '127.0.0.1', port: smtp.port, security: 'none',
    user: 'mailer', password: 'smtp-secret', from: 'LinkPage <links@example.com>',
    password_reset: true, ...extra,
  });
  assert.equal(res.status, 200, res.text);
}

let n = 1;
const ask = (email, headers = {}) => c.pub('/api/auth/forgot-password', {
  method: 'POST', json: { email },
  headers: { Origin: c.baseUrl, 'X-Forwarded-For': `198.18.0.${n++}`, ...headers },
});

const mailTo = address => smtp.messages.filter(m => m.to.includes(address));
const tokenIn = m => smtp.bodyOf(m).match(/\/login\/\?reset=([A-Za-z0-9_-]+)/)?.[1];

describe('settings', () => {
  test('are for administrators only', async () => {
    assert.equal((await c.pub('/api/settings/mail')).status, 401);
    assert.equal((await c.pub('/api/settings/mail', { method: 'PUT', json: {} })).status, 401);
    assert.equal((await c.pub('/api/settings/mail/test', { method: 'POST', json: {} })).status, 401);
  });

  test('resets by email cannot be offered before mail can be sent', async () => {
    const res = await configure({ password_reset: true });
    assert.equal(res.status, 400);
    assert.equal((await c.pub('/api/settings')).body.password_reset_email, false);
  });

  test('the SMTP password is never handed back', async () => {
    await enable();
    const view = await c.api('/api/settings/mail');
    assert.equal(view.body.password_set, true);
    assert.ok(!view.text.includes('smtp-secret'));
    assert.ok(!(await c.pub('/api/settings')).text.includes('smtp-secret'));
    assert.ok(!(await c.api('/api/audit?limit=200')).text.includes('smtp-secret'));
  });

  test('a header cannot be smuggled in through the sender', async () => {
    assert.equal((await configure({ from: 'a@example.com\r\nBcc: everyone@example.com' })).status, 400);
  });

  test('a test message arrives, with the credentials it was given', async () => {
    const res = await c.api('/api/settings/mail/test', { method: 'POST', json: { to: 'admin@example.test' } });
    assert.equal(res.status, 200, res.text);
    assert.equal(mailTo('admin@example.test').length, 1);
  });

  test('and a refusal says what the server said', async () => {
    smtp.reject('550 Mailbox unavailable');
    try {
      const res = await c.api('/api/settings/mail/test', { method: 'POST', json: { to: 'admin@example.test' } });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /550/);
    } finally { smtp.accept(); }
  });

  test('wrong credentials are refused by the server, and reported', async () => {
    await configure({ password: 'wrong' });
    try {
      const res = await c.api('/api/settings/mail/test', { method: 'POST', json: { to: 'admin@example.test' } });
      assert.equal(res.status, 400);
    } finally { await enable(); }
  });
});

describe('asking for a reset', () => {
  before(() => enable());

  test('is not offered while it is off', async () => {
    await configure({ password_reset: false });
    assert.equal((await c.pub('/api/settings')).body.password_reset_email, false);
    assert.equal((await ask('forgetful@example.test')).status, 404);
    await enable();
    assert.equal((await c.pub('/api/settings')).body.password_reset_email, true);
  });

  test('mails a link that works once and signs the person in', async () => {
    const res = await ask('Forgetful@Example.test');
    assert.equal(res.status, 200);
    await settle();

    const [message] = mailTo('forgetful@example.test');
    assert.ok(message, 'a message was sent');
    const token = tokenIn(message);
    assert.ok(smtp.bodyOf(message).includes(`${SITE}/login/?reset=${token}`), 'built from the configured address');

    const s = c.session();
    const redeem = await s.fetch(`/api/tokens/${token}/redeem`, { method: 'POST', json: { password: 'a-brand-new-password' } });
    assert.equal(redeem.status, 200);
    assert.equal((await s.fetch('/api/auth/me')).body.user.email, 'forgetful@example.test');

    const again = await c.session().fetch(`/api/tokens/${token}/redeem`, { method: 'POST', json: { password: 'another-password-1' } });
    assert.equal(again.status, 400, 'once only');
  });

  test('lasts an hour, not the week an administrator\'s link does', async () => {
    await c.makeUser({ email: 'hourly@example.test', password: PASSWORD });
    await ask('hourly@example.test');
    await settle();
    const reset = db.getUserTokens('reset').find(t => t.label === 'hourly@example.test' && t.status === 'pending');
    const minutes = (Date.parse(`${reset.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 60000;
    assert.ok(minutes > 55 && minutes <= 60, `${minutes} minutes`);
  });

  test('never builds the link from the request', async () => {
    await c.makeUser({ email: 'phished@example.test', password: PASSWORD });
    await ask('phished@example.test', { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' });
    await settle();
    const body = smtp.bodyOf(mailTo('phished@example.test').at(-1));
    assert.ok(!body.includes('evil.example'));
    assert.ok(body.includes(`${SITE}/login/?reset=`));
  });

  test('answers an unknown address exactly as a known one, and mails nobody', async () => {
    const before = smtp.messages.length;
    const known   = await ask('phished@example.test');
    const unknown = await ask('nobody-at-all@example.test');
    await settle();
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(smtp.messages.length, before + 1, 'only the real account got mail');
  });

  test('mails nobody for a disabled account', async () => {
    const off = await c.makeUser({ email: 'disabled@example.test', password: PASSWORD });
    db.updateUser(off.id, { isActive: false });
    assert.equal((await ask('disabled@example.test')).status, 200);
    await settle();
    assert.equal(mailTo('disabled@example.test').length, 0);
  });

  test('a new request retires the link before it', async () => {
    await c.makeUser({ email: 'twice@example.test', password: PASSWORD });
    await ask('twice@example.test'); await settle();
    await ask('twice@example.test'); await settle();
    const [first, second] = mailTo('twice@example.test').map(tokenIn);
    assert.equal((await c.pub(`/api/tokens/${first}`)).body.valid, false);
    assert.equal((await c.pub(`/api/tokens/${second}`)).body.valid, true);
  });

  test('a link that could not be sent does not work', async () => {
    await c.makeUser({ email: 'bounced@example.test', password: PASSWORD });
    smtp.reject('451 Try again later');
    try {
      assert.equal((await ask('bounced@example.test')).status, 200, 'the caller is told nothing different');
      await settle();
    } finally { smtp.accept(); }
    const resets = db.getUserTokens('reset').filter(t => t.label === 'bounced@example.test');
    assert.equal(resets.length, 1);
    assert.equal(resets[0].status, 'revoked');
    const log = (await c.api('/api/audit?limit=200')).body;
    assert.ok((log.entries || log).some(e => e.action === 'auth.reset_email_failed'));
  });

  test('cannot fill somebody\'s inbox: three an hour per account, from anywhere', async () => {
    await c.makeUser({ email: 'target@example.test', password: PASSWORD });
    for (let i = 0; i < 6; i++) assert.equal((await ask('target@example.test')).status, 200);
    await settle();
    assert.equal(mailTo('target@example.test').length, 3);
  });

  test('and one address cannot keep asking', async () => {
    const from = { 'X-Forwarded-For': '198.18.1.1' };
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await ask(`someone${i}@example.test`, from)).status);
    await settle();
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[5], 429);
  });

  test('wants an address', async () => {
    assert.equal((await ask('not an address')).status, 400);
  });
});
