// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Single sign-on: the two legs of the trip to the identity provider, a
 * member's own connection to it, and the administrator's settings.
 *
 * Both legs are browser navigations, not API calls, so both answer with a
 * redirect — to the provider, back to where the person was going, or to the
 * sign-in page with a short code saying what went wrong. The detail goes to
 * the audit log and the server console, where an administrator can act on it;
 * the person signing in is told only what they can act on.
 */

const db = require('../models');
const oidc = require('../services/oidcService');
const { startSession } = require('../services/sessionService');
const { publicUser } = require('../services/authService');
const { recordAuditNow } = require('../services/auditService');
const { parseCookies, requestOrigin } = require('../utils/http');

const STATE_COOKIE = 'lp_oidc';
const STATE_COOKIE_PATH = '/api/auth/oidc';

/**
 * A path on this site to land on afterwards, or null. Parsed, not matched:
 * "//evil.example" and "/\\evil.example" look like paths and are not.
 */
function safeNextPath(next) {
  if (typeof next !== 'string' || !next.startsWith('/') || next.length > 2000) return null;
  try {
    const base = 'http://linkpage.invalid';
    const url  = new URL(next, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function setStateCookie(req, res, state) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  // Lax, not Strict: the provider sends the browser back here with a top-level
  // GET from its own site, and Strict would leave the cookie behind.
  res.append('Set-Cookie', [
    `${STATE_COOKIE}=${state}`, `Path=${STATE_COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(oidc.LOGIN_MAX_AGE_MS / 1000)}`, ...(secure ? ['Secure'] : []),
  ].join('; '));
}

function clearStateCookie(res) {
  res.append('Set-Cookie', `${STATE_COOKIE}=; Path=${STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const callbackUrl = req => `${requestOrigin(req)}${STATE_COOKIE_PATH}/callback`;

function failurePage({ code, connecting, nextPath }) {
  if (connecting) return `/?account=1&sso_error=${encodeURIComponent(code)}`;
  const params = new URLSearchParams({ sso_error: code });
  if (nextPath) params.set('next', nextPath);
  return `/login/?${params}`;
}

// ─── The trip ─────────────────────────────────────────────────────────────────

/**
 * Sends the browser to the provider. With `connect=1` and a session, the trip
 * connects the signed-in member's account instead of signing anybody in.
 */
async function start(req, res) {
  const connecting = req.query.connect === '1';
  const nextPath   = safeNextPath(req.query.next);

  if (connecting && req.user?.via !== 'session') {
    return res.redirect(302, failurePage({ code: 'expired', nextPath }));
  }

  try {
    const { url, state } = await oidc.beginLogin({
      redirectUri: callbackUrl(req),
      nextPath,
      linkUserId:  connecting ? req.user.id : null,
    });
    setStateCookie(req, res, state);
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url);
  } catch (err) {
    console.warn(`[sso] could not start a sign-in: ${err.message}`);
    res.redirect(302, failurePage({ code: err.code === 'disabled' ? 'disabled' : 'unavailable',
                                    connecting, nextPath }));
  }
}

/** Where the provider sends the browser back to. */
async function callback(req, res) {
  clearStateCookie(res);
  res.set('Cache-Control', 'no-store');

  const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE];
  const providerError = typeof req.query.error === 'string' ? req.query.error : null;

  try {
    if (providerError) {
      // Declined at the provider, or the provider refused us. Still consume
      // the pending sign-in so its state cannot be replayed.
      const err = new oidc.OidcError(providerError === 'access_denied' ? 'denied' : 'failed',
                                     `The provider answered ${providerError.slice(0, 100)}`);
      await oidc.completeLogin({ state: req.query.state, cookieState, code: null,
                                 sessionUserId: req.user?.id ?? null }).catch(e => {
        err.connecting = e.connecting; err.nextPath = e.nextPath;
      });
      throw err;
    }

    const result = await oidc.completeLogin({
      state: req.query.state, cookieState, code: req.query.code,
      sessionUserId: req.user?.via === 'session' ? req.user.id : null,
    });
    const { user } = result;

    if (result.connecting) {
      recordAuditNow(req, {
        action: 'auth.sso_connected', entityType: 'user', entityId: user.id,
        summary: `${user.email} connected their account to single sign-on`,
      });
      return res.redirect(302, '/?account=1&sso=connected');
    }

    startSession(req, res, user, { remember: true });
    req.user = { ...publicUser(user), via: 'session' };

    if (result.created) {
      recordAuditNow(req, {
        action: 'user.create', entityType: 'user', entityId: user.id,
        summary: `Created ${user.email} on their first single sign-on`,
      });
    } else if (result.linked) {
      recordAuditNow(req, {
        action: 'auth.sso_connected', entityType: 'user', entityId: user.id,
        summary: `Connected ${user.email} to single sign-on by their verified address`,
      });
    }
    if (result.roleChanged) {
      recordAuditNow(req, {
        action: 'user.update', entityType: 'user', entityId: user.id,
        summary: result.roleChanged === 'admin'
          ? `Made ${user.email} an administrator, as a member of the provider's administrator group`
          : `Made ${user.email} a member, no longer in the provider's administrator group`,
      });
    } else if (result.roleKept) {
      recordAuditNow(req, {
        action: 'user.update', entityType: 'user', entityId: user.id,
        summary: `Kept ${user.email} an administrator although the provider no longer says so: they are the last one`,
      });
    }
    recordAuditNow(req, {
      action: 'auth.login', entityType: 'auth',
      summary: `${user.email} signed in with single sign-on`,
    });

    // Nowhere in particular to go back to: an administrator's place is the
    // panel, the same choice the password sign-in makes.
    const home = user.role === 'admin' ? '/admin/' : '/';
    res.redirect(302, result.login.next_path && result.login.next_path !== '/' ? result.login.next_path : home);
  } catch (err) {
    const code = err instanceof oidc.OidcError ? err.code : 'failed';
    if (!(err instanceof oidc.OidcError)) console.error('[sso] sign-in failed:', err);
    else console.warn(`[sso] sign-in refused (${code}): ${err.message}`);

    recordAuditNow(req, {
      action: 'auth.login_failed', entityType: 'auth',
      summary: `Single sign-on refused: ${err instanceof oidc.OidcError ? err.message : 'an unexpected error'}`,
    });
    res.redirect(302, failurePage({ code, connecting: err.connecting, nextPath: err.nextPath }));
  }
}

