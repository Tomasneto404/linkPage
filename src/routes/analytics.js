// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/analyticsController');

const router = express.Router();

router.get('/api/analytics', requireAdminToken, c.getAnalytics);

module.exports = router;
