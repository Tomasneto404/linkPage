// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A member's own groups and sections.
 *
 * The rules for every function in this file, and in personalLinks.js:
 *
 *   1. The owner comes first. No exported function accepts a row id without
 *      also accepting the id of the person it must belong to.
 *   2. Ownership is checked in the statement that does the work, never before
 *      it. `UPDATE … WHERE id = ? AND owner_user_id = ?`, then look at
 *      `changes`. Loading a row, checking its owner in JavaScript and then
 *      writing by id alone is the pattern that eventually gets refactored into
 *      writing by id alone.
 *   3. A miss is indistinguishable from a row that does not exist. Callers
 *      answer 404 either way; a 403 would confirm somebody else's row is there.
 *
 * Reordering is where rule 2 matters most. The shared reorder functions are a
 * bare `UPDATE … WHERE id = ?`, and copying that here would let anyone rewrite
 * the layout of anyone else's page by posting their ids.
 */

const { db } = require('../config/db');

// ─── Groups ───────────────────────────────────────────────────────────────────

/**
 * A member's groups, in their order, each with its sections nested the same
 * way the shared groups are — so the public page can render either with the
 * same code.
 */
function getPersonalGroups(ownerId) {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.color, g.position, g.created_at,
           (SELECT COUNT(*) FROM user_link_groups m
             WHERE m.group_id = g.id AND m.owner_user_id = g.owner_user_id) AS link_count
    FROM user_groups g
    WHERE g.owner_user_id = ?
    ORDER BY g.position ASC, g.id ASC
  `).all(ownerId);

  const sections = db.prepare(`
    SELECT s.id, s.group_id, s.name, s.position, s.parent_section_id,
           (SELECT COUNT(*) FROM user_link_groups m
             WHERE m.section_id = s.id AND m.owner_user_id = s.owner_user_id) AS link_count
    FROM user_sections s
    WHERE s.owner_user_id = ?
    ORDER BY s.position ASC, s.id ASC
  `).all(ownerId);

  const byId = new Map(sections.map(s => [s.id, { ...s, subsections: [] }]));
  const topLevel = new Map(groups.map(g => [g.id, []]));

  for (const s of byId.values()) {
    if (s.parent_section_id && byId.has(s.parent_section_id)) {
      byId.get(s.parent_section_id).subsections.push(s);
    } else if (topLevel.has(s.group_id)) {
      topLevel.get(s.group_id).push(s);
    }
  }

  return groups.map(g => ({
    ...g,
    sections:     topLevel.get(g.id) || [],
    // The shape the public page expects of a shared group. A personal group is
    // never password-protected — it is already private to one person.
    is_protected: false,
    unlock_mode:  'timeout',
    owner:        'me',
  }));
}

function getPersonalGroup(ownerId, id) {
  return db.prepare(`
    SELECT id, name, color, position, created_at
    FROM user_groups WHERE id = ? AND owner_user_id = ?
  `).get(id, ownerId) || null;
}

function countPersonalGroups(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_groups WHERE owner_user_id = ?')
    .get(ownerId).n;
}

function createPersonalGroup(ownerId, { name, color }) {
  const next = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM user_groups WHERE owner_user_id = ?'
  ).get(ownerId).p;

  const result = db.prepare(`
    INSERT INTO user_groups (owner_user_id, name, color, position) VALUES (?, ?, ?, ?)
  `).run(ownerId, name, color, next);

  return getPersonalGroup(ownerId, Number(result.lastInsertRowid));
}

/** Returns the updated group, or null when it is not this person's. */
function updatePersonalGroup(ownerId, id, { name, color }) {
  const result = db.prepare(`
    UPDATE user_groups SET name = ?, color = ? WHERE id = ? AND owner_user_id = ?
  `).run(name, color, id, ownerId);
  return result.changes === 1 ? getPersonalGroup(ownerId, id) : null;
}

/**
 * Deletes a group, its sections, and every link's membership of it. The links
 * themselves stay — a link filed in a group is not owned by the group, and
 * losing someone's links because they tidied up their tabs would be cruel.
 */
function deletePersonalGroup(ownerId, id) {
  const result = db.prepare('DELETE FROM user_groups WHERE id = ? AND owner_user_id = ?')
    .run(id, ownerId);
  if (result.changes !== 1) return false;

  db.prepare('DELETE FROM user_sections WHERE group_id = ? AND owner_user_id = ?').run(id, ownerId);
  db.prepare('DELETE FROM user_link_groups WHERE group_id = ? AND owner_user_id = ?').run(id, ownerId);
  return true;
}

/**
 * Puts this person's groups in the given order. Ids that are not theirs are
 * ignored rather than refused, so a stale tab cannot fail the whole reorder —
 * but they are never written.
 */
function reorderPersonalGroups(ownerId, orderedIds) {
  const update = db.prepare(
    'UPDATE user_groups SET position = ? WHERE id = ? AND owner_user_id = ?'
  );
  let changed = 0;
  orderedIds.forEach((id, index) => { changed += update.run(index, id, ownerId).changes; });
  return changed;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function getPersonalSection(ownerId, id) {
  return db.prepare(`
    SELECT id, group_id, name, position, parent_section_id
    FROM user_sections WHERE id = ? AND owner_user_id = ?
  `).get(id, ownerId) || null;
}

function countPersonalSections(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_sections WHERE owner_user_id = ?')
    .get(ownerId).n;
}

/**
 * Adds a section to one of this person's groups, optionally inside another of
 * their sections. Returns null when the group or the parent is not theirs, or
 * the parent is itself a subsection — one level of nesting, as with the shared
 * sections, because deeper than that stops being navigable.
 */
function createPersonalSection(ownerId, groupId, { name, parentSectionId = null }) {
  if (!getPersonalGroup(ownerId, groupId)) return null;

  if (parentSectionId !== null) {
    const parent = getPersonalSection(ownerId, parentSectionId);
    if (!parent || parent.group_id !== groupId || parent.parent_section_id !== null) return null;
  }

  const next = db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 AS p FROM user_sections
    WHERE owner_user_id = ? AND group_id = ? AND parent_section_id IS ?
  `).get(ownerId, groupId, parentSectionId).p;

  const result = db.prepare(`
    INSERT INTO user_sections (owner_user_id, group_id, name, position, parent_section_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(ownerId, groupId, name, next, parentSectionId);

  return getPersonalSection(ownerId, Number(result.lastInsertRowid));
}

function renamePersonalSection(ownerId, id, name) {
  const result = db.prepare(
    'UPDATE user_sections SET name = ? WHERE id = ? AND owner_user_id = ?'
  ).run(name, id, ownerId);
  return result.changes === 1 ? getPersonalSection(ownerId, id) : null;
}

/**
 * Deletes a section and its subsections. Links filed in them fall back to the
 * group itself rather than leaving it — the section was a heading, and removing
 * a heading should not remove what was under it.
 */
function deletePersonalSection(ownerId, id) {
  const section = getPersonalSection(ownerId, id);
  if (!section) return false;

  const children = db.prepare(
    'SELECT id FROM user_sections WHERE parent_section_id = ? AND owner_user_id = ?'
  ).all(id, ownerId).map(r => r.id);

  const doomed = [id, ...children];
  const unfile = db.prepare(
    'UPDATE user_link_groups SET section_id = NULL WHERE section_id = ? AND owner_user_id = ?'
  );
  const remove = db.prepare('DELETE FROM user_sections WHERE id = ? AND owner_user_id = ?');
  for (const sid of doomed) { unfile.run(sid, ownerId); remove.run(sid, ownerId); }
  return true;
}

function reorderPersonalSections(ownerId, orderedIds) {
  const update = db.prepare(
    'UPDATE user_sections SET position = ? WHERE id = ? AND owner_user_id = ?'
  );
  let changed = 0;
  orderedIds.forEach((id, index) => { changed += update.run(index, id, ownerId).changes; });
  return changed;
}

module.exports = {
  getPersonalGroups, getPersonalGroup, countPersonalGroups,
  createPersonalGroup, updatePersonalGroup, deletePersonalGroup, reorderPersonalGroups,
  getPersonalSection, countPersonalSections,
  createPersonalSection, renamePersonalSection, deletePersonalSection, reorderPersonalSections,
};
