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
  // 32 random bytes = 64 hex characters = 256 bits of entropy
  const newToken = crypto.randomBytes(32).toString('hex');
  // Mode 0o600 = only the file owner can read or write it
  fs.writeFileSync(TOKEN_FILE, newToken, { mode: 0o600 });
  return newToken;
}

const ADMIN_TOKEN = loadOrCreateAdminToken();

// Migrate old single-logo setting to the new light/dark format
const oldLogoPath = db.readSetting('logo_path');
if (oldLogoPath && !db.readSetting('logo_light')) {
  db.writeSetting('logo_light', oldLogoPath);
  db.deleteSetting('logo_path');
}

const divider = '─'.repeat(54);
console.log(`\n┌${divider}┐`);
console.log(`│  🔑 Admin Token: ${ADMIN_TOKEN.slice(0, 20)}...`);
console.log(`│     Full token saved in: ${TOKEN_FILE}`);
console.log(`│  🌐 Public URL: http://localhost:${PORT}/`);
console.log(`│  ⚙️  Admin URL:  http://localhost:${PORT}/admin`);
console.log(`└${divider}┘\n`);

// ─── Security helpers ─────────────────────────────────────────────────────────

/**
 * Compares a provided token against the admin token in constant time.
 *
 * A regular === comparison returns early on the first mismatched character,
 * which leaks information about how much of the token was correct (a timing
 * attack). timingSafeEqual always takes the same time regardless of content.
 */
function isValidAdminToken(providedToken) {
  if (typeof providedToken !== 'string') return false;
  // Lengths must match before we can call timingSafeEqual
  if (providedToken.length !== ADMIN_TOKEN.length) return false;

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const expectedBuffer = Buffer.from(ADMIN_TOKEN,  'utf8');
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Returns true if the URL uses http or https.
 * Rejects javascript:, data:, and other schemes that could cause harm.
 */
function isValidHttpUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns true if the value is a valid 3- or 6-digit CSS hex color.
 * Example: "#0071e3" or "#fff"
 */
function isValidHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);
}

// Both the extension and the MIME type must be in these lists.
// Extension-only checks can be bypassed by renaming files.
// MIME-only checks can be bypassed since browsers send whatever the OS reports.
// Requiring both makes accidental or intentional bypasses much harder.
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

/** Returns true if the uploaded file is an allowed image type. */
function isAllowedImage(file) {
  const extension   = path.extname(file.originalname).toLowerCase();
  const validExt    = ALLOWED_IMAGE_EXTENSIONS.includes(extension);
  const validMime   = ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype);
  return validExt && validMime;
}

/**
 * Deletes an uploaded file safely.
 *
 * We use path.basename() to strip any directory components from the stored
 * path before building the final path. This prevents a path like
 * "../../etc/passwd" from escaping the uploads directory.
 */
