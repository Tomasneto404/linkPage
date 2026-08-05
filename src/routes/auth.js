// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdminToken } = require('../middleware/auth');
const authController = require('../controllers/authController');

const router = express.Router();

router.post('/api/auth/verify',        authController.verify);
router.post('/api/auth/verify-public', authController.verifyPublic);
router.post('/api/auth/rotate-token',  requireAdminToken, authController.rotateToken);

module.exports = router;
