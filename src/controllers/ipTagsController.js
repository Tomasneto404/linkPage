/**
 * IP attribution: list every known IP (from clicks + requests) with its tag,
 * and create/update/delete the tag that names who is behind an IP.
 */

const db = require('../models');

/** Lists all known IPs with tag, activity count, and last-seen time. */
function list(req, res) {
  res.json({ ips: db.getKnownIps() });
}

/** Upserts the tag for an IP. Body: { ip_address, tag }. */
function upsert(req, res) {
  const ipAddress = typeof req.body.ip_address === 'string' ? req.body.ip_address.trim() : '';
  const tag       = typeof req.body.tag === 'string' ? req.body.tag.trim() : '';

  if (!ipAddress) return res.status(400).json({ error: 'ip_address is required' });
  if (!tag)       return res.status(400).json({ error: 'tag cannot be empty (use DELETE to clear)' });

  const row = db.setIpTag(ipAddress, tag);
  req._auditSummary = `Tagged IP ${ipAddress} as "${tag}"`;
  res.json(row);
}

/** Removes the tag for an IP. */
function remove(req, res) {
  const ipAddress = typeof req.params.ip === 'string' ? req.params.ip : '';
  if (!ipAddress) return res.status(400).json({ error: 'Invalid IP' });

  const changes = db.deleteIpTag(ipAddress);
  if (!changes) return res.status(404).json({ error: 'No tag for that IP' });

  req._auditSummary = `Removed tag from IP ${ipAddress}`;
  res.status(204).end();
}

module.exports = { list, upsert, remove };
