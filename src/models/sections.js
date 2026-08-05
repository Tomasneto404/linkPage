// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Sections (and one level of subsections) data access. */

const { db } = require('../config/db');

/** Returns every section for a group (top-level + sub), ordered by position. */
function getSectionsForGroup(groupId) {
  return db.prepare(`
    SELECT * FROM sections
    WHERE group_id = ?
    ORDER BY position ASC, created_at ASC
  `).all(groupId);
}

/** Returns a single section. */
function getSectionById(id) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(id);
}

/**
 * Inserts a new section at the end of its sibling list. Pass `parentSectionId`
 * to create a subsection — null/undefined means top-level for the group.
 * The position is per-sibling-group (top-level sections are ordered against
 * each other within the group; subsections against their parent's children).
 */
function createSection({ groupId, name, parentSectionId }) {
  let maxPos;
  if (parentSectionId) {
    maxPos = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS max FROM sections
      WHERE group_id = ? AND parent_section_id = ?
    `).get(groupId, parentSectionId).max;
  } else {
    maxPos = db.prepare(`
      SELECT COALESCE(MAX(position), -1) AS max FROM sections
      WHERE group_id = ? AND parent_section_id IS NULL
    `).get(groupId).max;
  }
  return db.prepare(`
    INSERT INTO sections (group_id, name, position, parent_section_id)
    VALUES (?, ?, ?, ?)
  `).run(groupId, name, maxPos + 1, parentSectionId || null);
}

/** Renames a section. */
function updateSection(id, { name }) {
  return db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, id);
}

/**
 * Deletes a section. Cascade-deletes any subsections first (which in turn
 * clear their links' section_id), then clears section_id on links pointing at
 * this section, and finally removes the section row itself.
 */
function deleteSection(id) {
  const subs = db.prepare('SELECT id FROM sections WHERE parent_section_id = ?').all(id);
  for (const sub of subs) deleteSection(sub.id);   // recurse cleanly
  db.prepare('UPDATE link_groups SET section_id = NULL WHERE section_id = ?').run(id);
  return db.prepare('DELETE FROM sections WHERE id = ?').run(id);
}

/**
 * Updates section positions from a full ordered ID array. The caller is
 * expected to send siblings only (all top-level for a group, OR all
 * subsections of the same parent) — that mirrors the drag-and-drop UI which
 * never reorders across nesting boundaries.
 */
function reorderSections(orderedIds) {
  const update = db.prepare('UPDATE sections SET position = ? WHERE id = ?');
  orderedIds.forEach((id, index) => update.run(index, id));
}

module.exports = {
  getSectionsForGroup, getSectionById, createSection, updateSection,
  deleteSection, reorderSections,
};
