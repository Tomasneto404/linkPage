// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** File requests and change requests: submission, review, and file lifecycle. */

const fs     = require('fs');
const path   = require('path');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, group;

before(async () => {
  c = await harness.start();
  group = await c.makeGroup({ name: 'Requested into' });
  await c.api('/api/settings/requests-enabled', { method: 'POST', json: { enabled: true } });
});
after(harness.stop);

// The public endpoint allows 10 submissions per IP per window, so each test
// submits from its own address.
let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

/** Submits a multipart request as a visitor. */
function submitForm(fields, { file, image, headers = {} } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  if (file)  form.append('file',  new Blob([file.bytes],  { type: file.type }),  file.name);
  if (image) form.append('image', new Blob([image.bytes], { type: image.type }), image.name);
  return c.pub('/api/link-requests', {
    method: 'POST', form,
    headers: { 'X-Forwarded-For': nextIp(), ...headers },
  });
}

/**
 * Deleting an upload goes through safeDeleteFile, which unlinks
 * asynchronously and does not report back — so a test that looks the instant
 * the response lands is racing it. Wait for the condition instead.
 */
async function waitFor(predicate, what, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.fail(what);
}

const gone      = (file, what) => waitFor(() => !fs.existsSync(file), what || `${file} is still on disk`);
const fileCount = () => fs.readdirSync(uploadsDir()).length;

const listAll  = () => c.api('/api/link-requests?status=all');
const findReq  = async id => (await listAll()).body.requests.find(r => r.id === id);
const uploadsDir = () => path.join(c.dataDir, 'uploads');

const pdfBytes = Buffer.from('%PDF-1.4 fake report\n');

// ─── File requests ───────────────────────────────────────────────────────────

describe('submitting a file request', () => {
  test('stores the upload and reports it to the admin', async () => {
    const res = await submitForm(
      { kind: 'file', name: 'Q3 Report', group_id: group.id, description: 'the numbers' },
      { file: { name: 'q3.pdf', type: 'application/pdf', bytes: pdfBytes } },
    );
    assert.equal(res.status, 201);

    const row = await findReq(res.body.id);
    assert.equal(row.kind, 'file');
    assert.equal(row.file_name, 'q3.pdf');
    assert.match(row.file_path, /^\/uploads\//);
    assert.equal(row.url, '', 'a file request carries no URL');
    assert.equal(row.status, 'pending');

    assert.ok(fs.existsSync(path.join(uploadsDir(), path.basename(row.file_path))),
      'the bytes are on disk');
  });

  test('the file is required', async () => {
    const res = await submitForm({ kind: 'file', name: 'No file', group_id: group.id });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /file/i);
  });

  test('a name and a valid group are still required', async () => {
    const noName = await submitForm(
      { kind: 'file', group_id: group.id },
      { file: { name: 'a.pdf', type: 'application/pdf', bytes: pdfBytes } },
    );
    assert.equal(noName.status, 400);
    assert.match(noName.body.error, /name/i);

    const noGroup = await submitForm(
      { kind: 'file', name: 'Groupless' },
      { file: { name: 'a.pdf', type: 'application/pdf', bytes: pdfBytes } },
    );
    assert.equal(noGroup.status, 400);
    assert.match(noGroup.body.error, /group/i);
  });

  test('a disallowed file type is refused', async () => {
    const res = await submitForm(
      { kind: 'file', name: 'Script', group_id: group.id },
      { file: { name: 'evil.sh', type: 'application/x-sh', bytes: Buffer.from('rm -rf /') } },
    );
    assert.equal(res.status, 400);
  });

  test('a URL is not required, and any URL sent along is ignored', async () => {
    const res = await submitForm(
      { kind: 'file', name: 'Ignores url', group_id: group.id, url: 'https://ignored.invalid/x' },
      { file: { name: 'b.pdf', type: 'application/pdf', bytes: pdfBytes } },
    );
    assert.equal(res.status, 201);
    assert.equal((await findReq(res.body.id)).url, '');
  });
});

