// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Link import/visibility helpers shared by the links controller: name-based
 * group/section resolution (create-if-missing) and the public visibility
 * filter.
 */

const db = require('../models');

/**
 * Resolves a group by name (case-insensitive). Returns the existing id when
 * found, otherwise creates the group with the supplied colour.
 */
function ensureGroupByName(name, color) {
  const trimmed = (typeof name === 'string' ? name.trim() : '');
  if (!trimmed) return { id: null, created: false };
  const found = db.getAllGroups().find(g => g.name.toLowerCase() === trimmed.toLowerCase());
  if (found) return { id: found.id, created: false };
  const result = db.createGroup({ name: trimmed, color: color || '#0071e3' });
  return { id: result.lastInsertRowid, created: true };
}

/**
 * Same as ensureGroupByName but for a section inside an already-known group.
 * Pass `parentSectionId` to look up / create a subsection. Top-level and
 * sub names share the same column so the case-insensitive lookup is scoped
 * to the right sibling list.
 */
function ensureSectionByName(groupId, name, parentSectionId = null) {
  const trimmed = (typeof name === 'string' ? name.trim() : '');
  if (!trimmed || !groupId) return { id: null, created: false };
  const all = db.getSectionsForGroup(groupId);
  const targetParent = parentSectionId || null;
  const found = all.find(s =>
    s.name.toLowerCase() === trimmed.toLowerCase() &&
    (s.parent_section_id ?? null) === targetParent
  );
  if (found) return { id: found.id, created: false };
  const result = db.createSection({ groupId, name: trimmed, parentSectionId: targetParent });
  return { id: result.lastInsertRowid, created: true };
}

/**
 * A link is "visible" to a non-admin viewer if it belongs to no groups at all,
 * OR to at least one group that is either public or has been unlocked.
 * (Permissive: putting a link in a public group exposes it even if it also
 * lives in a protected group.)
 */
function filterVisibleLinks(links, groups, unlockedIds) {
  const protectedIds = new Set(groups.filter(g => g.is_protected).map(g => g.id));
  return links.filter(link => {
    const ids = link.group_ids || [];
    if (ids.length === 0) return true;
    return ids.some(gid => !protectedIds.has(gid) || unlockedIds.has(gid));
  });
}

/**
 * The shared links this request may see as a visitor: nothing hidden, nothing
 * in a locked group it has not unlocked. The one definition of the public view,
 * used by the listing itself and by anything that must agree with it — a
 * member's favourites, which must never show a link the listing would not.
 */
function visibleSharedLinks(req) {
  const { getUnlockedGroupIds } = require('../utils/groupCrypto');
  const workspace = require('../models/workspace');
  const allGroups = db.getAllGroups();
  const visible = db.getAllLinks().filter(l => !l.is_hidden && workspace.published(l));
  const allowed = new Set(allGroups.filter(g => workspace.canViewGroup(req, g)).map(g => g.id));
  const scoped = visible.filter(l => !l.group_ids.length || l.group_ids.some(id => allowed.has(id)))
    .map(l => { const groups = l.groups.filter(g => allowed.has(g.id)); const first = groups[0]; return { ...l, groups, group_ids: groups.map(g => g.id), group_id: first?.id ?? null, group_name: first?.name ?? null, group_color: first?.color ?? null }; });
  return filterVisibleLinks(scoped, allGroups, getUnlockedGroupIds(req));
}

module.exports = { ensureGroupByName, ensureSectionByName, filterVisibleLinks, visibleSharedLinks };
