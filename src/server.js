/**
 * Express HTTP server — routes, authentication, and file uploads.
 *
 * Security notes:
 *  - Admin token is compared with crypto.timingSafeEqual to prevent timing attacks.
 *  - Uploaded files are validated by both extension AND MIME type.
 *  - File deletion is confined to the uploads directory (path traversal prevention).
 *  - All URLs are validated to use http/https before being stored.
 *  - Group colors are validated as hex strings before being stored.
 *  - Parameterized SQL (in database.js) prevents SQL injection.
 *  - Security headers are added to every response.
 *  - Rate limiting prevents brute-force on auth and click spam.
 */

const express = require('express');
const multer  = require('multer');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const db      = require('./database');

const { version: CURRENT_VERSION } = require('../package.json');
// Where to look for new releases. Overridable so forks/private mirrors can
// point at their own repo.
const RELEASES_REPO = process.env.RELEASES_REPO || 'Tomasneto404/linkPage';

const app  = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

// Mutable so it can be rotated at runtime
let ADMIN_TOKEN = loadOrCreateAdminToken();

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

/**
 * Builds an unlock cookie value: `<expiry-ms>.<hmac>`.
 * The expiry is part of the signed payload, so a client can't bump it.
 */
function signGroupUnlock(groupId, expMs) {
  const hmac = crypto
    .createHmac('sha256', GROUP_SECRET)
    .update(`${groupId}:${expMs}`)
    .digest('hex');
  return `${expMs}.${hmac}`;
}

/** Parses a Cookie header into an object. Tolerant of malformed input. */
function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(part.slice(idx + 1).trim()); }
    catch { /* ignore malformed value */ }
  }
  return out;
}

/**
 * Returns a Map of group_id → expiry-timestamp-ms for every group the request
 * has successfully unlocked and whose token hasn't expired yet.
 */
function getUnlockedGroupExpiries(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const now     = Date.now();
  const out     = new Map();

  for (const [name, value] of Object.entries(cookies)) {
    const match = name.match(/^lp_grp_(\d+)$/);
    if (!match) continue;

    const gid = Number(match[1]);
    const dot = value.indexOf('.');
    if (dot < 0) continue;

    const expMs = Number(value.slice(0, dot));
    const sig   = value.slice(dot + 1);
    if (!Number.isFinite(expMs) || expMs <= now) continue;

    const expected = crypto
      .createHmac('sha256', GROUP_SECRET)
      .update(`${gid}:${expMs}`)
      .digest('hex');

    if (sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      out.set(gid, expMs);
    }
  }
  return out;
}

/** Convenience wrapper that returns just the Set of unlocked IDs. */
function getUnlockedGroupIds(req) {
  return new Set(getUnlockedGroupExpiries(req).keys());
}

// Migrate old single-logo setting to the new light/dark format
const oldLogoPath = db.readSetting('logo_path');
if (oldLogoPath && !db.readSetting('logo_light')) {
  db.writeSetting('logo_light', oldLogoPath);
  db.deleteSetting('logo_path');
}

const divider = '─'.repeat(54);
console.log(`\n┌${divider}┐`);
console.log(`│  🔑 Admin Token: ${ADMIN_TOKEN}`);
console.log(`│  🌐 Public URL:  http://localhost:${PORT}/`);
console.log(`│  ⚙️  Admin URL:   http://localhost:${PORT}/admin`);
console.log(`└${divider}┘\n`);

// ─── Security helpers ─────────────────────────────────────────────────────────

/**
 * Extracts the real client IP address.
 * Checks X-Forwarded-For first so it works correctly behind reverse proxies.
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Compares a provided token against the admin token in constant time,
 * preventing timing attacks that could reveal how much of the token matched.
 */
function isValidAdminToken(providedToken) {
  if (typeof providedToken !== 'string') return false;
  if (providedToken.length !== ADMIN_TOKEN.length) return false;

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const expectedBuffer = Buffer.from(ADMIN_TOKEN,  'utf8');
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Compares a provided password against the stored public password in constant time.
 * Returns false if no public password is configured (meaning access is open).
 */
function isValidPublicPassword(provided) {
  const stored = db.readSetting('public_password');
  if (!stored) return false;
  if (typeof provided !== 'string') return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(stored,   'utf8');

  // If lengths differ we still run the comparison to avoid timing-based length detection
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

/** Returns true if the URL uses http or https. */
function isValidHttpUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Returns true if the value is a valid 3- or 6-digit CSS hex color. */
function isValidHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);
}

/**
 * Parses the group membership payload, preferring the richer `groups` shape
 * (with per-group section_id) and falling back to legacy `group_ids`.
 *
 * Returns:
 *   undefined → request didn't include any group field (leave untouched)
 *   []        → request explicitly cleared all memberships
 *   array of { group_id: number, section_id: number|null }
 */
function parseGroupAssignments(body) {
  if (body.groups !== undefined) {
    let raw = body.groups;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed === 'null') return [];
      try { raw = JSON.parse(trimmed); }
      catch { return []; }
    }
    if (!Array.isArray(raw)) return [];

    const out  = [];
    const seen = new Set();
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const gid = Number(entry.id ?? entry.group_id);
      if (!Number.isFinite(gid) || gid <= 0 || seen.has(gid)) continue;
      seen.add(gid);
      let sid = entry.section_id;
      sid = (sid === null || sid === undefined) ? null : Number(sid);
      if (sid !== null && (!Number.isFinite(sid) || sid <= 0)) sid = null;
      out.push({ group_id: gid, section_id: sid });
    }
    return out;
  }

  // Legacy plain-IDs shape — no section info.
  const legacy = parseGroupIds(body);
  if (legacy === undefined) return undefined;
  return legacy.map(id => ({ group_id: id, section_id: null }));
}

/**
 * Parses a list of group IDs from a request body, accepting any of:
 *  - body.group_ids as a JSON-encoded array (sent via FormData)
 *  - body.group_ids as a real array (sent via JSON)
 *  - body.group_id as a single value (legacy single-group payload)
 *
 * Returns an array of positive integers, or undefined if the request didn't
 * include any group field at all (so updateLink leaves memberships untouched).
 */
function parseGroupIds(body) {
  let raw = body.group_ids;

  if (raw === undefined && body.group_id !== undefined) {
    raw = body.group_id;
  }
  if (raw === undefined) return undefined;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === 'null') return [];
    if (trimmed.startsWith('[')) {
      try { raw = JSON.parse(trimmed); }
      catch { return []; }
    } else {
      raw = [trimmed];
    }
  }

  if (!Array.isArray(raw)) raw = [raw];

  const seen = new Set();
  const out  = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'];
const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/x-icon', 'image/vnd.microsoft.icon',
];

/** Returns true if the uploaded file is an allowed image type. */
function isAllowedImage(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(extension) &&
         ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype);
}

// Files a link can point to instead of a URL. Keeps risky types (.exe, .sh,
// .js, etc.) out of the uploads directory.
const ALLOWED_FILE_EXTENSIONS = [
  '.pdf',
  '.doc', '.docx', '.odt', '.rtf',
  '.xls', '.xlsx', '.ods', '.csv',
  '.ppt', '.pptx', '.odp',
  '.txt', '.md', '.log',
  '.zip', '.7z', '.tar', '.gz',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.htm', '.html', '.xml', '.json',
];
const ALLOWED_FILE_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/rtf', 'text/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain', 'text/markdown',
  'application/zip', 'application/x-zip-compressed',
  'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'text/html', 'application/xhtml+xml',
  'text/xml', 'application/xml',
  'application/json', 'text/json',
  // Browsers sometimes report an unknown type for less-common but safe files
  // (e.g. .md, .log). The extension whitelist still applies, so this is safe.
  'application/octet-stream',
]);

function isAllowedAttachment(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.includes(ext) && ALLOWED_FILE_MIME_TYPES.has(file.mimetype);
}

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

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * Creates a rate limiter middleware using a sliding window per IP.
 * @param {number} maxRequests - Maximum requests allowed per window
 * @param {number} windowMs    - Window duration in milliseconds
 */
function createRateLimiter(maxRequests, windowMs) {
  const store = new Map(); // ip → { count, windowStart }

  // Clean up expired entries periodically to prevent memory growth
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now - entry.windowStart > windowMs) store.delete(ip);
    }
  }, windowMs);

  return function rateLimitMiddleware(req, res, next) {
    const ip  = getClientIp(req);
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      store.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
    }

    entry.count++;
    return next();
  };
}

const authRateLimit  = createRateLimiter(10, 5 * 60 * 1000); // 10 per 5 minutes (legacy)
const clickRateLimit = createRateLimiter(30, 60 * 1000);      // 30 per minute