describe('reviewing a file request', () => {
  async function submitFile(name = 'Handbook') {
    const res = await submitForm(
      { kind: 'file', name, group_id: group.id },
      { file: { name: 'handbook.pdf', type: 'application/pdf', bytes: pdfBytes } },
    );
    assert.equal(res.status, 201);
    return findReq(res.body.id);
  }

  test('approving publishes the link with the file already attached', async () => {
    const row = await submitFile('Employee Handbook');

    const res = await c.api(`/api/link-requests/${row.id}/approve`, { method: 'POST', json: {} });
    assert.equal(res.status, 200);
    assert.ok(res.body.link?.id, 'the approve response carries the new link');

    const link = (await c.api('/api/links')).body.find(l => l.id === res.body.link.id);
    assert.equal(link.name, 'Employee Handbook');
    assert.equal(link.file_path, row.file_path, 'the very same upload, not a copy');
    assert.equal(link.file_name, 'handbook.pdf');
    assert.equal(link.url, row.file_path, 'file-backed links mirror the path into url');
    assert.deepEqual(link.groups.map(g => g.id), [group.id]);

    const after = await findReq(row.id);
    assert.equal(after.status, 'approved');
    assert.equal(after.created_link_id, link.id);
  });

  test('the published link keeps working after the request row is deleted', async () => {
    const row  = await submitFile('Survives deletion');
    const link = (await c.api(`/api/link-requests/${row.id}/approve`, { method: 'POST', json: {} })).body.link;

    assert.equal((await c.api(`/api/link-requests/${row.id}`, { method: 'DELETE' })).status, 204);
    assert.ok(fs.existsSync(path.join(uploadsDir(), path.basename(link.file_path))),
      'an approved request never takes the published file down with it');
  });

  test('rejecting deletes the upload from disk', async () => {
    const row = await submitFile('Rejected doc');
    const onDisk = path.join(uploadsDir(), path.basename(row.file_path));
    assert.ok(fs.existsSync(onDisk));

    await c.api(`/api/link-requests/${row.id}/reject`, { method: 'POST', json: {} });
    assert.equal((await findReq(row.id)).status, 'rejected');
    await gone(onDisk, 'the bytes should be gone');
  });

  test('deleting a pending request deletes the upload too', async () => {
    const row = await submitFile('Deleted doc');
    const onDisk = path.join(uploadsDir(), path.basename(row.file_path));

    await c.api(`/api/link-requests/${row.id}`, { method: 'DELETE' });
    await gone(onDisk);
  });
});

// ─── Change requests ─────────────────────────────────────────────────────────

