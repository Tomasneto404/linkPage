// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public settings read + admin settings/theme writes. */

const db = require('../models');
const {
  LOGO_VARIANTS, THEME_LIGHT_VARIANTS, THEME_DARK_VARIANTS,
  DEFAULT_THEMES, MOBILE_NAV_POSITIONS, HEX_COLOR_RE,
  WALLPAPER_VARIANTS, DEFAULT_WALLPAPER_FOG, DEFAULT_BAR_OPACITY,
  MARKDOWN_OPEN_MODES, DEFAULT_MARKDOWN_OPEN_MODE,
} = require('../config/constants');
const {
  safeDeleteFile, safeDeleteFileUnlessLibrary, resolveIconReference,
} = require('../services/uploadService');

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
    // Header brand glyph shown next to the site title. Ignored while a
    // light/dark logo is set — the logo replaces the whole title block.
    brand_icon:               db.readSetting('brand_icon') ?? null,
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
    // Active public group tab uses the group's own colour (default) vs the
    // secondary/accent colour. On by default; '0' means use the secondary.
    group_tab_color:           db.readSetting('group_tab_color') !== '0',
    // Group tab strip wraps around endlessly instead of stopping at the last
    // group. Off by default.
    group_tabs_loop:           db.readSetting('group_tabs_loop') === '1',
    // Where a markdown link opens: a new tab (default) or an overlay on the
    // page. The public page needs this to decide how to handle the click.
    markdown_open_mode:        readMarkdownOpenMode(),
    // Background image per theme, and how heavily it is veiled and blurred.
    wallpaper_light:           db.readSetting('wallpaper_light') ?? null,
    wallpaper_dark:            db.readSetting('wallpaper_dark')  ?? null,
    wallpaper_fog:             readWallpaperFog(),
    bar_opacity:               readBarOpacity(),
  });
}

/** The stored open mode, or the default when it has never been set. */
function readMarkdownOpenMode() {
  const stored = db.readSetting('markdown_open_mode');
  return MARKDOWN_OPEN_MODES.includes(stored) ? stored : DEFAULT_MARKDOWN_OPEN_MODE;
}

/**
 * Chooses how a markdown link opens: 'modal' (an overlay over the grid, the
 * default — it keeps the reader on the page they came from) or 'tab' (a new
 * browser tab). Stored only when it differs from the default, so the settings
 * table stays free of no-op rows.
 */
function setMarkdownOpenMode(req, res) {
  const mode = req.body?.mode;
  if (!MARKDOWN_OPEN_MODES.includes(mode)) {
    return res.status(400).json({ error: 'Mode must be "tab" or "modal"' });
  }

  if (mode === DEFAULT_MARKDOWN_OPEN_MODE) db.deleteSetting('markdown_open_mode');
  else                                     db.writeSetting('markdown_open_mode', mode);

  res.json({ markdown_open_mode: mode });
}

/**
 * The stored fog, falling back to the default when unset or corrupt.
 *
 * The emptiness check has to come first: Number(null) is 0, which is a
 * perfectly finite number, so an unset row would otherwise read as "no fog"
 * rather than as "never set".
 */
function readWallpaperFog() {
  const stored = db.readSetting('wallpaper_fog');
  if (stored === null || stored === undefined || stored === '') return DEFAULT_WALLPAPER_FOG;

  const raw = Number(stored);
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : DEFAULT_WALLPAPER_FOG;
}

/** How solid the sticky bars are. Same emptiness trap as the fog above. */
function readBarOpacity() {
  const stored = db.readSetting('bar_opacity');
  if (stored === null || stored === undefined || stored === '') return DEFAULT_BAR_OPACITY;

  const raw = Number(stored);
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : DEFAULT_BAR_OPACITY;
}

// ─── Wallpaper ──────────────────────────────────────────────────────────────

/**
 * Sets the background image for one theme. A bright photograph behind a dark
 * page rarely works, so each theme carries its own — exactly as the logos do.
 */
