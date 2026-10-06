// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: link cards and the stats modal. */

// ─── 9. LINK CARDS ────────────────────────────────────────────────────────────

function getFilteredLinks() {
  let filtered = links;

  if      (activeGroup === 'ungrouped') filtered = filtered.filter(linkIsUngrouped);
  else if (activeGroup !== 'all') {
    filtered = filtered.filter(l => linkBelongsToGroup(l, activeGroup));
    if (activeSection !== null) {
      // Selecting a parent section also reveals its subsection contents
      // (folder-style browsing). Selecting a subsection filters to itself.
      const group   = groups.find(g => g.id === activeGroup);
      const section = (group?.sections || []).find(s => s.id === activeSection);
      const allowed = new Set([activeSection]);
      if (section) for (const sub of (section.subsections || [])) allowed.add(sub.id);
      filtered = filtered.filter(l => allowed.has(linkSectionInGroup(l, activeGroup)));
    }
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q)  ||
      (l.file_name   || '').toLowerCase().includes(q) ||
      (l.description || '').toLowerCase().includes(q)
    );
  }

  // Apply sort (anything other than 'position' is a client-side re-sort)
  switch (sortOrder) {
    case 'name-asc':  filtered = [...filtered].sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'name-desc': filtered = [...filtered].sort((a,b) => b.name.localeCompare(a.name)); break;
    case 'date-new':  filtered = [...filtered].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)); break;
    case 'date-old':  filtered = [...filtered].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)); break;
    case 'clicks':    filtered = [...filtered].sort((a,b) => (statsMap[b.id]?.total_clicks || 0) - (statsMap[a.id]?.total_clicks || 0)); break;
  }

  return filtered;
}

/*
 * Icon fallback chain: requested icon → Settings favicon (faviconUrl) → globe.
 * Mirrors the public page; uses a global error handler so the chain doesn't
 * need nested inline onerror handlers.
 */
window.__lpIconLoaded = function (img) {
  const shimmer = img.parentElement && img.parentElement.querySelector('.favicon-shimmer');
  if (shimmer) shimmer.remove();
};
window.__lpIconError = function (img) {
  const shimmer = img.parentElement && img.parentElement.querySelector('.favicon-shimmer');
  if (shimmer) shimmer.remove();
  if (faviconUrl && img.dataset.fb !== 'site' && img.getAttribute('src') !== faviconUrl) {
    img.dataset.fb = 'site';
    img.src = faviconUrl;
    return;
  }
  const span = document.createElement('span');
  span.className = 'icon-fallback';
  span.innerHTML = FALLBACK_ICON_SVG;
  img.replaceWith(span);
};

/** Static fallback when a link has no icon URL to attempt at all. */
function fallbackIconHtml() {
  if (faviconUrl) {
    return `<img class="site-favicon-default" src="${escapeHtml(faviconUrl)}" alt="" loading="lazy"
                 onerror="window.__lpIconError(this)" />`;
  }
  return `<span class="icon-fallback">${FALLBACK_ICON_SVG}</span>`;
}

function buildIconHtml(iconUrl) {
  if (!iconUrl) return fallbackIconHtml();
  return `
    <span class="favicon-shimmer"></span>
    <img src="${escapeHtml(iconUrl)}" alt="" loading="lazy"
         onload="window.__lpIconLoaded(this)"
         onerror="window.__lpIconError(this)" />`;
}

