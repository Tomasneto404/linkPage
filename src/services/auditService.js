// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Audit-entry derivation.
 *
 * Every successful admin mutation is recorded with a human-readable summary.
 * Handlers don't need to call anything — a single finish-listener (see
 * middleware/audit.js) derives the entry from the route, params, and
 * (already-parsed) body. Handlers MAY set `req._auditSummary` /
 * `req._auditAction` to override the derived text.
 *
 * NOTE: deriveAuditEntry hardcodes route paths, so it must stay in sync with
 * the route definitions under routes/.
 */

const db = require('../models');
const { getClientIp } = require('../utils/http');

function truncate(s, n = 80) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * Builds an audit entry { action, entityType, entityId, summary } from a
 * finished request, or null if this route shouldn't be audited. Runs on
 * 'finish', so req.body (JSON or multipart) is fully populated.
 */
/** Audit entries for /api/my/* — the kind of change, never its contents. */
function derivePersonalEntry(p, M, id) {
  const kinds = [
    [/^\/api\/my\/import$/,                  'my_link',    'import',  'Imported links into their page'],
    // Which shared links somebody stars says something about them, so not
    // even those — public as they are — are named.
    [/^\/api\/my\/favorites\/reorder$/,      'my_favorite', 'reorder', 'Reordered their favourites'],
    [/^\/api\/my\/favorites\/\d+$/,           'my_favorite', null,      'favourite'],
    [/^\/api\/my\/links\/reorder$/,          'my_link',    'reorder', 'Reordered their links'],
    [/^\/api\/my\/links(\/\d+)?$/,             'my_link',    null,      'link'],
    [/^\/api\/my\/groups\/reorder$/,         'my_group',   'reorder', 'Reordered their groups'],
    [/^\/api\/my\/groups\/\d+\/sections$/,    'my_section', 'create',  'Added a section to their page'],
    [/^\/api\/my\/groups(\/\d+)?$/,            'my_group',   null,      'group'],
    [/^\/api\/my\/sections\/reorder$/,       'my_section', 'reorder', 'Reordered their sections'],
    [/^\/api\/my\/sections\/\d+$/,            'my_section', null,      'section'],
  ];
  const verbFor = { POST: 'create', PUT: 'update', DELETE: 'delete' };
  const said    = { create: 'Added a personal', update: 'Changed a personal', delete: 'Removed a personal' };
  // A favourite is starred and unstarred rather than added and removed.
  const starred = { create: 'Starred a link', delete: 'Unstarred a link' };

  for (const [pattern, entityType, fixedVerb, noun] of kinds) {
    if (!pattern.test(p)) continue;
    const verb = fixedVerb || verbFor[M] || M.toLowerCase();
    const summary = fixedVerb ? noun
                  : entityType === 'my_favorite' ? (starred[verb] || 'Changed a favourite')
                  : `${said[verb] || 'Changed a personal'} ${noun}`;
    // One entity type for all of them, so the panel filters "members' own pages"
    // as one thing; the action still says which kind.
    return { action: `${entityType}.${verb}`, entityType: 'personal', entityId: id, summary };
  }
  return { action: 'my.other', entityType: 'personal', entityId: null, summary: 'Changed their personal page' };
}

