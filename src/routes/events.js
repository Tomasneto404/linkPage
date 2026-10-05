// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireLoginIfPrivate } = require('../middleware/auth');
const c = require('../controllers/eventsController');

const router = express.Router();

router.get('/api/events', requireLoginIfPrivate, c.stream);

module.exports = router;
