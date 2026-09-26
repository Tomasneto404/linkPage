// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Links: public read, admin write, import/export, reorder, in-place file edit. */

const path = require('path');
const fs   = require('fs');

const { EDITABLE_FILE_EXTENSIONS, FILE_EDIT_MAX_BYTES } = require('../config/constants');
const db = require('../models');
const { isValidHttpUrl } = require('../utils/http');
const { normalizeSlug, isReservedSlug } = require('../utils/slug');
const { parseGroupAssignments } = require('../utils/parsers');
const { getUnlockedGroupIds } = require('../utils/groupCrypto');
const { isValidAdminToken } = require('../middleware/auth');
const { resolveIconReference, safeDeleteFile, safeDeleteFileUnlessLibrary,
        resolveStoredFilePath } = require('../services/uploadService');
const { cacheFavicon } = require('../services/faviconService');
const { ensureGroupByName, ensureSectionByName, filterVisibleLinks } = require('../services/linkService');

// ─── Public read ──────────────────────────────────────────────────────────────

function list(req, res) {
  const links = db.getAllLinks();
  if (isValidAdminToken(req.headers['x-admin-token'])) return res.json(links);

  const visible  = links.filter(l => !l.is_hidden);
  const groups   = db.getAllGroups();
  const unlocked = getUnlockedGroupIds(req);
  res.json(filterVisibleLinks(visible, groups, unlocked));
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Exports every link the admin has — name, URL, description, group/section
 * memberships, file attachment metadata, custom icon, favicon, hidden flag,
 * position — plus the full groups & sections hierarchy with colours. Designed
 * so a re-import on a clean instance recreates the same browseable structure.
 */
function exportLinks(req, res) {
  const links  = db.getAllLinks();
  const groups = db.getAllGroups();

  res.json({
    version:     4,
    exported_at: new Date().toISOString(),
    groups: groups.map(g => ({
      name:         g.name,
      color:        g.color,
      position:     g.position,
      is_protected: !!g.is_protected,
      sections:     (g.sections || []).map(s => ({
        name:     s.name,
        position: s.position,
        // Nested subsections, one level only.
        subsections: (s.subsections || []).map(sub => ({
          name:     sub.name,
          position: sub.position,
        })),
      })),
    })),
    links: links.map(l => ({
      name:         l.name,
      url:          l.url,
      slug:         l.slug         || null,
      description:  l.description  || null,
      position:     l.position,
      is_hidden:    !!l.is_hidden,
      image_path:   l.image_path   || null,
      favicon_path: l.favicon_path || null,
      file_path:    l.file_path    || null,
      file_name:    l.file_name    || null,
      auto_open:    !!l.auto_open,
      // v4: preserves the full section_name → subsection_name path so a link
      // assigned to a subsection round-trips correctly.
      groups: (l.groups || []).map(g => {
        // section_name is the leaf the link is attached to; if that leaf has
        // a parent, expose them as "section_name" + "subsection_name" so the
        // importer can reconnect.
        const isSubLeaf = g.parent_section_name && g.section_name;
        return {
          name:            g.name,
          section_name:    isSubLeaf ? g.parent_section_name : (g.section_name || null),
          subsection_name: isSubLeaf ? g.section_name        : null,
        };
      }),
      // Legacy compatibility — keep older importers reading these fields working.
      group_names: (l.groups || []).map(g => g.name),
      group_name:  l.group_name || null,
    })),
  });
}

// ─── Import ───────────────────────────────────────────────────────────────────

function importLinks(req, res) {
  const incoming = req.body;

  if (!Array.isArray(incoming?.links)) {
    return res.status(400).json({ error: 'Request body must have a "links" array' });
  }

  let imported        = 0;
  let skipped         = 0;
  let groupsCreated   = 0;
  let sectionsCreated = 0;
  const errors        = [];

  // ─── 1. Re-create the groups/sections/subsections hierarchy first ──────
  // Process explicit groups before scanning links so we keep the colours +
  // section ordering the export captured. Each helper de-dups by name.
  if (Array.isArray(incoming.groups)) {
    for (const g of incoming.groups) {
      if (!g?.name?.trim()) continue;
      const { id: gid, created } = ensureGroupByName(g.name, g.color);
      if (created) groupsCreated++;
      if (!gid) continue;
      for (const s of (g.sections || [])) {
        if (!s?.name?.trim()) continue;
        const { id: sid, created: secCreated } = ensureSectionByName(gid, s.name);
        if (secCreated) sectionsCreated++;
        // Nested subsections (v4 export). One level only — the data layer
        // rejects deeper nesting on its own, so we just iterate the array.
        for (const sub of (s.subsections || [])) {
          if (!sub?.name?.trim()) continue;
          const { created: subCreated } = ensureSectionByName(gid, sub.name, sid);
          if (subCreated) sectionsCreated++;
        }
      }
    }
  }

  // ─── 2. Walk the links list ─────────────────────────────────────────────
  for (const [index, item] of incoming.links.entries()) {
    if (!item?.name?.trim()) {
      errors.push(`Item ${index + 1}: name is required`);
      continue;
    }
    const isFileBacked = !!(item.file_path && String(item.file_path).startsWith('/uploads/'));
    const trimmedUrl   = (item.url || '').trim();

    if (!isFileBacked) {
      if (!trimmedUrl) {
        errors.push(`Item ${index + 1}: url is required (or set file_path)`);
        continue;
      }
      if (!isValidHttpUrl(trimmedUrl)) {
        errors.push(`Item ${index + 1}: invalid URL "${item.url}"`);
        continue;
      }
    }

    // Skip links that already exist (dedup by URL — same as the admin form's
    // duplicate guard). We treat file_path as the de-dup key for file-backed
    // links, since they all share the URL prefix /uploads/.
    const dedupKey = isFileBacked ? item.file_path : trimmedUrl;
    if (db.checkDuplicateUrl(dedupKey)) {
      skipped++;
      continue;
    }

    // ─── 3. Resolve groups + sections referenced by this link ────────────
    // Accept three input shapes, in priority order:
    //   item.groups[]  = [{ name, section_name }]    (v3 export)
    //   item.group_names[]                            (v2 export)
    //   item.group_name                               (v1 export)
    const groupSpecs = [];
    if (Array.isArray(item.groups)) {
      for (const g of item.groups) {
        if (typeof g === 'object' && g?.name) {
          groupSpecs.push({
            name:        g.name,
            section:     g.section_name    || null,
            subsection:  g.subsection_name || null,
          });
        } else if (typeof g === 'string') {
          groupSpecs.push({ name: g, section: null, subsection: null });
        }
      }
    }
    if (!groupSpecs.length && Array.isArray(item.group_names)) {
      for (const n of item.group_names) {
        groupSpecs.push({ name: n, section: null, subsection: null });
      }
    }
    if (!groupSpecs.length && item.group_name) {
      groupSpecs.push({ name: item.group_name, section: null, subsection: null });
    }

    const assignments = [];
    const seenGids    = new Set();
    for (const { name, section, subsection } of groupSpecs) {
      const { id: gid, created } = ensureGroupByName(name);
      if (!gid || seenGids.has(gid)) continue;
      if (created) groupsCreated++;
      seenGids.add(gid);

      // Resolve the leaf section the link is attached to. If a subsection is
      // supplied, that's the leaf; otherwise the top-level section is.
      let sid = null;
      if (section) {
        const { id: parentId, created: parentCreated } = ensureSectionByName(gid, section);
        if (parentCreated) sectionsCreated++;
        if (subsection && parentId) {
          const { id: subId, created: subCreated } = ensureSectionByName(gid, subsection, parentId);
          if (subCreated) sectionsCreated++;
          sid = subId || parentId;
        } else {
          sid = parentId;
        }
      }
      assignments.push({ group_id: gid, section_id: sid });
    }

    // ─── 4. Create the link ──────────────────────────────────────────────
    // An imported slug is dropped rather than fought over: if it is malformed,
    // reserved, or already taken here, the link still imports — just without a
    // custom URL — instead of failing the whole row.
    const importedSlug = resolveSlugField(item.slug).slug ?? null;

    const result = db.createLink({
      name:        item.name.trim(),
      url:         isFileBacked ? item.file_path : trimmedUrl,
      description: item.description?.trim() || null,
      imagePath:   item.image_path || null,
      groupIds:    assignments,
      filePath:    isFileBacked ? item.file_path : null,
      fileName:    isFileBacked ? (item.file_name || null) : null,
      slug:        importedSlug,
      // Dropped rather than fought over, like the slug: only a markdown link
      // can carry it, and a row is not worth failing over a flag.
      autoOpen:    !!item.auto_open && isMarkdownFile(item.file_name),
    });
    const newId = result.lastInsertRowid;

    // Re-apply per-link flags the schema treats as side-effects.
    if (item.is_hidden) db.updateLinkVisibility(newId, true);

    // Best-effort favicon cache for URL-backed links. Fire-and-forget so the
    // import endpoint stays responsive even if a host is slow.
    if (!isFileBacked && isValidHttpUrl(trimmedUrl)) {
      cacheFavicon(newId, trimmedUrl).catch(() => {});
    }

    imported++;
  }

  res.json({
    imported,
    skipped,
    groups_created:   groupsCreated,
    sections_created: sectionsCreated,
    errors,
  });
}

// ─── Reorder ──────────────────────────────────────────────────────────────────

function reorder(req, res) {
  const { order } = req.body;
  if (!Array.isArray(order) || order.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"order" must be an array of numeric IDs' });
  }
  db.reorderLinks(order);
  res.status(204).end();
}

// ─── Create / update ────────────────────────────────────────────────────────

/** True when this filename is a markdown document. */
function isMarkdownFile(fileName) {
  return path.extname(fileName || '').toLowerCase() === '.md';
}

/**
 * Reads the optional `auto_open` field: whether this document should open
 * itself when its group is opened on the public page.
 *
 * Only a markdown link can, since it is the only kind that renders as a page
 * rather than downloading or navigating away. Asking for it on anything else
 * is refused rather than quietly ignored, so a caller is never left thinking
 * it took. Multipart sends everything as text, hence the string forms.
 *
 * Returns { autoOpen } — undefined when the field was absent, meaning leave
 * whatever is stored alone — or { error }.
 */
function resolveAutoOpenField(raw, { isMarkdown }) {
  if (raw === undefined || raw === null || raw === '') return { autoOpen: undefined };

  const wanted = raw === true || raw === 'true' || raw === '1' || raw === 1;
  if (wanted && !isMarkdown) {
    return { error: 'Only a markdown link can open itself when its group is opened' };
  }
  return { autoOpen: wanted };
}

/**
 * Validates the optional `slug` field of a link payload.
 *
 * Tri-state by design, so PUT can tell three intents apart:
 *   field absent  → { slug: undefined }  leave whatever is stored alone
 *   field empty   → { slug: null }       clear it (back to /r/<id> only)
 *   field set     → { slug: '<clean>' }  normalised, checked for collisions
 *
 * Returns { error } instead when the slug can't be used. `excludeId` lets a
 * link keep its own slug across an edit without colliding with itself.
 */
function resolveSlugField(raw, excludeId = null) {
  if (raw === undefined || raw === null) return { slug: undefined };

  const typed = String(raw).trim();
  if (!typed) return { slug: null };

  const slug = normalizeSlug(typed);
  if (!slug) {
    return { error: 'Custom URL must contain at least one letter or number' };
  }
  if (isReservedSlug(slug)) {
    return { error: `Custom URL "${slug}" is reserved — pick another one` };
  }
  const taken = db.findLinkBySlug(slug, excludeId);
  if (taken) {
    return { error: `Custom URL "${slug}" is already in use by "${taken.name}"` };
  }
  return { slug };
}

/**
 * Removes files multer already wrote to disk when the request is about to be
 * rejected. Without this a bounced save (a taken slug, a missing name) would
 * leave an orphan upload behind — up to 100 MB of it.
 */
function discardUploads(req) {
  for (const file of [...(req.files?.image || []), ...(req.files?.file || [])]) {
    safeDeleteFile(`/uploads/${file.filename}`);
  }
}


async function create(req, res) {
  const { name, url, description, icon_id } = req.body;

  const imageFile = req.files?.image?.[0] || null;
  const attached  = req.files?.file?.[0]  || null;

  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!name?.trim()) {
    discardUploads(req);
    return res.status(400).json({ error: 'Name is required' });
  }
  // Either a URL or a file is required — never both required, never neither.
  if (!trimmedUrl && !attached) {
    discardUploads(req);
    return res.status(400).json({ error: 'Provide a URL or upload a file' });
  }
  if (trimmedUrl && !isValidHttpUrl(trimmedUrl)) {
    discardUploads(req);
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }

  const slugResult = resolveSlugField(req.body.slug);
  if (slugResult.error) {
    discardUploads(req);
    return res.status(400).json({ error: slugResult.error });
  }

  const autoOpenResult = resolveAutoOpenField(req.body.auto_open, {
    isMarkdown: isMarkdownFile(attached?.originalname),
  });
  if (autoOpenResult.error) {
    discardUploads(req);
    return res.status(400).json({ error: autoOpenResult.error });
  }

  const imagePath   = resolveIconReference({ imageFile, iconIdField: icon_id });
  const filePath    = attached  ? `/uploads/${attached.filename}`  : null;
  const fileName    = attached  ? attached.originalname            : null;
  const assignments = parseGroupAssignments(req.body) ?? [];

  // For file-backed links we store the file path in `url` as well, so /r/:id's
  // redirect target is uniform and click tracking continues to work.
  const effectiveUrl = filePath ?? trimmedUrl;

  const result = db.createLink({
    name:        name.trim(),
    url:         effectiveUrl,
    description: description?.trim() || null,
    imagePath,
    groupIds:    assignments,
    filePath,
    fileName,
    slug:        slugResult.slug ?? null,
    autoOpen:    autoOpenResult.autoOpen ?? false,
  });

  const linkId = result.lastInsertRowid;

  // Favicons only make sense for real URLs — skip for file-backed links.
  // Fire-and-forget: the link is saved immediately and the favicon is cached
  // in the background, then pushed to open pages via SSE when it lands. This
  // keeps the save instant even when the target host is slow or unreachable.
  if (!filePath) cacheFavicon(linkId, effectiveUrl).catch(() => {});

  res.status(201).json(db.getLinkById(linkId));
}

