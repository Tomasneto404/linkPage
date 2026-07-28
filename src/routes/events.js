const express = require('express');
const c = require('../controllers/eventsController');

const router = express.Router();

router.get('/api/events', c.stream);

module.exports = router;
