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

app.use(express.json());

// Basic security headers on every response
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

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
  if (existing) safeDeleteFile(existing);

  const newPath = `/uploads/${req.file.filename}`;
  db.writeSetting('favicon', newPath);
  res.json({ favicon: newPath });
});

app.delete('/api/settings/favicon', requireAdminToken, (req, res) => {
  const existing = db.readSetting('favicon');
  if (existing) {
    safeDeleteFile(existing);
    db.deleteSetting('favicon');
  }
  res.status(204).end();
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

  const { changes, fileToDelete } = db.deleteIcon(id);
  if (!changes) return res.status(404).json({ error: 'Icon not found' });

  if (fileToDelete) safeDeleteFile(fileToDelete);
  res.status(204).end();
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

// ─── Favicon download (server-side cache) ────────────────────────────────────

const FAVICON_REQUEST_TIMEOUT_MS = 4500;
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

/** fetch() wrapper with a hard timeout and a body-size cap. Returns null on any failure. */
async function fetchWithLimits(url, { timeoutMs = FAVICON_REQUEST_TIMEOUT_MS, maxBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal:   controller.signal,
      redirect: 'follow',
      headers:  { 'User-Agent': FAVICON_USER_AGENT, 'Accept': '*/*' },
    });
    if (!res.ok) return null;
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
  if (!res) return null;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('html')) return null;
  return (await res.text()).slice(0, FAVICON_MAX_HTML_BYTES);
}

async function fetchImageCandidate(url) {
  const res = await fetchWithLimits(url, { maxBytes: FAVICON_MAX_IMAGE_BYTES });
  if (!res) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.byteLength || buffer.byteLength > FAVICON_MAX_IMAGE_BYTES) return null;
  const contentType = (res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0].trim().toLowerCase();
  // Accept image/* and the common .ico variants. Reject HTML disguised as a favicon.
  const isImage = contentType.startsWith('image/')
               || contentType === 'application/ico'
               || contentType === 'application/octet-stream';
  if (!isImage) return null;
  return { buffer, contentType };
}

/**
 * Best-effort favicon fetcher with three fallbacks. Returns { buffer, contentType }
 * or null on total failure.
 *
 *   1. Parse the page HTML for a declared <link rel="icon"> — works for intranet
 *      sites because the request goes directly to the site, not via Google.
 *   2. Hit <origin>/favicon.ico — the legacy convention every browser still tries.
 *   3. Fall back to Google's favicon service for public URLs.
 */
async function fetchFaviconForUrl(siteUrl) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const html = await fetchHtml(siteUrl);
  if (html) {
    const declared = parseDeclaredIconUrl(html, siteUrl);
    if (declared) {
      const img = await fetchImageCandidate(declared);
      if (img) return img;
    }
  }

  const root = await fetchImageCandidate(`${parsed.origin}/favicon.ico`);
  if (root) return root;

  return fetchImageCandidate(
    `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`
  );
}

/**
 * Wraps cacheFavicon with a hard wall-clock budget. Resolves either when the
 * favicon is written and persisted, or when the budget elapses — whichever is
 * first. The underlying request is allowed to keep running in the background
 * so a slow fetch still updates the DB before the next page load. Use this in
 * request handlers that need the freshly-cached favicon in their response.
 */
function cacheFaviconWithBudget(linkId, siteUrl, budgetMs = 5000) {
  return new Promise(resolve => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const timer = setTimeout(done, budgetMs);
    cacheFavicon(linkId, siteUrl).finally(() => {
      clearTimeout(timer);
      done();
    });
  });
}

