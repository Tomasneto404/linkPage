/** Admin/public authentication and token rotation. */

const { divider } = require('../config/env');
const { rotateAdminToken } = require('../config/secrets');
const db = require('../models');
const { isValidAdminToken, isValidPublicPassword } = require('../middleware/auth');
const { adminAuthLimiter, publicAuthLimiter } = require('../middleware/rateLimit');

function verify(req, res) {
  if (adminAuthLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  if (isValidAdminToken(token)) {
    return res.json({ valid: true });
  }
  adminAuthLimiter.recordFailure(req);
  res.json({ valid: false });
}

function verifyPublic(req, res) {
  if (publicAuthLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const stored   = db.readSetting('public_password');

  if (!stored) {
    // No password configured — always valid
    return res.json({ valid: true });
  }

  if (isValidPublicPassword(password)) {
    return res.json({ valid: true });
  }
  publicAuthLimiter.recordFailure(req);
  res.json({ valid: false });
}

/** Generates a new admin token, saves it to disk, and returns it. */
function rotateToken(req, res) {
  const newToken = rotateAdminToken();

  console.log(`\n┌${divider}┐`);
  console.log(`│  🔑 Token rotated! New token: ${newToken}`);
  console.log(`└${divider}┘\n`);

  res.json({ token: newToken });
}

module.exports = { verify, verifyPublic, rotateToken };
