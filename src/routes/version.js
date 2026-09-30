// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const c = require('../controllers/versionController');
const changelog = require('../controllers/changelogController');

const router = express.Router();

router.get('/api/version', requireAdmin, c.getVersion);
// Release notes shown in the admin sidebar, parsed from CHANGELOG.md.
router.get('/api/changelog', requireAdmin, changelog.getChangelog);

module.exports = router;
