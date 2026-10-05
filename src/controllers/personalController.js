// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * A signed-in member's own links, groups and sections — /api/my/*.
 *
 * Every handler here works on `req.user.id` and nothing else. No route takes an
 * owner from the request, so there is no parameter to tamper with: the only
 * way to reach somebody's content is to be signed in as them. Ids in the path
 * are always looked up together with that owner, and a miss is a 404 — the
 * same answer for "no such link" and "not your link", because telling those
 * apart confirms the other person's link exists.
 *
 * The admin token reaches none of this. It has no account, so it has no
 * personal links, and requireMember turns it away rather than letting
 * `req.user.id` be null somewhere it would be used as an owner.
 */

const fs   = require('fs');
const path = require('path');

const db = require('../models');
const { isValidHttpUrl, isValidHexColor } = require('../utils/http');
const {
  MAX_USER_LINKS, MAX_USER_GROUPS, MAX_USER_SECTIONS,
} = require('../config/constants');
const {
  PERSONAL_ICON_LIMIT, resolvePrivateFilePath, deletePrivateFiles,
} = require('../services/privateFiles');
const { storageSummary, fitsInQuota, cachePersonalFavicon } =
  require('../services/personalStorage');
const { renderMarkdown } = require('../services/markdownService');
const { renderMarkdownPage, MARKDOWN_CSP, instancePalette } = require('../services/markdownPage');
const { visibleSharedLinks } = require('../services/linkService');

const DEFAULT_COLOR = '#0071e3';

// ─── Guards and helpers ───────────────────────────────────────────────────────

/**
 * Personal content belongs to an account. The admin token is not one, and a
 * null owner id is exactly the value that must never reach these queries.
 */
function requireMember(req, res, next) {
  if (req.user?.via === 'session' && Number.isInteger(req.user.id)) return next();
  res.status(401).json({ error: 'Sign in to keep your own links', code: 'auth_required' });
}

const owner = req => req.user.id;
const idParam = req => Number.parseInt(req.params.id, 10);

/** Throws away whatever multer already wrote, when the request is refused. */
function discardUploads(req) {
  const files = [...(req.files?.image || []), ...(req.files?.file || [])];
  return deletePrivateFiles(files.map(f => f.filename));
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** An id list for a reorder, or null when the body is not one. */
function orderFrom(body) {
  const order = body?.order;
  if (!Array.isArray(order) || order.length > 5000) return null;
  const ids = order.map(Number);
  return ids.every(n => Number.isInteger(n) && n > 0) ? ids : null;
}

/** The group assignments a link form sent, as `[{ group_id, section_id }]`. */
function parseAssignments(raw) {
  if (raw === undefined) return undefined;          // not sent: leave them be
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Everything at once ───────────────────────────────────────────────────────

/**
 * The whole of this person's personal content in one response, so the public
 * page can merge it with the shared set in a single request.
 */
function data(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({
    groups:    db.getPersonalGroups(owner(req)),
    links:     db.getPersonalLinks(owner(req)),
    storage:   storageSummary(owner(req)),
    // Ids of shared links, which the page already has; sending the ids rather
    // than the links keeps the shared listing the only place shared links come
    // from, and saves the page a third request.
    favorites: visibleFavoriteIds(req),
  });
}

function storage(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json(storageSummary(owner(req)));
}

/**
 * The shared icon library, read-only, so a member can pick one of the icons
 * the administrator has curated. Those images are already public under
 * /uploads; listing them gives nothing away.
 */
function icons(req, res) {
  res.json({ icons: db.getAllIcons().map(i => ({ id: i.id, file_path: i.file_path })) });
}

/**
 * The icon a web address would get, before the link is saved — so the person
 * adding it can see what they are about to get, and upload their own instead
 * if they would rather.
 *
 * Fetched by this server under exactly the rules a saved link's favicon is:
 * public addresses only, and never through Google. Answered with the image
 * itself, stored nowhere, and costing nothing against the allowance.
 */
async function faviconPreview(req, res) {
  const { fetchFaviconForUrl } = require('../services/faviconService');
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url || !isValidHttpUrl(url)) return res.status(400).json({ error: 'Send a web address' });

  let found = null;
  try { found = await fetchFaviconForUrl(url, { member: true }); } catch { found = null; }

  const type = String(found?.contentType || '').split(';')[0].trim().toLowerCase();
  // The same image types a saved favicon may be. SVG is a document that can
  // carry script, and this response comes from the admin panel's own origin.
  const allowed = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon',
                   'image/gif', 'image/webp', 'image/jpeg'];
  if (!found?.buffer || !allowed.includes(type)) {
    return res.status(404).json({ error: 'No icon found for that address' });
  }

  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(type).send(found.buffer);
}

