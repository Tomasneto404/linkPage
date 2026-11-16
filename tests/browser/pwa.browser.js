// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('../helpers/harness');
const { launchBrowser, browserTest } = require('./helpers/browser');
let c, browser;
before(async () => {
  c = await harness.start(); browser = await launchBrowser();
  await c.makeUser({ email: 'pwa-admin@example.test', password: 'a-long-enough-password', role: 'admin' });
});
after(async () => { await browser?.close(); await harness.stop(); });
const btest = browserTest(test, () => browser);
async function ready(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
}
for (const width of [1280, 390]) {
  btest(`PWA is installable and safely falls back offline at ${width}px`, async () => {
    const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto('/'); await ready(page);
      const session = await context.newCDPSession(page);
      const { data, errors } = await session.send('Page.getAppManifest');
      assert.ok(data); assert.deepEqual(errors, []);
      // Playwright isolates contexts with incognito profiles, where Chrome
      // deliberately disables installation. All app-related checks must pass.
      const installErrors = (await session.send('Page.getInstallabilityErrors')).installabilityErrors;
      assert.deepEqual(installErrors.filter(error => error.errorId !== 'in-incognito'), []);
      await page.goto('/login/');
      await page.fill('#signInEmail', 'pwa-admin@example.test');
      await page.fill('#signInPassword', 'a-long-enough-password');
      await Promise.all([page.waitForURL('**/admin/**'), page.click('#signInBtn')]);
      await page.locator('#adminWrap').waitFor({ state: 'visible' });
      const cached = await page.evaluate(async () => {
        const names = await caches.keys();
        return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat();
      });
      assert.ok(cached.includes('/offline.html'));
      assert.ok(cached.every(url => url === '/offline.html' || url.startsWith('/pwa/')), 'no API replies, pages, uploads or documents in Cache Storage');
      await context.setOffline(true);
      await page.reload(); await page.locator('h1', { hasText: "You're offline." }).waitFor();
      assert.equal(await page.locator('#adminWrap').count(), 0);
      assert.equal(await page.locator('img').evaluate(el => el.complete && el.naturalWidth > 0), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.LINKPAGE_SCREENSHOTS) {
        fs.mkdirSync(process.env.LINKPAGE_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.LINKPAGE_SCREENSHOTS, `pwa-offline-${width}.png`), fullPage: true });
      }
      await context.setOffline(false);
      await page.click('#retry'); await page.locator('#adminWrap').waitFor({ state: 'visible' });
    } finally { await context.close(); }
  });
}
btest('installation is a user action and existing content stays usable after dismissal', async () => {
  const context = await browser.newContext({ baseURL: c.baseUrl });
  const page = await context.newPage();
  try {
    await page.goto('/'); await ready(page);
    await page.evaluate(() => {
      window.promptCalls = 0;
      const event = new Event('beforeinstallprompt', { cancelable: true });
      event.prompt = async () => { window.promptCalls++; };
      event.userChoice = Promise.resolve({ outcome: 'dismissed' });
      window.dispatchEvent(event);
    });
    assert.equal(await page.evaluate(() => window.promptCalls), 0);
    await page.click('#pwaInstallBtn');
    assert.equal(await page.evaluate(() => window.promptCalls), 1);
    assert.equal(await page.locator('#pwaInstallBtn').isVisible(), false);
    await page.locator('.search-input').fill('Welcome');
    assert.equal(await page.locator('.search-input').inputValue(), 'Welcome');
  } finally { await context.close(); }
});
btest('iOS has installation guidance and standalone mode hides the install action', async () => {
  for (const installed of [false, true]) {
    const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    const page = await context.newPage();
    try {
      await page.addInitScript(value => Object.defineProperty(navigator, 'standalone', { value }), installed);
      await page.goto('/'); await ready(page);
      assert.equal(await page.locator('#pwaInstallBtn').isVisible(), !installed);
      if (!installed) {
        await page.click('#pwaInstallBtn');
        await page.locator('#pwaInstallDialog').waitFor();
        assert.match(await page.locator('#pwaInstallDialog').textContent(), /Add to Home Screen/);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#pwaInstallDialog').isVisible(), false);
      }
    } finally { await context.close(); }
  }
});

btest('worker updates wait for a user reload and remove only obsolete LinkPage caches', async () => {
  const context = await browser.newContext({ baseURL: c.baseUrl });
  const page = await context.newPage();
  try {
    await page.goto('/'); await ready(page);
    await page.locator('.search-input').fill('Unsaved search');
    await page.evaluate(async () => {
      await caches.open('linkpage-offline-obsolete');
      await caches.open('unrelated-cache');
    });
    // A second script in the temporary server represents the next deployment.
    // No repository files or running user instances are changed by this test.
    const source = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8').replace('${CACHE_PREFIX}1', '${CACHE_PREFIX}update-test');
    require('../../src/app').get('/pwa-test-update.js', (_req, res) => res.type('application/javascript').send(source));
    await page.evaluate(async () => { await navigator.serviceWorker.register('/pwa-test-update.js', { scope: '/', updateViaCache: 'none' }); });
    await page.locator('#pwaUpdateNotice').waitFor();
    assert.equal(await page.locator('.search-input').inputValue(), 'Unsaved search');
    await Promise.all([page.waitForEvent('load'), page.click('#pwaUpdateNotice [data-update]')]);
    await ready(page);
    const names = await page.evaluate(() => caches.keys());
    assert.ok(names.includes('linkpage-offline-update-test'));
    assert.ok(names.includes('unrelated-cache'));
    assert.equal(names.includes('linkpage-offline-obsolete'), false);
  } finally { await context.close(); }
});
