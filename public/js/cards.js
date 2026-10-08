// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: link cards and markdown documents. */

// ─── Link cards ───────────────────────────────────────────────────────────────

/**
 * Joins every searchable string on a link into a single lowercased haystack
 * — name, URL, file name, description, plus every group/section/subsection
 * name the link belongs to. The "tags" the user sees on a card are the group
 * names, so searching for a group name surfaces every link that wears that
 * badge.
 */
function buildLinkHaystack(link) {
  const parts = [
    link.name,
    link.url,
    link.file_name,
    link.description,
  ];
  for (const g of (link.groups || [])) {
    parts.push(g.name, g.section_name, g.parent_section_name);
  }
  return parts.filter(Boolean).join(' \n ').toLowerCase();
}

/**
 * Returns every active search keyword — pinned chips plus whatever the user
 * has typed into the input but not yet pressed Enter on. Lowercased and
 * deduped so the filter walks a clean list.
 */
function effectiveSearchTokens() {
  const tokens = new Set();
  for (const c of searchChips) tokens.add(c.toLowerCase());
  for (const t of parseSearchTokens(searchQuery)) tokens.add(t);
  return Array.from(tokens);
}

/** The starred shared links, in the member's order. */
function favoriteLinks() {
  const byId = new Map(links.filter(l => !isPersonal(l)).map(l => [l.id, l]));
  return favoriteIds.map(id => byId.get(id)).filter(Boolean);
}

function getFilteredLinks() {
  let filtered = activeGroup === 'fav' ? favoriteLinks()
    : activeGroup !== 'all' ? links.filter(l => linkBelongsToGroup(l, activeGroup))
    : links;

  const tokens = effectiveSearchTokens();
  if (tokens.length) {
    // AND across tokens — each chip/keyword must match at least one
    // searchable field. "two words" (quoted) matches as a single phrase.
    filtered = filtered.filter(l => {
      const hay = buildLinkHaystack(l);
      return tokens.every(t => hay.includes(t));
    });
  }
  return filtered;
}

/*
 * Icon fallback chain (shared by every link icon <img>):
 *   1. the requested icon (custom upload / cached favicon / Google live)
 *   2. on failure → the Settings "Browser Tab Icon" (siteFaviconUrl), if set
 *   3. on failure → the generic globe glyph
 * Implemented with a global error handler so the chain works without nested
 * inline onerror gymnastics.
 */
window.__lpIconLoaded = function (img) {
  const shimmer = img.parentElement && img.parentElement.querySelector('.favicon-shimmer');
  if (shimmer) shimmer.remove();
};
window.__lpIconError = function (img) {
  const shimmer = img.parentElement && img.parentElement.querySelector('.favicon-shimmer');
  if (shimmer) shimmer.remove();
  // Step down to the site favicon once, if we have one and haven't tried it.
  if (siteFaviconUrl && img.dataset.fb !== 'site' && img.getAttribute('src') !== siteFaviconUrl) {
    img.dataset.fb = 'site';
    img.src = siteFaviconUrl;
    return;
  }
  // Give up → globe glyph.
  const span = document.createElement('span');
  span.className = 'icon-fallback';
  span.innerHTML = FALLBACK_ICON_SVG;
  img.replaceWith(span);
};

