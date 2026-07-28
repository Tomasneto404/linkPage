const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const { upload } = require('../services/uploadService');
const c = require('../controllers/settingsController');

const router = express.Router();

// Public read.
router.get('/api/settings', c.getSettings);

// Admin writes.
router.post  ('/api/settings/logo/:variant',   requireAdminToken, upload.single('logo'),    c.uploadLogo);
router.delete('/api/settings/logo/:variant',   requireAdminToken,                           c.deleteLogo);
router.post  ('/api/settings/favicon',         requireAdminToken, upload.single('favicon'), c.uploadFavicon);
router.delete('/api/settings/favicon',         requireAdminToken,                           c.deleteFavicon);
router.post  ('/api/settings/save-favicons',   requireAdminToken,                           c.saveFavicons);
router.post  ('/api/settings/site-title',      requireAdminToken,                           c.setSiteTitle);
router.post  ('/api/settings/pinned-group',    requireAdminToken,                           c.setPinnedGroup);
router.post  ('/api/settings/public-password', requireAdminToken,                           c.setPublicPassword);
router.delete('/api/settings/public-password', requireAdminToken,                           c.deletePublicPassword);
router.post  ('/api/settings/requests-enabled', requireAdminToken,                          c.setRequestsEnabled);
router.post  ('/api/settings/request-password', requireAdminToken,                          c.setRequestPassword);
router.delete('/api/settings/request-password', requireAdminToken,                          c.deleteRequestPassword);
router.post  ('/api/settings/theme',           requireAdminToken,                           c.setTheme);

module.exports = router;
