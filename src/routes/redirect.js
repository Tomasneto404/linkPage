const express = require('express');
const { clickRateLimit } = require('../middleware/rateLimit');
const c = require('../controllers/redirectController');

const router = express.Router();

// Admin SPA entry point.
router.get('/admin', c.adminPage);

// Click-tracking redirect.
router.get('/r/:id', clickRateLimit, c.redirect);

module.exports = router;