// ─── Favourites ───────────────────────────────────────────────────────────────

/**
 * This person's favourites that they may still see, in their order.
 *
 * Filtered on every read. A favourite points at a shared link, and the
 * administrator can hide it, delete it, or move it behind a password at any
 * time — the star must never become a way round that. Run through the exact
 * rule the public listing uses, so a favourite can never show a link the
 * listing would not.
 */
function visibleFavoriteIds(req) {
  const visible = new Set(visibleSharedLinks(req).map(l => l.id));
  return db.getFavoriteIds(owner(req)).filter(id => visible.has(id));
}

function favorites(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ link_ids: visibleFavoriteIds(req) });
}

/**
 * Stars a shared link. Only one this person can currently see: otherwise the
 * star would confirm that a hidden or locked link with that id exists.
 */
function addFavorite(req, res) {
  const linkId = Number.parseInt(req.params.linkId, 10);
  if (!visibleSharedLinks(req).some(l => l.id === linkId)) {
    return res.status(404).json({ error: 'No such link' });
  }
  db.addFavorite(owner(req), linkId);
  res.json({ ok: true, link_ids: visibleFavoriteIds(req) });
}

/** Unstars a link. Always allowed, and harmless when it was not starred. */
function removeFavorite(req, res) {
  db.removeFavorite(owner(req), Number.parseInt(req.params.linkId, 10));
  res.json({ ok: true, link_ids: visibleFavoriteIds(req) });
}

function reorderFavorites(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderFavorites(owner(req), ids);
  res.json({ ok: true, link_ids: visibleFavoriteIds(req) });
}

// ─── Groups ───────────────────────────────────────────────────────────────────

function createGroup(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A group needs a name' });
  if (db.countPersonalGroups(owner(req)) >= MAX_USER_GROUPS) {
    return res.status(409).json({ error: `You can have up to ${MAX_USER_GROUPS} groups`, code: 'limit_reached' });
  }
  const color = isValidHexColor(req.body?.color) ? req.body.color : DEFAULT_COLOR;
  res.status(201).json(db.createPersonalGroup(owner(req), { name, color }));
}

function updateGroup(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A group needs a name' });
  const color = isValidHexColor(req.body?.color) ? req.body.color : DEFAULT_COLOR;

  const group = db.updatePersonalGroup(owner(req), idParam(req), { name, color });
  if (!group) return res.status(404).json({ error: 'No such group' });
  res.json(group);
}

function deleteGroup(req, res) {
  if (!db.deletePersonalGroup(owner(req), idParam(req))) {
    return res.status(404).json({ error: 'No such group' });
  }
  res.json({ ok: true });
}

