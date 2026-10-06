// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A headless browser for the browser tests, from playwright-core.
 *
 * The browser itself is not a dependency: install it once with
 *
 *     npx playwright-core install chromium-headless-shell
 *
 * or point LINKPAGE_BROWSER_PATH at any Chromium-based executable. Without
 * either, the tests skip with a message saying so — except under CI, where a
 * missing browser is a broken pipeline and fails loudly.
 */

const { chromium } = require('playwright-core');

const INSTALL_HINT = 'no browser: run `npx playwright-core install chromium-headless-shell`, '
                   + 'or set LINKPAGE_BROWSER_PATH';

async function launchBrowser() {
  try {
    return await chromium.launch({
      headless: true,
      executablePath: process.env.LINKPAGE_BROWSER_PATH || undefined,
    });
  } catch (err) {
    if (process.env.CI) throw err;
    if (/Executable doesn't exist|ENOENT|install/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * Wraps node:test's `test` so each one skips cleanly when there is no browser.
 * `getBrowser` is read when the test runs, after before() has launched it.
 */
function browserTest(test, getBrowser) {
  return (name, fn) => test(name, async t => {
    if (!getBrowser()) return t.skip(INSTALL_HINT);
    return fn(t);
  });
}

module.exports = { launchBrowser, browserTest, INSTALL_HINT };
