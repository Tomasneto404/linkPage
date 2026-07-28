/**
 * Long-lived server secrets: the admin token and the group-unlock signing key.
 *
 * Both persist to disk under DATA_DIR so they survive restarts. The admin token
 * is mutable at runtime (rotate-token), so it lives behind get/set/rotate
 * helpers rather than a bare export — every consumer reads the current value
 * through getAdminToken() and can never hold a stale copy.
 */

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

const { DATA_DIR } = require('./env');

// ─── Admin token ──────────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(DATA_DIR, 'admin-token.txt');

/** Reads the existing token from disk, or generates and saves a new one. */
function loadOrCreateAdminToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  }
  const newToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, newToken, { mode: 0o600 });
  return newToken;
}

// Mutable so it can be rotated at runtime.
let adminToken = loadOrCreateAdminToken();

function getAdminToken() {
  return adminToken;
}

/** Generates a new admin token, persists it, updates the in-memory value. */
function rotateAdminToken() {
  const newToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, newToken, { mode: 0o600 });
  adminToken = newToken;
  return newToken;
}

// ─── Group unlock secret ──────────────────────────────────────────────────────

/**
 * Long-lived secret used to HMAC-sign per-group "unlocked" cookies.
 * Persists across restarts so users stay unlocked.
 */
const GROUP_SECRET_FILE = path.join(DATA_DIR, 'group-secret.txt');
function loadOrCreateGroupSecret() {
  if (fs.existsSync(GROUP_SECRET_FILE)) {
    return fs.readFileSync(GROUP_SECRET_FILE, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(GROUP_SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}
const GROUP_SECRET = loadOrCreateGroupSecret();

/**
 * How long a group stays unlocked after a successful password verification.
 * Short on purpose: protected groups re-lock so a walk-away user doesn't
 * leave the page exposed.
 */
const GROUP_UNLOCK_TTL_MS = 30 * 1000;

// Far-future signed expiry used for session-mode cookies. The cookie itself
// is browser-session-bound (no Max-Age), so it disappears when the user closes
// the browser; this value just keeps the HMAC payload valid until then.
const GROUP_SESSION_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

module.exports = {
  TOKEN_FILE,
  getAdminToken,
  rotateAdminToken,
  GROUP_SECRET,
  GROUP_UNLOCK_TTL_MS,
  GROUP_SESSION_EXPIRY_MS,
};
