// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Link requests: public submission (gated by feature flag + optional password)
 * and admin review (list / approve / reject / delete).
 */

const fs = require('fs');

const db = require('../models');
const { getClientIp, isValidHttpUrl, normalizeUrlForCompare } = require('../utils/http');
const { requestAuthLimiter } = require('../middleware/rateLimit');
const { resolveIconReference, safeDeleteFile,
        resolveStoredFilePath } = require('../services/uploadService');
const { getUnlockedGroupIds } = require('../utils/groupCrypto');
const { filterVisibleLinks } = require('../services/linkService');
const { truncate } = require('../services/auditService');

/** True when the public "Request link" feature is switched on. */
function requestsEnabled() {
  return db.readSetting('requests_enabled') === '1';
}

// ─── Public submit ────────────────────────────────────────────────────────────

/** What a visitor may ask for. Anything else is rejected outright. */
const REQUEST_KINDS = new Set(['link', 'file', 'change']);

/**
 * Deletes anything multer already wrote for a submission we are about to
 * refuse. Without it a rejected request would still leave its bytes behind —
 * and this is the one upload path an unauthenticated visitor can reach.
 */
function discardRequestUploads(req) {
  for (const file of [...(req.files?.image || []), ...(req.files?.file || [])]) {
    safeDeleteFile(`/uploads/${file.filename}`);
  }
}

/** The single image the visitor attached as an icon, if any. */
function requestIconFile(req) {
  return req.files?.image?.[0] || null;
}

/**
 * Validates the group (always required) and the optional section beneath it.
 * Returns { groupId, sectionId } or { error }.
 */
function resolveRequestTarget({ group_id, section_id }) {
  const groupId = Number(group_id);
  if (!Number.isFinite(groupId) || groupId <= 0 || !db.getGroupById(groupId)) {
    return { error: 'Please choose a valid group' };
  }

  let sectionId = null;
  if (section_id != null && section_id !== '') {
    const sid     = Number(section_id);
    const section = Number.isFinite(sid) ? db.getSectionById(sid) : null;
    if (!section || section.group_id !== groupId) {
      return { error: 'Selected section does not belong to the chosen group' };
    }
    sectionId = sid;
  }
  return { groupId, sectionId };
}

/**
 * The links this particular visitor is allowed to see, and therefore the only
 * ones they may propose a change to. Hidden links are out; a link in a
 * protected group is in only once that group has been unlocked in this session.
 */
function linksVisibleTo(req) {
  const visible = db.getAllLinks().filter(l => !l.is_hidden);
  return filterVisibleLinks(visible, db.getAllGroups(), getUnlockedGroupIds(req));
}

function submit(req, res) {
  if (!requestsEnabled()) {
    discardRequestUploads(req);
    return res.status(403).json({ error: 'Link requests are not enabled' });
  }

  // Optional password gate (scrypt hash stored in settings).
  const requestPasswordHash = db.readSetting('request_password');
  if (requestPasswordHash) {
    if (requestAuthLimiter.isLimited(req)) {
      discardRequestUploads(req);
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    const provided = req.headers['x-request-password'] || '';
    if (!db.verifyScryptHash(requestPasswordHash, provided)) {
      requestAuthLimiter.recordFailure(req);
      discardRequestUploads(req);
      return res.status(401).json({ error: 'Password required' });
    }
  }

  const kind = (typeof req.body.kind === 'string' && req.body.kind.trim()) || 'link';
  if (!REQUEST_KINDS.has(kind)) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'Unknown request type' });
  }

  if (kind === 'file')   return submitFileRequest(req, res);
  if (kind === 'change') return submitChangeRequest(req, res);
  return submitLinkRequest(req, res);
}

