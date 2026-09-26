// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The accent maths on the server, checked against the browser's.
 *
 * src/utils/color.js mirrors shadeColor/hexToRgb in public/app.js, because a
 * rendered markdown page has no script of its own and the server has to work
 * the shade out for it. This reads the browser copy off disk and runs both
 * over the same inputs, so the two cannot quietly drift apart.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('node:vm');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { hexToRgb, shadeColor } = require('../src/utils/color');

/** Lifts the two helpers out of public/app.js and evaluates them alone. */
function browserCopy() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const grab = name => {
    const at = src.indexOf(`function ${name}(`);
    assert.notEqual(at, -1, `${name} should still exist in public/app.js`);
    // Walk the braces so the whole body comes across, comments and all.
    let depth = 0, i = src.indexOf('{', at);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
    }
    assert.fail(`could not read ${name} out of public/app.js`);
  };

  const context = {};
  vm.createContext(context);
  vm.runInContext(`${grab('hexToRgb')}\n${grab('shadeColor')}`, context);
  return context;
}

describe('hexToRgb', () => {
  test('splits a colour into its channels', () => {
    assert.deepEqual(hexToRgb('#0071e3'), [0, 113, 227]);
    assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255]);
    assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  });

  test('tolerates case and surrounding space', () => {
    assert.deepEqual(hexToRgb('  #FF2D55 '), [255, 45, 85]);
  });

  test('refuses anything that is not #rrggbb', () => {
    for (const bad of ['#fff', 'red', '0071e3', '#12345g', '', null, undefined, 42]) {
      assert.equal(hexToRgb(bad), null, JSON.stringify(bad));
    }
  });
});

describe('shadeColor', () => {
  test('lightens toward white and darkens toward black', () => {
    assert.equal(shadeColor('#000000', 100), '#ffffff');
    assert.equal(shadeColor('#ffffff', -100), '#000000');
    assert.equal(shadeColor('#0071e3', 0), '#0071e3');
  });

  test('refuses a colour it cannot read', () => {
    assert.equal(shadeColor('nope', 10), null);
  });
});

describe('it agrees with the copy in the browser', () => {
  test('over the shades the accent actually uses', () => {
    const browser = browserCopy();

    for (const hex of ['#0071e3', '#ff2d55', '#00c7be', '#111111', '#eeeeee']) {
      // Joined, not deep-compared: the browser copy runs in its own vm realm,
      // so its arrays have a different Array.prototype and deepStrictEqual
      // would fail on identical numbers.
      assert.equal(hexToRgb(hex).join(','), browser.hexToRgb(hex).join(','), `hexToRgb ${hex}`);

      // +18 is the dark-mode lift, ±12/−8 the hover shades.
      for (const pct of [18, 12, -8, 0, 100, -100]) {
        assert.equal(shadeColor(hex, pct), browser.shadeColor(hex, pct),
          `shadeColor(${hex}, ${pct})`);
      }
    }
  });
});
