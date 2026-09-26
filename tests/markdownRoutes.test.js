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

// ─── Theme and framing ───────────────────────────────────────────────────────

/** The opening <html …> tag, so assertions do not depend on attribute order. */
const htmlTag = text => text.match(/<html[^>]*>/)[0];

describe('the rendered page follows the site theme', () => {
  test('?theme=dark pins the document to dark', async () => {
    await makeMarkdownLink({ name: 'Dark doc', slug: 'dark-doc' });

    const res = await visit('/f/dark-doc?theme=dark');
    assert.equal(res.status, 200);
    assert.match(htmlTag(res.text), /data-theme="dark"/);
  });

  test('?theme=light pins it to light', async () => {
    await makeMarkdownLink({ name: 'Light doc', slug: 'light-doc' });

    const res = await visit('/f/light-doc?theme=light');
    assert.match(htmlTag(res.text), /data-theme="light"/);
  });

  test('no parameter leaves it to the reader\'s system setting', async () => {
    await makeMarkdownLink({ name: 'System doc', slug: 'system-doc' });

    const res = await visit('/f/system-doc');
    // What matters is that the <html> tag carries no attribute pinning the
    // theme, leaving color-scheme and the tokens to the reader's setting.
    assert.doesNotMatch(htmlTag(res.text), /data-theme=/);
  });

  test('a junk theme is ignored rather than reflected', async () => {
    await makeMarkdownLink({ name: 'Junk theme', slug: 'junk-theme' });

    for (const bad of ['purple', '"><script>alert(1)</script>', 'dark evil', '']) {
      const res = await visit(`/f/junk-theme?theme=${encodeURIComponent(bad)}`);
      assert.equal(res.status, 200);
      assert.doesNotMatch(htmlTag(res.text), /data-theme=/, `reflected into the tag: ${bad}`);
      assert.doesNotMatch(res.text, /<script>alert/);
    }
  });

  test('/r/<id> takes the theme too', async () => {
    const link = await makeMarkdownLink({ name: 'By id, dark' });

    const res = await visit(`/r/${link.id}?theme=dark`);
    assert.match(res.text, /data-theme="dark"/);
  });
});

