// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Groups: public read + unlock/lock, admin write, reorder. */

const db = require('../models');
const { isValidHexColor } = require('../utils/http');
const { normaliseGroupPassword } = require('../utils/parsers');
const { signGroupUnlock, getUnlockedGroupExpiries } = require('../utils/groupCrypto');
const { GROUP_UNLOCK_TTL_MS, GROUP_SESSION_EXPIRY_MS } = require('../config/secrets');
const { groupUnlockLimiter } = require('../middleware/rateLimit');

// ─── Public read ──────────────────────────────────────────────────────────────

function list(req, res) {
  const groups   = db.getAllGroups();
  const expiries = getUnlockedGroupExpiries(req);
  res.json(groups.map(g => {
    if (!g.is_protected)        return { ...g, is_unlocked: true };
    const expMs = expiries.get(g.id);
    return {
      ...g,
      is_unlocked:    !!expMs,
      unlocked_until: expMs ?? null,
    };
  }));
}

// ─── Reorder ──────────────────────────────────────────────────────────────────

function reorder(req, res) {
  const { order } = req.body;
  if (!Array.isArray(order) || order.some(id => typeof id !== 'number')) {
    return res.status(400).json({ error: '"order" must be an array of numeric IDs' });
  }
  db.reorderGroups(order);
  res.status(204).end();
}

// ─── Admin write ──────────────────────────────────────────────────────────────

function create(req, res) {
  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const safeColor = isValidHexColor(color) ? color : '#0071e3';
  const password  = normaliseGroupPassword(req.body);
  const result    = db.createGroup({
    name: name.trim(),
    color: safeColor,
    password:   password ?? undefined,
    unlockMode: req.body.unlock_mode,        // sanitised inside createGroup
  });
  res.status(201).json(db.getGroupById(result.lastInsertRowid));
}

function update(req, res) {
  const existingGroup = db.getGroupById(req.params.id);
  if (!existingGroup) return res.status(404).json({ error: 'Group not found' });

  const { name, color } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const safeColor = isValidHexColor(color) ? color : existingGroup.color;
  db.updateGroup(req.params.id, {
    name:       name.trim(),
    color:      safeColor,
    password:   normaliseGroupPassword(req.body),
    unlockMode: req.body.unlock_mode,        // undefined => leave as-is
  });
  res.json(db.getGroupById(req.params.id));
}

function remove(req, res) {
  const group = db.getGroupById(req.params.id);
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }
  req._auditSummary = `Deleted group "${group.name}"`;
  db.deleteGroup(req.params.id);
  res.status(204).end();
}

// ─── Unlock / lock (public) ───────────────────────────────────────────────────

/**
 * Verifies a password for a protected group. On success, sets a long-lived
 * HMAC-signed cookie so subsequent requests skip the prompt.
 * Rate-limited per-IP, but only failed attempts count toward the budget.
 */
function unlock(req, res) {
  if (groupUnlockLimiter.isLimited(req)) {
    return res.status(429).json({ valid: false, error: 'Too many failed attempts. Try again later.' });
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid group id' });

  const group = db.getGroupById(id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.is_protected) return res.json({ valid: true });

  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!db.verifyGroupPassword(id, password)) {
    groupUnlockLimiter.recordFailure(req);
    return res.status(401).json({ valid: false, error: 'Wrong password' });
  }

  // Choose how the unlock should persist based on the group's mode:
  //   'timeout' (default) → 30 s, both client-side and server-side.
  //   'session'           → browser session cookie (no Max-Age), valid for
  //                         up to a year server-side. The browser deletes it
  //                         on tab/window close, which is the relock signal.
  const mode    = group.unlock_mode === 'session' ? 'session' : 'timeout';
  const ttlMs   = mode === 'session' ? GROUP_SESSION_EXPIRY_MS : GROUP_UNLOCK_TTL_MS;
  const expMs   = Date.now() + ttlMs;
  const token   = signGroupUnlock(id, expMs);
  const secure  = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const maxAge  = mode === 'session'
    ? ''                                          // no Max-Age → browser session cookie
    : `; Max-Age=${Math.ceil(GROUP_UNLOCK_TTL_MS / 1000)}`;
  res.setHeader('Set-Cookie',
    `lp_grp_${id}=${token}; Path=/; HttpOnly; SameSite=Lax${maxAge}${secure}`);
  res.json({
    valid:       true,
    expires_at:  expMs,
    ttl_ms:      ttlMs,
    unlock_mode: mode,
  });
}

/** Lets a user forget a previously-unlocked group (used by the public UI's "Lock" action). */
function lock(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid group id' });
  res.setHeader('Set-Cookie', `lp_grp_${id}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}

module.exports = { list, reorder, create, update, remove, unlock, lock };
