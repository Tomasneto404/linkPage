// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Custom link slugs: the API contract and the /f/<slug> front door. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

const hit = (slug, { ip = '198.51.100.44', headers = {} } = {}) =>
  c.pub(`/f/${slug}`, { headers: { 'X-Forwarded-For': ip, 'User-Agent': 'test-agent', ...headers } });

/** PUT a link back with only the fields we want to change. */
async function editLink(link, fields) {
  const form = new FormData();
  form.append('name', fields.name ?? link.name);
  form.append('url',  fields.url  ?? link.url);
  for (const [k, v] of Object.entries(fields)) {
    if (k !== 'name' && k !== 'url') form.append(k, String(v));
  }
  return c.api(`/api/links/${link.id}`, { method: 'PUT', form });
}

describe('creating a link with a slug', () => {
  test('stores the slug and exposes it on the link', async () => {
    const link = await c.makeLink({ name: 'Annual report', slug: 'annual-report' });
    assert.equal(link.slug, 'annual-report');
  });

  test('normalises whatever the admin typed', async () => {
    const link = await c.makeLink({ name: 'Relatório', slug: '  Relatório Anual 2026! ' });
    assert.equal(link.slug, 'relatorio-anual-2026');
  });

  test('a link without a slug keeps a null one', async () => {
    const link = await c.makeLink({ name: 'No slug' });
    assert.equal(link.slug, null);
  });

  test('rejects a slug that is already taken', async () => {
    await c.makeLink({ name: 'First', slug: 'shared-name' });

    const form = new FormData();
    form.append('name', 'Second');
    form.append('url', 'https://second.invalid/x');
    form.append('slug', 'Shared Name');
    const res = await c.api('/api/links', { method: 'POST', form });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already in use/i);
  });

  test('rejects a reserved slug', async () => {
    const form = new FormData();
    form.append('name', 'Sneaky');
    form.append('url', 'https://sneaky.invalid/x');
    form.append('slug', 'admin');
    const res = await c.api('/api/links', { method: 'POST', form });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /reserved/i);
  });

  test('rejects a slug with nothing usable in it', async () => {
    const form = new FormData();
    form.append('name', 'Punctuation only');
    form.append('url', 'https://punct.invalid/x');
    form.append('slug', '!!!');
    const res = await c.api('/api/links', { method: 'POST', form });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /letter or number/i);
  });

  test('a file upload can carry a slug too', async () => {
    const link = await c.makeFileLink({
      name: 'Handbook', fileName: 'handbook.txt', type: 'text/plain',
      bytes: Buffer.from('policies'), slug: 'handbook',
    });
    assert.equal(link.slug, 'handbook');
  });
});

