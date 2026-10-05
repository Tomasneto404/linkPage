// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A member's own links.
 *
 * Same rules as personalGroups.js, which explains them: owner first, ownership
 * checked inside the statement that does the work, a miss looks like nothing.
 *
 * What is stored and what is shown are different shapes here, on purpose.
 * The row keeps bare filenames inside private-uploads/. decoratePersonalLink
 * turns those into URLs under /api/my/, which only the owner's session can
 * fetch. Nothing in this file ever produces an /uploads/ path for a private
 * file, and the column names are different from the shared table's so that
 * nothing elsewhere can mistake one for the other.
 *
 * Storage is not a counter that can drift. Each link records, per file, the
 * bytes it is keeping on disk, and a person's usage is the sum — so replacing a
 * file frees exactly what that file cost, deleting a link frees everything it
 * held, and there is no running total to fall out of step with the disk.
 */

const { db } = require('../config/db');

// ─── Shape ────────────────────────────────────────────────────────────────────

/** Every group and section this person's links are filed in, keyed by link. */
function loadPersonalMemberships(ownerId) {
  const rows = db.prepare(`
    SELECT m.user_link_id, m.section_id,
           g.id AS group_id, g.name AS group_name, g.color AS group_color,
           s.name AS section_name, s.parent_section_id,
           parent.name AS parent_section_name
    FROM user_link_groups m
    JOIN user_groups g          ON g.id = m.group_id      AND g.owner_user_id = m.owner_user_id
    LEFT JOIN user_sections s   ON s.id = m.section_id    AND s.owner_user_id = m.owner_user_id
    LEFT JOIN user_sections parent
                                ON parent.id = s.parent_section_id
                               AND parent.owner_user_id = m.owner_user_id
    WHERE m.owner_user_id = ?
    ORDER BY g.position ASC, g.id ASC
  `).all(ownerId);

  const byLink = new Map();
  for (const r of rows) {
    if (!byLink.has(r.user_link_id)) byLink.set(r.user_link_id, []);
    byLink.get(r.user_link_id).push({
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

/**
 * The wire shape: the same fields a shared link has, so the public page renders
 * both with one function, plus `owner: 'me'` to tell them apart.
 *
 * Private files become URLs that only answer to the owner's session.
 */
function decoratePersonalLink(row, memberships = []) {
  const base = `/api/my/links/${row.id}`;
  return {
    id:           row.id,
    name:         row.name,
    url:          row.url,
    description:  row.description,
    position:     row.position,
    created_at:   row.created_at,
    image_path:   row.icon_file ? `${base}/icon` : (row.image_path || null),
    favicon_path: row.favicon_file ? `${base}/favicon` : null,
    file_path:    row.attachment_file ? `${base}/file` : null,
    file_name:    row.attachment_file ? row.file_name : null,
    stored_bytes: row.icon_bytes + row.favicon_bytes + row.attachment_bytes,
    is_hidden:    0,
    groups:       memberships,
    group_ids:    memberships.map(g => g.id),
    owner:        'me',
  };
}

const ROW = `
  SELECT id, name, url, description, image_path, icon_file, favicon_file,
         attachment_file, file_name, icon_bytes, favicon_bytes, attachment_bytes,
         position, created_at
  FROM user_links
`;

// ─── Reading ──────────────────────────────────────────────────────────────────

function getPersonalLinks(ownerId) {
  const memberships = loadPersonalMemberships(ownerId);
  return db.prepare(`${ROW} WHERE owner_user_id = ? ORDER BY position ASC, id ASC`)
    .all(ownerId)
    .map(row => decoratePersonalLink(row, memberships.get(row.id) || []));
}

function getPersonalLink(ownerId, id) {
  const row = getPersonalLinkRow(ownerId, id);
  if (!row) return null;
  return decoratePersonalLink(row, loadPersonalMemberships(ownerId).get(row.id) || []);
}

/**
 * The raw row, with its private filenames. For the routes that stream those
 * files — never for a response body.
 */
function getPersonalLinkRow(ownerId, id) {
  return db.prepare(`${ROW} WHERE id = ? AND owner_user_id = ?`).get(id, ownerId) || null;
}

function countPersonalLinks(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_links WHERE owner_user_id = ?')
    .get(ownerId).n;
}

/** Bytes this person is keeping on disk, summed from the links holding them. */
function personalStorageUsed(ownerId) {
  return db.prepare(`
    SELECT COALESCE(SUM(icon_bytes + favicon_bytes + attachment_bytes), 0) AS n
    FROM user_links WHERE owner_user_id = ?
  `).get(ownerId).n;
}

// ─── Writing ──────────────────────────────────────────────────────────────────

function createPersonalLink(ownerId, { name, url = '', description = null, imagePath = null }) {
  const next = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM user_links WHERE owner_user_id = ?'
  ).get(ownerId).p;

  const result = db.prepare(`
    INSERT INTO user_links (owner_user_id, name, url, description, image_path, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ownerId, name, url, description, imagePath, next);

  return Number(result.lastInsertRowid);
}

/** Changes the text fields. Returns false when the link is not this person's. */
function updatePersonalLink(ownerId, id, { name, url, description }) {
  const result = db.prepare(`
    UPDATE user_links SET name = ?, url = ?, description = ?
    WHERE id = ? AND owner_user_id = ?
  `).run(name, url, description, id, ownerId);
  return result.changes === 1;
}

/**
 * Sets one of a link's file slots, recording what it now costs. Returns the
 * filename it replaced so the caller can unlink it, or undefined when the link
 * is not this person's. Passing no file clears the slot.
 *
 * `slot` comes from a fixed map, never from the request — the column names it
 * resolves to are interpolated into the statement.
 */
const FILE_SLOTS = {
  icon:       { file: 'icon_file',       bytes: 'icon_bytes' },
  favicon:    { file: 'favicon_file',    bytes: 'favicon_bytes' },
  attachment: { file: 'attachment_file', bytes: 'attachment_bytes' },
};

function setPersonalLinkFile(ownerId, id, slot, { file = null, bytes = 0, fileName = null } = {}) {
  const spec = FILE_SLOTS[slot];
  if (!spec) throw new Error(`Unknown file slot: ${slot}`);

  const row = getPersonalLinkRow(ownerId, id);
  if (!row) return undefined;

  const sets   = [`${spec.file} = ?`, `${spec.bytes} = ?`];
  const params = [file, file ? Math.max(0, Number(bytes) || 0) : 0];

  if (slot === 'attachment') { sets.push('file_name = ?'); params.push(file ? fileName : null); }
  // An uploaded icon takes over from a library one, which was never a file.
  if (slot === 'icon' && file) sets.push('image_path = NULL');

  db.prepare(`UPDATE user_links SET ${sets.join(', ')} WHERE id = ? AND owner_user_id = ?`)
    .run(...params, id, ownerId);

  return row[spec.file] || null;
}

/**
 * Points the icon at a shared library image. Returns the uploaded icon it
 * displaced, if any, so the caller can unlink it.
 */
function setPersonalLinkLibraryIcon(ownerId, id, imagePath) {
  const row = getPersonalLinkRow(ownerId, id);
  if (!row) return undefined;

  db.prepare(`
    UPDATE user_links SET image_path = ?, icon_file = NULL, icon_bytes = 0
    WHERE id = ? AND owner_user_id = ?
  `).run(imagePath, id, ownerId);

  return row.icon_file || null;
}

/**
 * Files a link into this person's groups and sections, replacing wherever it
 * was before.
 *
 * Every group and section is checked against the owner. Without that, a link
 * could be filed into somebody else's group by id — it would never show on
 * their page, since their reads are owner-scoped too, but it would sit in their
 * link counts and their deletes would trip over it.
 */
function setPersonalLinkGroups(ownerId, linkId, assignments) {
  if (!getPersonalLinkRow(ownerId, linkId)) return false;

  const ownedGroups = new Set(db.prepare(
    'SELECT id FROM user_groups WHERE owner_user_id = ?'
  ).all(ownerId).map(r => r.id));

  const sectionGroup = new Map(db.prepare(
    'SELECT id, group_id FROM user_sections WHERE owner_user_id = ?'
  ).all(ownerId).map(r => [r.id, r.group_id]));

  db.prepare('DELETE FROM user_link_groups WHERE user_link_id = ? AND owner_user_id = ?')
    .run(linkId, ownerId);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_link_groups (user_link_id, group_id, section_id, owner_user_id)
    VALUES (?, ?, ?, ?)
  `);

  const seen = new Set();
  for (const raw of Array.isArray(assignments) ? assignments : []) {
    const gid = Number(typeof raw === 'object' && raw ? raw.group_id : raw);
    if (!ownedGroups.has(gid) || seen.has(gid)) continue;
    seen.add(gid);

    let sid = raw && typeof raw === 'object' ? raw.section_id : null;
    sid = sid === null || sid === undefined || sid === '' ? null : Number(sid);
    // A section from another group — or somebody else's — files to the group.
    if (sid !== null && sectionGroup.get(sid) !== gid) sid = null;

    insert.run(linkId, gid, sid, ownerId);
  }
  return true;
}

/**
 * Deletes a link and its memberships. Returns the private filenames it held so
 * the caller can remove them from disk, or null when it is not this person's.
 */
function deletePersonalLink(ownerId, id) {
  const row = getPersonalLinkRow(ownerId, id);
  if (!row) return null;

  db.prepare('DELETE FROM user_links WHERE id = ? AND owner_user_id = ?').run(id, ownerId);
  db.prepare('DELETE FROM user_link_groups WHERE user_link_id = ? AND owner_user_id = ?')
    .run(id, ownerId);

  return [row.icon_file, row.favicon_file, row.attachment_file].filter(Boolean);
}

function reorderPersonalLinks(ownerId, orderedIds) {
  const update = db.prepare(
    'UPDATE user_links SET position = ? WHERE id = ? AND owner_user_id = ?'
  );
  let changed = 0;
  orderedIds.forEach((id, index) => { changed += update.run(index, id, ownerId).changes; });
  return changed;
}

/**
 * Removes everything a person owns. Returns every private filename, for the
 * caller to unlink. Used when an account is deleted — which is the one moment
 * forgetting a table here leaves somebody's links in the database with no
 * account they belong to.
 */
function deleteAllPersonalContent(ownerId) {
  const files = db.prepare(`
    SELECT icon_file, favicon_file, attachment_file FROM user_links WHERE owner_user_id = ?
  `).all(ownerId).flatMap(r => [r.icon_file, r.favicon_file, r.attachment_file]).filter(Boolean);

  for (const table of ['user_link_groups', 'user_links', 'user_sections', 'user_groups']) {
    db.prepare(`DELETE FROM ${table} WHERE owner_user_id = ?`).run(ownerId);
  }
  db.prepare('DELETE FROM user_favorites WHERE user_id = ?').run(ownerId);

  return files;
}

module.exports = {
  getPersonalLinks, getPersonalLink, getPersonalLinkRow, countPersonalLinks,
  personalStorageUsed,
  createPersonalLink, updatePersonalLink,
  setPersonalLinkFile, setPersonalLinkLibraryIcon, setPersonalLinkGroups,
  deletePersonalLink, reorderPersonalLinks, deleteAllPersonalContent,
};
