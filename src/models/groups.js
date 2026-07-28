/** Groups data access + scrypt password hashing (reused for settings gates). */

const crypto = require('node:crypto');
const { db } = require('../config/db');

/**
 * Strips the password hash from a group row and adds an `is_protected` boolean.
 * Use this whenever a group row leaves the database layer — the hash should
 * never reach the wire.
 */
function safeGroup(row) {
  if (!row) return row;
  const { password_hash, ...rest } = row;
  return {
    ...rest,
    is_protected: !!password_hash,
    // Coerce NULLs (groups created before v5 had no unlock_mode column) to
    // the historical default so the wire format never has nulls.
    unlock_mode:  rest.unlock_mode || 'timeout',
  };
}

/** Hashes a password using scrypt. Format: scrypt$<saltHex>$<hashHex>. */
function hashGroupPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Constant-time verify of a plaintext password against a stored
 * `scrypt$<saltHex>$<hashHex>` string (produced by hashGroupPassword). Works for
 * any such hash regardless of where it's stored (groups.password_hash, settings).
 */
function verifyScryptHash(storedHash, password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  if (typeof storedHash !== 'string' || !storedHash) return false;

  const [scheme, saltHex, hashHex] = storedHash.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;

  const salt     = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual   = crypto.scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/** Returns true if the password matches the stored hash for the given group. */
function verifyGroupPassword(groupId, password) {
  const row = db.prepare('SELECT password_hash FROM groups WHERE id = ?').get(groupId);
  return verifyScryptHash(row?.password_hash, password);
}

/**
 * Returns all groups ordered by position, with a `sections` array attached.
 *
 * Sections are returned as a two-level hierarchy:
 *   group.sections   = [ { id, name, position, link_count,
 *                          subsections: [ { id, name, position, link_count } ] } ]
 * Subsections are scoped to a single level (no sub-sub-sections) on purpose
 * to keep the navigation manageable.
 */
function getAllGroups() {
  const rows = db.prepare(`
    SELECT groups.*, COUNT(link_groups.link_id) AS link_count
    FROM groups
    LEFT JOIN link_groups ON link_groups.group_id = groups.id
    GROUP BY groups.id
    ORDER BY groups.position ASC, groups.created_at ASC
  `).all();

  const sectionRows = db.prepare(`
    SELECT sections.*, COUNT(link_groups.link_id) AS link_count
    FROM sections
    LEFT JOIN link_groups
      ON link_groups.section_id = sections.id
     AND link_groups.group_id   = sections.group_id
    GROUP BY sections.id
    ORDER BY sections.position ASC, sections.created_at ASC
  `).all();

  // Build a lookup once so we can attach children to parents cheaply.
  const sectionsById = new Map();
  for (const s of sectionRows) {
    sectionsById.set(s.id, {
      id:                s.id,
      group_id:          s.group_id,
      name:              s.name,
      position:          s.position,
      parent_section_id: s.parent_section_id ?? null,
      link_count:        s.link_count,
      subsections:       [],
    });
  }

  // Walk in position order: any subsection encountered slots into its parent
  // (preserving sibling order); top-level sections collect into their group.
  const topByGroup = new Map();
  for (const s of sectionRows) {
    const obj = sectionsById.get(s.id);
    if (obj.parent_section_id && sectionsById.has(obj.parent_section_id)) {
      sectionsById.get(obj.parent_section_id).subsections.push({
        id:         obj.id,
        name:       obj.name,
        position:   obj.position,
        link_count: obj.link_count,
      });
    } else {
      if (!topByGroup.has(obj.group_id)) topByGroup.set(obj.group_id, []);
      topByGroup.get(obj.group_id).push(obj);
    }
  }

  return rows.map(g => ({
    ...safeGroup(g),
    sections: (topByGroup.get(g.id) || []).map(s => ({
      id:          s.id,
      name:        s.name,
      position:    s.position,
      link_count:  s.link_count,
      subsections: s.subsections,
    })),
  }));
}

/** Returns a single group by ID, hash stripped. */
function getGroupById(id) {
  return safeGroup(db.prepare('SELECT * FROM groups WHERE id = ?').get(id));
}

/** Normalises an unlock-mode input to a known value, falling back to 'timeout'. */
function sanitizeUnlockMode(value) {
  return value === 'session' ? 'session' : 'timeout';
}

/**
 * Inserts a new group placed at the end of the position list.
 * Pass `password` as a non-empty string to protect the group, and
 * `unlockMode` ('timeout' | 'session') to choose how an unlock persists.
 */
function createGroup({ name, color, password, unlockMode }) {
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM groups').get().max;
  const hash   = (typeof password === 'string' && password.length > 0)
    ? hashGroupPassword(password)
    : null;
  const mode   = sanitizeUnlockMode(unlockMode);
  return db.prepare(`
    INSERT INTO groups (name, color, position, password_hash, unlock_mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, color ?? '#0071e3', maxPos + 1, hash, mode);
}

/**
 * Updates a group's name, color, password, and unlock mode.
 *   password === undefined → leave password unchanged
 *   password === null or '' → clear the password (group becomes public)
 *   password = '<string>'   → set a new password
 *   unlockMode === undefined → leave unchanged; otherwise normalised to a known value
 */
function updateGroup(id, { name, color, password, unlockMode }) {
  db.prepare('UPDATE groups SET name=?, color=? WHERE id=?').run(name, color, id);

  if (password !== undefined) {
    if (password === null || password === '') {
      db.prepare('UPDATE groups SET password_hash = NULL WHERE id = ?').run(id);
    } else if (typeof password === 'string') {
      db.prepare('UPDATE groups SET password_hash = ? WHERE id = ?').run(hashGroupPassword(password), id);
    }
  }

  if (unlockMode !== undefined) {
    db.prepare('UPDATE groups SET unlock_mode = ? WHERE id = ?')
      .run(sanitizeUnlockMode(unlockMode), id);
  }
  return { changes: 1 };
}

/**
 * Deletes a group, its sections, and the link memberships in it.
 * Links that belonged to the group lose only this membership — any other
 * groups they belong to are preserved.
 */
function deleteGroup(id) {
  db.prepare('DELETE FROM link_groups WHERE group_id = ?').run(id);
  db.prepare('DELETE FROM sections   WHERE group_id = ?').run(id);
  // Also clear the legacy single-group column on any link that pointed here.
  db.prepare('UPDATE links SET group_id = NULL WHERE group_id = ?').run(id);
  return db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}

/** Updates the position of all groups at once from a full ordered ID array. */
function reorderGroups(orderedIds) {
  const update = db.prepare('UPDATE groups SET position = ? WHERE id = ?');
  orderedIds.forEach((id, index) => update.run(index, id));
}

module.exports = {
  hashGroupPassword, verifyScryptHash, verifyGroupPassword,
  getAllGroups, getGroupById, createGroup, updateGroup, deleteGroup, reorderGroups,
};
