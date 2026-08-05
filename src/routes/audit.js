// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/auditController');

const router = express.Router();

router.get   ('/api/audit',        requireAdminToken, c.list);
router.delete('/api/audit',        requireAdminToken, c.clear);
router.get   ('/api/audit/export', requireAdminToken, c.exportLog);

module.exports = router;
