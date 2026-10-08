// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * /api/guest/* — a browser's own groups and links, when an administrator has
 * opened the page to anonymous contributions.
 *
 * Shape and order mirror /api/my/* (routes/personal.js): literal paths before
 * their `:id` siblings, so Express does not read "reorder" as an id.
 *
 * `requireGuest` runs before the upload middleware, so a request that is
 * going to be refused never writes a byte to disk first. The read-only
 * endpoints use `optionalGuest`: a visitor with no cookie gets empty lists.
 */

const express = require('express');
const { wrapAsync } = require('../middleware/error');
const { uploadPersonalPayload } = require('../services/privateFiles');
const { createRateLimiter } = require('../middleware/rateLimit');
const { requireGuest, optionalGuest } = require('../middleware/guest');
const g = require('../controllers/guestController');

const faviconPreviewLimit = createRateLimiter(30, 60 * 1000);

const router = express.Router();

router.get ('/api/guest/data',    optionalGuest, g.data);
router.get ('/api/guest/storage', optionalGuest, g.storage);
router.get ('/api/guest/icons',   optionalGuest, g.icons);
router.get ('/api/guest/favicon-preview', optionalGuest, faviconPreviewLimit, wrapAsync(g.faviconPreview));

router.post  ('/api/guest/groups/reorder',     requireGuest, g.reorderGroups);
router.post  ('/api/guest/groups',             requireGuest, g.createGroup);
router.put   ('/api/guest/groups/:id',         requireGuest, g.updateGroup);
router.delete('/api/guest/groups/:id',         requireGuest, wrapAsync(g.deleteGroup));
router.post  ('/api/guest/groups/:id/sections',requireGuest, g.createSection);

router.post  ('/api/guest/sections/reorder',   requireGuest, g.reorderSections);
router.put   ('/api/guest/sections/:id',       requireGuest, g.updateSection);
router.delete('/api/guest/sections/:id',       requireGuest, g.deleteSection);

router.post  ('/api/guest/links/reorder',      requireGuest, g.reorderLinks);
router.post  ('/api/guest/links',              requireGuest, uploadPersonalPayload, wrapAsync(g.createLink));
router.put   ('/api/guest/links/:id',          requireGuest, uploadPersonalPayload, wrapAsync(g.updateLink));
router.delete('/api/guest/links/:id',          requireGuest, wrapAsync(g.deleteLink));

router.get('/api/guest/links/:id/icon',    optionalGuest, g.icon);
router.get('/api/guest/links/:id/favicon', optionalGuest, g.favicon);
router.get('/api/guest/links/:id/file',    optionalGuest, g.file);

module.exports = router;
