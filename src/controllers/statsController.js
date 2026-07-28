/** Click statistics (admin only). */

const db = require('../models');

function getStats(req, res) {
  res.json(db.getAllStats());
}

function getLinkClicks(req, res) {
  const link = db.getLinkById(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  res.json({
    recentClicks: db.getRecentClicks(req.params.id),
    topIps:       db.getTopIps(req.params.id),
  });
}

module.exports = { getStats, getLinkClicks };
