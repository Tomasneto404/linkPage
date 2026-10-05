// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin, requireLoginIfPrivate } = require('../middleware/auth');
const groups   = require('../controllers/groupsController');
const sections = require('../controllers/sectionsController');

const router = express.Router();

// Literal path first so it isn't captured by `:id`.
router.post('/api/groups/reorder', requireAdmin, groups.reorder);

// Public read.
router.get('/api/groups', requireLoginIfPrivate, groups.list);

router.post('/api/groups', requireAdmin, groups.create);

// Per-group sub-resources.
router.post('/api/groups/:id/sections', requireAdmin, sections.createForGroup);
router.post('/api/groups/:id/unlock',   requireLoginIfPrivate, groups.unlock);   // public
router.post('/api/groups/:id/lock',     requireLoginIfPrivate, groups.lock);     // public

router.put   ('/api/groups/:id', requireAdmin, groups.update);
router.delete('/api/groups/:id', requireAdmin, groups.remove);

module.exports = router;
