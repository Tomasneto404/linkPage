// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The two lockfiles agree with package.json.
 *
 * Docker and CI install with npm from package-lock.json; local development may
 * use pnpm and pnpm-lock.yaml. Both are kept, and they drift silently: once
 * already, swagger-ui-dist reached package-lock.json but not pnpm-lock.yaml,
 * and `pnpm run dev` broke for anyone installing with pnpm while every npm
 * build carried on fine. This fails on the commit that lets them drift.
 *
 * The two may resolve a range to different versions — that is each tool's own
 * business. What they must agree on is the list of dependencies and the range
 * each is declared with, and each must resolve to a version inside that range.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg  = require('../package.json');
const npm  = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const pnpm = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');

const declared = { ...pkg.dependencies, ...(pkg.devDependencies || {}) };

/**
 * The root importer's dependencies from pnpm-lock.yaml, as { name: { specifier,
 * version } }. Read by hand rather than with a YAML parser, which would be a
 * dependency of its own; the shape pnpm writes here is fixed.
 */
function pnpmImporter() {
  const block = pnpm.match(/^importers:\n\n  \.:\n([\s\S]*?)\n\n\S/m);
  assert.ok(block, 'pnpm-lock.yaml has a root importer');
  const out = {};
  const entry = /^      ('?)([^'\n:]+)\1:\n        specifier: (.+)\n        version: ([^\s(]+)/gm;
  for (const [, , name, specifier, version] of block[1].matchAll(entry)) {
    out[name] = { specifier: specifier.replace(/^'|'$/g, ''), version };
  }
  return out;
}

/** Whether `version` satisfies `range`, for the range forms package.json uses here. */
function satisfies(version, range) {
  const parse = v => v.split('-')[0].split('.').map(Number);
  const [major, minor, patch] = parse(version);
  const m = range.match(/^([\^~]?)(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(m, `range ${range} is one this test understands (^x.y.z, ~x.y.z or x.y.z)`);
  const [, op, rMaj, rMin, rPat] = m;
  const [a, b, c] = [Number(rMaj), Number(rMin), Number(rPat)];
  const atLeast = major > a || (major === a && (minor > b || (minor === b && patch >= c)));
  if (!atLeast) return false;
  if (op === '')  return major === a && minor === b && patch === c;
  if (op === '~') return major === a && minor === b;
  return a > 0 ? major === a : minor === b;   // ^0.y.z holds the minor
}

test('package.json declares something to check', () => {
  assert.ok(Object.keys(declared).length > 0);
});

describe('package-lock.json', () => {
  const root = npm.packages?.[''];

  test('records every dependency with the range package.json gives it', () => {
    const locked = { ...(root?.dependencies || {}), ...(root?.devDependencies || {}) };
    assert.deepEqual(locked, declared, 'run `npm install` to bring it up to date');
  });

  test('resolves each to a version inside that range', () => {
    for (const [name, range] of Object.entries(declared)) {
      const resolved = npm.packages[`node_modules/${name}`]?.version;
      assert.ok(resolved, `${name} is not installed by package-lock.json`);
      assert.ok(satisfies(resolved, range), `${name}@${resolved} is outside ${range}`);
    }
  });

  test('is for this version of the package', () => {
    assert.equal(npm.version, pkg.version);
    assert.equal(root.version, pkg.version);
  });
});

describe('pnpm-lock.yaml', () => {
  const importer = pnpmImporter();

  test('records every dependency with the range package.json gives it', () => {
    const locked = Object.fromEntries(Object.entries(importer).map(([n, e]) => [n, e.specifier]));
    assert.deepEqual(locked, declared, 'run `pnpm install` to bring it up to date');
  });

  test('resolves each to a version inside that range, and lists that version', () => {
    for (const [name, range] of Object.entries(declared)) {
      const { version } = importer[name];
      assert.ok(satisfies(version, range), `${name}@${version} is outside ${range}`);
      assert.ok(pnpm.includes(`\n  ${name}@${version}:\n`) || pnpm.includes(`\n  '${name}@${version}':\n`),
        `${name}@${version} has no entry under packages`);
    }
  });
});

describe('the range check itself', () => {
  test('agrees with npm on the forms used here', () => {
    assert.equal(satisfies('4.22.2', '^4.18.3'), true);
    assert.equal(satisfies('5.0.0',  '^4.18.3'), false);
    assert.equal(satisfies('4.18.2', '^4.18.3'), false);
    assert.equal(satisfies('0.3.9',  '^0.3.1'),  true);
    assert.equal(satisfies('0.4.0',  '^0.3.1'),  false);
    assert.equal(satisfies('1.2.9',  '~1.2.3'),  true);
    assert.equal(satisfies('1.3.0',  '~1.2.3'),  false);
    assert.equal(satisfies('1.2.3',  '1.2.3'),   true);
  });
});
