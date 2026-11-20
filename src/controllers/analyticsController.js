// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Headline analytics for the admin dashboard. */

const analytics = require('../services/analyticsService');
const {csvCell}=require('../utils/csv');

function getAnalytics(req, res) {
  res.set('Cache-Control','private, no-store').json(analytics.dashboard(analytics.selection(req.query)));
}
function exportAnalytics(req,res){
  const selection=analytics.selection(req.query),rows=analytics.exportRows(selection),columns=['id','name','url','file_name','clicks','unique_ips','last_clicked'];
  const cell=value=>csvCell(typeof value==='string'&&/^\s*[=+@\-\t\r]/.test(value)?"'"+value:value);
  res.set('Cache-Control','private, no-store').type('text/csv').attachment('linkpage-analytics-'+new Date().toISOString().slice(0,10)+'.csv').send('\uFEFF'+[columns.join(','),...rows.map(row=>columns.map(key=>cell(row[key])).join(','))].join('\r\n'));
}

module.exports = { getAnalytics,exportAnalytics };
