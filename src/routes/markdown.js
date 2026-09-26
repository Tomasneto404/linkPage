// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/markdownController');

const router = express.Router();

// Preview for the in-place .md editor. Admin-only: it is a tool for the person
// editing, not a public rendering service.
router.post('/api/markdown/preview', requireAdminToken, c.preview);

module.exports = router;
