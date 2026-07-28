/**
 * Environment configuration and shared paths.
 *
 * Every environment variable the app reads is resolved here once, with its
 * default, so no other module re-reads process.env or recomputes a path (which
 * previously drifted between server.js and database.js).
 */

const path = require('path');
const fs   = require('fs');

const { version: CURRENT_VERSION } = require('../../package.json');

const PORT = process.env.PORT || 3000;

const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, '..', '..', 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR  = path.join(__dirname, '..', '..', 'public');

// Where to look for new releases. Overridable so forks/private mirrors can
// point at their own repo.
const RELEASES_REPO = process.env.RELEASES_REPO || 'Tomasneto404/linkPage';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const divider = '─'.repeat(54);

module.exports = {
  PORT,
  DATA_DIR,
  UPLOADS_DIR,
  PUBLIC_DIR,
  RELEASES_REPO,
  CURRENT_VERSION,
  divider,
};