/**
 * Downloads the favicon for a link and saves it locally. Tries the site itself
 * first (so intranet URLs work) and falls back to Google's favicon service.
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

  db.recordClick(link.id, getClientIp(req), req.headers['user-agent'] || null);

  res.setHeader('Cache-Control',   'no-store, no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, link.url);
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

app.get('/api/links/export', requireAdminToken, (req, res) => {
  const links  = db.getAllLinks();
  const groups = db.getAllGroups();

  res.json({
    version:     2,
    exported_at: new Date().toISOString(),
    groups:      groups.map(g => ({ name: g.name, color: g.color })),
    links:       links.map(l => ({
      name:        l.name,
      url:         l.url,
      description: l.description || null,
      // group_names: the new multi-group field. group_name kept for back-compat.
      group_names: (l.groups || []).map(g => g.name),
      group_name:  l.group_name || null,
    })),
  });
});

app.post('/api/links/import', requireAdminToken, (req, res) => {
  const incoming = req.body;

  if (!Array.isArray(incoming?.links)) {
    return res.status(400).json({ error: 'Request body must have a "links" array' });
  }

  let imported      = 0;
  let groupsCreated = 0;
  const errors      = [];

  for (const [index, item] of incoming.links.entries()) {
    if (!item.name?.trim() || !item.url?.trim()) {
      errors.push(`Item ${index + 1}: name and url are required`);
      continue;
    }

    if (!isValidHttpUrl(item.url)) {
      errors.push(`Item ${index + 1}: invalid URL "${item.url}"`);
      continue;
    }

    // Collect group names from either the new group_names[] array or the
    // legacy single group_name field, then look them up or create them.
    const rawNames = Array.isArray(item.group_names) ? item.group_names : [];
    if (item.group_name) rawNames.push(item.group_name);

    const groupIds = [];
    const seenIds  = new Set();
    for (const rawName of rawNames) {
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!name) continue;

      const existingGroups = db.getAllGroups();
      const found = existingGroups.find(g => g.name.toLowerCase() === name.toLowerCase());

      let gid;
      if (found) {
        gid = found.id;
      } else {
        gid = db.createGroup({ name, color: '#0071e3' }).lastInsertRowid;
        groupsCreated++;
      }
      if (!seenIds.has(gid)) { seenIds.add(gid); groupIds.push(gid); }
    }

    const result = db.createLink({
      name:        item.name.trim(),
      url:         item.url.trim(),
      description: item.description?.trim() || null,
      imagePath:   null,
      groupIds,
    });

    // Kick off favicon download asynchronously
    cacheFavicon(result.lastInsertRowid, item.url.trim()).catch(() => {});

    imported++;
  }

  res.json({ imported, groups_created: groupsCreated, errors });
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
  // Wait briefly so the response reflects the freshly cached favicon path.
  if (!filePath) await cacheFaviconWithBudget(linkId, effectiveUrl);

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
  // Wait briefly so the response reflects the freshly cached favicon path.
  const nowFileBacked = !!(newFilePath || (existingLink.file_path && !shouldRemoveFile));
  if (!nowFileBacked && trimmedUrl !== existingLink.url) {
    await cacheFaviconWithBudget(req.params.id, trimmedUrl);
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

  // image_path is a shared icon-library reference — leave the file alone.
  safeDeleteFileUnlessLibrary(existingLink.favicon_path);
  safeDeleteFile(existingLink.file_path);
  db.deleteLink(req.params.id);
  res.status(204).end();
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
    password: password ?? undefined,
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
    name:     name.trim(),
    color:    safeColor,
    password: normaliseGroupPassword(req.body),
  });
  res.json(db.getGroupById(req.params.id));
});

// ─── Group unlock (public) ────────────────────────────────────────────────────

/**
 * Verifies a password for a protected group. On success, sets a long-lived
 * HMAC-signed cookie so subsequent requests skip the prompt.
 * Rate-limited per-IP, but only failed attempts count toward the budget.
 */
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

  const expMs   = Date.now() + GROUP_UNLOCK_TTL_MS;
  const token   = signGroupUnlock(id, expMs);
  const maxAge  = Math.ceil(GROUP_UNLOCK_TTL_MS / 1000);
  const secure  = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `lp_grp_${id}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  res.json({ valid: true, expires_at: expMs, ttl_ms: GROUP_UNLOCK_TTL_MS });
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

  const result = db.createSection({ groupId, name });
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
  if (!db.getSectionById(req.params.id)) {
    return res.status(404).json({ error: 'Section not found' });
  }
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
  if (!db.getGroupById(req.params.id)) {
    return res.status(404).json({ error: 'Group not found' });
  }
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
