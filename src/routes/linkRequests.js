const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const { requestSubmitLimiter } = require('../middleware/rateLimit');
const { upload } = require('../services/uploadService');
const c = require('../controllers/linkRequestsController');

const router = express.Router();

// Public submit (gated inside the controller by the feature flag + password).
router.post('/api/link-requests', requestSubmitLimiter, upload.single('image'), c.submit);

// Admin review.
router.get   ('/api/link-requests',             requireAdminToken, c.list);
router.post  ('/api/link-requests/:id/approve', requireAdminToken, c.approve);
router.post  ('/api/link-requests/:id/reject',  requireAdminToken, c.reject);
router.delete('/api/link-requests/:id',         requireAdminToken, c.remove);

module.exports = router;