/**
 * Failure-only rate limiter for auth endpoints.
 *
 * Successful verifications must not count toward the budget — otherwise a
 * legitimate admin refreshing the page a few times exhausts the limit and
 * gets locked out of their own session. Brute-force attempts still trip the
 * limit since every wrong token is a failure.
 *
 * Returns an object with two methods:
 *   isLimited(req)    → true if this IP has used up its failure budget
 *   recordFailure(req) → increments the counter for this IP
 */
function createFailureRateLimiter(maxFailures, windowMs) {
  const store = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store.entries()) {
      if (now - entry.windowStart > windowMs) store.delete(ip);
    }
  }, windowMs);

  return {
    isLimited(req) {
      const entry = store.get(getClientIp(req));
      if (!entry) return false;
      if (Date.now() - entry.windowStart > windowMs) return false;
      return entry.count >= maxFailures;
    },
    recordFailure(req) {
      const ip  = getClientIp(req);
      const now = Date.now();
      const entry = store.get(ip);
      if (!entry || now - entry.windowStart > windowMs) {
        store.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count++;
      }
    },
  };
}

const adminAuthLimiter    = createFailureRateLimiter(20, 5 * 60 * 1000);
const publicAuthLimiter   = createFailureRateLimiter(20, 5 * 60 * 1000);
const groupUnlockLimiter  = createFailureRateLimiter(15, 5 * 60 * 1000);
const requestAuthLimiter  = createFailureRateLimiter(15, 5 * 60 * 1000);

// Throttles public link-request submissions so the open endpoint can't be
// spammed into filling the DB. 10 submissions per 10 minutes per IP.
const requestSubmitLimiter = createRateLimiter(10, 10 * 60 * 1000);

// ─── Auth middleware ──────────────────────────────────────────────────────────

/** Rejects requests that do not include a valid admin token header. */
function requireAdminToken(req, res, next) {
  if (isValidAdminToken(req.headers['x-admin-token'])) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Rejects requests if a public password is configured and not provided correctly.
 * Admin token always bypasses this check so the admin panel always works.
 */
function requirePublicAuth(req, res, next) {
  // Admin token bypasses the public password gate
  if (isValidAdminToken(req.headers['x-admin-token'])) return next();

  const publicPassword = db.readSetting('public_password');
  if (!publicPassword) return next(); // No password configured — open access

  const provided = req.headers['x-public-password'] || '';
  if (isValidPublicPassword(provided)) return next();

  res.status(401).json({ error: 'Password required' });
}

// ─── File upload ──────────────────────────────────────────────────────────────

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

// ─── Express setup ────────────────────────────────────────────────────────────

// 32 MB headroom: the icon-library import embeds base64 image bytes inline,
// which can add up for a large library. All JSON write routes are admin-gated.
app.use(express.json({ limit: '32mb' }));

// Basic security headers on every response
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOADS_DIR, {
  // ETag-based revalidation. After editing an attached file the bytes change
  // but the URL stays the same; no-cache forces every browser to re-check
  // with us so it can never serve a stale copy of an edited file.
  etag:         true,
  lastModified: true,
  setHeaders:   res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));

// ─── Live update channel (Server-Sent Events) ────────────────────────────────
//
// The public page subscribes to /api/events and re-renders whenever an admin
// mutation finishes. Lightweight — single bus, no per-event payload (we just
// signal "data changed"; the client re-fetches the canonical state).

const sseClients = new Set();

function broadcastDataUpdate() {
  const payload = `event: data\ndata: ${Date.now()}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* client gone, will be cleaned up on close */ }
  }
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache, no-transform',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Opening comment flushes headers immediately so the EventSource readyState
  // flips to OPEN without waiting for the first real event.
  res.write(': ok\n\n');
  // Tell the browser to back off if the connection drops (default is 3 s).
  res.write('retry: 4000\n\n');

  sseClients.add(res);

  // Keep proxies happy — many drop idle SSE connections after ~30 s.
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// ─── Audit log ────────────────────────────────────────────────────────────
//
// Every successful admin mutation is recorded with a human-readable summary.
// Handlers don't need to call anything — a single finish-listener derives the
// entry from the route, params, and (already-parsed) body. Handlers MAY set
// `req._auditSummary` / `req._auditAction` to override the derived text.

function truncate(s, n = 80) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Builds an audit entry { action, entityType, entityId, summary } from a
 * finished request, or null if this route shouldn't be audited. Runs on
 * 'finish', so req.body (JSON or multipart) is fully populated.
 */
function deriveAuditEntry(req) {
  const p    = req.path;
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  // /api/<thing>/<id>... — pull the first numeric path segment as entity id.
  const idMatch = p.match(/\/(\d+)(?:\/|$)/);
  const id = idMatch ? Number(idMatch[1]) : null;
  const M = req.method;

  // Resolve a friendly entity name: prefer the request body's `name`, else
  // look it up live from the DB (the row still exists for non-delete actions).
  const lookupName = (type) => {
    if (!Number.isFinite(id)) return null;
    try {
      if (type === 'link')    return db.getLinkById(id)?.name ?? null;
      if (type === 'group')   return db.getGroupById(id)?.name ?? null;
      if (type === 'section') return db.getSectionById(id)?.name ?? null;
    } catch { /* fall through */ }
    return null;
  };
  // label + best-known name; falls back to "#id" only when no name is findable.
  const named = (label, type) => {
    const nm = name || lookupName(type);
    return nm ? `${label} "${truncate(nm)}"` : `${label} #${id ?? '?'}`;
  };

  // Links
  if (p === '/api/links' && M === 'POST')                return { action: 'link.create',  entityType: 'link',    entityId: id, summary: named('Created link', 'link') };
  if (/^\/api\/links\/\d+$/.test(p) && M === 'PUT')      return { action: 'link.update',  entityType: 'link',    entityId: id, summary: named('Updated link', 'link') };
  if (/^\/api\/links\/\d+$/.test(p) && M === 'DELETE')   return { action: 'link.delete',  entityType: 'link',    entityId: id, summary: named('Deleted link', 'link') };
  if (/^\/api\/links\/\d+\/visibility$/.test(p)) {
    const nm   = lookupName('link');
    const who  = nm ? `"${truncate(nm)}"` : `link #${id}`;
    const hid  = db.getLinkById(id)?.is_hidden;
    const verb = hid === 1 ? 'Hid' : hid === 0 ? 'Showed' : 'Toggled visibility of';
    return { action: 'link.visibility', entityType: 'link', entityId: id, summary: `${verb} ${who}` };
  }
  if (/^\/api\/links\/\d+\/file$/.test(p))               return { action: 'link.file_edit', entityType: 'link', entityId: id, summary: named('Edited file of', 'link') };
  if (p === '/api/links/reorder')                        return { action: 'link.reorder', entityType: 'link',    entityId: null, summary: 'Reordered links' };
  if (p === '/api/links/bulk-delete') {
    const n = Array.isArray(body.ids) ? body.ids.length : null;
    return { action: 'link.bulk_delete', entityType: 'link', entityId: null, summary: n ? `Bulk-deleted ${n} link${n !== 1 ? 's' : ''}` : 'Bulk-deleted links' };
  }
  if (p === '/api/links/import')                         return { action: 'link.import',  entityType: 'link',    entityId: null, summary: 'Imported links from file' };

  // Groups
  if (p === '/api/groups' && M === 'POST')               return { action: 'group.create', entityType: 'group',   entityId: id, summary: named('Created group', 'group') };
  if (/^\/api\/groups\/\d+$/.test(p) && M === 'PUT')     return { action: 'group.update', entityType: 'group',   entityId: id, summary: named('Updated group', 'group') };
  if (/^\/api\/groups\/\d+$/.test(p) && M === 'DELETE')  return { action: 'group.delete', entityType: 'group',   entityId: id, summary: named('Deleted group', 'group') };
  if (p === '/api/groups/reorder')                       return { action: 'group.reorder', entityType: 'group',  entityId: null, summary: 'Reordered groups' };

  // Sections
  if (/^\/api\/groups\/\d+\/sections$/.test(p))          return { action: 'section.create', entityType: 'section', entityId: id, summary: named('Created section', 'section') };
  if (/^\/api\/sections\/\d+$/.test(p) && M === 'PUT')   return { action: 'section.update', entityType: 'section', entityId: id, summary: named('Renamed section', 'section') };
  if (/^\/api\/sections\/\d+$/.test(p) && M === 'DELETE')return { action: 'section.delete', entityType: 'section', entityId: id, summary: named('Deleted section', 'section') };
  if (p === '/api/sections/reorder')                     return { action: 'section.reorder', entityType: 'section', entityId: null, summary: 'Reordered sections' };

  // Icons
  if (p === '/api/icons' && M === 'POST')                return { action: 'icon.create',  entityType: 'icon',    entityId: null, summary: 'Added an icon to the library' };
  if (p === '/api/icons/import')                         return { action: 'icon.import',  entityType: 'icon',    entityId: null, summary: 'Imported an icon library' };
  if (p === '/api/icons/bulk-delete') {
    const n = Array.isArray(body.ids) ? body.ids.length : null;
    return { action: 'icon.bulk_delete', entityType: 'icon', entityId: null, summary: n ? `Bulk-deleted ${n} icon${n !== 1 ? 's' : ''}` : 'Bulk-deleted icons' };
  }
  if (/^\/api\/icons\/\d+$/.test(p) && M === 'DELETE')   return { action: 'icon.delete',  entityType: 'icon',    entityId: id, summary: `Deleted icon #${id} from the library` };

  // Settings
  if (/^\/api\/settings\/logo\//.test(p))                return { action: 'settings.logo', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed a logo' : 'Updated a logo' };
  if (p === '/api/settings/favicon')                     return { action: 'settings.favicon', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the favicon' : 'Updated the favicon' };
  if (p === '/api/settings/site-title')                  return { action: 'settings.site_title', entityType: 'settings', entityId: null, summary: 'Updated the site title' };
  if (p === '/api/settings/pinned-group')                return { action: 'settings.pinned_group', entityType: 'settings', entityId: null, summary: 'Changed the default group' };
  if (p === '/api/settings/save-favicons')               return { action: 'settings.save_favicons', entityType: 'settings', entityId: null, summary: 'Toggled saving fetched favicons' };
  if (p === '/api/settings/public-password')             return { action: 'settings.public_password', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the public password' : 'Set the public password' };
  if (p === '/api/settings/requests-enabled')            return { action: 'settings.requests_enabled', entityType: 'settings', entityId: null, summary: 'Toggled the link-request feature' };
  if (p === '/api/settings/request-password')            return { action: 'settings.request_password', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the request password' : 'Set the request password' };

  // Link requests (public submit + admin review)
  if (p === '/api/link-requests' && M === 'POST')             return { action: 'request.create',  entityType: 'request', entityId: null, summary: name ? `New link request "${truncate(name)}"` : 'New link request' };
  if (/^\/api\/link-requests\/\d+\/approve$/.test(p))         return { action: 'request.approve', entityType: 'request', entityId: id, summary: `Approved link request #${id}` };
  if (/^\/api\/link-requests\/\d+\/reject$/.test(p))          return { action: 'request.reject',  entityType: 'request', entityId: id, summary: `Rejected link request #${id}` };
  if (/^\/api\/link-requests\/\d+$/.test(p) && M === 'DELETE') return { action: 'request.delete',  entityType: 'request', entityId: id, summary: `Deleted link request #${id}` };

  // Auth
  if (p === '/api/auth/rotate-token')                    return { action: 'auth.rotate_token', entityType: 'auth', entityId: null, summary: 'Rotated the admin token' };

  // Audit log itself (clear/prune) — recorded so the clearing is traceable.
  if (p === '/api/audit' && M === 'DELETE')              return { action: 'audit.clear', entityType: 'audit', entityId: null, summary: 'Cleared the audit log' };

  // Anything else under /api that mutated — generic fallback.
  return { action: `${M.toLowerCase()} ${p}`, entityType: null, entityId: id, summary: `${M} ${p}` };
}

function writeAuditFromRequest(req) {
  try {
    const derived = deriveAuditEntry(req);
    if (!derived) return;
    db.recordAudit({
      action:     req._auditAction  || derived.action,
      entityType: derived.entityType,
      entityId:   derived.entityId,
      summary:    req._auditSummary || derived.summary,
      ipAddress:  getClientIp(req),
      userAgent:  req.headers['user-agent'] || null,
    });
  } catch { /* never let audit logging break a request */ }
}

// Fires broadcastDataUpdate() + records an audit entry after any successful
// admin mutation on /api/*. Skips read-only methods, auth flows, the SSE
// endpoint itself, and the publicly-callable group unlock.
const SSE_BROADCAST_SKIP = new Set([
  '/api/events',
  '/api/auth/verify',
  '/api/auth/verify-public',
]);
// These mutate but should NOT broadcast a public data refresh (no public
// effect) — they're still audited.
const AUDIT_ONLY_PATHS = new Set([
  '/api/auth/rotate-token',
  '/api/audit',
]);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (SSE_BROADCAST_SKIP.has(req.path)) return next();
  if (/^\/api\/groups\/\d+\/unlock$/.test(req.path)) return next();

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    writeAuditFromRequest(req);
    if (!AUDIT_ONLY_PATHS.has(req.path)) broadcastDataUpdate();
  });
  next();
});