// ─── A member's own connection ────────────────────────────────────────────────

/** Whether this account is connected, and whether it could be. */
function ownIdentities(req, res) {
  const user = db.getUserById(req.user.id);
  const cfg  = oidc.readConfig();
  res.set('Cache-Control', 'no-store');
  res.json({
    available:    oidc.isReady(cfg),
    label:        cfg.label,
    has_password: !!user?.has_password,
    identities:   db.getIdentitiesForUser(req.user.id).map(i => ({
      email: i.email, created_at: i.created_at, last_login_at: i.last_login_at,
    })),
  });
}

/**
 * Disconnects your own account. Refused when it would leave the account with
 * no way in at all.
 */
function unlinkOwn(req, res) {
  if (req.user.via !== 'session') {
    return res.status(400).json({ error: 'The admin token is not an account' });
  }
  const user = db.getUserById(req.user.id);
  if (!user.has_password) {
    return res.status(409).json({
      error: 'This account has no password, so single sign-on is its only way in. Ask an administrator for a reset link first.',
    });
  }
  db.deleteIdentitiesForUser(user.id);
  req._auditSummary = `${user.email} disconnected their account from single sign-on`;
  res.json({ ok: true });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/** What the admin panel shows. The client secret never leaves: only whether there is one. */
function settingsView() {
  const cfg = oidc.readConfig();
  return {
    enabled:           cfg.enabled,
    issuer:            cfg.issuer,
    client_id:         cfg.clientId,
    client_secret_set: !!cfg.clientSecret,
    label:             db.readSetting('oidc_label') || '',
    default_label:     oidc.DEFAULT_LABEL,
    auto_create:       cfg.autoCreate,
    link_by_email:     cfg.linkByEmail,
    admin_group:       cfg.adminGroup,
    sso_only:          cfg.ssoOnly,
  };
}

function getSettings(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(settingsView());
}

const writeOrDelete = (key, value) => (value ? db.writeSetting(key, value) : db.deleteSetting(key));
const writeFlag     = (key, on) => (on ? db.writeSetting(key, '1') : db.deleteSetting(key));

/**
 * Saves the settings. Fields left out are left alone; `client_secret` is kept
 * unless a new one is given, or null to remove it.
 *
 * Turning it on asks the provider for its discovery document first, so a typo
 * in the issuer shows up here, as an error the administrator can read, rather
 * than as a broken button on the sign-in page.
 */
async function saveSettings(req, res) {
  const body = req.body || {};
  const cfg  = oidc.readConfig();

  let issuer = cfg.issuer;
  if (body.issuer !== undefined) {
    if (body.issuer === '' || body.issuer === null) issuer = '';
    else {
      issuer = oidc.normalizeIssuer(body.issuer);
      if (!issuer) return res.status(400).json({ error: 'The issuer must be an http or https address' });
    }
  }

  let clientId = cfg.clientId;
  if (body.client_id !== undefined) {
    clientId = typeof body.client_id === 'string' ? body.client_id.trim() : '';
    if (clientId.length > 255) return res.status(400).json({ error: 'The client ID is too long' });
  }

  let clientSecret = cfg.clientSecret;
  if (body.client_secret === null) clientSecret = '';
  else if (typeof body.client_secret === 'string' && body.client_secret !== '') {
    if (body.client_secret.length > 1000) return res.status(400).json({ error: 'The client secret is too long' });
    clientSecret = body.client_secret;
  }

  let label = db.readSetting('oidc_label') || '';
  if (body.label !== undefined) {
    label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
  }

  const enabled = body.enabled !== undefined ? body.enabled === true : cfg.enabled;

  let adminGroup = cfg.adminGroup;
  if (body.admin_group !== undefined) {
    adminGroup = typeof body.admin_group === 'string' ? body.admin_group.trim().slice(0, 200) : '';
  }

  // Password sign-in can only be switched off while there is something else
  // to sign in with. Switching single sign-on off switches this off with it.
  let ssoOnly = body.sso_only !== undefined ? body.sso_only === true : cfg.ssoOnly;
  if (!enabled) ssoOnly = false;

  if (enabled) {
    if (!issuer || !clientId) {
      return res.status(400).json({ error: 'An issuer and a client ID are needed to turn single sign-on on' });
    }
    try {
      oidc.resetCaches();
      await oidc.discover(issuer, { fresh: true });
    } catch (err) {
      return res.status(400).json({ error: `The provider could not be checked. ${err.message}` });
    }
  }

  writeOrDelete('oidc_issuer', issuer);
  writeOrDelete('oidc_client_id', clientId);
  writeOrDelete('oidc_client_secret', clientSecret);
  writeOrDelete('oidc_label', label === oidc.DEFAULT_LABEL ? '' : label);
  writeFlag('oidc_enabled', enabled);
  if (body.auto_create !== undefined)   writeFlag('oidc_auto_create', body.auto_create === true);
  if (body.link_by_email !== undefined) writeFlag('oidc_link_by_email', body.link_by_email === true);
  writeOrDelete('oidc_admin_group', adminGroup);
  writeFlag('oidc_sso_only', ssoOnly);
  oidc.resetCaches();

  res.json(settingsView());
}

module.exports = {
  start, callback, ownIdentities, unlinkOwn, getSettings, saveSettings,
  safeNextPath, STATE_COOKIE,
};
