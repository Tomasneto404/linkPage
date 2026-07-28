/**
 * Express application assembly: middleware wiring, static assets, routes, and
 * the error handler. Exports the configured app; server.js starts it.
 */

const express = require('express');

const { PUBLIC_DIR, UPLOADS_DIR } = require('./config/env');
const { securityHeaders }    = require('./middleware/security');
const { auditAndBroadcast }  = require('./middleware/audit');
const { errorHandler }       = require('./middleware/error');
const routes                 = require('./routes');

const app = express();

// 32 MB headroom: the icon-library import embeds base64 image bytes inline,
// which can add up for a large library. All JSON write routes are admin-gated.
app.use(express.json({ limit: '32mb' }));

// Basic security headers on every response.
app.use(securityHeaders);

// Static assets.
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR, {
  // ETag-based revalidation. After editing an attached file the bytes change
  // but the URL stays the same; no-cache forces every browser to re-check
  // with us so it can never serve a stale copy of an edited file.
  etag:         true,
  lastModified: true,
  setHeaders:   res => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));

// Records an audit entry + broadcasts an SSE data update after any successful
// admin mutation. Registered before the routes so its finish-listener attaches.
app.use(auditAndBroadcast);

// All application routes.
app.use(routes);

// Error handler last.
app.use(errorHandler);

module.exports = app;
