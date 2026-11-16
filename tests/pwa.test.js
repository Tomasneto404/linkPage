// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const harness = require('./helpers/harness');
let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

test('installation resources are public even on a members-only instance', async () => {
  await c.api('/api/settings/require-login', { method: 'POST', json: { enabled: true } });
  const result = await c.pub('/manifest.webmanifest');
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /manifest\+json/);
  const manifest = JSON.parse(result.text);
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) assert.ok(manifest.icons.some(icon => icon.sizes === `${size}x${size}` && icon.purpose === 'any'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of [...manifest.icons, { src: '/pwa/apple-touch-icon.png', sizes: '180x180' }]) {
    const response = await fetch(c.baseUrl + icon.src);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
});

test('worker and manifest always revalidate and the worker controls the root scope', async () => {
  for (const url of ['/sw.js', '/manifest.webmanifest']) {
    const response = await c.pub(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-cache/);
    if (url === '/sw.js') assert.equal(response.headers.get('service-worker-allowed'), '/');
  }
});

test('public, admin and sign-in pages expose the same installation identity', async () => {
  for (const url of ['/', '/admin/', '/login/']) {
    const result = await c.pub(url);
    assert.equal(result.status, 200);
    assert.match(result.text, /rel="manifest" href="\/manifest.webmanifest"/);
    assert.match(result.text, /rel="apple-touch-icon" href="\/pwa\/apple-touch-icon.png"/);
    assert.match(result.text, /src="\/pwa\/pwa.js" defer/);
  }
});
