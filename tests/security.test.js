// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Security headers, error shapes, static serving and traversal attempts. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');
const { fileForm, pngBytes } = harness;

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

describe('headers', () => {
  test('every response carries the baseline security headers', async () => {
    for (const res of [await c.pub('/'), await c.pub('/api/settings'), await c.api('/api/icons')]) {
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    }
  });

  test('uploads are served with revalidation so edited files never go stale', async () => {
    const link = await c.makeFileLink({ name: 'Doc', fileName: 'doc.txt', type: 'text/plain', bytes: Buffer.from('v1') });
    const res = await c.pub(link.file_path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control'), /no-cache/);
    assert.ok(res.headers.get('etag'), 'ETag present for conditional requests');
  });
});

describe('error shapes', () => {
  test('an unknown API path is a JSON 404, not an HTML page', async () => {
    const res = await c.api('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    assert.ok(res.body.error);
  });

  test('malformed JSON is a 400 with no stack trace', async () => {
    const res = await c.api('/api/settings/site-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "title": ',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /malformed json/i);
    assert.ok(!/\bat \w+ \(/.test(res.text), 'no stack trace in the body');
  });

  test('an over-limit upload is a JSON 413', async () => {
    const tooBig = Buffer.alloc(6 * 1024 * 1024, 0);   // icon uploads cap at 5 MB
    const res = await c.api('/api/icons', {
      method: 'POST',
      form: fileForm('image', { name: 'huge.png', type: 'image/png', bytes: tooBig }),
    });
    assert.equal(res.status, 413);
    assert.match(res.body.error, /too large/i);
  });

  test('a 5xx would still be JSON — the handler never renders HTML', async () => {
    // Exercised indirectly: the handler is the last middleware and always
    // res.json()s. Assert the contract on a route that reaches it via multer.
    const res = await c.api('/api/links', {
      method: 'POST',
      form: fileForm('image', { name: 'x.exe', type: 'application/octet-stream', bytes: Buffer.from([0]) }, { name: 'X', url: 'https://x.invalid' }),
    });
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
  });
});

describe('path traversal', () => {
  test('a traversal attempt on /uploads cannot escape the directory', async () => {
    // Something to reach for outside the uploads dir.
    fs.writeFileSync(path.join(c.dataDir, 'admin-token.txt.copy'), 'secret');

    for (const attempt of [
      '/uploads/../admin-token.txt',
      '/uploads/..%2fadmin-token.txt',
      '/uploads/%2e%2e/admin-token.txt',
      '/uploads/....//admin-token.txt',
    ]) {
      const res = await c.pub(attempt);
      assert.ok(res.status >= 300 || !res.text.match(/^[0-9a-f]{64}$/),
        `${attempt} must not return the token (status ${res.status})`);
      assert.ok(!res.text.includes('secret'), attempt);
    }
  });

  test('the file editor resolves inside uploads only', async () => {
    const link = await c.makeFileLink({ name: 'Editable', fileName: 'ok.txt', type: 'text/plain', bytes: Buffer.from('fine') });

    // Point the stored path outside the uploads dir behind the API's back; the
    // controller must still refuse to read it (path.basename + relative check).
    const { db } = require('../src/config/db');
    db.prepare('UPDATE links SET file_path = ?, file_name = ? WHERE id = ?')
      .run('../../admin-token.txt', 'admin-token.txt', link.id);

    const res = await c.api(`/api/links/${link.id}/file`);
    assert.notEqual(res.status, 200, 'reading outside uploads must fail');
    assert.ok(!(res.body?.content || '').match(/^[0-9a-f]{64}$/));
  });
});

describe('write protection', () => {
  test('public visitors cannot mutate anything', async () => {
    const writes = [
      ['POST',   '/api/links',                 { name: 'x', url: 'https://x.invalid' }],
      ['POST',   '/api/groups',                { name: 'x' }],
      ['POST',   '/api/settings/theme',        { accent_color: '#000000' }],
      ['POST',   '/api/icons/bulk-delete',     { ids: [1] }],
      ['DELETE', '/api/audit',                 {}],
      ['POST',   '/api/links/reorder',         { order: [1] }],
      ['POST',   '/api/ip-tags',               { ip_address: '1.1.1.1', tag: 'x' }],
    ];
    for (const [method, url, json] of writes) {
      const res = await c.pub(url, { method, json });
      assert.equal(res.status, 401, `${method} ${url}`);
    }
  });

  test('the admin SPA and the public page are served without a token', async () => {
    // /admin 301s to /admin/ (static directory), so follow redirects here.
    for (const url of ['/', '/admin']) {
      const res = await c.pub(url, { redirect: 'follow' });
      assert.equal(res.status, 200, url);
      assert.match(res.text, /<html/i);
    }
  });

  test('a query string cannot smuggle the token in', async () => {
    const res = await c.pub(`/api/icons?token=${c.token}`);
    assert.equal(res.status, 401, 'only the X-Admin-Token header counts');
  });
});

describe('input hardening', () => {
  test('SQL-ish input is stored as data, never executed', async () => {
    const evil = "Robert'); DROP TABLE links;--";
    const link = await c.makeLink({ name: evil, url: 'https://sqli.invalid/x' });
    assert.equal(link.name, evil, 'stored verbatim');

    const list = await c.api('/api/links');
    assert.ok(list.body.some(l => l.id === link.id), 'the table is still there');
  });

  test('HTML in a name is returned as-is for the client to escape', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const link = await c.makeLink({ name: xss, url: 'https://xss.invalid/x' });
    assert.equal(link.name, xss);
    const res = await c.api('/api/links');
    assert.match(res.headers.get('content-type'), /application\/json/, 'never served as HTML');
  });

  test('an oversized JSON body is refused', async () => {
    const huge = JSON.stringify({ icons: 'x'.repeat(33 * 1024 * 1024) });   // limit is 32 MB
    const res = await c.api('/api/icons/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: huge,
    });
    assert.equal(res.status, 413);
    assert.match(res.body.error, /too large/i);
  });

  test('an image upload with a mismatched extension is refused', async () => {
    const res = await c.api('/api/icons', {
      method: 'POST',
      form: fileForm('image', { name: 'sneaky.php', type: 'image/png', bytes: pngBytes() }),
    });
    assert.equal(res.status, 400, 'the extension allow-list is checked, not just the MIME type');
  });
});
