// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Aggregated data-access API.
 *
 * Re-exports every model function under one object so consumers can keep the
 * `const db = require('../models'); db.getLinkById(...)` call style. The export
 * surface intentionally mirrors the former monolithic database.js module.
 */

const settings     = require('./settings');
const links        = require('./links');
const groups       = require('./groups');
const sections     = require('./sections');
const clicks       = require('./clicks');
const icons        = require('./icons');
const audit        = require('./audit');
const linkRequests = require('./linkRequests');
const ipTags       = require('./ipTags');
const analytics    = require('./analytics');
const users        = require('./users');
const sessions     = require('./sessions');
const userTokens   = require('./userTokens');
const personalGroups = require('./personalGroups');
const personalLinks  = require('./personalLinks');
const favorites      = require('./favorites');
const throttle       = require('./throttle');
const identities     = require('./identities');

const MODULES = {
  settings, links, groups, sections, clicks,
  icons, audit, linkRequests, ipTags, analytics,
  users, sessions, userTokens, personalGroups, personalLinks, favorites, throttle, identities,
};

/**
 * Flattens the modules into one object, refusing to let two of them export the
 * same name.
 *
 * Spreading silently lets the last module win, which is a quiet way to lose a
 * function: everything still starts, and the wrong query runs. With ten modules
 * that was a theoretical risk; the names here are close enough to each other
 * that it stops being theoretical as the set grows.
 */
function assemble() {
  const out   = {};
  const owner = new Map();

  for (const [moduleName, exports] of Object.entries(MODULES)) {
    for (const [name, value] of Object.entries(exports)) {
      if (owner.has(name)) {
        throw new Error(
          `models: "${name}" is exported by both ${owner.get(name)}.js and ${moduleName}.js`);
      }
      owner.set(name, moduleName);
      out[name] = value;
    }
  }
  return out;
}

module.exports = assemble();
