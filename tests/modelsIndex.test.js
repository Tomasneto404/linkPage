// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The models layer is one flat object built from ten modules.
 *
 * That shape is convenient — `db.getLinkById(...)` reads well — but it has one
 * failure mode: two modules exporting the same name. A spread lets the last one
 * win, silently, and the symptom is not a crash but the wrong query running.
 * The assembler refuses instead, and this pins that it does.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../src/models');

describe('the assembled model surface', () => {
  test('every module\'s functions are reachable through it', () => {
    for (const name of ['readSetting', 'getAllLinks', 'getAllGroups', 'getSectionsForGroup',
                        'recordClick', 'getAllIcons', 'recordAudit', 'createLinkRequest',
                        'getIpTag', 'getTopLinks']) {
      assert.equal(typeof db[name], 'function', `${name} should be exported`);
    }
  });

  test('nothing but functions ends up on it', () => {
    for (const [name, value] of Object.entries(db)) {
      assert.equal(typeof value, 'function', `${name} is not a function`);
    }
  });
});

describe('a name exported twice', () => {
  test('fails at boot, naming both modules', () => {
    // Stage a collision by loading a stub into require.cache under the same
    // specifier the assembler uses, then requiring it.
    const modelsDir = path.join(__dirname, '..', 'src', 'models');
    const script = `
      const path = ${JSON.stringify(modelsDir)};
      const Module = require('module');
      const clicksPath = require.resolve(path + '/clicks');
      require.cache[clicksPath] = {
        id: clicksPath, filename: clicksPath, loaded: true, exports: {
          recordClick: () => {},
          readSetting: () => {},      // already owned by settings.js
        },
      };
      try {
        require(path);
        process.stdout.write('NO ERROR');
      } catch (err) {
        process.stdout.write(err.message);
      }
    `;
    const out = execFileSync(process.execPath, ['-e', script],
                             { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

    assert.match(out, /readSetting/, 'the clashing name is named');
    assert.match(out, /settings\.js/, 'the module that already owned it is named');
    assert.match(out, /clicks\.js/,   'the module that clashed is named');
  });
});
