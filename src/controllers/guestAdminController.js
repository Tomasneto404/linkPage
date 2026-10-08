// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The administrator side of guest contributions.
 *
 * Three things an admin needs: a switch (off / members / anyone), a retention
 * knob (how long an idle guest's content is kept, or forever), and a list of
 * contributing guests with a way to delete per guest or all of them.
 *
 * The retention job runs in the background; this file also exposes the sweep
 * so a test can trigger it without waiting out an hour-long interval.
 */

const db = require('../models');
const { MODES } = require('../middleware/guest');
const { deletePrivateFiles } = require('../services/privateFiles');

const RETENTION_SETTING = 'guest_retention_days';
const SWEEP_EVERY_MS   = 60 * 60 * 1000;   // once an hour is enough for a day-granularity policy

function retentionDays() {
  const n = Number(db.readSetting(RETENTION_SETTING));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function settingsView() {
  return {
    mode:            db.readSetting('contribution_mode') || 'off',
    retention_days:  retentionDays(),
    guest_count:     db.listGuestsForAdmin().length,
  };
}

function getSettings(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json(settingsView());
}

/**
 * Updates mode and/or retention. Fields left out are left alone; mode has to
 * be one of the three.
 */
function setSettings(req, res) {
  const body = req.body || {};
  if (body.mode !== undefined) {
    if (!MODES.includes(body.mode)) return res.status(400).json({ error: `Mode must be one of ${MODES.join(', ')}` });
    if (body.mode === 'off') db.deleteSetting('contribution_mode');
    else                     db.writeSetting('contribution_mode', body.mode);
  }
  if (body.retention_days !== undefined) {
    const n = Number(body.retention_days);
    if (!Number.isFinite(n) || n < 0 || n > 3650) {
      return res.status(400).json({ error: 'Retention days must be a number between 0 and 3650' });
    }
    if (n === 0) db.deleteSetting(RETENTION_SETTING);
    else         db.writeSetting(RETENTION_SETTING, String(Math.round(n)));
  }
  req._auditSummary = `Changed contribution settings to ${db.readSetting('contribution_mode') || 'off'}`
                   + `, retention ${retentionDays() || 'forever'} day(s)`;
  res.json(settingsView());
}

// ─── Guest list and deletion ──────────────────────────────────────────────────

function listGuests(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ guests: db.listGuestsForAdmin() });
}

async function deleteGuest(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const guest = db.getGuestById(id);
  if (!guest) return res.status(404).json({ error: 'No such guest' });

  const files = db.deleteGuest(id);
  await deletePrivateFiles(files);
  req._auditSummary = `Removed guest #${id} and ${files.length} file(s)`;
  res.json({ ok: true });
}

async function deleteAllGuests(req, res) {
  const ids = db.listGuestsForAdmin().map(g => g.id);
  let removedFiles = 0;
  for (const id of ids) {
    const files = db.deleteGuest(id);
    removedFiles += files.length;
    await deletePrivateFiles(files);
  }
  req._auditSummary = `Removed ${ids.length} guest(s) and ${removedFiles} file(s)`;
  res.json({ ok: true, removed: ids.length });
}

// ─── Retention sweep ──────────────────────────────────────────────────────────

/**
 * Removes guests whose last contribution is older than the configured
 * retention. Called by a long-running interval and by tests.
 */
async function sweepStaleGuests(now = Date.now()) {
  const days = retentionDays();
  if (days <= 0) return { removed: 0 };
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const ids = db.guestsOlderThan(cutoff);
  let files = 0;
  for (const id of ids) {
    const removed = db.deleteGuest(id);
    files += removed.length;
    await deletePrivateFiles(removed);
  }
  if (ids.length) console.log(`[guests] retention swept ${ids.length} guest(s), ${files} file(s)`);
  return { removed: ids.length, files };
}

let sweepTimer = null;

/** Called once at startup. unref'd so the test runner is not held open. */
function startRetentionSweep() {
  if (sweepTimer) return;
  // One kick a few seconds after startup, then hourly.
  setTimeout(() => sweepStaleGuests().catch(() => {}), 10_000).unref();
  sweepTimer = setInterval(() => sweepStaleGuests().catch(() => {}), SWEEP_EVERY_MS);
  sweepTimer.unref();
}

function stopRetentionSweep() {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
}

module.exports = {
  getSettings, setSettings, listGuests, deleteGuest, deleteAllGuests,
  sweepStaleGuests, startRetentionSweep, stopRetentionSweep,
};
