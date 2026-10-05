// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A member's favourites: shared links they have starred, in their own order.
 *
 * The same rules as the other personal models — owner first, ownership in the
 * statement that does the work — with one difference worth stating. A
 * favourite points at a *shared* link, which the member does not own and which
 * can change under them: the administrator may hide it, delete it, or move it
 * into a group behind a password. So this table is never the answer to "which
 * links are this person's favourites". It is a list of ids, and the answer is
 * that list filtered through what the person may see right now — which is done
 * by the caller, at read time, every time.
 *
 * Positions are kept sparse-tolerant: a favourite of a link that has since
 * vanished keeps its row until the link is deleted (when the cascade takes
 * it), and simply never appears.
 */

const { db } = require('../config/db');

/** This person's starred link ids, in their order. Not visibility-filtered. */
function getFavoriteIds(userId) {
  return db.prepare(`
    SELECT link_id FROM user_favorites WHERE user_id = ? ORDER BY position ASC, created_at ASC
  `).all(userId).map(r => r.link_id);
}

function countFavorites(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_favorites WHERE user_id = ?').get(userId).n;
}

function isFavorite(userId, linkId) {
  return !!db.prepare('SELECT 1 FROM user_favorites WHERE user_id = ? AND link_id = ?')
    .get(userId, linkId);
}

/**
 * Stars a link, at the end of the list. Returns true when it was newly added,
 * false when it was already a favourite — starring twice is not an error.
 */
function addFavorite(userId, linkId) {
  const next = db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM user_favorites WHERE user_id = ?'
  ).get(userId).p;

  return db.prepare(`
    INSERT OR IGNORE INTO user_favorites (user_id, link_id, position) VALUES (?, ?, ?)
  `).run(userId, linkId, next).changes === 1;
}

/** Unstars a link. Returns whether there was anything to remove. */
function removeFavorite(userId, linkId) {
  return db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND link_id = ?')
    .run(userId, linkId).changes === 1;
}

/**
 * Puts this person's favourites in the given order. Ids that are not among
 * their favourites are ignored — never inserted, never written.
 */
function reorderFavorites(userId, orderedLinkIds) {
  const update = db.prepare(
    'UPDATE user_favorites SET position = ? WHERE user_id = ? AND link_id = ?'
  );
  let changed = 0;
  orderedLinkIds.forEach((linkId, index) => { changed += update.run(index, userId, linkId).changes; });
  return changed;
}

module.exports = {
  getFavoriteIds, countFavorites, isFavorite,
  addFavorite, removeFavorite, reorderFavorites,
};
