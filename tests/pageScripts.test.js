// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Every script a page asks for exists, and none is left behind unasked-for.
 *
 * The public page and the admin panel are each several classic scripts loaded
 * in order (public/js/, public/admin/js/). A file renamed without updating its
 * page fails here rather than as a blank screen; a file added but never wired
 * in fails here rather than as a feature that silently does nothing.
 */

const fs   = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PUBLIC = path.join(__dirname, '..', 'public');

function scriptsOf(htmlFile, urlBase) {
  const html = fs.readFileSync(path.join(PUBLIC, htmlFile), 'utf8');
  return [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
    .map(m => new URL(m[1], `http://x${urlBase}`).pathname);
}

for (const [page, base, dir] of [
  ['index.html',       '/',       'js'],
  ['admin/index.html', '/admin/', 'admin/js'],
]) {
  test(`${page}: every script it loads exists`, () => {
    for (const url of scriptsOf(page, base)) {
      assert.ok(fs.existsSync(path.join(PUBLIC, url)), `${page} loads ${url}, which does not exist`);
    }
  });

  test(`${page}: every file in ${dir}/ is loaded, once, with main.js last`, () => {
    const loaded = scriptsOf(page, base).filter(u => u.startsWith(`/${dir}/`)).map(u => path.basename(u));
    const onDisk = fs.readdirSync(path.join(PUBLIC, dir)).filter(f => f.endsWith('.js')).sort();
    assert.deepEqual([...loaded].sort(), onDisk);
    assert.equal(new Set(loaded).size, loaded.length, 'loaded twice');
    assert.equal(loaded[0], 'core.js', 'core.js first: everything else builds on it');
    assert.equal(loaded.at(-1), 'main.js', 'main.js last: it starts everything');
  });
}
