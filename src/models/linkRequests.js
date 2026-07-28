/** Public link-request submissions data access. */

const { db } = require('../config/db');

/** Inserts a new pending link request. Returns the run result. */
function createLinkRequest({ name, url, description, imagePath, groupId, sectionId, ipAddress }) {
  return db.prepare(`
    INSERT INTO link_requests (name, url, description, image_path, group_id, section_id, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    url,
    description ?? null,
    imagePath ?? null,
    Number.isFinite(groupId) ? groupId : null,
    Number.isFinite(sectionId) ? sectionId : null,
    ipAddress ?? null,
  );
}

/**
 * Returns link requests newest-first, decorated with the target group's name +
 * color and the (sub)section name + its parent name. `opts.status` filters by
 * status ('pending' | 'approved' | 'rejected'); omit for all.
 */
function getLinkRequests({ status } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('r.status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT r.*,
           g.name  AS group_name,
           g.color AS group_color,
           s.name  AS section_name,
           s.parent_section_id AS parent_section_id,
           p.name  AS parent_section_name
    FROM link_requests r
    LEFT JOIN groups   g ON g.id = r.group_id
    LEFT JOIN sections s ON s.id = r.section_id
    LEFT JOIN sections p ON p.id = s.parent_section_id
    ${clause}
    ORDER BY r.id DESC
  `).all(...params);
}

function getLinkRequestById(id) {
  return db.prepare('SELECT * FROM link_requests WHERE id = ?').get(id);
}

/**
 * Updates a request's status and stamps reviewed_at. When approving, pass
 * { linkId } to record the published link's id.
 */
function setLinkRequestStatus(id, status, { linkId } = {}) {
  return db.prepare(`
    UPDATE link_requests
    SET status = ?, reviewed_at = CURRENT_TIMESTAMP, created_link_id = ?
    WHERE id = ?
  `).run(status, Number.isFinite(linkId) ? linkId : null, id);
}

function deleteLinkRequest(id) {
  return db.prepare('DELETE FROM link_requests WHERE id = ?').run(id);
}

/** Count of pending requests — powers the admin badge. */
function countPendingRequests() {
  return db.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE status = 'pending'").get().n;
}

module.exports = {
  createLinkRequest, getLinkRequests, getLinkRequestById, setLinkRequestStatus,
  deleteLinkRequest, countPendingRequests,
};
