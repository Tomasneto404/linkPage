// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The flows people actually click through, in a real (headless) browser.
 *
 * The API tests prove what the server allows; these prove the pages drive it:
 * that a sign-in form signs you in, the composer saves a link where you can see
 * it and nobody else can, a star lands in Favourites, members-only sends a
 * stranger to sign in, and single sign-on and email resets go all the way
 * round. Run with `npm run test:browser`.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('../helpers/harness');
const { startFakeOidc } = require('../helpers/fakeOidc');
const { startFakeSmtp } = require('../helpers/fakeSmtp');
const { launchBrowser, browserTest } = require('./helpers/browser');

let c, browser, shared, other;
const PASSWORD = 'a-long-enough-password';
const btest = browserTest(test, () => browser);

before(async () => {
  c = await harness.start();
  browser = await launchBrowser();
  await c.makeUser({ email: 'member@example.test', password: PASSWORD, displayName: 'Mia Member' });
  await c.makeUser({ email: 'boss@example.test', password: PASSWORD, role: 'admin' });
  shared = await c.makeLink({ name: 'Shared handbook', url: 'https://handbook.example.com/' });
  other  = await c.makeLink({ name: 'Shared calendar', url: 'https://calendar.example.com/' });
});
after(async () => {
  await browser?.close();
  await harness.stop();
});

/** A fresh browser profile: its own cookies, its own storage. */
async function freshPage(options = {}) {
  const context = await browser.newContext({ baseURL: c.baseUrl, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  return page;
}

async function signIn(page, email = 'member@example.test', password = PASSWORD, next = '/') {
  await page.goto(`/login/?next=${encodeURIComponent(next)}`);
  await page.fill('#signInEmail', email);
  await page.fill('#signInPassword', password);
  await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login')), page.click('#signInBtn')]);
}

const cardNames = page => page.locator('.link-card:visible .link-name').allTextContents();

/**
 * Waits for the grid to show exactly these cards, in this order. The grid
 * re-renders with a short fade after a tab change, so reading it straight away
 * would catch the view being left rather than the one arrived at.
 */
async function expectCards(page, names) {
  try {
    await page.waitForFunction(expected => {
      const shown = [...document.querySelectorAll('.link-card')]
        .filter(el => el.offsetParent).map(el => el.querySelector('.link-name')?.textContent.trim());
      return JSON.stringify(shown) === JSON.stringify(expected);
    }, names, { timeout: 4000 });
  } catch {
    assert.deepEqual(await cardNames(page), names);
  }
}

describe('the pages', () => {
  // The scripts are several files sharing one scope, run in order. Something
  // called while a page is still loading that lives in a later file throws
  // here — and takes the rest of its own file down with it.
  btest('load without a script error, signed out and signed in', async () => {
    const page = await freshPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const url of ['/', '/login/', '/admin/']) {
      await page.goto(url);
      await page.waitForLoadState('load');
    }
    await page.fill('#adminEmail', 'boss@example.test');
    await page.fill('#adminPassword', PASSWORD);
    await page.click('#adminLoginBtn');
    await page.locator('#openSettingsBtn').waitFor({ state: 'visible' });
    await page.click('#openSettingsBtn');
    for (const tab of await page.locator('#settingsNav .settings-tab').evaluateAll(els => els.map(e => e.dataset.tab))) {
      await page.click(`#settingsNav [data-tab="${tab}"]`);
    }
    await page.goto('/?account=1');
    await page.locator('#accountOverlay').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    await page.context().close();
  });
});

describe('the file editor', () => {
  // Three layers drawn on top of each other: highlighted text, search marks,
  // and a transparent textarea that owns the caret. If any of them lays text
  // out even slightly differently, the caret drifts off the characters it is
  // between — a fraction of a pixel a character, a word by the end of a line.
  const SAMPLE = [
    '# Heading with **bold**',
    'Some `inline code` then text after it, and a long tail to let drift add up',
    'A line with `two` `spans` and more text',
    '- item with *emphasis* and a [link](https://example.com)',
    '\tTabbed line',
    'Ação, coração, ünïcode ✓ end',
  ].join('\n');

  for (const width of [1280, 390]) {
    btest(`the caret sits on the text it edits, ${width}px wide`, async () => {
      if (!(await c.api('/api/links')).body.some(l => l.name === 'Editor sample')) {
        await c.makeFileLink({ name: 'Editor sample', fileName: 'sample.md', type: 'text/markdown',
                               bytes: Buffer.from(SAMPLE) });
      }
      const page = await freshPage({ viewport: { width, height: 800 } });
      await page.goto('/admin/');
      await page.fill('#adminEmail', 'boss@example.test');
      await page.fill('#adminPassword', PASSWORD);
      await page.click('#adminLoginBtn');
      await page.locator('.link-card', { hasText: 'Editor sample' }).first().waitFor({ state: 'attached' });
      await page.evaluate(() => [...document.querySelectorAll('.link-card')]
        .find(c => c.textContent.includes('Editor sample')).querySelector('.edit-file-btn').click());
      await page.locator('#fileEditorPane').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.getElementById('fileEditorTextarea').value.length > 0);
      // The modal scales in; measuring mid-animation would compare a scaled
      // editor with an unscaled ruler.
      await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));

      const drift = await page.evaluate(() => {
        const ta   = document.getElementById('fileEditorTextarea');
        const code = document.getElementById('fileEditorHighlightCode');
        const cs   = getComputedStyle(ta);

        // Where the textarea puts a character, read from a mirror with its own
        // computed style; where the highlight puts it, from a range in its text.
        const mirror = document.createElement('div');
        for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight',
                         'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'fontVariantLigatures'])
          mirror.style[p] = cs[p];
        const box = ta.getBoundingClientRect();
        Object.assign(mirror.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, visibility: 'hidden' });
        document.body.appendChild(mirror);

        const inMirror = i => {
          mirror.textContent = ta.value.slice(0, i);
          const mark = document.createElement('span'); mark.textContent = '\u200b';
          mirror.appendChild(mark);
          return mark.getBoundingClientRect();
        };
        const inHighlight = i => {
          const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
          for (let n, seen = 0; (n = walker.nextNode()); seen += n.length) {
            if (seen + n.length >= i) {
              const r = document.createRange(); r.setStart(n, i - seen); r.setEnd(n, i - seen);
              return r.getClientRects()[0] || r.getBoundingClientRect();
            }
          }
          return null;
        };

        let worst = 0, offset = 0;
        for (const line of ta.value.split('\n')) {
          const end = offset + line.length;
          const a = inMirror(end), b = inHighlight(end);
          worst = Math.max(worst, Math.abs(a.left - b.left), Math.abs(a.top - b.top));
          offset = end + 1;
        }
        mirror.remove();

        // And the line numbers keep pace with the lines.
        const g = getComputedStyle(document.getElementById('fileEditorGutter'));
        const h = getComputedStyle(document.getElementById('fileEditorHighlight'));
        return { worst, gutter: [g.lineHeight, g.paddingTop], text: [h.lineHeight, h.paddingTop] };
      });

      assert.ok(drift.worst < 0.5, `the caret is ${drift.worst.toFixed(1)}px off the text`);
      assert.deepEqual(drift.gutter, drift.text, 'line numbers drift away from their lines');
      await page.context().close();
    });
  }
});

