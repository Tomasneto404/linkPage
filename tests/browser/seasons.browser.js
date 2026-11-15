// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('../helpers/harness');
const { launchBrowser, browserTest } = require('./helpers/browser');
const calendar = require('../../public/season-calendar');
let c, browser;
before(async () => {
  c = await harness.start();
  browser = await launchBrowser();
  await c.makeUser({ email: 'designer@example.test', password: 'a-long-enough-password', role: 'admin' });
  await c.makeLink({ name: 'Design resources', url: 'https://design.example.invalid/' });
});
after(async () => { await browser?.close(); await harness.stop(); });
const btest = browserTest(test, () => browser);
async function capture(page, name) {
  if (!process.env.LINKPAGE_SCREENSHOTS) return;
  fs.mkdirSync(process.env.LINKPAGE_SCREENSHOTS, { recursive: true });
  await page.waitForTimeout(350); // Let the existing theme and card transitions finish.
  await page.screenshot({ path: path.join(process.env.LINKPAGE_SCREENSHOTS, `${name}.png`), fullPage: true });
}

for (const width of [1280, 390]) {
  btest(`season editor previews, validates, saves and reloads at ${width}px`, async () => {
    await c.api('/api/settings/season', { method: 'POST', json: { name: 'none', schedule: calendar.defaults(), effects: true } });
    const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/login/');
    await page.fill('#signInEmail', 'designer@example.test');
    await page.fill('#signInPassword', 'a-long-enough-password');
    await Promise.all([page.waitForURL('**/admin/**'), page.click('#signInBtn')]);
    await page.locator('#adminWrap').waitFor({ state: 'visible' });
    // On a phone the Settings action lives in the overflow menu.
    await page.evaluate(() => document.getElementById('openSettingsBtn').click());
    await page.click('[data-tab="seasons"]');
    await page.click('[data-season-choice="christmas"]');
    assert.equal(await page.locator('html').getAttribute('data-season'), null, 'draft is local');
    await page.locator('#seasonShowcase .season-effects[data-effect="christmas"]').waitFor();
    assert.equal(await page.locator('#seasonEffects').count(), 0, 'a draft only animates the preview');
    await capture(page, `season-editor-${width}-light`);
    if (width === 1280) {
      await page.route('**/api/settings/season', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Save rejected for review test' }) }));
      await page.click('#saveSeasonBtn');
      await page.waitForFunction(() => document.getElementById('seasonSaveStatus').textContent.includes('Save rejected'));
      assert.equal(await page.locator('html').getAttribute('data-season'), null, 'failed save leaves the active theme intact');
      assert.equal(await page.locator('#saveSeasonBtn').isEnabled(), true, 'draft can be retried');
      await page.unroute('**/api/settings/season');
    }
    await page.click('#saveSeasonBtn');
    await page.waitForFunction(() => document.documentElement.dataset.season === 'christmas');
    await page.locator('#seasonAutoToggle').focus();
    await page.locator('#seasonAutoToggle').press('Space');
    assert.equal(await page.locator('#seasonAutoToggle').isChecked(), true, 'calendar is keyboard accessible');
    await page.fill('#seasonTestDate', '2027-03-28');
    assert.equal(await page.locator('#seasonTestResult').textContent(), 'Easter');
    await page.fill('#seasonTestDate', '2027-01-01');
    assert.equal(await page.locator('#seasonTestResult').textContent(), 'Winter');
    await page.selectOption('[data-rule="christmas"] [data-date="start"]', '2');
    await page.fill('[data-rule="christmas"] [data-day="start"]', '30');
    await page.locator('[data-rule="christmas"] [data-day="start"]').press('Tab');
    assert.equal(await page.locator('[data-rule="christmas"] [data-day="start"]').evaluate(el => el.checkValidity()), false);
    await page.selectOption('[data-rule="christmas"] [data-date="start"]', '12');
    await page.fill('[data-rule="christmas"] [data-day="start"]', '1');
    await page.locator('[data-rule="christmas"] [data-day="start"]').press('Tab');
    await page.locator('#seasonTestDate').scrollIntoViewIfNeeded();
    await capture(page, `season-calendar-${width}-light`);
    await page.click('#saveSeasonBtn');
    await page.waitForFunction(() => document.getElementById('saveSeasonBtn').disabled && !document.getElementById('seasonForm').inert);
    assert.equal((await c.pub('/api/settings')).body.season_schedule.enabled, true);
    await page.reload();
    await page.evaluate(() => document.getElementById('openSettingsBtn').click());
    await page.click('[data-tab="seasons"]');
    assert.equal(await page.locator('#seasonAutoToggle').isChecked(), true);
    assert.equal(await page.locator('[data-season-choice="christmas"]').getAttribute('aria-pressed'), 'true');
    const overflow = await page.locator('#settingsPanels').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false, 'settings content fits the viewport');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await capture(page, `season-editor-${width}-dark`);
    await page.locator('#seasonEffectsToggle').focus();
    await page.locator('#seasonEffectsToggle').press('Space');
    await page.waitForFunction(() => !document.querySelector('#seasonShowcase .season-effects'));
    assert.equal(await page.locator('#seasonEffects').count(), 1, 'effects stay active until saved');
    await page.click('#saveSeasonBtn');
    await page.waitForFunction(() => document.documentElement.dataset.seasonEffects === 'off' && !document.querySelector('#seasonEffects'));
    assert.equal((await c.pub('/api/settings')).body.season_effects, false);
    await page.reload();
    await page.evaluate(() => document.getElementById('openSettingsBtn').click());
    await page.click('[data-tab="seasons"]');
    assert.equal(await page.locator('#seasonEffectsToggle').isChecked(), false);
    await page.click('[data-tab="sso"]');
    assert.doesNotMatch(await page.locator('[data-panel="sso"]').textContent(), /beta|being tested/i);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

btest('all seven themes override base variants and work on public and sign-in pages', async () => {
  const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await c.api('/api/settings/theme', { method: 'POST', json: { light_variant: 'warm', dark_variant: 'slate' } });
  for (const name of calendar.names) {
    await c.api('/api/settings/season', { method: 'POST', json: { name, schedule: calendar.defaults(), effects: true, background: 'static' } });
    for (const theme of ['light', 'dark']) {
      await page.goto('/');
      await page.evaluate(value => { localStorage.setItem('linkpage_theme', value); applyTheme(value); }, theme);
      await page.waitForFunction(value => document.documentElement.dataset.season === value, name);
      const tokens = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        return { bg: css.getPropertyValue('--bg').trim(), color: css.getPropertyValue('--text').trim() };
      });
      assert.notEqual(tokens.bg, theme === 'light' ? '#f6f4ef' : '#0f1219', 'season wins over base variant');
      assert.notEqual(tokens.bg, tokens.color);
      await capture(page, `${name}-${theme}`);
    }
  }
  await c.api('/api/settings/theme', { method: 'POST', json: { accent_color: '#f9eac8' } });
  await page.goto('/login/');
  await page.waitForFunction(() => document.documentElement.dataset.season === 'winter');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('signInBtn')).color === 'rgb(17, 17, 17)');
  assert.equal(await page.locator('#signInBtn').evaluate(el => getComputedStyle(el).color), 'rgb(17, 17, 17)', 'custom pale accents keep readable button text');
  await capture(page, 'season-login-dark');
  await context.close();
});