function safeDeleteFile(storedPath) {
  if (!storedPath) return;

  const filename = path.basename(storedPath);
  const fullPath = path.join(UPLOADS_DIR, filename);

  // Extra guard: ensure the resolved path is still inside UPLOADS_DIR
  if (!fullPath.startsWith(UPLOADS_DIR + path.sep)) {
    console.warn(`Blocked attempt to delete file outside uploads directory: ${fullPath}`);
    return;
  }

  fs.unlink(fullPath, error => {
    if (error && error.code !== 'ENOENT') {
      // ENOENT means the file was already gone — that's fine.
      // Anything else is worth logging.
      console.error(`Failed to delete file "${filename}": ${error.message}`);
    }
  });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

/** Rejects requests that do not include a valid admin token header. */
function requireAdminToken(req, res, next) {
  const providedToken = req.headers['x-admin-token'];
  if (isValidAdminToken(providedToken)) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── File upload ──────────────────────────────────────────────────────────────

const uploadStorage = multer.diskStorage({
  destination: (req, file, done) => done(null, UPLOADS_DIR),

  filename: (req, file, done) => {
    // Use crypto.randomBytes instead of Math.random for a collision-resistant name
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

// ─── Express setup ────────────────────────────────────────────────────────────

app.use(express.json());

// Basic security headers on every response
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');   // No MIME sniffing
  res.setHeader('X-Frame-Options', 'DENY');             // No embedding in iframes
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/admin', (req, res) =>
  res.sendFile(path.resolve(__dirname, '..', 'public', 'admin', 'index.html')));

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/verify', (req, res) => {
  const providedToken = typeof req.body.token === 'string' ? req.body.token : '';
  res.json({ valid: isValidAdminToken(providedToken) });
});

// ─── Settings (anyone can read) ───────────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json({
    logo_light: db.readSetting('logo_light') ?? null,
    logo_dark:  db.readSetting('logo_dark')  ?? null,
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

  const settingKey      = `logo_${variant}`;
  const existingPath    = db.readSetting(settingKey);

  // Remove the old logo file before saving the new one
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

// ─── Click tracking ───────────────────────────────────────────────────────────

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
 * Public redirect route — records a click then sends the user to the link URL.
 * Using a server-side redirect (instead of client-side JS) means the click
 * is always captured even if the browser has JS disabled or an ad blocker.
 */
app.get('/r/:id', (req, res) => {
  const linkId = parseInt(req.params.id, 10);
  if (isNaN(linkId)) return res.status(400).send('Invalid link ID');

  const link = db.getLinkById(linkId);
  if (!link) return res.status(404).send('Link not found');

  // Record who clicked and when
  db.recordClick(link.id, getClientIp(req), req.headers['user-agent'] || null);

  // Redirect without leaking our server URL to the destination as a referrer
  res.setHeader('Cache-Control',    'no-store, no-cache');
  res.setHeader('Referrer-Policy',  'no-referrer');
  res.redirect(302, link.url);
});

// ─── Stats (admin only) ───────────────────────────────────────────────────────

/** Aggregate click stats for all links (used to populate the admin card grid). */
app.get('/api/stats', requireAdminToken, (req, res) => {
  res.json(db.getAllStats());
});

/** Detailed click log and top IPs for one link (used by the stats modal). */
app.get('/api/links/:id/clicks', requireAdminToken, (req, res) => {
  const link = db.getLinkById(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  res.json({
    recentClicks: db.getRecentClicks(req.params.id),
    topIps:       db.getTopIps(req.params.id),
  });
});

// ─── Links (anyone can read) ──────────────────────────────────────────────────

app.get('/api/links',  (req, res) => res.json(db.getAllLinks()));
app.get('/api/groups', (req, res) => res.json(db.getAllGroups()));

// ─── Links (admin only) ───────────────────────────────────────────────────────

app.post('/api/links', requireAdminToken, upload.single('image'), (req, res) => {
  const { name, url, description, group_id } = req.body;

  if (!name?.trim() || !url?.trim()) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  if (!isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }

  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.createLink({
    name:        name.trim(),
    url:         url.trim(),
    description: description?.trim() || null,
    imagePath,
    groupId:     group_id || null,
  });

  res.status(201).json(db.getLinkById(result.lastInsertRowid));
});

app.put('/api/links/:id', requireAdminToken, upload.single('image'), (req, res) => {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  const { name, url, description, group_id, remove_image } = req.body;

  if (!name?.trim() || !url?.trim()) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  if (!isValidHttpUrl(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }

  const newImagePath    = req.file ? `/uploads/${req.file.filename}` : null;
  const shouldRemove    = remove_image === 'true';

  // Delete the old image file if it's being replaced or explicitly removed
  if ((newImagePath || shouldRemove) && existingLink.image_path) {
    safeDeleteFile(existingLink.image_path);
  }

  db.updateLink(req.params.id, {
    name:        name.trim(),
    url:         url.trim(),
    description: description?.trim() || null,
    imagePath:   newImagePath,
    groupId:     group_id || null,
    removeImage: shouldRemove,
  });

  res.json(db.getLinkById(req.params.id));
});

app.delete('/api/links/:id', requireAdminToken, (req, res) => {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  safeDeleteFile(existingLink.image_path);
  db.deleteLink(req.params.id);
  res.status(204).end();
});

// ─── Groups (admin only) ──────────────────────────────────────────────────────

app.post('/api/groups', requireAdminToken, (req, res) => {
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  // Use the provided color only if it's a valid hex value; fall back to default
  const safeColor = isValidHexColor(color) ? color : '#0071e3';

  const result = db.createGroup({ name: name.trim(), color: safeColor });
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

  db.updateGroup(req.params.id, { name: name.trim(), color: safeColor });
  res.json(db.getGroupById(req.params.id));
});

app.delete('/api/groups/:id', requireAdminToken, (req, res) => {
  if (!db.getGroupById(req.params.id)) {
    return res.status(404).json({ error: 'Group not found' });
  }
  db.deleteGroup(req.params.id);
  res.status(204).end();
});

app.listen(PORT, () => {});
