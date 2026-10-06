// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: shared helpers, state and data loading. */

// ─── 5. HELPERS ──────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const e = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return String(text ?? '').replace(/[&<>"']/g, c => e[c]);
}

/**
 * Escapes text and wraps matches of `query` in <mark class="hl"> for highlighting.
 * Safe: text is escaped before matching, so the query can't inject HTML.
 */
function highlightText(rawText, query) {
  const text = escapeHtml(rawText ?? '');
  if (!query) return text;
  const safeQ = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark class="hl">$1</mark>');
}

function getFaviconUrl(siteUrl) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(siteUrl).hostname}&sz=64`; }
  catch { return null; }
}

function getDomainName(siteUrl) {
  try { return new URL(siteUrl).hostname.replace(/^www\./, ''); }
  catch { return siteUrl; }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const GROUP_COLORS = [
  '#0071e3','#5856d6','#af52de','#ff2d55','#ff3b30',
  '#ff9500','#34c759','#00c7be','#007aff','#8e8e93',
];

function timeAgo(iso) {
  if (!iso) return 'Never';
  const s = Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 1000);
  if (s < 60)        return 'Just now';
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800)    return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDeviceType(ua) {
  if (!ua) return 'Unknown';
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'Mobile' : 'Desktop';
}

const FALLBACK_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
</svg>`;

const FILE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</svg>`;

/**
 * Document-style icon coloured by file extension. Used as the default for
 * file-backed link cards when the admin hasn't set a custom icon — saves them
 * from looking like a generic grey square and helps visually scan by type.
 *
 * Returns ready-to-inject SVG markup. The SVG ships its own background so the
 * surrounding .link-icon tile shows the type colour at a glance.
 */
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
  // Long labels (WEBP, JSON, HTML) get a smaller font so they still fit.
  const fs   = meta.l.length >= 4 ? 6 : 7.5;
  return `<svg class="file-type-tile" width="100%" height="100%" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(meta.l)} file">
    <rect width="40" height="40" rx="9" ry="9" fill="${meta.c}" fill-opacity="0.14"/>
    <path d="M13 9h10.5l6.5 6.5V31a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" fill="white" stroke="${meta.c}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M23.5 9v6.5H30" fill="${meta.c}" fill-opacity="0.32" stroke="${meta.c}" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="20.5" y="27.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" font-size="${fs}" font-weight="700" fill="${meta.c}" letter-spacing="0.06em">${escapeHtml(meta.l)}</text>
  </svg>`;
}

/**
 * The text shown under a link's name. For URL-backed links, the domain.
 * For file-backed links, the original filename.
 */
function getLinkDisplayLabel(link) {
  if (link.file_path) return link.file_name || 'Attached file';
  return getDomainName(link.url);
}

function showFormError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; el.classList.remove('hidden');
}
function hideFormError(id) { document.getElementById(id).classList.add('hidden'); }

/** Shows a temporary toast notification that auto-dismisses. */
function showToast(message, type = 'success', duration = 3000) {
  const icons = {
    success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    info:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;

  const dismiss = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', dismiss);
  document.getElementById('toastContainer').appendChild(toast);
  setTimeout(dismiss, duration);
}

/** Shows a custom confirm dialog. Returns a Promise that resolves to true/false. */
/**
 * Modal confirm. Resolves true (confirm), false (cancel), or — when `altText`
 * is given — the string 'alt' for the extra third choice.
 * Listeners are removed on close so a stale one can never resolve a later call.
 */
function showConfirm({ title = 'Confirm', message = '', confirmText = 'Confirm', danger = true, altText = null } = {}) {
  return new Promise(resolve => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').textContent  = message;
    const okBtn     = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const altBtn    = document.getElementById('confirmAltBtn');
    okBtn.textContent = confirmText;
    // With a third choice the recommended action is the primary one, so the
    // destructive option steps back to an outline instead of solid red.
    okBtn.className = danger
      ? `btn ${altText ? 'btn-ghost-danger' : 'btn-danger'}`
      : 'btn btn-primary';
    altBtn.classList.toggle('hidden', !altText);
    // Three choices stack full-width; two keep the usual right-aligned row.
    document.getElementById('confirmActions').classList.toggle('has-alt', !!altText);
    if (altText) altBtn.textContent = altText;
    document.getElementById('confirmOverlay').classList.remove('hidden');

    const onOk     = () => done(true);
    const onCancel = () => done(false);
    const onAlt    = () => done('alt');

    function done(result) {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      altBtn.removeEventListener('click', onAlt);
      document.getElementById('confirmOverlay').classList.add('hidden');
      resolve(result);
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    altBtn.addEventListener('click', onAlt);
  });
}

/** Empty state SVG icons */
const EMPTY_ICONS = {
  links:  `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  search: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8.5" y1="8.5" x2="13.5" y2="13.5" stroke-width="1.8"/><line x1="13.5" y1="8.5" x2="8.5" y2="13.5" stroke-width="1.8"/></svg>`,
  folder: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};


// ─── 6. STATE ─────────────────────────────────────────────────────────────────

let links         = [];
let groups        = [];
let activeGroup   = 'all';
let activeSection = null;   // number = section ID filter; null = no section filter
let searchQuery   = '';
let statsMap      = {};
let sortOrder     = 'position'; // 'position'|'name-asc'|'name-desc'|'date-new'|'date-old'|'clicks'

// Inline section UI state (sidebar)
let addingSectionToGroupId   = null; // group ID currently in "add section" mode (top-level)
let addingSubsectionToParent = null; // top-level section ID in "add subsection" mode
let editingSectionId         = null; // section ID currently being renamed inline

// Groups whose section/subsection tree is collapsed in the sidebar. Persisted
// per-browser so the admin's layout survives refreshes.
const COLLAPSED_GROUPS_KEY = 'linkpage_collapsed_groups';
let collapsedGroups = new Set(
  (() => { try { return JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY)) || []; } catch { return []; } })()
);
function saveCollapsedGroups() {
  try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups])); } catch {}
}


// ─── 7. DATA LOADING ──────────────────────────────────────────────────────────

async function loadAllData() {
  const [fl, fg, fs] = await Promise.all([fetchLinks(), fetchGroups(), fetchAllStats()]);
  links  = fl;
  groups = fg;
  statsMap = {};
  fs.forEach(s => { statsMap[s.link_id] = s; });
  renderSidebar();
  renderLinks();
  refreshBulkGroupDropdown();
}

