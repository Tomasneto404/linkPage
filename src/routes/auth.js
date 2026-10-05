// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { wrapAsync } = require('../middleware/error');
const authController = require('../controllers/authController');
const oidcController = require('../controllers/oidcController');
const { oidcLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Signing in and out.
router.post('/api/auth/login',      wrapAsync(authController.login));          // public
router.post('/api/auth/logout',     authController.logout);         // public: always safe
router.get ('/api/auth/me',         authController.me);             // public: answers "nobody"
router.get ('/api/auth/providers',  authController.providers);      // public

router.post('/api/auth/logout-all', requireAuth, authController.logoutEverywhere);
router.post('/api/auth/password',   requireAuth, wrapAsync(authController.changePassword));
router.get ('/api/auth/sessions',   requireAuth, authController.listSessions);
router.delete('/api/auth/sessions/:id', requireAuth, authController.revokeSession);

// Single sign-on. Both legs are browser navigations, so both are GETs that
// answer with a redirect; the state cookie, not an Origin header, is what ties
// the return trip to the browser that set off.
router.get('/api/auth/oidc/start',    oidcLimiter, wrapAsync(oidcController.start));     // public
router.get('/api/auth/oidc/callback', oidcLimiter, wrapAsync(oidcController.callback));  // public
router.get   ('/api/auth/identities', requireAuth, oidcController.ownIdentities);
router.delete('/api/auth/identities', requireAuth, oidcController.unlinkOwn);

// The two shared-secret checks that predate accounts, and the token itself.
router.post('/api/auth/verify',        authController.verify);
router.post('/api/auth/verify-public', authController.verifyPublic);
router.post('/api/auth/rotate-token',  requireAdmin, authController.rotateToken);

module.exports = router;
