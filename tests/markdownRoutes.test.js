// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Serving a .md-backed link as a rendered page, and the admin preview API. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const DOC = [
  '# Quarterly Report',
  '',
  'Revenue is **up**. See the [dashboard](https://example.com/d).',
  '',
  '<script>alert(1)</script>',
].join('\n');

/** A .md-backed link, optionally with a slug. */
async function makeMarkdownLink({ name = 'Report', slug, body = DOC, groups = [] } = {}) {
  return c.makeFileLink({
    name, fileName: 'report.md', type: 'text/markdown',
    bytes: Buffer.from(body), slug, groups,
  });
}

let ipCounter = 0;
const nextIp = () => `198.51.100.${(ipCounter++ % 240) + 10}`;
const visit = (url, headers = {}) =>
  c.pub(url, { headers: { 'X-Forwarded-For': nextIp(), 'User-Agent': 'test-agent', ...headers } });

describe('/f/<slug> for a markdown link', () => {
  test('renders the document instead of serving the source', async () => {
    await makeMarkdownLink({ name: 'Quarterly Report', slug: 'quarterly' });

    const res = await visit('/f/quarterly');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.text, /<h1>Quarterly Report<\/h1>/);
    assert.match(res.text, /<strong>up<\/strong>/);
    assert.match(res.text, /<a href="https:\/\/example\.com\/d"/);
  });

  test('the page carries a policy that permits no scripts', async () => {
    await makeMarkdownLink({ name: 'Policy check', slug: 'policy-check' });

    const res = await visit('/f/policy-check');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'a CSP is set');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /sandbox/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
  });

  test('raw HTML in the document never becomes markup', async () => {
    await makeMarkdownLink({ name: 'Hostile', slug: 'hostile' });

    const res = await visit('/f/hostile');
    assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
    assert.match(res.text, /&lt;script&gt;/);
  });

  test('the click is still tracked', async () => {
    const link = await makeMarkdownLink({ name: 'Counted', slug: 'counted-md' });
    await visit('/f/counted-md');

    const clicks = await c.api(`/api/links/${link.id}/clicks`);
    assert.equal(clicks.body.recentClicks.length, 1);
  });

  test('the raw source is still reachable under /uploads', async () => {
    const link = await makeMarkdownLink({ name: 'Source', slug: 'source-md' });

    const raw = await c.pub(link.file_path);
    assert.equal(raw.status, 200);
    assert.match(raw.text, /^# Quarterly Report/, 'the original bytes, unrendered');
  });

  test('a non-markdown file is served exactly as before', async () => {
    await c.makeFileLink({
      name: 'Plain text', fileName: 'notes.txt', type: 'text/plain',
      bytes: Buffer.from('# not markdown, just text'), slug: 'plain-text',
    });

    const res = await visit('/f/plain-text');
    assert.equal(res.status, 200);
    assert.equal(res.text, '# not markdown, just text', 'byte-for-byte, no rendering');
    assert.doesNotMatch(res.headers.get('content-type') || '', /text\/html/);
  });
});

describe('/r/<id> for a markdown link', () => {
  test('renders in place rather than redirecting to the file', async () => {
    const link = await makeMarkdownLink({ name: 'By id' });

    const res = await visit(`/r/${link.id}`);
    assert.equal(res.status, 200, 'no 302 to /uploads/...');
    assert.match(res.text, /<h1>Quarterly Report<\/h1>/);
  });

  test('a URL-backed link still redirects', async () => {
    const link = await c.makeLink({ name: 'Still a redirect', url: 'https://elsewhere.invalid/x' });

    const res = await visit(`/r/${link.id}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://elsewhere.invalid/x');
  });
});

describe('visibility still governs a rendered page', () => {
  test('a hidden markdown link bounces a visitor home', async () => {
    const link = await makeMarkdownLink({ name: 'Hidden doc', slug: 'hidden-doc' });
    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });

    const res = await visit('/f/hidden-doc');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
  });

  test('a markdown link in a locked group is not rendered for a locked-out visitor', async () => {
    const group = await c.makeGroup({ name: 'Locked docs' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Locked docs', password: 'pw' } });
    await makeMarkdownLink({ name: 'Gated doc', slug: 'gated-doc', groups: [group.id] });

    const res = await visit('/f/gated-doc');
    assert.equal(res.headers.get('location'), '/');
    assert.doesNotMatch(res.text || '', /Quarterly Report/);
  });
});

describe('admin preview', () => {
  test('renders through the same path readers get', async () => {
    const res = await c.api('/api/markdown/preview', {
      method: 'POST',
      json: { text: '# Preview\n\n**bold** and <script>alert(1)</script>' },
    });
    assert.equal(res.status, 200);
    assert.match(res.body.html, /<h1>Preview<\/h1>/);
    assert.match(res.body.html, /<strong>bold<\/strong>/);
    assert.doesNotMatch(res.body.html, /<script>alert/);
  });

  test('an anonymous caller is refused', async () => {
    const res = await c.pub('/api/markdown/preview', { method: 'POST', json: { text: '# nope' } });
    assert.equal(res.status, 401);
  });

  test('a missing or oversized body is a 400', async () => {
    assert.equal((await c.api('/api/markdown/preview', { method: 'POST', json: {} })).status, 400);

    const huge = await c.api('/api/markdown/preview', {
      method: 'POST', json: { text: 'x'.repeat(5 * 1024 * 1024 + 1) },
    });
    assert.equal(huge.status, 413);
  });
});
