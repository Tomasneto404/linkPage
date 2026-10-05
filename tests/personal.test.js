// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A member's own page: groups, sections, links, files, and the allowance that
 * bounds them.
 *
 * Isolation between members is tests/authz.isolation.test.js. This file is the
 * other half — that a member's own page works, and that the bookkeeping behind
 * it stays true: storage freed when a file is replaced, files gone from disk
 * when their link is, nothing left behind when an account is deleted.
 */

const fs   = require('node:fs');
const path = require('node:path');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { pngBytes } = harness;

let c, me;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c = await harness.start();
  await c.makeUser({ email: 'me@example.test', password: PASSWORD });
  me = c.session();
  await me.login('me@example.test', PASSWORD);
});
after(harness.stop);

const formOf = fields => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
};

const fileBlob = (bytes, type = 'application/pdf') => new Blob([bytes], { type });

const privateDir = () => path.join(c.dataDir, 'private-uploads');
const onDisk = filename => fs.existsSync(path.join(privateDir(), filename));

/** The raw row, for assertions about what is stored rather than shown. */
function rowOf(linkId) {
  const db = require('../src/models');
  return db.getPersonalLinkRow(db.getUserByEmail('me@example.test').id, linkId);
}

/** Polls until a file is gone; deletion is asynchronous. */
async function gone(filename) {
  for (let i = 0; i < 60 && onDisk(filename); i++) await new Promise(r => setTimeout(r, 25));
  return !onDisk(filename);
}

const data = async () => (await me.fetch('/api/my/data')).body;

describe('groups and sections', () => {
  test('a group is created, renamed, and comes back in order', async () => {
    const a = await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'Work', color: '#34c759' } });
    const b = await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'Home' } });
    assert.equal(a.status, 201);
    assert.equal(b.body.color, '#0071e3', 'a missing colour gets the default');

    await me.fetch(`/api/my/groups/${a.body.id}`, { method: 'PUT', json: { name: 'Office', color: '#34c759' } });

    const groups = (await data()).groups;
    assert.deepEqual(groups.map(g => g.name), ['Office', 'Home']);
    assert.ok(groups.every(g => g.owner === 'me'), 'marked as personal');
    assert.ok(groups.every(g => g.is_protected === false), 'never password-gated');
  });

  test('a group needs a name', async () => {
    assert.equal((await me.fetch('/api/my/groups', { method: 'POST', json: { name: '  ' } })).status, 400);
  });

  test('an invalid colour falls back rather than being stored', async () => {
    const res = await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'Odd', color: 'red; x' } });
    assert.equal(res.body.color, '#0071e3');
  });

  test('groups can be reordered', async () => {
    const before = (await data()).groups;
    const reversed = before.map(g => g.id).reverse();
    await me.fetch('/api/my/groups/reorder', { method: 'POST', json: { order: reversed } });
    assert.deepEqual((await data()).groups.map(g => g.id), reversed);
  });

  test('sections nest one level and no deeper', async () => {
    const group = (await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'Nested' } })).body;
    const top = (await me.fetch(`/api/my/groups/${group.id}/sections`, {
      method: 'POST', json: { name: 'Top' },
    })).body;
    const sub = await me.fetch(`/api/my/groups/${group.id}/sections`, {
      method: 'POST', json: { name: 'Sub', parent_section_id: top.id },
    });
    assert.equal(sub.status, 201);

    const deeper = await me.fetch(`/api/my/groups/${group.id}/sections`, {
      method: 'POST', json: { name: 'Too deep', parent_section_id: sub.body.id },
    });
    assert.equal(deeper.status, 404, 'a subsection cannot have subsections');

    const shaped = (await data()).groups.find(g => g.id === group.id);
    assert.equal(shaped.sections.length, 1);
    assert.equal(shaped.sections[0].subsections[0].name, 'Sub', 'nested like the shared groups');
  });

  test('a section cannot be parented by one from another group', async () => {
    const g1 = (await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'G1' } })).body;
    const g2 = (await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'G2' } })).body;
    const inG1 = (await me.fetch(`/api/my/groups/${g1.id}/sections`, { method: 'POST', json: { name: 'S' } })).body;

    const res = await me.fetch(`/api/my/groups/${g2.id}/sections`, {
      method: 'POST', json: { name: 'Crossed', parent_section_id: inG1.id },
    });
    assert.equal(res.status, 404);
  });
});

