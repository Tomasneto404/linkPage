// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Guest contributions: endpoints parallel to /api/my/*, scoped to the browser
 * holding the lp_guest cookie.
 *
 * The handlers are a near-mirror of personalController. Separate on purpose:
 * mixing guest and member ownership through one path has to decide which
 * owner each read and write means at every step; keeping them apart means the
 * guest tables are the only tables these handlers touch.
 */

const db = require('../models');
const { isValidHttpUrl, isValidHexColor } = require('../utils/http');
const {
  MAX_USER_LINKS, MAX_USER_GROUPS, MAX_USER_SECTIONS,
} = require('../config/constants');
const { storageSummary, fitsInQuota, cacheGuestFavicon } = require('../services/guestStorage');
const {
  deletePrivateFiles, resolvePrivateFilePath, PERSONAL_ICON_LIMIT,
} = require('../services/privateFiles');
const { fetchFaviconForUrl } = require('../services/faviconService');
const { renderMarkdown } = require('../services/markdownService');
const { renderMarkdownPage, MARKDOWN_CSP, instancePalette } = require('../services/markdownPage');

const DEFAULT_COLOR = '#0071e3';
const owner = req => req.guest.id;
const idParam = req => Number.parseInt(req.params.id, 10);

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function orderFrom(body) {
  const order = body?.order;
  if (!Array.isArray(order) || order.length > 5000) return null;
  const ids = order.map(Number);
  return ids.every(n => Number.isInteger(n) && n > 0) ? ids : null;
}
function parseAssignments(raw) {
  if (raw === undefined) return undefined;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
async function discardUploads(req) {
  const files = [...(req.files?.image || []), ...(req.files?.file || [])];
  return deletePrivateFiles(files.map(f => f.filename));
}

// ─── Everything at once ───────────────────────────────────────────────────────

function data(req, res) {
  res.set('Cache-Control', 'private, no-store');
  if (!req.guest) return res.json({ groups: [], links: [], storage: null });
  res.json({
    guest_id: req.guest.id,
    groups:   db.getGuestGroups(req.guest.id),
    links:    db.getGuestLinks(req.guest.id),
    storage:  storageSummary(req.guest.id),
  });
}

function storage(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json(storageSummary(req.guest.id));
}

function icons(req, res) {
  res.json({ icons: db.getAllIcons().map(i => ({ id: i.id, file_path: i.file_path })) });
}

async function faviconPreview(req, res) {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!isValidHttpUrl(url)) return res.status(400).json({ error: 'That is not a valid address' });
  let found;
  try { found = await fetchFaviconForUrl(url, { member: true }); } catch {}
  if (!found?.buffer) return res.status(404).end();
  res.set('Cache-Control', 'private, no-store');
  res.type(found.contentType || 'image/png').send(found.buffer);
}

// ─── Groups ───────────────────────────────────────────────────────────────────

function createGroup(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A group needs a name' });
  if (db.countGuestGroups(owner(req)) >= MAX_USER_GROUPS) {
    return res.status(409).json({ error: `You can have up to ${MAX_USER_GROUPS} groups`, code: 'limit_reached' });
  }
  const color = isValidHexColor(req.body?.color) ? req.body.color : DEFAULT_COLOR;
  res.status(201).json(db.createGuestGroup(owner(req), { name, color }));
}
function updateGroup(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A group needs a name' });
  const color = isValidHexColor(req.body?.color) ? req.body.color : DEFAULT_COLOR;
  const updated = db.updateGuestGroup(owner(req), idParam(req), { name, color });
  if (!updated) return res.status(404).json({ error: 'No such group' });
  res.json(updated);
}
async function deleteGroup(req, res) {
  if (!db.deleteGuestGroup(owner(req), idParam(req))) return res.status(404).json({ error: 'No such group' });
  res.json({ ok: true });
}
function reorderGroups(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderGuestGroups(owner(req), ids);
  res.json({ ok: true });
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function createSection(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A section needs a name' });
  if (db.countGuestSections(owner(req)) >= MAX_USER_SECTIONS) {
    return res.status(409).json({ error: `You can have up to ${MAX_USER_SECTIONS} sections`, code: 'limit_reached' });
  }
  const parentSectionId = req.body?.parent_section_id ? Number(req.body.parent_section_id) : null;
  const section = db.createGuestSection(owner(req), idParam(req), { name, parentSectionId });
  if (!section) return res.status(400).json({ error: 'That is not a group of yours, or that parent section cannot nest' });
  res.status(201).json(section);
}
function updateSection(req, res) {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'A section needs a name' });
  const section = db.renameGuestSection(owner(req), idParam(req), name);
  if (!section) return res.status(404).json({ error: 'No such section' });
  res.json(section);
}
function deleteSection(req, res) {
  db.deleteGuestSection(owner(req), idParam(req));
  res.json({ ok: true });
}
function reorderSections(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderGuestSections(owner(req), ids);
  res.json({ ok: true });
}

