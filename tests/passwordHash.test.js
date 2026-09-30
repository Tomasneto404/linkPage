// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Password hashing, old and new.
 *
 * There are two formats in play. Everything written before accounts existed —
 * every group password, and the public-page password — is the three-field
 * `scrypt$<salt>$<hash>` produced with Node's default cost. User passwords are
 * written in a four-field form that carries its own parameters, so the cost can
 * be raised later without a flag day.
 *
 * The test that matters most here is that the new verifier still reads the old
 * format. If it stops, every protected group on every upgraded install locks
 * out silently — no error, no log line, just "wrong password" forever.
 */

const crypto = require('node:crypto');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  hashPassword, verifyPassword,
  hashPasswordSync, verifyPasswordSync,
  needsRehash,
} = require('../src/utils/password');

/** The exact hash the app produced before this module existed. */
function legacyHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

describe('the current format', () => {
  test('a password verifies against its own hash', async () => {
    const stored = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword(stored, 'correct horse battery staple'), true);
  });

  test('a wrong password does not', async () => {
    const stored = await hashPassword('hunter2');
    assert.equal(await verifyPassword(stored, 'hunter3'), false);
    assert.equal(await verifyPassword(stored, ''), false);
    assert.equal(await verifyPassword(stored, 'hunter2 '), false);
  });

  test('it carries its parameters, so the cost can be raised later', async () => {
    const stored = await hashPassword('whatever');
    assert.match(stored, /^scrypt\$N=\d+,r=\d+,p=\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  test('the same password hashes differently every time', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notEqual(a, b, 'a fresh salt each time');
    assert.equal(await verifyPassword(a, 'same'), true);
    assert.equal(await verifyPassword(b, 'same'), true);
  });

  test('unicode survives the round trip', async () => {
    const stored = await hashPassword('pÃ¡ssword-çãé-🔑');
    assert.equal(await verifyPassword(stored, 'pÃ¡ssword-çãé-🔑'), true);
  });

  test('a long password is not silently truncated', async () => {
    const long = 'a'.repeat(400);
    const stored = await hashPassword(long);
    assert.equal(await verifyPassword(stored, long), true);
    assert.equal(await verifyPassword(stored, 'a'.repeat(399)), false);
  });
});

describe('the legacy format', () => {
  test('a hash written before accounts existed still verifies', async () => {
    const stored = legacyHash('the old password');
    assert.equal(await verifyPassword(stored, 'the old password'), true);
    assert.equal(await verifyPassword(stored, 'not it'), false);
  });

  test('the synchronous verifier reads it too', () => {
    // This is the path group unlocks take, and it must not change behaviour.
    const stored = legacyHash('group secret');
    assert.equal(verifyPasswordSync(stored, 'group secret'), true);
    assert.equal(verifyPasswordSync(stored, 'wrong'), false);
  });

  test('the model helpers still speak it, in both directions', () => {
    // src/models/groups.js delegates here now; every existing call site reaches
    // the same two names it always did.
    const { hashGroupPassword, verifyScryptHash } = require('../src/models/groups');
    const stored = hashGroupPassword('still works');
    assert.match(stored, /^scrypt\$/);
    assert.equal(verifyScryptHash(stored, 'still works'), true);
    assert.equal(verifyScryptHash(legacyHash('older'), 'older'), true);
  });

  test('it is flagged for rehashing, the current format is not', async () => {
    assert.equal(needsRehash(legacyHash('x')), true);
    assert.equal(needsRehash(await hashPassword('x')), false);
  });
});

describe('malformed input', () => {
  test('nothing throws, everything is false', async () => {
    for (const stored of [null, undefined, '', 'nonsense', 'scrypt$', 'scrypt$only-one',
                          'bcrypt$a$b', 'scrypt$N=bad$aa$bb', {}, 42]) {
      assert.equal(await verifyPassword(stored, 'x'), false, `stored: ${JSON.stringify(stored)}`);
      assert.equal(verifyPasswordSync(stored, 'x'), false, `stored: ${JSON.stringify(stored)}`);
    }
  });

  test('a non-string password is false, not a crash', async () => {
    const stored = await hashPassword('real');
    for (const password of [null, undefined, 42, {}, []]) {
      assert.equal(await verifyPassword(stored, password), false);
    }
  });

  test('an empty password cannot be hashed', async () => {
    await assert.rejects(() => hashPassword(''), /password/i);
    await assert.rejects(() => hashPassword(null), /password/i);
  });

  test('needsRehash says yes to anything it cannot read', () => {
    // Unreadable means "replace this at the next opportunity", never "it's fine".
    for (const stored of [null, '', 'nonsense', 'scrypt$N=x,r=y,p=z$aa$bb']) {
      assert.equal(needsRehash(stored), true);
    }
  });
});

describe('concurrency', () => {
  test('many hashes at once all come back correct', async () => {
    // The module queues work so a burst of logins cannot exhaust memory. The
    // point of this test is that the queue drains and nothing is mixed up.
    const passwords = Array.from({ length: 24 }, (_, i) => `password-${i}`);
    const hashes = await Promise.all(passwords.map(p => hashPassword(p)));

    const checks = await Promise.all(hashes.map((h, i) => verifyPassword(h, passwords[i])));
    assert.deepEqual(checks, passwords.map(() => true));

    // And each hash belongs to its own password, not a neighbour's.
    assert.equal(await verifyPassword(hashes[0], passwords[1]), false);
  });

  test('a failure in one does not wedge the queue', async () => {
    const results = await Promise.allSettled([
      hashPassword(''),            // rejects
      hashPassword('fine'),
      hashPassword('also fine'),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(await verifyPassword(results[1].value, 'fine'), true);
  });
});

describe('the synchronous helpers', () => {
  test('they round-trip', () => {
    const stored = hashPasswordSync('sync please');
    assert.equal(verifyPasswordSync(stored, 'sync please'), true);
    assert.equal(verifyPasswordSync(stored, 'nope'), false);
  });

  test('they write the cheap legacy format on purpose', () => {
    // These are the group and public-page gates: short-lived, already rate
    // limited, and called from synchronous request handlers. Paying the user
    // login cost on the event loop there would buy nothing and block everyone.
    assert.match(hashPasswordSync('group'), /^scrypt\$[0-9a-f]{32}\$[0-9a-f]+$/);
  });

  test('sync and async read each other\'s output', async () => {
    const fromSync  = hashPasswordSync('shared');
    const fromAsync = await hashPassword('shared');
    assert.equal(await verifyPassword(fromSync, 'shared'), true);
    assert.equal(verifyPasswordSync(fromAsync, 'shared'), true);
  });
});
