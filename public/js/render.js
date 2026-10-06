// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: the empty state, rendering the grid, and search. */

// ─── Empty state ──────────────────────────────────────────────────────────────

const EMPTY_ICONS = {
  links:  `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  search: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8.5" y1="8.5" x2="13.5" y2="13.5" stroke-width="1.8"/><line x1="13.5" y1="8.5" x2="8.5" y2="13.5" stroke-width="1.8"/></svg>`,
  folder: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};

function updateEmptyState() {
  const tokens = effectiveSearchTokens();
  document.getElementById('emptyIcon').innerHTML =
    tokens.length ? EMPTY_ICONS.search : (activeGroup !== 'all' ? EMPTY_ICONS.folder : EMPTY_ICONS.links);

  const sub = document.getElementById('emptySubtext');
  if (tokens.length) {
    document.getElementById('emptyMsg').textContent =
      `No results for ${tokens.map(t => `"${t}"`).join(' · ')}`;
    sub.textContent = 'Try removing a keyword or refining your search';
    sub.classList.remove('hidden');
  } else if (activeGroup === 'fav') {
    document.getElementById('emptyMsg').textContent = 'Nothing starred yet';
    sub.textContent = 'Star a link with ☆ on its card and it gathers here.';
    sub.classList.remove('hidden');
  } else if (activeGroup !== 'all') {
    document.getElementById('emptyMsg').textContent = 'No links in this group';
    sub.classList.add('hidden');
  } else {
    document.getElementById('emptyMsg').textContent = 'No links here yet';
    sub.classList.add('hidden');
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

let renderTransitionTimer;

/**
 * Buckets filtered links into a flat, render-ready sequence of section/sub
 * headings + their cards, in the order the public page should display them:
 *
 *   [ungrouped] → [Section A, A's own links, A.sub1, A.sub1's links, …]
 *
 * Returns an array of { kind: 'heading'|'links', … } entries the renderer
 * can iterate without knowing about the section tree.
 */
function bucketBySectionForActiveGroup(filteredLinks) {
  const group = groups.find(g => g.id === activeGroup);
  if (!group) return null;

  // Map every section id (top-level + sub) to its empty bucket up front so
  // we never miss an id later.
  const linksBySection = new Map();
  linksBySection.set(null, []);
  for (const s of group.sections || []) {
    linksBySection.set(s.id, []);
    for (const sub of (s.subsections || [])) linksBySection.set(sub.id, []);
  }
  for (const link of filteredLinks) {
    const sid = linkSectionInGroup(link, activeGroup);
    (linksBySection.get(sid) || linksBySection.get(null)).push(link);
  }

  const out = [];
  // 1) Links not assigned to any section show up first under an "Ungrouped"
  //    header (only if any exist).
  const orphans = linksBySection.get(null) || [];
  if (orphans.length) {
    out.push({ kind: 'heading', label: 'Ungrouped', count: orphans.length, level: 0 });
    out.push({ kind: 'links',   items: orphans });
  }
  // 2) Then each section, optionally followed by its subsections.
  for (const s of group.sections || []) {
    const own  = linksBySection.get(s.id) || [];
    const subs = (s.subsections || []).map(sub => ({
      sub,
      links: linksBySection.get(sub.id) || [],
    }));
    const total = own.length + subs.reduce((n, x) => n + x.links.length, 0);
    if (total === 0) continue;
    out.push({ kind: 'heading', label: s.name, count: total, level: 0 });
    if (own.length) out.push({ kind: 'links', items: own });
    for (const { sub, links } of subs) {
      if (!links.length) continue;
      out.push({ kind: 'heading', label: sub.name, count: links.length, level: 1 });
      out.push({ kind: 'links', items: links });
    }
  }
  return out;
}

function appendSectionHeading(grid, label, count, level = 0) {
  const heading = document.createElement('div');
  heading.className = 'section-heading' + (level > 0 ? ' subsection-heading' : '');
  heading.innerHTML = `
    <span class="section-heading-text">${escapeHtml(label)}</span>
    <span class="section-heading-count">${count}</span>`;
  grid.appendChild(heading);
}

function renderLinks(transition = false) {
  const grid       = document.getElementById('linksGrid');
  const emptyState = document.getElementById('emptyState');

  function appendCard(link, i) {
    const card = buildLinkCard(link);
    card.style.animationDelay = `${Math.min(i * 22, 280)}ms`;
    card.classList.add('card-animate');
    grid.appendChild(card);
  }

  function doRender() {
    const filtered = getFilteredLinks();
    grid.innerHTML = '';

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      updateEmptyState();
      return;
    }
    emptyState.classList.add('hidden');

    const shouldGroupBySection =
      activeGroup !== 'all' &&
      (groups.find(g => g.id === activeGroup)?.sections || []).length > 0;

    if (shouldGroupBySection) {
      const entries = bucketBySectionForActiveGroup(filtered) || [];
      let i = 0;
      for (const entry of entries) {
        if (entry.kind === 'heading') {
          appendSectionHeading(grid, entry.label, entry.count, entry.level || 0);
        } else if (entry.kind === 'links') {
          for (const link of entry.items) appendCard(link, i++);
        }
      }
    } else {
      filtered.forEach(appendCard);
    }
  }

  if (transition) {
    grid.style.opacity       = '0';
    emptyState.style.opacity = '0';
    clearTimeout(renderTransitionTimer);
    renderTransitionTimer = setTimeout(() => {
      doRender();
      grid.style.opacity       = '';
      emptyState.style.opacity = '';
      maybeAutoOpenGroupDoc();
    }, 100);
  } else {
    doRender();
    maybeAutoOpenGroupDoc();
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Renders the pinned-keyword chips. Each chip has an "×" that removes only
 * that chip; the rest stay. The placeholder on the input also updates to
 * give a hint based on whether anything is pinned.
 */
function renderSearchChips() {
  const wrap = document.getElementById('searchChips');
  if (!wrap) return;
  wrap.innerHTML = searchChips.map((chip, i) => `
    <span class="search-chip" data-idx="${i}">
      <span class="search-chip-text" title="${escapeHtml(chip)}">${escapeHtml(chip)}</span>
      <button type="button" class="search-chip-remove" data-idx="${i}"
              aria-label="Remove filter ${escapeHtml(chip)}" title="Remove">×</button>
    </span>
  `).join('');
  const input = document.getElementById('searchInput');
  if (input) {
    input.placeholder = searchChips.length
      ? 'Add another keyword…'
      : 'Search links, groups, sections…';
  }
}

function commitSearchChip() {
  const input = document.getElementById('searchInput');
  const raw   = input.value.trim();
  if (!raw) return;
  // Multiple chips at once if the user typed several space-separated words
  // before pressing Enter. Quoted phrases stay together.
  for (const t of parseSearchTokens(raw)) {
    if (!searchChips.some(c => c.toLowerCase() === t)) searchChips.push(t);
  }
  input.value = '';
  searchQuery = '';
  renderSearchChips();
  renderLinks();
}

function removeSearchChip(idx) {
  if (idx < 0 || idx >= searchChips.length) return;
  searchChips.splice(idx, 1);
  renderSearchChips();
  renderLinks();
}

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  renderLinks();
});

// The pill is taller than the input inside it, so tapping its padding (easy to
// do on a phone) would otherwise hit nothing. Chips keep their own handlers.
document.getElementById('searchWrap').addEventListener('mousedown', e => {
  if (e.target.closest('.search-chip')) return;
  if (e.target.id !== 'searchInput') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
});

document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitSearchChip();
  } else if (e.key === 'Backspace' && e.target.value === '' && searchChips.length > 0) {
    // Backspace on an empty input nibbles off the last chip — same trick
    // every "tags input" uses (browser address bar suggestions, Gmail filter
    // chips, etc.).
    removeSearchChip(searchChips.length - 1);
  }
});

// Click on a chip's × removes that one specifically. Wrapper-level listener
// so we don't have to re-bind on every render.
document.getElementById('searchChips').addEventListener('click', e => {
  const btn = e.target.closest('.search-chip-remove');
  if (!btn) return;
  removeSearchChip(Number(btn.dataset.idx));
});

// Clicking anywhere on the wrap (but not on a chip) focuses the input — the
// chips visually hijack the input's old click target, so help the user out.
document.getElementById('searchWrap').addEventListener('click', e => {
  if (e.target.closest('.search-chip')) return;
  document.getElementById('searchInput').focus();
});
