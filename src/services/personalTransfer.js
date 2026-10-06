// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Exporting a member's own page to a file, and importing one back.
 *
 * The file carries structure and addresses: groups with their colours and
 * sections, links with where they are filed, and favourites by address. It
 * does not carry files. An attachment or an uploaded icon is private bytes on
 * this server, and a JSON file passed around is the wrong place for them; an
 * attachment-only link is listed so the export is honest about what it holds,
 * and skipped on import.
 *
 * Importing merges rather than replaces. Groups and sections are matched by
 * name, links by address, so importing the same file twice adds nothing the
 * second time. Everything is written through the owner-scoped models, so an
 * import can only ever touch the importer's own page.
 */

const db = require('../models');
const { isValidHttpUrl, isValidHexColor, normalizeUrlForCompare } = require('../utils/http');
const { MAX_USER_LINKS, MAX_USER_GROUPS, MAX_USER_SECTIONS } = require('../config/constants');
const { cachePersonalFavicons } = require('./personalStorage');
const { visibleSharedLinks } = require('./linkService');

const KIND = 'linkpage-personal';
const VERSION = 1;
const DEFAULT_COLOR = '#0071e3';

const fold = s => String(s ?? '').trim().toLowerCase();
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// ─── Export ───────────────────────────────────────────────────────────────────