function reorderGroups(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderPersonalGroups(owner(req), ids);
  res.json({ ok: true });
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function createSection(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A section needs a name' });
  if (db.countPersonalSections(owner(req)) >= MAX_USER_SECTIONS) {
    return res.status(409).json({ error: `You can have up to ${MAX_USER_SECTIONS} sections`, code: 'limit_reached' });
  }

  const parentRaw = req.body?.parent_section_id;
  const parentSectionId = parentRaw === undefined || parentRaw === null || parentRaw === ''
    ? null : Number(parentRaw);

  const section = db.createPersonalSection(owner(req), idParam(req), { name, parentSectionId });
  // Not this person's group, not their parent section, or a parent that is
  // itself a subsection. One answer for all of it.
  if (!section) return res.status(404).json({ error: 'No such group or section' });
  res.status(201).json(section);
}

function updateSection(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A section needs a name' });
  const section = db.renamePersonalSection(owner(req), idParam(req), name);
  if (!section) return res.status(404).json({ error: 'No such section' });
  res.json(section);
}

function deleteSection(req, res) {
  if (!db.deletePersonalSection(owner(req), idParam(req))) {
    return res.status(404).json({ error: 'No such section' });
  }
  res.json({ ok: true });
}

function reorderSections(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderPersonalSections(owner(req), ids);
  res.json({ ok: true });
}

// ─── Links ────────────────────────────────────────────────────────────────────

/**
 * Validates the text half of a link form. Returns an error message, or null.
 * A link is a URL, or an attached file — never neither.
 */
function linkProblem({ name, url, hasFile }) {
  if (!name) return 'A link needs a name';
  if (!hasFile && !url) return 'A link needs a web address or a file';
  if (url && !isValidHttpUrl(url)) return 'That web address is not valid — it should start with http:// or https://';
  return null;
}

/** A library icon's public path, given its id. Never a path from the request. */
function libraryIconPath(iconIdField) {
  const id = Number.parseInt(iconIdField, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.getIconById(id)?.file_path || null;
}

/**
 * Checks what the upload would cost against the person's quota, counting what
 * it frees by replacing. Answers 413 itself and returns false when it does not
 * fit; the caller only has to stop.
 */
function quotaCheck(req, res, freed) {
  const image = req.files?.image?.[0];
  const file  = req.files?.file?.[0];

  if (image && image.size > PERSONAL_ICON_LIMIT) {
    res.status(400).json({ error: 'An icon must be under 2 MB' });
    return false;
  }

  const incoming = (image?.size || 0) + (file?.size || 0);
  if (incoming > 0 && !fitsInQuota(owner(req), incoming, freed)) {
    res.status(413).json({
      error:   'That would take you over your storage allowance',
      code:    'quota_exceeded',
      storage: storageSummary(owner(req)),
    });
    return false;
  }
  return true;
}

async function createLink(req, res) {
  const me    = owner(req);
  const image = req.files?.image?.[0];
  const file  = req.files?.file?.[0];

  const name        = cleanText(req.body?.name, 200);
  const url         = file ? '' : cleanText(req.body?.url, 2048);
  const description = cleanText(req.body?.description, 1000) || null;

  const problem = linkProblem({ name, url, hasFile: !!file });
  if (problem) { await discardUploads(req); return res.status(400).json({ error: problem }); }

  if (db.countPersonalLinks(me) >= MAX_USER_LINKS) {
    await discardUploads(req);
    return res.status(409).json({ error: `You can have up to ${MAX_USER_LINKS} links`, code: 'limit_reached' });
  }
  if (!quotaCheck(req, res, 0)) { await discardUploads(req); return; }

  const id = db.createPersonalLink(me, {
    name, url, description,
    imagePath: image ? null : libraryIconPath(req.body?.icon_id),
  });

  if (image) db.setPersonalLinkFile(me, id, 'icon', { file: image.filename, bytes: image.size });
  if (file) {
    db.setPersonalLinkFile(me, id, 'attachment', {
      file: file.filename, bytes: file.size, fileName: file.originalname,
    });
  }

  const assignments = parseAssignments(req.body?.groups);
  if (assignments) db.setPersonalLinkGroups(me, id, assignments);

  // An icon nobody chose, fetched after answering: the person should not wait
  // on somebody else's web server to see their link appear.
  if (url && !image && !libraryIconPath(req.body?.icon_id)) {
    cachePersonalFavicon(me, id, url);
  }

  res.status(201).json(db.getPersonalLink(me, id));
}

async function updateLink(req, res) {
  const me    = owner(req);
  const id    = idParam(req);
  const image = req.files?.image?.[0];
  const file  = req.files?.file?.[0];

  const before = db.getPersonalLinkRow(me, id);
  if (!before) { await discardUploads(req); return res.status(404).json({ error: 'No such link' }); }

  const removeFile  = req.body?.remove_file === '1' || req.body?.remove_file === true;
  const removeImage = req.body?.remove_image === '1' || req.body?.remove_image === true;
  const keepsFile   = !!file || (!!before.attachment_file && !removeFile);

  const name        = cleanText(req.body?.name, 200);
  const url         = keepsFile ? '' : cleanText(req.body?.url, 2048);
  const description = cleanText(req.body?.description, 1000) || null;

  const problem = linkProblem({ name, url, hasFile: keepsFile });
  if (problem) { await discardUploads(req); return res.status(400).json({ error: problem }); }

  const freed = (image || removeImage || req.body?.icon_id ? before.icon_bytes : 0)
              + (file || removeFile ? before.attachment_bytes : 0);
  if (!quotaCheck(req, res, freed)) { await discardUploads(req); return; }

  db.updatePersonalLink(me, id, { name, url, description });
  const stale = [];

  if (image) {
    stale.push(db.setPersonalLinkFile(me, id, 'icon', { file: image.filename, bytes: image.size }));
  } else if (req.body?.icon_id) {
    stale.push(db.setPersonalLinkLibraryIcon(me, id, libraryIconPath(req.body.icon_id)));
  } else if (removeImage) {
    stale.push(db.setPersonalLinkLibraryIcon(me, id, null));
  }

  if (file) {
    stale.push(db.setPersonalLinkFile(me, id, 'attachment', {
      file: file.filename, bytes: file.size, fileName: file.originalname,
    }));
  } else if (removeFile) {
    stale.push(db.setPersonalLinkFile(me, id, 'attachment', { file: null }));
  }

  // A favicon belongs to a URL. When the URL changes, or the link stops having
  // one, the old icon is wrong.
  if (url !== before.url && before.favicon_file) {
    stale.push(db.setPersonalLinkFile(me, id, 'favicon', { file: null }));
  }

  const assignments = parseAssignments(req.body?.groups);
  if (assignments) db.setPersonalLinkGroups(me, id, assignments);

  await deletePrivateFiles(stale.filter(Boolean));

  const after = db.getPersonalLinkRow(me, id);
  if (url && url !== before.url && !after.icon_file && !after.image_path) {
    cachePersonalFavicon(me, id, url);
  }

  res.json(db.getPersonalLink(me, id));
}

async function deleteLink(req, res) {
  const files = db.deletePersonalLink(owner(req), idParam(req));
  if (!files) return res.status(404).json({ error: 'No such link' });
  await deletePrivateFiles(files);
  res.json({ ok: true });
}

function reorderLinks(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderPersonalLinks(owner(req), ids);
  res.json({ ok: true });
}

// ─── The files themselves ─────────────────────────────────────────────────────

/** Headers every private file is served with. */
function privateHeaders(res) {
  // Not shared caches, not the back/forward cache of a browser somebody else
  // sits at next: this response belongs to one signed-in person.
  res.set('Cache-Control', 'private, no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
}

/** The ASCII-safe filename for Content-Disposition, as the shared route does it. */
const dispositionName = name =>
  path.basename(name || 'file').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

function sendPrivate(res, filename, { downloadName, inline = true } = {}) {
  const full = resolvePrivateFilePath(filename);
  if (!full || !fs.existsSync(full)) return res.status(404).json({ error: 'No such file' });

  privateHeaders(res);
  const headers = {};
  if (downloadName) {
    headers['Content-Disposition'] = `${inline ? 'inline' : 'attachment'}; filename="${dispositionName(downloadName)}"`;
  }
  res.sendFile(full, { headers }, err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'No such file' });
  });
}

