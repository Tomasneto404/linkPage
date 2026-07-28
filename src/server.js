/**
 * HTTP server startup.
 *
 * Wires nothing itself — app.js builds the Express app, the models layer runs
 * schema migrations on require. This file just performs one-time startup
 * bootstrapping (legacy settings migration, banner, health-check timers) and
 * begins listening.
 */

const app = require('./app');
const { PORT, divider } = require('./config/env');
const { getAdminToken } = require('./config/secrets');
const db = require('./models');
const { runHealthCheck } = require('./services/healthService');

// Migrate old single-logo setting to the new light/dark format.
const oldLogoPath = db.readSetting('logo_path');
if (oldLogoPath && !db.readSetting('logo_light')) {
  db.writeSetting('logo_light', oldLogoPath);
  db.deleteSetting('logo_path');
}

console.log(`\n┌${divider}┐`);
console.log(`│  Admin Token: ${getAdminToken()}`);
console.log(`│  Public URL:  http://localhost:${PORT}/`);
console.log(`│  Admin URL:   http://localhost:${PORT}/admin`);
console.log(`└${divider}┘\n`);

// Run the first health check 30 seconds after startup, then every 6 hours.
setTimeout(runHealthCheck, 30_000);
setInterval(runHealthCheck, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {});
