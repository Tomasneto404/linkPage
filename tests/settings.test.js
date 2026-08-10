// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public settings payload, branding uploads, theme validation and toggles. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const harness = require('./helpers/harness');
const { fileForm, pngBytes, svgBytes } = harness;

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const uploadsPath = stored => path.join(c.dataDir, 'uploads', path.basename(stored));

describe('GET /api/settings', () => {
  test('is public and exposes every key the front-end reads', async () => {
    const { status, body } = await c.pub('/api/settings');
    assert.equal(status, 200);
    for (const key of [
      'logo_light', 'logo_dark', 'favicon', 'site_title', 'brand_icon',
      'public_password_required', 'pinned_group_id', 'save_favicons_to_library',
      'requests_enabled', 'request_password_required', 'accent_color',
      'accent_dark_adjust', 'accent_glow', 'mobile_nav_position',
      'theme_light_variant', 'theme_dark_variant', 'default_theme',
      'footer_enabled', 'group_tab_color', 'group_tabs_loop',
    ]) {
      assert.ok(key in body, `missing key ${key}`);
    }
  });

  test('defaults on a fresh install', async () => {
    const { body } = await c.pub('/api/settings');
    assert.equal(body.site_title, null);
    assert.equal(body.brand_icon, null);
    assert.equal(body.logo_light, null);
    assert.equal(body.pinned_group_id, null);
    assert.equal(body.mobile_nav_position, 'top');
    assert.equal(body.theme_light_variant, 'default');
    assert.equal(body.default_theme, 'system');
    // On-by-default flags are stored as an opt-out, so they start true.
    assert.equal(body.footer_enabled, true);
    assert.equal(body.group_tab_color, true);
    assert.equal(body.requests_enabled, false);
    assert.equal(body.group_tabs_loop, false);
  });
});