/** "Please publish this URL" — the original request shape. */
function submitLinkRequest(req, res) {
  const { name, url, description } = req.body;
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!name?.trim()) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!trimmedUrl || !isValidHttpUrl(trimmedUrl)) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'A valid http:// or https:// URL is required' });
  }

  const target = resolveRequestTarget(req.body);
  if (target.error) {
    discardRequestUploads(req);
    return res.status(400).json({ error: target.error });
  }

  const result = db.createLinkRequest({
    kind:        'link',
    name:        name.trim(),
    url:         trimmedUrl,
    description: description?.trim() || null,
    imagePath:   resolveIconReference({ imageFile: requestIconFile(req) }),
    groupId:     target.groupId,
    sectionId:   target.sectionId,
    ipAddress:   getClientIp(req),
  });

  res.status(201).json({ id: result.lastInsertRowid, ok: true });
}

/**
 * "Here is a file, please publish it." The upload is kept as-is; approving the
 * request hands that exact file to the new link, so nothing is ever copied.
 * Any `url` the client sends is ignored — a file request has no URL.
 */
function submitFileRequest(req, res) {
  const { name, description } = req.body;
  const attached = req.files?.file?.[0] || null;

  if (!name?.trim()) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!attached) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'Please attach a file' });
  }

  const target = resolveRequestTarget(req.body);
  if (target.error) {
    discardRequestUploads(req);
    return res.status(400).json({ error: target.error });
  }

  const result = db.createLinkRequest({
    kind:        'file',
    name:        name.trim(),
    url:         '',
    description: description?.trim() || null,
    imagePath:   resolveIconReference({ imageFile: requestIconFile(req) }),
    groupId:     target.groupId,
    sectionId:   target.sectionId,
    filePath:    `/uploads/${attached.filename}`,
    fileName:    attached.originalname,
    ipAddress:   getClientIp(req),
  });

  res.status(201).json({ id: result.lastInsertRowid, ok: true });
}

/**
 * "Please change this link." Only fields the visitor actually filled in are
 * stored, and only fields that really differ count as a change — so the admin
 * sees a diff, never a re-statement of what is already there.
 */
function submitChangeRequest(req, res) {
  const { target_link_id, name, url, description, note } = req.body;
  const attached = req.files?.file?.[0] || null;

  const targetId = Number(target_link_id);
  const target   = Number.isFinite(targetId)
    ? linksVisibleTo(req).find(l => l.id === targetId)
    : null;
  if (!target) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'Please choose a link to change' });
  }

  // A replacement file only makes sense for a link that already holds one:
  // correcting a document is a correction, turning a URL into a download is a
  // restructure, and that stays the admin's call.
  if (attached && !target.file_path) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'This link points at a URL, so a file cannot replace it' });
  }

  const proposedName = typeof name        === 'string' ? name.trim()        : '';
  const proposedUrl  = typeof url         === 'string' ? url.trim()         : '';
  const proposedDesc = typeof description === 'string' ? description.trim() : '';

  // A file-backed link's url is its stored path, which a visitor has no
  // business rewriting — the rest of the fields are still fair game.
  if (proposedUrl) {
    if (target.file_path) {
      discardRequestUploads(req);
      return res.status(400).json({ error: 'This link points at a file, so its URL cannot be changed' });
    }
    if (!isValidHttpUrl(proposedUrl)) {
      discardRequestUploads(req);
      return res.status(400).json({ error: 'A proposed URL must start with http:// or https://' });
    }
  }

  // Store only what differs; everything else stays null and is left alone on
  // apply. If nothing differs there is nothing to review.
  const changedName = proposedName && proposedName !== target.name               ? proposedName : null;
  const changedUrl  = proposedUrl  && proposedUrl  !== target.url                ? proposedUrl  : null;
  const changedDesc = proposedDesc && proposedDesc !== (target.description || '') ? proposedDesc : null;

  if (!changedName && !changedUrl && !changedDesc && !attached) {
    discardRequestUploads(req);
    return res.status(400).json({ error: 'Nothing would change — edit at least one field' });
  }

  const result = db.createLinkRequest({
    kind:         'change',
    name:         changedName ?? target.name,   // name is NOT NULL; fall back to the current one
    url:          changedUrl  ?? '',
    description:  changedDesc,
    imagePath:    resolveIconReference({ imageFile: requestIconFile(req) }),
    targetLinkId: target.id,
    // The proposed replacement, kept apart from the live file until the admin
    // applies the change.
    filePath:     attached ? `/uploads/${attached.filename}` : null,
    fileName:     attached ? attached.originalname            : null,
    note:         typeof note === 'string' && note.trim() ? note.trim() : null,
    ipAddress:    getClientIp(req),
  });

  res.status(201).json({ id: result.lastInsertRowid, ok: true });
}

