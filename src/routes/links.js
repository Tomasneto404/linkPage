const express = require('express');
const { requireAdminToken, requirePublicAuth } = require('../middleware/auth');
const { uploadLinkPayload } = require('../services/uploadService');
const links = require('../controllers/linksController');
const stats = require('../controllers/statsController');

const router = express.Router();

// Static/literal paths first so they aren't shadowed by the `:id` routes.
router.get ('/api/links/export',       requireAdminToken, links.exportLinks);
router.post('/api/links/import',       requireAdminToken, links.importLinks);
router.post('/api/links/reorder',      requireAdminToken, links.reorder);
router.post('/api/links/bulk-delete',  requireAdminToken, links.bulkDelete);

// Public read.
router.get('/api/links', requirePublicAuth, links.list);

// Per-link admin routes.
router.get   ('/api/links/:id/clicks',     requireAdminToken, stats.getLinkClicks);
router.get   ('/api/links/:id/file',       requireAdminToken, links.getFile);
router.put   ('/api/links/:id/file',       requireAdminToken, links.putFile);
router.post  ('/api/links/:id/visibility', requireAdminToken, links.setVisibility);

router.post  ('/api/links',      requireAdminToken, uploadLinkPayload, links.create);
router.put   ('/api/links/:id',  requireAdminToken, uploadLinkPayload, links.update);
router.delete('/api/links/:id',  requireAdminToken,                    links.remove);

module.exports = router;
