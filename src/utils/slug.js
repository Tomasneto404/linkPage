// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Custom link slugs — the human-readable id behind `/f/<slug>`.
 *
 * A slug is optional: a link without one is still reachable at `/r/<id>`, and
 * a file-backed link keeps its `/uploads/<random>.<ext>` address forever. The
 * slug is purely an extra, prettier front door.
 */

/** Longest slug we store. Comfortably under any practical URL limit. */
const MAX_SLUG_LENGTH = 64;

/**
 * Words that would read as a different part of the site if someone saw them in
 * a `/f/...` URL. `/f/` has its own namespace so none of these can actually
 * shadow a route — this is about not handing out confusing addresses.
 */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'uploads', 'r', 'f', 'health', 'login', 'logout', 'static',
]);

/**
 * Converts free text into a URL-safe slug, or returns null when nothing usable
 * survives. Accents are folded to their base letter ("Relatório" → "relatorio")
 * rather than dropped, so a Portuguese or French title still yields a readable
 * slug instead of a mangled one.
 */
function normalizeSlug(raw) {
  if (typeof raw !== 'string') return null;

  const slug = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip the combining accents NFD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')       // every other run of junk becomes one hyphen
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');               // slice() may have left a dangling hyphen

  return slug || null;
}

/** True when the slug is one of the words we keep for ourselves. */
function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(String(slug || '').toLowerCase());
}

module.exports = { normalizeSlug, isReservedSlug, MAX_SLUG_LENGTH, RESERVED_SLUGS };
