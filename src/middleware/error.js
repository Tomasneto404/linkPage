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

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