async function update(req, res) {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  const { name, url, description, remove_image, remove_file, icon_id } = req.body;

  const imageFile  = req.files?.image?.[0] || null;
  const attached   = req.files?.file?.[0]  || null;
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';
  const shouldRemoveImage = remove_image === 'true';
  const shouldRemoveFile  = remove_file  === 'true';

  if (!name?.trim()) {
    discardUploads(req);
    return res.status(400).json({ error: 'Name is required' });
  }

  // Validated before anything is written, so a rejected slug leaves the link
  // exactly as it was.
  const slugResult = resolveSlugField(req.body.slug, Number.parseInt(req.params.id, 10));
  if (slugResult.error) {
    discardUploads(req);
    return res.status(400).json({ error: slugResult.error });
  }

  // After this update the link must still have either a URL or a file attached.
  const willHaveFile = attached ? true : (existingLink.file_path && !shouldRemoveFile);
  if (!willHaveFile) {
    // URL-only path: validate normally.
    if (!trimmedUrl) {
      discardUploads(req);
      return res.status(400).json({ error: 'Provide a URL or upload a file' });
    }
    if (!isValidHttpUrl(trimmedUrl)) {
      discardUploads(req);
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }
  }
  // When the link is/stays file-backed, the URL field is ignored — callers may
  // re-send the stored /uploads/... path without it causing a validation error.

  const newImagePath = resolveIconReference({ imageFile, iconIdField: icon_id });
  const newFilePath  = attached  ? `/uploads/${attached.filename}`  : null;

  // Judged against what the link will be once this save lands, not what it
  // was: attaching a PDF over a markdown file has to take the flag with it.
  const keepsOldFile   = !attached && existingLink.file_path && !shouldRemoveFile;
  const willBeMarkdown = attached ? isMarkdownFile(attached.originalname)
                       : keepsOldFile ? isMarkdownFile(existingLink.file_name)
                       : false;

  const autoOpenResult = resolveAutoOpenField(req.body.auto_open, { isMarkdown: willBeMarkdown });
  if (autoOpenResult.error) {
    discardUploads(req);
    return res.status(400).json({ error: autoOpenResult.error });
  }
  // Nothing but a markdown link may carry it, so a link that stops being one
  // loses it whether the caller mentioned it or not.
  const autoOpen = willBeMarkdown ? autoOpenResult.autoOpen : false;

  // Image files belong to the shared icon library — never delete them on update.
  // The library endpoints own that lifecycle. Attached files are still per-link.
  if ((newFilePath || shouldRemoveFile) && existingLink.file_path) {
    safeDeleteFile(existingLink.file_path);
  }

  // Compose what to store as the link's `url` field (used by /r/:id):
  //   - new file → use the new file path
  //   - keep existing file & not removing it → keep existing url
  //   - otherwise → the user-provided URL
  let effectiveUrl;
  if (newFilePath)                                                effectiveUrl = newFilePath;
  else if (existingLink.file_path && !shouldRemoveFile)           effectiveUrl = existingLink.url;
  else                                                            effectiveUrl = trimmedUrl;

  db.updateLink(req.params.id, {
    name:        name.trim(),
    url:         effectiveUrl,
    description: description?.trim() || null,
    imagePath:   newImagePath,
    groupIds:    parseGroupAssignments(req.body),
    removeImage: shouldRemoveImage,
    filePath:    newFilePath ?? undefined,
    fileName:    attached?.originalname ?? undefined,
    clearFile:   shouldRemoveFile && !newFilePath,
    slug:        slugResult.slug,
    autoOpen,
  });

  // Re-cache favicon only if we're now URL-backed and the URL changed.
  // Fire-and-forget (see POST handler) — never block the save on a slow host.
  const nowFileBacked = !!(newFilePath || (existingLink.file_path && !shouldRemoveFile));
  if (!nowFileBacked && trimmedUrl !== existingLink.url) {
    cacheFavicon(req.params.id, trimmedUrl).catch(() => {});
  }

  res.json(db.getLinkById(req.params.id));
}

