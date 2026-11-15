// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Deciding whether someone is who they say they are.
 *
 * Kept apart from the controller on purpose. A login handler is then three
 * steps — authenticate, start a session, answer — and an external identity
 * provider added later replaces only the first of them. Nothing else in the
 * codebase has to learn that a second way to sign in exists.
 *
 * On timing: a wrong address and a wrong password must cost the same. Without
 * the dummy hash below, an unknown address returns immediately while a known
 * one spends ~100 ms hashing, which is a reliable way to enumerate who has an
 * account here.
 */

const db = require('../models');
const { verifyPassword, hashPassword, needsRehash } = require('../utils/password');
const { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } = require('../config/constants');

// A real hash of a value nobody can supply, used to spend the same time on an
// address that does not exist. Built once, lazily, so requiring this module
// costs nothing.
let decoyHash = null;
async function burnTime(password) {
  if (!decoyHash) decoyHash = await hashPassword('no account here, by construction');
  await verifyPassword(decoyHash, typeof password === 'string' ? password : 'x');
  return null;
}

/**
 * Checks an email and password. Returns the user, or null for every kind of
 * failure — wrong address, wrong password, disabled account, or an account
 * with no password because it signs in through an identity provider.
 *
 * The caller must not tell those apart in its response either.
 */
async function authenticateLocal(email, password) {
  if (typeof password !== 'string' || password.length === 0) return burnTime(password);

  const row = db.getUserByEmailWithHash(email);
  if (!row || !row.is_active || !row.password_hash) return burnTime(password);

  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) return null;

  // The plaintext is in hand and correct: the one moment a hash written at an
  // older cost can be quietly brought up to date.
  if (needsRehash(row.password_hash)) {
    try {
      db.setUserPassword(row.id, await hashPassword(password));
    } catch { /* a failed upgrade must never fail the login */ }
  }

  return db.getUserById(row.id);
}

/**
 * Validates a proposed password, returning an error message or null.
 *
 * Length only. Composition rules push people towards `Password1!` and buy
 * nothing; length is the thing that actually costs an attacker.
 */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 'A password is required';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return 'Password is too long';
  }
  return null;
}

/**
 * How a user is described on the wire. One shape, so the admin panel, the
 * public page and /api/auth/me cannot disagree about what a user looks like.
 */
function publicUser(user) {
  if (!user) return null;
  return {
    id:                   user.id,
    email:                user.email,
    display_name:         user.display_name || null,
    role:                 user.role,
    must_change_password: !!user.must_change_password,
  };
}

/**
 * The ways to sign in, for the sign-in page to render buttons from.
 *
 * A provider with a `url` is one the browser is sent to; the sign-in page
 * renders it as a button and appends where to come back to.
 */
function listProviders() {
  // Required here rather than at the top: oidcService needs the models, which
  // are what this module is loaded alongside.
  const oidc = require('./oidcService');
  const cfg  = oidc.readConfig();
  const providers = passwordSignInAllowed(cfg) ? [{ id: 'local', label: 'Password' }] : [];
  if (oidc.isReady(cfg)) providers.push({ id: 'oidc', label: cfg.label, url: '/api/auth/oidc/start' });
  return providers;
}

/**
 * False when an administrator has made single sign-on the only way in. The
 * admin token is not a password sign-in and is never affected: it is the way
 * back when the provider is down.
 */
function passwordSignInAllowed(cfg = require('./oidcService').readConfig()) {
  return !(cfg.ssoOnly && require('./oidcService').isReady(cfg));
}

module.exports = { authenticateLocal, passwordProblem, publicUser, listProviders, passwordSignInAllowed };