// ─── Admin review ─────────────────────────────────────────────────────────────

/** Builds a normalised-URL → link index over every URL-backed link. */
function buildUrlIndex() {
  const index = new Map();
  for (const link of db.getLinkUrlIndex()) {
    const key = normalizeUrlForCompare(link.url);
    if (key && !index.has(key)) index.set(key, link);
  }
  return index;
}

/** The already-published link a request URL points at, or null. */
function findExistingLinkForUrl(url, index = buildUrlIndex()) {
  const key = normalizeUrlForCompare(url);
  return key ? (index.get(key) ?? null) : null;
}

/** Public shape of a matched link: enough for the admin to decide what to do. */
function describeExistingLink(link) {
  return {
    id:     link.id,
    name:   link.name,
    url:    link.url,
    groups: (db.getLinkById(link.id)?.groups ?? [])
      .map(g => ({ id: g.id, name: g.name, section_id: g.section_id ?? null })),
  };
}

/** Size on disk of a stored upload, or null when it has gone missing. */
function fileSizeOf(storedPath) {
  const full = resolveStoredFilePath(storedPath);
  if (!full) return null;
  try { return fs.statSync(full).size; } catch { return null; }
}

function list(req, res) {
  const status   = req.query.status === 'all' ? undefined : (req.query.status || 'pending');
  const requests = db.getLinkRequests({ status });

  // Index existing links by normalised URL once, so the reviewer can see at a
  // glance whether a request points at a link that's already published.
  const urlIndex = buildUrlIndex();

  const decorated = requests.map(r => {
    const match = findExistingLinkForUrl(r.url, urlIndex);
    return {
      ...r,
      // Icon library id, so the admin's prefill flow can preselect it.
      icon_id: r.image_path ? (db.getIconByPath(r.image_path)?.id ?? null) : null,
      // So the reviewer sees how big an upload is before opening it.
      file_size: r.file_path ? fileSizeOf(r.file_path) : null,
      existing_link: match ? describeExistingLink(match) : null,
    };
  });

  res.json({ pending_count: db.countPendingRequests(), requests: decorated });
}

/**
 * Approves a request without creating a duplicate: the link that already has
 * this URL simply joins the requested group (and section, when it belongs to
 * that group). The request is marked approved and points at that link.
 */
function attachToExisting(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const match = findExistingLinkForUrl(request.url);
  if (!match) {
    return res.status(409).json({ error: 'No existing link matches this request URL' });
  }

  const groupId = Number(request.group_id);
  if (!Number.isFinite(groupId) || !db.getGroupById(groupId)) {
    return res.status(400).json({ error: 'This request has no valid group to add' });
  }

  // Only honour the requested section when it really belongs to that group.
  let sectionId = null;
  if (request.section_id != null) {
    const section = db.getSectionById(request.section_id);
    if (section && section.group_id === groupId) sectionId = section.id;
  }

  const { added } = db.addLinkGroup(match.id, groupId, sectionId);
  db.setLinkRequestStatus(request.id, 'approved', { linkId: match.id });

  req._auditSummary = added
    ? `Approved link request "${truncate(request.name)}" by adding the existing link "${truncate(match.name)}" to another group`
    : `Approved link request "${truncate(request.name)}" — existing link "${truncate(match.name)}" was already in that group`;

  res.json({ ok: true, added, link: db.getLinkById(match.id) });
}

