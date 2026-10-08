// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Group admins. /api/managed/* is what a member trusted with a shared group may
 * do to it; /api/groups/:id/managers is the administrator choosing who that is.
 *
 * The guards run before the upload middleware, so a request that is going to
 * be refused never writes a byte to disk first.
 */

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { wrapAsync } = require('../middleware/error');
const { uploadManagedPayload } = require('../services/uploadService');
const managed = require('../controllers/managedLinksController');

const router = express.Router();
const groupAdmin = [requireAuth, managed.requireGroupAdmin];

router.post  ('/api/managed/links',     ...groupAdmin, uploadManagedPayload, wrapAsync(managed.create));
router.put   ('/api/managed/links/:id', ...groupAdmin, uploadManagedPayload, wrapAsync(managed.update));
router.delete('/api/managed/links/:id', ...groupAdmin, managed.remove);

router.get('/api/groups/:id/managers', requireAdmin, managed.getManagers);
router.put('/api/groups/:id/managers', requireAdmin, managed.setManagers);

module.exports = router;
