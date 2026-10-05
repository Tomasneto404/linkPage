// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * How much a member may keep, and the one file the server stores for them
 * without being asked: the favicon of each link.
 *
 * The favicon gets its own fetch-and-store here rather than going through the
 * shared cacheFavicon, which cannot be reused for this. That function names the
 * file after a *shared* link's id and writes the result onto a *shared* row —
 * so a personal link with id 5 would overwrite shared link 5's icon. It can also
 * file the image into the icon library, which every administrator browses,
 * labelled with the site's hostname: a member's private bookmarks, listed for
 * whoever runs the instance to read. And it wakes every open page when it
 * finishes. None of that is acceptable for a private link.
 */

const db = require('../models');
const { DEFAULT_USER_STORAGE_QUOTA } = require('../config/constants');
const { writePrivateFile, deletePrivateFile } = require('./privateFiles');

/**
 * This person's allowance in bytes: their own if an administrator set one,
 * otherwise the instance's, otherwise the built-in default.
 */
function storageQuotaFor(ownerId) {
  const own = db.getUserById(ownerId)?.storage_quota;
  if (Number.isFinite(own) && own >= 0) return own;

  const instance = Number(db.readSetting('user_storage_quota'));
  if (db.readSetting('user_storage_quota') !== null && Number.isFinite(instance) && instance >= 0) {
    return instance;
  }
  return DEFAULT_USER_STORAGE_QUOTA;
}

function storageSummary(ownerId) {
  const used  = db.personalStorageUsed(ownerId);
  const quota = storageQuotaFor(ownerId);
  return { used, quota, remaining: Math.max(0, quota - used) };
}

/**
 * Whether `incoming` more bytes fit, given that `freed` bytes are about to be
 * released by whatever the new file replaces. Replacing a 3 MB attachment with
 * a 4 MB one needs 1 MB of headroom, not 4.
 */
function fitsInQuota(ownerId, incoming, freed = 0) {
  const { used, quota } = storageSummary(ownerId);
  return used - freed + incoming <= quota;
}

const FAVICON_EXT = {
  'image/png': '.png', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
  'image/gif': '.gif', 'image/webp': '.webp', 'image/jpeg': '.jpg',
};

/*
 * Fetches still running. The request that started one has already answered,
 * so nothing awaits them in the normal course of things; a test that wants to
 * look at the result asks settlePersonalFavicons() to wait.
 */
const inFlight = new Set();

function cachePersonalFavicon(ownerId, linkId, siteUrl) {
  const job = fetchAndStoreFavicon(ownerId, linkId, siteUrl)
    .catch(() => {})                        // best effort, all the way down
    .finally(() => inFlight.delete(job));
  inFlight.add(job);
  return job;
}

function settlePersonalFavicons() {
  return Promise.all([...inFlight]);
}

/**
 * Fetches the favicon for a personal link and keeps it in private storage.
 *
 * Best effort, like the shared version: a link without an icon is still a
 * link. It is skipped quietly when it would not fit in the person's quota —
 * an icon nobody asked for should never be the thing that refuses their next
 * upload.
 *
 * SVG is refused even though the shared favicons allow it. A site's own SVG is
 * a document that can carry script, and this one would be served from this
 * origin to a signed-in member.
 */
async function fetchAndStoreFavicon(ownerId, linkId, siteUrl) {
  // Required here rather than at the top so a test can stub the module before
  // it is first loaded, the way the harness already does.
  const { fetchFaviconForUrl } = require('./faviconService');

  let found;
  try { found = await fetchFaviconForUrl(siteUrl); } catch { return; }
  if (!found?.buffer) return;

  const ext = FAVICON_EXT[String(found.contentType || '').split(';')[0].trim().toLowerCase()];
  if (!ext) return;

  const row = db.getPersonalLinkRow(ownerId, linkId);
  if (!row) return;                                     // deleted while we fetched
  if (!fitsInQuota(ownerId, found.buffer.byteLength, row.favicon_bytes)) return;

  const filename = writePrivateFile(found.buffer, ext);
  const replaced = db.setPersonalLinkFile(ownerId, linkId, 'favicon', {
    file: filename, bytes: found.buffer.byteLength,
  });

  // undefined: the link went away between the check and the write.
  if (replaced === undefined) { await deletePrivateFile(filename); return; }
  if (replaced) await deletePrivateFile(replaced);
}

module.exports = {
  storageQuotaFor, storageSummary, fitsInQuota,
  cachePersonalFavicon, settlePersonalFavicons,
};
