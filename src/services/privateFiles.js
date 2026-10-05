// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Members' files: where they are written, how they are found again, and how
 * they are removed.
 *
 * Kept apart from uploadService.js, which handles the shared /uploads
 * directory, so that the line between the two is one you can grep for. The
 * shared directory is mounted as static and anyone with a URL can fetch from
 * it. This one is never mounted; every file in it is read through a route that
 * has already checked the caller owns the link the file belongs to.
 *
 * What goes in here is held to the rule public link requests already follow,
 * not the looser one the administrator gets: nothing a browser would execute
 * when opened. These files come back from this origin, the same origin the
 * admin panel runs on, so a stored .html or .svg from a member would run with
 * whoever opened it's privileges.
 *
 * Filenames are random and stored bare. Nothing here ever produces a path with
 * a directory in it, and every read and delete strips one off anyway.
 */

const multer = require('multer');
const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

const { PRIVATE_UPLOADS_DIR } = require('../config/env');
const {
  ALLOWED_IMAGE_EXTENSIONS, ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_FILE_MIME_TYPES, PUBLIC_REQUEST_FILE_EXTENSIONS,
  ACTIVE_CONTENT_EXTENSIONS, ACTIVE_CONTENT_MIME_TYPES,
} = require('../config/constants');

// The same ceiling as a public link request: a member is trusted more than a
// stranger, but every byte here counts against their quota anyway, and a
// single file this large is already a quarter of the default allowance.
const PERSONAL_FILE_LIMIT = 25 * 1024 * 1024;
const PERSONAL_ICON_LIMIT = 2  * 1024 * 1024;

function isActiveContent(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return ACTIVE_CONTENT_EXTENSIONS.has(ext) || ACTIVE_CONTENT_MIME_TYPES.has(file.mimetype);
}

function isAllowedPersonalImage(file) {
  if (isActiveContent(file)) return false;
  const ext = path.extname(file.originalname).toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(ext) && ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype);
}

function isAllowedPersonalAttachment(file) {
  if (isActiveContent(file)) return false;
  const ext = path.extname(file.originalname).toLowerCase();
  return PUBLIC_REQUEST_FILE_EXTENSIONS.includes(ext) && ALLOWED_FILE_MIME_TYPES.has(file.mimetype);
}

function rejection(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const randomName = ext => `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`;

const privateStorage = multer.diskStorage({
  destination: (req, file, done) => done(null, PRIVATE_UPLOADS_DIR),
  filename:    (req, file, done) => done(null, randomName(path.extname(file.originalname).toLowerCase())),
});

/**
 * A personal link's optional `image` (its icon) and optional `file` (its
 * attachment). Only accepted from a signed-in member — the route puts
 * requireAuth in front of this, so a stranger never gets to write bytes here.
 *
 * Multer has no per-field size limit, so the icon's smaller cap is enforced by
 * the controller after the fact; the limit here is the larger of the two.
 */
const uploadPersonalPayload = multer({
  storage: privateStorage,
  limits:  { fileSize: PERSONAL_FILE_LIMIT, files: 2 },
  fileFilter: (req, file, done) => {
    if (file.fieldname === 'image') {
      return isAllowedPersonalImage(file)
        ? done(null, true)
        : done(rejection('An icon must be a jpg, png, gif or webp image'));
    }
    if (file.fieldname === 'file') {
      return isAllowedPersonalAttachment(file)
        ? done(null, true)
        : done(rejection('That kind of file cannot be attached'));
    }
    done(rejection(`Unexpected field "${file.fieldname}"`));
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'file',  maxCount: 1 },
]);

/**
 * The absolute path of a stored filename, or null if it would land anywhere
 * other than directly inside the private directory.
 */
function resolvePrivateFilePath(filename) {
  if (!filename || typeof filename !== 'string') return null;
  const base = path.basename(filename);
  if (base !== filename || base === '.' || base === '..') return null;

  const full = path.join(PRIVATE_UPLOADS_DIR, base);
  if (path.dirname(full) !== PRIVATE_UPLOADS_DIR) return null;
  return full;
}

/** Writes bytes the server produced itself — a fetched favicon. */
function writePrivateFile(buffer, ext) {
  const filename = randomName(ext);
  fs.writeFileSync(path.join(PRIVATE_UPLOADS_DIR, filename), buffer, { mode: 0o600 });
  return filename;
}

/**
 * Removes a private file. Returns a promise so a caller that needs the disk to
 * be clean before it answers — a test, an account deletion — can wait for it;
 * everything else may let it run.
 */
function deletePrivateFile(filename) {
  const full = resolvePrivateFilePath(filename);
  if (!full) return Promise.resolve();
  return fs.promises.unlink(full).catch(err => {
    if (err.code !== 'ENOENT') console.error(`[private-files] could not delete ${filename}: ${err.message}`);
  });
}

function deletePrivateFiles(filenames) {
  return Promise.all((filenames || []).map(deletePrivateFile));
}

module.exports = {
  uploadPersonalPayload,
  PERSONAL_FILE_LIMIT, PERSONAL_ICON_LIMIT,
  resolvePrivateFilePath, writePrivateFile,
  deletePrivateFile, deletePrivateFiles,
};