function uploadWallpaperImage(req, res) {
  const { variant } = req.params;
  if (!WALLPAPER_VARIANTS.includes(variant)) {
    return res.status(400).json({ error: 'Variant must be "light" or "dark"' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No image file was provided' });
  }

  const settingKey   = `wallpaper_${variant}`;
  const existingPath = db.readSetting(settingKey);
  if (existingPath) safeDeleteFile(existingPath);

  const newPath = `/uploads/${req.file.filename}`;
  db.writeSetting(settingKey, newPath);
  res.json({ wallpaper_url: newPath });
}

function deleteWallpaperImage(req, res) {
  const { variant } = req.params;
  if (!WALLPAPER_VARIANTS.includes(variant)) {
    return res.status(400).json({ error: 'Variant must be "light" or "dark"' });
  }

  const settingKey   = `wallpaper_${variant}`;
  const existingPath = db.readSetting(settingKey);
  if (existingPath) {
    safeDeleteFile(existingPath);
    db.deleteSetting(settingKey);
  }
  res.json({ wallpaper_url: null });
}

/**
 * How heavily the wallpaper is veiled and softened, 0 to 100. One number
 * drives both: the page decides what blur and what opacity that means, so the
 * two can never be set to a combination that looks wrong.
 */
function setWallpaperFog(req, res) {
  const raw = req.body?.fog;
  const fog = typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(fog) || fog < 0 || fog > 100) {
    return res.status(400).json({ error: 'Fog must be a number between 0 and 100' });
  }

  const rounded = Math.round(fog);
  if (rounded === DEFAULT_WALLPAPER_FOG) db.deleteSetting('wallpaper_fog');
  else                                   db.writeSetting('wallpaper_fog', String(rounded));

  res.json({ wallpaper_fog: rounded });
}

/**
 * How solid the sticky bars are, from completely see-through to flat colour.
 * One number for the header, the group tab strip and the footer: they share a
 * look, and tuning them apart reads as a mistake rather than a choice.
 *
 * The page turns this into both the background alpha and the blur, because a
 * bar that is transparent but still blurring is not see-through at all — it
 * is a smear. The two have to move together.
 */
function setBarOpacity(req, res) {
  const raw     = req.body?.opacity;
  const opacity = typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 100) {
    return res.status(400).json({ error: 'Opacity must be a number between 0 and 100' });
  }

  const rounded = Math.round(opacity);
  if (rounded === DEFAULT_BAR_OPACITY) db.deleteSetting('bar_opacity');
  else                                 db.writeSetting('bar_opacity', String(rounded));

  res.json({ bar_opacity: rounded });
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

// ─── Header brand icon ──────────────────────────────────────────────────────

/**
 * Sets the glyph shown next to the header title. Accepts either a freshly
 * uploaded image (multipart field `icon`) or a library `icon_id`; uploads are
 * auto-registered in the icon library so they can be reused elsewhere.
 */
function setBrandIcon(req, res) {
  const newPath = resolveIconReference({ imageFile: req.file, iconIdField: req.body?.icon_id });
  if (!newPath) {
    return res.status(400).json({ error: 'Provide an image file or a valid icon_id' });
  }

  const existing = db.readSetting('brand_icon');
  // The library owns library-backed files; only stray uploads get removed.
  if (existing && existing !== newPath) safeDeleteFileUnlessLibrary(existing);

  db.writeSetting('brand_icon', newPath);
  res.json({ brand_icon: newPath });
}

function deleteBrandIcon(req, res) {
  const existing = db.readSetting('brand_icon');
  if (existing) {
    safeDeleteFileUnlessLibrary(existing);
    db.deleteSetting('brand_icon');
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

// Whether the active public group tab is painted with the group's own colour
// (default) or the secondary/accent colour. On by default → only persist "off".
function setGroupTabColor(req, res) {
  const enabled = !!req.body.enabled;
  if (enabled) db.deleteSetting('group_tab_color');
  else         db.writeSetting('group_tab_color', '0');
  res.json({ group_tab_color: enabled });
}

// Whether the public group tab strip loops back to the first group instead of
// stopping at the last one. Off by default → only persist "on".
function setGroupTabsLoop(req, res) {
  const enabled = !!req.body.enabled;
  if (enabled) db.writeSetting('group_tabs_loop', '1');
  else         db.deleteSetting('group_tabs_loop');
  res.json({ group_tabs_loop: enabled });
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
  setMarkdownOpenMode,
  uploadWallpaperImage,
  deleteWallpaperImage,
  setWallpaperFog,
  setBarOpacity,
  getSettings,
  uploadLogo, deleteLogo,
  setBrandIcon, deleteBrandIcon,
  uploadFavicon, deleteFavicon,
  saveFavicons, setFooterEnabled, setGroupTabColor, setGroupTabsLoop, setSiteTitle, setPinnedGroup,
  setPublicPassword, deletePublicPassword,
  setRequestsEnabled, setRequestPassword, deleteRequestPassword,
  setTheme,
};