describe('submitting a change request', () => {
  test('records the proposed values against the target link', async () => {
    const link = await c.makeLink({ name: 'Payroll portal', url: 'https://old.invalid/pay', groups: [group.id] });

    const res = await submitForm({
      kind: 'change', target_link_id: link.id,
      name: 'Payroll & HR portal', url: 'https://hr.invalid/pay',
      description: 'now covers HR too', note: 'the old URL 404s',
    });
    assert.equal(res.status, 201);

    const row = await findReq(res.body.id);
    assert.equal(row.kind, 'change');
    assert.equal(row.target_link_id, link.id);
    assert.equal(row.name, 'Payroll & HR portal');
    assert.equal(row.url, 'https://hr.invalid/pay');
    assert.equal(row.note, 'the old URL 404s');
    assert.equal(row.target_name, 'Payroll portal', 'the current values ride along for the diff');
    assert.equal(row.target_url, 'https://old.invalid/pay');
    assert.equal(row.status, 'pending');
  });

  test('the target link must exist', async () => {
    const res = await submitForm({ kind: 'change', target_link_id: 999999, name: 'Ghost' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /link/i);
  });

  test('a change that changes nothing is refused', async () => {
    const link = await c.makeLink({ name: 'Unchanged', url: 'https://unchanged.invalid/x', groups: [group.id] });
    const res  = await submitForm({
      kind: 'change', target_link_id: link.id,
      name: 'Unchanged', url: 'https://unchanged.invalid/x',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /nothing|no change/i);
  });

  test('a proposed URL still has to be a real http(s) URL', async () => {
    const link = await c.makeLink({ name: 'Valid target', groups: [group.id] });
    const res  = await submitForm({
      kind: 'change', target_link_id: link.id, name: 'Valid target', url: 'javascript:alert(1)',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /url/i);
  });

  test('a hidden link cannot be targeted by a visitor', async () => {
    const link = await c.makeLink({ name: 'Hidden one', url: 'https://hidden.invalid/x', groups: [group.id] });
    await c.api(`/api/links/${link.id}/visibility`, { method: 'POST', json: { hidden: true } });

    const res = await submitForm({
      kind: 'change', target_link_id: link.id, name: 'Renamed in the dark',
    });
    assert.equal(res.status, 400, 'a link the visitor cannot see is not a valid target');
  });

  test('a link in a locked group cannot be targeted without the unlock cookie', async () => {
    const locked = await c.makeGroup({ name: 'Locked' });
    await c.api(`/api/groups/${locked.id}`, { method: 'PUT', json: { name: 'Locked', password: 'pw' } });
    const link = await c.makeLink({ name: 'Behind a password', url: 'https://gated.invalid/x', groups: [locked.id] });

    const denied = await submitForm({ kind: 'change', target_link_id: link.id, name: 'Peeked' });
    assert.equal(denied.status, 400);

    const unlock = await c.pub(`/api/groups/${locked.id}/unlock`, { method: 'POST', json: { password: 'pw' } });
    const cookie = (unlock.headers.getSetCookie?.() ?? [])
      .find(v => v.startsWith(`lp_grp_${locked.id}=`)).split(';')[0];

    const allowed = await submitForm(
      { kind: 'change', target_link_id: link.id, name: 'Unlocked rename' },
      { headers: { Cookie: cookie } },
    );
    assert.equal(allowed.status, 201);
  });
});

describe('applying a change request', () => {
  async function proposeChange(fields) {
    const link = await c.makeLink({
      name: fields.currentName, url: fields.currentUrl, description: fields.currentDesc, groups: [group.id],
    });
    const res = await submitForm({
      kind: 'change', target_link_id: link.id,
      name: fields.name, url: fields.url, description: fields.description, note: fields.note,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { link, requestId: res.body.id };
  }

  test('writes the proposed values onto the target link', async () => {
    const { link, requestId } = await proposeChange({
      currentName: 'Old name', currentUrl: 'https://old.invalid/a', currentDesc: 'old words',
      name: 'New name', url: 'https://new.invalid/a', description: 'new words', note: 'stale',
    });

    const res = await c.api(`/api/link-requests/${requestId}/apply`, { method: 'POST', json: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const after = (await c.api('/api/links')).body.find(l => l.id === link.id);
    assert.equal(after.name, 'New name');
    assert.equal(after.url, 'https://new.invalid/a');
    assert.equal(after.description, 'new words');

    const row = await findReq(requestId);
    assert.equal(row.status, 'approved');
    assert.equal(row.created_link_id, link.id, 'the request points back at the link it changed');
  });

  test('leaves the link untouched where the visitor proposed nothing', async () => {
    const { link, requestId } = await proposeChange({
      currentName: 'Keep desc', currentUrl: 'https://keep.invalid/a', currentDesc: 'keep me',
      name: 'Keep desc renamed',
    });

    await c.api(`/api/link-requests/${requestId}/apply`, { method: 'POST', json: {} });

    const after = (await c.api('/api/links')).body.find(l => l.id === link.id);
    assert.equal(after.name, 'Keep desc renamed');
    assert.equal(after.url, 'https://keep.invalid/a', 'an unproposed URL is left alone');
    assert.equal(after.description, 'keep me', 'an unproposed description is left alone');
  });

  test('rejecting a change leaves the link alone', async () => {
    const { link, requestId } = await proposeChange({
      currentName: 'Untouched', currentUrl: 'https://untouched.invalid/a',
      name: 'Should not apply',
    });

    await c.api(`/api/link-requests/${requestId}/reject`, { method: 'POST', json: {} });

    const after = (await c.api('/api/links')).body.find(l => l.id === link.id);
    assert.equal(after.name, 'Untouched');
  });

  test('applying is a 409 when the target link is already gone', async () => {
    const { link, requestId } = await proposeChange({
      currentName: 'Doomed', currentUrl: 'https://doomed.invalid/a', name: 'Too late',
    });
    await c.api(`/api/links/${link.id}`, { method: 'DELETE' });

    const res = await c.api(`/api/link-requests/${requestId}/apply`, { method: 'POST', json: {} });
    assert.equal(res.status, 409);
  });

  test('apply only makes sense for a change request', async () => {
    const plain = await submitForm({ kind: 'link', name: 'Plain', url: 'https://plain.invalid/x', group_id: group.id });
    const res   = await c.api(`/api/link-requests/${plain.body.id}/apply`, { method: 'POST', json: {} });
    assert.equal(res.status, 400);
  });
});

// ─── The original kind keeps working ─────────────────────────────────────────

describe('plain link requests are unaffected', () => {
  test('a submission with no kind is still a link request', async () => {
    const res = await submitForm({ name: 'Classic', url: 'https://classic.invalid/x', group_id: group.id });
    assert.equal(res.status, 201);

    const row = await findReq(res.body.id);
    assert.equal(row.kind, 'link');
    assert.equal(row.url, 'https://classic.invalid/x');
    assert.equal(row.file_path, null);
    assert.equal(row.target_link_id, null);
  });

  test('an unknown kind is refused', async () => {
    const res = await submitForm({ kind: 'sneaky', name: 'X', url: 'https://x.invalid/y', group_id: group.id });
    assert.equal(res.status, 400);
  });
});

// ─── The public upload boundary ──────────────────────────────────────────────

describe('active content cannot be uploaded by a visitor', () => {
  // Uploads are served inline from the same origin as the admin panel, and the
  // admin token lives in that origin's localStorage. A stored .html or .svg from
  // a stranger would run with the reviewer's privileges the moment they opened
  // it from the request list, so the public path refuses them outright.
  const ACTIVE = [
    ['page.html', 'text/html'],
    ['page.htm',  'text/html'],
    ['icon.svg',  'image/svg+xml'],
    ['data.xml',  'text/xml'],
    ['data.json', 'application/json'],
  ];

  for (const [name, type] of ACTIVE) {
    test(`a file request refuses ${name}`, async () => {
      const res = await submitForm(
        { kind: 'file', name: `Payload ${name}`, group_id: group.id },
        { file: { name, type, bytes: Buffer.from('<script>alert(document.cookie)</script>') } },
      );
      assert.equal(res.status, 400, `${name} must not be storable by a visitor`);
    });
  }

  test('a mislabelled extension does not sneak past the type check', async () => {
    const res = await submitForm(
      { kind: 'file', name: 'Disguised', group_id: group.id },
      { file: { name: 'notes.txt', type: 'text/html', bytes: Buffer.from('<script>1</script>') } },
    );
    assert.equal(res.status, 400);
  });

  test('an SVG icon is refused too', async () => {
    const res = await submitForm(
      { kind: 'link', name: 'Svg icon', url: 'https://svgicon.invalid/x', group_id: group.id },
      { image: { name: 'icon.svg', type: 'image/svg+xml', bytes: harness.svgBytes() } },
    );
    assert.equal(res.status, 400);
  });

  test('ordinary documents and raster icons still go through', async () => {
    const doc = await submitForm(
      { kind: 'file', name: 'Fine document', group_id: group.id },
      { file: { name: 'report.pdf', type: 'application/pdf', bytes: pdfBytes } },
    );
    assert.equal(doc.status, 201);

    const icon = await submitForm(
      { kind: 'link', name: 'Png icon', url: 'https://pngicon.invalid/x', group_id: group.id },
      { image: { name: 'icon.png', type: 'image/png', bytes: harness.pngBytes() } },
    );
    assert.equal(icon.status, 201);
  });

  test('a refused upload leaves nothing on disk', async () => {
    const before = fileCount();
    await submitForm(
      { kind: 'file', name: 'Rejected payload', group_id: group.id },
      { file: { name: 'evil.html', type: 'text/html', bytes: Buffer.from('<script>1</script>') } },
    );
    await waitFor(() => fileCount() === before, 'the refused upload left an orphan behind');
  });

  test('the admin keeps the full whitelist', async () => {
    const form = new FormData();
    form.append('name', 'Admin HTML');
    form.append('file', new Blob([Buffer.from('<h1>hi</h1>')], { type: 'text/html' }), 'page.html');
    const res = await c.api('/api/links', { method: 'POST', form });
    assert.equal(res.status, 201, 'an admin may still publish HTML — they already hold the token');
  });
});

// ─── Proposing a replacement file ────────────────────────────────────────────

describe('a change request can carry a replacement file', () => {
  /** A published file-backed link, ready to be corrected. */
  async function publishedFile(name, fileName = 'v1.pdf') {
    return c.makeFileLink({
      name, fileName, type: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 first draft\n'), groups: [group.id],
    });
  }

  const replacement = (name = 'v2.pdf') =>
    ({ file: { name, type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 corrected\n') } });

  test('records the proposed file against the target link', async () => {
    const link = await publishedFile('Quarterly numbers');

    const res = await submitForm(
      { kind: 'change', target_link_id: link.id, note: 'finance sent a corrected copy' },
      replacement(),
    );
    assert.equal(res.status, 201);

    const row = await findReq(res.body.id);
    assert.equal(row.kind, 'change');
    assert.equal(row.target_link_id, link.id);
    assert.equal(row.file_name, 'v2.pdf');
    assert.match(row.file_path, /^\/uploads\//);
    assert.notEqual(row.file_path, link.file_path, 'the proposal is its own file');
    assert.equal(row.name, link.name, 'the name rides along unchanged');
    assert.ok(fs.existsSync(path.join(uploadsDir(), path.basename(row.file_path))));
  });

  test('a new file on its own is change enough', async () => {
    const link = await publishedFile('Same name, newer file');
    const res  = await submitForm(
      { kind: 'change', target_link_id: link.id, name: 'Same name, newer file' },
      replacement(),
    );
    assert.equal(res.status, 201, 'the file is the change, even when nothing else moved');
  });

  test('applying swaps the file and deletes the one it replaced', async () => {
    const link = await publishedFile('Handbook', 'handbook-v1.pdf');
    const oldOnDisk = path.join(uploadsDir(), path.basename(link.file_path));
    assert.ok(fs.existsSync(oldOnDisk));

    const res = await submitForm(
      { kind: 'change', target_link_id: link.id, name: 'Handbook (2026)' },
      replacement('handbook-v2.pdf'),
    );
    const row = await findReq(res.body.id);

    const applied = await c.api(`/api/link-requests/${row.id}/apply`, { method: 'POST', json: {} });
    assert.equal(applied.status, 200);

    const after = (await c.api('/api/links')).body.find(l => l.id === link.id);
    assert.equal(after.name, 'Handbook (2026)');
    assert.equal(after.file_name, 'handbook-v2.pdf');
    assert.equal(after.file_path, row.file_path, 'the link now points at the proposed file');
    assert.equal(after.url, row.file_path, 'file-backed links mirror the path into url');

    await gone(oldOnDisk, 'the replaced file should be gone');
    assert.ok(fs.existsSync(path.join(uploadsDir(), path.basename(row.file_path))), 'the new one is live');
  });

  test('an applied replacement survives deleting the request row', async () => {
    const link = await publishedFile('Keeps its file');
    const res  = await submitForm({ kind: 'change', target_link_id: link.id }, replacement());
    const row  = await findReq(res.body.id);

    await c.api(`/api/link-requests/${row.id}/apply`, { method: 'POST', json: {} });
    await c.api(`/api/link-requests/${row.id}`, { method: 'DELETE' });

    assert.ok(fs.existsSync(path.join(uploadsDir(), path.basename(row.file_path))),
      'the link owns those bytes now');
  });

  test('rejecting deletes the proposed file and leaves the link alone', async () => {
    const link = await publishedFile('Untouched by rejection', 'keep-me.pdf');
    const res  = await submitForm(
      { kind: 'change', target_link_id: link.id, name: 'Should not apply' },
      replacement('never-used.pdf'),
    );
    const row = await findReq(res.body.id);
    const proposedOnDisk = path.join(uploadsDir(), path.basename(row.file_path));

    await c.api(`/api/link-requests/${row.id}/reject`, { method: 'POST', json: {} });

    await gone(proposedOnDisk, 'the rejected upload should be gone');
    const after = (await c.api('/api/links')).body.find(l => l.id === link.id);
    assert.equal(after.name, 'Untouched by rejection');
    assert.equal(after.file_name, 'keep-me.pdf');
    assert.ok(fs.existsSync(path.join(uploadsDir(), path.basename(link.file_path))),
      'the live file is untouched');
  });

  test('deleting a pending proposal deletes its file too', async () => {
    const link = await publishedFile('Deleted proposal');
    const res  = await submitForm({ kind: 'change', target_link_id: link.id }, replacement());
    const row  = await findReq(res.body.id);

    await c.api(`/api/link-requests/${row.id}`, { method: 'DELETE' });
    await gone(path.join(uploadsDir(), path.basename(row.file_path)));
  });

  test('a URL-backed link cannot be handed a file', async () => {
    const link = await c.makeLink({ name: 'Just a URL', url: 'https://justaurl.invalid/x', groups: [group.id] });
    const before = fileCount();

    const res = await submitForm({ kind: 'change', target_link_id: link.id }, replacement());

    assert.equal(res.status, 400);
    assert.match(res.body.error, /file/i);
    await waitFor(() => fileCount() === before, 'the refused upload left something behind');
  });

  test('the inert-type rule still applies to a replacement', async () => {
    const link = await publishedFile('No scripts here');
    const res  = await submitForm(
      { kind: 'change', target_link_id: link.id },
      { file: { name: 'evil.html', type: 'text/html', bytes: Buffer.from('<script>1</script>') } },
    );
    assert.equal(res.status, 400);
  });

  test('a change with neither a file nor an edited field is still refused', async () => {
    const link = await publishedFile('Nothing proposed');
    const res  = await submitForm({ kind: 'change', target_link_id: link.id, name: 'Nothing proposed' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /nothing/i);
  });
});