describe('signing in', () => {
  btest('a wrong password says so; the right one lands where you were going', async () => {
    const page = await freshPage();
    await page.goto('/login/?next=%2F%3Fq%3Dhandbook');
    await page.fill('#signInEmail', 'member@example.test');
    await page.fill('#signInPassword', 'not-the-password');
    await page.click('#signInBtn');
    await page.locator('#signInError').waitFor({ state: 'visible' });
    assert.match(await page.textContent('#signInError'), /Wrong email or password/);

    await page.fill('#signInPassword', PASSWORD);
    await Promise.all([page.waitForURL('**/?q=handbook'), page.click('#signInBtn')]);
    await page.locator('#accountBtn').waitFor({ state: 'visible' });
    await page.context().close();
  });

  btest('an administrator signs in to the panel with a password', async () => {
    const page = await freshPage();
    await page.goto('/admin/');
    await page.fill('#adminEmail', 'boss@example.test');
    await page.fill('#adminPassword', PASSWORD);
    await page.click('#adminLoginBtn');
    await page.locator('#openSettingsBtn').waitFor({ state: 'visible' });
    await page.context().close();
  });
});

describe('your own links', () => {
  btest('the composer saves a link into a new group, visible to you and nobody else', async () => {
    const page = await freshPage();
    await signIn(page);

    await page.click('#accountBtn');
    await page.click('[data-act="add-link"]');
    await page.locator('#myLinkOverlay').waitFor({ state: 'visible' });
    await page.fill('#myLinkName', 'My reading list');
    await page.fill('#myLinkUrl', 'https://reading.example.org/');
    await page.selectOption('#myLinkGroup', '__new');
    await page.fill('#myLinkNewGroup', 'Reading');
    await page.click('#myLinkSubmitBtn');
    await page.locator('#myLinkOverlay').waitFor({ state: 'hidden' });

    await page.locator('.tab', { hasText: 'Reading' }).click();
    await expectCards(page, ['My reading list']);

    const stranger = await freshPage();
    await stranger.goto('/');
    await stranger.locator('.link-card').first().waitFor();
    assert.ok(!(await cardNames(stranger)).includes('My reading list'));
    assert.equal(await stranger.locator('.tab', { hasText: 'Reading' }).count(), 0);

    await page.context().close();
    await stranger.context().close();
  });
});

