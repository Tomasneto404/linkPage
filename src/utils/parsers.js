/** Request-body parsers for group memberships and group passwords. */

/**
 * Parses the group membership payload, preferring the richer `groups` shape
 * (with per-group section_id) and falling back to legacy `group_ids`.
 *
 * Returns:
 *   undefined → request didn't include any group field (leave untouched)
 *   []        → request explicitly cleared all memberships
 *   array of { group_id: number, section_id: number|null }
 */
function parseGroupAssignments(body) {
  if (body.groups !== undefined) {
    let raw = body.groups;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed === 'null') return [];
      try { raw = JSON.parse(trimmed); }
      catch { return []; }
    }
    if (!Array.isArray(raw)) return [];

    const out  = [];
    const seen = new Set();
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const gid = Number(entry.id ?? entry.group_id);
      if (!Number.isFinite(gid) || gid <= 0 || seen.has(gid)) continue;
      seen.add(gid);
      let sid = entry.section_id;
      sid = (sid === null || sid === undefined) ? null : Number(sid);
      if (sid !== null && (!Number.isFinite(sid) || sid <= 0)) sid = null;
      out.push({ group_id: gid, section_id: sid });
    }
    return out;
  }

  // Legacy plain-IDs shape — no section info.
  const legacy = parseGroupIds(body);
  if (legacy === undefined) return undefined;
  return legacy.map(id => ({ group_id: id, section_id: null }));
}

/**
 * Parses a list of group IDs from a request body, accepting any of:
 *  - body.group_ids as a JSON-encoded array (sent via FormData)
 *  - body.group_ids as a real array (sent via JSON)
 *  - body.group_id as a single value (legacy single-group payload)
 *
 * Returns an array of positive integers, or undefined if the request didn't
 * include any group field at all (so updateLink leaves memberships untouched).
 */
function parseGroupIds(body) {
  let raw = body.group_ids;

  if (raw === undefined && body.group_id !== undefined) {
    raw = body.group_id;
  }
  if (raw === undefined) return undefined;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === 'null') return [];
    if (trimmed.startsWith('[')) {
      try { raw = JSON.parse(trimmed); }
      catch { return []; }
    } else {
      raw = [trimmed];
    }
  }

  if (!Array.isArray(raw)) raw = [raw];

  const seen = new Set();
  const out  = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Reads `password` from a group request body and normalises it into one of:
 *   undefined  → don't touch the password on update
 *   null       → clear the password (group becomes public)
 *   '<string>' → set this password
 */
function normaliseGroupPassword(body) {
  if (!('password' in body)) return undefined;
  const raw = body.password;
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

module.exports = { parseGroupAssignments, parseGroupIds, normaliseGroupPassword };
