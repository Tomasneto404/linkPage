// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const c = require('../controllers/statsController');

const router = express.Router();

router.get('/api/stats', requireAdmin, c.getStats);

module.exports = router;