btest('an open page changes automatically after midnight and on returning to the tab', async () => {
  const schedule = calendar.defaults(); schedule.enabled = true;
  await c.api('/api/settings/season', { method: 'POST', json: { name: 'none', schedule, effects: true } });
  const context = await browser.newContext({ baseURL: c.baseUrl });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-12-31T23:59:40Z') });
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.dataset.season === 'christmas');
  await page.locator('#seasonEffects[data-effect="christmas"]').waitFor();
  await page.clock.runFor(31000);
  assert.equal(await page.locator('html').getAttribute('data-season'), 'winter');
  await page.locator('#seasonEffects[data-effect="winter"]').waitFor();
  await page.clock.setSystemTime(new Date('2027-06-01T12:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(await page.locator('html').getAttribute('data-season'), 'summer');
  await page.locator('#seasonEffects[data-effect="summer"]').waitFor();
  await context.close();
});

for (const width of [1280, 390]) {
  btest(`season particles move, respect reduced motion and keep controls clickable at ${width}px`, async () => {
    const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width, height: 800 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await c.api('/api/settings/season', { method: 'POST', json: { name: 'christmas', schedule: calendar.defaults(), effects: true } });
    await page.goto('/');
    await page.locator('#seasonEffects .season-particle').first().waitFor();
    const count = await page.locator('#seasonEffects .season-particle').count();
    assert.equal(count, width === 1280 ? 36 : 20);
    assert.equal(await page.locator('#seasonEffects').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#seasonEffects').evaluate(el => el.inert), true);
    const transform = await page.locator('#seasonEffects .season-particle').first().evaluate(el => getComputedStyle(el).transform);
    await page.waitForFunction(previous => getComputedStyle(document.querySelector('#seasonEffects .season-particle')).transform !== previous, transform);
    await page.locator('.search-input').fill('Design');
    assert.equal(await page.locator('.search-input').inputValue(), 'Design');
    await page.locator('#themeToggle').click();
    assert.equal(await page.locator('#seasonEffects').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => {
      window.firstParticle = document.querySelector('#seasonEffects .season-particle');
      for (let i = 0; i < 10; i++) window.LinkPageTheme.applySeason('christmas');
    });
    assert.equal(await page.evaluate(() => window.firstParticle === document.querySelector('#seasonEffects .season-particle')), true, 'refreshing an unchanged season reuses its particles');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#seasonEffects .season-particle').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#seasonEffects .season-particle').first().evaluate(el => getComputedStyle(el).animationPlayState), 'running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => !document.getElementById('seasonEffects'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#seasonEffects').waitFor();
    await page.goto('/login/');
    await page.locator('.gate > #seasonEffects').waitFor();
    await page.fill('#signInEmail', 'still-clickable@example.test');
    assert.equal(await page.locator('#signInEmail').inputValue(), 'still-clickable@example.test');
    await capture(page, `snow-login-${width}`);
    await page.evaluate(() => window.LinkPageTheme.applySeason('halloween'));
    await page.locator('#seasonEffects .season-bat-wing').first().waitFor();
    await capture(page, `bats-login-${width}`);
    await page.evaluate(() => window.LinkPageTheme.applySeason('autumn'));
    await page.locator('#seasonEffects[data-effect="autumn"]').waitFor();
    await capture(page, `leaves-login-${width}`);
    await page.evaluate(() => window.LinkPageTheme.applySeason('spring'));
    await page.locator('#seasonEffects[data-effect="spring"]').waitFor();
    await capture(page, `seeds-login-${width}`);
    await page.evaluate(() => window.LinkPageTheme.applySeason('none'));
    await page.waitForFunction(() => !document.getElementById('seasonEffects'));
    assert.deepEqual(errors, []);
    await context.close();
  });
}

for (const width of [1280, 390]) {
  btest(`background modes preview locally, save and preserve the minimalist option at ${width}px`, async () => {
    await c.api('/api/settings/season', { method: 'POST', json: { name: 'christmas', schedule: calendar.defaults(), effects: false, background: 'minimal' } });
    const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const failedImages = [];
    page.on('response', response => { if (response.url().includes('/season-backgrounds/') && response.status() >= 400) failedImages.push(response.url()); });
    await page.goto('/login/');
    await page.fill('#signInEmail', 'designer@example.test');
    await page.fill('#signInPassword', 'a-long-enough-password');
    await Promise.all([page.waitForURL('**/admin/**'), page.click('#signInBtn')]);
    await page.locator('#adminWrap').waitFor({ state: 'visible' });
    await page.evaluate(() => document.getElementById('openSettingsBtn').click());
    await page.click('[data-tab="seasons"]');
    for (const mode of ['static', 'animated', 'minimal']) {
      const before = await page.locator('html').getAttribute('data-season-background');
      await page.click(`[data-background="${mode}"]`);
      assert.equal(await page.locator('html').getAttribute('data-season-background'), before, 'preview is local until saved');
      const previewDisplay = await page.locator('.season-preview-backdrop').evaluate(el => getComputedStyle(el).display);
      assert.equal(previewDisplay, mode === 'minimal' ? 'none' : 'block');
      await page.click('#saveSeasonBtn');
      await page.waitForFunction(value => document.documentElement.dataset.seasonBackground === value && !document.getElementById('seasonForm').inert, mode);
      const backdrop = page.locator('body > .season-backdrop');
      assert.equal(await backdrop.evaluate(el => getComputedStyle(el).display), mode === 'minimal' ? 'none' : 'block');
      assert.equal(await backdrop.evaluate(el => getComputedStyle(el, '::before').animationName), mode === 'animated' ? 'season-landscape-drift' : 'none');
      assert.equal((await c.pub('/api/settings')).body.season_background, mode);
      if (mode !== 'minimal') {
        await page.locator('#settingsPanels').evaluate(el => { el.scrollTop = 0; });
        await capture(page, `background-editor-${mode}-${width}`);
      }
    }
    await page.click('[data-background="animated"]');
    await page.click('#saveSeasonBtn');
    await page.waitForFunction(() => document.documentElement.dataset.seasonBackground === 'animated');
    await page.goto('/');
    await page.waitForFunction(() => document.documentElement.dataset.season === 'christmas');
    await capture(page, `landscape-public-${width}-light`);
    await page.locator('#themeToggle').click();
    await capture(page, `landscape-public-${width}-dark`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.season-backdrop').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
    assert.equal(await page.locator('.season-backdrop').isVisible(), true, 'reduced motion preserves the still landscape');
    assert.deepEqual(failedImages, []);
    await context.close();
  });
}

btest('Markdown inherits seasonal palettes, backgrounds and effects in tabs and the document modal', async () => {
  await c.makeFileLink({ name: 'Seasonal handbook', slug: 'seasonal-handbook', fileName: 'handbook.md', type: 'text/markdown', bytes: Buffer.from('# Seasonal handbook\n\nA calm space to read.\n\n## Resources\n\n- [Design notes](https://example.invalid)\n- Team calendar\n\n<script>window.untrustedRan = true</script>') });
  await c.api('/api/settings/theme', { method: 'POST', json: { accent_color: '' } });
  const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width: 1280, height: 900 }, colorScheme: 'dark', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  for (const season of calendar.names) {
    await c.api('/api/settings/season', { method: 'POST', json: { name: season, schedule: calendar.defaults(), background: 'static', effects: true } });
    await page.goto('/');
    await page.waitForFunction(value => document.documentElement.dataset.season === value, season);
    const palette = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    const response = await page.goto('/f/seasonal-handbook?theme=dark');
    assert.match(response.headers()['content-security-policy'], /default-src 'none'/);
    assert.equal(await page.locator('html').getAttribute('data-season'), season);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), palette);
    assert.equal(await page.locator('script').count(), 0);
    assert.equal(await page.locator('#seasonEffects').getAttribute('data-effect'), season);
    assert.match(await page.locator('.season-backdrop').evaluate(el => getComputedStyle(el, '::before').backgroundImage), /^url\("data:image\/jpeg;base64,/);
    assert.equal(await page.evaluate(() => window.untrustedRan), undefined);
    await capture(page, `markdown-${season}-dark`);
  }
  // A direct URL follows the OS; opening from the site supplies its exact mode.
  await page.goto('/f/seasonal-handbook');
  const system = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  await page.goto('/f/seasonal-handbook?theme=dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()), system);
  await c.api('/api/settings/season', { method: 'POST', json: { name: 'christmas', background: 'animated' } });
  await page.goto('/f/seasonal-handbook?theme=light');
  assert.equal(await page.locator('.season-backdrop').evaluate(el => getComputedStyle(el, '::before').animationName), 'season-landscape-drift');
  await capture(page, 'markdown-christmas-light');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.season-backdrop').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
  assert.equal(await page.locator('#seasonEffects').isVisible(), false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.locator('.link-card', { hasText: 'Seasonal handbook' }).click();
  await page.locator('#mdViewerOverlay').waitFor({ state: 'visible' });
  const frame = page.frameLocator('#mdViewerFrame');
  await frame.locator('h1').waitFor();
  assert.equal(await frame.locator('html').getAttribute('data-season'), 'christmas');
  assert.equal(await frame.locator('html').getAttribute('data-season-background'), 'animated');
  assert.equal(await frame.locator('script').count(), 0);
  await capture(page, 'markdown-modal');
  await c.api('/api/settings/season', { method: 'POST', json: { name: 'autumn', background: 'minimal', effects: false } });
  await page.goto('/f/seasonal-handbook?theme=dark');
  assert.equal(await page.locator('.season-backdrop').isVisible(), false);
  assert.equal(await page.locator('#seasonEffects').count(), 0);
  await context.close();
});