describe('site title', () => {
  test('saves, is echoed back and lands in the public payload', async () => {
    const res = await c.api('/api/settings/site-title', { method: 'POST', json: { title: '  Acme Hub  ' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.site_title, 'Acme Hub', 'trimmed');

    const { body } = await c.pub('/api/settings');
    assert.equal(body.site_title, 'Acme Hub');
  });

  test('an empty title clears it', async () => {
    const res = await c.api('/api/settings/site-title', { method: 'POST', json: { title: '   ' } });
    assert.equal(res.body.site_title, null);
    const { body } = await c.pub('/api/settings');
    assert.equal(body.site_title, null);
  });
});

describe('header brand icon', () => {
  test('accepts an upload, registers it in the icon library and serves the file', async () => {
    const res = await c.api('/api/settings/brand-icon', {
      method: 'POST',
      form: fileForm('icon', { name: 'brand.svg', type: 'image/svg+xml', bytes: svgBytes() }),
    });
    assert.equal(res.status, 200);
    assert.match(res.body.brand_icon, /^\/uploads\/.+\.svg$/);
    assert.ok(fs.existsSync(uploadsPath(res.body.brand_icon)), 'file written to uploads');

    const icons = await c.api('/api/icons');
    assert.ok(icons.body.some(i => i.file_path === res.body.brand_icon), 'reusable from the library');

    const served = await c.pub(res.body.brand_icon);
    assert.equal(served.status, 200);
  });

  test('accepts a library icon_id instead of a file', async () => {
    const icon = await c.makeIcon({ name: 'lib.svg' });
    const res  = await c.api('/api/settings/brand-icon', { method: 'POST', json: { icon_id: icon.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.brand_icon, icon.file_path);
  });

  test('rejects a request with neither a file nor a valid icon_id', async () => {
    const empty = await c.api('/api/settings/brand-icon', { method: 'POST', json: {} });
    assert.equal(empty.status, 400);
    const bogus = await c.api('/api/settings/brand-icon', { method: 'POST', json: { icon_id: 9999 } });
    assert.equal(bogus.status, 400);
  });

  test('delete clears the setting but keeps the library file', async () => {
    const { body: before } = await c.pub('/api/settings');
    const del = await c.api('/api/settings/brand-icon', { method: 'DELETE' });
    assert.equal(del.status, 204);

    const { body: after } = await c.pub('/api/settings');
    assert.equal(after.brand_icon, null);
    assert.ok(fs.existsSync(uploadsPath(before.brand_icon)), 'the library owns the file lifecycle');
  });
});

describe('logos', () => {
  test('light and dark variants upload independently', async () => {
    for (const variant of ['light', 'dark']) {
      const res = await c.api(`/api/settings/logo/${variant}`, {
        method: 'POST',
        form: fileForm('logo', { name: `${variant}.png`, type: 'image/png', bytes: pngBytes() }),
      });
      assert.equal(res.status, 200, variant);
      assert.match(res.body.logo_url, /^\/uploads\//);
    }
    const { body } = await c.pub('/api/settings');
    assert.ok(body.logo_light && body.logo_dark);
    assert.notEqual(body.logo_light, body.logo_dark);
  });

  test('an unknown variant is rejected', async () => {
    const res = await c.api('/api/settings/logo/sepia', {
      method: 'POST',
      form: fileForm('logo', { name: 'x.png', type: 'image/png', bytes: pngBytes() }),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /light.*dark/i);
  });

  test('a request with no file is rejected', async () => {
    const res = await c.api('/api/settings/logo/light', { method: 'POST', form: new FormData() });
    assert.equal(res.status, 400);
  });

  test('delete removes the file from disk and the setting', async () => {
    const { body: before } = await c.pub('/api/settings');
    const del = await c.api('/api/settings/logo/light', { method: 'DELETE' });
    assert.equal(del.status, 204);

    const { body: after } = await c.pub('/api/settings');
    assert.equal(after.logo_light, null);
    assert.equal(after.logo_dark !== null, true, 'the other variant is untouched');
    assert.ok(!fs.existsSync(uploadsPath(before.logo_light)), 'logos are not library assets, so the file goes');
  });
});

describe('favicon', () => {
  test('upload also adds the file to the icon library', async () => {
    const res = await c.api('/api/settings/favicon', {
      method: 'POST',
      form: fileForm('favicon', { name: 'fav.png', type: 'image/png', bytes: pngBytes() }),
    });
    assert.equal(res.status, 200);
    const icons = await c.api('/api/icons');
    assert.ok(icons.body.some(i => i.file_path === res.body.favicon));
  });

  test('delete unsets it but keeps the library file', async () => {
    const { body: before } = await c.pub('/api/settings');
    const del = await c.api('/api/settings/favicon', { method: 'DELETE' });
    assert.equal(del.status, 204);
    const { body: after } = await c.pub('/api/settings');
    assert.equal(after.favicon, null);
    assert.ok(fs.existsSync(uploadsPath(before.favicon)));
  });
});

describe('theme', () => {
  test('accepts a full valid payload and persists it', async () => {
    const res = await c.api('/api/settings/theme', {
      method: 'POST',
      json: {
        accent_color: '#FF9F0A', accent_dark_adjust: true, accent_glow: true,
        light_variant: 'snow', dark_variant: 'midnight',
        default_theme: 'dark', mobile_nav_position: 'bottom',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.accent_color, '#ff9f0a', 'lowercased');
    assert.equal(res.body.accent_dark_adjust, true);
    assert.equal(res.body.theme_light_variant, 'snow');
    assert.equal(res.body.theme_dark_variant, 'midnight');
    assert.equal(res.body.default_theme, 'dark');
    assert.equal(res.body.mobile_nav_position, 'bottom');

    const { body } = await c.pub('/api/settings');
    assert.equal(body.accent_color, '#ff9f0a');
    assert.equal(body.accent_glow, true);
    assert.equal(body.mobile_nav_position, 'bottom');
  });

  test('a partial payload only touches the fields it carries', async () => {
    const res = await c.api('/api/settings/theme', { method: 'POST', json: { accent_glow: false } });
    assert.equal(res.body.accent_glow, false);
    assert.equal(res.body.accent_color, '#ff9f0a', 'untouched');
    assert.equal(res.body.default_theme, 'dark', 'untouched');
  });

  test('an empty accent_color resets to the built-in default', async () => {
    const res = await c.api('/api/settings/theme', { method: 'POST', json: { accent_color: '' } });
    assert.equal(res.body.accent_color, null);
  });

  test('invalid values are rejected with 400', async () => {
    const cases = [
      { accent_color: 'red' },
      { accent_color: '#ff9' },
      { light_variant: 'neon' },
      { dark_variant: 'neon' },
      { default_theme: 'sepia' },
      { mobile_nav_position: 'left' },
    ];
    for (const json of cases) {
      const res = await c.api('/api/settings/theme', { method: 'POST', json });
      assert.equal(res.status, 400, JSON.stringify(json));
      assert.ok(res.body.error);
    }
  });

  test('default values clear their stored key', async () => {
    const res = await c.api('/api/settings/theme', {
      method: 'POST',
      json: { light_variant: 'default', dark_variant: 'default', default_theme: 'system', mobile_nav_position: 'top' },
    });
    assert.equal(res.body.theme_light_variant, 'default');
    assert.equal(res.body.default_theme, 'system');
    assert.equal(res.body.mobile_nav_position, 'top');
  });
});

describe('toggles', () => {
  const toggles = [
    ['/api/settings/save-favicons',   'save_favicons_to_library', false],
    ['/api/settings/requests-enabled', 'requests_enabled',        false],
    ['/api/settings/footer-enabled',  'footer_enabled',           true],
    ['/api/settings/group-tab-color', 'group_tab_color',          true],
    ['/api/settings/group-tabs-loop', 'group_tabs_loop',          false],
  ];

  for (const [url, key, defaultValue] of toggles) {
    test(`${key} flips both ways and survives a reload`, async () => {
      const off = await c.api(url, { method: 'POST', json: { enabled: !defaultValue } });
      assert.equal(off.status, 200);
      assert.equal(off.body[key], !defaultValue);
      assert.equal((await c.pub('/api/settings')).body[key], !defaultValue);

      const on = await c.api(url, { method: 'POST', json: { enabled: defaultValue } });
      assert.equal(on.body[key], defaultValue);
      assert.equal((await c.pub('/api/settings')).body[key], defaultValue);
    });
  }
});

describe('pinned default group', () => {
  test('accepts an existing group id', async () => {
    const group = await c.makeGroup({ name: 'Pinned' });
    const res = await c.api('/api/settings/pinned-group', { method: 'POST', json: { group_id: group.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.pinned_group_id, group.id);
    assert.equal((await c.pub('/api/settings')).body.pinned_group_id, group.id);
  });

  test('rejects a group that does not exist', async () => {
    const res = await c.api('/api/settings/pinned-group', { method: 'POST', json: { group_id: 4242 } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /invalid group/i);
  });

  test('null clears it', async () => {
    const res = await c.api('/api/settings/pinned-group', { method: 'POST', json: { group_id: null } });
    assert.equal(res.body.pinned_group_id, null);
  });
});

describe('request password', () => {
  test('set, advertise and remove', async () => {
    const set = await c.api('/api/settings/request-password', { method: 'POST', json: { password: 'letmein' } });
    assert.equal(set.status, 200);
    assert.equal((await c.pub('/api/settings')).body.request_password_required, true);

    const empty = await c.api('/api/settings/request-password', { method: 'POST', json: { password: '' } });
    assert.equal(empty.status, 400);

    const del = await c.api('/api/settings/request-password', { method: 'DELETE' });
    assert.equal(del.status, 204);
    assert.equal((await c.pub('/api/settings')).body.request_password_required, false);
  });
});
