// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Icon library CRUD, bundle export/import, and live favicon preview. */

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const { UPLOADS_DIR } = require('../config/env');
const { ICON_IMPORT_MAX_BYTES, ICON_EXT_BY_MIME } = require('../config/constants');
const db = require('../models');
const { isValidHttpUrl } = require('../utils/http');
const { safeDeleteFile } = require('../services/uploadService');
const { fetchFaviconForUrl } = require('../services/faviconService');

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function list(req, res) {
  res.json(db.getAllIcons());
}

function create(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image file was provided' });

  const icon = db.createIcon({
    filePath:     `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    mimeType:     req.file.mimetype,
    fileSize:     req.file.size,
  });
  res.status(201).json({ ...icon, usage_count: 0 });
}

/**
 * True when a settings key still points at this file (Settings favicon or the
 * header icon). Those files stay on disk even after leaving the library, so the
 * setting keeps working — it's just no longer a reusable library asset.
 */
function isPinnedBySettings(filePath) {
  return db.readSetting('favicon')    === filePath
      || db.readSetting('brand_icon') === filePath;
}

function remove(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid icon ID' });

  const icon = db.getIconById(id);
  const { changes, fileToDelete } = db.deleteIcon(id);
  if (!changes) return res.status(404).json({ error: 'Icon not found' });

  const iconName = icon?.original_name;
  req._auditSummary = iconName
    ? `Deleted icon "${iconName}" from the library`
    : `Deleted icon #${id} from the library`;

  // Don't remove the file from disk while a setting still points at it (the icon
  // is just unlinked from the library; the favicon / header icon keep working).
  if (fileToDelete && !isPinnedBySettings(fileToDelete)) {
    safeDeleteFile(fileToDelete);
  }
  res.status(204).end();
}

function bulkDelete(req, res) {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: '"ids" must be an array' });

  let deleted = 0;
  for (const raw of ids) {
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id)) continue;
    const { changes, fileToDelete } = db.deleteIcon(id);
    if (!changes) continue;
    // Same guard as the single delete: keep files a setting still points at.
    if (fileToDelete && !isPinnedBySettings(fileToDelete)) safeDeleteFile(fileToDelete);
    deleted++;
  }
  res.json({ deleted });
}

// ─── Export / import ──────────────────────────────────────────────────────────

/**
 * Exports the whole icon library as a self-contained JSON bundle — each icon's
 * bytes are base64-encoded inline so the file can be re-imported on another
 * instance with no separate asset copy. No new dependencies (no zip).
 */
function exportLib(req, res) {
  const icons = db.getAllIcons();
  const out = [];
  for (const ic of icons) {
    try {
      const full = path.join(UPLOADS_DIR, path.basename(ic.file_path));
      if (!fs.existsSync(full)) continue;
      const buf = fs.readFileSync(full);
      if (buf.length > ICON_IMPORT_MAX_BYTES) continue;
      out.push({
        original_name: ic.original_name,
        mime_type:     ic.mime_type,
        // The on-disk extension lets the importer recover the type even when
        // mime_type is null and original_name carries no extension (e.g.
        // backfilled "host favicon" / "Site favicon" entries).
        file_ext:      path.extname(ic.file_path).toLowerCase() || null,
        file_size:     ic.file_size ?? buf.length,
        created_at:    ic.created_at,
        data:          buf.toString('base64'),
      });
    } catch { /* skip unreadable icon */ }
  }
  const stamp = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="icon-library-${stamp}.json"`);
  res.send(JSON.stringify({ version: 1, exported_at: new Date().toISOString(), count: out.length, icons: out }, null, 2));
}

/**
 * Imports an icon-library bundle. Idempotent: each icon's bytes are written to
 * a content-hashed filename, so re-importing the same bundle de-dupes via the
 * icons table's UNIQUE(file_path) constraint.
 */
function importLib(req, res) {
  const incoming = req.body;
  if (!Array.isArray(incoming?.icons)) {
    return res.status(400).json({ error: 'Body must contain an "icons" array' });
  }

  const ALLOWED_EXTS = new Set(Object.values(ICON_EXT_BY_MIME));

  // Content-hash every existing library file once, so we can de-dupe by
  // *content* regardless of the various on-disk filename schemes (favicon_N,
  // timestamp-random, icon-<hash>). Re-importing the same bundle is then a
  // no-op rather than creating duplicates.
  const seenHashes = new Set();
  for (const ic of db.getAllIcons()) {
    try {
      const f = path.join(UPLOADS_DIR, path.basename(ic.file_path));
      if (fs.existsSync(f)) seenHashes.add(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
    } catch { /* ignore unreadable */ }
  }

  let imported = 0, skipped = 0;
  const errors = [];

  for (const [i, ic] of incoming.icons.entries()) {
    try {
      if (typeof ic?.data !== 'string' || !ic.data) { errors.push(`Icon ${i + 1}: missing data`); continue; }
      const buf = Buffer.from(ic.data, 'base64');
      if (!buf.length || buf.length > ICON_IMPORT_MAX_BYTES) { errors.push(`Icon ${i + 1}: invalid size`); continue; }

      // Skip content we already have (in the library, or earlier in this run).
      const fullHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (seenHashes.has(fullHash)) { skipped++; continue; }

      // Resolve extension: mime → exported on-disk ext → original_name ext.
      const mime = (ic.mime_type || '').toLowerCase();
      let ext = ICON_EXT_BY_MIME[mime];
      if (!ext && ic.file_ext && ALLOWED_EXTS.has(String(ic.file_ext).toLowerCase())) {
        ext = String(ic.file_ext).toLowerCase();
      }
      if (!ext && ic.original_name) {
        const e = path.extname(ic.original_name).toLowerCase();
        if (ALLOWED_EXTS.has(e)) ext = e;
      }
      if (!ext) { errors.push(`Icon ${i + 1}: unsupported type`); continue; }

      const filename = `icon-${fullHash.slice(0, 20)}${ext}`;
      const stored   = `/uploads/${filename}`;
      const full     = path.join(UPLOADS_DIR, filename);

      if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
      db.createIcon({
        filePath:     stored,
        originalName: ic.original_name || null,
        mimeType:     mime || null,
        fileSize:     buf.length,
      });
      seenHashes.add(fullHash);
      imported++;
    } catch { errors.push(`Icon ${i + 1}: failed to import`); }
  }

  res.json({ imported, skipped, errors });
}

// ─── Favicon preview ──────────────────────────────────────────────────────────

/**
 * Streams the best-effort favicon for a given URL. Used by the link-modal's
 * live preview so it works for intranet URLs too. Admin-only to avoid being
 * an SSRF gadget for anonymous callers.
 */
async function faviconPreview(req, res) {
  const siteUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!siteUrl || !isValidHttpUrl(siteUrl)) {
    return res.status(400).end();
  }
  try {
    const found = await fetchFaviconForUrl(siteUrl);
    if (!found) return res.status(404).end();
    res.setHeader('Content-Type',  found.contentType);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.send(found.buffer);
  } catch {
    res.status(502).end();
  }
}

module.exports = { list, create, remove, bulkDelete, exportLib, importLib, faviconPreview };
