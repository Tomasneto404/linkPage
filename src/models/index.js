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

module.exports = {
  ...settings,
  ...links,
  ...groups,
  ...sections,
  ...clicks,
  ...icons,
  ...audit,
  ...linkRequests,
  ...ipTags,
};
