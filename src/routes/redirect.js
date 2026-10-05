// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireLoginIfPrivate } = require('../middleware/auth');
const { clickRateLimit } = require('../middleware/rateLimit');
const c = require('../controllers/redirectController');

const router = express.Router();

// Admin SPA entry point.
router.get('/admin', c.adminPage);

// Click-tracking redirect.
router.get('/r/:id', requireLoginIfPrivate, clickRateLimit, c.redirect);

// Same thing under a link's custom slug. File-backed links are served here
// rather than redirected, so the pretty URL survives in the address bar.
router.get('/f/:slug', requireLoginIfPrivate, clickRateLimit, c.serveBySlug);

module.exports = router;
