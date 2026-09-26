// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * File-upload plumbing: multer instances, upload validation, safe deletion,
 * and icon-reference resolution.
 */

const multer = require('multer');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

const { UPLOADS_DIR } = require('../config/env');
const {
  ALLOWED_IMAGE_EXTENSIONS, ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_FILE_EXTENSIONS,  ALLOWED_FILE_MIME_TYPES,
  PUBLIC_REQUEST_FILE_EXTENSIONS,
  ACTIVE_CONTENT_EXTENSIONS, ACTIVE_CONTENT_MIME_TYPES,
} = require('../config/constants');
const db = require('../models');

/** Returns true if the uploaded file is an allowed image type. */
function isAllowedImage(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(extension) &&
         ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype);
}

function isAllowedAttachment(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.includes(ext) && ALLOWED_FILE_MIME_TYPES.has(file.mimetype);
}

/**
 * The attachment rule for public link requests, which is stricter than the
 * admin's: nothing that a browser executes when the URL is opened.
 *
 * Uploads are served inline from the same origin as the admin panel, and the
 * admin's token sits in that origin's localStorage — so a stored .html or .svg
 * submitted by a stranger would run with the reviewer's privileges the moment
 * they clicked it to see what had been sent. Extension and declared type are
 * both checked: express.static picks the Content-Type off the extension, while
 * the browser's declared type is what multer sees.
 */
function isAllowedPublicAttachment(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ACTIVE_CONTENT_EXTENSIONS.has(ext))            return false;
  if (ACTIVE_CONTENT_MIME_TYPES.has(file.mimetype))  return false;
  return PUBLIC_REQUEST_FILE_EXTENSIONS.includes(ext) && ALLOWED_FILE_MIME_TYPES.has(file.mimetype);
}

/**
 * Same reasoning for the icon a public request may carry: an SVG is a document
 * that can script, so visitors get raster images only. Admins keep SVG icons.
 */
function isAllowedPublicImage(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ACTIVE_CONTENT_EXTENSIONS.has(ext))           return false;
  if (ACTIVE_CONTENT_MIME_TYPES.has(file.mimetype)) return false;
  return isAllowedImage(file);
}

/**
 * A rejection from a multer fileFilter. Carries its own status so the error
 * handler doesn't have to recognise the wording — the message is for the user,
 * not for routing.
 */
