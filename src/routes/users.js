// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { wrapAsync } = require('../middleware/error');
const users = require('../controllers/usersController');

const router = express.Router();

// Accounts, and the links that create or recover them. All admin-only.
router.get   ('/api/users',              requireAdmin, users.list);
router.get   ('/api/users/:id',          requireAdmin, users.get);
router.patch ('/api/users/:id',          requireAdmin, users.update);
router.delete('/api/users/:id',          requireAdmin, wrapAsync(users.remove));
router.post  ('/api/users/:id/password', requireAdmin, wrapAsync(users.setPassword));
router.post  ('/api/users/:id/logout-all', requireAdmin, users.logoutEverywhere);
router.post  ('/api/users/:id/reset-link', requireAdmin, users.createReset);
router.delete('/api/users/:id/identities', requireAdmin, users.unlinkIdentities);

router.get   ('/api/invites',     requireAdmin, users.listInvites);
router.post  ('/api/invites',     requireAdmin, users.createInvite);
router.delete('/api/invites/:id', requireAdmin, users.revokeInvite);

// Redeeming. Public by necessity — the person holding the link has no account
// yet, or cannot get into the one they have. The link is the credential.
router.get ('/api/tokens/:token',        users.inspectToken);
router.post('/api/tokens/:token/redeem', wrapAsync(users.redeemToken));

module.exports = router;
