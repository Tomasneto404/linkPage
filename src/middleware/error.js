// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Express error handler — keeps multer / upload errors as nice JSON 400s
 * instead of the default HTML stack-trace page.
 */

const multer = require('multer');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File is too large' });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err && err.message && /^(Only image files|Custom icon must|File type not allowed|Unexpected field)/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }

  // express.json() rejections: a truncated payload or one over the size limit is
  // the caller's mistake, not a server fault, and must not be reported as a 500.
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
