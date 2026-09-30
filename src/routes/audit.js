// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const c = require('../controllers/auditController');

const router = express.Router();

router.get   ('/api/audit',        requireAdmin, c.list);
router.delete('/api/audit',        requireAdmin, c.clear);
router.get   ('/api/audit/export', requireAdmin, c.exportLog);

module.exports = router;
