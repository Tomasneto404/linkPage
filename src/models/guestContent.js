// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Guest contributions: groups, sections and links owned by a browser rather
 * than an account.
 *
 * Mirrors personalGroups.js and personalLinks.js in shape — a parallel set of
 * tables keyed by `owner_guest_id`, so a missing filter cannot leak between a
 * guest's contributions and a signed-in member's own content. One file rather
 * than three because guests have no features of their own worth splitting out:
 * their groups and links are what members' are, minus favourites and sharing.
 */

const crypto = require('node:crypto');
const { db } = require('../config/db');

// ─── Identity ─────────────────────────────────────────────────────────────────

const hashCookie = cookie => crypto.createHash('sha256').update(cookie).digest('hex');

function getGuestByCookie(cookie) {
  if (typeof cookie !== 'string' || !cookie) return null;
  return db.prepare('SELECT * FROM guests WHERE cookie_hash = ?').get(hashCookie(cookie)) || null;
}

function getGuestById(id) {
  return db.prepare('SELECT * FROM guests WHERE id = ?').get(id) || null;
}

/** Mints a new guest and returns the raw cookie (shown once, kept hashed). */
function createGuest({ userAgent = null, ipAddress = null } = {}) {
  const cookie = crypto.randomBytes(32).toString('base64url');
  const result = db.prepare(
    'INSERT INTO guests (cookie_hash, user_agent, ip_address) VALUES (?, ?, ?)'
  ).run(hashCookie(cookie), userAgent, ipAddress);
  return { id: Number(result.lastInsertRowid), cookie };
}

