// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const groups   = require('../controllers/groupsController');
const sections = require('../controllers/sectionsController');

const router = express.Router();

// Literal path first so it isn't captured by `:id`.
router.post('/api/groups/reorder', requireAdminToken, groups.reorder);

// Public read.
router.get('/api/groups', groups.list);

router.post('/api/groups', requireAdminToken, groups.create);

// Per-group sub-resources.
router.post('/api/groups/:id/sections', requireAdminToken, sections.createForGroup);
router.post('/api/groups/:id/unlock',   groups.unlock);   // public
router.post('/api/groups/:id/lock',     groups.lock);     // public

router.put   ('/api/groups/:id', requireAdminToken, groups.update);
router.delete('/api/groups/:id', requireAdminToken, groups.remove);

module.exports = router;
