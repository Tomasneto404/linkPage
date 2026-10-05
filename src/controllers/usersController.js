// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Managing accounts, from the admin panel.
 *
 * Three rules run through all of it, and each one exists because breaking it
 * leaves somebody locked out of their own instance:
 *
 *   - The last administrator who can still sign in cannot be demoted, disabled
 *     or deleted. The admin token would still work, but an installation whose
 *     only way in is a 64-character string in a log file is one where somebody
 *     is about to lose an afternoon.
 *   - Nobody changes their own role. Handing yourself a demotion is a mistake,
 *     not an intention, and it is unrecoverable from inside the panel.
 *   - Nobody deletes themselves.
 *
 * The admin token counts as an administrator for reaching these routes, but it
 * is not an account: `req.user.id` is null for it. Every "is this me?" check has
 * to cope with that, which is why they compare against a null-checked id rather
 * than trusting the comparison to fail naturally.
 */

const db = require('../models');
const { USER_ROLES } = require('../config/constants');
const { publicUser, passwordProblem } = require('../services/authService');
const { hashPassword } = require('../utils/password');
const { forgetInitialPassword } = require('../services/seedAdminUser');
const { deletePrivateFiles } = require('../services/privateFiles');
const { storageSummary } = require('../services/personalStorage');

/** The account making this request, or null when it is the admin token. */
const actingUserId = req => (req.user?.via === 'session' ? req.user.id : null);

/** A user with the extra details only an administrator sees. */
function adminView(user) {
  return {
    ...publicUser(user),
    is_active:     user.is_active,
    has_password:  user.has_password,
    created_at:    user.created_at,
    last_login_at: user.last_login_at,
    session_count: db.countSessionsForUser(user.id),
    storage:       storageSummary(user.id),
    storage_quota: user.storage_quota,
  };
}

function list(req, res) {
  res.json({ users: db.getAllUsers().map(adminView) });
}

function get(req, res) {
  const user = db.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'No such user' });
  res.json(adminView(user));
}

/**
 * Changes a display name, a role, whether the account is active, or its storage
 * allowance. Not the password and not the email: one has its own endpoint, and
 * the other is the account's identity.
 */
function update(req, res) {
  const id   = Number(req.params.id);
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: 'No such user' });

  const fields = {};
  if (req.body?.display_name !== undefined) fields.displayName = String(req.body.display_name).trim();

  if (req.body?.role !== undefined) {
    if (!USER_ROLES.includes(req.body.role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "user"' });
    }
    if (id === actingUserId(req) && req.body.role !== user.role) {
      return res.status(409).json({ error: 'You cannot change your own role' });
    }
    fields.role = req.body.role;
  }

  if (req.body?.is_active !== undefined) fields.isActive = !!req.body.is_active;

  // A storage allowance of this account's own, in megabytes, or null to go back
  // to the instance's.
  if (req.body?.storage_quota_mb !== undefined) {
    const mb = req.body.storage_quota_mb;
    if (mb === null) {
      fields.storageQuota = null;
    } else if (typeof mb === 'number' && Number.isFinite(mb) && mb >= 0) {
      fields.storageQuota = Math.round(mb * 1024 * 1024);
    } else {
      return res.status(400).json({ error: 'storage_quota_mb must be a number of megabytes, or null' });
    }
  }

  // Losing the last administrator is the one change that cannot be undone from
  // inside the panel, so it is refused however it is reached — a demotion or a
  // deactivation, by an account or by the token.
  const losingAdmin = (fields.role && fields.role !== 'admin' && user.role === 'admin')
                   || (fields.isActive === false && user.role === 'admin' && user.is_active);
  if (losingAdmin && db.countActiveAdmins() <= 1) {
    return res.status(409).json({
      error: 'This is the only administrator left. Promote somebody else first.',
    });
  }

  const updated = db.updateUser(id, fields);

  // A deactivated account should not keep working until its sessions lapse.
  // A demotion needs no such thing: role is read fresh on every request.
  if (fields.isActive === false) db.deleteSessionsForUser(id);

  req._auditSummary = `Updated ${updated.email}`;
  res.json(adminView(updated));
}

/** Signs one person out of everywhere, without changing their account. */
function logoutEverywhere(req, res) {
  const user = db.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'No such user' });

  const result = db.deleteSessionsForUser(user.id);
  req._auditSummary = `Signed ${user.email} out of ${result.changes} session(s)`;
  res.json({ ok: true, ended: result.changes });
}

/**
 * Sets a password directly, for an administrator helping somebody who is
 * locked out and standing next to them. The reset link is the better path and
 * the one the UI offers first; this exists because sometimes the person is
 * right there.
 */
async function setPassword(req, res) {
  const user = db.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'No such user' });

  const problem = passwordProblem(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });

  db.setUserPassword(user.id, await hashPassword(req.body.password));
  db.updateUser(user.id, { mustChangePassword: true });
  // Whatever sessions that password was protecting are no longer theirs.
  db.deleteSessionsForUser(user.id);
  db.revokeResetsForUser(user.id);

  req._auditSummary = `Set a new password for ${user.email}`;
  res.json({ ok: true });
}

async function remove(req, res) {
  const id   = Number(req.params.id);
  const user = db.getUserById(id);
  if (!user) return res.status(404).json({ error: 'No such user' });

  if (id === actingUserId(req)) {
    return res.status(409).json({ error: 'You cannot delete your own account' });
  }
  if (user.role === 'admin' && user.is_active && db.countActiveAdmins() <= 1) {
    return res.status(409).json({
      error: 'This is the only administrator left. Promote somebody else first.',
    });
  }

  // Their own links go with them, files and all. No table declares a foreign
  // key, so nothing would do this on its own — and a personal link left behind
  // belongs to an id the next account to be created could be given.
  const files = db.deleteAllPersonalContent(id);
  db.deleteUser(id);
  await deletePrivateFiles(files);

  req._auditSummary = `Deleted ${user.email}`;
  res.json({ ok: true });
}

