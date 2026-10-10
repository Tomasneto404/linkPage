// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { upload, uploadWallpaper } = require('../services/uploadService');
const c = require('../controllers/settingsController');
const oidc = require('../controllers/oidcController');
const mail = require('../controllers/mailController');
const { wrapAsync } = require('../middleware/error');

const router = express.Router();

// Public read.
router.get('/api/settings', c.getSettings);

// Admin writes.
router.post  ('/api/settings/logo/:variant',   requireAdmin, upload.single('logo'),    c.uploadLogo);
router.delete('/api/settings/logo/:variant',   requireAdmin,                           c.deleteLogo);
// Accepts a multipart upload (`icon`) or a JSON body with `icon_id`; multer
// passes non-multipart requests straight through to the controller.
router.post  ('/api/settings/brand-icon',      requireAdmin, upload.single('icon'),    c.setBrandIcon);
router.delete('/api/settings/brand-icon',      requireAdmin,                           c.deleteBrandIcon);
router.post  ('/api/settings/favicon',         requireAdmin, upload.single('favicon'), c.uploadFavicon);
router.delete('/api/settings/favicon',         requireAdmin,                           c.deleteFavicon);
router.post  ('/api/settings/save-favicons',   requireAdmin,                           c.saveFavicons);
router.post  ('/api/settings/require-login',   requireAdmin,                           c.setRequireLogin);
router.post  ('/api/settings/season',          requireAdmin,                           c.setSeasonTheme);
router.get   ('/api/settings/oidc',            requireAdmin,                           oidc.getSettings);
router.put   ('/api/settings/oidc',            requireAdmin,                           wrapAsync(oidc.saveSettings));
router.get   ('/api/settings/mail',            requireAdmin,                           mail.getSettings);
router.put   ('/api/settings/mail',            requireAdmin,                           mail.saveSettings);
router.post  ('/api/settings/mail/test',       requireAdmin,                           wrapAsync(mail.sendTest));
router.post  ('/api/settings/footer-enabled',  requireAdmin,                           c.setFooterEnabled);
router.post  ('/api/settings/group-tab-color', requireAdmin,                           c.setGroupTabColor);
router.post  ('/api/settings/group-tabs-loop', requireAdmin,                           c.setGroupTabsLoop);
router.post  ('/api/settings/markdown-open-mode', requireAdmin,                       c.setMarkdownOpenMode);
router.post  ('/api/settings/wallpaper/:variant', requireAdmin, uploadWallpaper, c.uploadWallpaperImage);
router.delete('/api/settings/wallpaper/:variant', requireAdmin,                  c.deleteWallpaperImage);
router.post  ('/api/settings/wallpaper-fog',      requireAdmin,                  c.setWallpaperFog);
router.post  ('/api/settings/bar-opacity',        requireAdmin,                  c.setBarOpacity);
router.post  ('/api/settings/user-quota',         requireAdmin,                  c.setUserQuota);
router.post  ('/api/settings/site-title',      requireAdmin,                           c.setSiteTitle);
router.post  ('/api/settings/pinned-group',    requireAdmin,                           c.setPinnedGroup);
router.post  ('/api/settings/public-password', requireAdmin,                           c.setPublicPassword);
router.delete('/api/settings/public-password', requireAdmin,                           c.deletePublicPassword);
router.post  ('/api/settings/requests-enabled', requireAdmin,                          c.setRequestsEnabled);
router.post  ('/api/settings/request-password', requireAdmin,                          c.setRequestPassword);
router.delete('/api/settings/request-password', requireAdmin,                          c.deleteRequestPassword);
router.post  ('/api/settings/theme',           requireAdmin,                           c.setTheme);

module.exports = router;
