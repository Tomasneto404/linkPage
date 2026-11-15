// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Current seasonal appearance, shared by the settings API and rendered files. */
const db = require('../models');
const calendar = require('../../public/season-calendar');
function readSeasonSettings() {
  const stored = db.readSetting('season_theme');
  const manual = calendar.names.includes(stored) ? stored : 'none';
  let schedule;
  try { schedule = calendar.validate(JSON.parse(db.readSetting('season_schedule'))); }
  catch { schedule = calendar.defaults(); }
  const background = db.readSetting('season_background');
  return {
    season_theme: calendar.resolve(manual, schedule), season_manual_theme: manual, season_schedule: schedule,
    season_effects: db.readSetting('season_effects') !== '0',
    season_background: ['static', 'animated'].includes(background) ? background : 'minimal',
  };
}
module.exports = { readSeasonSettings };