/**
 * Toggles or sets a link's hidden flag without rewriting any other fields.
 * Body: { hidden: boolean }. Hidden links stay in the admin list but never
 * appear on the public page and `/r/:id` redirects non-admins to /.
 */
function setVisibility(req, res) {
  const link = db.getLinkById(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const hidden = !!req.body.hidden;
  db.updateLinkVisibility(req.params.id, hidden);
  res.json(db.getLinkById(req.params.id));
}

function remove(req, res) {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  // Capture the name for the audit log before the row is gone.
  req._auditSummary = `Deleted link "${existingLink.name}"`;

  // image_path is a shared icon-library reference — leave the file alone.
  safeDeleteFileUnlessLibrary(existingLink.favicon_path);
  safeDeleteFile(existingLink.file_path);
  db.deleteLink(req.params.id);
  res.status(204).end();
}

// ─── In-place file editor ─────────────────────────────────────────────────────

function isEditableFile(filename) {
  if (!filename) return false;
  return EDITABLE_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/**
 * Resolves the on-disk path for a link's attached file, traversal-guarded.
 * Returns null when the link is missing, file-less, or wandering outside.
 */
function resolveLinkFilePath(link) {
  return resolveStoredFilePath(link?.file_path);
}

function getFile(req, res) {
  const link = db.getLinkById(Number.parseInt(req.params.id, 10));
  if (!link?.file_path)       return res.status(404).json({ error: 'No file attached to this link' });
  if (!isEditableFile(link.file_name)) {
    return res.status(415).json({ error: 'This file type is not text-editable' });
  }

  const fullPath = resolveLinkFilePath(link);
  if (!fullPath || !fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File missing on disk' });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > FILE_EDIT_MAX_BYTES) {
      return res.status(413).json({
        error: `File too large to edit (max ${Math.round(FILE_EDIT_MAX_BYTES / 1024 / 1024)} MB)`,
      });
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    res.json({
      file_name: link.file_name,
      file_path: link.file_path,
      size:      stat.size,
      mtime:     stat.mtimeMs,
      content,
    });
  } catch {
    res.status(500).json({ error: 'Could not read the file' });
  }
}

function putFile(req, res) {
  const link = db.getLinkById(Number.parseInt(req.params.id, 10));
  if (!link?.file_path)       return res.status(404).json({ error: 'No file attached to this link' });
  if (!isEditableFile(link.file_name)) {
    return res.status(415).json({ error: 'This file type is not text-editable' });
  }

  const content = typeof req.body?.content === 'string' ? req.body.content : null;
  if (content === null) return res.status(400).json({ error: 'Missing "content" string' });
  if (Buffer.byteLength(content, 'utf8') > FILE_EDIT_MAX_BYTES) {
    return res.status(413).json({ error: 'Content exceeds the 5 MB edit limit' });
  }

  const fullPath = resolveLinkFilePath(link);
  if (!fullPath) return res.status(400).json({ error: 'Invalid file path' });

  try {
    // Atomic-ish write: stage to a sibling and rename, so a partial write
    // never leaves visitors looking at half a file.
    const tmpPath = `${fullPath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, fullPath);

    const stat = fs.statSync(fullPath);
    res.json({ size: stat.size, mtime: stat.mtimeMs });
  } catch {
    res.status(500).json({ error: 'Could not write the file' });
  }
}

// ─── Bulk delete ──────────────────────────────────────────────────────────────

function bulkDelete(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"ids" must be an array of numeric IDs' });
  }

  let deleted = 0;
  for (const id of ids) {
    const link = db.getLinkById(id);
    if (link) {
      // image_path is a shared icon-library reference — leave the file alone.
      safeDeleteFileUnlessLibrary(link.favicon_path);
      safeDeleteFile(link.file_path);
      db.deleteLink(id);
      deleted++;
    }
  }

  res.json({ deleted });
}

module.exports = {
  list, exportLinks, importLinks, reorder,
  create, update, setVisibility, remove,
  getFile, putFile, bulkDelete,
};
