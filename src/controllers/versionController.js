// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Update-availability check against GitHub Releases (admin only). */

const { buildVersionPayload } = require('../services/versionService');

async function getVersion(req, res) {
  const force = req.query.refresh === '1';
  res.json(await buildVersionPayload({ forceRefresh: force }));
}

module.exports = { getVersion };
