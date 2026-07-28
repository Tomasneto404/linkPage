/** Public settings read + admin settings/theme writes. */

const db = require('../models');
const {
  LOGO_VARIANTS, THEME_LIGHT_VARIANTS, THEME_DARK_VARIANTS,
  DEFAULT_THEMES, MOBILE_NAV_POSITIONS, HEX_COLOR_RE,
} = require('../config/constants');
const { safeDeleteFile, safeDeleteFileUnlessLibrary } = require('../services/uploadService');

// ─── Public read ──────────────────────────────────────────────────────────────

function getSettings(req, res) {
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
    accent_color:              db.readSetting('accent_color') ?? null,
    accent_dark_adjust:        db.readSetting('accent_dark_adjust') === '1',
    accent_glow:               db.readSetting('accent_glow') === '1',
    mobile_nav_position:       db.readSetting('mobile_nav_position') ?? 'top',
    theme_light_variant:       db.readSetting('theme_light_variant') ?? 'default',
    theme_dark_variant:        db.readSetting('theme_dark_variant')  ?? 'default',
    default_theme:             db.readSetting('default_theme') ?? 'system',
    // Developer credit footer. On by default; '0' means the admin turned it off.
    footer_enabled:            db.readSetting('footer_enabled') !== '0',
  });
}

// ─── Logos ──────────────────────────────────────────────────────────────────

function uploadLogo(req, res) {
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
}

function deleteLogo(req, res) {
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
}

// ─── Favicon ──────────────────────────────────────────────────────────────────

function uploadFavicon(req, res) {
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
}

function deleteFavicon(req, res) {
  const existing = db.readSetting('favicon');
  if (existing) {
    // Keep the file if it lives in the icon library; just unset the setting.
    safeDeleteFileUnlessLibrary(existing);
    db.deleteSetting('favicon');
  }
  res.status(204).end();
}

// ─── Misc toggles ─────────────────────────────────────────────────────────────

function saveFavicons(req, res) {
  const enabled = !!req.body.enabled;
  if (enabled) db.writeSetting('save_favicons_to_library', '1');
  else         db.deleteSetting('save_favicons_to_library');
  res.json({ save_favicons_to_library: enabled });
}

// Show/hide the developer credit footer. On by default, so we only persist the
// "off" state ('0') and clear the key to re-enable.
function setFooterEnabled(req, res) {
  const enabled = !!req.body.enabled;
  if (enabled) db.deleteSetting('footer_enabled');
  else         db.writeSetting('footer_enabled', '0');
  res.json({ footer_enabled: enabled });
}

function setSiteTitle(req, res) {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (title) {
    db.writeSetting('site_title', title);
  } else {
    db.deleteSetting('site_title');
  }
  res.json({ site_title: title || null });
}

/**
 * Sets the group that should be selected by default when a visitor first
 * lands on the public page. Pass `group_id: null` (or omit) to clear it.
 */
function setPinnedGroup(req, res) {
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
}

function setPublicPassword(req, res) {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Password cannot be empty' });
  }
  // Store a scrypt hash, never cleartext (matches the request-password flow).
  db.writeSetting('public_password', db.hashGroupPassword(password));
  res.json({ set: true });
}

function deletePublicPassword(req, res) {
  db.deleteSetting('public_password');
  res.status(204).end();
}

// Enable/disable the public "Request link" feature.
function setRequestsEnabled(req, res) {
  const enabled = !!req.body.enabled;
  if (enabled) db.writeSetting('requests_enabled', '1');
  else         db.deleteSetting('requests_enabled');
  res.json({ requests_enabled: enabled });
}

// Sets an optional password required to submit a link request. Stored scrypt-
// hashed (like group passwords), never in cleartext.
function setRequestPassword(req, res) {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Password cannot be empty' });
  }
  db.writeSetting('request_password', db.hashGroupPassword(password));
  res.json({ set: true });
}

function deleteRequestPassword(req, res) {
  db.deleteSetting('request_password');
  res.status(204).end();
}

// ─── Theme / appearance ─────────────────────────────────────────────────────

// Accepts any subset of theme fields and updates only the ones provided. Each is
// validated; an empty accent_color string resets to the built-in default.
function setTheme(req, res) {
  const b = req.body || {};

  if (b.accent_color !== undefined) {
    const c = typeof b.accent_color === 'string' ? b.accent_color.trim() : '';
    if (c === '') {
      db.deleteSetting('accent_color');
    } else if (HEX_COLOR_RE.test(c)) {
      db.writeSetting('accent_color', c.toLowerCase());
    } else {
      return res.status(400).json({ error: 'accent_color must be a #rrggbb hex value' });
    }
  }

  if (b.accent_dark_adjust !== undefined) {
    if (b.accent_dark_adjust) db.writeSetting('accent_dark_adjust', '1');
    else                      db.deleteSetting('accent_dark_adjust');
  }

  if (b.accent_glow !== undefined) {
    if (b.accent_glow) db.writeSetting('accent_glow', '1');
    else               db.deleteSetting('accent_glow');
  }

  if (b.light_variant !== undefined) {
    if (!THEME_LIGHT_VARIANTS.includes(b.light_variant)) {
      return res.status(400).json({ error: 'Invalid light_variant' });
    }
    if (b.light_variant === 'default') db.deleteSetting('theme_light_variant');
    else                               db.writeSetting('theme_light_variant', b.light_variant);
  }

  if (b.dark_variant !== undefined) {
    if (!THEME_DARK_VARIANTS.includes(b.dark_variant)) {
      return res.status(400).json({ error: 'Invalid dark_variant' });
    }
    if (b.dark_variant === 'default') db.deleteSetting('theme_dark_variant');
    else                              db.writeSetting('theme_dark_variant', b.dark_variant);
  }

  if (b.default_theme !== undefined) {
    if (!DEFAULT_THEMES.includes(b.default_theme)) {
      return res.status(400).json({ error: 'Invalid default_theme' });
    }
    if (b.default_theme === 'system') db.deleteSetting('default_theme');
    else                              db.writeSetting('default_theme', b.default_theme);
  }

  if (b.mobile_nav_position !== undefined) {
    if (!MOBILE_NAV_POSITIONS.includes(b.mobile_nav_position)) {
      return res.status(400).json({ error: 'Invalid mobile_nav_position' });
    }
    if (b.mobile_nav_position === 'top') db.deleteSetting('mobile_nav_position');
    else                                 db.writeSetting('mobile_nav_position', b.mobile_nav_position);
  }

  res.json({
    accent_color:        db.readSetting('accent_color') ?? null,
    accent_dark_adjust:  db.readSetting('accent_dark_adjust') === '1',
    accent_glow:         db.readSetting('accent_glow') === '1',
    mobile_nav_position: db.readSetting('mobile_nav_position') ?? 'top',
    theme_light_variant: db.readSetting('theme_light_variant') ?? 'default',
    theme_dark_variant:  db.readSetting('theme_dark_variant')  ?? 'default',
    default_theme:       db.readSetting('default_theme') ?? 'system',
  });
}

module.exports = {
  getSettings,
  uploadLogo, deleteLogo,
  uploadFavicon, deleteFavicon,
  saveFavicons, setFooterEnabled, setSiteTitle, setPinnedGroup,
  setPublicPassword, deletePublicPassword,
  setRequestsEnabled, setRequestPassword, deleteRequestPassword,
  setTheme,
};
