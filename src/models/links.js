// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Links data access, including group-membership decoration. */

const { db } = require('../config/db');

// ─── Group membership helpers ─────────────────────────────────────────────────

/**
 * Returns a Map of link_id → array of group objects, each with the section
 * the link is assigned to within that group (if any).
 * Groups are ordered by their own position so the "primary" group is stable.
 */
function loadAllMemberships() {
  const rows = db.prepare(`
    SELECT link_groups.link_id,
           link_groups.section_id,
           groups.id          AS group_id,
           groups.name        AS group_name,
           groups.color       AS group_color,
           sections.name      AS section_name,
           sections.parent_section_id AS parent_section_id,
           parent.name        AS parent_section_name
    FROM link_groups
    JOIN groups ON groups.id = link_groups.group_id
    LEFT JOIN sections        ON sections.id = link_groups.section_id
    LEFT JOIN sections parent ON parent.id   = sections.parent_section_id
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all();

  const byLink = new Map();
  for (const r of rows) {
    if (!byLink.has(r.link_id)) byLink.set(r.link_id, []);
    byLink.get(r.link_id).push({
      id:                  r.group_id,
      name:                r.group_name,
      color:               r.group_color,
      section_id:          r.section_id ?? null,
      section_name:        r.section_name ?? null,
      parent_section_id:   r.parent_section_id ?? null,
      parent_section_name: r.parent_section_name ?? null,
    });
  }
  return byLink;
}

/** Returns the group/section memberships for a single link. */
function loadMembershipsForLink(linkId) {
  const rows = db.prepare(`
    SELECT groups.id          AS group_id,
           groups.name        AS group_name,
           groups.color       AS group_color,
           link_groups.section_id,
           sections.name      AS section_name,
           sections.parent_section_id AS parent_section_id,
           parent.name        AS parent_section_name
    FROM link_groups
    JOIN groups ON groups.id = link_groups.group_id
    LEFT JOIN sections        ON sections.id = link_groups.section_id
    LEFT JOIN sections parent ON parent.id   = sections.parent_section_id
    WHERE link_groups.link_id = ?
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all(linkId);

  return rows.map(r => ({
    id:                  r.group_id,
    name:                r.group_name,
    color:               r.group_color,
    section_id:          r.section_id ?? null,
    section_name:        r.section_name ?? null,
    parent_section_id:   r.parent_section_id ?? null,
    parent_section_name: r.parent_section_name ?? null,
  }));
}

/**
 * Attaches `groups`, `group_ids`, and legacy `group_id`/`group_name`/`group_color`
 * fields (first group) to a link row. Keeps the public API compatible with code
 * that only knows about a single group.
 */
function decorateLink(linkRow, memberships) {
  if (!linkRow) return linkRow;
  const groups = memberships ?? loadMembershipsForLink(linkRow.id);
  const first  = groups[0] || null;
  return {
    ...linkRow,
    groups,
    group_ids:   groups.map(g => g.id),
    group_id:    first ? first.id    : null,
    group_name:  first ? first.name  : null,
    group_color: first ? first.color : null,
  };
}

/**
 * Replaces the full set of group memberships for a link.
 * `assignments` accepts either:
 *   - an array of numeric IDs (legacy):       [1, 2, 3]
 *   - an array of { group_id, section_id }:   [{group_id: 1, section_id: 7}, {group_id: 2}]
 * Invalid entries are silently skipped. Section IDs that don't belong to the
 * given group are nulled out (defensive — keeps section/group consistent).
 */
function setLinkGroups(linkId, assignments) {
  const clear = db.prepare('DELETE FROM link_groups WHERE link_id = ?');
  const ins   = db.prepare(
    'INSERT OR IGNORE INTO link_groups (link_id, group_id, section_id) VALUES (?, ?, ?)'
  );
  clear.run(linkId);
  if (!Array.isArray(assignments)) return;

  const sectionGroupMap = new Map(
    db.prepare('SELECT id, group_id FROM sections').all().map(s => [s.id, s.group_id])
  );

  const seen = new Set();
  for (const raw of assignments) {
    let gid, sid = null;
    if (typeof raw === 'number' || typeof raw === 'string') {
      gid = Number(raw);
    } else if (raw && typeof raw === 'object') {
      gid = Number(raw.group_id);
      sid = (raw.section_id === null || raw.section_id === undefined)
        ? null
        : Number(raw.section_id);
    } else continue;

    if (!Number.isFinite(gid) || gid <= 0 || seen.has(gid)) continue;
    seen.add(gid);

    // Drop section_id if it doesn't belong to this group.
    if (sid !== null && (!Number.isFinite(sid) || sectionGroupMap.get(sid) !== gid)) {
      sid = null;
    }
    ins.run(linkId, gid, sid);
  }
}

// ─── Links ────────────────────────────────────────────────────────────────────

/** Returns every link ordered by position, with all its groups attached. */
function getAllLinks() {
  const rows         = db.prepare('SELECT * FROM links ORDER BY position ASC, created_at DESC').all();
  const memberships  = loadAllMemberships();
  return rows.map(r => decorateLink(r, memberships.get(r.id) || []));
}

/** Returns a single link by ID, with its groups attached. */
function getLinkById(id) {
  const row = db.prepare('SELECT * FROM links WHERE id = ?').get(id);
  return decorateLink(row);
}

/**
 * Returns the first link that has the same URL, or null if none exists.
 * Pass excludeId to skip the current link when editing.
 */
function checkDuplicateUrl(url, excludeId = null) {
  if (excludeId) {
    return db.prepare('SELECT id, name FROM links WHERE url = ? AND id != ?').get(url, excludeId);
  }
  return db.prepare('SELECT id, name FROM links WHERE url = ?').get(url);
}

/**
 * Adds one group membership (optionally inside a section) to a link, leaving
 * every other membership untouched. A membership that already exists is left
 * exactly as it is — this never moves a link between sections.
 * Returns { added } so callers can tell "linked now" from "was already there".
 */
function addLinkGroup(linkId, groupId, sectionId = null) {
  const res = db.prepare(`
    INSERT OR IGNORE INTO link_groups (link_id, group_id, section_id) VALUES (?, ?, ?)
  `).run(linkId, groupId, Number.isFinite(sectionId) ? sectionId : null);
  return { added: res.changes > 0 };
}

/**
 * Minimal id/name/url rows for every URL-backed link. Used for duplicate
 * detection that needs to normalise URLs in JS (SQL can't do it cheaply).
 */
function getLinkUrlIndex() {
  return db.prepare(`
    SELECT id, name, url FROM links
    WHERE url IS NOT NULL AND url != '' AND file_path IS NULL
  `).all();
}

/**
 * Inserts a new link placed at the end of the position list.
 * For URL-backed links pass `url`; for file-backed links pass `filePath` (and
 * optionally `fileName` for display) — in that case `url` may be an empty string.
 */
function createLink({ name, url, description, imagePath, groupIds, filePath, fileName }) {
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM links').get().max;
  const result = db
    .prepare(`
      INSERT INTO links (name, url, description, image_path, position, file_path, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(name, url ?? '', description ?? null, imagePath ?? null, maxPos + 1,
         filePath ?? null, fileName ?? null);

  setLinkGroups(result.lastInsertRowid, groupIds);
  return result;
}

/**
 * Updates an existing link and replaces its group memberships.
 *   removeImage = true → clears image_path.
 *   filePath supplied   → replaces the existing file (caller deletes the old file on disk).
 *   clearFile  = true   → clears file_path and file_name (link reverts to URL-only).
 * Pass groupIds=undefined to leave memberships untouched, [] to clear them.
 */
function updateLink(id, { name, url, description, imagePath, groupIds, removeImage,
                          filePath, fileName, clearFile }) {
  if (removeImage) {
    db.prepare(`
      UPDATE links
      SET name=?, url=?, description=?, image_path=NULL
      WHERE id=?
    `).run(name, url ?? '', description ?? null, id);
  } else {
    db.prepare(`
      UPDATE links
      SET name=?, url=?, description=?, image_path=COALESCE(?, image_path)
      WHERE id=?
    `).run(name, url ?? '', description ?? null, imagePath ?? null, id);
  }

  if (clearFile) {
    db.prepare('UPDATE links SET file_path = NULL, file_name = NULL WHERE id = ?').run(id);
  } else if (filePath !== undefined) {
    db.prepare('UPDATE links SET file_path = ?, file_name = ? WHERE id = ?')
      .run(filePath, fileName ?? null, id);
  }

  if (groupIds !== undefined) setLinkGroups(id, groupIds);
  return { changes: 1 };
}

/** Deletes a link and all its recorded clicks and group memberships. */
function deleteLink(id) {
  db.prepare('DELETE FROM link_clicks WHERE link_id = ?').run(id);
  db.prepare('DELETE FROM link_groups WHERE link_id = ?').run(id);
  return db.prepare('DELETE FROM links WHERE id = ?').run(id);
}

/** Stores the path of the server-cached favicon for a link. */
function updateLinkFavicon(id, faviconPath) {
  db.prepare('UPDATE links SET favicon_path = ? WHERE id = ?').run(faviconPath, id);
}

/** Sets a link's custom icon (image_path) without touching any other field. */
function updateLinkImage(id, imagePath) {
  db.prepare('UPDATE links SET image_path = ? WHERE id = ?').run(imagePath, id);
}

/** Soft-hides or un-hides a link without touching anything else. */
function updateLinkVisibility(id, isHidden) {
  db.prepare('UPDATE links SET is_hidden = ? WHERE id = ?')
    .run(isHidden ? 1 : 0, id);
}

/** Records the result of a health check for a link. */
function updateLinkBrokenStatus(id, isBroken) {
  db.prepare('UPDATE links SET is_broken = ?, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(isBroken ? 1 : 0, id);
}

/** Returns id and url for every link — used by the health checker. */
function getAllLinksForHealthCheck() {
  // File-backed links are local resources — skip them since fetch() on a
  // relative path would fail anyway.
  return db.prepare('SELECT id, url FROM links WHERE file_path IS NULL').all();
}

/** Updates the position of all links at once from a full ordered ID array. */
function reorderLinks(orderedIds) {
  const update = db.prepare('UPDATE links SET position = ? WHERE id = ?');
  orderedIds.forEach((id, index) => update.run(index, id));
}

module.exports = {
  getAllLinks, getLinkById, checkDuplicateUrl, getLinkUrlIndex, addLinkGroup,
  createLink, updateLink, deleteLink,
  updateLinkFavicon, updateLinkImage, updateLinkBrokenStatus, updateLinkVisibility,
  getAllLinksForHealthCheck, reorderLinks,
};
