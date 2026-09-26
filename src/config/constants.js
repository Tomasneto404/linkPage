// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Shared constant values: upload allow-lists, theme enums, and validation
 * regexes. Kept dependency-free so any layer can require them.
 */

// ─── Upload allow-lists ─────────────────────────────────────────────────────

const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'];
const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/x-icon', 'image/vnd.microsoft.icon',
];

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

// Types that a browser runs as a document when the URL is opened directly:
// SVG and (X)HTML can carry <script>, XML can pull in an XSLT that does, and
// JSON renders as a document in older browsers. Uploads are served from the
// same origin as the admin panel, whose token lives in localStorage — so an
// unauthenticated submitter must never be able to put one of these on disk.
// Admins keep the full list: they already hold the token these would steal.
const ACTIVE_CONTENT_EXTENSIONS = new Set([
  '.svg', '.htm', '.html', '.xml', '.json',
]);
const ACTIVE_CONTENT_MIME_TYPES = new Set([
  'image/svg+xml',
  'text/html', 'application/xhtml+xml',
  'text/xml', 'application/xml',
  'application/json', 'text/json',
]);

// What a public link request may attach: the admin list minus anything that
// executes when opened.
const PUBLIC_REQUEST_FILE_EXTENSIONS =
  ALLOWED_FILE_EXTENSIONS.filter(ext => !ACTIVE_CONTENT_EXTENSIONS.has(ext));

// ─── Settings / theme ───────────────────────────────────────────────────────

const LOGO_VARIANTS = ['light', 'dark'];
// The public page can carry a background image per theme, with a "fog" over it.
const WALLPAPER_VARIANTS = ['light', 'dark'];
const DEFAULT_WALLPAPER_FOG = 60;
// How solid the sticky bars are, 0 to 100. At 0 they are completely
// see-through — no tint, no blur, nothing but their text floating over
// whatever is behind. At 100 they are the flat colour they would have been
// before any of this existed. 82 matches the translucency the header and tab
// strip shipped with.
const DEFAULT_BAR_OPACITY = 82;

const THEME_LIGHT_VARIANTS = ['default', 'snow', 'warm'];
const THEME_DARK_VARIANTS  = ['default', 'midnight', 'slate'];
const DEFAULT_THEMES       = ['light', 'dark', 'system'];
const MOBILE_NAV_POSITIONS = ['top', 'bottom'];
const HEX_COLOR_RE         = /^#[0-9a-f]{6}$/i;

// ─── Icon library import/export ─────────────────────────────────────────────

const ICON_IMPORT_MAX_BYTES = 3 * 1024 * 1024;   // per icon
const ICON_EXT_BY_MIME = {
  'image/png':  '.png',  'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg',
  'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
};

// ─── In-place file editor ───────────────────────────────────────────────────

const EDITABLE_FILE_EXTENSIONS = new Set([
  '.htm', '.html', '.xml', '.json', '.txt', '.md', '.log', '.csv', '.svg',
]);
const FILE_EDIT_MAX_BYTES = 5 * 1024 * 1024;

module.exports = {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_FILE_EXTENSIONS,
  PUBLIC_REQUEST_FILE_EXTENSIONS,
  ACTIVE_CONTENT_EXTENSIONS,
  ACTIVE_CONTENT_MIME_TYPES,
  ALLOWED_FILE_MIME_TYPES,
  LOGO_VARIANTS,
  WALLPAPER_VARIANTS,
  DEFAULT_WALLPAPER_FOG,
  DEFAULT_BAR_OPACITY,
  THEME_LIGHT_VARIANTS,
  THEME_DARK_VARIANTS,
  DEFAULT_THEMES,
  MOBILE_NAV_POSITIONS,
  HEX_COLOR_RE,
  ICON_IMPORT_MAX_BYTES,
  ICON_EXT_BY_MIME,
  EDITABLE_FILE_EXTENSIONS,
  FILE_EDIT_MAX_BYTES,
};