app.get('/admin', (req, res) =>
  res.sendFile(path.resolve(__dirname, '..', 'public', 'admin', 'index.html')));

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/verify', (req, res) => {
  if (adminAuthLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  if (isValidAdminToken(token)) {
    return res.json({ valid: true });
  }
  adminAuthLimiter.recordFailure(req);
  res.json({ valid: false });
});

app.post('/api/auth/verify-public', (req, res) => {
  if (publicAuthLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const stored   = db.readSetting('public_password');

  if (!stored) {
    // No password configured — always valid
    return res.json({ valid: true });
  }

  if (isValidPublicPassword(password)) {
    return res.json({ valid: true });
  }
  publicAuthLimiter.recordFailure(req);
  res.json({ valid: false });
});

/** Generates a new admin token, saves it to disk, and returns it. */
app.post('/api/auth/rotate-token', requireAdminToken, (req, res) => {
  const newToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, newToken, { mode: 0o600 });
  ADMIN_TOKEN = newToken;

  console.log(`\n┌${divider}┐`);
  console.log(`│  🔑 Token rotated! New token: ${newToken}`);
  console.log(`└${divider}┘\n`);

  res.json({ token: newToken });
});

// ─── Settings (public) ────────────────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  const publicPassword = db.readSetting('public_password');
  const pinnedRaw      = db.readSetting('pinned_group_id');
  const pinnedId       = pinnedRaw && Number.isFinite(Number(pinnedRaw)) ? Number(pinnedRaw) : null;
  res.json({
    logo_light:               db.readSetting('logo_light') ?? null,
    logo_dark:                db.readSetting('logo_dark')  ?? null,
    favicon:                  db.readSetting('favicon')    ?? null,
    site_title:               db.readSetting('site_title') ?? null,
    public_password_required: !!publicPassword,
    pinned_group_id:          pinnedId,
    save_favicons_to_library: db.readSetting('save_favicons_to_library') === '1',
    requests_enabled:          db.readSetting('requests_enabled') === '1',
    request_password_required: !!db.readSetting('request_password'),
  });
});

// ─── Settings (admin only) ────────────────────────────────────────────────────

const LOGO_VARIANTS = ['light', 'dark'];

app.post('/api/settings/logo/:variant', requireAdminToken, upload.single('logo'), (req, res) => {
  const { variant } = req.params;
  if (!LOGO_VARIANTS.includes(variant)) {
    return res.status(400).json({ error: 'Variant must be "light" or "dark"' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No image file was provided' });
  }

  const settingKey   = `logo_${variant}`;
  const existingPath = db.readSetting(settingKey);
  if (existingPath) safeDeleteFile(existingPath);

  const newPath = `/uploads/${req.file.filename}`;
  db.writeSetting(settingKey, newPath);
  res.json({ logo_url: newPath });
});

app.delete('/api/settings/logo/:variant', requireAdminToken, (req, res) => {
  const { variant } = req.params;
  if (!LOGO_VARIANTS.includes(variant)) {
    return res.status(400).json({ error: 'Variant must be "light" or "dark"' });
  }

  const settingKey   = `logo_${variant}`;
  const existingPath = db.readSetting(settingKey);
  if (existingPath) {
    safeDeleteFile(existingPath);
    db.deleteSetting(settingKey);
  }

  res.status(204).end();
});

app.post('/api/settings/favicon', requireAdminToken, upload.single('favicon'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file was provided' });

  const existing = db.readSetting('favicon');
  // Don't delete the previous favicon if the icon library still references it.
  if (existing) safeDeleteFileUnlessLibrary(existing);

  const newPath = `/uploads/${req.file.filename}`;
  db.writeSetting('favicon', newPath);

  // Make the Settings favicon reusable from the icon library too.
  db.createIcon({
    filePath:     newPath,
    originalName: req.file.originalname || 'Site favicon',
    mimeType:     req.file.mimetype,
    fileSize:     req.file.size,
  });

  res.json({ favicon: newPath });
});

app.delete('/api/settings/favicon', requireAdminToken, (req, res) => {
  const existing = db.readSetting('favicon');
  if (existing) {
    // Keep the file if it lives in the icon library; just unset the setting.
    safeDeleteFileUnlessLibrary(existing);
    db.deleteSetting('favicon');
  }
  res.status(204).end();
});

// ─── Version / update check ──────────────────────────────────────────────────
//
// Polls GitHub Releases for newer tags. Cached in-process so the admin page
// can hit /api/version on every load without burning GitHub's 60/hour
// anonymous rate limit. Cache TTL is generous (6 h) because LinkPage updates
// aren't time-sensitive — if a release just dropped the admin can refresh.

const VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let versionCache = null;     // { fetchedAt, data }

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.\-]/).map(s => Number(s) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.\-]/).map(s => Number(s) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const dbb = pb[i] || 0;
    if (da > dbb) return 1;
    if (da < dbb) return -1;
  }
  return 0;
}

