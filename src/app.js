// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Express application assembly: middleware wiring, static assets, routes, and
 * the error handler. Exports the configured app; server.js starts it.
 */

const express = require('express');

const { PUBLIC_DIR, UPLOADS_DIR, TRUST_PROXY } = require('./config/env');
const { securityHeaders }    = require('./middleware/security');
const { attachUser, guardUploads } = require('./middleware/auth');
const { attachGuest } = require('./middleware/guest');
const { verifySameOrigin }   = require('./middleware/csrf');
const { auditAndBroadcast }  = require('./middleware/audit');
const { errorHandler }       = require('./middleware/error');
const routes                 = require('./routes');

const app = express();

// Tells Express how far to trust X-Forwarded-*, which is what makes req.ip and
// req.secure correct behind a reverse proxy. Configurable, and explained in
// src/config/env.js — the short version is that an instance exposed directly to
// the internet should set TRUST_PROXY=0.
app.set('trust proxy', TRUST_PROXY);

// 32 MB headroom: the icon-library import embeds base64 image bytes inline,
// which can add up for a large library. All JSON write routes are admin-gated.
app.use(express.json({ limit: '32mb' }));

// Basic security headers on every response.
app.use(securityHeaders);

// Static assets.
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filename) {
    if (filename.endsWith('/sw.js') || filename.endsWith('/manifest.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    if (filename.endsWith('/sw.js')) res.setHeader('Service-Worker-Allowed', '/');
  },
}));

// File snapshots and restores must not race user mutations.
app.use((req,res,next) => {
  if (require('./services/backupService').isBusy() && !['GET','HEAD','OPTIONS'].includes(req.method) && !req.path.startsWith('/api/workspace/backups')) return res.status(503).json({error:'A backup is in progress. Please retry shortly.'});
  next();
});

// Works out who is asking, before anything downstream needs to know. Never
// rejects; the route guards decide what to do with the answer. Ahead of
// /uploads, which on a members-only page has to know.
app.use(attachUser);
// Reads the lp_guest cookie, if any, so routes that care see req.guest.
// Never mints; writes do that through requireGuest.
app.use(attachGuest);

app.use('/uploads', guardUploads, express.static(UPLOADS_DIR, {
  // ETag-based revalidation. After editing an attached file the bytes change
  // but the URL stays the same; no-cache forces every browser to re-check
  // with us so it can never serve a stale copy of an edited file.
  etag:         true,
  lastModified: true,
  setHeaders:   res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));

// Refuses a state-changing request that another site caused. Has to come after
// attachUser, which is what parses the cookies it looks at.
app.use(verifySameOrigin);

// Records an audit entry + broadcasts an SSE data update after any successful
// admin mutation. Registered before the routes so its finish-listener attaches.
app.use(auditAndBroadcast);

// All application routes.
app.use(routes);

// Anything under /api that no router claimed is a JSON 404. Without this Express
// falls back to its HTML error page, so a typo'd endpoint answers a client that
// only ever parses JSON with a page of markup.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler last.
app.use(errorHandler);

module.exports = app;
