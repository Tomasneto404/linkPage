const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/statsController');

const router = express.Router();

router.get('/api/stats', requireAdminToken, c.getStats);

module.exports = router;
