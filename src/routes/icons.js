const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const { upload } = require('../services/uploadService');
const c = require('../controllers/iconsController');

const router = express.Router();

// Literal paths first so they aren't captured by `:id`.
router.get ('/api/icons/export',      requireAdminToken, c.exportLib);
router.post('/api/icons/import',      requireAdminToken, c.importLib);
router.post('/api/icons/bulk-delete', requireAdminToken, c.bulkDelete);

router.get   ('/api/icons',     requireAdminToken,                        c.list);
router.post  ('/api/icons',     requireAdminToken, upload.single('image'), c.create);
router.delete('/api/icons/:id', requireAdminToken,                        c.remove);

// Live favicon preview for the link form.
router.get('/api/favicon-preview', requireAdminToken, c.faviconPreview);

module.exports = router;
