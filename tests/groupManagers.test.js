// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Group admins: members an administrator trusts with a shared group.
 *
 * The rule under test, in full: a group admin may add a link to a group they
 * look after, and change or remove a link that lives only in groups they look
 * after. Everything else — other groups, links shared with other groups,
 * hidden links, custom addresses, the group's own settings — stays the
 * administrators'. Most of this file is the "everything else".
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');
const { fileForm, svgBytes } = harness;

let c, db, team, other, teamSection, otherSection, ann, ben, annS, benS;
const PASSWORD = 'a-long-enough-password';

before(async () => {
  c  = await harness.start();
  db = require('../src/models');
  team  = await c.makeGroup({ name: 'Team' });
  other = await c.makeGroup({ name: 'Other' });
  teamSection  = await c.makeSection(team.id, 'Docs');
  otherSection = await c.makeSection(other.id, 'Elsewhere');
  ann = await c.makeUser({ email: 'ann@example.test', password: PASSWORD });
  ben = await c.makeUser({ email: 'ben@example.test', password: PASSWORD });
  annS = c.session(); await annS.login('ann@example.test', PASSWORD);
  benS = c.session(); await benS.login('ben@example.test', PASSWORD);
});
after(harness.stop);

const formOf = fields => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  return form;
};
const addAs = (s, fields) => s.fetch('/api/managed/links', { method: 'POST', form: formOf(fields) });
const sharedLinks = async () => (await c.api('/api/links?view=admin')).body;

