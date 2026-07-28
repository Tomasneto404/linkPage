/** Update-availability check against GitHub Releases (admin only). */

const { buildVersionPayload } = require('../services/versionService');

async function getVersion(req, res) {
  const force = req.query.refresh === '1';
  res.json(await buildVersionPayload({ forceRefresh: force }));
}

module.exports = { getVersion };