function icon(req, res) {
  const row = db.getPersonalLinkRow(owner(req), idParam(req));
  if (!row?.icon_file) return res.status(404).json({ error: 'No such file' });
  sendPrivate(res, row.icon_file);
}

function favicon(req, res) {
  const row = db.getPersonalLinkRow(owner(req), idParam(req));
  if (!row?.favicon_file) return res.status(404).json({ error: 'No such file' });
  sendPrivate(res, row.favicon_file);
}

/**
 * Serves a personal attachment. A markdown file is rendered as a page under
 * the same no-script policy shared documents get; anything else is streamed
 * with its original name.
 */
function file(req, res) {
  const row = db.getPersonalLinkRow(owner(req), idParam(req));
  if (!row?.attachment_file) return res.status(404).json({ error: 'No such file' });

  const isMarkdown = path.extname(row.file_name || '').toLowerCase() === '.md';
  if (isMarkdown && req.query.raw !== '1') {
    const full = resolvePrivateFilePath(row.attachment_file);
    let source;
    try { source = fs.readFileSync(full, 'utf8'); }
    catch { return res.status(404).json({ error: 'No such file' }); }

    privateHeaders(res);
    res.setHeader('Content-Security-Policy', MARKDOWN_CSP);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    return res.type('html').send(renderMarkdownPage({
      title:   row.name,
      body:    renderMarkdown(source),
      theme:   req.query.theme,
      embed:   req.query.embed === '1',
      palette: instancePalette(),
    }));
  }

  sendPrivate(res, row.attachment_file, { downloadName: row.file_name });
}

module.exports = {
  requireMember,
  data, storage, icons, faviconPreview,
  favorites, addFavorite, removeFavorite, reorderFavorites,
  createGroup, updateGroup, deleteGroup, reorderGroups,
  createSection, updateSection, deleteSection, reorderSections,
  createLink, updateLink, deleteLink, reorderLinks,
  icon, favicon, file,
};