async function fetchReleasesFromGitHub() {
  const url = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'Accept':        'application/vnd.github+json',
        'User-Agent':    `LinkPage/${CURRENT_VERSION}`,
        // Help the GitHub API stay forward-compatible.
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    return list
      .filter(r => r && !r.draft && !r.prerelease)
      .map(r => ({
        tag:          r.tag_name,
        name:         r.name,
        body:         r.body,
        published_at: r.published_at,
        html_url:     r.html_url,
      }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildVersionPayload({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && versionCache && (now - versionCache.fetchedAt) < VERSION_CACHE_TTL_MS) {
    return versionCache.data;
  }
  const releases = await fetchReleasesFromGitHub();
  let data;
  if (!releases) {
    data = {
      current:          CURRENT_VERSION,
      latest:           null,
      update_available: false,
      newer_releases:   [],
      releases_url:     `https://github.com/${RELEASES_REPO}/releases`,
      error:            'github_unreachable',
    };
  } else {
    const latestTag = releases[0]?.tag ?? null;
    const latest    = latestTag ? latestTag.replace(/^v/, '') : null;
    const newer     = releases.filter(r => compareSemver(r.tag, CURRENT_VERSION) > 0);
    data = {
      current:          CURRENT_VERSION,
      latest,
      update_available: !!latest && compareSemver(latest, CURRENT_VERSION) > 0,
      newer_releases:   newer,
      releases_url:     `https://github.com/${RELEASES_REPO}/releases`,
    };
  }
  versionCache = { fetchedAt: now, data };
  return data;
}

app.get('/api/version', requireAdminToken, async (req, res) => {
  const force = req.query.refresh === '1';
  res.json(await buildVersionPayload({ forceRefresh: force }));
});

// ─── Favicon preview (live preview in the link form, admin only) ────────────

/**
 * Streams the best-effort favicon for a given URL. Used by the link-modal's
 * live preview so it works for intranet URLs too. Admin-only to avoid being
 * an SSRF gadget for anonymous callers.
 */
app.get('/api/favicon-preview', requireAdminToken, async (req, res) => {
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
});

// ─── Icon library (admin only) ───────────────────────────────────────────────

app.get('/api/icons', requireAdminToken, (req, res) => {
  res.json(db.getAllIcons());
});

app.post('/api/icons', requireAdminToken, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file was provided' });

  const icon = db.createIcon({
    filePath:     `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    mimeType:     req.file.mimetype,
    fileSize:     req.file.size,
  });
  res.status(201).json({ ...icon, usage_count: 0 });
});

app.delete('/api/icons/:id', requireAdminToken, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid icon ID' });

  const icon = db.getIconById(id);
  const { changes, fileToDelete } = db.deleteIcon(id);
  if (!changes) return res.status(404).json({ error: 'Icon not found' });

  const iconName = icon?.original_name;
  req._auditSummary = iconName
    ? `Deleted icon "${iconName}" from the library`
    : `Deleted icon #${id} from the library`;

  // Don't remove the file from disk if it's still the active Settings favicon
  // (the icon is just unlinked from the library; the favicon keeps working).
  if (fileToDelete && db.readSetting('favicon') !== fileToDelete) {
    safeDeleteFile(fileToDelete);
  }
  res.status(204).end();
});

app.post('/api/icons/bulk-delete', requireAdminToken, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: '"ids" must be an array' });

  let deleted = 0;
  const faviconSetting = db.readSetting('favicon');
  for (const raw of ids) {
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id)) continue;
    const { changes, fileToDelete } = db.deleteIcon(id);
    if (!changes) continue;
    // Same guard as the single delete: keep the active Settings favicon file.
    if (fileToDelete && faviconSetting !== fileToDelete) safeDeleteFile(fileToDelete);
    deleted++;
  }
  res.json({ deleted });
});

// ─── Icon library export / import ─────────────────────────────────────────────

const ICON_IMPORT_MAX_BYTES = 3 * 1024 * 1024;   // per icon
const ICON_EXT_BY_MIME = {
  'image/png':  '.png',  'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg',
  'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
};

/**
 * Exports the whole icon library as a self-contained JSON bundle — each icon's
 * bytes are base64-encoded inline so the file can be re-imported on another
 * instance with no separate asset copy. No new dependencies (no zip).
 */
app.get('/api/icons/export', requireAdminToken, (req, res) => {
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
});

/**
 * Imports an icon-library bundle. Idempotent: each icon's bytes are written to
 * a content-hashed filename, so re-importing the same bundle de-dupes via the
 * icons table's UNIQUE(file_path) constraint.
 */
app.post('/api/icons/import', requireAdminToken, (req, res) => {
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
});

app.post('/api/settings/save-favicons', requireAdminToken, (req, res) => {
  const enabled = !!req.body.enabled;
  if (enabled) db.writeSetting('save_favicons_to_library', '1');
  else         db.deleteSetting('save_favicons_to_library');
  res.json({ save_favicons_to_library: enabled });
});

app.post('/api/settings/site-title', requireAdminToken, (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (title) {
    db.writeSetting('site_title', title);
  } else {
    db.deleteSetting('site_title');
  }
  res.json({ site_title: title || null });
});

/**
 * Sets the group that should be selected by default when a visitor first
 * lands on the public page. Pass `group_id: null` (or omit) to clear it.
 */
app.post('/api/settings/pinned-group', requireAdminToken, (req, res) => {
  const raw = req.body.group_id;
  if (raw === null || raw === undefined || raw === '') {
    db.deleteSetting('pinned_group_id');
    return res.json({ pinned_group_id: null });
  }
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0 || !db.getGroupById(id)) {
    return res.status(400).json({ error: 'Invalid group id' });
  }
  db.writeSetting('pinned_group_id', String(id));
  res.json({ pinned_group_id: id });
});

app.post('/api/settings/public-password', requireAdminToken, (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Password cannot be empty' });
  }
  db.writeSetting('public_password', password);
  res.json({ set: true });
});

app.delete('/api/settings/public-password', requireAdminToken, (req, res) => {
  db.deleteSetting('public_password');
  res.status(204).end();
});

// ─── Link-request feature settings ────────────────────────────────────────────

// Enable/disable the public "Request link" feature.
app.post('/api/settings/requests-enabled', requireAdminToken, (req, res) => {
  const enabled = !!req.body.enabled;
  if (enabled) db.writeSetting('requests_enabled', '1');
  else         db.deleteSetting('requests_enabled');
  res.json({ requests_enabled: enabled });
});

// Sets an optional password required to submit a link request. Stored scrypt-
// hashed (like group passwords), never in cleartext.
app.post('/api/settings/request-password', requireAdminToken, (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Password cannot be empty' });
  }
  db.writeSetting('request_password', db.hashGroupPassword(password));
  res.json({ set: true });
});

app.delete('/api/settings/request-password', requireAdminToken, (req, res) => {
  db.deleteSetting('request_password');
  res.status(204).end();
});

// ─── Favicon download (server-side cache) ────────────────────────────────────

const FAVICON_REQUEST_TIMEOUT_MS = 4500;
const FAVICON_TOTAL_BUDGET_MS    = 8000;   // hard ceiling for the whole favicon hunt
const FAVICON_MAX_HTML_BYTES     = 256 * 1024;
const FAVICON_MAX_IMAGE_BYTES    = 2   * 1024 * 1024;
const FAVICON_USER_AGENT         = 'Mozilla/5.0 (compatible; LinkPage favicon fetcher)';
const FAVICON_EXT_FROM_TYPE = ct => (
  /svg/.test(ct)                                ? '.svg'  :
  /gif/.test(ct)                                ? '.gif'  :
  /webp/.test(ct)                               ? '.webp' :
  /(x-icon|vnd\.microsoft\.icon|^image\/ico\b)/.test(ct) ? '.ico'  :
                                                  '.png'
);