function buildLinkCard(link) {
  const wrap       = document.createElement('div');
  wrap.className   = 'link-card-wrap' + (link.is_hidden ? ' hidden-link' : '');
  wrap.dataset.linkId = link.id;

  const checkbox   = document.createElement('div');
  checkbox.className = 'card-checkbox hidden';
  wrap.appendChild(checkbox);

  const card = document.createElement('div');
  card.className = 'link-card';

  const stats    = statsMap[link.id];
  // File-backed links skip favicon lookups and use a generic file glyph (unless
  // the admin uploaded a custom icon). URL links use the server-cached favicon;
  // when none exists they fall through to the Settings-favicon default (we no
  // longer use Google's client favicon, which masks that default with a globe).
  const iconUrl  = link.image_path
                || (link.file_path ? null : link.favicon_path);
  const iconHtml = iconUrl
                ? buildIconHtml(iconUrl)
                : (link.file_path
                    ? fileTypeIconHtml(link.file_name)
                    : fallbackIconHtml());
  const q        = searchQuery; // capture for highlights

  // Tags strip: group badges + hidden / dead-link pills. Views and date now
  // live in the card footer (below), not here.
  const tagParts = [];
  const linkGroups = Array.isArray(link.groups) && link.groups.length
    ? link.groups
    : (link.group_name ? [{ name: link.group_name, color: link.group_color }] : []);
  for (const g of linkGroups) {
    tagParts.push(`<span class="group-badge" style="background:${g.color}18; color:${g.color}" title="${escapeHtml(g.name)}">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
      ${escapeHtml(g.name)}</span>`);
  }
  if (link.is_hidden) {
    tagParts.push(`<span class="hidden-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      Hidden
    </span>`);
  }
  if (link.is_broken && link.last_checked_at) {
    tagParts.push(`<span class="broken-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Dead link
    </span>`);
  }

  const metaHtml = tagParts.length ? `<div class="card-meta">${tagParts.join('')}</div>` : '';
  const descHtml = link.description ? `<p class="link-desc">${highlightText(link.description, q)}</p>` : '';

  const views    = stats ? stats.total_clicks : 0;
  const viewsTip = stats
    ? `${stats.total_clicks} click${stats.total_clicks !== 1 ? 's' : ''} · ${stats.unique_visitors} unique visitor${stats.unique_visitors !== 1 ? 's' : ''}`
    : 'No clicks yet';

  const canDrag = sortOrder === 'position' && !bulkModeActive;

  card.innerHTML = `
    <svg class="drag-handle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
      <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
      <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
    </svg>
    <div class="link-head">
      <div class="link-icon">${iconHtml}</div>
      <div class="link-headings">
        <div class="link-name">${highlightText(link.name, q)}</div>
        <a class="link-url" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${highlightText(getLinkDisplayLabel(link), q)}</a>
      </div>
    </div>
    ${descHtml}
    ${metaHtml}
    <div class="link-foot">
      <div class="link-foot-stats">
        <span class="card-stat" title="${escapeHtml(viewsTip)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          ${views}
        </span>
        <span class="card-stat" title="Created ${escapeHtml(formatDate(link.created_at))}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(link.created_at)}
        </span>
      </div>
      <div class="link-actions">
        <button class="icon-btn stats-link-btn" title="Stats">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </button>
        <button class="icon-btn edit-link-btn" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        ${isFileEditable(link) ? `
        <button class="icon-btn edit-file-btn" title="Edit file content">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6"/>
            <polyline points="8 6 2 12 8 18"/>
          </svg>
        </button>` : ''}
        <button class="icon-btn visibility-btn" title="${link.is_hidden ? 'Show on public page' : 'Hide from public page'}">
          ${link.is_hidden
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
        </button>
        <button class="icon-btn danger delete-link-btn" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;

  card.querySelector('.stats-link-btn').addEventListener('click',  () => openStatsModal(link));
  card.querySelector('.edit-link-btn').addEventListener('click',   () => openEditLinkModal(link));
  card.querySelector('.edit-file-btn')?.addEventListener('click',  () => openFileEditor(link));
  card.querySelector('.visibility-btn').addEventListener('click',  async () => {
    await setLinkVisibility(link.id, !link.is_hidden);
    showToast(link.is_hidden ? 'Link is now visible' : 'Link hidden from public page');
    await loadAllData();
  });
  card.querySelector('.delete-link-btn').addEventListener('click', () => openDeleteLinkModal(link));

  wrap.addEventListener('click', e => {
    // Long-press just triggered: swallow the synthetic click so the card
    // we just selected isn't immediately deselected by the same press.
    if (longPressJustFired) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!bulkModeActive) return;

    // Action buttons keep working normally (Edit, Stats, Delete, …).
    if (e.target.closest('.link-actions')) return;

    // Suppress the link-URL navigation so a misclicked anchor doesn't open
    // a new tab while the user is busy selecting cards.
    if (e.target.closest('.link-url')) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Shift+click = range select between the last clicked card and this one.
    if (e.shiftKey && lastClickedLinkId != null && lastClickedLinkId !== link.id) {
      e.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();   // kill native text range
      selectRangeBetween(lastClickedLinkId, link.id);
      // Don't update lastClickedLinkId — the anchor stays put so subsequent
      // shift-clicks extend from the same origin (matches Finder / Explorer).
      return;
    }

    wrap.classList.toggle('selected');
    lastClickedLinkId = wrap.classList.contains('selected') ? link.id : null;
    updateBulkBar();
  });

  setupLongPress(wrap, link.id);

  if (canDrag) enableLinkDrag(card, link.id);

  wrap.appendChild(card);
  return wrap;
}

/** Sets the content of the empty state based on the current filter context. */
function updateEmptyState() {
  const icon    = document.getElementById('emptyIcon');
  const title   = document.getElementById('emptyMsg');
  const sub     = document.getElementById('emptySubtext');
  const cta     = document.getElementById('emptyCta');

  sub.classList.remove('hidden');
  cta.classList.add('hidden');

  if (searchQuery) {
    icon.innerHTML  = EMPTY_ICONS.search;
    title.textContent = `No results for "${searchQuery}"`;
    sub.textContent   = 'Try a different search term';
  } else if (activeGroup === 'ungrouped') {
    icon.innerHTML  = EMPTY_ICONS.links;
    title.textContent = 'No ungrouped links';
    sub.textContent   = 'All links are organised in groups';
  } else if (activeGroup !== 'all') {
    icon.innerHTML  = EMPTY_ICONS.folder;
    title.textContent = 'No links in this group';
    sub.textContent   = 'Add a link and assign it to this group';
    cta.textContent   = '+ Add a link'; cta.onclick = openAddLinkModal;
    cta.classList.remove('hidden');
  } else {
    icon.innerHTML  = EMPTY_ICONS.links;
    title.textContent = 'No links yet';
    sub.textContent   = 'Add your first link to get started';
    cta.textContent   = '+ Add your first link'; cta.onclick = openAddLinkModal;
    cta.classList.remove('hidden');
  }
}

let renderTransitionTimer;

/**
 * Builds buckets of links keyed by section_id within the active group.
 * Returns an ordered list of { id, name, links } — "Ungrouped" comes first
 * if it has any links; otherwise sections appear in their saved position order.
 */
function bucketBySectionForActiveGroup(filteredLinks) {
  const group = groups.find(g => g.id === activeGroup);
  if (!group) return null;

  const buckets = new Map();
  buckets.set(null, { id: null, name: 'Ungrouped', links: [] });
  for (const s of group.sections || []) {
    buckets.set(s.id, { id: s.id, name: s.name, links: [] });
  }

  for (const link of filteredLinks) {
    const sid    = linkSectionInGroup(link, activeGroup);
    const bucket = buckets.get(sid) || buckets.get(null);
    bucket.links.push(link);
  }

  return Array.from(buckets.values()).filter(b => b.links.length > 0);
}

function appendSectionHeading(grid, label, count) {
  const heading = document.createElement('div');
  heading.className = 'section-heading';
  heading.innerHTML = `
    <span class="section-heading-text">${escapeHtml(label)}</span>
    <span class="section-heading-count">${count}</span>`;
  grid.appendChild(heading);
}

/**
 * Renders the filtered link grid.
 * Pass transition=true to do a quick fade before swapping content (e.g. group switches).
 */
function renderLinks(transition = false) {
  const grid       = document.getElementById('linksGrid');
  const emptyState = document.getElementById('emptyState');

  function appendCard(link, i) {
    const el = buildLinkCard(link);
    el.style.animationDelay = `${Math.min(i * 22, 280)}ms`;
    el.classList.add('card-animate');
    if (bulkModeActive) el.querySelector('.card-checkbox').classList.remove('hidden');
    grid.appendChild(el);
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

    // Section headings appear only when filtering by a single group with no
    // active section sub-filter (otherwise sections are either irrelevant or
    // already implied by the active filter).
    const shouldGroupBySection =
      typeof activeGroup === 'number' &&
      activeSection === null &&
      sortOrder === 'position' &&
      (groups.find(g => g.id === activeGroup)?.sections || []).length > 0;

    if (shouldGroupBySection) {
      const buckets = bucketBySectionForActiveGroup(filtered) || [];
      let i = 0;
      for (const b of buckets) {
        appendSectionHeading(grid, b.name, b.links.length);
        for (const link of b.links) appendCard(link, i++);
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
    }, 100);
  } else {
    doRender();
  }
}


// ─── 10. STATS MODAL ──────────────────────────────────────────────────────────

async function openStatsModal(link) {
  const s = statsMap[link.id];
  document.getElementById('statsLinkName').textContent = link.name;
  document.getElementById('statsLinkUrl').textContent  = getDomainName(link.url);
  document.getElementById('statTotal').textContent     = s ? s.total_clicks    : 0;
  document.getElementById('statUnique').textContent    = s ? s.unique_visitors  : 0;
  document.getElementById('statToday').textContent     = s ? s.clicks_today     : 0;
  document.getElementById('statWeek').textContent      = s ? s.clicks_this_week : 0;
  document.getElementById('statsLastSeen').textContent = (s?.last_clicked)
    ? `Last visited ${timeAgo(s.last_clicked)}` : 'No clicks recorded yet';
  document.getElementById('recentClicksContainer').innerHTML = '<div class="stats-loading">Loading…</div>';
  document.getElementById('topIpsContainer').innerHTML       = '<div class="stats-loading">Loading…</div>';
  document.getElementById('statsOverlay').classList.remove('hidden');
  const [d] = await Promise.all([fetchLinkClicks(link.id), refreshIpTagMap()]);
  renderRecentClicks(d.recentClicks); renderTopIps(d.topIps);
}

function renderRecentClicks(clicks) {
  const c = document.getElementById('recentClicksContainer');
  if (!clicks.length) { c.innerHTML = '<div class="stats-empty">No clicks recorded yet</div>'; return; }
  c.innerHTML = `<div class="click-log">${clicks.map(cl => `
    <div class="click-row">
      <span class="click-ip">${escapeHtml(cl.ip_address)}${ipTagChip(cl.ip_address)}</span>
      <span class="click-device">${escapeHtml(getDeviceType(cl.user_agent))}</span>
      <span class="click-time">${timeAgo(cl.clicked_at)}</span>
    </div>`).join('')}</div>`;
}

function renderTopIps(topIps) {
  const c = document.getElementById('topIpsContainer');
  if (!topIps.length) { c.innerHTML = '<div class="stats-empty">No data yet</div>'; return; }
  const hi = topIps[0].click_count;
  c.innerHTML = `<div class="click-log">${topIps.map(ip => `
    <div class="click-row">
      <span class="click-ip">${escapeHtml(ip.ip_address)}${ipTagChip(ip.ip_address)}</span>
      <div class="click-bar-wrap"><div class="click-bar" style="width:${Math.round(ip.click_count/hi*100)}%"></div></div>
      <span class="click-count">${ip.click_count} click${ip.click_count !== 1 ? 's' : ''}</span>
    </div>`).join('')}</div>`;
}

document.getElementById('closeStatsBtn').addEventListener('click', () =>
  document.getElementById('statsOverlay').classList.add('hidden'));