function approve(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  // A file request carries everything the link needs, so approving it is the
  // publish: the new link takes over the very upload the visitor sent.
  if (request.kind === 'file' && request.file_path && !request.created_link_id) {
    return publishFileRequest(req, res, request);
  }

  const linkId = Number(req.body.link_id);
  db.setLinkRequestStatus(request.id, 'approved', {
    linkId: Number.isFinite(linkId) ? linkId : undefined,
  });
  req._auditSummary = `Approved link request "${truncate(request.name)}"`;
  res.json({ ok: true });
}

/** Creates the link a file request asked for and marks the request approved. */
function publishFileRequest(req, res, request) {
  const groupId = Number(request.group_id);
  if (!Number.isFinite(groupId) || !db.getGroupById(groupId)) {
    return res.status(400).json({ error: 'This request has no valid group to publish into' });
  }

  // Honour the requested section only while it still belongs to that group.
  let sectionId = null;
  if (request.section_id != null) {
    const section = db.getSectionById(request.section_id);
    if (section && section.group_id === groupId) sectionId = section.id;
  }

  const result = db.createLink({
    name:        request.name,
    // File-backed links mirror the stored path into `url` so /r/:id has a
    // uniform redirect target (see linksController.create).
    url:         request.file_path,
    description: request.description || null,
    imagePath:   request.image_path || null,
    groupIds:    [{ group_id: groupId, section_id: sectionId }],
    filePath:    request.file_path,
    fileName:    request.file_name,
  });

  const linkId = result.lastInsertRowid;
  db.setLinkRequestStatus(request.id, 'approved', { linkId });

  req._auditSummary = `Approved file request "${truncate(request.name)}" and published it`;
  res.json({ ok: true, link: db.getLinkById(linkId) });
}

/**
 * Applies a change request: whatever the visitor proposed is written onto the
 * target link, and anything they left blank keeps its current value.
 */
function applyChange(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.kind !== 'change') {
    return res.status(400).json({ error: 'This is not a change request' });
  }

  const link = db.getLinkById(request.target_link_id);
  if (!link) {
    return res.status(409).json({ error: 'The link this request targets no longer exists' });
  }

  const name        = request.name        || link.name;
  const description = request.description || link.description || null;

  // A proposed file takes over, and a file-backed link mirrors its path into
  // `url` so /r/:id keeps a uniform redirect target.
  const replacingFile = !!request.file_path;
  const url = replacingFile ? request.file_path : (request.url || link.url);
  const replacedFile  = replacingFile ? link.file_path : null;

  db.updateLink(link.id, {
    name,
    url,
    description,
    // Everything else is left exactly as it is: groups and icon are the
    // admin's business, not something a visitor can propose.
    imagePath:   null,
    groupIds:    undefined,
    removeImage: false,
    filePath:    replacingFile ? request.file_path : undefined,
    fileName:    replacingFile ? request.file_name : undefined,
  });

  // Only once the link is pointing at the new bytes — matching what an admin
  // edit does when it swaps an attachment. This is not undoable.
  if (replacedFile && replacedFile !== request.file_path) {
    safeDeleteFile(replacedFile);
  }

  db.setLinkRequestStatus(request.id, 'approved', { linkId: link.id });

  req._auditSummary = `Applied change request to "${truncate(link.name)}"`;
  res.json({ ok: true, link: db.getLinkById(link.id) });
}

/**
 * Deletes the file a request uploaded, unless it has already been used — once a
 * link points at those bytes (published from a file request, or applied as a
 * replacement), the link's own lifecycle governs them.
 * Not undoable: rejecting a file discards it.
 */
function discardRequestFile(request) {
  if (!request.file_path) return;
  if (request.created_link_id) return;
  safeDeleteFile(request.file_path);
}

function reject(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  discardRequestFile(request);
  db.setLinkRequestStatus(request.id, 'rejected');
  req._auditSummary = `Rejected link request "${truncate(request.name)}"`;
  res.json({ ok: true });
}

function remove(req, res) {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  discardRequestFile(request);
  db.deleteLinkRequest(request.id);
  req._auditSummary = `Deleted link request "${truncate(request.name)}"`;
  res.status(204).end();
}

module.exports = { submit, list, attachToExisting, approve, applyChange, reject, remove };