function deriveAuditEntry(req) {
  const p    = req.path;
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  // /api/<thing>/<id>... — pull the first numeric path segment as entity id.
  const idMatch = p.match(/\/(\d+)(?:\/|$)/);
  const id = idMatch ? Number(idMatch[1]) : null;
  const M = req.method;

  // A member's own content. Answered here, before anything below can resolve a
  // name: the log is read by whoever administers the instance, and a member's
  // private link names and addresses are not theirs to read. What happened is
  // recorded; what it was called is not.
  if (p.startsWith('/api/my/')) return derivePersonalEntry(p, M, id);

  // Resolve a friendly entity name: prefer the request body's `name`, else
  // look it up live from the DB (the row still exists for non-delete actions).
  const lookupName = (type) => {
    if (!Number.isFinite(id)) return null;
    try {
      if (type === 'link')    return db.getLinkById(id)?.name ?? null;
      if (type === 'group')   return db.getGroupById(id)?.name ?? null;
      if (type === 'section') return db.getSectionById(id)?.name ?? null;
    } catch { /* fall through */ }
    return null;
  };
  // label + best-known name; falls back to "#id" only when no name is findable.
  const named = (label, type) => {
    const nm = name || lookupName(type);
    return nm ? `${label} "${truncate(nm)}"` : `${label} #${id ?? '?'}`;
  };

  // Links
  if (p === '/api/links' && M === 'POST')                return { action: 'link.create',  entityType: 'link',    entityId: id, summary: named('Created link', 'link') };
  if (/^\/api\/links\/\d+$/.test(p) && M === 'PUT')      return { action: 'link.update',  entityType: 'link',    entityId: id, summary: named('Updated link', 'link') };
  if (/^\/api\/links\/\d+$/.test(p) && M === 'DELETE')   return { action: 'link.delete',  entityType: 'link',    entityId: id, summary: named('Deleted link', 'link') };
  if (/^\/api\/links\/\d+\/visibility$/.test(p)) {
    const nm   = lookupName('link');
    const who  = nm ? `"${truncate(nm)}"` : `link #${id}`;
    const hid  = db.getLinkById(id)?.is_hidden;
    const verb = hid === 1 ? 'Hid' : hid === 0 ? 'Showed' : 'Toggled visibility of';
    return { action: 'link.visibility', entityType: 'link', entityId: id, summary: `${verb} ${who}` };
  }
  if (/^\/api\/links\/\d+\/file$/.test(p))               return { action: 'link.file_edit', entityType: 'link', entityId: id, summary: named('Edited file of', 'link') };
  if (p === '/api/links/reorder')                        return { action: 'link.reorder', entityType: 'link',    entityId: null, summary: 'Reordered links' };
  if (p === '/api/links/bulk-delete') {
    const n = Array.isArray(body.ids) ? body.ids.length : null;
    return { action: 'link.bulk_delete', entityType: 'link', entityId: null, summary: n ? `Bulk-deleted ${n} link${n !== 1 ? 's' : ''}` : 'Bulk-deleted links' };
  }
  if (p === '/api/links/import')                         return { action: 'link.import',  entityType: 'link',    entityId: null, summary: 'Imported links from file' };

  // Groups
  if (p === '/api/groups' && M === 'POST')               return { action: 'group.create', entityType: 'group',   entityId: id, summary: named('Created group', 'group') };
  if (/^\/api\/groups\/\d+$/.test(p) && M === 'PUT')     return { action: 'group.update', entityType: 'group',   entityId: id, summary: named('Updated group', 'group') };
  if (/^\/api\/groups\/\d+$/.test(p) && M === 'DELETE')  return { action: 'group.delete', entityType: 'group',   entityId: id, summary: named('Deleted group', 'group') };
  if (p === '/api/groups/reorder')                       return { action: 'group.reorder', entityType: 'group',  entityId: null, summary: 'Reordered groups' };

  // Sections
  if (/^\/api\/groups\/\d+\/sections$/.test(p))          return { action: 'section.create', entityType: 'section', entityId: id, summary: named('Created section', 'section') };
  if (/^\/api\/sections\/\d+$/.test(p) && M === 'PUT')   return { action: 'section.update', entityType: 'section', entityId: id, summary: named('Renamed section', 'section') };
  if (/^\/api\/sections\/\d+$/.test(p) && M === 'DELETE')return { action: 'section.delete', entityType: 'section', entityId: id, summary: named('Deleted section', 'section') };
  if (p === '/api/sections/reorder')                     return { action: 'section.reorder', entityType: 'section', entityId: null, summary: 'Reordered sections' };

  // Icons
  if (p === '/api/icons' && M === 'POST')                return { action: 'icon.create',  entityType: 'icon',    entityId: null, summary: 'Added an icon to the library' };
  if (p === '/api/icons/import')                         return { action: 'icon.import',  entityType: 'icon',    entityId: null, summary: 'Imported an icon library' };
  if (p === '/api/icons/bulk-delete') {
    const n = Array.isArray(body.ids) ? body.ids.length : null;
    return { action: 'icon.bulk_delete', entityType: 'icon', entityId: null, summary: n ? `Bulk-deleted ${n} icon${n !== 1 ? 's' : ''}` : 'Bulk-deleted icons' };
  }
  if (/^\/api\/icons\/\d+$/.test(p) && M === 'DELETE')   return { action: 'icon.delete',  entityType: 'icon',    entityId: id, summary: `Deleted icon #${id} from the library` };

  // Settings
  if (/^\/api\/settings\/logo\//.test(p))                return { action: 'settings.logo', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed a logo' : 'Updated a logo' };
  if (p === '/api/settings/brand-icon')                  return { action: 'settings.brand_icon', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the header icon' : 'Updated the header icon' };
  if (p === '/api/settings/favicon')                     return { action: 'settings.favicon', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the favicon' : 'Updated the favicon' };
  if (p === '/api/settings/site-title')                  return { action: 'settings.site_title', entityType: 'settings', entityId: null, summary: 'Updated the site title' };
  if (p === '/api/settings/pinned-group')                return { action: 'settings.pinned_group', entityType: 'settings', entityId: null, summary: 'Changed the default group' };
  if (p === '/api/settings/save-favicons')               return { action: 'settings.save_favicons', entityType: 'settings', entityId: null, summary: 'Toggled saving fetched favicons' };
  if (p === '/api/settings/footer-enabled')              return { action: 'settings.footer', entityType: 'settings', entityId: null, summary: 'Toggled the developer footer' };
  if (p === '/api/settings/group-tab-color')             return { action: 'settings.group_tab_color', entityType: 'settings', entityId: null, summary: 'Toggled group-coloured tabs' };
  if (p === '/api/settings/group-tabs-loop')             return { action: 'settings.group_tabs_loop', entityType: 'settings', entityId: null, summary: 'Toggled looping group tabs' };
  if (p === '/api/settings/public-password')             return { action: 'settings.public_password', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the public password' : 'Set the public password' };
  if (p === '/api/settings/requests-enabled')            return { action: 'settings.requests_enabled', entityType: 'settings', entityId: null, summary: 'Toggled the link-request feature' };
  if (p === '/api/settings/request-password')            return { action: 'settings.request_password', entityType: 'settings', entityId: null, summary: M === 'DELETE' ? 'Removed the request password' : 'Set the request password' };
  if (p === '/api/settings/theme')                       return { action: 'settings.theme', entityType: 'settings', entityId: null, summary: 'Updated theme & appearance' };
  if (p === '/api/settings/require-login')               return { action: 'settings.require_login', entityType: 'settings', entityId: null, summary: body.enabled ? 'Made the page members-only' : 'Opened the page to everyone' };
  if (p === '/api/settings/user-quota')                  return { action: 'settings.user_quota', entityType: 'settings', entityId: null, summary: 'Changed the storage allowance' };
  if (p === '/api/settings/oidc')                        return { action: 'settings.oidc', entityType: 'settings', entityId: null, summary: 'Changed the single sign-on settings' };
  // Any other setting: named after its route rather than left to the fallback.
  if (/^\/api\/settings\/[a-z-]+$/.test(p)) {
    const what = p.slice('/api/settings/'.length);
    return { action: `settings.${what.replace(/-/g, '_')}`, entityType: 'settings', entityId: null,
             summary: `Changed the ${what.replace(/-/g, ' ')} setting` };
  }

  // Accounts. The summaries come from the controllers, which know whose account
  // it was; these name the action. Never let one of these reach the fallback:
  // an invite or reset link carries its secret in the path.
  if (/^\/api\/users\/\d+$/.test(p) && M === 'PATCH')       return { action: 'user.update',     entityType: 'user',   entityId: id, summary: 'Changed an account' };
  if (/^\/api\/users\/\d+$/.test(p) && M === 'DELETE')      return { action: 'user.delete',     entityType: 'user',   entityId: id, summary: 'Deleted an account' };
  if (/^\/api\/users\/\d+\/password$/.test(p))              return { action: 'user.password',   entityType: 'user',   entityId: id, summary: "Set somebody's password" };
  if (/^\/api\/users\/\d+\/logout-all$/.test(p))            return { action: 'user.logout_all', entityType: 'user',   entityId: id, summary: 'Signed somebody out everywhere' };
  if (/^\/api\/users\/\d+\/identities$/.test(p))            return { action: 'user.sso_disconnect', entityType: 'user', entityId: id, summary: 'Disconnected an account from single sign-on' };
  if (/^\/api\/users\/\d+\/reset-link$/.test(p))            return { action: 'user.reset_link', entityType: 'user',   entityId: id, summary: 'Issued a password reset link' };
  if (p === '/api/invites' && M === 'POST')                   return { action: 'invite.create',   entityType: 'invite', entityId: null, summary: 'Created an invite' };
  if (/^\/api\/invites\/\d+$/.test(p) && M === 'DELETE')    return { action: 'invite.revoke',   entityType: 'invite', entityId: id, summary: 'Revoked an invite' };
  if (/^\/api\/tokens\/[^/]+\/redeem$/.test(p))              return { action: 'invite.redeem',   entityType: 'invite', entityId: null, summary: 'Used an invite or reset link' };

  // Link requests (public submit + admin review)
  if (p === '/api/link-requests' && M === 'POST')             return { action: 'request.create',  entityType: 'request', entityId: null, summary: name ? `New link request "${truncate(name)}"` : 'New link request' };
  if (/^\/api\/link-requests\/\d+\/approve$/.test(p))         return { action: 'request.approve', entityType: 'request', entityId: id, summary: `Approved link request #${id}` };
  if (/^\/api\/link-requests\/\d+\/attach$/.test(p))          return { action: 'request.approve', entityType: 'request', entityId: id, summary: `Approved link request #${id} without duplicating the link` };
  if (/^\/api\/link-requests\/\d+\/reject$/.test(p))          return { action: 'request.reject',  entityType: 'request', entityId: id, summary: `Rejected link request #${id}` };
  if (/^\/api\/link-requests\/\d+$/.test(p) && M === 'DELETE') return { action: 'request.delete',  entityType: 'request', entityId: id, summary: `Deleted link request #${id}` };

  // IP attribution tags
  if (p === '/api/ip-tags' && M === 'POST')              return { action: 'ip_tag.set',    entityType: 'ip_tag', entityId: null, summary: 'Tagged an IP address' };
  if (/^\/api\/ip-tags\//.test(p) && M === 'DELETE')     return { action: 'ip_tag.delete', entityType: 'ip_tag', entityId: null, summary: 'Removed an IP tag' };

  // Auth
  if (p === '/api/auth/rotate-token')                    return { action: 'auth.rotate_token', entityType: 'auth', entityId: null, summary: 'Rotated the admin token' };
  if (p === '/api/auth/login')                           return { action: 'auth.login',       entityType: 'auth', entityId: null, summary: 'Signed in' };
  if (p === '/api/auth/logout')                          return { action: 'auth.logout',      entityType: 'auth', entityId: null, summary: 'Signed out' };
  if (p === '/api/auth/logout-all')                      return { action: 'auth.logout_all',  entityType: 'auth', entityId: null, summary: 'Signed out everywhere' };
  if (p === '/api/auth/password')                        return { action: 'auth.password',    entityType: 'auth', entityId: null, summary: 'Changed a password' };
  if (p === '/api/auth/identities' && M === 'DELETE')    return { action: 'auth.sso_disconnect', entityType: 'auth', entityId: null, summary: 'Disconnected from single sign-on' };
  if (/^\/api\/auth\/sessions\//.test(p) && M === 'DELETE') return { action: 'auth.session_revoke', entityType: 'auth', entityId: null, summary: 'Ended a session' };

  // Audit log itself (clear/prune) — recorded so the clearing is traceable.
  if (p === '/api/audit' && M === 'DELETE')              return { action: 'audit.clear', entityType: 'audit', entityId: null, summary: 'Cleared the audit log' };

  // Anything else under /api that mutated — generic fallback.
  // Long opaque segments — tokens, mostly — are blanked out. Every route that
  // carries one has an entry above; this is for the one added later without.
  const safe = p.split('/').map(seg => (/^[A-Za-z0-9_-]{20,}$/.test(seg) ? ':secret' : seg)).join('/');
  return { action: `${M.toLowerCase()} ${safe}`, entityType: null, entityId: id, summary: `${M} ${safe}` };
}

/**
 * Who made this request, in the three fields the log stores.
 *
 * 'token' has no id, because the admin token is not an account. 'public' is an
 * unauthenticated visitor, which is what a click or a link request is.
 */
function actorFor(req) {
  if (req.user?.via === 'session') {
    return {
      actorType:   'user',
      actorUserId: req.user.id,
      actorLabel:  req.user.display_name || req.user.email || null,
    };
  }
  if (req.user?.via === 'token') {
    return { actorType: 'token', actorUserId: null, actorLabel: 'Admin token' };
  }
  return { actorType: 'public', actorUserId: null, actorLabel: null };
}

/**
 * Writes one entry immediately, rather than waiting for the response.
 *
 * The middleware only logs requests that succeeded, which is right for
 * everything that mutates — a failed edit changed nothing worth recording. A
 * failed sign-in is the exception: it changed nothing and is precisely the
 * thing a security log exists to hold.
 */
function recordAuditNow(req, { action, entityType = 'auth', entityId = null, summary }) {
  try {
    db.recordAudit({
      action, entityType, entityId, summary,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      ...actorFor(req),
    });
  } catch { /* never let audit logging break a request */ }
}

function writeAuditFromRequest(req) {
  try {
    const derived = deriveAuditEntry(req);
    if (!derived) return;
    db.recordAudit({
      action:     req._auditAction  || derived.action,
      entityType: derived.entityType,
      entityId:   derived.entityId,
      summary:    req._auditSummary || derived.summary,
      ipAddress:  getClientIp(req),
      userAgent:  req.headers['user-agent'] || null,
      ...actorFor(req),
    });
  } catch { /* never let audit logging break a request */ }
}

module.exports = { truncate, deriveAuditEntry, actorFor, recordAuditNow, writeAuditFromRequest };
