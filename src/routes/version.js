const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/versionController');

const router = express.Router();

router.get('/api/version', requireAdminToken, c.getVersion);

module.exports = router;
