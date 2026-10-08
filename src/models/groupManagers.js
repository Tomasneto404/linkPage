// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Group admins: which members may look after which shared groups.
 *
 * No table declares a foreign key, so deleting a group or an account clears
 * its rows here explicitly (groups.deleteGroup, users.deleteUser).
 */

const { db } = require('../config/db');

/** The ids of the shared groups this account looks after. */
function getManagedGroupIds(userId) {
  return db.prepare('SELECT group_id FROM group_managers WHERE user_id = ? ORDER BY group_id')
    .all(userId).map(r => r.group_id);
}

function isGroupManager(userId, groupId) {
  return !!db.prepare('SELECT 1 FROM group_managers WHERE user_id = ? AND group_id = ?').get(userId, groupId);
}

/** The accounts looking after a group, for the admin panel. */
function getGroupManagers(groupId) {
  return db.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, u.is_active
    FROM group_managers m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY u.email_key
  `).all(groupId).map(u => ({ ...u, is_active: !!u.is_active }));
}

/** Replaces a group's admins with exactly these accounts. */
function setGroupManagers(groupId, userIds) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM group_managers WHERE group_id = ?').run(groupId);
    const insert = db.prepare('INSERT OR IGNORE INTO group_managers (group_id, user_id) VALUES (?, ?)');
    for (const id of userIds) insert.run(groupId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** How many admins each group has, for the panel to show at a glance. */
function countManagersByGroup() {
  return new Map(db.prepare('SELECT group_id, COUNT(*) AS n FROM group_managers GROUP BY group_id')
    .all().map(r => [r.group_id, r.n]));
}

module.exports = {
  getManagedGroupIds, isGroupManager, getGroupManagers, setGroupManagers, countManagersByGroup,
};
