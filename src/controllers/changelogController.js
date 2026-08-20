// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Release notes for the admin sidebar, parsed from CHANGELOG.md (admin only). */

const { CURRENT_VERSION } = require('../config/env');
const { getReleases } = require('../services/changelogService');

function getChangelog(req, res) {
  const releases = getReleases();
  res.json({
    current:  CURRENT_VERSION,
    // True when the newest documented release is the running build — false
    // means someone bumped package.json without writing the notes.
    documented: releases.length > 0 && releases[0].version === CURRENT_VERSION,
    releases,
  });
}

module.exports = { getChangelog };