// ─── Links ────────────────────────────────────────────────────────────────────

function linkProblem({ name, url, hasFile }) {
  if (!name) return 'A link needs a name';
  if (!hasFile && !url) return 'A link needs a web address or a file';
  if (url && !isValidHttpUrl(url)) return 'That web address is not valid — it should start with http:// or https://';
  return null;
}
function libraryIconPath(iconIdField) {
  const id = Number.parseInt(iconIdField, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.getIconById(id)?.file_path || null;
}
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
      error: 'That would take you over the storage allowance for guests',
      code: 'quota_exceeded', storage: storageSummary(owner(req)),
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

  if (db.countGuestLinks(me) >= MAX_USER_LINKS) {
    await discardUploads(req);
    return res.status(409).json({ error: `You can have up to ${MAX_USER_LINKS} links`, code: 'limit_reached' });
  }
  if (!quotaCheck(req, res, 0)) { await discardUploads(req); return; }

  const id = db.createGuestLink(me, {
    name, url, description,
    imagePath: image ? null : libraryIconPath(req.body?.icon_id),
  });
  if (image) db.setGuestLinkFile(me, id, 'icon', { file: image.filename, bytes: image.size });
  if (file)  db.setGuestLinkFile(me, id, 'attachment', { file: file.filename, bytes: file.size, fileName: file.originalname });

  const assignments = parseAssignments(req.body?.groups);
  if (assignments) db.setGuestLinkGroups(me, id, assignments);

  if (url && !image && !libraryIconPath(req.body?.icon_id)) cacheGuestFavicon(me, id, url);
  res.status(201).json(db.getGuestLink(me, id));
}

