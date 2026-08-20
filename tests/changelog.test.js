// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Changelog endpoint + the release contract around it.
 *
 * CHANGELOG.md is the single source of truth for the in-app changelog, the
 * GitHub release notes (the workflow lifts the tag's section out of it) and the
 * version guard in CI. These tests are what keep the three honest: a release
 * should only ever need `version` in package.json bumped and a matching section
 * written here.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');
const pkg     = require('../package.json');

const REPO_ROOT     = path.join(__dirname, '..');
const CHANGELOG     = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
const ADMIN_HTML    = fs.readFileSync(path.join(REPO_ROOT, 'public/admin/index.html'), 'utf8');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/docker-publish.yml');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

describe('GET /api/changelog', () => {
  test('is admin-only', async () => {
    assert.equal((await c.pub('/api/changelog')).status, 401);
  });

  test('serves the parsed file, newest release first', async () => {
    const { status, body } = await c.api('/api/changelog');
    assert.equal(status, 200);
    assert.equal(body.current, pkg.version);
    assert.ok(Array.isArray(body.releases) && body.releases.length > 0);

    const versions = body.releases.map(r => r.version);
    const sorted   = [...versions].sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
    });
    assert.deepEqual(versions, sorted, 'releases must be listed newest first');
  });

  test('every entry carries a title and a description', async () => {
    const { body } = await c.api('/api/changelog');
    for (const release of body.releases) {
      assert.match(release.version, /^\d+\.\d+\.\d+/, `bad version ${release.version}`);
      assert.ok(release.entries.length > 0, `${release.version} has no entries`);
      for (const entry of release.entries) {
        assert.ok(entry.title?.trim(), `${release.version}: entry without a title`);
        assert.ok(entry.description?.trim(), `${release.version}: "${entry.title}" has no description`);
      }
    }
  });

  test('the running build is documented — the release checklist in one assertion', async () => {
    const { body } = await c.api('/api/changelog');
    assert.equal(body.documented, true,
      `package.json is ${pkg.version} but CHANGELOG.md's newest section is ${body.releases[0]?.version}`);
    assert.equal(body.releases[0].version, pkg.version);
  });

  test('the file preamble is not mistaken for release notes', async () => {
    const { body } = await c.api('/api/changelog');
    const titles = body.releases.flatMap(r => r.entries.map(e => e.title));
    assert.ok(!titles.some(t => /^Changelog$/i.test(t)));
  });
});

describe('version has a single source', () => {
  test('package.json is the only place the current version is written', () => {
    // The admin panel used to hard-code the version in two spots; both are now
    // filled from /api/version, so a release never edits HTML.
    const hardcoded = ADMIN_HTML.match(/v\d+\.\d+\.\d+/g) || [];
    assert.deepEqual(hardcoded, [], `admin/index.html still hard-codes ${hardcoded.join(', ')}`);
  });

  test('the sidebar has the slots the version writer fills', () => {
    assert.match(ADMIN_HTML, /id="changelogVersionLabel"/);
    assert.match(ADMIN_HTML, /id="settingsCurrentVersion"/);
    assert.match(ADMIN_HTML, /id="changelogBody"/);
  });

  test('CHANGELOG.md heads with the version being shipped', () => {
    const first = CHANGELOG.split(/\r?\n/).find(l => /^##\s+v?\d/.test(l));
    assert.equal(first?.trim(), `## v${pkg.version}`);
  });

  test('the release workflow guards the tag against both files', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    assert.match(workflow, /require\('\.\/package\.json'\)\.version/, 'no package.json check');
    assert.match(workflow, /CHANGELOG\.md/, 'no changelog check');
    assert.match(workflow, /gh release (create|edit)/, 'no GitHub Release step');
  });
});

describe('changelog parser', () => {
  const parse = (...a) => require('../src/services/changelogService').parseChangelog(...a);

  test('reads headings, joins wrapped paragraphs and ignores the preamble', () => {
    const releases = parse([
      '# Changelog', '', 'Some maintainer notes.', '',
      '## v2.0.0', '', '### Big thing', 'First line', 'second line', '',
      '### Another', 'Only line', '',
      '## v1.9.0', '', '### Old thing', 'Was fine', '',
    ].join('\n'));

    assert.equal(releases.length, 2);
    assert.equal(releases[0].version, '2.0.0');
    assert.equal(releases[0].entries.length, 2);
    assert.equal(releases[0].entries[0].description, 'First line second line');
    assert.equal(releases[1].entries[0].title, 'Old thing');
  });

  test('drops release headings that have no entries', () => {
    assert.deepEqual(parse('## v3.0.0\n\n## v2.0.0\n### Real\nText'), [
      { version: '2.0.0', entries: [{ title: 'Real', description: 'Text' }] },
    ]);
  });
});
