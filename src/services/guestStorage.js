// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * How much a guest may keep, and the favicons the server fetches for them.
 *
 * The same shape as personalStorage.js — a separate file because the storage
 * total lives on `guests` rather than `users`, and the favicon pipeline hands
 * bytes to the guest tables. Keeping them apart means a wrong db call fails to
 * compile rather than quietly writes a guest's file into a member's row.
 */

const db = require('../models');
const { DEFAULT_USER_STORAGE_QUOTA } = require('../config/constants');
const { writePrivateFile, deletePrivateFile } = require('./privateFiles');

/** The administrator's setting for guests, falling back to the user default. */
function storageQuotaFor() {
  const n = Number(db.readSetting('guest_storage_quota'));
  if (db.readSetting('guest_storage_quota') !== null && Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_USER_STORAGE_QUOTA;
}

function storageSummary(guestId) {
  const used  = db.getGuestById(guestId)?.storage_used ?? 0;
  const quota = storageQuotaFor();
  return { used, quota, remaining: Math.max(0, quota - used) };
}

function fitsInQuota(guestId, incoming, freed = 0) {
  const { used, quota } = storageSummary(guestId);
  return used - freed + incoming <= quota;
}

const FAVICON_EXT = {
  'image/png': '.png', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
  'image/gif': '.gif', 'image/webp': '.webp', 'image/jpeg': '.jpg',
};

const inFlight = new Set();

function cacheGuestFavicon(guestId, linkId, siteUrl) {
  const job = fetchAndStore(guestId, linkId, siteUrl).catch(() => {}).finally(() => inFlight.delete(job));
  inFlight.add(job);
  return job;
}

function settleGuestFavicons() { return Promise.all([...inFlight]); }

async function fetchAndStore(guestId, linkId, siteUrl) {
  const { fetchFaviconForUrl } = require('./faviconService');
  let found;
  try { found = await fetchFaviconForUrl(siteUrl, { member: true }); } catch { return; }
  if (!found?.buffer) return;
  const ext = FAVICON_EXT[String(found.contentType || '').split(';')[0].trim().toLowerCase()];
  if (!ext) return;

  const row = db.getGuestLinkRow(guestId, linkId);
  if (!row) return;
  if (!fitsInQuota(guestId, found.buffer.byteLength, row.favicon_bytes)) return;

  const filename = writePrivateFile(found.buffer, ext);
  const replaced = db.setGuestLinkFile(guestId, linkId, 'favicon', {
    file: filename, bytes: found.buffer.byteLength,
  });
  if (replaced === undefined || replaced === null && !row.favicon_file) return;
  if (replaced) await deletePrivateFile(replaced);
}

module.exports = { storageQuotaFor, storageSummary, fitsInQuota, cacheGuestFavicon, settleGuestFavicons };
