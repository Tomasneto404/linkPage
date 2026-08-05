// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Icon library data access. */

const { db } = require('../config/db');

/**
 * Returns every icon in the library, newest first, with the number of links
 * that currently reference it.
 */
function getAllIcons() {
  return db.prepare(`
    SELECT icons.id,
           icons.file_path,
           icons.original_name,
           icons.mime_type,
           icons.file_size,
           icons.created_at,
           icons.last_used_at,
           (SELECT COUNT(*) FROM links WHERE links.image_path = icons.file_path) AS usage_count
    FROM icons
    ORDER BY datetime(COALESCE(icons.last_used_at, icons.created_at)) DESC, icons.id DESC
  `).all();
}

function getIconById(id) {
  return db.prepare('SELECT * FROM icons WHERE id = ?').get(id);
}

function getIconByPath(filePath) {
  return db.prepare('SELECT * FROM icons WHERE file_path = ?').get(filePath);
}

/**
 * Inserts a new icon (or returns the existing row if file_path is already
 * registered — useful when the same upload happens twice). Returns the icon row.
 */
function createIcon({ filePath, originalName, mimeType, fileSize }) {
  const existing = getIconByPath(filePath);
  if (existing) return existing;
  db.prepare(`
    INSERT INTO icons (file_path, original_name, mime_type, file_size, last_used_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(filePath, originalName ?? null, mimeType ?? null, fileSize ?? null);
  return getIconByPath(filePath);
}

/** Bumps an icon's last_used_at — call this when a link adopts it. */
function touchIcon(id) {
  db.prepare('UPDATE icons SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

/**
 * Deletes an icon row and clears `image_path` on every link that used it.
 * Returns { changes, fileToDelete } so the caller can remove the file on disk.
 */
function deleteIcon(id) {
  const icon = getIconById(id);
  if (!icon) return { changes: 0, fileToDelete: null };
  db.prepare('UPDATE links SET image_path = NULL WHERE image_path = ?').run(icon.file_path);
  const res = db.prepare('DELETE FROM icons WHERE id = ?').run(id);
  return { changes: res.changes, fileToDelete: icon.file_path };
}

module.exports = {
  getAllIcons, getIconById, getIconByPath, createIcon, touchIcon, deleteIcon,
};
