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
      done(new Error('Only image files are allowed (jpg, png, gif, webp, svg)'));
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
        : done(new Error('Custom icon must be an image (jpg, png, gif, webp, svg)'));
    }
    if (file.fieldname === 'file') {
      return isAllowedAttachment(file)
        ? done(null, true)
        : done(new Error('File type not allowed'));
    }
    done(new Error(`Unexpected field "${file.fieldname}"`));
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'file',  maxCount: 1 },
]);

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
  isAllowedImage,
  isAllowedAttachment,
  safeDeleteFile,
  safeDeleteFileUnlessLibrary,
  resolveIconReference,
};