// undici Agent that skips TLS verification, used ONLY by the favicon fetcher
// so intranet sites with self-signed certs resolve correctly. Scoped — every
// other outbound request in this process still verifies certs normally.
const { Agent: UndiciAgent } = require('undici');
const faviconInsecureDispatcher = new UndiciAgent({
  connect:               { rejectUnauthorized: false },
  connectTimeout:        FAVICON_REQUEST_TIMEOUT_MS,
  headersTimeout:        FAVICON_REQUEST_TIMEOUT_MS,
  bodyTimeout:           FAVICON_REQUEST_TIMEOUT_MS,
});

/**
 * fetch() wrapper with a hard timeout, body-size cap, and TLS bypass.
 * Returns the raw Response on success, or null on any failure.
 *
 * `redirect: 'manual'` lets the caller walk redirects step-by-step — fetch's
 * `'follow'` mode has a hidden 20-hop cap that breaks SSO chains looping
 * without cookies. Callers that want the simple follow behaviour can request
 * `redirect: 'follow'`.
 */
async function fetchWithLimits(url, {
  timeoutMs = FAVICON_REQUEST_TIMEOUT_MS,
  maxBytes,
  redirect  = 'follow',
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal:     controller.signal,
      redirect,
      headers:    { 'User-Agent': FAVICON_USER_AGENT, 'Accept': '*/*' },
      // Skip TLS validation — intranet hosts often serve self-signed certs.
      dispatcher: faviconInsecureDispatcher,
    });
    // Don't reject on !res.ok here — image probes deliberately want to read
    // bodies from 4xx responses (e.g. Google's "unknown domain" 404 ships a
    // valid PNG body). HTML/non-image callers re-check res.ok themselves.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Manually follows redirects up to `maxHops` (default 10), stopping on a loop
 * or non-3xx. Calls `onHop(url, response)` for every response (3xx or final).
 * Used to walk SSO chains where Node's built-in redirect handling would either
 * give up at 20 hops or burn time on an infinite OAuth loop.
 */
async function walkRedirects(startUrl, onHop, maxHops = 10) {
  let url = startUrl;
  const visited = new Set();
  for (let i = 0; i < maxHops; i++) {
    if (visited.has(url)) return;
    visited.add(url);

    const res = await fetchWithLimits(url, {
      maxBytes: FAVICON_MAX_HTML_BYTES,
      redirect: 'manual',
    });
    if (!res) return;

    const cont = await onHop(url, res);
    if (cont === false) return;

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return;
      try { url = new URL(loc, url).href; }
      catch { return; }
      continue;
    }
    return; // 2xx/4xx/5xx — the chain is over
  }
}

/**
 * Looks at the first chunk of an HTML page for a declared favicon link.
 * Returns an absolute URL or null. Picks "icon" / "shortcut icon" over
 * "apple-touch-icon" when multiple are present.
 */
function parseDeclaredIconUrl(html, baseUrl) {
  const head = html.slice(0, 64 * 1024);
  const candidates = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRegex.exec(head)) !== null) {
    const tag  = m[0];
    const rel  = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!rel || !href || !rel.includes('icon')) continue;
    const score = rel.includes('apple') ? 1 : (rel.includes('shortcut') ? 2 : 3);
    candidates.push({ score, href });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  try { return new URL(candidates[0].href, baseUrl).href; } catch { return null; }
}

async function fetchHtml(url) {
  const res = await fetchWithLimits(url, { maxBytes: FAVICON_MAX_HTML_BYTES });
  if (!res || !res.ok) return null;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('html')) return null;
  return (await res.text()).slice(0, FAVICON_MAX_HTML_BYTES);
}

/**
 * Walks the redirect chain manually so we can sniff any HTML page along the
 * way for a declared favicon link. Bypasses fetch's hidden redirect cap and
 * stops at loops, so SSO chains that bounce forever don't strand the request.
 * Returns { html, finalUrl, hopOrigins[] } — hopOrigins is every distinct
 * origin/base path visited, so callers can probe each for /favicon.ico fallbacks.
 */
async function collectFaviconCandidatesAlongRedirects(siteUrl) {
  const hopOrigins = new Set();
  const hopBases   = new Set();   // distinct path prefixes, e.g. /ovirt-engine/
  let bestHtml     = null;
  let finalUrl     = siteUrl;

  await walkRedirects(siteUrl, async (url, res) => {
    try {
      const u = new URL(url);
      hopOrigins.add(u.origin);
      // First path segment (e.g. /ovirt-engine) is a useful fallback root.
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) hopBases.add(`${u.origin}/${seg}`);
    } catch {}

    if (res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('html')) {
        // The body of an Apache "Found" 302 page is also text/html, so don't
        // overwrite a real 200 HTML with a redirect-body one.
        const body = (await res.text()).slice(0, FAVICON_MAX_HTML_BYTES);
        if (!bestHtml || res.status === 200) {
          bestHtml = body;
          finalUrl = url;
        }
      }
    }
  });

  return { html: bestHtml, finalUrl, hopOrigins: [...hopOrigins], hopBases: [...hopBases] };
}

async function fetchImageCandidate(url) {
  // Use redirect:'manual' here too so we don't burn the 20-hop budget on
  // /favicon.ico endpoints that lead into the same SSO loop. Follow one
  // explicit hop manually if needed.
  const res = await fetchWithLimits(url, {
    maxBytes: FAVICON_MAX_IMAGE_BYTES,
    redirect: 'follow',
  });
  if (!res) return null;
  const contentType = (res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0].trim().toLowerCase();
  // Reject anything that clearly isn't an image. Note: we accept the response
  // even on 404/5xx as long as the body decodes as an image — Google's favicon
  // API famously serves its "unknown domain" globe with HTTP 404 and the bytes
  // are a perfectly good PNG. Browsers render them; so should we.
  const looksImageish = contentType.startsWith('image/')
                     || contentType === 'application/ico'
                     || contentType === 'application/octet-stream';
  if (!looksImageish) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.byteLength || buffer.byteLength > FAVICON_MAX_IMAGE_BYTES) return null;
  return { buffer, contentType };
}

// Conventional locations a browser would try if nothing is declared in HTML.
const FAVICON_FALLBACK_PATHS = [
  '/favicon.ico',
  '/favicon.png',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/static/favicon.ico',
  '/assets/favicon.ico',
  '/images/favicon.ico',
];

/**
 * Best-effort favicon fetcher. Returns { buffer, contentType } or null.
 *
 *   1. Walk the redirect chain (handling SSO loops) and parse any HTML page
 *      we hit for a declared <link rel="icon">.
 *   2. Probe a wide set of conventional favicon paths at every origin / path
 *      prefix we touched along the way — covers servers that hide /favicon.ico
 *      behind auth but expose one under /<app>/favicon.ico, /static/, etc.
 *   3. Fall back to Google's favicon service for public URLs.
 */
async function fetchFaviconForUrl(siteUrl) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // Overall wall-clock budget for the *entire* favicon hunt. Without this, an
  // unreachable host could chew through the redirect walk plus a dozen
  // fallback paths, each waiting out its own per-request timeout — minutes in
  // the worst case. Once the deadline passes we stop probing and give up.
  const deadline = Date.now() + FAVICON_TOTAL_BUDGET_MS;
  const outOfTime = () => Date.now() >= deadline;

  const { html, finalUrl, hopOrigins, hopBases } =
    await collectFaviconCandidatesAlongRedirects(siteUrl);

  // 1) HTML-declared icon link.
  if (html && !outOfTime()) {
    const declared = parseDeclaredIconUrl(html, finalUrl);
    if (declared) {
      const img = await fetchImageCandidate(declared);
      if (img) return img;
    }
  }

  // 2) Conventional locations under every origin/base we visited.
  const tried = new Set();
  const roots = [parsed.origin, ...hopOrigins, ...hopBases];
  for (const root of roots) {
    if (outOfTime()) return null;
    for (const p of FAVICON_FALLBACK_PATHS) {
      if (outOfTime()) return null;
      const url = `${root.replace(/\/$/, '')}${p}`;
      if (tried.has(url)) continue;
      tried.add(url);
      const img = await fetchImageCandidate(url);
      if (img) return img;
    }
  }

  if (outOfTime()) return null;

  // 3) Google's service — only works for public hostnames.
  return fetchImageCandidate(
    `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`
  );
}

/**
 * Downloads the favicon for a link and saves it locally. Tries the site itself
 * first (so intranet URLs work) and falls back to Google's favicon service.
 *
 * Always run fire-and-forget (never awaited by a request handler) so a slow or
 * unreachable host can't delay the link save. When it *does* land a favicon it
 * broadcasts an SSE update so open admin/public pages refresh and show it.
 */