describe('links', () => {
  test('a web address becomes a link, filed where it was asked to be', async () => {
    const group = (await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'Filed' } })).body;
    const section = (await me.fetch(`/api/my/groups/${group.id}/sections`, {
      method: 'POST', json: { name: 'Here' },
    })).body;

    const res = await me.fetch('/api/my/links', {
      method: 'POST',
      form: formOf({
        name: 'Docs', url: 'https://example.com/docs', description: 'Reading',
        groups: JSON.stringify([{ group_id: group.id, section_id: section.id }]),
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.owner, 'me');
    assert.deepEqual(res.body.group_ids, [group.id]);
    assert.equal(res.body.groups[0].section_id, section.id);
    assert.equal(res.body.file_path, null);
  });

  test('a link needs a name, and an address or a file', async () => {
    assert.equal((await me.fetch('/api/my/links', {
      method: 'POST', form: formOf({ url: 'https://example.com' }),
    })).status, 400);
    assert.equal((await me.fetch('/api/my/links', {
      method: 'POST', form: formOf({ name: 'Nothing' }),
    })).status, 400);
  });

  test('only http and https addresses are accepted', async () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', 'ftp://example.com']) {
      const res = await me.fetch('/api/my/links', { method: 'POST', form: formOf({ name: 'Bad', url }) });
      assert.equal(res.status, 400, url);
    }
  });

  test('a file becomes a link, stored privately and counted', async () => {
    const before = (await data()).storage.used;

    const form = formOf({ name: 'Report' });
    form.append('file', fileBlob(Buffer.alloc(4000, 1)), 'report.pdf');
    const res = await me.fetch('/api/my/links', { method: 'POST', form });

    assert.equal(res.status, 201);
    assert.match(res.body.file_path, /^\/api\/my\/links\/\d+\/file$/, 'served through the guarded route');
    assert.equal(res.body.file_name, 'report.pdf');
    assert.equal(res.body.url, '', 'a file link has no address');

    assert.ok(onDisk(rowOf(res.body.id).attachment_file), 'it is on disk, privately');
    assert.equal((await data()).storage.used, before + 4000, 'and it counts');

    const served = await me.fetch(res.body.file_path);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('content-disposition'), /report\.pdf/);
  });

  test('a file that a browser would run is refused', async () => {
    for (const [name, type] of [['page.html', 'text/html'], ['pic.svg', 'image/svg+xml'],
                                ['data.json', 'application/json']]) {
      const form = formOf({ name: 'Active' });
      form.append('file', fileBlob('<script>alert(1)</script>', type), name);
      const res = await me.fetch('/api/my/links', { method: 'POST', form });
      assert.equal(res.status, 400, name);
    }
  });

  test('an svg icon is refused too', async () => {
    const form = formOf({ name: 'Svg icon', url: 'https://example.com' });
    form.append('image', fileBlob('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'), 'i.svg');
    assert.equal((await me.fetch('/api/my/links', { method: 'POST', form })).status, 400);
  });

  test('a markdown attachment renders as a page, under the no-script policy', async () => {
    const form = formOf({ name: 'Notes' });
    form.append('file', fileBlob('# My notes\n\n<script>alert(1)</script>', 'text/markdown'), 'notes.md');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;

    const page = await me.fetch(link.file_path);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(page.text, /<h1[^>]*>My notes<\/h1>/);
    assert.ok(!page.text.includes('<script>alert(1)</script>'), 'escaped, not executed');
  });

  test('an uploaded icon is stored privately and replaces nothing shared', async () => {
    const form = formOf({ name: 'Iconned', url: 'https://example.com/i' });
    form.append('image', fileBlob(pngBytes(), 'image/png'), 'icon.png');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;

    assert.match(link.image_path, /^\/api\/my\/links\/\d+\/icon$/);
    assert.equal((await me.fetch(link.image_path)).status, 200);

    // Not filed into the shared icon library, which every admin browses.
    const library = (await c.api('/api/icons')).body;
    assert.ok(!JSON.stringify(library).includes('icon.png'));
  });

  test('a library icon can be chosen instead', async () => {
    const icon = await c.makeIcon();
    const link = (await me.fetch('/api/my/links', {
      method: 'POST', form: formOf({ name: 'Library', url: 'https://example.com/l', icon_id: String(icon.id) }),
    })).body;
    assert.equal(link.image_path, icon.file_path, 'the shared, already-public path');
  });

  test('a raw path cannot be smuggled in as an icon', async () => {
    const link = (await me.fetch('/api/my/links', {
      method: 'POST',
      form: formOf({ name: 'Smuggle', url: 'https://example.com/s', image_path: '/uploads/../admin-token.txt' }),
    })).body;
    assert.equal(link.image_path, null, 'only a library id is ever honoured');
  });

  test('editing changes the text and keeps the file', async () => {
    const form = formOf({ name: 'Keep me' });
    form.append('file', fileBlob(Buffer.alloc(100, 1)), 'keep.pdf');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;

    const edited = await me.fetch(`/api/my/links/${link.id}`, {
      method: 'PUT', form: formOf({ name: 'Kept', description: 'Edited' }),
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.name, 'Kept');
    assert.equal(edited.body.file_name, 'keep.pdf', 'the file is still there');
  });

  test('links can be reordered', async () => {
    const ids = (await data()).links.map(l => l.id);
    const reversed = [...ids].reverse();
    await me.fetch('/api/my/links/reorder', { method: 'POST', json: { order: reversed } });
    assert.deepEqual((await data()).links.map(l => l.id), reversed);
  });

  test('a garbage reorder is refused, not half-applied', async () => {
    for (const body of [{}, { order: 'nope' }, { order: [1, 'x'] }, { order: [-1] }]) {
      assert.equal((await me.fetch('/api/my/links/reorder', { method: 'POST', json: body })).status, 400,
                   JSON.stringify(body));
    }
  });
});

