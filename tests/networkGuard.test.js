// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A member cannot use this server to reach its own network.
 *
 * Saving a personal link, or previewing its icon, makes the server fetch the
 * address the member typed. Without a guard that is a way to send requests to
 * anything the server can reach — localhost, the cloud metadata service, a
 * database on 10.0.0.5 — and to get image-shaped answers back as an icon.
 *
 * These tests run the real favicon fetcher, not the harness's stub, against a
 * server on 127.0.0.1 that keeps count. The assertion that matters is not that
 * nothing came back; it is that nothing ever arrived.
 */

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

// The fetcher loads the models, which open a database: give it a throwaway one
// before anything is required.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkpage-guard-'));
process.env.DATA_DIR    = dataDir;
process.env.UPLOADS_DIR = path.join(dataDir, 'uploads');
process.env.PRIVATE_UPLOADS_DIR = path.join(dataDir, 'private-uploads');
const quiet = console.log;
console.log = () => {};

const { isPrivateAddress } = require('../src/utils/networkGuard');
const { fetchFaviconForUrl } = require('../src/services/faviconService');

console.log = quiet;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64');

/** A server on loopback that serves a favicon and counts every request. */
let server, port, hits;

before(async () => {
  hits = [];
  server = http.createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/favicon.ico') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    if (req.url === '/declares') {
      // A page declaring its icon somewhere on the internal network.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<link rel="icon" href="http://127.0.0.1:${port}/favicon.ico">`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('which addresses count as private', () => {
  test('every internal range is refused', () => {
    for (const address of [
      '127.0.0.1', '127.255.255.254', '10.0.0.5', '172.16.0.1', '172.31.255.255',
      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '255.255.255.255', '198.18.0.1',
      '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
      '64:ff9b::7f00:1', '2002:7f00:1::',
    ]) {
      assert.equal(isPrivateAddress(address), true, address);
    }
  });

  test('public addresses are allowed', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255',
                           '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001::68']) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });

  test('something that is not an address at all is refused, not guessed at', () => {
    for (const value of ['', 'localhost', 'not-an-ip', '999.1.1.1', null, undefined]) {
      assert.equal(isPrivateAddress(value), true, String(value));
    }
  });
});

describe('a member\'s fetch', () => {
  test('never reaches a server on loopback', async () => {
    hits.length = 0;
    const found = await fetchFaviconForUrl(`http://127.0.0.1:${port}/`, { member: true });
    assert.equal(found, null);
    assert.deepEqual(hits, [], 'not a single request arrived');
  });

  test('nor by name', async () => {
    hits.length = 0;
    const found = await fetchFaviconForUrl(`http://localhost:${port}/`, { member: true });
    assert.equal(found, null);
    assert.deepEqual(hits, [], '"localhost" resolves to loopback, and is refused there');
  });

  test('nor through the IPv6 spelling of the same address', async () => {
    hits.length = 0;
    const found = await fetchFaviconForUrl(`http://[::ffff:127.0.0.1]:${port}/`, { member: true });
    assert.equal(found, null);
    assert.deepEqual(hits, []);
  });

  test('never asks Google', async () => {
    // Its URL carries the hostname, and the hostname of a private bookmark is
    // not Google's to know. Watch every outbound request the fetcher makes.
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, opts) => { seen.push(String(url)); return realFetch(url, opts); };
    try {
      await fetchFaviconForUrl(`http://127.0.0.1:${port}/`, { member: true });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(!seen.some(u => u.includes('google.com')), `asked: ${seen.join(', ')}`);
  });
});

describe('the administrator\'s fetch', () => {
  test('still reaches the intranet, which is what an internal link page is for', async () => {
    // Proves the server above really does serve an icon — so the member's null
    // is the guard at work, not a server with nothing to give.
    hits.length = 0;
    const found = await fetchFaviconForUrl(`http://127.0.0.1:${port}/`);
    assert.ok(found, 'an icon came back');
    assert.equal(found.contentType, 'image/png');
    assert.ok(hits.length > 0, 'and requests arrived');
  });

  test('follows a declared icon onto the intranet', async () => {
    const found = await fetchFaviconForUrl(`http://127.0.0.1:${port}/declares`);
    assert.ok(found);
  });
});
