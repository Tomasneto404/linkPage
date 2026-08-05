// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * First-run content: a single hidden "Buy me a coffee" link.
 *
 * Hidden means it shows in the admin (with the usual eye toggle) but never on
 * the public page, so a new install still opens on a clean public page. It sits
 * in no group — the admin can move it, unhide it, or delete it.
 *
 * Its icon goes through the same favicon service a normal link save uses; if
 * that fetch comes back empty — offline install, blocked egress — we fall back
 * to a locally generated glyph so the card is never iconless.
 *
 * Deliberately not a schema migration: a migration would also fire on existing
 * installs upgrading to that version, adding the link to databases that already
 * have real content.
 */

const fs   = require('fs');
const path = require('path');

const { UPLOADS_DIR }      = require('../config/env');
const { ICON_EXT_BY_MIME } = require('../config/constants');
const { db: rawDb }        = require('../config/db');
const db                   = require('../models');
const { fetchFaviconForUrl }  = require('./faviconService');
const { broadcastDataUpdate } = require('./sseService');

const SEED_LINK = {
  name:        'Buy me a coffee',
  url:         'https://buymeacoffee.com/tomasneto26',
  // Pinned at the site's own favicon, NOT at the link URL: a creator page
  // declares that creator's avatar as its icon, so fetching from the link would
  // put a photo of a person on the card instead of the brand's cup.
  iconUrl:     'https://buymeacoffee.com/favicon.ico',
  description: 'LinkPage is free and open source. If you like the project, please consider supporting the developer.',
};

// Orange coffee cup, in the same 24×24 line style as the stock icon set and
// drawn at 128 px so link cards stay crisp. Used when the fetch finds nothing
// (offline install, blocked egress).
const FALLBACK_ICON_COLOR = '#ff9f0a';
const FALLBACK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="${FALLBACK_ICON_COLOR}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;

const ICON_BASENAME = 'seed-buy-me-a-coffee';

/**
 * Saves `contents` as the link's custom icon: writes the file, registers it in
 * the shared icon library (which then owns its lifecycle, like every other
 * image_path), points the link at it, and nudges open pages over SSE.
 *
 * Stored as image_path rather than favicon_path on purpose — a custom icon
 * survives the admin re-saving the link, which would otherwise re-run the
 * favicon fetch against the link URL and bring the avatar back.
 */
function applySeedIcon(linkId, { contents, extension, mimeType, label }) {
  try {
    const filename   = `${ICON_BASENAME}${extension}`;
    const storedPath = `/uploads/${filename}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), contents);

    db.createIcon({
      filePath:     storedPath,
      originalName: label,
      mimeType,
      fileSize:     Buffer.byteLength(contents),
    });
    db.updateLinkImage(linkId, storedPath);
    broadcastDataUpdate();
    return true;
  } catch (err) {
    console.warn(`[seed] Could not save the example icon: ${err.message}`);
    return false;
  }
}

/**
 * Fetches the site icon through the same favicon service a normal link save
 * uses, then stores it; falls back to the built-in orange cup when the fetch
 * comes back empty. Never awaited: a slow or unreachable host must not delay
 * startup, and the SSE broadcast makes open pages pick the icon up on their own.
 */
async function attachSeedIcon(linkId) {
  let found = null;
  try {
    found = await fetchFaviconForUrl(SEED_LINK.iconUrl);
  } catch {
    // Same handling as "nothing found" — the fallback below covers it.
  }

  if (found) {
    const type = String(found.contentType || '').split(';')[0].trim().toLowerCase();
    const ok = applySeedIcon(linkId, {
      contents:  found.buffer,
      extension: ICON_EXT_BY_MIME[type] || '.png',
      mimeType:  type || 'image/png',
      label:     'Buy Me a Coffee',
    });
    if (ok) {
      console.log('[seed] Fetched the Buy Me a Coffee icon for the example link');
      return;
    }
  }

  const usedFallback = applySeedIcon(linkId, {
    contents:  FALLBACK_ICON_SVG,
    extension: '.svg',
    mimeType:  'image/svg+xml',
    label:     'Coffee cup',
  });
  if (usedFallback) {
    console.log('[seed] Icon fetch found nothing — used the built-in orange coffee cup');
  }
}

/**
 * Creates the hidden example link. Bails out if any link already exists, so
 * deleting it keeps it deleted and a re-run can never duplicate it. Callers
 * should additionally gate on a fresh database.
 */
function seedFirstRunContent() {
  if (db.getAllLinks().length > 0) return;

  let linkId;

  // The models layer owns SQL, but the insert and the hide have to land
  // together — a link left visible would show up on the public page, which is
  // exactly what this seed must not do.
  rawDb.exec('BEGIN');
  try {
    linkId = Number(db.createLink({
      name:        SEED_LINK.name,
      url:         SEED_LINK.url,
      description: SEED_LINK.description,
      groupIds:    [],
    }).lastInsertRowid);
    db.updateLinkVisibility(linkId, true);
    rawDb.exec('COMMIT');
    console.log(`[seed] Created the hidden "${SEED_LINK.name}" link (admin-only)`);
  } catch (err) {
    rawDb.exec('ROLLBACK');
    // Non-fatal: an empty install still works, it just starts with no content.
    console.error(`[seed] Could not create the example link: ${err.message}`);
    return;
  }

  attachSeedIcon(linkId);
}

module.exports = { seedFirstRunContent };