describe('the storage allowance', () => {
  test('replacing a file frees exactly what the old one cost', async () => {
    const form = formOf({ name: 'Replace me' });
    form.append('file', fileBlob(Buffer.alloc(3000, 1)), 'one.pdf');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;
    const oldFile = rowOf(link.id).attachment_file;
    const before = (await data()).storage.used;

    const swap = formOf({ name: 'Replace me' });
    swap.append('file', fileBlob(Buffer.alloc(1000, 2)), 'two.pdf');
    await me.fetch(`/api/my/links/${link.id}`, { method: 'PUT', form: swap });

    assert.equal((await data()).storage.used, before - 3000 + 1000);
    assert.ok(await gone(oldFile), 'and the old file is gone from disk');
  });

  test('removing a file frees its space', async () => {
    const form = formOf({ name: 'Then a URL' });
    form.append('file', fileBlob(Buffer.alloc(2500, 1)), 'x.pdf');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;
    const file = rowOf(link.id).attachment_file;
    const before = (await data()).storage.used;

    const res = await me.fetch(`/api/my/links/${link.id}`, {
      method: 'PUT', form: formOf({ name: 'Then a URL', url: 'https://example.com/now', remove_file: '1' }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.file_path, null);
    assert.equal((await data()).storage.used, before - 2500);
    assert.ok(await gone(file));
  });

  test('deleting a link frees everything it held', async () => {
    const form = formOf({ name: 'Delete me' });
    form.append('file',  fileBlob(Buffer.alloc(1500, 1)), 'x.pdf');
    form.append('image', fileBlob(pngBytes(), 'image/png'), 'i.png');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;
    const row = rowOf(link.id);
    const before = (await data()).storage.used;

    assert.equal((await me.fetch(`/api/my/links/${link.id}`, { method: 'DELETE' })).status, 200);

    assert.equal((await data()).storage.used, before - 1500 - pngBytes().length);
    assert.ok(await gone(row.attachment_file));
    assert.ok(await gone(row.icon_file));
  });

  test('an upload that would go over is refused, and nothing is left on disk', async () => {
    const db = require('../src/models');
    const myId = db.getUserByEmail('me@example.test').id;
    const used = db.personalStorageUsed(myId);
    db.updateUser(myId, { storageQuota: used + 500 });

    const before = fs.readdirSync(privateDir()).length;
    const form = formOf({ name: 'Too big' });
    form.append('file', fileBlob(Buffer.alloc(800, 1)), 'big.pdf');
    const res = await me.fetch('/api/my/links', { method: 'POST', form });

    assert.equal(res.status, 413);
    assert.equal(res.body.code, 'quota_exceeded');
    assert.equal(res.body.storage.remaining, 500, 'the answer says how much room there is');

    // Multer had already written the file before the handler refused it.
    for (let i = 0; i < 60 && fs.readdirSync(privateDir()).length !== before; i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(fs.readdirSync(privateDir()).length, before, 'the refused upload was cleaned up');

    db.updateUser(myId, { storageQuota: null });
  });

  test('a replacement only needs room for the difference', async () => {
    const db = require('../src/models');
    const myId = db.getUserByEmail('me@example.test').id;

    const form = formOf({ name: 'Swap within' });
    form.append('file', fileBlob(Buffer.alloc(3000, 1)), 'a.pdf');
    const link = (await me.fetch('/api/my/links', { method: 'POST', form })).body;

    // 1000 bytes of headroom, swapping a 3000-byte file for a 3500-byte one.
    db.updateUser(myId, { storageQuota: db.personalStorageUsed(myId) + 1000 });

    const swap = formOf({ name: 'Swap within' });
    swap.append('file', fileBlob(Buffer.alloc(3500, 2)), 'b.pdf');
    const res = await me.fetch(`/api/my/links/${link.id}`, { method: 'PUT', form: swap });
    assert.equal(res.status, 200, 'it needed 500 more, not 3500');

    db.updateUser(myId, { storageQuota: null });
  });

  test('an icon over 2 MB is refused', async () => {
    const form = formOf({ name: 'Huge icon', url: 'https://example.com/h' });
    form.append('image', fileBlob(Buffer.alloc(2 * 1024 * 1024 + 1, 1), 'image/png'), 'huge.png');
    assert.equal((await me.fetch('/api/my/links', { method: 'POST', form })).status, 400);
  });

  test('the instance allowance applies until an account has its own', async () => {
    const db = require('../src/models');
    const myId = db.getUserByEmail('me@example.test').id;
    const MB = 1024 * 1024;

    const set = await c.api('/api/settings/user-quota', { method: 'POST', json: { megabytes: 250 } });
    assert.equal(set.status, 200);
    assert.equal(set.body.user_storage_quota, 250 * MB, 'sent in megabytes, kept in bytes');
    assert.equal((await data()).storage.quota, 250 * MB);
    assert.equal((await c.pub('/api/settings')).body.user_storage_quota, 250 * MB);

    // An account of its own wins over the instance's.
    const own = await c.api(`/api/users/${myId}`, { method: 'PATCH', json: { storage_quota_mb: 10 } });
    assert.equal(own.status, 200);
    assert.equal(own.body.storage.quota, 10 * MB, 'the admin view shows it');
    assert.equal((await data()).storage.quota, 10 * MB);

    // null hands it back to the instance.
    await c.api(`/api/users/${myId}`, { method: 'PATCH', json: { storage_quota_mb: null } });
    assert.equal((await data()).storage.quota, 250 * MB);

    // Setting the default forgets the row, like every other setting.
    const { DEFAULT_USER_STORAGE_QUOTA } = require('../src/config/constants');
    await c.api('/api/settings/user-quota', {
      method: 'POST', json: { megabytes: DEFAULT_USER_STORAGE_QUOTA / MB },
    });
    assert.equal(db.readSetting('user_storage_quota'), null);
  });

  test('a nonsense allowance is refused', async () => {
    for (const megabytes of [-1, 'lots', null, {}]) {
      const res = await c.api('/api/settings/user-quota', { method: 'POST', json: { megabytes } });
      assert.equal(res.status, 400, JSON.stringify(megabytes));
    }
    const myId = require('../src/models').getUserByEmail('me@example.test').id;
    const bad = await c.api(`/api/users/${myId}`, { method: 'PATCH', json: { storage_quota_mb: 'big' } });
    assert.equal(bad.status, 400);
  });

  test('a member cannot raise their own allowance', async () => {
    const res = await me.fetch('/api/settings/user-quota', { method: 'POST', json: { megabytes: 99999 } });
    assert.equal(res.status, 401);
  });
});

describe('favicons', () => {
  const { settlePersonalFavicons } = require('../src/services/personalStorage');

  test('one is fetched for a web address and kept privately', async () => {
    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    try {
      const link = (await me.fetch('/api/my/links', {
        method: 'POST', form: formOf({ name: 'Favicon', url: 'https://favicon.example/' }),
      })).body;
      await settlePersonalFavicons();

      const after = (await data()).links.find(l => l.id === link.id);
      assert.match(after.favicon_path, /^\/api\/my\/links\/\d+\/favicon$/);
      assert.equal((await me.fetch(after.favicon_path)).status, 200);
      assert.ok(onDisk(rowOf(link.id).favicon_file));

      // Never by the shared cache, which writes onto a *shared* link's row.
      assert.ok(!c.faviconCalls.some(call => call.linkId === link.id),
                'the shared cacheFavicon was not used');
    } finally {
      c.setFaviconFixture(null);
    }
  });

  test('an svg favicon is not kept', async () => {
    c.setFaviconFixture({ buffer: Buffer.from('<svg/>'), contentType: 'image/svg+xml' });
    try {
      const link = (await me.fetch('/api/my/links', {
        method: 'POST', form: formOf({ name: 'Svg site', url: 'https://svg.example/' }),
      })).body;
      await settlePersonalFavicons();
      assert.equal((await data()).links.find(l => l.id === link.id).favicon_path, null);
    } finally {
      c.setFaviconFixture(null);
    }
  });

  test('one that would not fit in the allowance is skipped, quietly', async () => {
    const db = require('../src/models');
    const myId = db.getUserByEmail('me@example.test').id;
    db.updateUser(myId, { storageQuota: db.personalStorageUsed(myId) });   // full

    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    try {
      const res = await me.fetch('/api/my/links', {
        method: 'POST', form: formOf({ name: 'No room', url: 'https://noroom.example/' }),
      });
      assert.equal(res.status, 201, 'the link itself is still made');
      await settlePersonalFavicons();
      assert.equal((await data()).links.find(l => l.id === res.body.id).favicon_path, null);
    } finally {
      c.setFaviconFixture(null);
      db.updateUser(myId, { storageQuota: null });
    }
  });

  test('changing the address drops the old favicon', async () => {
    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    let link;
    try {
      link = (await me.fetch('/api/my/links', {
        method: 'POST', form: formOf({ name: 'Moves', url: 'https://first.example/' }),
      })).body;
      await settlePersonalFavicons();
    } finally {
      c.setFaviconFixture(null);
    }
    const oldFavicon = rowOf(link.id).favicon_file;
    assert.ok(oldFavicon);

    await me.fetch(`/api/my/links/${link.id}`, {
      method: 'PUT', form: formOf({ name: 'Moves', url: 'https://second.example/' }),
    });
    await settlePersonalFavicons();

    assert.ok(await gone(oldFavicon), 'the old site\'s icon is not left behind');
  });
});

describe('previewing an icon before saving', () => {
  test('returns the image a web address would get', async () => {
    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    try {
      const res = await me.fetch('/api/my/favicon-preview?url=' + encodeURIComponent('https://preview.example/'));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.match(res.headers.get('cache-control'), /no-store/);
    } finally {
      c.setFaviconFixture(null);
    }
  });

  test('asks the fetcher for member rules: public addresses, no Google', async () => {
    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    try {
      await me.fetch('/api/my/favicon-preview?url=' + encodeURIComponent('https://rules.example/'));
      const call = c.faviconCalls.find(x => x.url === 'https://rules.example/');
      assert.ok(call, 'the fetcher was asked');
      assert.equal(call.opts?.member, true);
    } finally {
      c.setFaviconFixture(null);
    }
  });

  test('stores nothing and costs nothing', async () => {
    const before = (await data()).storage.used;
    const files  = fs.readdirSync(privateDir()).length;
    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    try {
      await me.fetch('/api/my/favicon-preview?url=' + encodeURIComponent('https://free.example/'));
    } finally {
      c.setFaviconFixture(null);
    }
    assert.equal((await data()).storage.used, before);
    assert.equal(fs.readdirSync(privateDir()).length, files);
  });

  test('an svg is not handed back', async () => {
    c.setFaviconFixture({ buffer: Buffer.from('<svg/>'), contentType: 'image/svg+xml' });
    try {
      const res = await me.fetch('/api/my/favicon-preview?url=' + encodeURIComponent('https://svg2.example/'));
      assert.equal(res.status, 404);
    } finally {
      c.setFaviconFixture(null);
    }
  });

  test('nothing found is a 404, and a non-address is a 400', async () => {
    assert.equal((await me.fetch('/api/my/favicon-preview?url=' + encodeURIComponent('https://none.example/'))).status, 404);
    for (const url of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'not a url']) {
      const res = await me.fetch('/api/my/favicon-preview?url=' + encodeURIComponent(url));
      assert.equal(res.status, 400, url);
    }
  });

  test('a stranger cannot use the server to fetch things', async () => {
    const res = await c.pub('/api/my/favicon-preview?url=' + encodeURIComponent('https://example.com/'));
    assert.equal(res.status, 401);
  });

  test('a saved link\'s favicon uses member rules too', async () => {
    c.setFaviconFixture({ buffer: pngBytes(), contentType: 'image/png' });
    try {
      await me.fetch('/api/my/links', {
        method: 'POST', form: formOf({ name: 'Saved', url: 'https://saved-rules.example/' }),
      });
      await require('../src/services/personalStorage').settlePersonalFavicons();
      const call = c.faviconCalls.find(x => x.url === 'https://saved-rules.example/');
      assert.ok(call);
      assert.equal(call.opts?.member, true);
    } finally {
      c.setFaviconFixture(null);
    }
  });
});

describe('a private edit stays private on the live channel', () => {
  test('it does not wake every open page', async () => {
    const { sseClients } = require('../src/services/sseService');
    let woken = 0;
    const fake = { write: () => { woken++; } };
    sseClients.add(fake);
    try {
      await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'Quiet' } });
      await new Promise(r => setTimeout(r, 50));
      assert.equal(woken, 0);
    } finally {
      sseClients.delete(fake);
    }
  });
});

