// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Sections: admin create (under a group), rename, delete, reorder. */

const db = require('../models');

function createForGroup(req, res) {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group id' });
  if (!db.getGroupById(groupId)) return res.status(404).json({ error: 'Group not found' });

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Section name is required' });

  // Optional: create as a subsection of an existing section in the same group.
  // We deliberately enforce a single nesting level (no sub-sub-sections) by
  // rejecting parents that themselves already have a parent_section_id.
  let parentSectionId = null;
  if (req.body.parent_section_id != null && req.body.parent_section_id !== '') {
    const pid = Number(req.body.parent_section_id);
    if (!Number.isFinite(pid)) return res.status(400).json({ error: 'Invalid parent_section_id' });
    const parent = db.getSectionById(pid);
    if (!parent || parent.group_id !== groupId) {
      return res.status(400).json({ error: 'Parent section does not belong to this group' });
    }
    if (parent.parent_section_id) {
      return res.status(400).json({ error: 'Subsections cannot have their own subsections' });
    }
    parentSectionId = pid;
  }

  const result = db.createSection({ groupId, name, parentSectionId });
  res.status(201).json(db.getSectionById(result.lastInsertRowid));
}

function update(req, res) {
  const section = db.getSectionById(req.params.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Section name is required' });

  db.updateSection(req.params.id, { name });
  res.json(db.getSectionById(req.params.id));
}

function remove(req, res) {
  const section = db.getSectionById(req.params.id);
  if (!section) {
    return res.status(404).json({ error: 'Section not found' });
  }
  req._auditSummary = `Deleted section "${section.name}"`;
  db.deleteSection(req.params.id);
  res.status(204).end();
}

function reorder(req, res) {
  const { order } = req.body;
  if (!Array.isArray(order) || order.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"order" must be an array of numeric IDs' });
  }
  db.reorderSections(order);
  res.status(204).end();
}

module.exports = { createForGroup, update, remove, reorder };
