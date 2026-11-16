// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const { db } = require('../config/db');
function linkDetails(id) {
  const row = db.prepare('SELECT * FROM workspace_link_details WHERE link_id=?').get(id);
  return { tags: row ? JSON.parse(row.tags) : [], publish_at: row?.publish_at || null, expires_at: row?.expires_at || null, created_by: row?.created_by || null };
}
function setLinkDetails(id, value) {
  const old = linkDetails(id), data = { ...old, ...value };
  db.prepare('INSERT OR REPLACE INTO workspace_link_details(link_id,tags,publish_at,expires_at,created_by) VALUES(?,?,?,?,?)')
    .run(id, JSON.stringify(data.tags), data.publish_at, data.expires_at, data.created_by);
  return data;
}
function groupDetails(id) {
  const row = db.prepare('SELECT layout,is_private FROM workspace_group_details WHERE group_id=?').get(id);
  return { layout: row?.layout || 'grid', is_private: !!row?.is_private };
}
function setGroupDetails(id, value) {
  const data = { ...groupDetails(id), ...value };
  db.prepare('INSERT OR REPLACE INTO workspace_group_details(group_id,layout,is_private) VALUES(?,?,?)').run(id, data.layout, +data.is_private);
  return data;
}
const ranks = { viewer: 1, contributor: 2, editor: 3, manager: 4 };
function role(userId, groupId) {
  if (!userId) return null;
  if (db.prepare('SELECT 1 FROM group_managers WHERE user_id=? AND group_id=?').get(userId, groupId)) return 'manager';
  return db.prepare('SELECT role FROM workspace_group_access WHERE user_id=? AND group_id=?').get(userId, groupId)?.role || null;
}
function access(groupId) { return db.prepare('SELECT a.user_id,a.role,u.email,u.display_name FROM workspace_group_access a JOIN users u ON u.id=a.user_id WHERE a.group_id=? ORDER BY u.email').all(groupId); }
function setAccess(groupId, entries) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM workspace_group_access WHERE group_id=?').run(groupId);
    for (const entry of entries) db.prepare('INSERT INTO workspace_group_access(group_id,user_id,role) VALUES(?,?,?)').run(groupId, entry.user_id, entry.role);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
function managedIds(userId, minimum = 2) {
  return db.prepare('SELECT id FROM groups').all().filter(g => (ranks[role(userId, g.id)] || 0) >= minimum).map(g => g.id);
}
function canViewGroup(req, group) { return !group.is_private || req.user?.role === 'admin' || !!role(req.user?.id, group.id); }
function published(link, now = Date.now()) { return (!link.publish_at || Date.parse(link.publish_at) <= now) && (!link.expires_at || Date.parse(link.expires_at) > now); }
function addVersion(kind, entityId, title, content, actorId = null) {
  const latest = db.prepare('SELECT content FROM workspace_versions WHERE kind=? AND entity_id=? ORDER BY id DESC LIMIT 1').get(kind, entityId);
  if (latest?.content === content) return;
  db.prepare('INSERT INTO workspace_versions(kind,entity_id,title,content,actor_id) VALUES(?,?,?,?,?)').run(kind, entityId, title, content, actorId);
  db.prepare('DELETE FROM workspace_versions WHERE kind=? AND entity_id=? AND id NOT IN (SELECT id FROM workspace_versions WHERE kind=? AND entity_id=? ORDER BY id DESC LIMIT 30)').run(kind, entityId, kind, entityId);
}
function versions(kind, entityId) { return db.prepare('SELECT id,kind,entity_id,title,actor_id,created_at,length(content) AS size FROM workspace_versions WHERE kind=? AND entity_id=? ORDER BY id DESC').all(kind, entityId); }
function version(id) { return db.prepare('SELECT * FROM workspace_versions WHERE id=?').get(id); }
function deleteLinkDetails(id) { db.prepare('DELETE FROM workspace_link_details WHERE link_id=?').run(id); db.prepare("DELETE FROM workspace_versions WHERE kind='document' AND entity_id=?").run(id); }
function deleteGroupDetails(id) { db.prepare('DELETE FROM workspace_group_details WHERE group_id=?').run(id); db.prepare('DELETE FROM workspace_group_access WHERE group_id=?').run(id); }
module.exports = { linkDetails, setLinkDetails, groupDetails, setGroupDetails, role, ranks, access, setAccess, managedIds, canViewGroup, published, addVersion, versions, version, deleteLinkDetails, deleteGroupDetails };
