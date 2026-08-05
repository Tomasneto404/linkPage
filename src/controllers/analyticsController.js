// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Headline analytics for the admin dashboard. */

const db = require('../models');

function getAnalytics(req, res) {
  const period = db.normalizeAnalyticsPeriod(req.query.period);
  res.json({
    period,
    totals:    db.getClickTotals(period),
    top_links: db.getTopLinks(period, 3),
    top_users: db.getTopUsers(period, 3),
    trend:     db.getClickTrend(30),
  });
}

module.exports = { getAnalytics };
