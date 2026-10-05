// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Sign-in throttling, beyond the per-address limit tested in sessions.test.js.
 *
 * Two gaps it closes. A guess spread across many addresses used to get through,
 * since every count was per address; now the account named is counted too.
 * And every count lived in memory, so a restart wiped them; now they are in
 * the database.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
const PASSWORD = 'a-long-enough-password';
const ACCOUNT_BUDGET = 20;

before(async () => { c = await harness.start(); });
after(harness.stop);

// Every attempt from an address of its own, so the per-address limit (10)
// never trips and only the per-account one is being tested.
let nextAddress = 1;
const freshAddress = () => `198.51.100.${nextAddress++}`;

function attempt(email, password, address = freshAddress()) {
  return c.pub('/api/auth/login', {
    method:  'POST',
    headers: { Origin: c.baseUrl, 'X-Forwarded-For': address },
    json:    { email, password },
  });
}

async function guessUntilLimited(email, max = ACCOUNT_BUDGET + 5) {
  for (let i = 0; i < max; i++) {
    const res = await attempt(email, `wrong-${i}`);
    if (res.status === 429) return { tries: i, res };
    assert.equal(res.status, 401);
  }
  return { tries: max, res: null };
}

describe('per account', () => {
  test('guesses spread across many addresses are stopped', async () => {
    await c.makeUser({ email: 'spread@example.test', password: PASSWORD });
    const { tries, res } = await guessUntilLimited('spread@example.test');
    assert.ok(res, 'throttled, though no address made more than one attempt');
    assert.equal(tries, ACCOUNT_BUDGET);
  });

  test('and the right password from a new address is held off too, for now', async () => {
    // The cost of a per-account limit, accepted knowingly: it lapses with its window.
    const res = await attempt('spread@example.test', PASSWORD);
    assert.equal(res.status, 429);
  });

  test('other accounts are untouched', async () => {
    await c.makeUser({ email: 'bystander@example.test', password: PASSWORD });
    assert.equal((await attempt('bystander@example.test', PASSWORD)).status, 200);
  });

  test('the address is matched however it is typed', async () => {
    await c.makeUser({ email: 'folded@example.test', password: PASSWORD });
    for (let i = 0; i < ACCOUNT_BUDGET; i++) {
      const spelling = i % 2 ? '  FOLDED@Example.TEST ' : 'folded@example.test';
      assert.equal((await attempt(spelling, `wrong-${i}`)).status, 401);
    }
    assert.equal((await attempt('Folded@example.test', 'wrong-again')).status, 429);
  });

  test('a successful sign-in starts the count again', async () => {
    await c.makeUser({ email: 'forgetful@example.test', password: PASSWORD });
    for (let i = 0; i < ACCOUNT_BUDGET - 1; i++) {
      assert.equal((await attempt('forgetful@example.test', `wrong-${i}`)).status, 401);
    }
    assert.equal((await attempt('forgetful@example.test', PASSWORD)).status, 200);
    for (let i = 0; i < ACCOUNT_BUDGET - 1; i++) {
      assert.equal((await attempt('forgetful@example.test', `wrong-again-${i}`)).status, 401,
        'the earlier failures no longer count');
    }
  });

  test('an address with no account is limited exactly the same way', async () => {
    // Otherwise the limit is an oracle: whichever addresses never get a 429 are
    // the ones with nobody behind them.
    const real  = await guessUntilLimited('spread@example.test', 1);       // already limited
    const ghost = await guessUntilLimited('nobody-here@example.test');
    assert.equal(ghost.tries, ACCOUNT_BUDGET);
    assert.deepEqual(ghost.res.body, real.res.body);
  });
});

describe('across a restart', () => {
  test('the counts are in the database', async () => {
    await guessUntilLimited('kept@example.test');
    const { db } = require('../src/config/db');
    const row = db.prepare('SELECT count FROM auth_throttle WHERE key = ?')
                  .get('login-account:kept@example.test');
    assert.equal(row?.count, ACCOUNT_BUDGET);
  });

  test('so a limiter starting afresh, as one does after a restart, still refuses', () => {
    // A new limiter with the same name is what the next process builds; it has
    // no memory of its own to have lost.
    const { createFailureRateLimiter } = require('../src/middleware/rateLimit');
    const reborn = createFailureRateLimiter('login-account', ACCOUNT_BUDGET, 15 * 60 * 1000,
                                            { keyOf: req => req.body.email });
    assert.equal(reborn.isLimited({ body: { email: 'kept@example.test' } }), true);
  });

  test('every sign-in limiter keeps its counts there', async () => {
    const from = { Origin: c.baseUrl, 'X-Forwarded-For': '192.0.2.200' };
    await c.pub('/api/auth/verify', { method: 'POST', headers: from, json: { token: 'nope' } });
    await c.pub('/api/tokens/not-a-real-token/redeem', {
      method: 'POST', headers: from, json: { password: PASSWORD },
    });
    const { db } = require('../src/config/db');
    const keys = db.prepare('SELECT key FROM auth_throttle').all().map(r => r.key);
    assert.ok(keys.includes('admin-token:192.0.2.200'), 'the admin token check');
    assert.ok(keys.includes('user-token:192.0.2.200'), 'invite and reset links');
  });
});

describe('windows', () => {
  const throttle = () => require('../src/models/throttle');
  const WINDOW = 15 * 60 * 1000;

  test('a lapsed window no longer limits, and the next failure opens a new one', () => {
    const long_ago = Date.now() - WINDOW - 1000;
    for (let i = 0; i < 50; i++) throttle().recordThrottleFailure('test:lapsed', WINDOW, long_ago);

    const { createFailureRateLimiter } = require('../src/middleware/rateLimit');
    const limiter = createFailureRateLimiter('test', 5, WINDOW, { keyOf: () => 'lapsed' });
    assert.equal(limiter.isLimited({}), false, 'fifty failures, but all of them stale');

    limiter.recordFailure({});
    assert.equal(throttle().getThrottle('test:lapsed').count, 1, 'counting from one again');
  });

  test('stale rows are tidied away as new failures arrive', () => {
    throttle().recordThrottleFailure('test:ancient', WINDOW, Date.now() - 2 * 24 * 60 * 60 * 1000);
    const { createFailureRateLimiter } = require('../src/middleware/rateLimit');
    createFailureRateLimiter('test', 5, WINDOW, { keyOf: () => 'fresh' }).recordFailure({});
    assert.equal(throttle().getThrottle('test:ancient'), null);
  });
});
