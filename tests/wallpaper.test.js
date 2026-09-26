// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** The public page wallpaper: one image per theme, and the fog over it. */

const fs   = require('fs');
const path = require('path');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { fileForm, pngBytes } = harness;

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const upload = (variant, name = 'wall.png', type = 'image/png', bytes = pngBytes()) =>
  c.api(`/api/settings/wallpaper/${variant}`, {
    method: 'POST',
    form: fileForm('wallpaper', { name, type, bytes }),
  });

const settings = async () => (await c.pub('/api/settings')).body;
const onDisk   = stored => path.join(c.dataDir, 'uploads', path.basename(stored));

describe('uploading a wallpaper', () => {
  test('there is none to begin with', async () => {
    const s = await settings();
    assert.equal(s.wallpaper_light, null);
    assert.equal(s.wallpaper_dark, null);
  });

  test('each theme takes its own image', async () => {
    const light = await upload('light');
    assert.equal(light.status, 200);
    assert.match(light.body.wallpaper_url, /^\/uploads\//);

    const dark = await upload('dark');
    assert.equal(dark.status, 200);
    assert.notEqual(dark.body.wallpaper_url, light.body.wallpaper_url, 'stored separately');

    const s = await settings();
    assert.equal(s.wallpaper_light, light.body.wallpaper_url);
    assert.equal(s.wallpaper_dark,  dark.body.wallpaper_url);

    assert.ok(fs.existsSync(onDisk(s.wallpaper_light)));
    assert.ok(fs.existsSync(onDisk(s.wallpaper_dark)));
  });

  test('the image is served to visitors', async () => {
    const s = await settings();
    assert.equal((await c.pub(s.wallpaper_light)).status, 200);
  });

  test('replacing one deletes the file it replaced', async () => {
    const before = (await settings()).wallpaper_light;
    const replaced = await upload('light', 'new.png');
    assert.equal(replaced.status, 200);
    assert.notEqual(replaced.body.wallpaper_url, before);

    // safeDeleteFile unlinks asynchronously, so wait for it rather than race it.
    for (let i = 0; i < 60 && fs.existsSync(onDisk(before)); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.ok(!fs.existsSync(onDisk(before)), 'the old wallpaper is gone');
  });

  test('an unknown variant is refused', async () => {
    const res = await upload('sepia');
    assert.equal(res.status, 400);
    assert.match(res.body.error, /light.*dark/i);
  });

  test('a request with no file is refused', async () => {
    const res = await c.api('/api/settings/wallpaper/light', { method: 'POST', form: new FormData() });
    assert.equal(res.status, 400);
  });

  test('a non-image is refused', async () => {
    const res = await upload('light', 'notes.txt', 'text/plain', Buffer.from('not a picture'));
    assert.equal(res.status, 400);
  });

  test('an anonymous caller cannot upload one', async () => {
    const form = fileForm('wallpaper', { name: 'w.png', type: 'image/png', bytes: pngBytes() });
    assert.equal((await c.pub('/api/settings/wallpaper/light', { method: 'POST', form })).status, 401);
  });
});

describe('removing a wallpaper', () => {
  test('it goes, and its file with it', async () => {
    const stored = (await settings()).wallpaper_dark;
    assert.ok(stored);

    const res = await c.api('/api/settings/wallpaper/dark', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await settings()).wallpaper_dark, null);

    for (let i = 0; i < 60 && fs.existsSync(onDisk(stored)); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.ok(!fs.existsSync(onDisk(stored)));
  });

  test('removing one that is not there is harmless', async () => {
    assert.equal((await c.api('/api/settings/wallpaper/dark', { method: 'DELETE' })).status, 200);
  });

  test('an unknown variant is refused', async () => {
    assert.equal((await c.api('/api/settings/wallpaper/sepia', { method: 'DELETE' })).status, 400);
  });
});

describe('the fog', () => {
  test('it reports the documented default before anyone touches it', async () => {
    // Not merely "in range": an unset setting used to read as 0, because
    // Number(null) is 0 and 0 is finite. Pin the actual value.
    const { DEFAULT_WALLPAPER_FOG } = require('../src/config/constants');
    assert.equal((await settings()).wallpaper_fog, DEFAULT_WALLPAPER_FOG);
    assert.equal(DEFAULT_WALLPAPER_FOG, 60);
  });

  test('clearing it back to the default forgets the row rather than storing it', async () => {
    await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog: 10 } });
    assert.equal((await settings()).wallpaper_fog, 10);

    await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog: 60 } });
    assert.equal((await settings()).wallpaper_fog, 60, 'and it still reads back as 60');
  });

  test('it can be set anywhere from clear to solid', async () => {
    for (const fog of [0, 35, 100]) {
      const res = await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog } });
      assert.equal(res.status, 200);
      assert.equal(res.body.wallpaper_fog, fog);
      assert.equal((await settings()).wallpaper_fog, fog);
    }
  });

  test('a value outside the range is refused', async () => {
    for (const fog of [-1, 101, 1000]) {
      const res = await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog } });
      assert.equal(res.status, 400, `${fog} should be refused`);
    }
  });

  test('something that is not a number is refused', async () => {
    for (const fog of ['thick', null, undefined, {}, NaN]) {
      const res = await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog } });
      assert.equal(res.status, 400, `${JSON.stringify(fog)} should be refused`);
    }
  });

  test('a fractional value is rounded rather than rejected', async () => {
    const res = await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog: 42.6 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.wallpaper_fog, 43);
  });

  test('an anonymous caller cannot change it', async () => {
    const res = await c.pub('/api/settings/wallpaper-fog', { method: 'POST', json: { fog: 10 } });
    assert.equal(res.status, 401);
  });
});

describe('bar opacity', () => {
  const setBars = opacity => c.api('/api/settings/bar-opacity', { method: 'POST', json: { opacity } });

  test('it reports the documented default before anyone touches it', async () => {
    const { DEFAULT_BAR_OPACITY } = require('../src/config/constants');
    assert.equal((await settings()).bar_opacity, DEFAULT_BAR_OPACITY);
    assert.equal(DEFAULT_BAR_OPACITY, 82, 'the translucency the bars shipped with');
  });

  test('it spans completely see-through to flat colour', async () => {
    for (const opacity of [0, 50, 100]) {
      const res = await setBars(opacity);
      assert.equal(res.status, 200);
      assert.equal(res.body.bar_opacity, opacity);
      assert.equal((await settings()).bar_opacity, opacity);
    }
  });

  test('a value outside 0\u2013100 is refused', async () => {
    for (const opacity of [-1, 101, 500]) {
      assert.equal((await setBars(opacity)).status, 400, `${opacity} should be refused`);
    }
  });

  test('something that is not a number is refused', async () => {
    for (const opacity of ['solid', null, undefined, {}, NaN]) {
      assert.equal((await setBars(opacity)).status, 400, `${JSON.stringify(opacity)} should be refused`);
    }
  });

  test('a fractional value is rounded', async () => {
    const res = await setBars(63.7);
    assert.equal(res.status, 200);
    assert.equal(res.body.bar_opacity, 64);
  });

  test('an anonymous caller cannot change it', async () => {
    const res = await c.pub('/api/settings/bar-opacity', { method: 'POST', json: { opacity: 5 } });
    assert.equal(res.status, 401);
  });

  test('it is independent of the fog', async () => {
    await setBars(30);
    await c.api('/api/settings/wallpaper-fog', { method: 'POST', json: { fog: 90 } });

    const s = await settings();
    assert.equal(s.bar_opacity, 30, 'setting the fog left the bars alone');
    assert.equal(s.wallpaper_fog, 90);
  });
});
