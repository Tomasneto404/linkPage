// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Sending email, when an administrator has set up an SMTP server.
 *
 * Optional, and off by default: an instance with no mail server works exactly
 * as before, with reset links handed over by an administrator. With one, a
 * person who has forgotten their password can ask for a link themselves.
 *
 * Every address put in an email is built from the configured page address,
 * never from the request. A reset asked for with a forged Host header would
 * otherwise mail the victim a real token on a link to the attacker's site.
 */

const nodemailer = require('nodemailer');

const db = require('../models');
const { isValidHttpUrl } = require('../utils/http');

const SECURITY_MODES = ['starttls', 'tls', 'none'];
const TIMEOUT_MS = 15_000;

function readMailConfig() {
  const port = Number(db.readSetting('smtp_port'));
  const security = db.readSetting('smtp_security');
  return {
    siteUrl:       db.readSetting('mail_site_url') || '',
    host:          db.readSetting('smtp_host') || '',
    port:          Number.isInteger(port) && port > 0 ? port : 587,
    security:      SECURITY_MODES.includes(security) ? security : 'starttls',
    user:          db.readSetting('smtp_user') || '',
    password:      db.readSetting('smtp_password') || '',
    from:          db.readSetting('smtp_from') || '',
    passwordReset: db.readSetting('mail_password_reset') === '1',
  };
}

/** Enough to send anything at all. */
const canSend = cfg => !!cfg.host && !!cfg.from && !!cfg.siteUrl;

/** Whether the sign-in page should offer to email a reset link. */
const offersPasswordReset = (cfg = readMailConfig()) =>
  canSend(cfg) && cfg.passwordReset
  // A password nobody can sign in with is not worth emailing a link for.
  && require('./authService').passwordSignInAllowed();

/** The page address as configured, without a trailing slash, or null. */
function normalizeSiteUrl(value) {
  if (typeof value !== 'string' || !isValidHttpUrl(value.trim())) return null;
  const url = new URL(value.trim());
  if (url.search || url.hash || url.username || url.password) return null;
  return url.href.replace(/\/+$/, '');
}

function transportFor(cfg) {
  return nodemailer.createTransport({
    host:      cfg.host,
    port:      cfg.port,
    secure:    cfg.security === 'tls',
    requireTLS: cfg.security === 'starttls',
    ignoreTLS: cfg.security === 'none',
    auth:      cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout:   TIMEOUT_MS,
    socketTimeout:     TIMEOUT_MS,
  });
}

/** Sends one message. Throws with the server's own words when it is refused. */
async function sendMail({ to, subject, text, html }, cfg = readMailConfig()) {
  if (!canSend(cfg)) throw new Error('Email is not set up');
  const transport = transportFor(cfg);
  try {
    return await transport.sendMail({ from: cfg.from, to, subject, text, html });
  } finally {
    transport.close();
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function siteName() {
  return db.readSetting('site_title') || 'LinkPage';
}

/** The reset email: one link, what it is for, and how long it lasts. */
function resetMessage({ to, token, minutes }, cfg = readMailConfig()) {
  const link = `${cfg.siteUrl}/login/?reset=${token}`;
  const name = siteName();
  const text = [
    `Somebody — hopefully you — asked to reset the password for ${to} on ${name}.`,
    '',
    `Choose a new password here. The link works once, for ${minutes} minutes:`,
    link,
    '',
    'If it was not you, ignore this email. Your password has not changed.',
  ].join('\n');
  const html = `<p>Somebody — hopefully you — asked to reset the password for ${escapeHtml(to)} on ${escapeHtml(name)}.</p>
<p><a href="${escapeHtml(link)}">Choose a new password</a>. The link works once, for ${minutes} minutes.</p>
<p>If it was not you, ignore this email. Your password has not changed.</p>`;
  return { to, subject: `Reset your password for ${name}`, text, html };
}

function testMessage(to) {
  const name = siteName();
  return {
    to,
    subject: `${name} can send email`,
    text: `This is a test from ${name}. If you are reading it, email is set up correctly.`,
  };
}

module.exports = {
  SECURITY_MODES, readMailConfig, canSend, offersPasswordReset, normalizeSiteUrl,
  sendMail, resetMessage, testMessage,
};
