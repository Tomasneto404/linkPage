// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Settings key/value store. */

const { db } = require('../config/db');

/** Returns the stored value for a key, or null if it doesn't exist. */
function readSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/** Saves a value for a key, inserting or overwriting as needed. */
function writeSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

/** Removes a settings key entirely. */
function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

module.exports = { readSetting, writeSetting, deleteSetting };
