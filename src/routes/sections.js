// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/sectionsController');

const router = express.Router();

// Literal path first so it isn't captured by `:id`.
router.post  ('/api/sections/reorder', requireAdminToken, c.reorder);
router.put   ('/api/sections/:id',     requireAdminToken, c.update);
router.delete('/api/sections/:id',     requireAdminToken, c.remove);

module.exports = router;
