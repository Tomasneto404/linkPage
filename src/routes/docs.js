// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const swaggerUiPath = require('swagger-ui-dist').getAbsoluteFSPath();

const { requireAdminToken } = require('../middleware/auth');
const c = require('../controllers/docsController');

const router = express.Router();

// The document itself is gated, like the API it describes.
router.get('/api/openapi.json', requireAdminToken, c.spec);

// The page is not: it is markup with no data in it, and it asks for the token
// itself — the same arrangement /admin has always had.
router.get('/api/docs', c.page);

// Swagger UI's own assets, served from the package rather than a CDN so the
// docs work on an install with no way out to the internet.
router.use('/api/docs/assets', express.static(swaggerUiPath, {
  index: false,
  maxAge: '1h',
}));

module.exports = router;
