// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin-only markdown preview, backing the Source/Preview toggle in the editor. */

const { renderMarkdown } = require('../services/markdownService');
const { FILE_EDIT_MAX_BYTES } = require('../config/constants');

/**
 * Renders a buffer of markdown to the same HTML a reader would get.
 *
 * Deliberately the one implementation: the editor previews through this rather
 * than a second copy in the browser, so what the admin approves is what gets
 * served.
 */
function preview(req, res) {
  const { text } = req.body || {};
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'A "text" string is required' });
  }
  // Mirrors the editor's own ceiling, so a preview can never be asked to do
  // more work than the file behind it.
  if (Buffer.byteLength(text, 'utf8') > FILE_EDIT_MAX_BYTES) {
    return res.status(413).json({ error: 'That document is too large to preview' });
  }

  res.json({ html: renderMarkdown(text) });
}

module.exports = { preview };
