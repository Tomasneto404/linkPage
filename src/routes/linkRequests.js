// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { requestSubmitLimiter } = require('../middleware/rateLimit');
const { uploadRequestPayload } = require('../services/uploadService');
const c = require('../controllers/linkRequestsController');

const router = express.Router();

// Public submit (gated inside the controller by the feature flag + password).
router.post('/api/link-requests', requestSubmitLimiter, uploadRequestPayload, c.submit);

// Admin review.
router.get   ('/api/link-requests',             requireAdmin, c.list);
router.post  ('/api/link-requests/:id/approve', requireAdmin, c.approve);
// Approve by adding the requested group to the link that already has this URL.
router.post  ('/api/link-requests/:id/attach',  requireAdmin, c.attachToExisting);
// Approve a change request by writing its proposed values onto the target link.
router.post  ('/api/link-requests/:id/apply',   requireAdmin, c.applyChange);
router.post  ('/api/link-requests/:id/reject',  requireAdmin, c.reject);
router.delete('/api/link-requests/:id',         requireAdmin, c.remove);

module.exports = router;
