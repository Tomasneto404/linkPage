// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Group admins: members an administrator has trusted with a shared group.
 *
 * What a group admin may do, and nothing more:
 *   - add a link to a group they look after, in any of its sections;
 *   - change or remove a link that lives *only* in groups they look after.
 * A link that is also in somebody else's group is the administrators' to
 * change: editing it would change what that other group shows.
 *
 * The work itself is the administrator's own link controller. These handlers
 * check the right, narrow the request to what a group admin may set — no
 * custom address, which is one namespace for the whole instance — and hand it
 * on, so a link added here is exactly a link added in the admin panel.
 *
 * A group, or a link, that is not theirs answers 404, as it does to a stranger.
 */

const db = require('../models');
const links = require('./linksController');
const { safeDeleteFile } = require('../services/uploadService');

/** A signed-in account's managed groups. Administrators look after every group. */
function managedGroupIds(req) {
  if (req.user?.role === 'admin') return new Set(db.getAllGroups().map(g => g.id));
  return new Set(db.getManagedGroupIds(req.user.id));
}

/** Group admins are accounts. The admin token has panel routes of its own. */
function requireGroupAdmin(req, res, next) {
  if (req.user?.via !== 'session' || !Number.isInteger(req.user.id)) {
    return res.status(401).json({ error: 'Sign in to manage a group', code: 'auth_required' });
  }
  next();
}

function discardUploads(req) {
  for (const file of [...(req.files?.image || []), ...(req.files?.file || [])]) {
    safeDeleteFile(`/uploads/${file.filename}`);
  }
}

/**
 * The group and section a request names, checked against what this person
 * looks after. Returns { group_id, section_id } or { error, status }.
 */
function placementFrom(req, managed) {
  const groupId = Number.parseInt(req.body?.group_id, 10);
  if (!managed.has(groupId)) return { status: 404, error: 'No such group' };

  const raw = req.body?.section_id;
  if (raw === undefined || raw === null || raw === '') return { group_id: groupId, section_id: null };
  const sectionId = Number.parseInt(raw, 10);
  if (db.getSectionById(sectionId)?.group_id !== groupId) {
    return { status: 400, error: 'That section is not in that group' };
  }
  return { group_id: groupId, section_id: sectionId };
}

/**
 * The link a request names, if this person may change it. Hidden links are
 * the administrators': a group admin never sees them, so cannot change them.
 */
function editableLink(req, res, managed) {
  const link = db.getLinkById(req.params.id);
  const groupIds = (link?.groups || []).map(g => g.id);
  if (!link || link.is_hidden || !groupIds.some(id => managed.has(id))) {
    res.status(404).json({ error: 'Link not found' });
    return null;
  }
  if (!groupIds.every(id => managed.has(id))) {
    res.status(403).json({
      error: 'This link is also in a group you do not manage. Ask an administrator to change it.',
      code:  'not_only_yours',
    });
    return null;
  }
  return link;
}

/** Strips what only administrators set, then lays down the checked placement. */
function narrow(req, placement) {
  delete req.body.slug;
  delete req.body.group_ids;
  delete req.body.group_id;
  delete req.body.section_id;
  if (placement) req.body.groups = JSON.stringify([placement]);
  else delete req.body.groups;
}

async function create(req, res) {
  const managed = managedGroupIds(req);
  const placement = placementFrom(req, managed);
  if (placement.error) {
    discardUploads(req);
    return res.status(placement.status).json({ error: placement.error });
  }
  narrow(req, placement);
  const group = db.getGroupById(placement.group_id);
  req._auditSummary = `Added link "${String(req.body.name || '').trim().slice(0, 80)}" to ${group ? `"${group.name}"` : 'a group'} as its group admin`;
  return links.create(req, res);
}

async function update(req, res) {
  const managed = managedGroupIds(req);
  const link = editableLink(req, res, managed);
  if (!link) return discardUploads(req);

  // Moving it is allowed, between groups this person looks after.
  let placement = null;
  if (req.body?.group_id !== undefined) {
    placement = placementFrom(req, managed);
    if (placement.error) {
      discardUploads(req);
      return res.status(placement.status).json({ error: placement.error });
    }
  }
  narrow(req, placement);
  req._auditSummary = `Changed link "${link.name}" as its group admin`;
  return links.update(req, res);
}

function remove(req, res) {
  const link = editableLink(req, res, managedGroupIds(req));
  if (!link) return;
  links.remove(req, res);
  req._auditSummary = `Deleted link "${link.name}" as its group admin`;
}

// ─── Assigning group admins, for administrators ───────────────────────────────

function getManagers(req, res) {
  const groupId = Number.parseInt(req.params.id, 10);
  if (!db.getGroupById(groupId)) return res.status(404).json({ error: 'Group not found' });
  res.json({ managers: db.getGroupManagers(groupId) });
}

function setManagers(req, res) {
  const groupId = Number.parseInt(req.params.id, 10);
  const group = db.getGroupById(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const ids = req.body?.user_ids;
  if (!Array.isArray(ids) || ids.length > 500) return res.status(400).json({ error: 'Send { user_ids: [ids] }' });
  const wanted = [...new Set(ids.map(Number))];
  if (!wanted.every(id => Number.isInteger(id) && db.getUserById(id))) {
    return res.status(400).json({ error: 'Every group admin must be an existing account' });
  }

  db.setGroupManagers(groupId, wanted);
  req._auditSummary = `Set ${wanted.length} group admin(s) for "${group.name}"`;
  res.json({ managers: db.getGroupManagers(groupId) });
}

module.exports = { requireGroupAdmin, managedGroupIds, create, update, remove, getManagers, setManagers };