/** The static fallback shown when a link has no icon URL to even attempt. */
function fallbackIconHtml() {
  if (siteFaviconUrl) {
    return `<img class="site-favicon-default" src="${escapeHtml(siteFaviconUrl)}" alt="" loading="lazy"
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

const FILE_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</svg>`;

// Document-style coloured icon for file-backed links that have no custom
// image. Helps visitors visually scan by file type (PDF, JSON, HTML, …).
const FILE_TYPE_PALETTE = {
  pdf:  { c: '#e0392b', l: 'PDF'  },
  htm:  { c: '#e76a26', l: 'HTML' }, html: { c: '#e76a26', l: 'HTML' },
  xml:  { c: '#d97706', l: 'XML'  },
  json: { c: '#10b981', l: 'JSON' },
  txt:  { c: '#64748b', l: 'TXT'  },
  md:   { c: '#64748b', l: 'MD'   },
  log:  { c: '#64748b', l: 'LOG'  },
  rtf:  { c: '#3b82f6', l: 'RTF'  },
  doc:  { c: '#2563eb', l: 'DOC'  }, docx: { c: '#2563eb', l: 'DOC'  },
  odt:  { c: '#2563eb', l: 'ODT'  },
  xls:  { c: '#16a34a', l: 'XLS'  }, xlsx: { c: '#16a34a', l: 'XLS'  },
  ods:  { c: '#16a34a', l: 'ODS'  }, csv:  { c: '#16a34a', l: 'CSV'  },
  ppt:  { c: '#ea580c', l: 'PPT'  }, pptx: { c: '#ea580c', l: 'PPT'  },
  odp:  { c: '#ea580c', l: 'ODP'  },
  zip:  { c: '#a855f7', l: 'ZIP'  }, '7z': { c: '#a855f7', l: '7Z'   },
  tar:  { c: '#a855f7', l: 'TAR'  }, gz:   { c: '#a855f7', l: 'GZ'   },
  jpg:  { c: '#db2777', l: 'JPG'  }, jpeg: { c: '#db2777', l: 'JPG'  },
  png:  { c: '#db2777', l: 'PNG'  }, gif:  { c: '#db2777', l: 'GIF'  },
  webp: { c: '#db2777', l: 'WEBP' }, svg:  { c: '#db2777', l: 'SVG'  },
};

function fileTypeIconHtml(fileName) {
  const ext  = (fileName || '').split('.').pop().toLowerCase();
  const meta = FILE_TYPE_PALETTE[ext] || { c: '#86868b', l: (ext || 'FILE').slice(0, 4).toUpperCase() };
  const fs   = meta.l.length >= 4 ? 6 : 7.5;
  return `<svg class="file-type-tile" width="100%" height="100%" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(meta.l)} file">
    <rect width="40" height="40" rx="9" ry="9" fill="${meta.c}" fill-opacity="0.14"/>
    <path d="M13 9h10.5l6.5 6.5V31a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" fill="white" stroke="${meta.c}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M23.5 9v6.5H30" fill="${meta.c}" fill-opacity="0.32" stroke="${meta.c}" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="20.5" y="27.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" font-size="${fs}" font-weight="700" fill="${meta.c}" letter-spacing="0.06em">${escapeHtml(meta.l)}</text>
  </svg>`;
}

function getLinkDisplayLabel(link) {
  if (link.file_path) return link.file_name || 'Attached file';
  return getDomainName(link.url);
}

// ─── Markdown documents ──────────────────────────────────────────────────────

/** True when this link's attached file is a markdown document. */
function isMarkdownLink(link) {
  return /\.md$/i.test(link?.file_name || link?.file_path || '');
}

/** The current theme, passed to the renderer since it carries no script. */
function currentThemeName() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Where a link points: its slug when it has one, otherwise /r/<id>. */
function linkHref(link) {
  // A personal link has no /r/ door: nothing tracks clicks on somebody's own
  // bookmarks. It goes straight to its address, or to its file through the
  // route that checks the session.
  if (isPersonal(link)) return link.file_path || link.url;
  return link.slug ? `/f/${encodeURIComponent(link.slug)}` : `/r/${link.id}`;
}

/**
 * The same address with the theme attached, for a rendered document.
 * `embed` drops the page's own card and Back link, for showing it in the
 * overlay where the modal already supplies both.
 */
function markdownHref(link, { embed = false } = {}) {
  const base = linkHref(link);
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}theme=${currentThemeName()}${embed ? '&embed=1' : ''}`;
}

/**
 * Opens a markdown document in the overlay.
 *
 * The document is framed rather than inlined: it keeps the no-script sandbox
 * the server serves it under, so a file an untrusted visitor uploaded can
 * never touch this page. The frame is pointed at about:blank on close so the
 * next open never flashes the previous document.
 */
function openMarkdownViewer(link) {
  document.getElementById('mdViewerTitle').textContent = link.name || 'Document';
  document.getElementById('mdViewerOpenTab').href = markdownHref(link);
  document.getElementById('mdViewerOverlay').classList.remove('hidden');

  swapInViewerFrame(markdownHref(link, { embed: true }));
}

/**
 * Replaces the viewer's iframe with a fresh one already pointing at `url`.
 *
 * Assigning .src to the existing frame is not reliable here. The element
 * starts on about:blank, and a navigation set while the page is still loading
 * — which is exactly when a document that opens itself does it — can be lost:
 * the frame keeps the new URL as its src and displays nothing, and only
 * another assignment later brings it back. A brand new element with its src
 * already set has no pending navigation to race with, so it simply loads.
 */
function swapInViewerFrame(url) {
  const old = document.getElementById('mdViewerFrame');
  if (!old) return;

  const frame = document.createElement('iframe');
  frame.id        = 'mdViewerFrame';
  frame.className = old.className;
  frame.title     = old.title || 'Document';
  if (url) frame.src = url;

  old.replaceWith(frame);
}

// refreshMarkdownViewerTheme() lives in core.js, beside applyTheme(), which
// calls it while the page is still loading.

/**
 * A markdown link may ask to open itself when its group is opened, so a group
 * can lead with a document rather than a grid of cards.
 *
 * Always the overlay, never a new tab: a browser blocks a tab opened without
 * a click, and taking one over because somebody changed group would be
 * hostile. Once per visit, remembered in sessionStorage — dismiss it and it
 * stays dismissed until the next visit, so returning to the group does not
 * reopen it in your face.
 */
const AUTO_OPENED_KEY = 'linkpage_autoopened';

function autoOpenedThisVisit() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(AUTO_OPENED_KEY) || '[]'));
  } catch {
    return new Set();          // private window, or someone edited it by hand
  }
}

function rememberAutoOpened(group) {
  try {
    const seen = autoOpenedThisVisit();
    seen.add(String(group));
    sessionStorage.setItem(AUTO_OPENED_KEY, JSON.stringify([...seen]));
  } catch { /* nothing to remember it with; it will simply open again */ }
}

/** Opens the group's leading document, if it has one and has not yet. */
function maybeAutoOpenGroupDoc() {
  // "All" is not a group; there is nothing to lead.
  if (activeGroup === 'all' || activeGroup == null) return;

  // Never stack one on top of a document the reader already has open.
  const overlay = document.getElementById('mdViewerOverlay');
  if (!overlay || !overlay.classList.contains('hidden')) return;

  if (autoOpenedThisVisit().has(String(activeGroup))) return;

  // `links` holds only what this visitor may see, and is already in the
  // admin's order — so the first match is the one they put first.
  const doc = links.find(l =>
    l.auto_open && isMarkdownLink(l) && (l.group_ids || []).includes(activeGroup));
  if (!doc) return;

  rememberAutoOpened(activeGroup);
  openMarkdownViewer(doc);
}

function closeMarkdownViewer() {
  document.getElementById('mdViewerOverlay').classList.add('hidden');
  // A blank replacement rather than navigating this one away, so nothing is
  // left loading behind a hidden panel and the next open starts clean.
  swapInViewerFrame(null);
}

document.getElementById('mdViewerClose')?.addEventListener('click', closeMarkdownViewer);
// The global Escape handler only hides the overlay; the viewer also has to
// drop the frame, or the document stays loaded behind a hidden panel.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const overlay = document.getElementById('mdViewerOverlay');
  if (overlay && !overlay.classList.contains('hidden')) closeMarkdownViewer();
}, true);
document.getElementById('mdViewerOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'mdViewerOverlay') closeMarkdownViewer();
});
// Opening the document in a tab means the overlay has done its job.
document.getElementById('mdViewerOpenTab')?.addEventListener('click', closeMarkdownViewer);

function buildLinkCard(link) {
  const card    = document.createElement('a');
  card.className = 'link-card';
  card.target    = '_blank';
  card.rel       = 'noopener noreferrer';
  // A custom slug is the nicer front door when the link has one; /r/<id> is
  // always there as the fallback. Both track the click the same way.
  // A markdown document carries the theme, since the rendered page has no
  // script of its own to read which one is in use.
  card.href      = isMarkdownLink(link) ? markdownHref(link) : linkHref(link);

  // In popup mode the click is intercepted and shown in the overlay instead.
  // The href stays real, so middle-click and "open in new tab" still work.
  if (isMarkdownLink(link)) {
    card.addEventListener('click', e => {
      if (markdownOpenMode !== 'modal') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;  // let the browser win
      e.preventDefault();
      openMarkdownViewer(link);
    });
  }

  // Icon source: custom upload → server-cached favicon → (nothing). We no
  // longer fall back to Google's client-side favicon service because it
  // returns a generic globe (HTTP 404 w/ image body) for unknown hosts, which
  // browsers render as a successful load and would mask the Settings-favicon
  // default. The server already tries Google when caching favicon_path.
  const iconUrl  = link.image_path
                || (link.file_path ? null : link.favicon_path);
  // Highlight using every active keyword (chips + pending input).
  const q        = effectiveSearchTokens();
  const descHtml = link.description
    ? `<p class="link-desc">${highlightText(link.description, q)}</p>` : '';
  const linkGroups = Array.isArray(link.groups) && link.groups.length
    ? link.groups
    : (link.group_name ? [{ name: link.group_name, color: link.group_color }] : []);
  const badgeHtml = linkGroups.length
    ? `<div class="link-footer">${linkGroups.map(g =>
        `<span class="group-badge" style="background:${g.color}18; color:${g.color}" title="${escapeHtml(g.name)}">${highlightText(g.name, q)}</span>`
      ).join('')}</div>`
    : '';

  const iconHtml = iconUrl
    ? buildIconHtml(iconUrl)
    : (link.file_path
        ? fileTypeIconHtml(link.file_name)
        : fallbackIconHtml());

  card.innerHTML = `
    <div class="link-icon">${iconHtml}</div>
    <div class="link-body">
      <div class="link-name">${highlightText(link.name, q)}</div>
      <div class="link-domain">${highlightText(getLinkDisplayLabel(link), q)}</div>
      ${descHtml}${badgeHtml}
    </div>
    <button type="button" class="link-copy-btn" title="Copy link" aria-label="Copy link">
      <svg class="link-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <svg class="link-copy-check" width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </button>
    <svg class="link-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>`;

  card.querySelector('.link-copy-btn').addEventListener('click', e => copyLinkFromCard(e, link));

  if (currentUser && !isPersonal(link)) addStarButton(card, link);
  if (activeGroup === 'fav' && favoriteIds.includes(link.id)) wireFavoriteDrag(card, link);
  if (isPersonal(link) && typeof activeGroup === 'string' && activeGroup.startsWith('u')) {
    wirePersonalDrag(card, link);
  }

  // Your own links, and shared links in groups you are a group admin of.
  if (isPersonal(link) || canManageLink(link)) {
    if (isPersonal(link)) card.classList.add('link-card-mine');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'link-edit-btn';
    edit.title = 'Edit this link';
    edit.setAttribute('aria-label', `Edit ${link.name}`);
    edit.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
      </svg>`;
    // The card is an <a>, so a click inside it would follow the link. Same
    // treatment as the copy button.
    edit.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openComposer(link);
    });
    card.insertBefore(edit, card.querySelector('.link-copy-btn'));
  }

  return card;
}

/**
 * The star on a shared card, for a signed-in member. Their own links already
 * have a page of their own, so they get none.
 */
function addStarButton(card, link) {
  const starred = favoriteIds.includes(link.id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `link-fav-btn${starred ? ' is-fav' : ''}`;
  btn.setAttribute('aria-pressed', String(starred));
  btn.setAttribute('aria-label', starred ? `Remove ${link.name} from favourites` : `Add ${link.name} to favourites`);
  btn.title = starred ? 'Remove from favourites' : 'Add to favourites';
  btn.innerHTML = `
    <svg class="star-outline" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.9" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.53L12 17.5l-5.87 3.07 1.12-6.53L2.5 9.41l6.56-.95z"/>
    </svg>
    <svg class="star-filled" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.53L12 17.5l-5.87 3.07 1.12-6.53L2.5 9.41l6.56-.95z"/>
    </svg>`;
  btn.addEventListener('click', e => toggleFavorite(e, link));
  card.insertBefore(btn, card.querySelector('.link-copy-btn'));
}

/**
 * Stars or unstars, at once on screen and then on the server, rolled back if
 * the server says no.
 *
 * Unstarring while looking at Favourites dims the card rather than removing it:
 * pulling it out would shift the grid under the pointer mid-click, and leaving
 * it there makes an accidental unstar one click to undo.
 */
async function toggleFavorite(e, link) {
  e.preventDefault();
  e.stopPropagation();
  // Before any await: the browser clears currentTarget once the handler yields.
  const btn  = e.currentTarget;
  const card = btn.closest('.link-card');
  const next = !favoriteIds.includes(link.id);

  const paint = starred => {
    btn.classList.toggle('is-fav', starred);
    btn.setAttribute('aria-pressed', String(starred));
    btn.title = starred ? 'Remove from favourites' : 'Add to favourites';
    btn.setAttribute('aria-label', starred ? `Remove ${link.name} from favourites` : `Add ${link.name} to favourites`);
    if (activeGroup === 'fav') card?.classList.toggle('is-unfavourited', !starred);
  };

  const before = favoriteIds;
  favoriteIds = next ? [...favoriteIds, link.id] : favoriteIds.filter(id => id !== link.id);
  paint(next);
  renderFavoritesTab();

  const res = await myRequest(`/api/my/favorites/${link.id}`, { method: next ? 'POST' : 'DELETE' });
  if (!res.ok) {
    favoriteIds = before;
    paint(!next);
    renderFavoritesTab();
    showToast(next ? 'Could not add that to favourites' : 'Could not remove that', { type: 'error' });
    return;
  }
  // The server's list is the one to keep — it is the filtered, ordered truth.
  if (Array.isArray(res.body.link_ids)) favoriteIds = res.body.link_ids;
  renderFavoritesTab();
}