async function cacheFavicon(linkId, siteUrl) {
  try {
    const found = await fetchFaviconForUrl(siteUrl);
    if (!found) return;

    const { buffer, contentType } = found;
    const hostname = new URL(siteUrl).hostname;
    const ext      = FAVICON_EXT_FROM_TYPE(contentType);
    const filename = `favicon_${linkId}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Remove any previous favicon for this link (different extension), but
    // skip files that the icon library owns — deleting those would orphan rows.
    for (const oldExt of ['.svg', '.gif', '.webp', '.png', '.ico']) {
      const old       = path.join(UPLOADS_DIR, `favicon_${linkId}${oldExt}`);
      const oldStored = `/uploads/favicon_${linkId}${oldExt}`;
      if (old !== filePath && fs.existsSync(old) && !db.getIconByPath(oldStored)) {
        fs.unlinkSync(old);
      }
    }

    fs.writeFileSync(filePath, buffer);
    const storedPath = `/uploads/${filename}`;
    db.updateLinkFavicon(linkId, storedPath);

    if (db.readSetting('save_favicons_to_library') === '1') {
      db.createIcon({
        filePath:     storedPath,
        originalName: `${hostname} favicon`,
        mimeType:     contentType,
        fileSize:     buffer.byteLength,
      });
    }

    // The link was saved earlier without a favicon; nudge open pages so the
    // freshly-cached icon appears without a manual reload.
    broadcastDataUpdate();
  } catch {
    // Favicon caching is best-effort — silently ignore failures
  }
}

// ─── Broken link health checker ───────────────────────────────────────────────

/**
 * Checks whether a URL is reachable by sending a HEAD request.
 * Marks the link as broken in the DB if the request fails or returns 4xx/5xx.
 */
async function checkLinkHealth(linkId, url) {
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      method:   'HEAD',
      signal:   controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    db.updateLinkBrokenStatus(linkId, response.status >= 400);
  } catch {
    db.updateLinkBrokenStatus(linkId, true);
  }
}

/** Checks every link one at a time with a small delay between each request. */
async function runHealthCheck() {
  const links = db.getAllLinksForHealthCheck();
  for (const link of links) {
    await checkLinkHealth(link.id, link.url);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

// Run the first health check 30 seconds after startup, then every 6 hours.
setTimeout(runHealthCheck, 30_000);
setInterval(runHealthCheck, 6 * 60 * 60 * 1000);

// ─── Click tracking ───────────────────────────────────────────────────────────

app.get('/r/:id', clickRateLimit, (req, res) => {
  const linkId = parseInt(req.params.id, 10);
  if (isNaN(linkId)) return res.status(400).send('Invalid link ID');

  const link = db.getLinkById(linkId);
  if (!link) return res.status(404).send('Link not found');

  const isAdmin = isValidAdminToken(req.headers['x-admin-token']);

  // Hidden links are reachable only by admins; everyone else gets bounced home.
  if (link.is_hidden && !isAdmin) {
    return res.redirect(302, '/');
  }

  // Permissive gate: link with no groups is open; otherwise at least one of its
  // groups must be public or unlocked. Admin always bypasses.
  if (!isAdmin && (link.group_ids || []).length > 0) {
    const groups       = db.getAllGroups();
    const protectedIds = new Set(groups.filter(g => g.is_protected).map(g => g.id));
    const unlocked     = getUnlockedGroupIds(req);
    const openVia      = link.group_ids.some(gid => !protectedIds.has(gid) || unlocked.has(gid));
    if (!openVia) {
      return res.redirect(302, '/');
    }
  }

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || null;
  db.recordClick(link.id, ip, ua);

  // Also drop a line in the audit log. Tagged 'click' so it can be filtered
  // separately from admin mutations (clicks are public + higher-volume).
  try {
    db.recordAudit({
      action:     'link.click',
      entityType: 'click',
      entityId:   link.id,
      summary:    `Visited "${truncate(link.name)}"${isAdmin ? ' (admin)' : ''}`,
      ipAddress:  ip,
      userAgent:  ua,
    });
  } catch { /* never block the redirect on a logging failure */ }

  res.setHeader('Cache-Control',   'no-store, no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, link.url);
});

// ─── Audit log (admin only) ───────────────────────────────────────────────────

app.get('/api/audit', requireAdminToken, (req, res) => {
  const limit      = req.query.limit ? Number(req.query.limit) : 200;
  const beforeId   = req.query.before ? Number(req.query.before) : undefined;
  const afterId    = req.query.after ? Number(req.query.after) : undefined;
  const entityType = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
  const search     = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;

  const entries = db.getAuditLog({ limit, beforeId, afterId, entityType, search });
  res.json({
    total:   db.getAuditCount(),
    count:   entries.length,
    entries,
  });
});

app.delete('/api/audit', requireAdminToken, (req, res) => {
  // Optional ?days=N prunes only entries older than N days; otherwise clears all.
  if (req.query.days) {
    const removed = db.pruneAuditLog(Number(req.query.days));
    return res.json({ removed });
  }
  const removed = db.clearAuditLog();
  res.json({ removed });
});

/** Wraps a value for safe inclusion in a CSV cell (RFC-4180 quoting). */
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/audit/export', requireAdminToken, (req, res) => {
  const entityType = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined;
  const search     = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
  const format     = req.query.format === 'json' ? 'json' : 'csv';

  const entries = db.getAuditLogForExport({ entityType, search });
  const stamp   = new Date().toISOString().split('T')[0];

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.json"`);
    return res.send(JSON.stringify({ exported_at: new Date().toISOString(), count: entries.length, entries }, null, 2));
  }

  const cols = ['id', 'created_at', 'action', 'entity_type', 'entity_id', 'summary', 'ip_address', 'user_agent'];
  const lines = [cols.join(',')];
  for (const e of entries) {
    lines.push(cols.map(c => csvCell(e[c])).join(','));
  }
  // Prepend a UTF-8 BOM so Excel opens accented characters correctly.
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// ─── Stats (admin only) ───────────────────────────────────────────────────────

app.get('/api/stats', requireAdminToken, (req, res) => {
  res.json(db.getAllStats());
});

app.get('/api/links/:id/clicks', requireAdminToken, (req, res) => {
  const link = db.getLinkById(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  res.json({
    recentClicks: db.getRecentClicks(req.params.id),
    topIps:       db.getTopIps(req.params.id),
  });
});

// ─── Import / Export (admin only) ────────────────────────────────────────────

/**
 * Exports every link the admin has — name, URL, description, group/section
 * memberships, file attachment metadata, custom icon, favicon, hidden flag,
 * position — plus the full groups & sections hierarchy with colours. Designed
 * so a re-import on a clean instance recreates the same browseable structure.
 *
 * What is intentionally NOT exported:
 *   - group password hashes (security)
 *   - admin token, secrets
 *   - the bytes of uploaded files (binary; back up /uploads alongside this JSON)
 *   - click analytics (per-link history, IPs)
 */
app.get('/api/links/export', requireAdminToken, (req, res) => {
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
      description:  l.description || null,
      position:     l.position,
      is_hidden:    !!l.is_hidden,
      image_path:   l.image_path   || null,
      favicon_path: l.favicon_path || null,
      file_path:    l.file_path    || null,
      file_name:    l.file_name    || null,
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
});

/**
 * Resolves a group by name (case-insensitive). Returns the existing id when
 * found, otherwise creates the group with the supplied colour.
 */
function ensureGroupByName(name, color) {
  const trimmed = (typeof name === 'string' ? name.trim() : '');
  if (!trimmed) return { id: null, created: false };
  const found = db.getAllGroups().find(g => g.name.toLowerCase() === trimmed.toLowerCase());
  if (found) return { id: found.id, created: false };
  const result = db.createGroup({ name: trimmed, color: color || '#0071e3' });
  return { id: result.lastInsertRowid, created: true };
}

/**
 * Same as ensureGroupByName but for a section inside an already-known group.
 * Pass `parentSectionId` to look up / create a subsection. Top-level and
 * sub names share the same column so the case-insensitive lookup is scoped
 * to the right sibling list.
 */
function ensureSectionByName(groupId, name, parentSectionId = null) {
  const trimmed = (typeof name === 'string' ? name.trim() : '');
  if (!trimmed || !groupId) return { id: null, created: false };
  const all = db.getSectionsForGroup(groupId);
  const targetParent = parentSectionId || null;
  const found = all.find(s =>
    s.name.toLowerCase() === trimmed.toLowerCase() &&
    (s.parent_section_id ?? null) === targetParent
  );
  if (found) return { id: found.id, created: false };
  const result = db.createSection({ groupId, name: trimmed, parentSectionId: targetParent });
  return { id: result.lastInsertRowid, created: true };
}

app.post('/api/links/import', requireAdminToken, (req, res) => {
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
    const result = db.createLink({
      name:        item.name.trim(),
      url:         isFileBacked ? item.file_path : trimmedUrl,
      description: item.description?.trim() || null,
      imagePath:   item.image_path || null,
      groupIds:    assignments,
      filePath:    isFileBacked ? item.file_path : null,
      fileName:    isFileBacked ? (item.file_name || null) : null,
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
});

// ─── Reorder (admin only) ─────────────────────────────────────────────────────

app.post('/api/links/reorder', requireAdminToken, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"order" must be an array of numeric IDs' });
  }
  db.reorderLinks(order);
  res.status(204).end();
});

app.post('/api/groups/reorder', requireAdminToken, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"order" must be an array of numeric IDs' });
  }
  db.reorderGroups(order);
  res.status(204).end();
});

