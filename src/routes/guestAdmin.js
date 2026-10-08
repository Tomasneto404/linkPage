// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Administrator endpoints for guest contributions: the mode and retention
 * settings, the guest list, and deletion per guest or all at once.
 */

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { wrapAsync } = require('../middleware/error');
const g = require('../controllers/guestAdminController');

const router = express.Router();

router.get('/api/settings/contributions', requireAdmin, g.getSettings);
router.put('/api/settings/contributions', requireAdmin, g.setSettings);

router.get   ('/api/guests',       requireAdmin, g.listGuests);
router.delete('/api/guests',       requireAdmin, wrapAsync(g.deleteAllGuests));
router.delete('/api/guests/:id',   requireAdmin, wrapAsync(g.deleteGuest));

module.exports = router;
