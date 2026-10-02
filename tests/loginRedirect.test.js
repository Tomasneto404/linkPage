// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Where the sign-in page is willing to send somebody afterwards.
 *
 * A sign-in page that takes a destination in its query string is the classic
 * shape of an open redirect: an attacker sends a link to the real site, the
 * person signs in to the real site and sees nothing wrong, and the site then
 * hands them to somewhere else — which is now a very convincing place to ask
 * for a password again.
 *
 * The first version of this check was a regex over the raw string, which is the
 * wrong thing to check. A browser normalises backslashes, strips tabs and
 * newlines, and decodes escapes *before* resolving a URL, so the string a regex
 * sees is not the string the browser acts on. These cases are mostly the ways
 * that gap can be used.
 *
 * The function is lifted out of public/login/login.js, in the style of
 * tests/color.test.js, so the browser copy is what is actually tested.
 */

const fs   = require('node:fs');
const path = require('node:path');
const vm   = require('node:vm');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

/** Pulls safeDestination out of the real page script and evaluates it alone. */
function loadSafeDestination() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'login', 'login.js'), 'utf8');

  const at = src.indexOf('function safeDestination(');
  assert.notEqual(at, -1, 'safeDestination should still exist in login.js');

  // Walk the braces so the whole body comes across.
  let depth = 0;
  let body = null;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { body = src.slice(at, i + 1); break; }
  }
  assert.ok(body, 'could not read the function body');

  const context = vm.createContext({ URL });
  vm.runInContext(`${body}; globalThis.fn = safeDestination;`, context);
  return context.fn;
}

const safeDestination = loadSafeDestination();
const ORIGIN = 'https://links.example.com';

// The function returns an absolute URL; these read better compared as paths.
const where = next => safeDestination(next, ORIGIN);
const pathOf = next => {
  const out = where(next);
  assert.match(out, /^https:\/\//, `${JSON.stringify(next)} should resolve to an absolute URL`);
  const u = new URL(out);
  return u.origin === ORIGIN ? `${u.pathname}${u.search}${u.hash}` : out;
};

describe('somewhere on this site', () => {
  test('a plain path is kept', () => {
    assert.equal(pathOf('/admin'), '/admin');
    assert.equal(pathOf('/'), '/');
  });

  test('a query string and a fragment come along', () => {
    assert.equal(pathOf('/?group=3'), '/?group=3');
    assert.equal(pathOf('/admin#settings'), '/admin#settings');
    assert.equal(pathOf('/f/handbook?page=2#intro'), '/f/handbook?page=2#intro');
  });

  test('an absolute URL back to this very origin is kept, as a path', () => {
    assert.equal(pathOf(`${ORIGIN}/admin`), '/admin');
  });
});

describe('somewhere else', () => {
  test('a protocol-relative URL is refused', () => {
    assert.equal(pathOf('//evil.example'), '/');
    assert.equal(pathOf('//evil.example/looks/like/a/path'), '/');
  });

  test('a backslash is refused, which a regex over the raw string would miss', () => {
    // This is the case that got through the first version. A browser turns the
    // backslash into a slash before resolving, so it is protocol-relative.
    assert.equal(pathOf('/\\evil.example'), '/');
    assert.equal(pathOf('\\\\evil.example'), '/');
    assert.equal(pathOf('/\\/evil.example'), '/');
  });

  test('whitespace a browser strips cannot smuggle one through', () => {
    // A stripped tab on its own is harmless — "/\tevil.example" becomes the
    // path "/evil.example", which is still here. What matters is that stripping
    // it cannot *turn* a path into another origin, which is what these are.
    for (const next of ['/\t/evil.example', '/\t\\evil.example',
                        '/\n/evil.example', '/\r/evil.example']) {
      assert.equal(pathOf(next), '/', JSON.stringify(next));
    }
  });

  test('whitespace that only moves a path leaves it a path', () => {
    for (const next of ['/\tevil.example', '/\nevil.example', '/\revil.example']) {
      assert.equal(pathOf(next), '/evil.example', JSON.stringify(next));
    }
  });

  test('an absolute URL elsewhere is refused', () => {
    assert.equal(pathOf('https://evil.example'), '/');
    assert.equal(pathOf('http://evil.example/admin'), '/');
    assert.equal(pathOf('https://links.example.com.evil.example/'), '/');
  });

  test('a different port or scheme on the same host is still elsewhere', () => {
    assert.equal(pathOf('https://links.example.com:8443/admin'), '/');
    assert.equal(pathOf('http://links.example.com/admin'), '/');
  });

  test('a scheme that is not navigation at all is refused', () => {
    for (const next of ['javascript:alert(1)', 'data:text/html,<h1>hi', 'file:///etc/passwd',
                        'JaVaScRiPt:alert(1)']) {
      assert.equal(pathOf(next), '/', next);
    }
  });

  test('an encoded attempt is refused', () => {
    // %2F%2F decodes to // — the parser resolves it, so it is judged resolved.
    assert.equal(pathOf('/%2F%2Fevil.example'), '/%2F%2Fevil.example',
                 'left encoded, so it stays a path on this site');
    assert.equal(pathOf('https:/\\/\\evil.example'), '/');
  });
});

describe('the property underneath all of it', () => {
  test('whatever comes in, what comes out stays on this origin', () => {
    const attempts = [
      '/admin', '//evil.example', '/\\evil.example', '\\\\evil.example', '/\\/evil.example',
      'https://evil.example', 'http://evil.example/admin', 'javascript:alert(1)',
      'data:text/html,<h1>hi', '/\tevil.example', '/\t/evil.example', '/\n//evil.example',
      'https:/\\/\\evil.example', '//evil.example\\@links.example.com',
      '/%2F%2Fevil.example', '', null, undefined, '/..//evil.example',
      '/./..//evil.example', '/a/../..//evil.example',
      `${ORIGIN}/fine`, `${ORIGIN}@evil.example`, 'https://evil.example#@links.example.com',
    ];

    for (const next of attempts) {
      // Checked on the string itself, with no base: this is what gets handed
      // to location.assign, and it must not need a base to be safe.
      const resolved = new URL(where(next));
      assert.equal(resolved.origin, ORIGIN,
        `${JSON.stringify(next)} escaped to ${resolved.origin}`);
    }
  });
});

describe('nothing useful at all', () => {
  test('missing, empty, or not a string means the front page', () => {
    for (const next of [null, undefined, '', 42, {}, [], true]) {
      assert.equal(pathOf(next), '/', JSON.stringify(next));
    }
  });

  test('something unparseable means the front page rather than a crash', () => {
    assert.equal(pathOf('http://['), '/');
    // "://" is not unparseable — it resolves to a path of that name, here.
    assert.equal(pathOf('://'), '/://');
  });
});