describe('deleting the account', () => {
  test('takes every personal row and every file with it', async () => {
    const db = require('../src/models');
    const user = await c.makeUser({ email: 'leaving@example.test', password: PASSWORD });
    const s = c.session();
    await s.login('leaving@example.test', PASSWORD);

    const group = (await s.fetch('/api/my/groups', { method: 'POST', json: { name: 'Bye' } })).body;
    await s.fetch(`/api/my/groups/${group.id}/sections`, { method: 'POST', json: { name: 'S' } });
    const form = formOf({ name: 'Leaving', groups: JSON.stringify([group.id]) });
    form.append('file', fileBlob(Buffer.alloc(100, 1)), 'f.pdf');
    const link = (await s.fetch('/api/my/links', { method: 'POST', form })).body;
    const file = db.getPersonalLinkRow(user.id, link.id).attachment_file;

    assert.equal((await c.api(`/api/users/${user.id}`, { method: 'DELETE' })).status, 200);

    const { db: raw } = require('../src/config/db');
    for (const table of ['user_groups', 'user_sections', 'user_links', 'user_link_groups']) {
      assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_user_id = ?`)
                     .get(user.id).n, 0, `${table} still has rows`);
    }
    assert.ok(!onDisk(file), 'the file is gone from disk');
  });
});

describe('limits', () => {
  test('there is a ceiling on how many groups one person makes', async () => {
    const db = require('../src/models');
    const { MAX_USER_GROUPS } = require('../src/config/constants');
    const myId = db.getUserByEmail('me@example.test').id;

    while (db.countPersonalGroups(myId) < MAX_USER_GROUPS) {
      db.createPersonalGroup(myId, { name: 'Filler', color: '#0071e3' });
    }
    const res = await me.fetch('/api/my/groups', { method: 'POST', json: { name: 'One too many' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'limit_reached');
  });
});
