// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Click-tracking front doors (/r/:id and /f/:slug) and the /admin SPA entry point. */

const { PUBLIC_DIR } = require('../config/env');
const fs   = require('fs');
const path = require('path');

const db = require('../models');
const { getClientIp } = require('../utils/http');
const { getUnlockedGroupIds } = require('../utils/groupCrypto');
const { normalizeSlug } = require('../utils/slug');
const { isValidAdminToken } = require('../middleware/auth');
const { resolveStoredFilePath } = require('../services/uploadService');
const { renderMarkdown } = require('../services/markdownService');
const { renderMarkdownPage, MARKDOWN_CSP } = require('../services/markdownPage');
const { truncate } = require('../services/auditService');

// ─── Shared gate + tracking ───────────────────────────────────────────────────

/**
 * Decides whether this visitor may reach the link. Returns true to proceed;
 * when it returns false it has already answered the request (a bounce to /).
 */
function passesVisibilityGate(req, res, link, isAdmin) {
  // Hidden links are reachable only by admins; everyone else gets bounced home.
  if (link.is_hidden && !isAdmin) {
    res.redirect(302, '/');
    return false;
  }

  // Permissive gate: link with no groups is open; otherwise at least one of its
  // groups must be public or unlocked. Admin always bypasses.
  if (!isAdmin && (link.group_ids || []).length > 0) {
    const groups       = db.getAllGroups();
    const protectedIds = new Set(groups.filter(g => g.is_protected).map(g => g.id));
    const unlocked     = getUnlockedGroupIds(req);
    const openVia      = link.group_ids.some(gid => !protectedIds.has(gid) || unlocked.has(gid));
    if (!openVia) {
      res.redirect(302, '/');
      return false;
    }
  }

  return true;
}

/** Records the click and drops a line in the audit log. */
function trackVisit(req, link, isAdmin) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || null;
  db.recordClick(link.id, ip, ua);

  // Tagged 'click' so it can be filtered separately from admin mutations
  // (clicks are public + higher-volume).
  try {
    db.recordAudit({
      action:     'link.click',
      entityType: 'click',
      entityId:   link.id,
      summary:    `Visited "${truncate(link.name)}"${isAdmin ? ' (admin)' : ''}`,
      ipAddress:  ip,
      userAgent:  ua,
    });
  } catch { /* never block the visit on a logging failure */ }
}

function setVisitHeaders(res) {
  res.setHeader('Cache-Control',   'no-store, no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// ─── /r/:id — click-tracking redirect ─────────────────────────────────────────

function redirect(req, res) {
  const linkId = parseInt(req.params.id, 10);
  if (isNaN(linkId)) return res.status(400).send('Invalid link ID');

  const link = db.getLinkById(linkId);
  if (!link) return res.status(404).send('Link not found');

  const isAdmin = isValidAdminToken(req.headers['x-admin-token']);
  if (!passesVisibilityGate(req, res, link, isAdmin)) return;

  trackVisit(req, link, isAdmin);
  setVisitHeaders(res);

  // A markdown attachment is rendered here rather than bounced to its source,
  // so the reader lands on the document itself.
  if (isMarkdownLink(link)) return sendRenderedMarkdown(res, link, req.query.theme, req.query.embed === '1');

  res.redirect(302, link.url);
}

// ─── Markdown attachments ─────────────────────────────────────────────────────

/** True when this link's attached file is a markdown document. */
function isMarkdownLink(link) {
  if (!link?.file_path) return false;
  const name = link.file_name || link.file_path;
  return path.extname(name).toLowerCase() === '.md';
}

/**
 * Renders a link's markdown and serves it as a standalone page.
 *
 * The document may have come from an unauthenticated visitor through a file
 * request, so it is rendered escape-first (see markdownService) and served
 * under a policy that permits no script at all. The raw source stays available
 * at its /uploads/... path for anyone who wants it.
 */
function sendRenderedMarkdown(res, link, theme, embed = false) {
  const fullPath = resolveStoredFilePath(link.file_path);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return res.status(404).send('File missing on disk');
  }

  let source;
  try {
    source = fs.readFileSync(fullPath, 'utf8');
  } catch {
    return res.status(404).send('File missing on disk');
  }

  res.setHeader('Content-Security-Policy', MARKDOWN_CSP);
  // Relaxed from the blanket DENY for this response only, so the public page
  // can show the document in an overlay. The CSP pins that to this origin.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.type('html').send(renderMarkdownPage({
    title: link.name,
    body:  renderMarkdown(source),
    theme,
    embed,
  }));
}

// ─── /f/:slug — the same door, under a human-readable name ────────────────────

/**
 * Resolves a link by its custom slug. Applies exactly the same visibility rules
 * and click tracking as /r/:id, then:
 *   - markdown link    → renders the document as a page
 *   - file-backed link → streams the file, so the slug stays in the address bar
 *     instead of bouncing the visitor to /uploads/<random>.<ext>
 *   - URL-backed link  → redirects to the target, same as /r/:id
 *
 * A link's numeric /r/:id address keeps working either way: the slug is an
 * extra front door, never a replacement.
 */
function serveBySlug(req, res) {
  const slug = normalizeSlug(req.params.slug);
  if (!slug) return res.status(404).send('Link not found');

  const link = db.getLinkBySlug(slug);
  if (!link) return res.status(404).send('Link not found');

  const isAdmin = isValidAdminToken(req.headers['x-admin-token']);
  if (!passesVisibilityGate(req, res, link, isAdmin)) return;

  trackVisit(req, link, isAdmin);
  setVisitHeaders(res);

  if (isMarkdownLink(link)) return sendRenderedMarkdown(res, link, req.query.theme, req.query.embed === '1');
  if (link.file_path)       return sendAttachedFile(res, link);
  res.redirect(302, link.url);
}

/**
 * Streams a link's attached file. Served inline with its original filename, the
 * same way /uploads/... serves it today — the slug route is a nicer address for
 * the identical bytes, not a different exposure.
 */
function sendAttachedFile(res, link) {
  const fullPath = resolveStoredFilePath(link.file_path);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return res.status(404).send('File missing on disk');
  }

  const downloadName = path.basename(link.file_name || link.file_path);
  res.sendFile(fullPath, {
    headers: {
      // Quoted + ASCII-escaped: a filename with a quote or a newline in it must
      // not be able to inject a second header.
      'Content-Disposition': `inline; filename="${downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"`,
    },
  }, err => {
    if (err && !res.headersSent) res.status(404).send('File missing on disk');
  });
}

/** Serves the admin SPA shell. */
function adminPage(req, res) {
  res.sendFile(path.resolve(PUBLIC_DIR, 'admin', 'index.html'));
}

module.exports = { redirect, serveBySlug, adminPage, isMarkdownLink };
