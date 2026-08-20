// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Update checker. RELEASES_REPO points at a repo that cannot exist, so the
 * GitHub call always fails and the endpoint takes its documented offline
 * branch — deterministic whether or not the runner has network.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

process.env.RELEASES_REPO = 'linkpage-tests/definitely-not-a-real-repo';

const harness = require('./helpers/harness');
const pkg     = require('../package.json');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

describe('GET /api/version', () => {
  test('is admin-only', async () => {
    assert.equal((await c.pub('/api/version')).status, 401);
  });

  test('reports the running build from package.json', async () => {
    const { status, body } = await c.api('/api/version');
    assert.equal(status, 200);
    assert.equal(body.current, pkg.version);
    assert.match(body.current, /^\d+\.\d+\.\d+$/);
  });

  test('the payload shape is stable', async () => {
    const { body } = await c.api('/api/version');
    for (const key of ['current', 'latest', 'update_available', 'newer_releases', 'releases_url']) {
      assert.ok(key in body, `missing ${key}`);
    }
    assert.ok(Array.isArray(body.newer_releases));
    assert.equal(typeof body.update_available, 'boolean');
  });

  test('an unreachable release feed degrades gracefully instead of erroring', async () => {
    const { body } = await c.api('/api/version');
    assert.equal(body.error, 'github_unreachable');
    assert.equal(body.latest, null);
    assert.equal(body.update_available, false, 'never nag when the check failed');
    assert.deepEqual(body.newer_releases, []);
  });

  test('RELEASES_REPO is honoured, so forks can point at their own repo', async () => {
    const { body } = await c.api('/api/version');
    assert.equal(body.releases_url, 'https://github.com/linkpage-tests/definitely-not-a-real-repo/releases');
  });
});

describe('semver comparison', () => {
  // Required inside the tests, not in the suite body: anything from src/ pulls in
  // config/env, which creates DATA_DIR on import — and that must be the harness's
  // temp directory, never the repo's ./data.
  const compareSemver = (...args) => require('../src/services/versionService').compareSemver(...args);

  test('orders releases correctly', () => {
    assert.ok(compareSemver('1.0.4', '1.0.3') > 0);
    assert.ok(compareSemver('1.0.3', '1.0.4') < 0);
    assert.equal(compareSemver('1.0.4', '1.0.4'), 0);
    assert.ok(compareSemver('1.1.0', '1.0.9') > 0);
    assert.ok(compareSemver('2.0.0', '1.9.9') > 0);
  });

  test('tolerates a v prefix and missing segments', () => {
    assert.equal(compareSemver('v1.0.4', '1.0.4'), 0);
    assert.ok(compareSemver('1.1', '1.0.9') > 0);
    assert.ok(compareSemver('v2', '1.9.9') > 0);
  });

  test('garbage never reports an upgrade over a real version', () => {
    assert.ok(compareSemver('not-a-version', '1.0.4') <= 0);
  });
});