// ─── Links (public read) ──────────────────────────────────────────────────────

/**
 * A link is "visible" to a non-admin viewer if it belongs to no groups at all,
 * OR to at least one group that is either public or has been unlocked.
 * (Permissive: putting a link in a public group exposes it even if it also
 * lives in a protected group.)
 */
function filterVisibleLinks(links, groups, unlockedIds) {
  const protectedIds = new Set(groups.filter(g => g.is_protected).map(g => g.id));
  return links.filter(link => {
    const ids = link.group_ids || [];
    if (ids.length === 0) return true;
    return ids.some(gid => !protectedIds.has(gid) || unlockedIds.has(gid));
  });
}

app.get('/api/links', requirePublicAuth, (req, res) => {
  const links = db.getAllLinks();
  if (isValidAdminToken(req.headers['x-admin-token'])) return res.json(links);

  const visible  = links.filter(l => !l.is_hidden);
  const groups   = db.getAllGroups();
  const unlocked = getUnlockedGroupIds(req);
  res.json(filterVisibleLinks(visible, groups, unlocked));
});

app.get('/api/groups', requirePublicAuth, (req, res) => {
  const groups   = db.getAllGroups();
  const expiries = getUnlockedGroupExpiries(req);
  res.json(groups.map(g => {
    if (!g.is_protected)        return { ...g, is_unlocked: true };
    const expMs = expiries.get(g.id);
    return {
      ...g,
      is_unlocked:    !!expMs,
      unlocked_until: expMs ?? null,
    };
  }));
});

// ─── Link requests ────────────────────────────────────────────────────────────
//
// Visitors propose links; the admin reviews them in the Requests panel. The
// submit endpoint is public (no admin token) but gated by the requests_enabled
// flag and, optionally, a request password. Review actions are admin-only.

/** True when the public "Request link" feature is switched on. */
function requestsEnabled() {
  return db.readSetting('requests_enabled') === '1';
}

app.post('/api/link-requests', requestSubmitLimiter, upload.single('image'), (req, res) => {
  if (!requestsEnabled()) {
    return res.status(403).json({ error: 'Link requests are not enabled' });
  }

  // Optional password gate (scrypt hash stored in settings).
  const requestPasswordHash = db.readSetting('request_password');
  if (requestPasswordHash) {
    if (requestAuthLimiter.isLimited(req)) {
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' });
    }
    const provided = req.headers['x-request-password'] || '';
    if (!db.verifyScryptHash(requestPasswordHash, provided)) {
      requestAuthLimiter.recordFailure(req);
      return res.status(401).json({ error: 'Password required' });
    }
  }

  const { name, url, description, group_id, section_id } = req.body;
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (!trimmedUrl || !isValidHttpUrl(trimmedUrl)) {
    return res.status(400).json({ error: 'A valid http:// or https:// URL is required' });
  }

  // Group is required and must exist.
  const groupId = Number(group_id);
  if (!Number.isFinite(groupId) || groupId <= 0 || !db.getGroupById(groupId)) {
    return res.status(400).json({ error: 'Please choose a valid group' });
  }

  // Subsection is optional; if given it must belong to the chosen group.
  let sectionId = null;
  if (section_id != null && section_id !== '') {
    const sid     = Number(section_id);
    const section = Number.isFinite(sid) ? db.getSectionById(sid) : null;
    if (!section || section.group_id !== groupId) {
      return res.status(400).json({ error: 'Selected section does not belong to the chosen group' });
    }
    sectionId = sid;
  }

  const imagePath = resolveIconReference({ imageFile: req.file || null });

  const result = db.createLinkRequest({
    name:        name.trim(),
    url:         trimmedUrl,
    description: description?.trim() || null,
    imagePath,
    groupId,
    sectionId,
  });

  res.status(201).json({ id: result.lastInsertRowid, ok: true });
});

// ─── Link requests (admin review) ─────────────────────────────────────────────

app.get('/api/link-requests', requireAdminToken, (req, res) => {
  const status   = req.query.status === 'all' ? undefined : (req.query.status || 'pending');
  const requests = db.getLinkRequests({ status });
  // Attach the icon library id so the admin's prefill flow can preselect it.
  const decorated = requests.map(r => ({
    ...r,
    icon_id: r.image_path ? (db.getIconByPath(r.image_path)?.id ?? null) : null,
  }));
  res.json({ pending_count: db.countPendingRequests(), requests: decorated });
});

app.post('/api/link-requests/:id/approve', requireAdminToken, (req, res) => {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  const linkId = Number(req.body.link_id);
  db.setLinkRequestStatus(request.id, 'approved', {
    linkId: Number.isFinite(linkId) ? linkId : undefined,
  });
  req._auditSummary = `Approved link request "${truncate(request.name)}"`;
  res.json({ ok: true });
});

app.post('/api/link-requests/:id/reject', requireAdminToken, (req, res) => {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  db.setLinkRequestStatus(request.id, 'rejected');
  req._auditSummary = `Rejected link request "${truncate(request.name)}"`;
  res.json({ ok: true });
});

app.delete('/api/link-requests/:id', requireAdminToken, (req, res) => {
  const request = db.getLinkRequestById(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  db.deleteLinkRequest(request.id);
  req._auditSummary = `Deleted link request "${truncate(request.name)}"`;
  res.status(204).end();
});

// ─── Links (admin write) ──────────────────────────────────────────────────────

app.post('/api/links', requireAdminToken, uploadLinkPayload, async (req, res) => {
  const { name, url, description, icon_id } = req.body;

  const imageFile = req.files?.image?.[0] || null;
  const attached  = req.files?.file?.[0]  || null;

  const trimmedUrl = typeof url === 'string' ? url.trim() : '';

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  // Either a URL or a file is required — never both required, never neither.
  if (!trimmedUrl && !attached) {
    return res.status(400).json({ error: 'Provide a URL or upload a file' });
  }
  if (trimmedUrl && !isValidHttpUrl(trimmedUrl)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
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
  });

  const linkId = result.lastInsertRowid;

  // Favicons only make sense for real URLs — skip for file-backed links.
  // Fire-and-forget: the link is saved immediately and the favicon is cached
  // in the background, then pushed to open pages via SSE when it lands. This
  // keeps the save instant even when the target host is slow or unreachable.
  if (!filePath) cacheFavicon(linkId, effectiveUrl).catch(() => {});

  res.status(201).json(db.getLinkById(linkId));
});

app.put('/api/links/:id', requireAdminToken, uploadLinkPayload, async (req, res) => {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  const { name, url, description, remove_image, remove_file, icon_id } = req.body;

  const imageFile  = req.files?.image?.[0] || null;
  const attached   = req.files?.file?.[0]  || null;
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';
  const shouldRemoveImage = remove_image === 'true';
  const shouldRemoveFile  = remove_file  === 'true';

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // After this update the link must still have either a URL or a file attached.
  const willHaveFile = attached ? true : (existingLink.file_path && !shouldRemoveFile);
  if (!willHaveFile) {
    // URL-only path: validate normally.
    if (!trimmedUrl) {
      return res.status(400).json({ error: 'Provide a URL or upload a file' });
    }
    if (!isValidHttpUrl(trimmedUrl)) {
      return res.status(400).json({ error: 'URL must start with http:// or https://' });
    }
  }
  // When the link is/stays file-backed, the URL field is ignored — callers may
  // re-send the stored /uploads/... path without it causing a validation error.

  const newImagePath = resolveIconReference({ imageFile, iconIdField: icon_id });
  const newFilePath  = attached  ? `/uploads/${attached.filename}`  : null;

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
  });

  // Re-cache favicon only if we're now URL-backed and the URL changed.
  // Fire-and-forget (see POST handler) — never block the save on a slow host.
  const nowFileBacked = !!(newFilePath || (existingLink.file_path && !shouldRemoveFile));
  if (!nowFileBacked && trimmedUrl !== existingLink.url) {
    cacheFavicon(req.params.id, trimmedUrl).catch(() => {});
  }

  res.json(db.getLinkById(req.params.id));
});

