// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin, requirePublicAuth } = require('../middleware/auth');
const { uploadLinkPayload } = require('../services/uploadService');
const links = require('../controllers/linksController');
const stats = require('../controllers/statsController');

const router = express.Router();

// Static/literal paths first so they aren't shadowed by the `:id` routes.
router.get ('/api/links/export',       requireAdmin, links.exportLinks);
router.post('/api/links/import',       requireAdmin, links.importLinks);
router.post('/api/links/reorder',      requireAdmin, links.reorder);
router.post('/api/links/bulk-delete',  requireAdmin, links.bulkDelete);

// Public read.
router.get('/api/links', requirePublicAuth, links.list);

// Per-link admin routes.
router.get   ('/api/links/:id/clicks',     requireAdmin, stats.getLinkClicks);
router.get   ('/api/links/:id/file',       requireAdmin, links.getFile);
router.put   ('/api/links/:id/file',       requireAdmin, links.putFile);
router.post  ('/api/links/:id/visibility', requireAdmin, links.setVisibility);

router.post  ('/api/links',      requireAdmin, uploadLinkPayload, links.create);
router.put   ('/api/links/:id',  requireAdmin, uploadLinkPayload, links.update);
router.delete('/api/links/:id',  requireAdmin,                    links.remove);

module.exports = router;