describe('editing a slug', () => {
  test('an existing link can be given a slug later', async () => {
    const link = await c.makeLink({ name: 'Late slug' });
    assert.equal(link.slug, null);

    const res = await editLink(link, { slug: 'late-slug' });
    assert.equal(res.status, 200);
    assert.equal(res.body.slug, 'late-slug');
  });

  test('a slug can be changed, and the old one stops resolving', async () => {
    const link = await c.makeLink({ name: 'Renamed', url: 'https://renamed.invalid/x', slug: 'before' });
    assert.equal((await hit('before')).status, 302);

    const res = await editLink(link, { slug: 'after' });
    assert.equal(res.body.slug, 'after');

    assert.equal((await hit('after')).status, 302);
    assert.equal((await hit('before')).status, 404, 'the old slug is free again');
  });

  test('an empty slug clears it, leaving the random id as the only address', async () => {
    const link = await c.makeLink({ name: 'Cleared', slug: 'to-be-cleared' });

    const res = await editLink(link, { slug: '' });
    assert.equal(res.body.slug, null);
    assert.equal((await hit('to-be-cleared')).status, 404);

    const byId = await c.pub(`/r/${link.id}`, { headers: { 'X-Forwarded-For': '198.51.100.45' } });
    assert.equal(byId.status, 302, '/r/<id> still works');
  });

  test('re-sending its own slug unchanged is not a conflict', async () => {
    const link = await c.makeLink({ name: 'Idempotent', slug: 'idempotent' });
    const res  = await editLink(link, { slug: 'idempotent' });
    assert.equal(res.status, 200);
    assert.equal(res.body.slug, 'idempotent');
  });

  test('taking another link\'s slug is rejected and changes nothing', async () => {
    await c.makeLink({ name: 'Owner', slug: 'owned' });
    const other = await c.makeLink({ name: 'Thief', slug: 'not-owned' });

    const res = await editLink(other, { slug: 'owned' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /already in use/i);

    const after = (await c.api('/api/links')).body.find(l => l.id === other.id);
    assert.equal(after.slug, 'not-owned', 'the rejected edit left the link alone');
  });

  test('omitting the field entirely leaves the slug untouched', async () => {
    const link = await c.makeLink({ name: 'Untouched', slug: 'untouched' });

    const form = new FormData();
    form.append('name', 'Untouched renamed');
    form.append('url', link.url);
    const res = await c.api(`/api/links/${link.id}`, { method: 'PUT', form });

    assert.equal(res.status, 200);
    assert.equal(res.body.slug, 'untouched');
  });
});

describe('/f/<slug>', () => {
  test('redirects a URL-backed link and records the click', async () => {
    const link = await c.makeLink({ name: 'Tracked by slug', url: 'https://slugged.invalid/page', slug: 'tracked' });

    const res = await hit('tracked');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://slugged.invalid/page');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

    const clicks = await c.api(`/api/links/${link.id}/clicks`);
    assert.equal(clicks.body.recentClicks.length, 1);
    assert.equal(clicks.body.recentClicks[0].ip_address, '198.51.100.44');
  });

  test('serves a file-backed link inline, keeping the slug in the address bar', async () => {
    const link = await c.makeFileLink({
      name: 'Policy', fileName: 'policy.txt', type: 'text/plain',
      bytes: Buffer.from('be nice'), slug: 'policy',
    });

    const res = await hit('policy', { ip: '198.51.100.46' });
    assert.equal(res.status, 200, 'no redirect: the bytes come back on /f/<slug> itself');
    assert.equal(res.text, 'be nice');
    assert.match(res.headers.get('content-disposition') || '', /policy\.txt/);

    const clicks = await c.api(`/api/links/${link.id}/clicks`);
    assert.equal(clicks.body.recentClicks.length, 1, 'serving the file still counts as a click');
  });

  test('an unknown slug is a 404', async () => {
    assert.equal((await hit('nothing-here')).status, 404);
  });

  test('matching is exact, not case-folded guesswork', async () => {
    await c.makeLink({ name: 'Case', slug: 'case-test' });
    assert.equal((await hit('CASE-TEST')).status, 302, 'the lookup normalises the incoming slug');
  });
});

describe('/f/<slug> visibility rules', () => {
  test('a hidden link bounces visitors home but works for the admin', async () => {
    const link = await c.makeLink({ name: 'Hidden slug', url: 'https://hiddenslug.invalid/x', slug: 'hidden-one' });
    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });

    const anon = await hit('hidden-one', { ip: '198.51.100.47' });
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/');

    const admin = await hit('hidden-one', { ip: '198.51.100.48', headers: { 'X-Admin-Token': c.token } });
    assert.equal(admin.headers.get('location'), 'https://hiddenslug.invalid/x');
  });

  test('a link in a protected group needs the unlock cookie', async () => {
    const group = await c.makeGroup({ name: 'Slug gate' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Slug gate', password: 'pw' } });
    const link = await c.makeLink({
      name: 'Gated by slug', url: 'https://gatedslug.invalid/x', slug: 'gated', groups: [group.id],
    });
    assert.ok(link.id);

    const locked = await hit('gated', { ip: '198.51.100.49' });
    assert.equal(locked.headers.get('location'), '/', 'bounced while locked');

    const unlock = await c.pub(`/api/groups/${group.id}/unlock`, { method: 'POST', json: { password: 'pw' } });
    const cookie = (unlock.headers.getSetCookie?.() ?? [])
      .find(v => v.startsWith(`lp_grp_${group.id}=`)).split(';')[0];

    const unlocked = await hit('gated', { ip: '198.51.100.50', headers: { Cookie: cookie } });
    assert.equal(unlocked.headers.get('location'), 'https://gatedslug.invalid/x');
  });

  test('a protected file-backed link is not served to a locked-out visitor', async () => {
    const group = await c.makeGroup({ name: 'Secret files' });
    await c.api(`/api/groups/${group.id}`, { method: 'PUT', json: { name: 'Secret files', password: 'pw' } });
    await c.makeFileLink({
      name: 'Secret', fileName: 'secret.txt', type: 'text/plain',
      bytes: Buffer.from('classified'), slug: 'secret', groups: [group.id],
    });

    const res = await hit('secret', { ip: '198.51.100.51' });
    assert.notEqual(res.text, 'classified');
    assert.equal(res.headers.get('location'), '/');
  });
});

describe('throttling', () => {
  test('the slug route is rate-limited like /r/<id>', async () => {
    await c.makeLink({ name: 'Flooded slug', url: 'https://floodedslug.invalid/x', slug: 'flooded' });
    const ip = '192.0.2.210';
    for (let i = 0; i < 30; i++) {
      assert.equal((await hit('flooded', { ip })).status, 302, `hit ${i + 1}`);
    }
    assert.equal((await hit('flooded', { ip })).status, 429);
  });
});

describe('export / import', () => {
  test('a slug survives an export and drops out when it would collide', async () => {
    await c.makeLink({ name: 'Exported', url: 'https://exported.invalid/x', slug: 'exported-slug' });

    const dump = (await c.api('/api/links/export')).body;
    const row  = dump.links.find(l => l.name === 'Exported');
    assert.equal(row.slug, 'exported-slug');

    // Re-importing into the same instance: the URL is a duplicate, so build a
    // fresh row that only shares the slug.
    const res = await c.api('/api/links/import', {
      method: 'POST',
      json: { links: [
        { name: 'Clashing', url: 'https://clashing.invalid/x', slug: 'exported-slug' },
        { name: 'Fresh',    url: 'https://fresh.invalid/x',    slug: 'fresh-slug'    },
      ] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 2, 'both links import; only the slug is dropped');

    const all = (await c.api('/api/links')).body;
    assert.equal(all.find(l => l.name === 'Clashing').slug, null);
    assert.equal(all.find(l => l.name === 'Fresh').slug, 'fresh-slug');
    assert.equal(all.find(l => l.name === 'Exported').slug, 'exported-slug', 'the original keeps it');
  });
});