// ─── Invites and resets ───────────────────────────────────────────────────────

/** Builds the link to hand over, on the origin this request arrived at. */
function tokenUrl(req, kind, token) {
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/login/?${kind}=${token}`;
}

function listInvites(req, res) {
  res.json({ invites: db.getUserTokens('invite') });
}

/**
 * Issues an invite. The link comes back once, in this response, and is not
 * recoverable afterwards — only its hash is kept. An admin who loses it issues
 * another one, which is cheap.
 */
function createInvite(req, res) {
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 200) : null;

  const { token, id, expires_at } = db.createUserToken({
    kind: 'invite', role, label, createdByUserId: actingUserId(req),
    ttlDays: req.body?.expires_in_days,
  });

  req._auditSummary = `Invited ${label || 'somebody'} as ${role}`;
  res.status(201).json({ id, role, label, expires_at, url: tokenUrl(req, 'invite', token) });
}

function revokeInvite(req, res) {
  const invite = db.getUserTokenById(Number(req.params.id));
  if (!invite || invite.kind !== 'invite') return res.status(404).json({ error: 'No such invite' });
  if (invite.redeemed_at) {
    return res.status(409).json({ error: 'That invite has already been used' });
  }

  db.revokeUserToken(invite.id);
  req._auditSummary = `Revoked an invite${invite.label ? ` for ${invite.label}` : ''}`;
  res.json({ ok: true });
}

/**
 * Issues a password-reset link for somebody else.
 *
 * This app sends no email — there is no SMTP anywhere in it — so a reset is a
 * link an administrator hands over by whatever means they already trust. Any
 * earlier reset for the same account is revoked, so only the most recent link
 * works.
 */
function createReset(req, res) {
  const user = db.getUserById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'No such user' });

  db.revokeResetsForUser(user.id);
  const { token, id, expires_at } = db.createUserToken({
    kind: 'reset', userId: user.id, label: user.email, createdByUserId: actingUserId(req),
  });

  req._auditSummary = `Issued a password reset for ${user.email}`;
  res.status(201).json({ id, expires_at, url: tokenUrl(req, 'reset', token) });
}

// ─── Redeeming, by the person who was handed the link ─────────────────────────

/**
 * Describes a link without giving anything away.
 *
 * Says only that it is good and what it is for. Not who it was meant for, not
 * who issued it, not the label the admin wrote — a link may be forwarded, and
 * a stranger holding one should learn nothing about the instance from it.
 */
function inspectToken(req, res) {
  const row = db.findRedeemableToken(req.params.token);
  if (!row) return res.status(404).json({ valid: false, error: 'This link is not valid' });

  res.json({
    valid: true,
    kind:  row.kind,
    // For a reset, the address is the one thing worth returning: the person is
    // about to type a password for an account, and should see which.
    email: row.kind === 'reset' ? (db.getUserById(row.user_id)?.email || null) : null,
  });
}

/**
 * Turns an invite into an account, or a reset into a new password, and signs
 * the person in either way.
 *
 * Every failure answers alike: expired, revoked, already used and never existed
 * are one message. Distinguishing them turns this into a way to probe which
 * links once existed.
 */
async function redeemToken(req, res) {
  const { userTokenLimiter } = require('../middleware/rateLimit');
  const { startSession } = require('../services/sessionService');

  if (userTokenLimiter.isLimited(req)) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const problem = passwordProblem(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });

  // Everything that could fail on the caller's side has now been checked, so
  // the token is only claimed once it is about to be spent.
  const claimed = db.claimUserToken(req.params.token);
  if (!claimed) {
    userTokenLimiter.recordFailure(req);
    return res.status(400).json({ error: 'This link is not valid', code: 'bad_token' });
  }

  try {
    const passwordHash = await hashPassword(req.body.password);
    let user;

    if (claimed.kind === 'reset') {
      user = db.getUserById(claimed.user_id);
      if (!user || !user.is_active) throw new Error('account is gone');

      db.setUserPassword(user.id, passwordHash);
      // Every session that the old password opened is now somebody else's
      // problem — most likely the reason the reset was asked for.
      db.deleteSessionsForUser(user.id);
      forgetInitialPassword();
      req._auditSummary = `${user.email} set a new password from a reset link`;
      req._auditAction  = 'user.reset_redeem';
    } else {
      const email = String(req.body?.email || '').trim();
      if (!db.isValidEmail(email)) {
        db.releaseUserToken(claimed.id);
        return res.status(400).json({ error: 'Enter a valid email address' });
      }
      if (db.getUserByEmail(email)) {
        db.releaseUserToken(claimed.id);
        return res.status(409).json({ error: 'That address already has an account' });
      }

      user = db.createUser({
        email,
        displayName:  typeof req.body?.display_name === 'string'
          ? req.body.display_name.trim().slice(0, 100) : null,
        passwordHash,
        role:         claimed.role,
      });
      req._auditSummary = `${user.email} accepted an invite`;
      req._auditAction  = 'invite.redeem';
    }

    db.setTokenRedeemer(claimed.id, user.id);
    startSession(req, res, user);
    req.user = { ...publicUser(user), via: 'session' };

    res.json({ user: publicUser(user) });
  } catch (err) {
    // The token was claimed for something that then failed. Hand it back rather
    // than burning somebody's only invite on our own error.
    db.releaseUserToken(claimed.id);
    throw err;
  }
}

module.exports = {
  list, get, update, remove, setPassword, logoutEverywhere,
  listInvites, createInvite, revokeInvite, createReset,
  inspectToken, redeemToken,
};