describe('the rendered page wears the site palette', () => {
  const setTheme = json => c.api('/api/settings/theme', { method: 'POST', json });

  after(async () => {
    await setTheme({ light_variant: 'default', dark_variant: 'default', accent_color: '' });
  });

  test('it links the same tokens the site does, rather than its own copy', async () => {
    await makeMarkdownLink({ name: 'Palette', slug: 'palette' });

    const res = await visit('/f/palette');
    assert.match(res.text, /<link rel="stylesheet" href="\/theme-tokens\.css"/);

    const tokens = await c.pub('/theme-tokens.css');
    assert.equal(tokens.status, 200, 'and that file is served');
    assert.match(tokens.text, /--surface:/);
    assert.match(tokens.text, /data-light-variant="snow"/, 'variants live there too');
  });

  test('both variant names ride along, whichever theme is showing', async () => {
    await setTheme({ light_variant: 'warm', dark_variant: 'slate' });
    await makeMarkdownLink({ name: 'Variants', slug: 'variants' });

    const tag = htmlTag((await visit('/f/variants?theme=dark')).text);
    assert.match(tag, /data-light-variant="warm"/);
    assert.match(tag, /data-dark-variant="slate"/);
  });

  test('an unset variant says so rather than being left off', async () => {
    await setTheme({ light_variant: 'default', dark_variant: 'default' });
    await makeMarkdownLink({ name: 'Plain variants', slug: 'plain-variants' });

    const tag = htmlTag((await visit('/f/plain-variants')).text);
    assert.match(tag, /data-light-variant="default"/);
    assert.match(tag, /data-dark-variant="default"/);
  });

  test('a configured accent reaches the document', async () => {
    await setTheme({ accent_color: '#ff2d55', accent_dark_adjust: false });
    await makeMarkdownLink({ name: 'Accent', slug: 'accent-doc' });

    const tag = htmlTag((await visit('/f/accent-doc?theme=light')).text);
    assert.match(tag, /--primary:#ff2d55/);
    assert.match(tag, /--primary-rgb:255,45,85/);
  });

  test('the dark adjustment is applied the same way the site applies it', async () => {
    await setTheme({ accent_color: '#0071e3', accent_dark_adjust: true });
    await makeMarkdownLink({ name: 'Adjusted', slug: 'adjusted' });

    // shadeColor('#0071e3', 18), the same lift public/app.js makes in dark.
    const { shadeColor } = require('../src/utils/color');
    const lifted = shadeColor('#0071e3', 18);

    const dark = htmlTag((await visit('/f/adjusted?theme=dark')).text);
    assert.match(dark, new RegExp(`--primary:${lifted}`), 'lifted in dark');

    const light = htmlTag((await visit('/f/adjusted?theme=light')).text);
    assert.match(light, /--primary:#0071e3/, 'untouched in light');
  });

  test('no accent means no inline override at all', async () => {
    await setTheme({ accent_color: '' });
    await makeMarkdownLink({ name: 'No accent', slug: 'no-accent' });

    const tag = htmlTag((await visit('/f/no-accent')).text);
    assert.doesNotMatch(tag, /--primary/, 'the tokens decide');
  });

  test('the policy allows the stylesheet but still no script', async () => {
    await makeMarkdownLink({ name: 'Policy', slug: 'policy-tokens' });

    const csp = (await visit('/f/policy-tokens')).headers.get('content-security-policy');
    assert.match(csp, /style-src [^;]*'self'/, 'so /theme-tokens.css loads');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /sandbox/);
    assert.doesNotMatch(csp, /script-src/, 'nothing was opened up for scripts');
  });
});

describe('embedded rendering', () => {
  test('?embed=1 drops the page\'s own card and back link', async () => {
    await makeMarkdownLink({ name: 'Embedded', slug: 'embedded' });

    const plain = await visit('/f/embedded');
    assert.match(plain.text, /class="md-back"/, 'the standalone page keeps its way out');

    const embedded = await visit('/f/embedded?embed=1');
    assert.doesNotMatch(embedded.text, /class="md-back"/, 'the overlay supplies its own');
    assert.match(embedded.text, /class="md-shell is-embedded"/);
    assert.match(embedded.text, /<h1>Quarterly Report<\/h1>/, 'the document itself is unchanged');
  });

  test('embed and theme combine', async () => {
    await makeMarkdownLink({ name: 'Both', slug: 'both-params' });

    const res = await visit('/f/both-params?theme=dark&embed=1');
    assert.match(htmlTag(res.text), /data-theme="dark"/);
    assert.match(res.text, /is-embedded/);
  });

  test('anything other than embed=1 renders the full page', async () => {
    await makeMarkdownLink({ name: 'Not embedded', slug: 'not-embedded' });

    for (const value of ['0', 'true', 'yes', '']) {
      const res = await visit(`/f/not-embedded?embed=${value}`);
      assert.match(res.text, /class="md-back"/, `embed=${value} should not embed`);
    }
  });
});

describe('framing', () => {
  test('the markdown page may be framed by this site, and only by this site', async () => {
    await makeMarkdownLink({ name: 'Framed', slug: 'framed' });

    const res = await visit('/f/framed');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  });

  test('every other page keeps the blanket DENY', async () => {
    const link = await c.makeLink({ name: 'Ordinary', url: 'https://ordinary.invalid/x' });

    const redirect = await visit(`/r/${link.id}`);
    assert.equal(redirect.headers.get('x-frame-options'), 'DENY');

    const home = await c.pub('/');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
  });
});

describe('the open-mode setting', () => {
  test('defaults to a new tab', async () => {
    const res = await c.pub('/api/settings');
    assert.equal(res.body.markdown_open_mode, 'tab');
  });

  test('an admin can switch it to a popup, and the public payload reports it', async () => {
    const saved = await c.api('/api/settings/markdown-open-mode', {
      method: 'POST', json: { mode: 'modal' },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.markdown_open_mode, 'modal');

    const settings = await c.pub('/api/settings');
    assert.equal(settings.body.markdown_open_mode, 'modal');

    // And back again.
    await c.api('/api/settings/markdown-open-mode', { method: 'POST', json: { mode: 'tab' } });
    assert.equal((await c.pub('/api/settings')).body.markdown_open_mode, 'tab');
  });

  test('an unknown mode is refused', async () => {
    const res = await c.api('/api/settings/markdown-open-mode', {
      method: 'POST', json: { mode: 'carrier-pigeon' },
    });
    assert.equal(res.status, 400);
    assert.equal((await c.pub('/api/settings')).body.markdown_open_mode, 'tab', 'unchanged');
  });

  test('an anonymous caller cannot change it', async () => {
    const res = await c.pub('/api/settings/markdown-open-mode', {
      method: 'POST', json: { mode: 'modal' },
    });
    assert.equal(res.status, 401);
  });
});