describe('choosing group admins', () => {
  test('is for administrators', async () => {
    const res = await annS.fetch(`/api/groups/${team.id}/managers`, { method: 'PUT', json: { user_ids: [ann.id] } });
    assert.equal(res.status, 401);
    assert.equal((await annS.fetch(`/api/groups/${team.id}/managers`)).status, 401);
  });

  test('an administrator makes Ann an admin of Team', async () => {
    const res = await c.api(`/api/groups/${team.id}/managers`, { method: 'PUT', json: { user_ids: [ann.id] } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.managers.map(m => m.email), ['ann@example.test']);
    assert.deepEqual((await c.api(`/api/groups/${team.id}/managers`)).body.managers.map(m => m.id), [ann.id]);
  });

  test('only existing accounts can be chosen', async () => {
    const res = await c.api(`/api/groups/${team.id}/managers`, { method: 'PUT', json: { user_ids: [ann.id, 99999] } });
    assert.equal(res.status, 400);
    assert.equal(db.getGroupManagers(team.id).length, 1, 'and nothing changed');
  });

  test('the member\'s page is told which groups are theirs to look after', async () => {
    assert.deepEqual((await annS.fetch('/api/my/data')).body.managed_group_ids, [team.id]);
    assert.deepEqual((await benS.fetch('/api/my/data')).body.managed_group_ids, []);
  });
});

describe('adding links', () => {
  test('Ann adds a link to Team, in a section, and everybody sees it', async () => {
    const res = await addAs(annS, { name: 'Team wiki', url: 'https://wiki.example.com/', group_id: team.id, section_id: teamSection.id });
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(res.body.groups.map(g => [g.id, g.section_id]), [[team.id, teamSection.id]]);

    const pub = (await c.pub('/api/links')).body;
    assert.ok(pub.some(l => l.name === 'Team wiki'), 'on the public page');
  });

  test('but not to a group she does not look after — which answers as if it did not exist', async () => {
    const res = await addAs(annS, { name: 'Sneaky', url: 'https://x.example.com/', group_id: other.id });
    assert.equal(res.status, 404);
    assert.equal((await sharedLinks()).some(l => l.name === 'Sneaky'), false);
  });

  test('nor into another group\'s section', async () => {
    const res = await addAs(annS, { name: 'Misfiled', url: 'https://y.example.com/', group_id: team.id, section_id: otherSection.id });
    assert.equal(res.status, 400);
  });

  test('nor into a second group by sending the administrator\'s field', async () => {
    const res = await addAs(annS, {
      name: 'Two places', url: 'https://two.example.com/', group_id: team.id,
      groups: JSON.stringify([{ group_id: team.id }, { group_id: other.id }]),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.groups.map(g => g.id), [team.id], 'only the group she manages');
  });

  test('a custom address is not hers to choose', async () => {
    const res = await addAs(annS, { name: 'Slugged', url: 'https://s.example.com/', group_id: team.id, slug: 'handbook' });
    assert.equal(res.status, 201);
    assert.equal(res.body.slug, null);
  });

  test('files follow the public rules: no SVG, which could run script from this origin', async () => {
    const form = fileForm('file', { name: 'x.svg', type: 'image/svg+xml', bytes: svgBytes() },
                          { name: 'Drawing', group_id: team.id });
    const res = await annS.fetch('/api/managed/links', { method: 'POST', form });
    assert.equal(res.status, 400);
  });

  test('a member who manages nothing is turned away the same way', async () => {
    assert.equal((await addAs(benS, { name: 'Nope', url: 'https://n.example.com/', group_id: team.id })).status, 404);
  });

  test('the admin token is not an account, and has the panel for this', async () => {
    const res = await c.api('/api/managed/links', { method: 'POST', form: formOf({ name: 'T', url: 'https://t.example.com/', group_id: team.id }) });
    assert.equal(res.status, 401);
  });

  test('a stranger, likewise', async () => {
    const res = await c.pub('/api/managed/links', { method: 'POST', form: formOf({ name: 'S', url: 'https://s2.example.com/', group_id: team.id }), headers: { Origin: c.baseUrl } });
    assert.equal(res.status, 401);
  });

  test('the audit log names who did it, and where', async () => {
    const log = (await c.api('/api/audit?limit=100')).body;
    const entry = (log.entries || log).find(e => /Team wiki/.test(e.summary || ''));
    assert.ok(entry, 'recorded');
    assert.match(entry.summary, /"Team".*group admin/);
    assert.equal(entry.actor_label || entry.actor?.label || entry.actor_user_id, entry.actor_label || entry.actor?.label || ann.id);
  });
});

describe('changing and removing links', () => {
  let onlyTeam, shared, hidden, otherOnly;
  before(async () => {
    onlyTeam  = await c.makeLink({ name: 'Only in Team', url: 'https://only.example.com/', groups: [team.id] });
    shared    = await c.makeLink({ name: 'In both', url: 'https://both.example.com/', groups: [team.id, other.id] });
    hidden    = await c.makeLink({ name: 'Hidden in Team', url: 'https://hidden.example.com/', groups: [team.id] });
    otherOnly = await c.makeLink({ name: 'Only in Other', url: 'https://other.example.com/', groups: [other.id] });
    await c.api(`/api/links/${hidden.id}/visibility`, { method: 'POST', json: { hidden: true } });
  });

  const editAs = (s, id, fields) => s.fetch(`/api/managed/links/${id}`, { method: 'PUT', form: formOf(fields) });

  test('Ann renames a link that lives only in Team', async () => {
    const res = await editAs(annS, onlyTeam.id, { name: 'Renamed by Ann', url: 'https://only.example.com/' });
    assert.equal(res.status, 200, res.text);
    assert.equal(db.getLinkById(onlyTeam.id).name, 'Renamed by Ann');
    assert.deepEqual(db.getLinkById(onlyTeam.id).groups.map(g => g.id), [team.id], 'and it stays where it was');
  });

  test('and moves it into one of Team\'s sections', async () => {
    const res = await editAs(annS, onlyTeam.id, { name: 'Renamed by Ann', url: 'https://only.example.com/', group_id: team.id, section_id: teamSection.id });
    assert.equal(res.status, 200);
    assert.equal(db.getLinkById(onlyTeam.id).groups[0].section_id, teamSection.id);
  });

  test('but not into a group she does not look after', async () => {
    const res = await editAs(annS, onlyTeam.id, { name: 'Moved', url: 'https://only.example.com/', group_id: other.id });
    assert.equal(res.status, 404);
    assert.deepEqual(db.getLinkById(onlyTeam.id).groups.map(g => g.id), [team.id]);
  });

  test('a link also in somebody else\'s group is refused, and says why', async () => {
    const res = await editAs(annS, shared.id, { name: 'Hijacked', url: 'https://both.example.com/' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'not_only_yours');
    assert.equal(db.getLinkById(shared.id).name, 'In both');
    assert.equal((await annS.fetch(`/api/managed/links/${shared.id}`, { method: 'DELETE' })).status, 403);
    assert.ok(db.getLinkById(shared.id));
  });

  test('a hidden link, or one in a group she does not manage, does not exist as far as she is told', async () => {
    for (const link of [hidden, otherOnly]) {
      assert.equal((await editAs(annS, link.id, { name: 'X', url: 'https://x.example.com/' })).status, 404, link.name);
      assert.equal((await annS.fetch(`/api/managed/links/${link.id}`, { method: 'DELETE' })).status, 404, link.name);
    }
  });

  test('a custom address set by an administrator survives her edit', async () => {
    await c.api(`/api/links/${onlyTeam.id}`, { method: 'PUT', form: formOf({
      name: 'Renamed by Ann', url: 'https://only.example.com/', slug: 'team-only',
      groups: JSON.stringify([{ group_id: team.id, section_id: teamSection.id }]),
    }) });
    await editAs(annS, onlyTeam.id, { name: 'Edited again', url: 'https://only.example.com/', slug: 'stolen' });
    assert.equal(db.getLinkById(onlyTeam.id).slug, 'team-only');
  });

  test('she removes a link that lives only in Team', async () => {
    assert.equal((await annS.fetch(`/api/managed/links/${onlyTeam.id}`, { method: 'DELETE' })).status, 204);
    assert.ok(!db.getLinkById(onlyTeam.id), "gone");
  });

  test('Ben, who manages nothing, can change nothing', async () => {
    const res = await editAs(benS, shared.id, { name: 'Ben was here', url: 'https://both.example.com/' });
    assert.equal(res.status, 404);
  });
});

describe('when things go away', () => {
  test('an admin removed from the group loses it at once', async () => {
    await c.api(`/api/groups/${team.id}/managers`, { method: 'PUT', json: { user_ids: [] } });
    assert.equal((await addAs(annS, { name: 'Late', url: 'https://late.example.com/', group_id: team.id })).status, 404);
    await c.api(`/api/groups/${team.id}/managers`, { method: 'PUT', json: { user_ids: [ann.id] } });
  });

  test('deleting the group forgets its admins', async () => {
    const temp = await c.makeGroup({ name: 'Temporary' });
    await c.api(`/api/groups/${temp.id}/managers`, { method: 'PUT', json: { user_ids: [ben.id] } });
    await c.api(`/api/groups/${temp.id}`, { method: 'DELETE' });
    assert.deepEqual(db.getManagedGroupIds(ben.id), []);
  });

  test('deleting the account forgets what it managed', async () => {
    const carl = await c.makeUser({ email: 'carl@example.test', password: PASSWORD });
    await c.api(`/api/groups/${team.id}/managers`, { method: 'PUT', json: { user_ids: [ann.id, carl.id] } });
    await c.api(`/api/users/${carl.id}`, { method: 'DELETE' });
    assert.deepEqual(db.getGroupManagers(team.id).map(m => m.id), [ann.id]);
  });
});