function touchGuest(id) {
  db.prepare("UPDATE guests SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

function setGuestDisplayName(id, name) {
  db.prepare('UPDATE guests SET display_name = ? WHERE id = ?').run(name || null, id);
}

/**
 * Removes a guest and everything they contributed. Returns the private
 * filenames so the caller can unlink them from disk.
 */
function deleteGuest(id) {
  const files = db.prepare(
    'SELECT icon_file, favicon_file, attachment_file FROM guest_links WHERE owner_guest_id = ?'
  ).all(id).flatMap(r => [r.icon_file, r.favicon_file, r.attachment_file].filter(Boolean));

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM guest_link_groups WHERE owner_guest_id = ?').run(id);
    db.prepare('DELETE FROM guest_links       WHERE owner_guest_id = ?').run(id);
    db.prepare('DELETE FROM guest_sections    WHERE owner_guest_id = ?').run(id);
    db.prepare('DELETE FROM guest_groups      WHERE owner_guest_id = ?').run(id);
    db.prepare('DELETE FROM guests            WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return files;
}

/** Guests older than this many days, for the retention job and the admin list. */
function listGuestsForAdmin() {
  return db.prepare(`
    SELECT g.id, g.display_name, g.user_agent, g.ip_address, g.created_at, g.last_seen_at,
           g.storage_used,
           (SELECT COUNT(*) FROM guest_groups  WHERE owner_guest_id = g.id) AS group_count,
           (SELECT COUNT(*) FROM guest_links   WHERE owner_guest_id = g.id) AS link_count
    FROM guests g
    ORDER BY g.last_seen_at DESC
  `).all();
}

/** Guests last seen before `cutoff` (ISO string), for the retention job to prune. */
function guestsOlderThan(cutoff) {
  return db.prepare('SELECT id FROM guests WHERE last_seen_at < ?').all(cutoff).map(r => r.id);
}

// ─── Groups ───────────────────────────────────────────────────────────────────

function getGuestGroups(ownerId) {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.color, g.position, g.created_at,
           (SELECT COUNT(*) FROM guest_link_groups m
             WHERE m.group_id = g.id AND m.owner_guest_id = g.owner_guest_id) AS link_count
    FROM guest_groups g WHERE g.owner_guest_id = ?
    ORDER BY g.position ASC, g.id ASC
  `).all(ownerId);
  const sections = db.prepare(`
    SELECT id, group_id, name, position, parent_section_id
    FROM guest_sections WHERE owner_guest_id = ?
    ORDER BY position ASC, id ASC
  `).all(ownerId);
  const byId    = new Map(sections.map(s => [s.id, { ...s, subsections: [] }]));
  const topBy   = new Map(groups.map(g => [g.id, []]));
  for (const s of byId.values()) {
    if (s.parent_section_id && byId.has(s.parent_section_id)) byId.get(s.parent_section_id).subsections.push(s);
    else if (topBy.has(s.group_id))                            topBy.get(s.group_id).push(s);
  }
  return groups.map(g => ({
    ...g, sections: topBy.get(g.id) || [],
    is_protected: false, unlock_mode: 'timeout', owner: 'guest',
  }));
}

function getGuestGroup(ownerId, id) {
  return db.prepare('SELECT * FROM guest_groups WHERE id = ? AND owner_guest_id = ?').get(id, ownerId) || null;
}

function countGuestGroups(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM guest_groups WHERE owner_guest_id = ?').get(ownerId).n;
}

function createGuestGroup(ownerId, { name, color }) {
  const p = db.prepare('SELECT COALESCE(MAX(position), -1)+1 AS p FROM guest_groups WHERE owner_guest_id = ?').get(ownerId).p;
  const r = db.prepare('INSERT INTO guest_groups (owner_guest_id, name, color, position) VALUES (?, ?, ?, ?)')
    .run(ownerId, name, color, p);
  return getGuestGroup(ownerId, Number(r.lastInsertRowid));
}

function updateGuestGroup(ownerId, id, { name, color }) {
  db.prepare('UPDATE guest_groups SET name = ?, color = ? WHERE id = ? AND owner_guest_id = ?').run(name, color, id, ownerId);
  return getGuestGroup(ownerId, id);
}

function deleteGuestGroup(ownerId, id) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM guest_link_groups WHERE group_id = ? AND owner_guest_id = ?').run(id, ownerId);
    db.prepare('DELETE FROM guest_sections    WHERE group_id = ? AND owner_guest_id = ?').run(id, ownerId);
    const r = db.prepare('DELETE FROM guest_groups WHERE id = ? AND owner_guest_id = ?').run(id, ownerId);
    db.exec('COMMIT');
    return r.changes === 1;
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

function reorderGuestGroups(ownerId, orderedIds) {
  const upd = db.prepare('UPDATE guest_groups SET position = ? WHERE id = ? AND owner_guest_id = ?');
  orderedIds.forEach((id, i) => upd.run(i, id, ownerId));
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function getGuestSection(ownerId, id) {
  return db.prepare('SELECT * FROM guest_sections WHERE id = ? AND owner_guest_id = ?').get(id, ownerId) || null;
}

function countGuestSections(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM guest_sections WHERE owner_guest_id = ?').get(ownerId).n;
}

function createGuestSection(ownerId, groupId, { name, parentSectionId = null }) {
  if (!getGuestGroup(ownerId, groupId)) return null;
  if (parentSectionId !== null) {
    const parent = getGuestSection(ownerId, parentSectionId);
    if (!parent || parent.group_id !== groupId || parent.parent_section_id !== null) return null;
  }
  const p = db.prepare(`
    SELECT COALESCE(MAX(position), -1)+1 AS p FROM guest_sections
    WHERE owner_guest_id = ? AND group_id = ? AND parent_section_id IS ?
  `).get(ownerId, groupId, parentSectionId).p;
  const r = db.prepare(`
    INSERT INTO guest_sections (owner_guest_id, group_id, name, position, parent_section_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(ownerId, groupId, name, p, parentSectionId);
  return getGuestSection(ownerId, Number(r.lastInsertRowid));
}

function renameGuestSection(ownerId, id, name) {
  db.prepare('UPDATE guest_sections SET name = ? WHERE id = ? AND owner_guest_id = ?').run(name, id, ownerId);
  return getGuestSection(ownerId, id);
}

function deleteGuestSection(ownerId, id) {
  db.prepare(`
    DELETE FROM guest_sections WHERE owner_guest_id = ?
      AND (id = ? OR parent_section_id = ?)
  `).run(ownerId, id, id);
}

function reorderGuestSections(ownerId, orderedIds) {
  const upd = db.prepare('UPDATE guest_sections SET position = ? WHERE id = ? AND owner_guest_id = ?');
  orderedIds.forEach((id, i) => upd.run(i, id, ownerId));
}

// ─── Links ────────────────────────────────────────────────────────────────────

function loadGuestMemberships(ownerId) {
  const rows = db.prepare(`
    SELECT m.guest_link_id, m.section_id,
           g.id AS group_id, g.name AS group_name, g.color AS group_color,
           s.name AS section_name, s.parent_section_id,
           p.name AS parent_section_name
    FROM guest_link_groups m
    JOIN guest_groups g        ON g.id = m.group_id      AND g.owner_guest_id = m.owner_guest_id
    LEFT JOIN guest_sections s ON s.id = m.section_id    AND s.owner_guest_id = m.owner_guest_id
    LEFT JOIN guest_sections p ON p.id = s.parent_section_id AND p.owner_guest_id = m.owner_guest_id
    WHERE m.owner_guest_id = ?
    ORDER BY g.position ASC, g.id ASC
  `).all(ownerId);
  const byLink = new Map();
  for (const r of rows) {
    if (!byLink.has(r.guest_link_id)) byLink.set(r.guest_link_id, []);
    byLink.get(r.guest_link_id).push({
      id: r.group_id, name: r.group_name, color: r.group_color,
      section_id: r.section_id ?? null, section_name: r.section_name ?? null,
      parent_section_id: r.parent_section_id ?? null, parent_section_name: r.parent_section_name ?? null,
    });
  }
  return byLink;
}

function decorateGuestLink(row, memberships = []) {
  const base = `/api/guest/links/${row.id}`;
  return {
    id: row.id, name: row.name, url: row.url, description: row.description, position: row.position, created_at: row.created_at,
    image_path:   row.icon_file ? `${base}/icon` : (row.image_path || null),
    favicon_path: row.favicon_file ? `${base}/favicon` : null,
    file_path:    row.attachment_file ? `${base}/file` : null,
    file_name:    row.attachment_file ? row.file_name : null,
    stored_bytes: row.icon_bytes + row.favicon_bytes + row.attachment_bytes,
    is_hidden: 0, groups: memberships, group_ids: memberships.map(g => g.id), owner: 'guest',
  };
}

const GUEST_LINK_ROW = `
  SELECT id, name, url, description, image_path, icon_file, favicon_file,
         attachment_file, file_name, icon_bytes, favicon_bytes, attachment_bytes,
         position, created_at
  FROM guest_links
`;

function getGuestLinks(ownerId) {
  const m = loadGuestMemberships(ownerId);
  return db.prepare(`${GUEST_LINK_ROW} WHERE owner_guest_id = ? ORDER BY position ASC, id ASC`)
    .all(ownerId).map(r => decorateGuestLink(r, m.get(r.id) || []));
}

function getGuestLink(ownerId, id) {
  const row = db.prepare(`${GUEST_LINK_ROW} WHERE id = ? AND owner_guest_id = ?`).get(id, ownerId);
  if (!row) return null;
  return decorateGuestLink(row, loadGuestMemberships(ownerId).get(id) || []);
}

function getGuestLinkRow(ownerId, id) {
  return db.prepare('SELECT * FROM guest_links WHERE id = ? AND owner_guest_id = ?').get(id, ownerId) || null;
}

function countGuestLinks(ownerId) {
  return db.prepare('SELECT COUNT(*) AS n FROM guest_links WHERE owner_guest_id = ?').get(ownerId).n;
}

function createGuestLink(ownerId, { name, url = '', description = null, imagePath = null }) {
  const p = db.prepare('SELECT COALESCE(MAX(position), -1)+1 AS p FROM guest_links WHERE owner_guest_id = ?').get(ownerId).p;
  const r = db.prepare(`
    INSERT INTO guest_links (owner_guest_id, name, url, description, image_path, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ownerId, name, url, description, imagePath, p);
  return Number(r.lastInsertRowid);
}

function updateGuestLink(ownerId, id, { name, url, description }) {
  const sets = [], params = [];
  if (name !== undefined)        { sets.push('name = ?');        params.push(name); }
  if (url !== undefined)         { sets.push('url = ?');         params.push(url); }
  if (description !== undefined) { sets.push('description = ?'); params.push(description); }
  if (!sets.length) return getGuestLink(ownerId, id);
  params.push(id, ownerId);
  db.prepare(`UPDATE guest_links SET ${sets.join(', ')} WHERE id = ? AND owner_guest_id = ?`).run(...params);
  return getGuestLink(ownerId, id);
}

/** Replaces a file slot (icon / favicon / attachment) and keeps storage_used right. */
function setGuestLinkFile(ownerId, id, slot, { file = null, bytes = 0, fileName = null } = {}) {
  const map = { icon: ['icon_file', 'icon_bytes', null], favicon: ['favicon_file', 'favicon_bytes', null], attachment: ['attachment_file', 'attachment_bytes', 'file_name'] };
  const [fileCol, bytesCol, nameCol] = map[slot];
  const current = getGuestLinkRow(ownerId, id);
  if (!current) return null;
  const was = current[bytesCol] || 0;
  const sets = [`${fileCol} = ?`, `${bytesCol} = ?`];
  const params = [file, bytes];
  if (nameCol) { sets.push(`${nameCol} = ?`); params.push(fileName); }
  params.push(id, ownerId);
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE guest_links SET ${sets.join(', ')} WHERE id = ? AND owner_guest_id = ?`).run(...params);
    db.prepare('UPDATE guests SET storage_used = MAX(0, storage_used + ?) WHERE id = ?').run(bytes - was, ownerId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return current[fileCol];     // old file to delete from disk
}

function setGuestLinkLibraryIcon(ownerId, id, imagePath) {
  const current = getGuestLinkRow(ownerId, id);
  if (!current) return null;
  const oldIconFile = current.icon_file;
  const oldBytes    = current.icon_bytes || 0;
  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE guest_links SET image_path = ?, icon_file = NULL, icon_bytes = 0 WHERE id = ? AND owner_guest_id = ?'
    ).run(imagePath, id, ownerId);
    if (oldBytes) db.prepare('UPDATE guests SET storage_used = MAX(0, storage_used - ?) WHERE id = ?').run(oldBytes, ownerId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return oldIconFile;
}

function setGuestLinkGroups(ownerId, linkId, assignments) {
  if (!getGuestLinkRow(ownerId, linkId)) return false;
  const groups = new Set(db.prepare('SELECT id FROM guest_groups WHERE owner_guest_id = ?').all(ownerId).map(r => r.id));
  const sectionGroup = new Map(db.prepare('SELECT id, group_id FROM guest_sections WHERE owner_guest_id = ?').all(ownerId).map(r => [r.id, r.group_id]));

  db.prepare('DELETE FROM guest_link_groups WHERE guest_link_id = ? AND owner_guest_id = ?').run(linkId, ownerId);
  const ins = db.prepare('INSERT OR IGNORE INTO guest_link_groups (guest_link_id, group_id, section_id, owner_guest_id) VALUES (?, ?, ?, ?)');
  const seen = new Set();
  for (const raw of Array.isArray(assignments) ? assignments : []) {
    const gid = Number(typeof raw === 'object' && raw ? raw.group_id : raw);
    if (!groups.has(gid) || seen.has(gid)) continue;
    seen.add(gid);
    let sid = raw && typeof raw === 'object' ? raw.section_id : null;
    sid = (sid == null || sid === '') ? null : Number(sid);
    if (sid !== null && sectionGroup.get(sid) !== gid) sid = null;
    ins.run(linkId, gid, sid, ownerId);
  }
  return true;
}

function deleteGuestLink(ownerId, id) {
  const row = getGuestLinkRow(ownerId, id);
  if (!row) return null;
  const files = [row.icon_file, row.favicon_file, row.attachment_file].filter(Boolean);
  const freed = (row.icon_bytes || 0) + (row.favicon_bytes || 0) + (row.attachment_bytes || 0);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM guest_link_groups WHERE guest_link_id = ? AND owner_guest_id = ?').run(id, ownerId);
    db.prepare('DELETE FROM guest_links       WHERE id = ? AND owner_guest_id = ?').run(id, ownerId);
    if (freed) db.prepare('UPDATE guests SET storage_used = MAX(0, storage_used - ?) WHERE id = ?').run(freed, ownerId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return files;
}

function reorderGuestLinks(ownerId, orderedIds) {
  const upd = db.prepare('UPDATE guest_links SET position = ? WHERE id = ? AND owner_guest_id = ?');
  orderedIds.forEach((id, i) => upd.run(i, id, ownerId));
}

module.exports = {
  hashCookie,
  getGuestByCookie, getGuestById, createGuest, touchGuest, setGuestDisplayName,
  deleteGuest, listGuestsForAdmin, guestsOlderThan,
  getGuestGroups, getGuestGroup, countGuestGroups,
  createGuestGroup, updateGuestGroup, deleteGuestGroup, reorderGuestGroups,
  getGuestSection, countGuestSections,
  createGuestSection, renameGuestSection, deleteGuestSection, reorderGuestSections,
  getGuestLinks, getGuestLink, getGuestLinkRow, countGuestLinks,
  createGuestLink, updateGuestLink, setGuestLinkFile, setGuestLinkLibraryIcon,
  setGuestLinkGroups, deleteGuestLink, reorderGuestLinks,
};
