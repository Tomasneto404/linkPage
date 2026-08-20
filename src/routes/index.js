// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Combines every resource router into one. Each sub-router declares full
 * `/api/...` (or `/r`, `/admin`) paths and is mounted at the root, so route
 * precedence matches the original monolith: literal paths are declared before
 * their `:id` siblings within each file.
 */

const express = require('express');

const router = express.Router();

router.use(require('./events'));
router.use(require('./auth'));
router.use(require('./settings'));
router.use(require('./version'));
router.use(require('./icons'));
router.use(require('./audit'));
router.use(require('./stats'));
router.use(require('./analytics'));
router.use(require('./ipTags'));
router.use(require('./linkRequests'));
router.use(require('./links'));
router.use(require('./groups'));
router.use(require('./sections'));
router.use(require('./redirect'));

module.exports = router;