describe('favourites', () => {
  btest('a star puts a shared link in Favourites, and a hold-and-slide reorders them on touch', async () => {
    const page = await freshPage({ hasTouch: true });
    await signIn(page);

    for (const name of ['Shared handbook', 'Shared calendar']) {
      await page.locator('.link-card', { hasText: name }).locator('.link-fav-btn').click();
    }
    await page.locator('#tabFav').click();
    await expectCards(page, ['Shared handbook', 'Shared calendar']);

    // Hold the first card, slide it onto the right half of the second, let go.
    await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('.link-card')].filter(el => el.offsetParent);
      const [src, dst] = cards;
      const at = (el, fx) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width * fx, y: b.top + b.height / 2 }; };
      const fire = (type, p) => {
        const t = new Touch({ identifier: 1, target: src, clientX: p.x, clientY: p.y });
        src.dispatchEvent(new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true,
        }));
      };
      fire('touchstart', at(src, 0.5));
      await new Promise(r => setTimeout(r, 500));
      fire('touchmove', at(dst, 0.8));
      fire('touchend', at(dst, 0.8));
    });

    await expectCards(page, ['Shared calendar', 'Shared handbook']);
    const saved = await page.evaluate(() => fetch('/api/my/favorites').then(r => r.json()));
    assert.deepEqual(saved.link_ids, [other.id, shared.id]);
    await page.context().close();
  });
});

describe('members-only', () => {
  before(() => c.api('/api/settings/require-login', { method: 'POST', json: { enabled: true } }));
  after(() => c.api('/api/settings/require-login', { method: 'POST', json: { enabled: false } }));

  btest('a stranger is sent to sign in, and back to the links afterwards', async () => {
    const page = await freshPage();
    await page.goto('/');
    await page.waitForURL('**/login/**');
    await page.fill('#signInEmail', 'member@example.test');
    await page.fill('#signInPassword', PASSWORD);
    await Promise.all([page.waitForURL(url => url.pathname === '/'), page.click('#signInBtn')]);
    await page.locator('.link-card', { hasText: 'Shared handbook' }).waitFor();
    await page.context().close();
  });
});

describe('single sign-on', () => {
  let idp;
  before(async () => {
    idp = await startFakeOidc({ autoApprove: { sub: 'browser-sso', email: 'sso-user@example.test', name: 'Sam Sso' } });
    const res = await c.api('/api/settings/oidc', { method: 'PUT', json: {
      enabled: true, issuer: idp.issuer, client_id: idp.clientId, client_secret: idp.clientSecret,
      label: 'Sign in with Authentik', auto_create: true,
    } });
    assert.equal(res.status, 200, res.text);
  });
  after(async () => {
    await c.api('/api/settings/oidc', { method: 'PUT', json: { enabled: false } });
    await idp.stop();
  });

  btest('the button goes to the provider and comes back signed in', async () => {
    const page = await freshPage();
    await page.goto('/login/?next=%2F');
    await Promise.all([
      page.waitForURL(url => url.pathname === '/'),
      page.click('text=Sign in with Authentik'),
    ]);
    await page.locator('#accountBtn').waitFor({ state: 'visible' });
    const me = await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()));
    assert.equal(me.user.email, 'sso-user@example.test');
    await page.context().close();
  });
});

describe('password reset by email', () => {
  let smtp;
  before(async () => {
    smtp = await startFakeSmtp();
    const res = await c.api('/api/settings/mail', { method: 'PUT', json: {
      site_url: c.baseUrl, host: '127.0.0.1', port: smtp.port, security: 'none',
      from: 'links@example.test', password_reset: true,
    } });
    assert.equal(res.status, 200, res.text);
  });
  after(async () => {
    await c.api('/api/settings/mail', { method: 'PUT', json: { password_reset: false } });
    await smtp.stop();
  });

  btest('ask for a link, follow it, choose a password, and sign in with it', async () => {
    await c.makeUser({ email: 'forgot@example.test', password: PASSWORD });
    const page = await freshPage();
    await page.goto('/login/');
    await page.click('#forgotLink');
    await page.fill('#forgotEmail', 'forgot@example.test');
    await page.click('#forgotBtn');
    await page.locator('#forgotSent').waitFor({ state: 'visible' });

    await require('../../src/controllers/mailController').settleResetEmails();
    const message = smtp.messages.find(m => m.to.includes('forgot@example.test'));
    const link = smtp.bodyOf(message).match(/https?:\/\/\S+\/login\/\?reset=[A-Za-z0-9_-]+/)[0];

    await page.goto(link);
    await page.fill('#redeemPassword', 'a-new-password-123');
    await page.fill('#redeemConfirm', 'a-new-password-123');
    await Promise.all([page.waitForURL(url => url.pathname === '/'), page.click('#redeemBtn')]);
    await page.locator('#accountBtn').waitFor({ state: 'visible' });

    const fresh = await freshPage();
    await signIn(fresh, 'forgot@example.test', 'a-new-password-123');
    await fresh.locator('#accountBtn').waitFor({ state: 'visible' });
    await page.context().close();
    await fresh.context().close();
  });
});
