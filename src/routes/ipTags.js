const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/ipTagsController');

const router = express.Router();

router.get   ('/api/ip-tags',     requireAdminToken, c.list);
router.post  ('/api/ip-tags',     requireAdminToken, c.upsert);
router.delete('/api/ip-tags/:ip', requireAdminToken, c.remove);

module.exports = router;
