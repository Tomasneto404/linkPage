// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Counted failures for the sign-in family, kept in the database.
 *
 * A key's window opens at its first failure and runs for the limiter's length;
 * a failure after the window has lapsed starts a new one. Times are milliseconds
 * since the epoch, so the window maths stays in one unit with no SQLite date
 * parsing in between.
 */

const { db } = require('../config/db');

function getThrottle(key) {
  return db.prepare('SELECT key, window_start, count FROM auth_throttle WHERE key = ?').get(key) || null;
}

/** Counts one failure for `key`, opening a fresh window if the last one lapsed. */
function recordThrottleFailure(key, windowMs, now = Date.now()) {
  db.prepare(`
    INSERT INTO auth_throttle (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT (key) DO UPDATE SET
      count        = CASE WHEN ? - window_start > ? THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END
  `).run(key, now, now, windowMs, now, windowMs, now);
}

function clearThrottle(key) {
  db.prepare('DELETE FROM auth_throttle WHERE key = ?').run(key);
}

/** Forgets windows that closed long ago. Called as failures arrive; it is a small table. */
function deleteStaleThrottles(olderThanMs, now = Date.now()) {
  db.prepare('DELETE FROM auth_throttle WHERE window_start < ?').run(now - olderThanMs);
}

module.exports = { getThrottle, recordThrottleFailure, clearThrottle, deleteStaleThrottles };
