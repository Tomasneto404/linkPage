// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * /api/my/* — a signed-in member's own links, groups and sections.
 *
 * Every route needs a session. The upload middleware comes after the guards,
 * not before, so a request that is going to be refused never gets to write a
 * byte to disk first.
 *
 * Literal paths (`reorder`) are declared before their `:id` siblings, as in the
 * shared routers, or Express would read "reorder" as an id.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { wrapAsync } = require('../middleware/error');
const { uploadPersonalPayload } = require('../services/privateFiles');
const { createRateLimiter } = require('../middleware/rateLimit');
const my = require('../controllers/personalController');

const faviconPreviewLimit = createRateLimiter(30, 60 * 1000);
// An import can create thousands of rows and queue as many favicon fetches.
const importLimit = createRateLimiter(10, 10 * 60 * 1000);

const router = express.Router();
const member = [requireAuth, my.requireMember];

router.get ('/api/my/data',    ...member, my.data);
router.get ('/api/my/storage', ...member, my.storage);
router.get ('/api/my/icons',   ...member, my.icons);
router.get ('/api/my/export',  ...member, my.exportData);
router.post('/api/my/import',  ...member, importLimit, my.importData);

// Makes this server fetch an address a member typed, so it is throttled: each
// call can open a dozen outbound connections while it hunts for an icon.
router.get ('/api/my/favicon-preview', ...member, faviconPreviewLimit, wrapAsync(my.faviconPreview));

router.get   ('/api/my/favorites',          ...member, my.favorites);
router.post  ('/api/my/favorites/reorder',  ...member, my.reorderFavorites);
router.post  ('/api/my/favorites/:linkId',  ...member, my.addFavorite);
router.delete('/api/my/favorites/:linkId',  ...member, my.removeFavorite);

router.post  ('/api/my/groups/reorder',     ...member, my.reorderGroups);
router.post  ('/api/my/groups',             ...member, my.createGroup);
router.put   ('/api/my/groups/:id',         ...member, my.updateGroup);
router.delete('/api/my/groups/:id',         ...member, my.deleteGroup);
router.post  ('/api/my/groups/:id/sections', ...member, my.createSection);

router.post  ('/api/my/sections/reorder', ...member, my.reorderSections);
router.put   ('/api/my/sections/:id',     ...member, my.updateSection);
router.delete('/api/my/sections/:id',     ...member, my.deleteSection);

router.post  ('/api/my/links/reorder', ...member, my.reorderLinks);
router.post  ('/api/my/links',         ...member, uploadPersonalPayload, wrapAsync(my.createLink));
router.put   ('/api/my/links/:id',     ...member, uploadPersonalPayload, wrapAsync(my.updateLink));
router.delete('/api/my/links/:id',     ...member, wrapAsync(my.deleteLink));

router.get('/api/my/links/:id/icon',    ...member, my.icon);
router.get('/api/my/links/:id/favicon', ...member, my.favicon);
router.get('/api/my/links/:id/file',    ...member, my.file);

module.exports = router;