async function updateLink(req, res) {
  const me = owner(req);
  const id = idParam(req);
  const row = db.getGuestLinkRow(me, id);
  if (!row) { await discardUploads(req); return res.status(404).json({ error: 'No such link' }); }

  const image = req.files?.image?.[0];
  const file  = req.files?.file?.[0];
  const nameRaw = req.body?.name;
  const urlRaw  = req.body?.url;
  const descRaw = req.body?.description;
  const removeImage = req.body?.remove_image === 'true' || req.body?.remove_image === '1';
  const removeFile  = req.body?.remove_file === 'true'  || req.body?.remove_file === '1';

  const name = nameRaw !== undefined ? cleanText(nameRaw, 200) : row.name;
  if (!name) { await discardUploads(req); return res.status(400).json({ error: 'A link needs a name' }); }

  const willHaveFile = file ? true : (row.attachment_file && !removeFile);
  const url = willHaveFile ? '' : (urlRaw !== undefined ? cleanText(urlRaw, 2048) : row.url);
  if (!willHaveFile && !isValidHttpUrl(url)) { await discardUploads(req); return res.status(400).json({ error: 'That web address is not valid' }); }

  const freed = (image ? row.icon_bytes : 0) + (file ? row.attachment_bytes : 0) + (removeImage ? row.icon_bytes : 0) + (removeFile ? row.attachment_bytes : 0);
  if (!quotaCheck(req, res, freed)) { await discardUploads(req); return; }

  const fields = { name, url, description: descRaw !== undefined ? cleanText(descRaw, 1000) || null : undefined };
  db.updateGuestLink(me, id, fields);

  if (removeImage) {
    const old = db.setGuestLinkFile(me, id, 'icon', { file: null, bytes: 0 });
    if (old) await deletePrivateFiles([old]);
    db.setGuestLinkLibraryIcon(me, id, null);
  }
  if (image) {
    const old = db.setGuestLinkFile(me, id, 'icon', { file: image.filename, bytes: image.size });
    if (old) await deletePrivateFiles([old]);
    db.setGuestLinkLibraryIcon(me, id, null);     // uploaded replaces library pick
  }
  if (!image && !removeImage && req.body?.icon_id !== undefined) {
    const old = db.setGuestLinkLibraryIcon(me, id, libraryIconPath(req.body.icon_id));
    if (old) await deletePrivateFiles([old]);
  }
  if (removeFile) {
    const old = db.setGuestLinkFile(me, id, 'attachment', { file: null, bytes: 0, fileName: null });
    if (old) await deletePrivateFiles([old]);
  }
  if (file) {
    const old = db.setGuestLinkFile(me, id, 'attachment', { file: file.filename, bytes: file.size, fileName: file.originalname });
    if (old) await deletePrivateFiles([old]);
  }
  const assignments = parseAssignments(req.body?.groups);
  if (assignments) db.setGuestLinkGroups(me, id, assignments);

  if (url && url !== row.url) cacheGuestFavicon(me, id, url);
  res.json(db.getGuestLink(me, id));
}

async function deleteLink(req, res) {
  const files = db.deleteGuestLink(owner(req), idParam(req));
  if (!files) return res.status(404).json({ error: 'No such link' });
  await deletePrivateFiles(files);
  res.json({ ok: true });
}

function reorderLinks(req, res) {
  const ids = orderFrom(req.body);
  if (!ids) return res.status(400).json({ error: 'Send { order: [ids] }' });
  db.reorderGuestLinks(owner(req), ids);
  res.json({ ok: true });
}

// ─── Serving stored files ────────────────────────────────────────────────────

function privateHeaders(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
}
function sendPrivate(res, filename, { downloadName, inline = true } = {}) {
  const abs = resolvePrivateFilePath(filename);
  if (!abs) return res.status(404).end();
  privateHeaders(res);
  if (downloadName && !inline) res.set('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
  res.sendFile(abs);
}
function icon(req, res) {
  const row = db.getGuestLinkRow(owner(req), idParam(req));
  if (!row?.icon_file) return res.status(404).end();
  sendPrivate(res, row.icon_file);
}
function favicon(req, res) {
  const row = db.getGuestLinkRow(owner(req), idParam(req));
  if (!row?.favicon_file) return res.status(404).end();
  sendPrivate(res, row.favicon_file);
}
function file(req, res) {
  const row = db.getGuestLinkRow(owner(req), idParam(req));
  if (!row?.attachment_file) return res.status(404).end();
  const isMd = /\.md$/i.test(row.file_name || '');
  if (isMd) {
    const abs = resolvePrivateFilePath(row.attachment_file);
    if (!abs) return res.status(404).end();
    const fs = require('node:fs');
    const html = renderMarkdownPage({
      title: row.file_name, body: renderMarkdown(fs.readFileSync(abs, 'utf8')),
      palette: instancePalette(req), csp: MARKDOWN_CSP,
    });
    res.set('Content-Security-Policy', MARKDOWN_CSP);
    privateHeaders(res);
    return res.type('html').send(html);
  }
  sendPrivate(res, row.attachment_file, { downloadName: row.file_name });
}

module.exports = {
  data, storage, icons, faviconPreview,
  createGroup, updateGroup, deleteGroup, reorderGroups,
  createSection, updateSection, deleteSection, reorderSections,
  createLink, updateLink, deleteLink, reorderLinks,
  icon, favicon, file,
};
