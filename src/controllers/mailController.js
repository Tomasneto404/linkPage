// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Email: the administrator's SMTP settings, a test message, and the one thing
 * email is used for — a person asking for their own password reset link.
 */

const db = require('../models');
const mail = require('../services/mailService');
const { recordAuditNow } = require('../services/auditService');
const { forgotIpLimiter, forgotAccountLimiter } = require('../middleware/rateLimit');

const RESET_MINUTES = 60;

// ─── Asking for a reset ───────────────────────────────────────────────────────

// Sends still under way after their request has answered, so a test can wait
// for one. Nothing else needs to.
const pending = new Set();
const settleResetEmails = () => Promise.all([...pending]);

/**
 * Emails a reset link to an address, if it belongs to an account here.
 *
 * Answers before looking, and answers the same whatever it finds. Saying "no
 * such account" — or taking longer to answer when there is one, because an
 * email is being sent — would make this a way to find out who has an account.
 */
function forgotPassword(req, res) {
  const cfg = mail.readMailConfig();
  if (!mail.offersPasswordReset(cfg)) {
    return res.status(404).json({ error: 'Password reset by email is not available here' });
  }
  if (forgotIpLimiter.isLimited(req)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  forgotIpLimiter.recordFailure(req);

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 320) : '';
  if (!db.isValidEmail(email)) return res.status(400).json({ error: 'Enter your email address' });

  res.json({ ok: true, minutes: RESET_MINUTES });

  const job = new Promise(resolve => setImmediate(resolve))
    .then(() => sendResetIfAccount(req, email, cfg))
    .catch(err => console.warn(`[mail] reset email failed: ${err.message}`))
    .finally(() => pending.delete(job));
  pending.add(job);
}

async function sendResetIfAccount(req, email, cfg) {
  // Per address, and silent: a stranger repeating someone's address should not
  // be able to fill their inbox, and must not learn anything from being stopped.
  if (forgotAccountLimiter.isLimited(req)) return;
  forgotAccountLimiter.recordFailure(req);

  const user = db.getUserByEmail(email);
  if (!user || !user.is_active) return;

  db.revokeResetsForUser(user.id);
  const { token, id } = db.createUserToken({
    kind: 'reset', userId: user.id, label: user.email, ttlMinutes: RESET_MINUTES,
  });

  try {
    await mail.sendMail(mail.resetMessage({ to: user.email, token, minutes: RESET_MINUTES }, cfg), cfg);
    recordAuditNow(req, {
      action: 'auth.reset_emailed', entityType: 'user', entityId: user.id,
      summary: `Emailed a password reset link to ${user.email}`,
    });
  } catch (err) {
    // A link nobody received is a link nobody should be able to use.
    db.revokeUserToken(id);
    recordAuditNow(req, {
      action: 'auth.reset_email_failed', entityType: 'user', entityId: user.id,
      summary: `Could not email a reset link to ${user.email}: ${String(err.message).slice(0, 200)}`,
    });
    throw err;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** What the admin panel shows. The SMTP password never leaves: only whether there is one. */
function settingsView() {
  const cfg = mail.readMailConfig();
  return {
    site_url:       cfg.siteUrl,
    host:           cfg.host,
    port:           cfg.port,
    security:       cfg.security,
    user:           cfg.user,
    password_set:   !!cfg.password,
    from:           cfg.from,
    password_reset: cfg.passwordReset,
    can_send:       mail.canSend(cfg),
  };
}

function getSettings(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(settingsView());
}

const writeOrDelete = (key, value) => (value ? db.writeSetting(key, String(value)) : db.deleteSetting(key));

/**
 * Saves the settings. Fields left out are left alone; `password` is kept
 * unless a new one is given, or null to remove it.
 */
function saveSettings(req, res) {
  const body = req.body || {};
  const cfg  = mail.readMailConfig();
  const next = { ...cfg };

  if (body.site_url !== undefined) {
    if (body.site_url === '' || body.site_url === null) next.siteUrl = '';
    else {
      next.siteUrl = mail.normalizeSiteUrl(body.site_url);
      if (!next.siteUrl) return res.status(400).json({ error: 'The page address must be an http or https address' });
    }
  }
  if (body.host !== undefined) {
    next.host = typeof body.host === 'string' ? body.host.trim() : '';
    if (next.host.length > 255 || /[\s/]/.test(next.host)) {
      return res.status(400).json({ error: 'The server should be a host name, like smtp.example.com' });
    }
  }
  if (body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'The port must be a number from 1 to 65535' });
    }
    next.port = port;
  }
  if (body.security !== undefined) {
    if (!mail.SECURITY_MODES.includes(body.security)) {
      return res.status(400).json({ error: 'Security must be "starttls", "tls" or "none"' });
    }
    next.security = body.security;
  }
  if (body.user !== undefined) next.user = typeof body.user === 'string' ? body.user.trim().slice(0, 320) : '';
  if (body.password === null) next.password = '';
  else if (typeof body.password === 'string' && body.password !== '') {
    if (body.password.length > 1000) return res.status(400).json({ error: 'The password is too long' });
    next.password = body.password;
  }
  if (body.from !== undefined) {
    next.from = typeof body.from === 'string' ? body.from.trim() : '';
    if (next.from && (!next.from.includes('@') || next.from.length > 320 || /[\r\n]/.test(next.from))) {
      return res.status(400).json({ error: 'The sender should be an address, like links@example.com' });
    }
  }
  if (body.password_reset !== undefined) next.passwordReset = body.password_reset === true;

  if (next.passwordReset && !mail.canSend(next)) {
    return res.status(400).json({
      error: 'Fill in the page address, the server and the sender before offering resets by email',
    });
  }

  writeOrDelete('mail_site_url', next.siteUrl);
  writeOrDelete('smtp_host', next.host);
  writeOrDelete('smtp_port', next.port === 587 ? '' : next.port);
  writeOrDelete('smtp_security', next.security === 'starttls' ? '' : next.security);
  writeOrDelete('smtp_user', next.user);
  writeOrDelete('smtp_password', next.password);
  writeOrDelete('smtp_from', next.from);
  writeOrDelete('mail_password_reset', next.passwordReset ? '1' : '');

  res.json(settingsView());
}

/** Sends a test message, to the address given or to the administrator asking. */
async function sendTest(req, res) {
  const cfg = mail.readMailConfig();
  if (!mail.canSend(cfg)) {
    return res.status(400).json({ error: 'Save the page address, the server and the sender first' });
  }
  const to = typeof req.body?.to === 'string' && req.body.to.trim() ? req.body.to.trim() : req.user?.email;
  if (!to || !db.isValidEmail(to)) {
    return res.status(400).json({ error: 'Sign in with an account to send yourself a test, or give an address' });
  }

  try {
    await mail.sendMail(mail.testMessage(to), cfg);
  } catch (err) {
    return res.status(400).json({ error: `The mail server said: ${String(err.message).slice(0, 300)}` });
  }
  req._auditSummary = `Sent a test email to ${to}`;
  res.json({ ok: true, to });
}

module.exports = { forgotPassword, getSettings, saveSettings, sendTest, settleResetEmails, RESET_MINUTES };