/**
 * Toggles or sets a link's hidden flag without rewriting any other fields.
 * Body: { hidden: boolean }. Hidden links stay in the admin list but never
 * appear on the public page and `/r/:id` redirects non-admins to /.
 */
app.post('/api/links/:id/visibility', requireAdminToken, (req, res) => {
  const link = db.getLinkById(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const hidden = !!req.body.hidden;
  db.updateLinkVisibility(req.params.id, hidden);
  res.json(db.getLinkById(req.params.id));
});

app.delete('/api/links/:id', requireAdminToken, (req, res) => {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  // Capture the name for the audit log before the row is gone.
  req._auditSummary = `Deleted link "${existingLink.name}"`;

  // image_path is a shared icon-library reference — leave the file alone.
  safeDeleteFileUnlessLibrary(existingLink.favicon_path);
  safeDeleteFile(existingLink.file_path);
  db.deleteLink(req.params.id);
  res.status(204).end();
});

// ─── In-place file editor (admin only) ───────────────────────────────────────
//
// Lets the admin read and overwrite the *contents* of an attached file (the
// kind of file linked via the URL/File toggle in the link form). The link row
// itself is untouched — only the bytes on disk change. The /uploads/* static
// handler above sends no-cache headers, so any visitor clicking the link card
// after a save sees the new bytes immediately.

const EDITABLE_FILE_EXTENSIONS = new Set([
  '.htm', '.html', '.xml', '.json', '.txt', '.md', '.log', '.csv', '.svg',
]);
const FILE_EDIT_MAX_BYTES = 5 * 1024 * 1024;

function isEditableFile(filename) {
  if (!filename) return false;
  return EDITABLE_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

/**
 * Resolves the on-disk path for a link's attached file, defensively scoped
 * to UPLOADS_DIR so a tampered file_path can't escape (path-traversal guard).
 * Returns null when the link is missing, file-less, or wandering outside.
 */
function resolveLinkFilePath(link) {
  if (!link || !link.file_path) return null;
  const filename = path.basename(link.file_path);
  const fullPath = path.join(UPLOADS_DIR, filename);
  if (path.relative(UPLOADS_DIR, fullPath).startsWith('..')) return null;
  return fullPath;
}

app.get('/api/links/:id/file', requireAdminToken, (req, res) => {
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
});

app.put('/api/links/:id/file', requireAdminToken, (req, res) => {
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
});

// ─── Bulk delete (admin only) ─────────────────────────────────────────────────

app.post('/api/links/bulk-delete', requireAdminToken, (req, res) => {
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
});

// ─── Groups (admin write) ─────────────────────────────────────────────────────

/**
 * Reads `password` from a group request body and normalises it into one of:
 *   undefined  → don't touch the password on update
 *   null       → clear the password (group becomes public)
 *   '<string>' → set this password
 */
function normaliseGroupPassword(body) {
  if (!('password' in body)) return undefined;
  const raw = body.password;
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

app.post('/api/groups', requireAdminToken, (req, res) => {
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const safeColor = isValidHexColor(color) ? color : '#0071e3';
  const password  = normaliseGroupPassword(req.body);
  const result    = db.createGroup({
    name: name.trim(),
    color: safeColor,
    password:   password ?? undefined,
    unlockMode: req.body.unlock_mode,        // sanitised inside createGroup
  });
  res.status(201).json(db.getGroupById(result.lastInsertRowid));
});

app.put('/api/groups/:id', requireAdminToken, (req, res) => {
  const existingGroup = db.getGroupById(req.params.id);
  if (!existingGroup) return res.status(404).json({ error: 'Group not found' });

  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const safeColor = isValidHexColor(color) ? color : existingGroup.color;
  db.updateGroup(req.params.id, {
    name:       name.trim(),
    color:      safeColor,
    password:   normaliseGroupPassword(req.body),
    unlockMode: req.body.unlock_mode,        // undefined => leave as-is
  });
  res.json(db.getGroupById(req.params.id));
});

// ─── Group unlock (public) ────────────────────────────────────────────────────

/**
 * Verifies a password for a protected group. On success, sets a long-lived
 * HMAC-signed cookie so subsequent requests skip the prompt.
 * Rate-limited per-IP, but only failed attempts count toward the budget.
 */
// Far-future signed expiry used for session-mode cookies. The cookie itself
// is browser-session-bound (no Max-Age), so it disappears when the user closes
// the browser; this value just keeps the HMAC payload valid until then.
const GROUP_SESSION_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

app.post('/api/groups/:id/unlock', (req, res) => {
  if (groupUnlockLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid group id' });

  const group = db.getGroupById(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.is_protected) return res.json({ valid: true });

  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!db.verifyGroupPassword(id, password)) {
    groupUnlockLimiter.recordFailure(req);
    return res.status(401).json({ valid: false, error: 'Wrong password' });
  }

  // Choose how the unlock should persist based on the group's mode:
  //   'timeout' (default) → 30 s, both client-side and server-side.
  //   'session'           → browser session cookie (no Max-Age), valid for
  //                         up to a year server-side. The browser deletes it
  //                         on tab/window close, which is the relock signal.
  const mode    = group.unlock_mode === 'session' ? 'session' : 'timeout';
  const ttlMs   = mode === 'session' ? GROUP_SESSION_EXPIRY_MS : GROUP_UNLOCK_TTL_MS;
  const expMs   = Date.now() + ttlMs;
  const token   = signGroupUnlock(id, expMs);
  const secure  = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const maxAge  = mode === 'session'
    ? ''                                          // no Max-Age → browser session cookie
    : `; Max-Age=${Math.ceil(GROUP_UNLOCK_TTL_MS / 1000)}`;
  res.setHeader('Set-Cookie',
    `lp_grp_${id}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secure}`);
  res.json({
    valid:       true,
    expires_at:  expMs,
    ttl_ms:      ttlMs,
    unlock_mode: mode,
  });
});

/** Lets a user forget a previously-unlocked group (used by the public UI's "Lock" action). */
app.post('/api/groups/:id/lock', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid group id' });
  res.setHeader('Set-Cookie', `lp_grp_${id}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// ─── Sections (admin write) ───────────────────────────────────────────────────

app.post('/api/groups/:id/sections', requireAdminToken, (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) return res.status(400).json({ error: 'Invalid group id' });
  if (!db.getGroupById(groupId)) return res.status(404).json({ error: 'Group not found' });

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Section name is required' });

  // Optional: create as a subsection of an existing section in the same group.
  // We deliberately enforce a single nesting level (no sub-sub-sections) by
  // rejecting parents that themselves already have a parent_section_id.
  let parentSectionId = null;
  if (req.body.parent_section_id != null && req.body.parent_section_id !== '') {
    const pid = Number(req.body.parent_section_id);
    if (!Number.isFinite(pid)) return res.status(400).json({ error: 'Invalid parent_section_id' });
    const parent = db.getSectionById(pid);
    if (!parent || parent.group_id !== groupId) {
      return res.status(400).json({ error: 'Parent section does not belong to this group' });
    }
    if (parent.parent_section_id) {
      return res.status(400).json({ error: 'Subsections cannot have their own subsections' });
    }
    parentSectionId = pid;
  }

  const result = db.createSection({ groupId, name, parentSectionId });
  res.status(201).json(db.getSectionById(result.lastInsertRowid));
});

app.put('/api/sections/:id', requireAdminToken, (req, res) => {
  const section = db.getSectionById(req.params.id);
  if (!section) return res.status(404).json({ error: 'Section not found' });

  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'Section name is required' });

  db.updateSection(req.params.id, { name });
  res.json(db.getSectionById(req.params.id));
});

app.delete('/api/sections/:id', requireAdminToken, (req, res) => {
  const section = db.getSectionById(req.params.id);
  if (!section) {
    return res.status(404).json({ error: 'Section not found' });
  }
  req._auditSummary = `Deleted section "${section.name}"`;
  db.deleteSection(req.params.id);
  res.status(204).end();
});

app.post('/api/sections/reorder', requireAdminToken, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || order.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"order" must be an array of numeric IDs' });
  }
  db.reorderSections(order);
  res.status(204).end();
});

app.delete('/api/groups/:id', requireAdminToken, (req, res) => {
  const group = db.getGroupById(req.params.id);
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }
  req._auditSummary = `Deleted group "${group.name}"`;
  db.deleteGroup(req.params.id);
  res.status(204).end();
});

// ─── Error handler ────────────────────────────────────────────────────────────

/**
 * Express error handler — keeps multer / upload errors as nice JSON 400s
 * instead of the default HTML stack-trace page.
 */
app.use((err, req, res, next) => {
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
});

app.listen(PORT, () => {});
