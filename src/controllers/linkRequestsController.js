// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Link requests: public submission (gated by feature flag + optional password)
 * and admin review (list / approve / reject / delete).
 */

const db = require('../models');
const { getClientIp, isValidHttpUrl } = require('../utils/http');
const { requestAuthLimiter } = require('../middleware/rateLimit');
const { resolveIconReference } = require('../services/uploadService');
const { truncate } = require('../services/auditService');

/** True when the public "Request link" feature is switched on. */
function requestsEnabled() {
  return db.readSetting('requests_enabled') === '1';
}

// ─── Public submit ────────────────────────────────────────────────────────────

function submit(req, res) {
  if (!requestsEnabled()) {
    return res.status(403).json({ error: 'Link requests are not enabled' });
  }

  // Optional password gate (scrypt hash stored in settings).
  const requestPasswordHash = db.readSetting('request_password');
  if (requestPasswordHash) {
    if (requestAuthLimiter.isLimited(req)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    const provided = req.headers['x-request-password'] || '';
    if (!db.verifyScryptHash(requestPasswordHash, provided)) {
      requestAuthLimiter.recordFailure(req);
      return res.status(401).json({ error: 'Password required' });
    }
  }

  const { name, url, description, group_id, section_id } = req.body;
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!trimmedUrl || !isValidHttpUrl(trimmedUrl)) {
    return res.status(400).json({ error: 'A valid http:// or https:// URL is required' });
  }

  // Group is required and must exist.
  const groupId = Number(group_id);
  if (!Number.isFinite(groupId) || groupId <= 0 || !db.getGroupById(groupId)) {
    return res.status(400).json({ error: 'Please choose a valid group' });
  }

  // Subsection is optional; if given it must belong to the chosen group.
  let sectionId = null;
  if (section_id != null && section_id !== '') {
    const sid     = Number(section_id);
    const section = Number.isFinite(sid) ? db.getSectionById(sid) : null;
    if (!section || section.group_id !== groupId) {
      return res.status(400).json({ error: 'Selected section does not belong to the chosen group' });
    }
    sectionId = sid;
  }

  const imagePath = resolveIconReference({ imageFile: req.file || null });

  const result = db.createLinkRequest({
    name:        name.trim(),
    url:         trimmedUrl,
    description: description?.trim() || null,
    imagePath,
    groupId,
    sectionId,
    ipAddress:   getClientIp(req),
  });

  res.status(201).json({ id: result.lastInsertRowid, ok: true });
}

// ─── Admin review ─────────────────────────────────────────────────────────────

function list(req, res) {
  const status   = req.query.status === 'all' ? undefined : (req.query.status || 'pending');
  const requests = db.getLinkRequests({ status });
  // Attach the icon library id so the admin's prefill flow can preselect it.
  const decorated = requests.map(r => ({
    ...r,
    icon_id: r.image_path ? (db.getIconByPath(r.image_path)?.id ?? null) : null,
  }));
  res.json({ pending_count: db.countPendingRequests(), requests: decorated });
}

function approve(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const linkId = Number(req.body.link_id);
  db.setLinkRequestStatus(request.id, 'approved', {
    linkId: Number.isFinite(linkId) ? linkId : undefined,
  });
  req._auditSummary = `Approved link request "${truncate(request.name)}"`;
  res.json({ ok: true });
}

function reject(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  db.setLinkRequestStatus(request.id, 'rejected');
  req._auditSummary = `Rejected link request "${truncate(request.name)}"`;
  res.json({ ok: true });
}

function remove(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  db.deleteLinkRequest(request.id);
  req._auditSummary = `Deleted link request "${truncate(request.name)}"`;
  res.status(204).end();
}

module.exports = { submit, list, approve, reject, remove };
