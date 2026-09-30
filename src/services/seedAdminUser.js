// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Makes sure there is always a way in.
 *
 * Runs at every boot and does nothing unless the database has no administrator
 * who could sign in. That covers both cases with one rule: a fresh install has
 * no users at all, and an install upgrading from before accounts existed has no
 * users either — both need a first account, and neither should get a second one
 * on the next restart.
 *
 * Deliberately not a schema migration. seedFirstRun.js explains the same
 * reasoning from the other side: a migration fires once, on a version boundary,
 * which is the wrong trigger for "is there an administrator right now". Delete
 * the only admin account and the next restart gives you a new one, which is the
 * behaviour you want at three in the morning.
 *
 * None of this replaces the admin token. The token still works, still appears
 * in the startup banner, and is still the way in when the password is lost. The
 * account exists so that day-to-day administration has a name attached to it in
 * the audit log.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const { DATA_DIR, divider } = require('../config/env');
const db = require('../models');
const { hashPassword } = require('../utils/password');

const PASSWORD_FILE = path.join(DATA_DIR, 'admin-initial-password.txt');

const DEFAULT_EMAIL = 'admin@localhost';

/**
 * Creates the first administrator if there is none.
 *
 * Returns what happened, so the caller can decide what to print:
 *   null                        — an admin already exists, nothing was done
 *   { email, password }         — created, and this password must be shown once
 *   { email, password: null }   — created from ADMIN_PASSWORD, nothing to show
 */
async function seedAdminUser() {
  if (db.countActiveAdmins() > 0) return null;

  const email = (process.env.ADMIN_EMAIL || DEFAULT_EMAIL).trim();
  const supplied = process.env.ADMIN_PASSWORD;

  // 18 bytes of base64url — long enough that nobody is guessing it, short
  // enough to retype from a terminal if that is what someone has to do.
  const password = supplied || crypto.randomBytes(18).toString('base64url');

  // An account made from a generated password is asked to change it. One made
  // from ADMIN_PASSWORD is not: the operator chose that value deliberately, and
  // an automated deployment cannot answer a prompt.
  const user = db.createUser({
    email,
    displayName:        'Administrator',
    passwordHash:       await hashPassword(password),
    role:               'admin',
    mustChangePassword: !supplied,
  });

  if (supplied) return { email: user.email, password: null };

  // Written where the admin token already lives, with the same permissions, so
  // an operator who missed the banner has somewhere to look. Removed as soon as
  // the password is changed.
  try {
    fs.writeFileSync(PASSWORD_FILE, `${password}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn('[auth] Could not write the initial password file:', err.message);
  }

  return { email: user.email, password };
}

/** Prints the first-run credentials, in the shape of the existing banner. */
function announceAdminUser(seeded) {
  if (!seeded?.password) return;
  console.log(`┌${divider}┐`);
  console.log('│  An administrator account was created for you:');
  console.log(`│    Email:    ${seeded.email}`);
  console.log(`│    Password: ${seeded.password}`);
  console.log('│  Change it after signing in. Also saved to');
  console.log('│  data/admin-initial-password.txt, deleted once you do.');
  console.log(`└${divider}┘\n`);
}

/** Forgets the initial password once it is no longer the account's password. */
function forgetInitialPassword() {
  try {
    if (fs.existsSync(PASSWORD_FILE)) fs.unlinkSync(PASSWORD_FILE);
  } catch { /* best effort — a stale file is untidy, not dangerous */ }
}

module.exports = { seedAdminUser, announceAdminUser, forgetInitialPassword, PASSWORD_FILE };