function uploadRejection(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// ─── Multer instances ─────────────────────────────────────────────────────────

const uploadStorage = multer.diskStorage({
  destination: (req, file, done) => done(null, UPLOADS_DIR),
  filename: (req, file, done) => {
    const randomPart = crypto.randomBytes(16).toString('hex');
    const extension  = path.extname(file.originalname).toLowerCase();
    done(null, `${Date.now()}-${randomPart}${extension}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB maximum
  fileFilter: (req, file, done) => {
    if (isAllowedImage(file)) {
      done(null, true);
    } else {
      done(uploadRejection('Only image files are allowed (jpg, png, gif, webp, svg)'));
    }
  },
});

/**
 * Combined multer instance used by /api/links: accepts an optional `image`
 * (custom icon, image-only) and/or an optional `file` (attachment, broader
 * type whitelist, larger size cap).
 */
const uploadLinkPayload = multer({
  storage: uploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB cap for attachments
  fileFilter: (req, file, done) => {
    if (file.fieldname === 'image') {
      return isAllowedImage(file)
        ? done(null, true)
        : done(uploadRejection('Custom icon must be an image (jpg, png, gif, webp, svg)'));
    }
    if (file.fieldname === 'file') {
      return isAllowedAttachment(file)
        ? done(null, true)
        : done(uploadRejection('File type not allowed'));
    }
    done(uploadRejection(`Unexpected field "${file.fieldname}"`));
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'file',  maxCount: 1 },
]);

/**
 * Public request submissions: an optional `image` (the icon they picked) and an
 * optional `file` (the document they want published).
 *
 * Deliberately capped well below the admin's 100 MB: this is the only route
 * that lets an unauthenticated visitor write bytes to the uploads directory,
 * so it accepts the same file types but a quarter of the size.
 */
const PUBLIC_REQUEST_FILE_LIMIT = 25 * 1024 * 1024;

const uploadRequestPayload = multer({
  storage: uploadStorage,
  limits: { fileSize: PUBLIC_REQUEST_FILE_LIMIT },
  fileFilter: (req, file, done) => {
    if (file.fieldname === 'image') {
      return isAllowedPublicImage(file)
        ? done(null, true)
        : done(uploadRejection('Icon must be a jpg, png, gif or webp image'));
    }
    if (file.fieldname === 'file') {
      return isAllowedPublicAttachment(file)
        ? done(null, true)
        : done(uploadRejection('File type not allowed'));
    }
    done(uploadRejection(`Unexpected field "${file.fieldname}"`));
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'file',  maxCount: 1 },
]);

// ─── Stored-path resolution ───────────────────────────────────────────────────

/**
 * Resolves a stored `/uploads/...` path to its absolute on-disk location,
 * defensively scoped to UPLOADS_DIR so a tampered path can't escape
 * (path-traversal guard). Returns null when there is nothing to resolve or the
 * result would land outside the uploads directory.
 */
function resolveStoredFilePath(storedPath) {
  if (!storedPath) return null;
  const filename = path.basename(storedPath);
  const fullPath = path.join(UPLOADS_DIR, filename);
  if (path.relative(UPLOADS_DIR, fullPath).startsWith('..')) return null;
  return fullPath;
}

// ─── Safe file deletion ─────────────────────────────────────────────────────

/**
 * Skips deletion when the stored path is registered in the icon library.
 * Library files are shared assets; the library owns their lifecycle.
 */
function safeDeleteFileUnlessLibrary(storedPath) {
  if (!storedPath) return;
  if (db.getIconByPath(storedPath)) return;
  safeDeleteFile(storedPath);
}

/**
 * Deletes an uploaded file safely.
 * Uses path.basename() to strip directory components and prevent path traversal.
 */
function safeDeleteFile(storedPath) {
  if (!storedPath) return;

  const filename = path.basename(storedPath);
  const fullPath = path.join(UPLOADS_DIR, filename);

  if (!fullPath.startsWith(UPLOADS_DIR + path.sep)) {
    console.warn(`Blocked attempt to delete file outside uploads directory: ${fullPath}`);
    return;
  }

  fs.unlink(fullPath, error => {
    if (error && error.code !== 'ENOENT') {
      console.error(`Failed to delete file "${filename}": ${error.message}`);
    }
  });
}

// ─── Icon reference resolution ────────────────────────────────────────────────

/**
 * Resolves the image_path to store on a link, given either a freshly uploaded
 * file or a library `icon_id`. Auto-registers uploads in the icon library so
 * every image_path is a library asset (centralises file-lifecycle ownership).
 *   - imageFile present     → register and return its /uploads/... path
 *   - iconIdField present   → look up the library icon, bump its last_used_at
 *   - neither               → returns null (caller decides remove vs. keep)
 */
function resolveIconReference({ imageFile, iconIdField }) {
  if (imageFile) {
    const storedPath = `/uploads/${imageFile.filename}`;
    db.createIcon({
      filePath:     storedPath,
      originalName: imageFile.originalname,
      mimeType:     imageFile.mimetype,
      fileSize:     imageFile.size,
    });
    return storedPath;
  }
  const iconId = Number.parseInt(iconIdField, 10);
  if (Number.isFinite(iconId) && iconId > 0) {
    const icon = db.getIconById(iconId);
    if (icon) {
      db.touchIcon(icon.id);
      return icon.file_path;
    }
  }
  return null;
}

module.exports = {
  upload,
  uploadLinkPayload,
  uploadRequestPayload,
  PUBLIC_REQUEST_FILE_LIMIT,
  isAllowedImage,
  isAllowedAttachment,
  uploadRejection,
  isAllowedPublicAttachment,
  isAllowedPublicImage,
  safeDeleteFile,
  safeDeleteFileUnlessLibrary,
  resolveStoredFilePath,
  resolveIconReference,
};
