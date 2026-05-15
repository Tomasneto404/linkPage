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

const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
];

/** Returns true if the uploaded file is an allowed image type. */
function isAllowedImage(file) {
  const extension = path.extname(file.originalname).toLowerCase();
  return ALLOWED_IMAGE_EXTENSIONS.includes(extension) &&
         ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype);
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

const authRateLimit  = createRateLimiter(10, 5 * 60 * 1000); // 10 per 5 minutes
const clickRateLimit = createRateLimiter(30, 60 * 1000);      // 30 per minute

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

app.post('/api/auth/verify', authRateLimit, (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  res.json({ valid: isValidAdminToken(token) });
});

app.post('/api/auth/verify-public', authRateLimit, (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const stored   = db.readSetting('public_password');

  if (!stored) {
    // No password configured — always valid
    return res.json({ valid: true });
  }

  res.json({ valid: isValidPublicPassword(password) });
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
  res.json({
    logo_light:              db.readSetting('logo_light') ?? null,
    logo_dark:               db.readSetting('logo_dark')  ?? null,
    site_title:              db.readSetting('site_title') ?? null,
    public_password_required: !!publicPassword,
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

app.post('/api/settings/site-title', requireAdminToken, (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (title) {
    db.writeSetting('site_title', title);
  } else {
    db.deleteSetting('site_title');
  }
  res.json({ site_title: title || null });
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

/**
 * Downloads the favicon for a link from Google's favicon service and saves it
 * locally. This keeps favicons working even if Google's service is unavailable
 * and avoids sending user domains to Google on every page load.
 */
async function cacheFavicon(linkId, siteUrl) {
  try {
    const hostname = new URL(siteUrl).hostname;
    const faviconApiUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(faviconApiUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return;

    const buffer      = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('svg')  ? '.svg'  :
                contentType.includes('gif')  ? '.gif'  :
                contentType.includes('webp') ? '.webp' : '.png';

    const filename = `favicon_${linkId}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Remove any previous favicon for this link (different extension)
    for (const oldExt of ['.svg', '.gif', '.webp', '.png']) {
      const old = path.join(UPLOADS_DIR, `favicon_${linkId}${oldExt}`);
      if (old !== filePath && fs.existsSync(old)) fs.unlinkSync(old);
    }

    fs.writeFileSync(filePath, Buffer.from(buffer));
    db.updateLinkFavicon(linkId, `/uploads/${filename}`);
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
    version:     1,
    exported_at: new Date().toISOString(),
    groups:      groups.map(g => ({ name: g.name, color: g.color })),
    links:       links.map(l => ({
      name:        l.name,
      url:         l.url,
      description: l.description || null,
      group_name:  l.group_name  || null,
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

    let groupId = null;

    if (item.group_name?.trim()) {
      // Find or create the group by name
      const existingGroups = db.getAllGroups();
      const found = existingGroups.find(g =>
        g.name.toLowerCase() === item.group_name.trim().toLowerCase()
      );

      if (found) {
        groupId = found.id;
      } else {
        const result = db.createGroup({ name: item.group_name.trim(), color: '#0071e3' });
        groupId = result.lastInsertRowid;
        groupsCreated++;
      }
    }

    const result = db.createLink({
      name:        item.name.trim(),
      url:         item.url.trim(),
      description: item.description?.trim() || null,
      imagePath:   null,
      groupId,
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

app.get('/api/links',  requirePublicAuth, (req, res) => res.json(db.getAllLinks()));
app.get('/api/groups', requirePublicAuth, (req, res) => res.json(db.getAllGroups()));

// ─── Links (admin write) ──────────────────────────────────────────────────────

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

  const linkId = result.lastInsertRowid;

  // Download and cache the favicon in the background
  cacheFavicon(linkId, url.trim()).catch(() => {});

  res.status(201).json(db.getLinkById(linkId));
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

  const newImagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const shouldRemove = remove_image === 'true';

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

  // Re-cache favicon if URL changed
  if (url.trim() !== existingLink.url) {
    cacheFavicon(req.params.id, url.trim()).catch(() => {});
  }

  res.json(db.getLinkById(req.params.id));
});

app.delete('/api/links/:id', requireAdminToken, (req, res) => {
  const existingLink = db.getLinkById(req.params.id);
  if (!existingLink) return res.status(404).json({ error: 'Link not found' });

  safeDeleteFile(existingLink.image_path);
  safeDeleteFile(existingLink.favicon_path);
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
      safeDeleteFile(link.image_path);
      safeDeleteFile(link.favicon_path);
      db.deleteLink(id);
      deleted++;
    }
  }

  res.json({ deleted });
});

// ─── Groups (admin write) ─────────────────────────────────────────────────────

app.post('/api/groups', requireAdminToken, (req, res) => {
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const safeColor = isValidHexColor(color) ? color : '#0071e3';
  const result    = db.createGroup({ name: name.trim(), color: safeColor });
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