function buildExport(req) {
  const me = req.user.id;
  const groups = db.getPersonalGroups(me);
  const links  = db.getPersonalLinks(me);

  // Section id → { name, parent name }, for writing each filing as names.
  const sectionNames = new Map();
  for (const g of groups) {
    for (const s of g.sections) {
      sectionNames.set(s.id, { section: s.name, subsection: null });
      for (const sub of s.subsections) sectionNames.set(sub.id, { section: s.name, subsection: sub.name });
    }
  }

  const shared = new Map(visibleSharedLinks(req).map(l => [l.id, l]));
  const favorites = db.getFavoriteIds(me).map(id => shared.get(id)).filter(Boolean);

  return {
    kind:        KIND,
    version:     VERSION,
    exported_at: new Date().toISOString(),
    groups: groups.map(g => ({
      name:  g.name,
      color: g.color,
      sections: g.sections.map(s => ({
        name: s.name,
        subsections: s.subsections.map(sub => ({ name: sub.name })),
      })),
    })),
    links: links.map(l => ({
      name:        l.name,
      url:         l.url || null,
      description: l.description || null,
      // A library icon is a public path every instance with that library has;
      // an uploaded one is private and stays here.
      icon:        l.image_path && l.image_path.startsWith('/uploads/') ? l.image_path : null,
      file_name:   l.file_name || null,
      groups: l.groups.map(m => {
        const where = m.section_id ? sectionNames.get(m.section_id) : null;
        return { name: m.name, section: where?.section ?? null, subsection: where?.subsection ?? null };
      }),
    })),
    favorites: favorites.map(l => ({ name: l.name, url: l.url })),
  };
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Merges an exported file into this person's page. Returns counts and a list
 * of problems, one per item that was not imported for a reason worth saying.
 */
function importInto(req, payload) {
  const me = req.user.id;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.links)) {
    return { error: 'This is not a LinkPage export: it has no list of links' };
  }
  if (payload.kind !== undefined && payload.kind !== KIND) {
    return { error: 'This file is an export of a whole LinkPage, not of one person\'s links' };
  }

  const result = {
    groups_created: 0, sections_created: 0,
    links_imported: 0, links_skipped: 0, favorites_added: 0,
    problems: [],
  };

  // ── Groups and sections, matched by name ──
  const groupsByName = new Map();
  const sectionKey = (gid, parentId, name) => `${gid}:${parentId ?? ''}:${fold(name)}`;
  const sections = new Map();

  const loadExisting = () => {
    for (const g of db.getPersonalGroups(me)) {
      groupsByName.set(fold(g.name), g.id);
      for (const s of g.sections) {
        sections.set(sectionKey(g.id, null, s.name), s.id);
        for (const sub of s.subsections) sections.set(sectionKey(g.id, s.id, sub.name), sub.id);
      }
    }
  };
  loadExisting();

  const ensureGroup = (name, color) => {
    const clean = text(name, 100);
    if (!clean) return null;
    const found = groupsByName.get(fold(clean));
    if (found) return found;
    if (db.countPersonalGroups(me) >= MAX_USER_GROUPS) {
      result.problems.push(`Group "${clean}" was not created: you have the most groups allowed`);
      groupsByName.set(fold(clean), null);
      return null;
    }
    const g = db.createPersonalGroup(me, { name: clean, color: isValidHexColor(color) ? color : DEFAULT_COLOR });
    groupsByName.set(fold(clean), g.id);
    result.groups_created++;
    return g.id;
  };

  const ensureSection = (gid, name, parentId = null) => {
    const clean = text(name, 100);
    if (!gid || !clean) return null;
    const key = sectionKey(gid, parentId, clean);
    if (sections.has(key)) return sections.get(key);
    if (db.countPersonalSections(me) >= MAX_USER_SECTIONS) {
      sections.set(key, null);
      return null;
    }
    const s = db.createPersonalSection(me, gid, { name: clean, parentSectionId: parentId });
    const id = s?.id ?? null;
    sections.set(key, id);
    if (id) result.sections_created++;
    return id;
  };

  for (const g of Array.isArray(payload.groups) ? payload.groups.slice(0, 500) : []) {
    const gid = ensureGroup(g?.name, g?.color);
    for (const s of Array.isArray(g?.sections) ? g.sections : []) {
      const sid = ensureSection(gid, s?.name);
      for (const sub of Array.isArray(s?.subsections) ? s.subsections : []) ensureSection(gid, sub?.name, sid);
    }
  }

  // ── Links, de-duplicated by address ──
  const known = new Set(db.getPersonalLinks(me).filter(l => l.url).map(l => normalizeUrlForCompare(l.url)));
  const libraryIcons = new Set(db.getAllIcons().map(i => i.file_path));
  const toFetch = [];

  for (const [index, item] of payload.links.slice(0, MAX_USER_LINKS).entries()) {
    const label = `Link ${index + 1}`;
    const name = text(item?.name, 200);
    const url  = text(item?.url, 2048);

    if (!name) { result.problems.push(`${label}: it has no name`); result.links_skipped++; continue; }
    if (!url) {
      result.links_skipped++;
      result.problems.push(item?.file_name
        ? `"${name}": its file is not in the export, only the link to it`
        : `"${name}": it has no web address`);
      continue;
    }
    if (!isValidHttpUrl(url)) { result.problems.push(`"${name}": the address is not valid`); result.links_skipped++; continue; }

    const key = normalizeUrlForCompare(url);
    if (known.has(key)) { result.links_skipped++; continue; }   // already there: not a problem
    if (db.countPersonalLinks(me) >= MAX_USER_LINKS) {
      result.problems.push(`"${name}" and any after it: you have the most links allowed`);
      result.links_skipped += payload.links.length - index;
      break;
    }

    const icon = typeof item.icon === 'string' && libraryIcons.has(item.icon) ? item.icon : null;
    const id = db.createPersonalLink(me, {
      name, url, description: text(item.description, 1000) || null, imagePath: icon,
    });
    known.add(key);
    result.links_imported++;

    const assignments = [];
    for (const m of Array.isArray(item.groups) ? item.groups : []) {
      const gid = ensureGroup(m?.name);
      if (!gid) continue;
      let sid = m.section ? ensureSection(gid, m.section) : null;
      if (sid && m.subsection) sid = ensureSection(gid, m.subsection, sid) ?? sid;
      assignments.push({ group_id: gid, section_id: sid });
    }
    if (assignments.length) db.setPersonalLinkGroups(me, id, assignments);
    if (!icon) toFetch.push({ linkId: id, url });
  }

  // ── Favourites, by the address of a shared link this person can see ──
  const shared = new Map();
  for (const l of visibleSharedLinks(req)) if (l.url) shared.set(normalizeUrlForCompare(l.url), l.id);
  const starred = new Set(db.getFavoriteIds(me));
  for (const f of Array.isArray(payload.favorites) ? payload.favorites.slice(0, 5000) : []) {
    const id = typeof f?.url === 'string' ? shared.get(normalizeUrlForCompare(f.url)) : undefined;
    if (!id || starred.has(id)) continue;
    db.addFavorite(me, id);
    starred.add(id);
    result.favorites_added++;
  }

  // Icons nobody chose, fetched one at a time after the answer has gone.
  if (toFetch.length) cachePersonalFavicons(me, toFetch);

  result.problems = result.problems.slice(0, 50);
  return result;
}

module.exports = { buildExport, importInto, KIND, VERSION };
