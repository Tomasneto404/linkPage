/**
 * Admin page — link and group management with token authentication.
 *
 *  1.  THEME          — light/dark switching
 *  2.  AUTHENTICATION — token gate logic
 *  3.  SERVER CALLS   — all fetch wrappers
 *  4.  SETTINGS       — logos, site title, public password, token rotation
 *  5.  HELPERS        — shared utility functions
 *  6.  STATE          — global data variables
 *  7.  DATA LOADING   — fetching from the API
 *  8.  SIDEBAR        — rendering and group nav + drag-to-reorder
 *  9.  LINK CARDS     — building and rendering the grid
 *  10. STATS MODAL    — click analytics
 *  11. LINK MODAL     — add/edit link form
 *  12. DELETE LINK    — confirmation flow
 *  13. GROUP MODAL    — add/edit group form
 *  14. DELETE GROUP   — confirmation flow
 *  15. BULK ACTIONS   — multi-select, bulk delete, bulk move
 *  16. DRAG TO REORDER
 *  17. IMPORT/EXPORT
 *  18. SIDEBAR TOGGLE
 *  19. NAV & SEARCH
 *  20. MODAL CLOSE
 *  21. STARTUP
 */

let logoLightUrl = null;
let logoDarkUrl  = null;
let faviconUrl   = null;


// ─── 1. THEME ─────────────────────────────────────────────────────────────────

function getInitialTheme() {
  const saved = localStorage.getItem('linkpage_theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('iconMoon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('iconSun').classList.toggle('hidden', theme === 'light');
  updateHeaderLogo();
  if (save) localStorage.setItem('linkpage_theme', theme);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

applyTheme(getInitialTheme(), false);


// ─── 2. AUTHENTICATION ────────────────────────────────────────────────────────

const TOKEN_KEY = 'linkpage_admin_token';

function getAdminToken()       { return localStorage.getItem(TOKEN_KEY) || ''; }
function saveAdminToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function clearAdminToken()     { localStorage.removeItem(TOKEN_KEY); }

async function verifyToken(token) {
  const r = await fetch('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return (await r.json()).valid === true;
}

async function showAdminUI() {
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('adminWrap').classList.remove('hidden');
  await loadSettings();
  await loadAllData();
  // Fire-and-forget: a missing/slow GitHub response shouldn't block the UI.
  checkForUpdates().catch(() => {});
}

async function checkStoredToken() {
  const t = getAdminToken();
  if (t && await verifyToken(t)) await showAdminUI();
}

document.getElementById('gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const token   = document.getElementById('tokenInput').value.trim();
  const btn     = document.getElementById('gateSubmitBtn');
  const errBox  = document.getElementById('gateError');

  errBox.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Verifying…';

  try {
    if (await verifyToken(token)) {
      saveAdminToken(token);
      await showAdminUI();
    } else {
      errBox.classList.remove('hidden');
      document.getElementById('tokenInput').focus();
    }
  } catch {
    errBox.textContent = 'Could not reach the server. Is it running?';
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Unlock Admin';
  }
});

document.getElementById('toggleVisibilityBtn').addEventListener('click', () => {
  const input = document.getElementById('tokenInput');
  input.type  = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  clearAdminToken(); location.reload();
});


// ─── 3. SERVER CALLS ─────────────────────────────────────────────────────────

async function sendAuthRequest(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { ...opts.headers, 'X-Admin-Token': getAdminToken() },
  });
  if (r.status === 401) { clearAdminToken(); location.reload(); }
  return r;
}

const apiJson = (url, opts) => sendAuthRequest(url, opts).then(r => r.json());

async function fetchLinks()            { return apiJson('/api/links'); }
async function fetchGroups()           { return apiJson('/api/groups'); }
async function fetchSettings()         { return fetch('/api/settings').then(r => r.json()); }
async function fetchAllStats()         { return apiJson('/api/stats'); }
async function fetchLinkClicks(id)     { return apiJson(`/api/links/${id}/clicks`); }

async function createLink(fd)          { return apiJson('/api/links',        { method: 'POST', body: fd }); }
async function updateLink(id, fd)      { return apiJson(`/api/links/${id}`,  { method: 'PUT',  body: fd }); }
async function deleteLinkById(id)      { return sendAuthRequest(`/api/links/${id}`, { method: 'DELETE' }); }
async function setLinkVisibility(id, hidden) {
  return jsonPost(`/api/links/${id}/visibility`, { hidden });
}

const jsonPost = (url, body) =>
  apiJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const jsonPut = (url, body) =>
  apiJson(url, { method: 'PUT',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function bulkDeleteLinks(ids)    { return jsonPost('/api/links/bulk-delete', { ids }); }
async function reorderLinksApi(order)  { return sendAuthRequest('/api/links/reorder',  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }); }
async function reorderGroupsApi(order) { return sendAuthRequest('/api/groups/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }); }
async function reorderSectionsApi(order) { return sendAuthRequest('/api/sections/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }); }
async function exportLinksApi()        { return apiJson('/api/links/export'); }
async function importLinksApi(payload) { return jsonPost('/api/links/import', payload); }

async function createGroup(d)          { return jsonPost('/api/groups', d); }
async function updateGroup(id, d)      { return jsonPut(`/api/groups/${id}`, d); }
async function deleteGroupById(id)     { return sendAuthRequest(`/api/groups/${id}`, { method: 'DELETE' }); }

async function createSectionApi(groupId, name, parentSectionId = null) {
  return jsonPost(`/api/groups/${groupId}/sections`, {
    name,
    parent_section_id: parentSectionId,
  });
}
async function updateSectionApi(id, name)      { return jsonPut(`/api/sections/${id}`, { name }); }
async function deleteSectionApi(id)            { return sendAuthRequest(`/api/sections/${id}`, { method: 'DELETE' }); }

async function uploadLogo(variant, file) {
  const fd = new FormData(); fd.append('logo', file);
  return apiJson(`/api/settings/logo/${variant}`, { method: 'POST', body: fd });
}
async function removeLogo(variant)     { return sendAuthRequest(`/api/settings/logo/${variant}`, { method: 'DELETE' }); }

async function uploadFavicon(file) {
  const fd = new FormData(); fd.append('favicon', file);
  return apiJson('/api/settings/favicon', { method: 'POST', body: fd });
}
async function removeFaviconApi() {
  return sendAuthRequest('/api/settings/favicon', { method: 'DELETE' });
}
async function savePinnedGroup(groupId) {
  return jsonPost('/api/settings/pinned-group', { group_id: groupId });
}
async function saveSiteTitle(title)    { return jsonPost('/api/settings/site-title', { title }); }
async function setPublicPassword(pw)   { return jsonPost('/api/settings/public-password', { password: pw }); }
async function removePublicPassword()  { return sendAuthRequest('/api/settings/public-password', { method: 'DELETE' }); }
async function rotateAdminToken()      { return apiJson('/api/auth/rotate-token', { method: 'POST' }); }


// ─── 4. SETTINGS ──────────────────────────────────────────────────────────────

async function loadSettings() {
  const s      = await fetchSettings();
  logoLightUrl = s.logo_light || null;
  logoDarkUrl  = s.logo_dark  || null;
  faviconUrl   = s.favicon    || null;
  updateHeaderLogo();
  applyFavicon(faviconUrl);
  if (s.site_title) {
    document.title = `${s.site_title} — Admin`;
    document.getElementById('siteTitleInput').value = s.site_title;
  }
  updatePublicPasswordStatus(s.public_password_required);
}

function applyFavicon(url) {
  const link = document.getElementById('favicon');
  if (!link) return;
  if (url) link.setAttribute('href', url);
  else     link.removeAttribute('href');
}

function updateFaviconPreview(url) {
  const img = document.getElementById('faviconPreview');
  const btn = document.getElementById('removeFaviconBtn');
  if (url) { img.src = url; img.classList.remove('hidden'); btn.classList.remove('hidden'); }
  else      { img.classList.add('hidden');    btn.classList.add('hidden'); }
}

function getLogoForCurrentTheme() {
  return (document.documentElement.getAttribute('data-theme') || 'light') === 'dark'
    ? logoDarkUrl : logoLightUrl;
}

function updateHeaderLogo() {
  const url  = getLogoForCurrentTheme();
  const img  = document.getElementById('brandImg');
  const text = document.getElementById('brandText');
  if (url) { img.src = url; img.classList.remove('hidden'); text.classList.add('hidden'); }
  else      { img.classList.add('hidden'); text.classList.remove('hidden'); }
}

function updateSettingsPreview(variant, url) {
  const img = document.getElementById(variant === 'light' ? 'lightLogoPreview' : 'darkLogoPreview');
  const btn = document.getElementById(variant === 'light' ? 'removeLightLogoBtn' : 'removeDarkLogoBtn');
  if (url) { img.src = url; img.classList.remove('hidden'); btn.classList.remove('hidden'); }
  else      { img.classList.add('hidden'); btn.classList.add('hidden'); }
}

function updatePublicPasswordStatus(isSet) {
  document.getElementById('publicPasswordDesc').textContent =
    isSet ? 'Public page requires a password' : 'Public page is open to anyone';
  document.getElementById('removePublicPasswordBtn').classList.toggle('hidden', !isSet);
}

function populatePinnedGroupSelect(currentId) {
  const sel = document.getElementById('pinnedGroupSelect');
  const opts = groups.map(g =>
    `<option value="${g.id}"${g.id === currentId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`
  ).join('');
  sel.innerHTML = `<option value="">All Links (none pinned)</option>${opts}`;
}

document.getElementById('openSettingsBtn').addEventListener('click', async () => {
  const s = await fetchSettings();
  updateSettingsPreview('light', logoLightUrl);
  updateSettingsPreview('dark',  logoDarkUrl);
  updateFaviconPreview(faviconUrl);
  populatePinnedGroupSelect(s.pinned_group_id ?? null);
  document.getElementById('siteTitleInput').value = s.site_title || '';
  document.getElementById('saveFaviconsToggle').checked = !!s.save_favicons_to_library;
  updatePublicPasswordStatus(s.public_password_required);
  document.getElementById('newTokenDisplay').classList.add('hidden');
  document.getElementById('settingsOverlay').classList.remove('hidden');
});

document.getElementById('pinnedGroupSelect').addEventListener('change', async e => {
  const val = e.target.value;
  await savePinnedGroup(val === '' ? null : Number(val));
  showToast(val ? 'Default group pinned' : 'Default group cleared');
});
document.getElementById('closeSettingsBtn').addEventListener('click', () =>
  document.getElementById('settingsOverlay').classList.add('hidden'));

document.getElementById('uploadLightLogoBtn').addEventListener('click', () =>
  document.getElementById('lightLogoFileInput').click());
document.getElementById('lightLogoFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const r    = await uploadLogo('light', file);
  logoLightUrl = r.logo_url;
  updateHeaderLogo(); updateSettingsPreview('light', logoLightUrl);
  e.target.value = ''; showToast('Light logo updated');
});
document.getElementById('removeLightLogoBtn').addEventListener('click', async () => {
  await removeLogo('light'); logoLightUrl = null;
  updateHeaderLogo(); updateSettingsPreview('light', null); showToast('Light logo removed');
});

document.getElementById('uploadDarkLogoBtn').addEventListener('click', () =>
  document.getElementById('darkLogoFileInput').click());
document.getElementById('darkLogoFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const r    = await uploadLogo('dark', file);
  logoDarkUrl  = r.logo_url;
  updateHeaderLogo(); updateSettingsPreview('dark', logoDarkUrl);
  e.target.value = ''; showToast('Dark logo updated');
});
document.getElementById('removeDarkLogoBtn').addEventListener('click', async () => {
  await removeLogo('dark'); logoDarkUrl = null;
  updateHeaderLogo(); updateSettingsPreview('dark', null); showToast('Dark logo removed');
});

document.getElementById('uploadFaviconBtn').addEventListener('click', () =>
  document.getElementById('faviconFileInput').click());
document.getElementById('faviconFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const r = await uploadFavicon(file);
  faviconUrl = r.favicon;
  applyFavicon(faviconUrl);
  updateFaviconPreview(faviconUrl);
  e.target.value = ''; showToast('Favicon updated');
});
document.getElementById('removeFaviconBtn').addEventListener('click', async () => {
  await removeFaviconApi();
  faviconUrl = null;
  applyFavicon(null);
  updateFaviconPreview(null);
  showToast('Favicon removed');
});

document.getElementById('saveFaviconsToggle').addEventListener('change', async e => {
  const enabled = e.target.checked;
  const res = await sendAuthRequest('/api/settings/save-favicons', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    e.target.checked = !enabled;
    showToast('Could not save setting');
    return;
  }
  showToast(enabled ? 'Fetched favicons will be saved' : 'Setting disabled');
});

document.getElementById('openIconLibraryFromSettingsBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').classList.add('hidden');
  openIconLibrary({ pickerMode: false });
});

document.getElementById('saveSiteTitleBtn').addEventListener('click', async () => {
  const title  = document.getElementById('siteTitleInput').value.trim();
  const result = await saveSiteTitle(title);
  document.title = result.site_title ? `${result.site_title} — Admin` : 'LinkPage — Admin';
  showToast(title ? 'Site title saved' : 'Site title cleared');
});

document.getElementById('setPublicPasswordBtn').addEventListener('click', async () => {
  const pw = document.getElementById('publicPasswordInput').value;
  if (!pw) return;
  await setPublicPassword(pw);
  document.getElementById('publicPasswordInput').value = '';
  updatePublicPasswordStatus(true); showToast('Public password set');
});
document.getElementById('removePublicPasswordBtn').addEventListener('click', async () => {
  await removePublicPassword(); updatePublicPasswordStatus(false); showToast('Public password removed');
});

document.getElementById('rotateTokenBtn').addEventListener('click', async () => {
  const ok = await showConfirm({
    title:       'Rotate Admin Token',
    message:     'A new token will be generated. Your current session updates automatically.',
    confirmText: 'Rotate',
    danger:      false,
  });
  if (!ok) return;

  const result  = await rotateAdminToken();
  const display = document.getElementById('newTokenDisplay');
  if (result.token) {
    saveAdminToken(result.token);
    display.textContent = `New token: ${result.token}`;
    display.classList.remove('hidden');
    showToast('Token rotated — save the new token!', 'info', 6000);
  }
});


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
function showConfirm({ title = 'Confirm', message = '', confirmText = 'Confirm', danger = true } = {}) {
  return new Promise(resolve => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').textContent  = message;
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = confirmText;
    okBtn.className   = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    document.getElementById('confirmOverlay').classList.remove('hidden');

    const done = result => {
      document.getElementById('confirmOverlay').classList.add('hidden');
      resolve(result);
    };
    okBtn.addEventListener('click', () => done(true),  { once: true });
    document.getElementById('confirmCancelBtn').addEventListener('click', () => done(false), { once: true });
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


// ─── 8. SIDEBAR ───────────────────────────────────────────────────────────────

let draggedGroupId        = null;
let draggedSectionId      = null;
let draggedSectionGroupId = null;

function linkBelongsToGroup(link, groupId) {
  return Array.isArray(link.group_ids)
    ? link.group_ids.includes(groupId)
    : link.group_id === groupId;
}

function linkIsUngrouped(link) {
  return Array.isArray(link.group_ids)
    ? link.group_ids.length === 0
    : !link.group_id;
}

/** Returns the section_id this link has within `groupId`, or null. */
function linkSectionInGroup(link, groupId) {
  const m = (link.groups || []).find(g => g.id === groupId);
  return m ? (m.section_id ?? null) : null;
}

/** SVG glyphs reused across sidebar rows. */
const SIDEBAR_ICONS = {
  drag:   `<svg class="group-drag-handle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,
  lock:   `<svg class="group-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Protected"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  plus:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
};

function renderSidebar() {
  document.getElementById('countAll').textContent       = links.length;
  document.getElementById('countUngrouped').textContent = links.filter(linkIsUngrouped).length;

  // Top-level All/Ungrouped buttons highlight only when no section is in play.
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.classList.toggle('active',
      activeSection === null && btn.dataset.group === String(activeGroup)));

  const nav = document.getElementById('groupsNav');
  nav.innerHTML = groups.map(g => {
    const totalCount = links.filter(l => linkBelongsToGroup(l, g.id)).length;
    const isGroupActive = activeGroup === g.id && activeSection === null;
    const cStyle = isGroupActive ? `background:${g.color}18; color:${g.color}` : '';

    // Build the section + subsection tree under this group. Subsections share
    // the same markup but get a `subsection` class for the indent + smaller
    // type. Top-level sections additionally render their `+` "subsection"
    // button.
    const renderSubsectionRow = (sub) => {
      const subCount = links.filter(l =>
        linkBelongsToGroup(l, g.id) && linkSectionInGroup(l, g.id) === sub.id).length;
      const subActive = activeGroup === g.id && activeSection === sub.id;
      const subCountStyle = subActive ? `background:${g.color}18; color:${g.color}` : '';

      if (editingSectionId === sub.id) {
        return `
          <div class="section-nav-item subsection editing"
               data-section-id="${sub.id}" data-group-id="${g.id}">
            <span class="section-tick"></span>
            <input class="section-inline-input" data-mode="rename" data-section-id="${sub.id}"
                   value="${escapeHtml(sub.name)}" autocomplete="off" />
          </div>`;
      }
      return `
        <div class="section-nav-item subsection${subActive ? ' active' : ''}"
             data-section-id="${sub.id}" data-group-id="${g.id}" draggable="true">
          <span class="section-drag-handle" title="Drag to reorder">${SIDEBAR_ICONS.drag}</span>
          <span class="section-tick"></span>
          <span class="section-name">${escapeHtml(sub.name)}</span>
          <span class="nav-count" style="${subCountStyle}">${subCount}</span>
          <div class="group-item-actions">
            <button class="group-action-btn edit-section-btn"
                    data-section-id="${sub.id}" title="Rename">${SIDEBAR_ICONS.edit}</button>
            <button class="group-action-btn danger delete-section-btn"
                    data-section-id="${sub.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
          </div>
        </div>`;
    };

    const sectionRowsHtml = (g.sections || []).map(s => {
      const sCount = links.filter(l =>
        linkBelongsToGroup(l, g.id) && linkSectionInGroup(l, g.id) === s.id).length;
      const sActive = activeGroup === g.id && activeSection === s.id;
      const sCountStyle = sActive ? `background:${g.color}18; color:${g.color}` : '';

      // Rename mode: an input replaces the section name inline.
      const headHtml = editingSectionId === s.id ? `
        <div class="section-nav-item editing" data-section-id="${s.id}" data-group-id="${g.id}">
          <span class="section-tick"></span>
          <input class="section-inline-input" data-mode="rename" data-section-id="${s.id}"
                 value="${escapeHtml(s.name)}" autocomplete="off" />
        </div>` : `
        <div class="section-nav-item${sActive ? ' active' : ''}"
             data-section-id="${s.id}" data-group-id="${g.id}" draggable="true">
          <span class="section-drag-handle" title="Drag to reorder">${SIDEBAR_ICONS.drag}</span>
          <span class="section-tick"></span>
          <span class="section-name">${escapeHtml(s.name)}</span>
          <span class="nav-count" style="${sCountStyle}">${sCount}</span>
          <div class="group-item-actions">
            <button class="group-action-btn add-subsection-btn"
                    data-section-id="${s.id}" data-group-id="${g.id}"
                    title="Add subsection">${SIDEBAR_ICONS.plus}</button>
            <button class="group-action-btn edit-section-btn"
                    data-section-id="${s.id}" title="Rename">${SIDEBAR_ICONS.edit}</button>
            <button class="group-action-btn danger delete-section-btn"
                    data-section-id="${s.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
          </div>
        </div>`;

      const childrenHtml = (s.subsections || []).map(renderSubsectionRow).join('');

      const addSubRowHtml = addingSubsectionToParent === s.id ? `
        <div class="section-nav-item subsection editing"
             data-group-id="${g.id}" data-parent-section-id="${s.id}">
          <span class="section-tick"></span>
          <input class="section-inline-input" data-mode="create"
                 data-group-id="${g.id}" data-parent-section-id="${s.id}"
                 placeholder="Subsection name…" autocomplete="off" />
        </div>` : '';

      return headHtml + childrenHtml + addSubRowHtml;
    }).join('');

    const addRowHtml = addingSectionToGroupId === g.id ? `
      <div class="section-nav-item editing" data-group-id="${g.id}">
        <span class="section-tick"></span>
        <input class="section-inline-input" data-mode="create" data-group-id="${g.id}"
               placeholder="Section name…" autocomplete="off" />
      </div>` : '';

    return `
      <div class="group-nav-item${isGroupActive ? ' active' : ''}" data-group-id="${g.id}" draggable="true">
        ${SIDEBAR_ICONS.drag}
        <span class="group-dot" style="background:${escapeHtml(g.color)}"></span>
        <span>${escapeHtml(g.name)}${g.is_protected ? SIDEBAR_ICONS.lock : ''}</span>
        <span class="nav-count" style="${cStyle}">${totalCount}</span>
        <div class="group-item-actions">
          <button class="group-action-btn add-section-btn" data-group-id="${g.id}" title="Add section">${SIDEBAR_ICONS.plus}</button>
          <button class="group-action-btn edit-group-btn"  data-group-id="${g.id}" title="Edit">${SIDEBAR_ICONS.edit}</button>
          <button class="group-action-btn danger delete-group-btn" data-group-id="${g.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
        </div>
      </div>
      ${sectionRowsHtml}
      ${addRowHtml}`;
  }).join('');

  // ─── Click handlers ───────────────────────────────────────────────────────
  nav.querySelectorAll('.group-nav-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.group-item-actions')) return;
      activeGroup   = Number(item.dataset.groupId);
      activeSection = null;
      renderSidebar(); renderLinks(true);
    });
  });
  nav.querySelectorAll('.edit-group-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openEditGroupModal(Number(btn.dataset.groupId)); }));
  nav.querySelectorAll('.delete-group-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openDeleteGroupModal(Number(btn.dataset.groupId)); }));
  nav.querySelectorAll('.add-section-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addingSectionToGroupId   = Number(btn.dataset.groupId);
      addingSubsectionToParent = null;
      editingSectionId         = null;
      renderSidebar();
      const input = nav.querySelector(
        '.section-inline-input[data-mode="create"]:not([data-parent-section-id])'
      );
      if (input) input.focus();
    }));
  nav.querySelectorAll('.add-subsection-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addingSubsectionToParent = Number(btn.dataset.sectionId);
      addingSectionToGroupId   = null;
      editingSectionId         = null;
      renderSidebar();
      const input = nav.querySelector(
        `.section-inline-input[data-mode="create"][data-parent-section-id="${addingSubsectionToParent}"]`
      );
      if (input) input.focus();
    }));

  // Section row: click filters; edit/delete on hover
  nav.querySelectorAll('.section-nav-item:not(.editing)').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.group-item-actions')) return;
      activeGroup   = Number(item.dataset.groupId);
      activeSection = Number(item.dataset.sectionId);
      renderSidebar(); renderLinks(true);
    });
  });
  nav.querySelectorAll('.edit-section-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      editingSectionId       = Number(btn.dataset.sectionId);
      addingSectionToGroupId = null;
      renderSidebar();
      const input = nav.querySelector('.section-inline-input[data-mode="rename"]');
      if (input) { input.focus(); input.select(); }
    }));
  nav.querySelectorAll('.delete-section-btn').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const sid = Number(btn.dataset.sectionId);
      const ok = await showConfirm({
        title:       'Delete Section',
        message:     'Delete this section? Links in it become unsectioned (they keep their group membership).',
        confirmText: 'Delete',
      });
      if (!ok) return;
      await deleteSectionApi(sid);
      if (activeSection === sid) activeSection = null;
      showToast('Section deleted');
      await loadAllData();
    }));

  // Inline input handling (create + rename). The closure-level `settled` flag
  // prevents Enter→blur from firing the save twice (which created duplicate
  // sections — pressing Enter triggers a re-render that removes the input,
  // which in turn fires its own blur event).
  nav.querySelectorAll('.section-inline-input').forEach(input => {
    let settled = false;
    const finish = async commit => {
      if (settled) return;
      settled = true;

      const resetState = () => {
        addingSectionToGroupId   = null;
        addingSubsectionToParent = null;
        editingSectionId         = null;
      };

      if (!commit) {
        resetState();
        renderSidebar();
        return;
      }
      const name = input.value.trim();
      if (!name) {
        resetState();
        renderSidebar();
        return;
      }
      try {
        if (input.dataset.mode === 'create') {
          const groupId         = Number(input.dataset.groupId);
          const parentSectionId = input.dataset.parentSectionId
            ? Number(input.dataset.parentSectionId) : null;
          await createSectionApi(groupId, name, parentSectionId);
          showToast(parentSectionId ? 'Subsection created' : 'Section created');
        } else {
          await updateSectionApi(Number(input.dataset.sectionId), name);
          showToast('Section renamed');
        }
      } catch { showToast('Could not save section', 'error'); }
      resetState();
      await loadAllData();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  });

  // ─── Group drag-to-reorder (unchanged) ─────────────────────────────────────
  nav.querySelectorAll('.group-nav-item').forEach(item => {
    const gid = Number(item.dataset.groupId);
    item.addEventListener('dragstart', e => { draggedGroupId = gid; item.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragend',   () => { item.style.opacity = ''; nav.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); draggedGroupId = null; });
    item.addEventListener('dragover',  e => { e.preventDefault(); if (draggedGroupId !== gid) item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drag-over');
      if (!draggedGroupId || draggedGroupId === gid) return;
      const fi = groups.findIndex(g => g.id === draggedGroupId);
      const ti = groups.findIndex(g => g.id === gid);
      const [m] = groups.splice(fi, 1); groups.splice(ti, 0, m);
      renderSidebar(); reorderGroupsApi(groups.map(g => g.id));
    });
  });

  // ─── Section drag-to-reorder (within a single group only) ─────────────────
  // ─── Section/subsection drag-to-reorder ────────────────────────────────
  // Reordering is scoped to siblings: top-level sections can only swap among
  // other top-level sections in the same group, and subsections can only
  // swap among other subsections of the same parent.
  const findSectionParentId = (gid, sectionId) => {
    const group = groups.find(g => g.id === gid);
    if (!group) return undefined;
    for (const s of group.sections || []) {
      if (s.id === sectionId) return null;
      if ((s.subsections || []).some(sub => sub.id === sectionId)) return s.id;
    }
    return undefined;
  };

  nav.querySelectorAll('.section-nav-item:not(.editing)').forEach(item => {
    const sid = Number(item.dataset.sectionId);
    const gid = Number(item.dataset.groupId);
    const isSub = item.classList.contains('subsection');
    item.addEventListener('dragstart', e => {
      // Don't let a section drag bubble up and trigger a group drag.
      e.stopPropagation();
      draggedSectionId      = sid;
      draggedSectionGroupId = gid;
      item.style.opacity    = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '';
      nav.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedSectionId      = null;
      draggedSectionGroupId = null;
    });
    const compatibleSibling = () => {
      if (!draggedSectionId || draggedSectionGroupId !== gid) return false;
      if (draggedSectionId === sid) return false;
      const draggedIsSub = !!nav.querySelector(
        `.section-nav-item.subsection[data-section-id="${draggedSectionId}"]`
      );
      if (draggedIsSub !== isSub) return false;
      // Subsections additionally need the same parent.
      if (isSub) {
        return findSectionParentId(gid, draggedSectionId) === findSectionParentId(gid, sid);
      }
      return true;
    };
    item.addEventListener('dragover', e => {
      if (!compatibleSibling()) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      item.classList.remove('drag-over');
      if (!compatibleSibling()) return;
      e.preventDefault();
      e.stopPropagation();

      const group = groups.find(g => g.id === gid);
      if (!group || !Array.isArray(group.sections)) return;

      if (isSub) {
        const parentId = findSectionParentId(gid, sid);
        const parent   = group.sections.find(s => s.id === parentId);
        if (!parent || !Array.isArray(parent.subsections)) return;
        const fi = parent.subsections.findIndex(s => s.id === draggedSectionId);
        const ti = parent.subsections.findIndex(s => s.id === sid);
        if (fi === -1 || ti === -1) return;
        const [moved] = parent.subsections.splice(fi, 1);
        parent.subsections.splice(ti, 0, moved);
        renderSidebar();
        reorderSectionsApi(parent.subsections.map(s => s.id));
      } else {
        const fi = group.sections.findIndex(s => s.id === draggedSectionId);
        const ti = group.sections.findIndex(s => s.id === sid);
        if (fi === -1 || ti === -1) return;
        const [moved] = group.sections.splice(fi, 1);
        group.sections.splice(ti, 0, moved);
        renderSidebar();
        reorderSectionsApi(group.sections.map(s => s.id));
      }
    });
  });

  // ─── Drop a link card onto a group/section/subsection in the sidebar ─────
  // The drag is started from the card (enableLinkDrag sets draggedLinkId);
  // here we just register every sidebar row as a valid drop target. Group
  // rows move the link into that group with no section; section/subsection
  // rows move it into that exact leaf. Memberships in other groups are kept.
  nav.querySelectorAll('.group-nav-item, .section-nav-item:not(.editing)').forEach(item => {
    item.addEventListener('dragover', e => {
      if (draggedLinkId == null) return;        // not a link drag
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over-link');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over-link'));
    item.addEventListener('drop', async e => {
      if (draggedLinkId == null) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over-link');

      const linkId    = draggedLinkId;
      const groupId   = Number(item.dataset.groupId);
      const sectionId = item.dataset.sectionId ? Number(item.dataset.sectionId) : null;
      if (!Number.isFinite(groupId) || groupId <= 0) return;
      draggedLinkId = null;                       // prevent a follow-up reorder drop
      await moveLinkIntoSection(linkId, groupId, sectionId);
    });
  });
}


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
  const d = await fetchLinkClicks(link.id);
  renderRecentClicks(d.recentClicks); renderTopIps(d.topIps);
}

function renderRecentClicks(clicks) {
  const c = document.getElementById('recentClicksContainer');
  if (!clicks.length) { c.innerHTML = '<div class="stats-empty">No clicks recorded yet</div>'; return; }
  c.innerHTML = `<div class="click-log">${clicks.map(cl => `
    <div class="click-row">
      <span class="click-ip">${escapeHtml(cl.ip_address)}</span>
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
      <span class="click-ip">${escapeHtml(ip.ip_address)}</span>
      <div class="click-bar-wrap"><div class="click-bar" style="width:${Math.round(ip.click_count/hi*100)}%"></div></div>
      <span class="click-count">${ip.click_count} click${ip.click_count !== 1 ? 's' : ''}</span>
    </div>`).join('')}</div>`;
}

document.getElementById('closeStatsBtn').addEventListener('click', () =>
  document.getElementById('statsOverlay').classList.add('hidden'));


// ─── 11. LINK MODAL ───────────────────────────────────────────────────────────

let shouldRemoveIcon = false;
let pendingIconId    = null;    // id of an icon picked from the library, if any

// Tracks Link/File mode state for the link modal.
let linkModalMode      = 'link';        // 'link' or 'file'
let pendingAttachedFile = null;          // File object picked but not yet uploaded
let existingAttachedName = null;         // filename of an existing attachment when editing
let shouldRemoveAttachedFile = false;    // true when user explicitly clears an existing file

function setLinkModalMode(mode) {
  linkModalMode = mode === 'file' ? 'file' : 'link';
  document.querySelectorAll('.link-mode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === linkModalMode));
  document.querySelectorAll('.link-mode-pane').forEach(p =>
    p.classList.toggle('hidden', p.dataset.mode !== linkModalMode));

  // The URL input toggles required-ness based on mode so the browser's native
  // validation matches what the server expects.
  document.getElementById('inputUrl').required = (linkModalMode === 'link');
}

function refreshAttachedFileUi() {
  const trigger = document.getElementById('attachFileBtn');
  const label   = document.getElementById('attachedFileLabel');
  const clear   = document.getElementById('clearAttachedFileBtn');

  let displayName = null;
  if (pendingAttachedFile)               displayName = pendingAttachedFile.name;
  else if (existingAttachedName && !shouldRemoveAttachedFile)
                                          displayName = existingAttachedName;

  if (displayName) {
    label.textContent = displayName;
    trigger.classList.add('has-file');
    clear.classList.remove('hidden');
  } else {
    label.textContent = 'Choose a file…';
    trigger.classList.remove('has-file');
    clear.classList.add('hidden');
  }
}

document.querySelectorAll('.link-mode-tab').forEach(tab =>
  tab.addEventListener('click', () => setLinkModalMode(tab.dataset.mode)));

document.getElementById('attachFileBtn').addEventListener('click', () =>
  document.getElementById('inputAttachedFile').click());

document.getElementById('inputAttachedFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAttachedFile        = file;
  shouldRemoveAttachedFile   = false;
  refreshAttachedFileUi();
});

document.getElementById('clearAttachedFileBtn').addEventListener('click', () => {
  pendingAttachedFile      = null;
  shouldRemoveAttachedFile = !!existingAttachedName;
  document.getElementById('inputAttachedFile').value = '';
  refreshAttachedFileUi();
});

/**
 * Populates the multi-select group dropdown.
 * `selectedAssignments` is an array of either { id, section_id } objects or
 * raw numeric IDs. Each group entry has a checkbox; when ticked AND the group
 * has sections, a small section dropdown appears beneath it.
 */
function populateGroupDropdown(selectedAssignments = []) {
  const sectionByGroup = new Map();
  const selected       = new Set();
  for (const raw of selectedAssignments) {
    if (typeof raw === 'number') { selected.add(raw); continue; }
    if (raw && typeof raw === 'object') {
      const gid = Number(raw.id ?? raw.group_id);
      if (!gid) continue;
      selected.add(gid);
      const sid = raw.section_id ?? null;
      if (sid !== null) sectionByGroup.set(gid, Number(sid));
    }
  }

  const menu = document.getElementById('inputGroupOptions');

  if (!groups.length) {
    menu.innerHTML = '<div class="multi-select-empty">No groups yet — create one from the sidebar</div>';
    updateMultiSelectLabel();
    return;
  }

  menu.innerHTML = groups.map(g => {
    const isChecked = selected.has(g.id);
    const sections  = g.sections || [];
    const pickedSid = sectionByGroup.get(g.id) ?? null;

    // Flatten the two-level hierarchy into <option>s. Subsections are
    // indented with a non-breaking arrow so the parent → child relationship
    // reads clearly in the native <select> dropdown.
    const sectionOptions = sections.flatMap(s => {
      const opt = `
        <option value="${s.id}" ${pickedSid === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`;
      const subs = (s.subsections || []).map(sub => `
        <option value="${sub.id}" ${pickedSid === sub.id ? 'selected' : ''}>
              ↳ ${escapeHtml(sub.name)}
        </option>`);
      return [opt, ...subs];
    }).join('');

    const sectionPicker = sections.length === 0 ? '' : `
      <div class="multi-select-section${isChecked ? '' : ' hidden'}" data-group-id="${g.id}">
        <span class="multi-select-section-arrow">↳</span>
        <select class="multi-select-section-select" data-group-id="${g.id}">
          <option value="">No section</option>
          ${sectionOptions}
        </select>
      </div>`;

    return `
      <div class="multi-select-row" data-group-id="${g.id}">
        <label class="multi-select-option">
          <input type="checkbox" value="${g.id}" ${isChecked ? 'checked' : ''}>
          <span class="group-dot" style="background:${escapeHtml(g.color)}"></span>
          <span>${escapeHtml(g.name)}</span>
        </label>
        ${sectionPicker}
      </div>`;
  }).join('');

  // Checkbox toggle: update label and reveal/hide section sub-row.
  menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const row   = cb.closest('.multi-select-row');
      const subRow = row && row.querySelector('.multi-select-section');
      if (subRow) subRow.classList.toggle('hidden', !cb.checked);
      // Reset section to "None" when un-ticking — picking the group again starts fresh.
      if (!cb.checked && subRow) {
        const sel = subRow.querySelector('.multi-select-section-select');
        if (sel) sel.value = '';
      }
      updateMultiSelectLabel();
    });
  });

  updateMultiSelectLabel();
}

/**
 * Returns the current group assignments as an array of { id, section_id }
 * objects, suitable for sending to POST/PUT /api/links via the `groups` field.
 */
function getSelectedAssignments() {
  const out = [];
  document.querySelectorAll('#inputGroupOptions .multi-select-row').forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb || !cb.checked) return;
    const gid = Number(cb.value);
    const sel = row.querySelector('.multi-select-section-select');
    const sidRaw = sel ? sel.value : '';
    const section_id = sidRaw ? Number(sidRaw) : null;
    out.push({ id: gid, section_id });
  });
  return out;
}

/** Back-compat thin wrapper used by older code paths that only need IDs. */
function getSelectedGroupIds() {
  return getSelectedAssignments().map(a => a.id);
}

function updateMultiSelectLabel() {
  const assignments = getSelectedAssignments();
  const label       = document.getElementById('inputGroupLabel');
  if (assignments.length === 0) {
    label.textContent = 'None';
    label.classList.add('placeholder');
    return;
  }
  if (assignments.length === 1) {
    const a = assignments[0];
    const g = groups.find(x => x.id === a.id);
    const groupName = g ? g.name : '1 group';
    // Include the section name so the user sees their section pre-selection
    // without having to expand the dropdown.
    if (a.section_id && g) {
      const sec = (g.sections || []).find(s => s.id === a.section_id);
      if (sec) {
        label.textContent = `${groupName} · ${sec.name}`;
        label.classList.remove('placeholder');
        return;
      }
    }
    label.textContent = groupName;
    label.classList.remove('placeholder');
    return;
  }
  label.textContent = `${assignments.length} groups`;
  label.classList.remove('placeholder');
}

function closeGroupMulti() {
  document.getElementById('inputGroupMulti').classList.remove('open');
  document.getElementById('inputGroupOptions').classList.add('hidden');
  document.getElementById('inputGroupToggle').setAttribute('aria-expanded', 'false');
}

document.getElementById('inputGroupToggle').addEventListener('click', () => {
  const wrap   = document.getElementById('inputGroupMulti');
  const menu   = document.getElementById('inputGroupOptions');
  const isOpen = wrap.classList.toggle('open');
  menu.classList.toggle('hidden', !isOpen);
  document.getElementById('inputGroupToggle').setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', e => {
  const wrap = document.getElementById('inputGroupMulti');
  if (!wrap.classList.contains('open')) return;
  if (!wrap.contains(e.target)) closeGroupMulti();
});

function resetLinkModalAttachmentState() {
  pendingAttachedFile        = null;
  existingAttachedName       = null;
  shouldRemoveAttachedFile   = false;
  document.getElementById('inputAttachedFile').value = '';
  refreshAttachedFileUi();
}

function openAddLinkModal() {
  shouldRemoveIcon = false;
  pendingIconId    = null;
  document.getElementById('linkModalTitle').textContent = 'Add Link';
  document.getElementById('editingLinkId').value = '';
  document.getElementById('linkForm').reset();
  document.getElementById('faviconImg').className = '';
  document.getElementById('faviconImg').src = '';
  document.getElementById('urlDuplicateWarning').classList.add('hidden');
  clearCustomIconPreview(); hideFormError('linkFormError');
  closeGroupMulti();
  resetLinkModalAttachmentState();
  setLinkModalMode('link');
  // Preselect the currently-active group/section so the new link lands there.
  const preselect = (typeof activeGroup === 'number')
    ? [{ id: activeGroup, section_id: activeSection ?? null }]
    : [];
  populateGroupDropdown(preselect);
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function openEditLinkModal(link) {
  shouldRemoveIcon = false;
  pendingIconId    = null;
  // Edit doesn't call linkForm.reset() (we need to populate fields from the
  // link). Clear the icon file input by hand so a file picked while editing
  // a previous link doesn't bleed into this one's submit.
  document.getElementById('inputImage').value = '';
  document.getElementById('linkModalTitle').textContent = 'Edit Link';
  document.getElementById('editingLinkId').value  = link.id;
  document.getElementById('inputName').value      = link.name;
  document.getElementById('inputDesc').value      = link.description || '';
  document.getElementById('urlDuplicateWarning').classList.add('hidden');
  closeGroupMulti();
  // Hydrate the multi-select with each group plus its section assignment.
  const currentAssignments = Array.isArray(link.groups) && link.groups.length
    ? link.groups.map(g => ({ id: g.id, section_id: g.section_id ?? null }))
    : (link.group_id ? [{ id: link.group_id, section_id: null }] : []);
  populateGroupDropdown(currentAssignments);

  resetLinkModalAttachmentState();
  if (link.file_path) {
    // File-backed link: open in File mode and remember the current filename
    // so the user can replace or remove it.
    existingAttachedName = link.file_name || 'Current file';
    document.getElementById('inputUrl').value = '';
    setLinkModalMode('file');
    refreshAttachedFileUi();
  } else {
    document.getElementById('inputUrl').value = link.url;
    setLinkModalMode('link');
  }

  const fi = document.getElementById('faviconImg');
  const fu = link.file_path ? null : getFaviconUrl(link.url);
  fi.src = fu || ''; fi.className = fu ? 'visible' : '';
  link.image_path ? showCustomIconPreview(link.image_path) : clearCustomIconPreview();
  hideFormError('linkFormError');
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function closeLinkModal() { document.getElementById('linkModalOverlay').classList.add('hidden'); }

function showCustomIconPreview(src, { fromLibrary = false } = {}) {
  document.getElementById('iconPreviewImg').src = src;
  document.getElementById('iconPreviewWrap').classList.remove('hidden');
  document.getElementById('iconSourceBadge').classList.toggle('hidden', !fromLibrary);
}
function clearCustomIconPreview() {
  document.getElementById('iconPreviewWrap').classList.add('hidden');
  document.getElementById('iconPreviewImg').src = '';
  document.getElementById('iconSourceBadge').classList.add('hidden');
}

let faviconTimer;
let faviconPreviewAbort;       // AbortController for any in-flight preview fetch
let faviconPreviewBlobUrl;     // last blob URL we created, so we can revoke it
document.getElementById('inputUrl').addEventListener('input', e => {
  const url       = e.target.value.trim();
  const editingId = parseInt(document.getElementById('editingLinkId').value) || null;
  const fi        = document.getElementById('faviconImg');

  // Duplicate URL warning
  const dup = links.find(l => l.url === url && l.id !== editingId);
  const wEl = document.getElementById('urlDuplicateWarning');
  if (dup && url) { wEl.textContent = `URL already exists: "${dup.name}"`; wEl.classList.remove('hidden'); }
  else              wEl.classList.add('hidden');

  // Cancel anything still running from the previous keystroke.
  clearTimeout(faviconTimer);
  if (faviconPreviewAbort) faviconPreviewAbort.abort();
  if (faviconPreviewBlobUrl) { URL.revokeObjectURL(faviconPreviewBlobUrl); faviconPreviewBlobUrl = null; }
  fi.src = ''; fi.className = '';

  let validUrl = null;
  try {
    const p = new URL(url);
    if ((p.protocol === 'http:' || p.protocol === 'https:') && p.hostname.length >= 1) {
      validUrl = p.href;
    }
  } catch {}
  if (!validUrl) return;

  faviconTimer = setTimeout(async () => {
    faviconPreviewAbort = new AbortController();
    let serverGotIt = false;
    try {
      const res = await sendAuthRequest(
        `/api/favicon-preview?url=${encodeURIComponent(validUrl)}`,
        { signal: faviconPreviewAbort.signal }
      );
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          faviconPreviewBlobUrl = URL.createObjectURL(blob);
          fi.src     = faviconPreviewBlobUrl;
          fi.onload  = () => fi.className = 'visible';
          fi.onerror = () => fi.className = '';
          serverGotIt = true;
        }
      }
    } catch { /* aborted by next keystroke, or network error */ }

    // Browser-side display fallback: if the server couldn't fetch the icon
    // (e.g. intranet host the server can't reach), let the admin's own browser
    // try a couple of direct URLs. Display-only — no bytes are read here.
    if (!serverGotIt) showPreviewWithBrowserFallback(validUrl, fi);
  }, 600);
});

function showPreviewWithBrowserFallback(siteUrl, fi) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { fi.className = ''; return; }
  const candidates = [
    `${parsed.origin}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
  ];
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { fi.className = ''; return; }
    fi.src     = candidates[i++];
    fi.onload  = () => fi.className = 'visible';
    fi.onerror = tryNext;
  };
  tryNext();
}

document.getElementById('iconUploadArea').addEventListener('click', () => document.getElementById('inputImage').click());
document.getElementById('inputImage').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = ev => showCustomIconPreview(ev.target.result); r.readAsDataURL(f);
  shouldRemoveIcon = false;
  pendingIconId    = null;
});
document.getElementById('removeCustomIconBtn').addEventListener('click', () => {
  shouldRemoveIcon = true;
  pendingIconId    = null;
  clearCustomIconPreview();
  document.getElementById('inputImage').value = '';
});
document.getElementById('openIconLibraryBtn').addEventListener('click', () => openIconLibrary({ pickerMode: true }));

document.getElementById('linkForm').addEventListener('submit', async e => {
  e.preventDefault(); hideFormError('linkFormError');

  const linkId  = document.getElementById('editingLinkId').value;
  const fd      = new FormData();
  fd.append('name',         document.getElementById('inputName').value.trim());
  fd.append('description',  document.getElementById('inputDesc').value.trim());
  fd.append('groups',       JSON.stringify(getSelectedAssignments()));
  fd.append('remove_image', shouldRemoveIcon ? 'true' : 'false');

  if (linkModalMode === 'file') {
    // File mode: no URL is sent. If user picked a new file, attach it.
    // If editing a link that had no file before, the server requires a file.
    fd.append('url', '');
    if (pendingAttachedFile) fd.append('file', pendingAttachedFile);
    if (shouldRemoveAttachedFile) fd.append('remove_file', 'true');
  } else {
    // URL mode: send the URL. If editing a link that *had* a file, drop it.
    fd.append('url', document.getElementById('inputUrl').value.trim());
    if (existingAttachedName) fd.append('remove_file', 'true');
  }

  const imgFile = document.getElementById('inputImage').files[0];
  if (imgFile) {
    fd.append('image', imgFile);
  } else if (pendingIconId) {
    fd.append('icon_id', String(pendingIconId));
  }

  const btn = document.getElementById('saveLinkBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const sentOwnIcon = !!(imgFile || pendingIconId);

  try {
    const result = linkId ? await updateLink(linkId, fd) : await createLink(fd);
    if (result?.error) { showFormError('linkFormError', result.error); return; }
    closeLinkModal();
    showToast(linkId ? 'Link saved' : 'Link added');
    await loadAllData();

    // Browser-side favicon fallback: if the server couldn't reach the host
    // (intranet from cloud, blocked egress, etc.) and the admin didn't pick
    // an icon themselves, try fetching from the admin's browser and upload
    // the bytes as a library icon. Fire-and-forget — SSE will re-render the
    // card when the icon is attached.
    const needsFallback = result?.url
                       && !result.file_path
                       && !result.image_path
                       && !result.favicon_path
                       && !sentOwnIcon;
    if (needsFallback) {
      ensureFaviconViaBrowser(result).catch(() => {});
    }
  } catch {
    showFormError('linkFormError', 'Something went wrong. Please try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Link';
  }
});

// ─── Browser-side favicon fallback ────────────────────────────────────────────
//
// When the server can't reach the target host (e.g. intranet from cloud), the
// admin's own browser tries to grab the favicon bytes and uploads them to the
// icon library, then reassigns the saved link to that library icon. CORS
// limits how often this succeeds in practice, but for permissive intranet
// servers and a handful of public ones (GitHub, etc.) it works without fuss.

async function ensureFaviconViaBrowser(link) {
  const blob = await fetchFaviconBlobInBrowser(link.url);
  if (!blob) return;

  // 1) Upload to the icon library.
  const fd = new FormData();
  const ext = (blob.type.split('/')[1] || 'png').replace('svg+xml', 'svg');
  fd.append('image', new File([blob], `favicon-${link.id}.${ext}`, { type: blob.type }));
  const icon = await apiJson('/api/icons', { method: 'POST', body: fd }).catch(() => null);
  if (!icon?.id) return;

  // 2) Reassign the link to point at the new library icon.
  const linkFd = new FormData();
  linkFd.append('name',        link.name);
  linkFd.append('description', link.description || '');
  linkFd.append('url',         link.url);
  linkFd.append('groups',      JSON.stringify(
    (link.groups || []).map(g => ({ id: g.id, section_id: g.section_id ?? null }))
  ));
  linkFd.append('icon_id', String(icon.id));
  await sendAuthRequest(`/api/links/${link.id}`, { method: 'PUT', body: linkFd });
  showToast('Icon fetched from your browser');
}

/**
 * Best-effort browser-side favicon fetch. Returns a Blob of image bytes or null.
 * Tries several strategies (page HTML parse, /favicon.ico, Google), each with
 * either a direct CORS fetch or a canvas-via-Image hack. Every step is wrapped
 * in try/catch — most cross-origin sites will trip CORS, which is fine.
 */
async function fetchFaviconBlobInBrowser(siteUrl) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const candidates = new Set();

  // 1) Parse the page for declared <link rel="icon">.
  try {
    const pageRes = await fetch(siteUrl, { mode: 'cors', credentials: 'omit' });
    if (pageRes.ok) {
      const ct = (pageRes.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('html')) {
        const head = (await pageRes.text()).slice(0, 64 * 1024);
        const re = /<link\b[^>]*>/gi;
        let m;
        while ((m = re.exec(head)) !== null) {
          const tag  = m[0];
          if (!/\brel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
          const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
          if (!href) continue;
          try { candidates.add(new URL(href, siteUrl).href); } catch {}
        }
      }
    }
  } catch { /* CORS-blocked, that's fine */ }

  // 2) Conventional /favicon.ico.
  candidates.add(`${parsed.origin}/favicon.ico`);

  // 3) Google as a last resort (works for public sites where the server-side
  //    fetch failed for some other reason).
  candidates.add(`https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`);

  for (const url of candidates) {
    // Direct fetch — fastest, works when the target sends Access-Control-Allow-Origin.
    try {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (r.ok) {
        const blob = await r.blob();
        if (blob.size > 0 && /^image\//.test(blob.type)) return blob;
      }
    } catch { /* CORS */ }

    // <img> + canvas — also CORS-bound (the canvas taints without permissive headers),
    // but covers servers that allow CORS for binary but not for plain fetch.
    try {
      const blob = await imgUrlToCanvasBlob(url);
      if (blob && blob.size > 0) return blob;
    } catch { /* tainted canvas */ }
  }
  return null;
}

function imgUrlToCanvasBlob(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let done = false;
    const finish = (err, val) => {
      if (done) return; done = true;
      img.onload = null; img.onerror = null;
      err ? reject(err) : resolve(val);
    };
    img.onload = () => {
      try {
        const w = img.naturalWidth  || 64;
        const h = img.naturalHeight || 64;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? finish(null, b) : finish(new Error('null blob')), 'image/png');
      } catch (e) { finish(e); }
    };
    img.onerror = () => finish(new Error('img load failed'));
    img.src = url;
    setTimeout(() => finish(new Error('timeout')), 6000);
  });
}

document.getElementById('openAddLinkBtn').addEventListener('click', openAddLinkModal);
document.getElementById('closeLinkModalBtn').addEventListener('click', closeLinkModal);
document.getElementById('cancelLinkModalBtn').addEventListener('click', closeLinkModal);


// ─── 12. DELETE LINK ──────────────────────────────────────────────────────────

let pendingDeleteLinkId = null;

function openDeleteLinkModal(link) {
  pendingDeleteLinkId = link.id;
  document.getElementById('deleteLinkNameLabel').textContent = link.name;
  document.getElementById('deleteLinkOverlay').classList.remove('hidden');
}

document.getElementById('confirmDeleteLinkBtn').addEventListener('click', async () => {
  if (!pendingDeleteLinkId) return;
  await deleteLinkById(pendingDeleteLinkId);
  pendingDeleteLinkId = null;
  document.getElementById('deleteLinkOverlay').classList.add('hidden');
  showToast('Link deleted');
  await loadAllData();
});
document.getElementById('cancelDeleteLinkBtn').addEventListener('click', () =>
  document.getElementById('deleteLinkOverlay').classList.add('hidden'));


// ─── 13. GROUP MODAL ──────────────────────────────────────────────────────────

function buildColorPalette(selected) {
  const palette  = document.getElementById('colorPalette');
  const isCustom = !GROUP_COLORS.includes(selected);

  // Preset swatches + one "custom" swatch that opens the native colour picker.
  // The custom swatch's background previews the currently-chosen custom colour.
  const presets = GROUP_COLORS.map(c => `
    <div class="color-swatch${c === selected ? ' selected' : ''}"
         data-color="${c}" style="background:${c}" title="${c}"></div>`).join('');
  const customSwatchColor = isCustom ? selected : '#888888';
  palette.innerHTML = `${presets}
    <label class="color-swatch color-swatch-custom${isCustom ? ' selected' : ''}"
           title="Custom colour"
           style="background:${escapeHtml(customSwatchColor)}">
      <span class="color-swatch-plus">+</span>
      <input type="color" id="groupColorPicker"
             value="${escapeHtml(isCustom ? selected : GROUP_COLORS[0])}" />
    </label>`;

  function markSelected(el, color) {
    palette.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('groupColorInput').value = color;
  }

  palette.querySelectorAll('.color-swatch[data-color]').forEach(s =>
    s.addEventListener('click', () => markSelected(s, s.dataset.color)));

  const customSwatch = palette.querySelector('.color-swatch-custom');
  const colorInput   = palette.querySelector('#groupColorPicker');
  colorInput.addEventListener('input', e => {
    const c = e.target.value;
    customSwatch.style.background = c;
    markSelected(customSwatch, c);
  });
}

/**
 * `clearPasswordOnSave` — when true, the next form submit will send password=null
 * to strip the password from the group being edited. Reset between modal opens.
 */
let clearPasswordOnSave = false;

function updateGroupPasswordStatus(isProtected) {
  const status = document.getElementById('groupPasswordStatus');
  const clear  = document.getElementById('clearGroupPasswordBtn');
  if (isProtected && !clearPasswordOnSave) {
    status.textContent = 'This group is currently password-protected.';
    status.classList.remove('hidden'); status.classList.add('protected');
    clear.classList.remove('hidden');
  } else if (clearPasswordOnSave) {
    status.textContent = 'Password will be removed when you save.';
    status.classList.remove('hidden', 'protected');
    clear.classList.add('hidden');
  } else {
    status.classList.add('hidden');
    clear.classList.add('hidden');
  }
}

function setUnlockModeRadio(mode) {
  const value = mode === 'session' ? 'session' : 'timeout';
  document.querySelectorAll('input[name="groupUnlockMode"]').forEach(r => {
    r.checked = (r.value === value);
  });
}

/**
 * Shows the unlock-behavior radio group only when the group will end up
 * password-protected after save. Re-evaluated on input + clear-button clicks.
 */
function refreshUnlockModeRowVisibility() {
  const row    = document.getElementById('groupUnlockModeRow');
  const editId = document.getElementById('editingGroupId').value;
  const pwTyped = document.getElementById('groupPasswordInput').value.length > 0;
  const existing = editId
    ? (groups.find(g => g.id === Number(editId))?.is_protected ?? false)
    : false;
  // Protected after save if a new password was typed, OR an existing one is
  // kept (no clear), OR the existing one was overwritten with a new one.
  const willBeProtected = pwTyped || (existing && !clearPasswordOnSave);
  row.classList.toggle('hidden', !willBeProtected);
}

function openAddGroupModal() {
  clearPasswordOnSave = false;
  document.getElementById('groupModalTitle').textContent = 'New Group';
  document.getElementById('editingGroupId').value        = '';
  document.getElementById('groupNameInput').value        = '';
  document.getElementById('groupPasswordInput').value    = '';
  document.getElementById('groupColorInput').value       = GROUP_COLORS[0];
  buildColorPalette(GROUP_COLORS[0]); hideFormError('groupFormError');
  updateGroupPasswordStatus(false);
  setUnlockModeRadio('timeout');
  refreshUnlockModeRowVisibility();
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function openEditGroupModal(gid) {
  const g = groups.find(x => x.id === gid); if (!g) return;
  clearPasswordOnSave = false;
  document.getElementById('groupModalTitle').textContent = 'Edit Group';
  document.getElementById('editingGroupId').value        = g.id;
  document.getElementById('groupNameInput').value        = g.name;
  document.getElementById('groupPasswordInput').value    = '';
  document.getElementById('groupColorInput').value       = g.color;
  buildColorPalette(g.color); hideFormError('groupFormError');
  updateGroupPasswordStatus(!!g.is_protected);
  setUnlockModeRadio(g.unlock_mode || 'timeout');
  refreshUnlockModeRowVisibility();
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function closeGroupModal() { document.getElementById('groupModalOverlay').classList.add('hidden'); }

document.getElementById('clearGroupPasswordBtn').addEventListener('click', () => {
  clearPasswordOnSave = true;
  document.getElementById('groupPasswordInput').value = '';
  updateGroupPasswordStatus(true);
  refreshUnlockModeRowVisibility();
});

document.getElementById('groupPasswordInput').addEventListener('input', refreshUnlockModeRowVisibility);

document.getElementById('groupForm').addEventListener('submit', async e => {
  e.preventDefault(); hideFormError('groupFormError');
  const gid      = document.getElementById('editingGroupId').value;
  const name     = document.getElementById('groupNameInput').value.trim();
  const color    = document.getElementById('groupColorInput').value;
  const pwInput  = document.getElementById('groupPasswordInput').value;
  if (!name) return;

  // Decide what to send for `password`:
  //   - clearPasswordOnSave → null (remove protection)
  //   - non-empty input     → set this new password
  //   - empty input on edit → omit the field (keep current state)
  const payload = { name, color };
  if (clearPasswordOnSave)         payload.password = null;
  else if (pwInput.length > 0)     payload.password = pwInput;

  // Send unlock_mode only when the group is/will be protected, so we don't
  // overwrite stored state for a group that has no password.
  const willBeProtected = !!payload.password ||
    (gid && !clearPasswordOnSave &&
     (groups.find(g => g.id === Number(gid))?.is_protected ?? false));
  if (willBeProtected) {
    const chosen = document.querySelector('input[name="groupUnlockMode"]:checked');
    payload.unlock_mode = chosen ? chosen.value : 'timeout';
  }

  try {
    const result = gid
      ? await updateGroup(gid, payload)
      : await createGroup(payload);
    if (result?.error) { showFormError('groupFormError', result.error); return; }
    closeGroupModal();
    showToast(gid ? 'Group saved' : 'Group created');
    await loadAllData();
  } catch { showFormError('groupFormError', 'Something went wrong. Please try again.'); }
});

document.getElementById('openAddGroupBtn').addEventListener('click', openAddGroupModal);
document.getElementById('closeGroupModalBtn').addEventListener('click', closeGroupModal);
document.getElementById('cancelGroupModalBtn').addEventListener('click', closeGroupModal);


// ─── 14. DELETE GROUP ─────────────────────────────────────────────────────────

let pendingDeleteGroupId = null;

function openDeleteGroupModal(gid) {
  pendingDeleteGroupId = gid;
  const g = groups.find(x => x.id === gid);
  document.getElementById('deleteGroupNameLabel').textContent = g?.name ?? '';
  document.getElementById('deleteGroupOverlay').classList.remove('hidden');
}

document.getElementById('confirmDeleteGroupBtn').addEventListener('click', async () => {
  if (!pendingDeleteGroupId) return;
  await deleteGroupById(pendingDeleteGroupId);
  if (activeGroup === pendingDeleteGroupId) activeGroup = 'all';
  pendingDeleteGroupId = null;
  document.getElementById('deleteGroupOverlay').classList.add('hidden');
  showToast('Group deleted');
  await loadAllData();
});
document.getElementById('cancelDeleteGroupBtn').addEventListener('click', () =>
  document.getElementById('deleteGroupOverlay').classList.add('hidden'));


// ─── 15. BULK ACTIONS ─────────────────────────────────────────────────────────

let bulkModeActive = false;

// Anchor for shift-click range selection. Stored as a link ID (not a DOM
// node) because entering bulk mode and other state changes re-render the
// grid — a held DOM reference would become detached and the range walk
// would silently find nothing.
let lastClickedLinkId = null;

/**
 * Marks every visible link-card-wrap between two link IDs as `selected`,
 * inclusive in either order. Operates on the current DOM so it reflects
 * exactly what the user sees (filters, sections, search).
 */
function selectRangeBetween(fromId, toId) {
  const wraps = Array.from(document.querySelectorAll('#linksGrid .link-card-wrap'));
  const fi = wraps.findIndex(w => Number(w.dataset.linkId) === fromId);
  const ti = wraps.findIndex(w => Number(w.dataset.linkId) === toId);
  if (fi < 0 || ti < 0) return;
  const [lo, hi] = fi <= ti ? [fi, ti] : [ti, fi];
  for (let i = lo; i <= hi; i++) wraps[i].classList.add('selected');
  updateBulkBar();
}

// ─── Long-press to enter bulk mode (iOS-style) ────────────────────────────────

const LONG_PRESS_MS         = 450;
const LONG_PRESS_CANCEL_PX  = 10;   // movement that aborts the press (scroll intent)
let   longPressTimer        = null;
let   longPressActiveWrap   = null;
let   longPressJustFired    = false; // suppresses the click that follows a successful press

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (longPressActiveWrap) {
    longPressActiveWrap.classList.remove('long-pressing');
    longPressActiveWrap = null;
  }
}

/**
 * Wires pointer events on a card so that a sustained press enters bulk mode
 * and selects the card. Re-selects on the new wrap after the re-render.
 */
function setupLongPress(wrap, linkId) {
  let startX = 0, startY = 0;

  wrap.addEventListener('pointerdown', e => {
    // Don't trigger when already in bulk mode (taps already select).
    if (bulkModeActive) return;
    // Skip when the press lands on a real interactive child.
    if (e.target.closest('.link-actions, .link-url, a, button')) return;
    // Right-click / middle-click pass through.
    if (e.button && e.button !== 0) return;

    cancelLongPress();
    longPressActiveWrap = wrap;
    startX = e.clientX; startY = e.clientY;
    wrap.classList.add('long-pressing');

    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      wrap.classList.remove('long-pressing');
      longPressJustFired = true;

      // Light haptic tap on supported devices (mobile mostly).
      if (typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(30); } catch {}
      }

      // Enter bulk mode (this re-renders the grid; the wrap reference becomes stale)
      if (!bulkModeActive) enterBulkMode();

      // Select the freshly-rendered card and refresh the bulk bar. Also pin
      // it as the shift-click anchor so the user can shift-tap further cards
      // immediately without a preliminary single click.
      const freshWrap = document.querySelector(`.link-card-wrap[data-link-id="${linkId}"]`);
      if (freshWrap) {
        freshWrap.classList.add('selected');
        lastClickedLinkId = linkId;
        updateBulkBar();
      }

      // Release the click-suppression flag after the synthetic tap settles.
      setTimeout(() => { longPressJustFired = false; }, 350);
    }, LONG_PRESS_MS);
  });

  wrap.addEventListener('pointermove', e => {
    if (!longPressTimer) return;
    if (Math.abs(e.clientX - startX) > LONG_PRESS_CANCEL_PX ||
        Math.abs(e.clientY - startY) > LONG_PRESS_CANCEL_PX) {
      cancelLongPress();
    }
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt =>
    wrap.addEventListener(evt, cancelLongPress));
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll('.link-card-wrap.selected'))
    .map(w => Number(w.dataset.linkId));
}

function updateBulkBar() {
  const count = getSelectedIds().length;
  document.getElementById('bulkCount').textContent = `${count} selected`;
  document.getElementById('bulkBar').classList.toggle('hidden', count === 0);

  // Flip the Select-all button between "select all" and "clear" so a second
  // press is unambiguous.
  const selectAllBtn = document.getElementById('bulkSelectAllBtn');
  if (selectAllBtn) {
    const total = document.querySelectorAll('#linksGrid .link-card-wrap').length;
    const allSelected = total > 0 && count === total;
    selectAllBtn.textContent = allSelected ? 'Clear selection' : 'Select all';
  }
}

function refreshBulkGroupDropdown() {
  document.getElementById('bulkGroupSelect').innerHTML =
    '<option value="">Move to group…</option>' +
    '<option value="none">Remove from group</option>' +
    groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
}

function enterBulkMode() {
  bulkModeActive = true;
  document.getElementById('bulkSelectBtn').textContent = 'Done';
  document.getElementById('linksGrid').classList.add('bulk-mode');
  renderLinks();
}

function exitBulkMode() {
  bulkModeActive = false;
  lastClickedLinkId = null;
  document.getElementById('bulkSelectBtn').textContent = 'Select';
  document.getElementById('bulkBar').classList.add('hidden');
  document.getElementById('linksGrid').classList.remove('bulk-mode');
  renderLinks();
}

document.getElementById('bulkSelectBtn').addEventListener('click', () =>
  bulkModeActive ? exitBulkMode() : enterBulkMode());

document.getElementById('bulkCancelBtn').addEventListener('click', exitBulkMode);

/**
 * Selects every currently-visible link card. Doubles as a toggle: clicking
 * again when everything's already selected clears the selection. The button's
 * label flips to "Clear selection" while everything is selected to make the
 * second click obvious.
 */
function toggleSelectAllVisible() {
  if (!bulkModeActive) enterBulkMode();
  const wraps = Array.from(document.querySelectorAll('#linksGrid .link-card-wrap'));
  if (!wraps.length) return;
  const allSelected = wraps.every(w => w.classList.contains('selected'));
  if (allSelected) {
    wraps.forEach(w => w.classList.remove('selected'));
    lastClickedLinkId = null;
  } else {
    wraps.forEach(w => w.classList.add('selected'));
    // Anchor on the first card so a follow-up shift+click contracts the range.
    lastClickedLinkId = Number(wraps[0].dataset.linkId);
  }
  updateBulkBar();
}

document.getElementById('bulkSelectAllBtn').addEventListener('click', toggleSelectAllVisible);

// Cmd/Ctrl + A while in bulk mode also selects all visible — same shortcut as
// every other "list of items" UI on the platform.
document.addEventListener('keydown', e => {
  if (!bulkModeActive) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    // Don't hijack the shortcut when the user is typing in an input/textarea.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleSelectAllVisible();
  }
});

document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
  const ids = getSelectedIds(); if (!ids.length) return;
  const ok = await showConfirm({
    title:       'Delete Links',
    message:     `Delete ${ids.length} link${ids.length !== 1 ? 's' : ''}? This cannot be undone.`,
    confirmText: `Delete ${ids.length}`,
  });
  if (!ok) return;
  await bulkDeleteLinks(ids);
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} deleted`);
  exitBulkMode(); await loadAllData();
});

/**
 * Refreshes the bulk-bar's section dropdown based on the chosen group.
 * Shows top-level sections + their subsections with a "↳" indent — same
 * format the link form uses, so the layout reads identically.
 */
function refreshBulkSectionDropdown() {
  const groupVal = document.getElementById('bulkGroupSelect').value;
  const sectionSel = document.getElementById('bulkSectionSelect');
  if (!groupVal || groupVal === 'none') {
    sectionSel.classList.add('hidden');
    sectionSel.innerHTML = '<option value="">No section</option>';
    return;
  }
  const group = groups.find(g => g.id === Number(groupVal));
  if (!group || !(group.sections || []).length) {
    sectionSel.classList.add('hidden');
    sectionSel.innerHTML = '<option value="">No section</option>';
    return;
  }
  const opts = group.sections.flatMap(s => {
    const top = `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
    const subs = (s.subsections || []).map(sub =>
      `<option value="${sub.id}">      ↳ ${escapeHtml(sub.name)}</option>`);
    return [top, ...subs];
  }).join('');
  sectionSel.innerHTML = `<option value="">No section</option>${opts}`;
  sectionSel.classList.remove('hidden');
}

document.getElementById('bulkGroupSelect').addEventListener('change', refreshBulkSectionDropdown);

document.getElementById('bulkMoveBtn').addEventListener('click', async () => {
  const ids        = getSelectedIds();
  const groupVal   = document.getElementById('bulkGroupSelect').value;
  const sectionVal = document.getElementById('bulkSectionSelect').value;
  if (!ids.length || !groupVal) return;

  // Build the assignments array sent to PUT /api/links/:id — same shape as
  // the link form. "none" empties the membership list; otherwise we pin every
  // selected link to the chosen (group, section) leaf.
  const sectionId = sectionVal ? Number(sectionVal) : null;
  const assignments = groupVal === 'none'
    ? []
    : [{ group_id: Number(groupVal), section_id: sectionId }];

  await Promise.all(ids.map(id => {
    const link = links.find(l => l.id === id); if (!link) return;
    const fd = new FormData();
    fd.append('name',         link.name);
    fd.append('url',          link.url);
    fd.append('description',  link.description || '');
    fd.append('groups',       JSON.stringify(assignments));
    fd.append('remove_image', 'false');
    return updateLink(id, fd);
  }));

  // Friendly toast: name what they were moved into for confidence.
  let where = 'group';
  if (groupVal === 'none') {
    where = 'no group';
  } else {
    const g = groups.find(x => x.id === Number(groupVal));
    where = g ? g.name : 'group';
    if (sectionId && g) {
      const flat = (g.sections || []).flatMap(s => [s, ...(s.subsections || [])]);
      const s = flat.find(x => x.id === sectionId);
      if (s) where += ` › ${s.name}`;
    }
  }
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} moved to ${where}`);
  exitBulkMode(); await loadAllData();
});

/** Sets visibility on every selected link in parallel, then refreshes. */
async function bulkSetVisibility(hidden) {
  const ids = getSelectedIds();
  if (!ids.length) return;
  await Promise.all(ids.map(id => setLinkVisibility(id, hidden)));
  const label = hidden ? 'hidden' : 'shown';
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} ${label}`);
  exitBulkMode();
  await loadAllData();
}

document.getElementById('bulkHideBtn').addEventListener('click', () => bulkSetVisibility(true));
document.getElementById('bulkShowBtn').addEventListener('click', () => bulkSetVisibility(false));


// ─── 16. DRAG TO REORDER ──────────────────────────────────────────────────────

let draggedLinkId = null;

function enableLinkDrag(card, linkId) {
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', e => {
    if (bulkModeActive || sortOrder !== 'position') { e.preventDefault(); return; }
    draggedLinkId = linkId; card.classList.add('dragging');
    document.body.classList.add('is-link-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.link-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.drag-over-link').forEach(el => el.classList.remove('drag-over-link'));
    document.body.classList.remove('is-link-dragging');
    draggedLinkId = null;
  });
  card.addEventListener('dragover', e => {
    e.preventDefault(); if (draggedLinkId !== linkId) card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); card.classList.remove('drag-over');
    if (!draggedLinkId || draggedLinkId === linkId) return;
    const fi = links.findIndex(l => l.id === draggedLinkId);
    const ti = links.findIndex(l => l.id === linkId);
    if (fi === -1 || ti === -1) return;
    const [m] = links.splice(fi, 1); links.splice(ti, 0, m);
    renderLinks(); reorderLinksApi(links.map(l => l.id));
  });
}

/**
 * Updates the group/section assignment of a single link without touching its
 * other memberships. Used by drag-to-section in the sidebar.
 *
 *  - Existing memberships in OTHER groups are kept as-is.
 *  - The membership for `groupId` is replaced (added if not present) with
 *    `sectionId` as the leaf section. Pass null to clear the section
 *    (link sits at the top level of that group).
 */
async function moveLinkIntoSection(linkId, groupId, sectionId) {
  const link = links.find(l => l.id === linkId);
  if (!link) return;

  const others = (link.groups || []).filter(g => g.id !== groupId);
  const assignments = [
    ...others.map(g => ({ group_id: g.id, section_id: g.section_id ?? null })),
    { group_id: groupId, section_id: sectionId },
  ];

  const fd = new FormData();
  fd.append('name',         link.name);
  fd.append('url',          link.url);
  fd.append('description',  link.description || '');
  fd.append('groups',       JSON.stringify(assignments));
  fd.append('remove_image', 'false');

  try {
    await updateLink(linkId, fd);
    // Build a friendly destination string for the toast.
    const targetGroup = groups.find(g => g.id === groupId);
    let where = targetGroup?.name || 'group';
    if (sectionId && targetGroup) {
      const flat = (targetGroup.sections || []).flatMap(s => [s, ...(s.subsections || [])]);
      const sec = flat.find(x => x.id === sectionId);
      if (sec) where += ` › ${sec.name}`;
    }
    showToast(`"${link.name}" moved to ${where}`);
    await loadAllData();
  } catch {
    showToast('Could not move link', 'error');
  }
}


// ─── 17. IMPORT/EXPORT ────────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', async () => {
  const data  = await exportLinksApi();
  const json  = JSON.stringify(data, null, 2);
  const blob  = new Blob([json], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = `linkpage-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exported ${data.links.length} links`);
});

document.getElementById('importBtn').addEventListener('click', () =>
  document.getElementById('importFileInput').click());

document.getElementById('importFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { showToast('Invalid JSON file', 'error'); e.target.value = ''; return; }

  if (!Array.isArray(data?.links)) {
    showToast('File must contain a "links" array', 'error'); e.target.value = ''; return;
  }

  const groupCount = Array.isArray(data.groups) ? data.groups.length : 0;
  const linkCount  = data.links.length;

  const ok = await showConfirm({
    title: 'Import Links',
    message:
      `Add ${linkCount} link${linkCount !== 1 ? 's' : ''}` +
      (groupCount ? ` and ${groupCount} group${groupCount !== 1 ? 's' : ''}` : '') +
      ` to your existing data? Items already present (by URL or file path) will be skipped.`,
    confirmText: 'Import',
    danger:      false,
  });
  if (!ok) { e.target.value = ''; return; }

  // Pass the full payload through — server handles groups, sections, and
  // links idempotently (creates only what's missing).
  const result = await importLinksApi({
    version: data.version,
    groups:  data.groups,
    links:   data.links,
  });

  const parts = [];
  if (result.imported)          parts.push(`${result.imported} link${result.imported !== 1 ? 's' : ''}`);
  if (result.groups_created)    parts.push(`${result.groups_created} group${result.groups_created !== 1 ? 's' : ''}`);
  if (result.sections_created)  parts.push(`${result.sections_created} section${result.sections_created !== 1 ? 's' : ''}`);
  const skipNote = result.skipped ? ` · ${result.skipped} already existed` : '';
  const errNote  = result.errors?.length ? ` · ${result.errors.length} invalid` : '';
  const summary  = parts.length ? `Imported ${parts.join(', ')}` : 'Nothing to import';
  showToast(summary + skipNote + errNote,
    result.errors?.length ? 'info' : 'success');

  e.target.value = ''; await loadAllData();
});


// ─── 18. SORT ─────────────────────────────────────────────────────────────────

document.getElementById('sortSelect').addEventListener('change', e => {
  sortOrder = e.target.value;
  renderLinks(true);
});


// ─── 19. SIDEBAR TOGGLE ───────────────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');

function toggleSidebar() {
  const mobile = window.innerWidth <= 720;
  if (mobile) { sidebar.classList.toggle('open'); }
  else {
    sidebar.classList.toggle('collapsed');
    document.getElementById('mainContent').style.marginLeft =
      sidebar.classList.contains('collapsed') ? '0' : '';
  }
}

document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
document.addEventListener('click', e => {
  if (window.innerWidth > 720) return;
  if (!sidebar.classList.contains('open')) return;
  if (!sidebar.contains(e.target) && !document.getElementById('sidebarToggle').contains(e.target))
    sidebar.classList.remove('open');
});


// ─── 20. NAV & SEARCH ────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
  activeGroup   = btn.dataset.group;
  activeSection = null;
  renderSidebar(); renderLinks(true);
}));

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim(); renderLinks();
});


// ─── 20.4. UPDATE CHECK ──────────────────────────────────────────────────────
//
// Surfaces newer releases from GitHub. The server caches the response so the
// admin can call /api/version cheaply. Pass `force: true` to bypass that cache.
// Two surfaces consume it:
//   - the small dot on the sidebar Changelog pill (auto-fired on load)
//   - the explicit "Check for updates" modal (user clicks the button)

let lastVersionInfo = null;

async function fetchVersionInfo({ force = false } = {}) {
  const url = `/api/version${force ? '?refresh=1' : ''}`;
  const info = await apiJson(url).catch(() => null);
  if (info) {
    lastVersionInfo = info;
    syncCurrentVersionLabels(info.current);
  }
  return info;
}

async function checkForUpdates() {
  const info = await fetchVersionInfo();
  if (!info) return;
  applyVersionInfo(info);
}

/**
 * Keeps every place that displays the current version (sidebar pill, settings
 * About row, etc.) in sync with the canonical value from the server.
 */
function syncCurrentVersionLabels(current) {
  const pill = document.getElementById('changelogVersion');
  if (pill?.firstChild) pill.firstChild.nodeValue = ` v${current} `;
  const inline = document.getElementById('settingsCurrentVersion');
  if (inline) inline.textContent = `v${current}`;
}

function applyVersionInfo(info) {
  const pill   = document.getElementById('changelogVersion');
  const dot    = document.getElementById('changelogUpdateDot');
  const banner = document.getElementById('changelogUpdate');
  if (!pill || !banner) return;

  // Keep the static pill text in sync with package.json, regardless of update
  // status. (If a user edits the HTML and the version bumps, this still reads
  // correctly.)
  pill.firstChild && (pill.firstChild.nodeValue = ` v${info.current} `);

  if (!info.update_available || !Array.isArray(info.newer_releases) || !info.newer_releases.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    dot?.classList.add('hidden');
    return;
  }

  dot?.classList.remove('hidden');
  const releasesHtml = info.newer_releases.map(r => {
    const tag       = String(r.tag || '').replace(/^v/, '');
    const date      = r.published_at
      ? new Date(r.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const bodyHtml  = renderReleaseBody(r.body);
    const linkHref  = r.html_url || info.releases_url;
    return `
      <article class="changelog-update-release">
        <header class="changelog-update-release-head">
          <span class="changelog-update-tag">v${escapeHtml(tag)}</span>
          ${date ? `<span class="changelog-update-date">${escapeHtml(date)}</span>` : ''}
          <a class="changelog-update-link" href="${escapeHtml(linkHref)}"
             target="_blank" rel="noopener noreferrer">View on GitHub →</a>
        </header>
        <div class="changelog-update-body">${bodyHtml}</div>
      </article>
    `;
  }).join('');

  banner.innerHTML = `
    <div class="changelog-update-head">
      <span class="changelog-update-pulse"></span>
      <span class="changelog-update-title">Update available</span>
      <span class="changelog-update-sub">v${escapeHtml(info.current)} → v${escapeHtml(info.latest)}</span>
    </div>
    ${releasesHtml}
  `;
  banner.classList.remove('hidden');
}

/**
 * Minimal GitHub-flavoured-markdown renderer for release notes.
 * Handles bold, bullet lists, and paragraph breaks. Everything else is escaped.
 */
function renderReleaseBody(text) {
  if (!text) return '<em class="changelog-update-empty">No release notes provided.</em>';
  const safe  = escapeHtml(text.trim());
  // Bold: **text**
  const bold  = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = bold.split(/\r?\n/);

  let html = '';
  let buffer = [];
  const flushList = () => {
    if (buffer.length) {
      html += `<ul class="changelog-update-list">${buffer.map(b => `<li>${b}</li>`).join('')}</ul>`;
      buffer = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    const m = line.match(/^[-*]\s+(.+)$/);
    if (m) {
      buffer.push(m[1]);
    } else {
      flushList();
      html += `<p>${line}</p>`;
    }
  }
  flushList();
  return html || '<em class="changelog-update-empty">No release notes provided.</em>';
}

// ─── Update-check popup ──────────────────────────────────────────────────────

function openVersionModal() {
  const overlay = document.getElementById('versionOverlay');
  const body    = document.getElementById('versionBody');
  body.innerHTML = `
    <div class="version-loading">
      <div class="version-spinner" aria-hidden="true"></div>
      <span>Checking for updates…</span>
    </div>`;
  overlay.classList.remove('hidden');

  fetchVersionInfo({ force: true })
    .then(info => {
      if (!info) return renderVersionError();
      // Keep the sidebar dot and About row in sync with whatever the fresh
      // check returned, so closing the popup doesn't leave stale UI behind.
      applyVersionInfo(info);
      renderVersionPopup(info);
    })
    .catch(renderVersionError);
}

function closeVersionModal() {
  document.getElementById('versionOverlay').classList.add('hidden');
}

function renderVersionError() {
  document.getElementById('versionBody').innerHTML = `
    <div class="version-status version-status-error">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8"  x2="12" y2="13"/>
        <line x1="12" y1="16" x2="12" y2="16"/>
      </svg>
      <div>
        <div class="version-status-title">Couldn't reach GitHub</div>
        <div class="version-status-sub">Check your internet connection and try again in a moment.</div>
      </div>
    </div>`;
}

function renderVersionPopup(info) {
  const body    = document.getElementById('versionBody');
  const ghLink  = document.getElementById('versionGithubLink');
  if (ghLink && info.releases_url) ghLink.href = info.releases_url;

  const current = escapeHtml(info.current || '?');
  const latest  = info.latest ? escapeHtml(info.latest) : '—';

  if (info.error || !info.latest) {
    body.innerHTML = `
      <div class="version-summary">
        <div class="version-summary-row">
          <span class="version-summary-label">Current</span>
          <span class="version-summary-value">v${current}</span>
        </div>
        <div class="version-summary-row">
          <span class="version-summary-label">Latest</span>
          <span class="version-summary-value version-summary-muted">unavailable</span>
        </div>
      </div>
      <div class="version-status version-status-info">
        <span>Couldn't fetch release info from GitHub. Try again later.</span>
      </div>`;
    return;
  }

  const isUpdate = !!info.update_available;
  const statusHtml = isUpdate
    ? `
      <div class="version-status version-status-update">
        <span class="version-status-dot"></span>
        <div>
          <div class="version-status-title">Update available</div>
          <div class="version-status-sub">A newer release is published on GitHub.</div>
        </div>
      </div>`
    : `
      <div class="version-status version-status-ok">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div>
          <div class="version-status-title">You're up to date</div>
          <div class="version-status-sub">No newer releases on GitHub.</div>
        </div>
      </div>`;

  const releasesHtml = (info.newer_releases || []).map(r => {
    const tag      = String(r.tag || '').replace(/^v/, '');
    const date     = r.published_at
      ? new Date(r.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const linkHref = r.html_url || info.releases_url;
    return `
      <article class="version-release">
        <header class="version-release-head">
          <span class="version-release-tag">v${escapeHtml(tag)}</span>
          ${date ? `<span class="version-release-date">${escapeHtml(date)}</span>` : ''}
          <a class="version-release-link" href="${escapeHtml(linkHref)}"
             target="_blank" rel="noopener noreferrer">Details →</a>
        </header>
        <div class="version-release-body">${renderReleaseBody(r.body)}</div>
      </article>`;
  }).join('');

  body.innerHTML = `
    <div class="version-summary">
      <div class="version-summary-row">
        <span class="version-summary-label">Current</span>
        <span class="version-summary-value">v${current}</span>
      </div>
      <div class="version-summary-row">
        <span class="version-summary-label">Latest</span>
        <span class="version-summary-value ${isUpdate ? 'version-summary-update' : ''}">v${latest}</span>
      </div>
    </div>
    ${statusHtml}
    ${releasesHtml ? `<div class="version-changes">
      <div class="version-changes-title">What's new</div>
      ${releasesHtml}
    </div>` : ''}
  `;
}

document.getElementById('checkForUpdatesBtn').addEventListener('click', openVersionModal);
document.getElementById('closeVersionBtn').addEventListener('click', closeVersionModal);
document.getElementById('versionCloseBtn').addEventListener('click', closeVersionModal);


// ─── 20.6. FILE EDITOR ───────────────────────────────────────────────────────
//
// In-place editor for text-flavoured file attachments (.html, .json, .txt …).
// Loads the bytes from /api/links/:id/file, lets the admin edit, saves back
// to the same path. /uploads serves no-cache so the public side sees the new
// bytes on the very next click — no rename, no cache busting needed.

const FILE_EDITOR_EXTS = new Set([
  '.htm', '.html', '.xml', '.json', '.txt', '.md', '.log', '.csv', '.svg',
]);

function fileExtension(name) {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isFileEditable(link) {
  return !!(link?.file_path && FILE_EDITOR_EXTS.has(fileExtension(link.file_name || link.file_path)));
}

let fileEditorLink     = null;     // link object being edited
let fileEditorOriginal = '';       // last-saved text — Revert restores it
let fileEditorDirty    = false;
let fileEditorLanguage = 'text';   // 'html' | 'xml' | 'json' | 'md' | 'csv' | 'text'

function languageForFile(name) {
  const ext = fileExtension(name);
  switch (ext) {
    case '.html':
    case '.htm':  return 'html';
    case '.xml':
    case '.svg':  return 'xml';
    case '.json': return 'json';
    case '.md':   return 'md';
    case '.csv':  return 'csv';
    default:      return 'text';
  }
}

// ─── Minimal syntax highlighter ───────────────────────────────────────────
//
// Walks the source once per known language, collecting non-overlapping spans
// and emitting safely-escaped HTML with <span class="tok-…"> wrappers. Good
// enough for HTML/XML/JSON/CSV/Markdown viewing inside the editor — not a
// full Prism/highlight.js drop-in.

const HIGHLIGHT_PATTERNS = {
  json: [
    { re: /"(?:[^"\\]|\\.)*"(?=\s*:)/g,         cls: 'tok-key' },
    { re: /"(?:[^"\\]|\\.)*"/g,                 cls: 'tok-str' },
    { re: /\b(?:true|false|null)\b/g,           cls: 'tok-bool' },
    { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, cls: 'tok-num' },
    { re: /[{}\[\],:]/g,                        cls: 'tok-punct' },
  ],
  md: [
    { re: /^#{1,6} .+$/gm,                      cls: 'tok-heading' },
    { re: /`[^`\n]+`/g,                         cls: 'tok-code' },
    { re: /\*\*([^*\n]+)\*\*/g,                 cls: 'tok-bold' },
    { re: /(?:^|\s)_([^_\n]+)_/g,               cls: 'tok-em' },
    { re: /\[[^\]\n]+\]\([^)\n]+\)/g,           cls: 'tok-link' },
    { re: /^\s*[-*+] /gm,                       cls: 'tok-bullet' },
  ],
  csv: [
    { re: /^[^,\n]+/gm,                         cls: 'tok-key' },
    { re: /,/g,                                 cls: 'tok-punct' },
  ],
  // HTML/XML need a different approach (matched tag blocks, then attributes
  // inside). Handled in highlightMarkup() below.
};

function highlightCode(code, language) {
  if (!code) return '';
  if (language === 'html' || language === 'xml') return highlightMarkup(code);
  const patterns = HIGHLIGHT_PATTERNS[language];
  if (!patterns) return escapeHtml(code);
  return applyPatterns(code, patterns);
}

function applyPatterns(code, patterns) {
  // Collect all candidate matches across every pattern.
  const matches = [];
  for (const { re, cls } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      // Some patterns include leading whitespace/anchors (e.g. "(?:^|\s)" in
      // markdown em). Trim that off so the span only colours the meaningful
      // run.
      const ws = m[0].match(/^\s*/)[0].length;
      const start = m.index + (cls === 'tok-em' || cls === 'tok-bullet' ? ws : 0);
      matches.push({ start, end: m.index + m[0].length, cls });
      if (m[0].length === 0) re.lastIndex++;  // guard against zero-width
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Drop overlaps — keep first by source order; subsequent matches inside
  // the same span are skipped.
  let lastEnd = 0;
  const chosen = [];
  for (const m of matches) {
    if (m.start >= lastEnd) {
      chosen.push(m);
      lastEnd = m.end;
    }
  }

  let out = '';
  let pos = 0;
  for (const m of chosen) {
    if (m.start > pos) out += escapeHtml(code.slice(pos, m.start));
    out += `<span class="${m.cls}">${escapeHtml(code.slice(m.start, m.end))}</span>`;
    pos = m.end;
  }
  if (pos < code.length) out += escapeHtml(code.slice(pos));
  return out;
}

/**
 * Tag-aware HTML/XML highlighter: walks the source linearly, tagging each
 * tag, attribute name, attribute value, comment and text run separately. Plain
 * regex passes can't handle these because attribute matches need to be
 * constrained to inside-a-tag context.
 */
function highlightMarkup(code) {
  const COMMENT = /<!--[\s\S]*?-->/g;
  const TAG     = /<\/?[A-Za-z][^>]*\/?>/g;
  // Build a list of "outer" blocks first (comments + tags), then text in between.
  const blocks = [];
  let m;
  COMMENT.lastIndex = 0;
  while ((m = COMMENT.exec(code)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, kind: 'comment', raw: m[0] });
  }
  TAG.lastIndex = 0;
  while ((m = TAG.exec(code)) !== null) {
    // Skip tags that fall inside a comment we already captured.
    if (blocks.some(b => b.kind === 'comment' && m.index >= b.start && m.index < b.end)) continue;
    blocks.push({ start: m.index, end: m.index + m[0].length, kind: 'tag', raw: m[0] });
  }
  blocks.sort((a, b) => a.start - b.start);

  let out = '';
  let pos = 0;
  for (const b of blocks) {
    if (b.start > pos) out += escapeHtml(code.slice(pos, b.start));
    if (b.kind === 'comment') {
      out += `<span class="tok-comment">${escapeHtml(b.raw)}</span>`;
    } else {
      out += colourTag(b.raw);
    }
    pos = b.end;
  }
  if (pos < code.length) out += escapeHtml(code.slice(pos));
  return out;
}

function colourTag(tag) {
  // Split out the opening "<" / "</" / closing ">"/"/>" plus the tag name
  // and any attributes. We escape every literal piece before emitting.
  const head = tag.match(/^<\/?[A-Za-z][\w:-]*/);
  if (!head) return escapeHtml(tag);
  const headLen = head[0].length;
  const headPart = head[0];                            // "<tag" or "</tag"
  const tail     = tag.slice(headLen, -1);             // attrs body
  const close    = tag.endsWith('/>') ? '/>' : '>';
  const tailBody = tag.endsWith('/>') ? tail.slice(0, -1) : tail;

  let attrs = '';
  // attr-name = "value" | 'value' | bare
  const re = /([A-Za-z_:][\w:.\-]*)(\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s>]+)?|\s+/g;
  let last = 0;
  let am;
  while ((am = re.exec(tailBody)) !== null) {
    if (am[0].trim() === '') { attrs += escapeHtml(am[0]); last = re.lastIndex; continue; }
    const name  = am[1];
    const eq    = am[2] || '';
    const value = am[3] || '';
    attrs += `<span class="tok-attr">${escapeHtml(name)}</span>`;
    if (eq)    attrs += escapeHtml(eq);
    if (value) attrs += `<span class="tok-str">${escapeHtml(value)}</span>`;
    last = re.lastIndex;
  }
  if (last < tailBody.length) attrs += escapeHtml(tailBody.slice(last));

  return `<span class="tok-tag">${escapeHtml(headPart)}</span>${attrs}<span class="tok-tag">${escapeHtml(close)}</span>`;
}

// ─── Layered editor rendering ─────────────────────────────────────────────

function refreshFileEditorLayers() {
  const ta      = document.getElementById('fileEditorTextarea');
  const code    = document.getElementById('fileEditorHighlightCode');
  const gutter  = document.getElementById('fileEditorGutter');
  if (!ta || !code) return;

  const text = ta.value;
  // Trailing newline so the highlight layer ends one line deep — keeps the
  // last line visible when the user is typing at the end.
  code.innerHTML = highlightCode(text, fileEditorLanguage) + '\n';

  const lines = text.split('\n').length;
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function syncFileEditorScroll() {
  const ta     = document.getElementById('fileEditorTextarea');
  const hl     = document.getElementById('fileEditorHighlight');
  const gutter = document.getElementById('fileEditorGutter');
  const ov     = document.getElementById('fileEditorSearchOverlay');
  if (!ta || !hl || !gutter) return;
  // The highlight + overlay match the textarea pixel-for-pixel by scrolling
  // their own viewports; the gutter only moves vertically.
  hl.scrollTop      = ta.scrollTop;
  hl.scrollLeft     = ta.scrollLeft;
  gutter.scrollTop  = ta.scrollTop;
  if (ov) {
    ov.scrollTop  = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  }
}

// ─── Find bar (Ctrl/Cmd+F) ─────────────────────────────────────────────────

let fileEditorSearchMatches = [];     // [{ start, end }, ...]
let fileEditorSearchIndex   = -1;

function openFileEditorSearch() {
  const bar   = document.getElementById('fileEditorSearch');
  const input = document.getElementById('fileEditorSearchInput');
  const ta    = document.getElementById('fileEditorTextarea');
  bar.classList.remove('hidden');

  // Seed the input with the textarea's current selection if it's short — same
  // ergonomic that most editors use: select a word, hit Ctrl+F, find it.
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes('\n') && sel.length <= 200) input.value = sel;

  input.focus();
  input.select();
  recomputeFileEditorSearch();
}

function closeFileEditorSearch() {
  const bar = document.getElementById('fileEditorSearch');
  if (bar.classList.contains('hidden')) return;
  bar.classList.add('hidden');
  fileEditorSearchMatches = [];
  fileEditorSearchIndex   = -1;
  renderFileEditorSearchOverlay();    // wipe the marks
  document.getElementById('fileEditorTextarea').focus({ preventScroll: true });
}

function findAllMatches(haystack, needle) {
  if (!needle) return [];
  const hay = haystack.toLowerCase();
  const ndl = needle.toLowerCase();
  const out = [];
  let pos = 0;
  while ((pos = hay.indexOf(ndl, pos)) !== -1) {
    out.push({ start: pos, end: pos + ndl.length });
    pos += ndl.length || 1;     // never loop on empty needle
  }
  return out;
}

function recomputeFileEditorSearch() {
  const input  = document.getElementById('fileEditorSearchInput');
  const count  = document.getElementById('fileEditorSearchCount');
  const prev   = document.getElementById('fileEditorSearchPrev');
  const next   = document.getElementById('fileEditorSearchNext');
  const ta     = document.getElementById('fileEditorTextarea');
  const needle = input.value;

  fileEditorSearchMatches = findAllMatches(ta.value, needle);

  if (!needle) {
    count.textContent = '';
    count.classList.remove('is-empty');
    prev.disabled = true;
    next.disabled = true;
    fileEditorSearchIndex = -1;
    renderFileEditorSearchOverlay();
    return;
  }
  if (!fileEditorSearchMatches.length) {
    count.textContent = 'No results';
    count.classList.add('is-empty');
    prev.disabled = true;
    next.disabled = true;
    fileEditorSearchIndex = -1;
    renderFileEditorSearchOverlay();
    return;
  }
  count.classList.remove('is-empty');
  fileEditorSearchIndex = 0;
  prev.disabled = false;
  next.disabled = false;
  jumpToFileEditorMatch();
}

/**
 * Paints all matches onto the overlay <pre>, with the current one styled
 * distinctively. Operates on the textarea's current value so it auto-tracks
 * edits made while the find bar is open.
 */
function renderFileEditorSearchOverlay() {
  const ov = document.getElementById('fileEditorSearchOverlay');
  if (!ov) return;
  if (!fileEditorSearchMatches.length) {
    ov.innerHTML = '';
    return;
  }
  const text = document.getElementById('fileEditorTextarea').value;
  let html = '';
  let pos  = 0;
  for (let i = 0; i < fileEditorSearchMatches.length; i++) {
    const m = fileEditorSearchMatches[i];
    if (m.start > pos) html += escapeHtml(text.slice(pos, m.start));
    const cls = i === fileEditorSearchIndex ? 'search-match is-current' : 'search-match';
    html += `<mark class="${cls}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  if (pos < text.length) html += escapeHtml(text.slice(pos));
  // Trailing newline so the overlay sizes the same as the highlight pre.
  ov.innerHTML = html + '\n';
}

/**
 * Updates the overlay (current-match styling moves), sets the textarea's
 * selection so the cursor will be at the match if/when the user closes the
 * find bar, and scrolls the editor to bring the match into view — all
 * without stealing focus from the search input.
 */
function jumpToFileEditorMatch() {
  if (fileEditorSearchIndex < 0 || !fileEditorSearchMatches[fileEditorSearchIndex]) return;
  const m  = fileEditorSearchMatches[fileEditorSearchIndex];
  const ta = document.getElementById('fileEditorTextarea');

  // Selection survives focus loss (Chrome dims it but it's still set); when
  // the user closes the find bar the cursor will already be at the match.
  ta.setSelectionRange(m.start, m.end);

  // Compute the match's line number and scroll the textarea so the match
  // sits in the middle of the visible area. The mark overlay tracks via
  // syncFileEditorScroll.
  const lineHeight  = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  const linesBefore = ta.value.slice(0, m.start).split('\n').length - 1;
  const targetY     = linesBefore * lineHeight - (ta.clientHeight / 2);
  ta.scrollTop      = Math.max(0, targetY);

  renderFileEditorSearchOverlay();
  syncFileEditorScroll();

  document.getElementById('fileEditorSearchCount').textContent =
    `${fileEditorSearchIndex + 1} / ${fileEditorSearchMatches.length}`;
}

function nextFileEditorMatch() {
  if (!fileEditorSearchMatches.length) return;
  fileEditorSearchIndex = (fileEditorSearchIndex + 1) % fileEditorSearchMatches.length;
  jumpToFileEditorMatch();
}

function prevFileEditorMatch() {
  if (!fileEditorSearchMatches.length) return;
  fileEditorSearchIndex =
    (fileEditorSearchIndex - 1 + fileEditorSearchMatches.length) % fileEditorSearchMatches.length;
  jumpToFileEditorMatch();
}

document.getElementById('fileEditorSearchInput').addEventListener('input', recomputeFileEditorSearch);
document.getElementById('fileEditorSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); e.shiftKey ? prevFileEditorMatch() : nextFileEditorMatch(); }
  if (e.key === 'Escape') { e.preventDefault(); closeFileEditorSearch(); }
});
document.getElementById('fileEditorSearchPrev' ).addEventListener('click', prevFileEditorMatch);
document.getElementById('fileEditorSearchNext' ).addEventListener('click', nextFileEditorMatch);
document.getElementById('fileEditorSearchClose').addEventListener('click', closeFileEditorSearch);


function toggleFileEditorExpanded() {
  const modal = document.querySelector('#fileEditorOverlay .file-editor-modal');
  const btn   = document.getElementById('fileEditorExpandBtn');
  if (!modal) return;
  const next = !modal.classList.contains('is-expanded');
  modal.classList.toggle('is-expanded', next);
  btn.classList.toggle('is-expanded', next);
  btn.title = next ? 'Collapse editor' : 'Expand editor (Esc collapses)';
  // Re-sync once the modal finishes resizing so the highlight tracks.
  setTimeout(syncFileEditorScroll, 220);
}

async function openFileEditor(link) {
  if (!link?.file_path) return;
  fileEditorLink     = link;
  fileEditorOriginal = '';
  fileEditorDirty    = false;
  fileEditorLanguage = languageForFile(link.file_name);

  const overlay  = document.getElementById('fileEditorOverlay');
  const loading  = document.getElementById('fileEditorLoading');
  const pane     = document.getElementById('fileEditorPane');
  const ta       = document.getElementById('fileEditorTextarea');
  const filename = document.getElementById('fileEditorFilename');
  const badge    = document.getElementById('fileEditorBadge');
  const meta     = document.getElementById('fileEditorMeta');
  const status   = document.getElementById('fileEditorStatus');
  const saveBtn  = document.getElementById('saveFileEditorBtn');
  const revert   = document.getElementById('fileEditorRevertBtn');

  filename.textContent = link.file_name || 'file';
  badge.textContent    = fileExtension(link.file_name).replace('.', '') || 'txt';
  meta.textContent     = '—';
  status.textContent   = '';
  saveBtn.disabled     = true;
  revert.disabled      = true;
  pane.classList.add('hidden');
  ta.value             = '';
  loading.classList.remove('hidden');

  overlay.classList.remove('hidden');

  try {
    const data = await apiJson(`/api/links/${link.id}/file`);
    if (data?.error) {
      showFileEditorError(data.error);
      return;
    }
    fileEditorOriginal = data.content || '';
    ta.value           = fileEditorOriginal;
    meta.textContent   = `${formatBytes(data.size)} · ${badge.textContent.toUpperCase()}`;
    loading.classList.add('hidden');
    pane.classList.remove('hidden');
    refreshFileEditorLayers();
    setTimeout(() => {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(0, 0);
      ta.scrollTop  = 0;
      ta.scrollLeft = 0;
      syncFileEditorScroll();
    }, 60);
    updateFileEditorDirtyState();
  } catch {
    showFileEditorError('Could not load the file.');
  }
}

function showFileEditorError(message) {
  const loading = document.getElementById('fileEditorLoading');
  loading.innerHTML = `<span class="file-editor-error-msg">${escapeHtml(message)}</span>`;
}

function closeFileEditor() {
  if (fileEditorDirty) {
    const ok = confirm('You have unsaved changes. Close anyway?');
    if (!ok) return;
  }
  // Drop the expanded mode so the next open starts at standard size.
  document.querySelector('#fileEditorOverlay .file-editor-modal')
          ?.classList.remove('is-expanded');
  document.getElementById('fileEditorExpandBtn')?.classList.remove('is-expanded');
  // Tidy up the find bar so the next open starts fresh.
  document.getElementById('fileEditorSearch')?.classList.add('hidden');
  document.getElementById('fileEditorSearchInput').value = '';
  document.getElementById('fileEditorSearchCount').textContent = '';
  fileEditorSearchMatches = [];
  fileEditorSearchIndex   = -1;
  document.getElementById('fileEditorOverlay').classList.add('hidden');
  fileEditorLink     = null;
  fileEditorOriginal = '';
  fileEditorDirty    = false;
}

function updateFileEditorDirtyState() {
  const ta      = document.getElementById('fileEditorTextarea');
  const status  = document.getElementById('fileEditorStatus');
  const saveBtn = document.getElementById('saveFileEditorBtn');
  const revert  = document.getElementById('fileEditorRevertBtn');
  fileEditorDirty = ta.value !== fileEditorOriginal;
  status.textContent  = fileEditorDirty ? 'Unsaved changes' : 'Saved';
  status.className    = 'file-editor-status' + (fileEditorDirty ? ' is-dirty' : '');
  saveBtn.disabled    = !fileEditorDirty;
  revert.disabled     = !fileEditorDirty;
}

async function saveFileEditor() {
  if (!fileEditorLink) return;
  const ta      = document.getElementById('fileEditorTextarea');
  const saveBtn = document.getElementById('saveFileEditorBtn');
  const status  = document.getElementById('fileEditorStatus');

  const content   = ta.value;
  saveBtn.disabled = true;
  status.textContent = 'Saving…';
  status.className   = 'file-editor-status is-saving';

  try {
    const res = await sendAuthRequest(`/api/links/${fileEditorLink.id}/file`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Save failed');
    }
    const data = await res.json();
    fileEditorOriginal = content;
    document.getElementById('fileEditorMeta').textContent =
      `${formatBytes(data.size)} · ${fileExtension(fileEditorLink.file_name).replace('.', '').toUpperCase() || 'TXT'}`;
    updateFileEditorDirtyState();
    showToast('File saved');
  } catch (err) {
    status.textContent = err.message || 'Save failed';
    status.className   = 'file-editor-status is-error';
    saveBtn.disabled   = false;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

document.getElementById('fileEditorTextarea').addEventListener('input', () => {
  refreshFileEditorLayers();
  updateFileEditorDirtyState();
  // Keep the find bar accurate if the user types while it's open.
  if (!document.getElementById('fileEditorSearch').classList.contains('hidden')) {
    recomputeFileEditorSearch();
  }
});
document.getElementById('fileEditorTextarea').addEventListener('scroll', syncFileEditorScroll);
document.getElementById('fileEditorExpandBtn').addEventListener('click', toggleFileEditorExpanded);

// Esc first collapses an expanded editor, then (on a second press) the global
// overlay-close handler can dismiss the modal. Capture phase so this runs
// before the existing global Esc.
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const expanded = document.querySelector('#fileEditorOverlay:not(.hidden) .file-editor-modal.is-expanded');
  if (expanded) {
    e.stopImmediatePropagation();
    toggleFileEditorExpanded();
  }
}, { capture: true });

// Ctrl/Cmd+F opens the editor's find bar (and suppresses the browser's page
// find, which would be useless here since the code lives inside a textarea).
// Capture phase so we run before browser handling.
window.addEventListener('keydown', e => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const open = document.querySelector('#fileEditorOverlay:not(.hidden)');
  if (!open) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  openFileEditorSearch();
}, { capture: true });
document.getElementById('saveFileEditorBtn').addEventListener('click', saveFileEditor);
document.getElementById('fileEditorRevertBtn').addEventListener('click', () => {
  document.getElementById('fileEditorTextarea').value = fileEditorOriginal;
  refreshFileEditorLayers();
  updateFileEditorDirtyState();
});
document.getElementById('closeFileEditorBtn').addEventListener('click', closeFileEditor);
document.getElementById('cancelFileEditorBtn').addEventListener('click', closeFileEditor);

// Ctrl/Cmd + S inside the editor saves without leaving the keyboard.
document.getElementById('fileEditorTextarea').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!document.getElementById('saveFileEditorBtn').disabled) saveFileEditor();
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    // Insert a 2-space tab rather than yanking focus.
    e.preventDefault();
    const ta = e.target;
    const s = ta.selectionStart, eEnd = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(eEnd);
    ta.selectionStart = ta.selectionEnd = s + 2;
    refreshFileEditorLayers();
    updateFileEditorDirtyState();
  }
});


// ─── 20.7. STOCK ICON PICKER (with color) ────────────────────────────────────
//
// Renders the curated ICON_PRESETS set with a colour-picker, lets the user
// pick one, and feeds the chosen (icon + colour) into the link form as a
// freshly-generated SVG file. It goes through the normal `image` upload path,
// so on save it lands in the icon library and any other link can reuse it.

const ICON_PRESET_DEFAULT_COLOR = '#0071e3';
let iconPresetsQuery        = '';
let iconPresetsColor        = ICON_PRESET_DEFAULT_COLOR;
let iconPresetsSelectedName = null;

function buildPresetSvgString(body, color, { size = 64, strokeWidth = 2 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function openIconPresets() {
  iconPresetsQuery        = '';
  iconPresetsSelectedName = null;
  document.getElementById('iconPresetsSearchInput').value = '';
  document.getElementById('iconPresetsColorInput').value  = iconPresetsColor;

  renderIconPresetsPalette();
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
  document.getElementById('iconPresetsOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('iconPresetsSearchInput').focus(), 60);
}

function closeIconPresets() {
  document.getElementById('iconPresetsOverlay').classList.add('hidden');
}

function renderIconPresetsPalette() {
  const palette = document.getElementById('iconPresetsPalette');
  palette.innerHTML = (window.ICON_PRESET_COLORS || []).map(c => `
    <button type="button" class="icon-presets-swatch ${c === iconPresetsColor ? 'is-active' : ''}"
            data-color="${escapeHtml(c)}"
            style="background:${escapeHtml(c)}"
            aria-label="Use ${escapeHtml(c)}"></button>
  `).join('');
}

function renderIconPresetsGrid() {
  const grid     = document.getElementById('iconPresetsGrid');
  const empty    = document.getElementById('iconPresetsNoResults');
  const count    = document.getElementById('iconPresetsCount');
  const all      = window.ICON_PRESETS || [];
  const q        = iconPresetsQuery.toLowerCase();
  const visible  = q ? all.filter(i =>
                        i.name.toLowerCase().includes(q) ||
                        (i.cat || '').toLowerCase().includes(q))
                     : all;

  count.textContent = `${all.length} icon${all.length === 1 ? '' : 's'}`;

  if (!visible.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group visible icons by category for a tidier layout.
  const byCat = new Map();
  for (const icon of visible) {
    const key = icon.cat || 'Other';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(icon);
  }

  grid.innerHTML = [...byCat.entries()].map(([cat, icons]) => `
    <section class="icon-presets-section">
      <h3 class="icon-presets-section-title">${escapeHtml(cat)}</h3>
      <div class="icon-presets-tiles">
        ${icons.map(i => `
          <button type="button"
                  class="icon-presets-tile ${i.name === iconPresetsSelectedName ? 'is-selected' : ''}"
                  data-name="${escapeHtml(i.name)}"
                  title="${escapeHtml(i.name)}">
            ${buildPresetSvgString(i.body, iconPresetsColor, { size: 28, strokeWidth: 1.8 })}
            <span class="icon-presets-tile-name">${escapeHtml(i.name)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function updateIconPresetsSelectedState() {
  const sel   = document.getElementById('iconPresetsSelected');
  const prev  = document.getElementById('iconPresetsSelectedPreview');
  const label = document.getElementById('iconPresetsSelectedLabel');
  const apply = document.getElementById('applyIconPresetsBtn');

  if (!iconPresetsSelectedName) {
    sel.classList.remove('is-ready');
    prev.innerHTML  = '';
    label.textContent = 'No icon selected';
    apply.disabled  = true;
    return;
  }
  const icon = (window.ICON_PRESETS || []).find(i => i.name === iconPresetsSelectedName);
  if (!icon) return;

  sel.classList.add('is-ready');
  prev.innerHTML    = buildPresetSvgString(icon.body, iconPresetsColor, { size: 22, strokeWidth: 2 });
  label.textContent = icon.name;
  apply.disabled    = false;
}

function applyIconPresetsSelection() {
  if (!iconPresetsSelectedName) return;
  const icon = (window.ICON_PRESETS || []).find(i => i.name === iconPresetsSelectedName);
  if (!icon) return;

  // Render the chosen icon at a larger size for crisp display on link cards,
  // wrap it in a Blob, stuff it into the link form's #inputImage as if the
  // admin had uploaded an SVG themselves — the rest of the submit flow then
  // handles uploading + library auto-registration with no extra plumbing.
  const svgString = buildPresetSvgString(icon.body, iconPresetsColor, { size: 128, strokeWidth: 1.8 });
  const blob      = new Blob([svgString], { type: 'image/svg+xml' });
  const file      = new File([blob], `icon-${icon.name}-${iconPresetsColor.replace('#', '')}.svg`,
                             { type: 'image/svg+xml' });
  const dt = new DataTransfer();
  dt.items.add(file);
  document.getElementById('inputImage').files = dt.files;

  // Wire the preview the same way the upload flow does.
  showCustomIconPreview(`data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`);
  shouldRemoveIcon = false;
  pendingIconId    = null;
  closeIconPresets();
}

// Event wiring
document.getElementById('openIconPresetsBtn').addEventListener('click', openIconPresets);
document.getElementById('closeIconPresetsBtn').addEventListener('click', closeIconPresets);
document.getElementById('cancelIconPresetsBtn').addEventListener('click', closeIconPresets);
document.getElementById('applyIconPresetsBtn').addEventListener('click', applyIconPresetsSelection);

document.getElementById('iconPresetsSearchInput').addEventListener('input', e => {
  iconPresetsQuery = e.target.value.trim();
  renderIconPresetsGrid();
});

document.getElementById('iconPresetsPalette').addEventListener('click', e => {
  const btn = e.target.closest('[data-color]');
  if (!btn) return;
  iconPresetsColor = btn.dataset.color;
  document.getElementById('iconPresetsColorInput').value = iconPresetsColor;
  renderIconPresetsPalette();
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
});

document.getElementById('iconPresetsColorInput').addEventListener('input', e => {
  iconPresetsColor = e.target.value;
  renderIconPresetsPalette();
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
});

document.getElementById('iconPresetsGrid').addEventListener('click', e => {
  const tile = e.target.closest('[data-name]');
  if (!tile) return;
  iconPresetsSelectedName = tile.dataset.name;
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
});


// ─── 20.5. ICON LIBRARY ──────────────────────────────────────────────────────

let iconLibraryItems    = [];
let iconLibraryQuery    = '';
let iconLibraryPicker   = false;  // true when opened from the link modal
let iconSelectMode      = false;  // bulk-select mode (manage view)
let iconSelectedIds     = new Set();
let iconLastClickedId   = null;   // anchor for shift-click range selection

async function fetchIcons() {
  return apiJson('/api/icons').catch(() => []);
}

async function uploadIcon(file) {
  const fd = new FormData(); fd.append('image', file);
  return apiJson('/api/icons', { method: 'POST', body: fd });
}

async function deleteIconById(id) {
  return sendAuthRequest(`/api/icons/${id}`, { method: 'DELETE' });
}

async function openIconLibrary({ pickerMode = false } = {}) {
  iconLibraryPicker = pickerMode;
  iconLibraryQuery  = '';
  exitIconSelectMode();
  // Hide the Select button in picker mode (picking, not managing).
  document.getElementById('iconLibrarySelectBtn').classList.toggle('hidden', pickerMode);
  document.getElementById('iconLibrarySearchInput').value = '';
  document.getElementById('iconLibraryOverlay').classList.remove('hidden');
  document.getElementById('iconLibraryBody').classList.add('loading');
  iconLibraryItems = await fetchIcons();
  document.getElementById('iconLibraryBody').classList.remove('loading');
  renderIconLibrary();
  setTimeout(() => document.getElementById('iconLibrarySearchInput').focus(), 60);
}

function closeIconLibrary() {
  exitIconSelectMode();
  document.getElementById('iconLibraryOverlay').classList.add('hidden');
}

function enterIconSelectMode() {
  iconSelectMode = true;
  iconSelectedIds.clear();
  iconLastClickedId = null;
  document.getElementById('iconLibrarySelectBtn').textContent = 'Done';
  document.getElementById('iconLibraryGrid').classList.add('select-mode');
  updateIconBulkBar();
  renderIconLibrary();
}

function exitIconSelectMode() {
  iconSelectMode = false;
  iconSelectedIds.clear();
  iconLastClickedId = null;
  const btn = document.getElementById('iconLibrarySelectBtn');
  if (btn) btn.textContent = 'Select';
  document.getElementById('iconLibraryGrid')?.classList.remove('select-mode');
  document.getElementById('iconLibraryBulkBar')?.classList.add('hidden');
}

/** Icons currently visible under the search filter, in display order. */
function visibleIconItems() {
  const q = iconLibraryQuery.toLowerCase();
  return q
    ? iconLibraryItems.filter(i => (i.original_name || '').toLowerCase().includes(q))
    : iconLibraryItems;
}

function updateIconBulkBar() {
  const bar = document.getElementById('iconLibraryBulkBar');
  if (!iconSelectMode) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('iconLibraryBulkCount').textContent = `${iconSelectedIds.size} selected`;
  const total = visibleIconItems().length;
  document.getElementById('iconLibrarySelectAllBtn').textContent =
    (total > 0 && iconSelectedIds.size === total) ? 'Clear selection' : 'Select all';
  document.getElementById('iconLibraryBulkDeleteBtn').disabled = iconSelectedIds.size === 0;
}

function renderIconLibrary() {
  const grid  = document.getElementById('iconLibraryGrid');
  const empty = document.getElementById('iconLibraryEmpty');
  const count = document.getElementById('iconLibraryCount');

  const q       = iconLibraryQuery.toLowerCase();
  const visible = q
    ? iconLibraryItems.filter(i => (i.original_name || '').toLowerCase().includes(q))
    : iconLibraryItems;

  count.textContent = iconLibraryItems.length
    ? `${iconLibraryItems.length} ${iconLibraryItems.length === 1 ? 'icon' : 'icons'}`
    : '';

  if (!iconLibraryItems.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  if (!visible.length) {
    grid.innerHTML = `<div class="icon-library-noresults">No icons match “${escapeHtml(iconLibraryQuery)}”.</div>`;
    return;
  }

  grid.innerHTML = visible.map(icon => {
    const label      = icon.original_name || 'icon';
    const used        = icon.usage_count || 0;
    const pickedHere  = iconLibraryPicker && pendingIconId === icon.id;
    const bulkPicked  = iconSelectMode && iconSelectedIds.has(icon.id);
    const selected    = pickedHere || bulkPicked;
    // In select mode the whole card toggles selection; the per-card delete
    // button is hidden (bulk bar handles deletion).
    const checkmark = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    return `
      <div class="icon-library-card ${selected ? 'is-selected' : ''} ${bulkPicked ? 'is-checked' : ''}" data-id="${icon.id}" title="${escapeHtml(label)}">
        <button type="button" class="icon-library-card-pick" data-action="pick" data-id="${icon.id}">
          <div class="icon-library-thumb">
            <img src="${escapeHtml(icon.file_path)}" alt="${escapeHtml(label)}" loading="lazy" />
          </div>
          <div class="icon-library-meta">
            <span class="icon-library-name">${escapeHtml(label)}</span>
            <span class="icon-library-usage">${used} ${used === 1 ? 'use' : 'uses'}</span>
          </div>
        </button>
        ${iconSelectMode
          ? `<span class="icon-library-check" aria-hidden="true">${bulkPicked ? checkmark : ''}</span>`
          : `<button type="button" class="icon-library-card-delete" data-action="delete" data-id="${icon.id}" title="Delete from library">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>`}
        ${pickedHere ? '<div class="icon-library-selected-tag">Selected</div>' : ''}
      </div>
    `;
  }).join('');
}

/** Selects every visible icon between two ids (inclusive), in display order. */
function selectIconRange(fromId, toId) {
  const vis = visibleIconItems();
  const fi = vis.findIndex(i => i.id === fromId);
  const ti = vis.findIndex(i => i.id === toId);
  if (fi < 0 || ti < 0) return;
  const [lo, hi] = fi <= ti ? [fi, ti] : [ti, fi];
  for (let i = lo; i <= hi; i++) iconSelectedIds.add(vis[i].id);
}

document.getElementById('iconLibrarySearchInput').addEventListener('input', e => {
  iconLibraryQuery = e.target.value.trim();
  renderIconLibrary();
});

document.getElementById('closeIconLibraryBtn').addEventListener('click', closeIconLibrary);

document.getElementById('iconLibraryUploadBtn').addEventListener('click', () => {
  document.getElementById('iconLibraryUploadInput').click();
});

// Export the whole library as a self-contained JSON bundle (auth'd download).
document.getElementById('iconLibraryExportBtn').addEventListener('click', async () => {
  try {
    const res = await sendAuthRequest('/api/icons/export');
    if (!res.ok) throw new Error('export failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `icon-library-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Icon library exported');
  } catch {
    showToast('Could not export library', 'error');
  }
});

document.getElementById('iconLibraryImportBtn').addEventListener('click', () => {
  document.getElementById('iconLibraryImportInput').click();
});

document.getElementById('iconLibraryImportInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { showToast('Invalid icon library file', 'error'); return; }
  if (!Array.isArray(payload?.icons)) {
    showToast('File must contain an "icons" array', 'error');
    return;
  }

  document.getElementById('iconLibraryBody').classList.add('loading');
  try {
    const res = await sendAuthRequest('/api/icons/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ icons: payload.icons }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result?.error || 'import failed');
    iconLibraryItems = await fetchIcons();
    renderIconLibrary();
    const bits = [];
    if (result.imported) bits.push(`${result.imported} added`);
    if (result.skipped)  bits.push(`${result.skipped} already present`);
    showToast(bits.length ? `Imported icons — ${bits.join(', ')}` : 'Nothing to import',
      result.errors?.length ? 'info' : 'success');
  } catch {
    showToast('Could not import library', 'error');
  } finally {
    document.getElementById('iconLibraryBody').classList.remove('loading');
  }
});

document.getElementById('iconLibraryUploadInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  document.getElementById('iconLibraryBody').classList.add('loading');
  try {
    const icon = await uploadIcon(file);
    iconLibraryItems = await fetchIcons();
    renderIconLibrary();
    showToast('Icon added to library');
    if (iconLibraryPicker && icon?.id) {
      // Auto-pick the freshly uploaded icon for convenience.
      pickIconFromLibrary(icon.id);
    }
  } catch {
    showToast('Upload failed');
  } finally {
    document.getElementById('iconLibraryBody').classList.remove('loading');
  }
});

// ─── Icon library bulk select + delete ────────────────────────────────────
document.getElementById('iconLibrarySelectBtn').addEventListener('click', () => {
  iconSelectMode ? exitIconSelectMode() : enterIconSelectMode();
});

document.getElementById('iconLibraryBulkCancelBtn').addEventListener('click', exitIconSelectMode);

document.getElementById('iconLibrarySelectAllBtn').addEventListener('click', () => {
  const vis = visibleIconItems();
  const allSelected = vis.length > 0 && vis.every(i => iconSelectedIds.has(i.id));
  if (allSelected) { iconSelectedIds.clear(); iconLastClickedId = null; }
  else { vis.forEach(i => iconSelectedIds.add(i.id)); iconLastClickedId = vis[0]?.id ?? null; }
  updateIconBulkBar();
  renderIconLibrary();
});

document.getElementById('iconLibraryBulkDeleteBtn').addEventListener('click', async () => {
  const ids = [...iconSelectedIds];
  if (!ids.length) return;
  const inUse = iconLibraryItems.filter(i => ids.includes(i.id) && (i.usage_count || 0) > 0).length;
  const message = inUse
    ? `Delete ${ids.length} icon${ids.length !== 1 ? 's' : ''}? ${inUse} ${inUse === 1 ? 'is' : 'are'} in use — those links will fall back to their site favicon.`
    : `Delete ${ids.length} selected icon${ids.length !== 1 ? 's' : ''}? This can't be undone.`;
  const ok = await showConfirm({ title: 'Delete icons', message, confirmText: 'Delete', danger: true });
  if (!ok) return;

  const res = await sendAuthRequest('/api/icons/bulk-delete', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  const { deleted } = await res.json().catch(() => ({ deleted: 0 }));

  // If the link form had one of the deleted icons picked, clear it.
  if (pendingIconId != null && ids.includes(pendingIconId)) {
    pendingIconId = null; shouldRemoveIcon = true; clearCustomIconPreview();
  }
  exitIconSelectMode();
  iconLibraryItems = await fetchIcons();
  renderIconLibrary();
  showToast(`${deleted} icon${deleted !== 1 ? 's' : ''} deleted`);
  if (inUse) loadAllData();   // refresh links that lost an icon
});

document.getElementById('iconLibraryGrid').addEventListener('click', async e => {
  // Select mode: clicking anywhere on a card toggles its selection, with
  // shift-click range selection from the last clicked anchor.
  if (iconSelectMode) {
    const card = e.target.closest('.icon-library-card');
    if (!card) return;
    e.preventDefault();
    const id = Number(card.dataset.id);

    if (e.shiftKey && iconLastClickedId != null && iconLastClickedId !== id) {
      window.getSelection?.()?.removeAllRanges?.();
      selectIconRange(iconLastClickedId, id);
    } else {
      if (iconSelectedIds.has(id)) { iconSelectedIds.delete(id); iconLastClickedId = null; }
      else                         { iconSelectedIds.add(id);    iconLastClickedId = id;   }
    }
    updateIconBulkBar();
    renderIconLibrary();
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id     = Number(btn.dataset.id);
  const action = btn.dataset.action;

  if (action === 'pick') {
    if (!iconLibraryPicker) return; // browse-only mode does nothing on click
    pickIconFromLibrary(id);
    return;
  }

  if (action === 'delete') {
    e.stopPropagation();
    const icon = iconLibraryItems.find(i => i.id === id);
    const inUse = icon?.usage_count || 0;
    const message = inUse
      ? `This icon is used by ${inUse} ${inUse === 1 ? 'link' : 'links'}. Deleting it will remove the icon from those links (they will fall back to their site favicon). Continue?`
      : 'Delete this icon from your library?';
    const ok = await showConfirm({
      title:       'Delete icon',
      message,
      confirmText: 'Delete',
      danger:      true,
    });
    if (!ok) return;
    const res = await deleteIconById(id);
    if (res.ok) {
      iconLibraryItems = iconLibraryItems.filter(i => i.id !== id);
      // If the link modal had this icon picked, clear the selection.
      if (pendingIconId === id) {
        pendingIconId = null;
        shouldRemoveIcon = true;
        clearCustomIconPreview();
      }
      renderIconLibrary();
      showToast('Icon deleted');
      // Refresh link list so any link that lost its custom icon updates.
      if (inUse) loadAllData();
    } else {
      showToast('Delete failed');
    }
  }
});

function pickIconFromLibrary(id) {
  const icon = iconLibraryItems.find(i => i.id === id);
  if (!icon) return;
  pendingIconId    = icon.id;
  shouldRemoveIcon = false;
  document.getElementById('inputImage').value = '';
  showCustomIconPreview(icon.file_path, { fromLibrary: true });
  closeIconLibrary();
}


// ─── 21. MODAL CLOSE ──────────────────────────────────────────────────────────

// ─── Audit log viewer ─────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE   = 100;
const AUDIT_POLL_MS     = 5000;   // how often "Live" checks for new entries
let auditEntries  = [];
let auditAllLoaded = false;
let auditQueryTimer = null;
let auditPollTimer  = null;       // setInterval handle while modal is open + live

// SVG glyph per entity type, with a colour class for the dot.
const AUDIT_TYPE_META = {
  click:    { cls: 'click',    label: 'Click' },
  link:     { cls: 'link',     label: 'Link' },
  group:    { cls: 'group',    label: 'Group' },
  section:  { cls: 'section',  label: 'Section' },
  icon:     { cls: 'icon',     label: 'Icon' },
  settings: { cls: 'settings', label: 'Settings' },
  auth:     { cls: 'auth',     label: 'Auth' },
  audit:    { cls: 'audit',    label: 'Audit' },
};

function auditActionVerb(action) {
  // Maps an action to a dot colour. Clicks get their own neutral colour;
  // mutations are create/update/delete.
  if (action === 'link.click')               return 'click';
  const tail = String(action || '').split('.').pop();
  if (/create|import/.test(tail))            return 'create';
  if (/delete|clear|bulk_delete/.test(tail)) return 'delete';
  return 'update';
}

function formatAuditTime(iso) {
  // SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; render in the viewer's locale.
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  const now  = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000)        return 'just now';
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function openAuditLog() {
  document.getElementById('settingsOverlay').classList.add('hidden');
  document.getElementById('auditOverlay').classList.remove('hidden');
  document.getElementById('auditSearchInput').value = '';
  document.getElementById('auditTypeFilter').value = '';
  await reloadAuditLog();
  startAuditPolling();
}

function closeAuditLog() {
  stopAuditPolling();
  document.getElementById('auditOverlay').classList.add('hidden');
}

function startAuditPolling() {
  stopAuditPolling();
  if (!document.getElementById('auditLiveToggle').checked) return;
  auditPollTimer = setInterval(pollNewAuditEntries, AUDIT_POLL_MS);
}

function stopAuditPolling() {
  if (auditPollTimer) { clearInterval(auditPollTimer); auditPollTimer = null; }
}

/**
 * Fetches only entries newer than the newest one we already have (respecting
 * the active search/type filter) and prepends them with a brief highlight.
 * Cheap — returns an empty array when nothing changed. Skips while the user
 * is scrolled away from the top so we don't yank their position.
 */
async function pollNewAuditEntries() {
  if (document.getElementById('auditOverlay').classList.contains('hidden')) {
    stopAuditPolling();
    return;
  }
  // Nothing loaded yet (e.g. empty filter result) — just re-run the query.
  const newestId = auditEntries.length ? auditEntries[0].id : null;
  if (newestId == null) { await reloadAuditLog({ silent: true }); return; }

  const q    = document.getElementById('auditSearchInput').value.trim();
  const type = document.getElementById('auditTypeFilter').value;
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE), after: String(newestId) });
  if (q)    params.set('q', q);
  if (type) params.set('type', type);

  let data;
  try { data = await apiJson(`/api/audit?${params.toString()}`); }
  catch { return; }

  document.getElementById('auditCount').textContent =
    data.total ? `${data.total} ${data.total === 1 ? 'entry' : 'entries'}` : '';

  if (!data.entries || !data.entries.length) return;
  // Entries come newest-first; prepend so order is preserved.
  auditEntries = [...data.entries, ...auditEntries];
  const newIds = new Set(data.entries.map(e => e.id));
  renderAuditList(newIds);
}

async function reloadAuditLog({ silent = false } = {}) {
  auditEntries = [];
  auditAllLoaded = false;
  if (!silent) {
    document.getElementById('auditList').innerHTML = '';
    document.getElementById('auditEmpty').classList.add('hidden');
    document.getElementById('auditMoreBtn').classList.add('hidden');
    document.getElementById('auditLoading').classList.remove('hidden');
  }
  await fetchAuditPage();
}

async function fetchAuditPage() {
  const q    = document.getElementById('auditSearchInput').value.trim();
  const type = document.getElementById('auditTypeFilter').value;
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
  if (q)    params.set('q', q);
  if (type) params.set('type', type);
  const beforeId = auditEntries.length ? auditEntries[auditEntries.length - 1].id : null;
  if (beforeId)  params.set('before', String(beforeId));

  let data;
  try {
    data = await apiJson(`/api/audit?${params.toString()}`);
  } catch {
    document.getElementById('auditLoading').classList.add('hidden');
    showToast('Could not load audit log', 'error');
    return;
  }

  document.getElementById('auditLoading').classList.add('hidden');
  auditEntries.push(...(data.entries || []));
  if (!data.entries || data.entries.length < AUDIT_PAGE_SIZE) auditAllLoaded = true;

  document.getElementById('auditCount').textContent =
    data.total ? `${data.total} ${data.total === 1 ? 'entry' : 'entries'}` : '';

  renderAuditList();
}

function renderAuditList(newIds = null) {
  const list = document.getElementById('auditList');
  const empty = document.getElementById('auditEmpty');
  const moreBtn = document.getElementById('auditMoreBtn');

  if (!auditEntries.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    moreBtn.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = auditEntries.map(e => {
    const meta = AUDIT_TYPE_META[e.entity_type] || { cls: 'other', label: e.entity_type || '—' };
    const verb = auditActionVerb(e.action);
    const ua   = e.user_agent ? deviceFromUA(e.user_agent) : '';
    const metaBits = [e.ip_address, ua].filter(Boolean).join(' · ');
    const isNew = newIds && newIds.has(e.id);
    return `
      <div class="audit-row${isNew ? ' audit-row-new' : ''}">
        <span class="audit-dot audit-dot-${verb}" title="${escapeHtml(verb)}"></span>
        <div class="audit-main">
          <div class="audit-summary">${escapeHtml(e.summary || e.action)}</div>
          <div class="audit-meta">
            <span class="audit-badge audit-badge-${meta.cls}">${escapeHtml(meta.label)}</span>
            <span class="audit-action-code">${escapeHtml(e.action)}</span>
            ${metaBits ? `<span class="audit-origin">${escapeHtml(metaBits)}</span>` : ''}
          </div>
        </div>
        <time class="audit-time" title="${escapeHtml(e.created_at)} UTC">${escapeHtml(formatAuditTime(e.created_at))}</time>
      </div>`;
  }).join('');

  moreBtn.classList.toggle('hidden', auditAllLoaded);

  // Strip the highlight class after the entrance animation so it doesn't
  // re-trigger on the next render.
  if (newIds && newIds.size) {
    setTimeout(() => {
      list.querySelectorAll('.audit-row-new').forEach(el => el.classList.remove('audit-row-new'));
    }, 2000);
  }
}

// Tiny UA → device string. Mirrors the stats modal's intent without importing.
function deviceFromUA(ua) {
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return 'Mobile';
  if (/Macintosh|Windows|Linux/i.test(ua))  return 'Desktop';
  return '';
}

document.getElementById('openAuditLogBtn').addEventListener('click', openAuditLog);
document.getElementById('closeAuditBtn').addEventListener('click', closeAuditLog);
document.getElementById('auditMoreBtn').addEventListener('click', fetchAuditPage);

document.getElementById('auditRefreshBtn').addEventListener('click', () => reloadAuditLog());

document.getElementById('auditExportBtn').addEventListener('click', async () => {
  // Export honours the active search + type filter so "export what I'm
  // viewing" works. The download needs the admin token header, so we fetch
  // the blob then trigger a synthetic <a> download rather than a plain link.
  const q    = document.getElementById('auditSearchInput').value.trim();
  const type = document.getElementById('auditTypeFilter').value;
  const params = new URLSearchParams({ format: 'csv' });
  if (q)    params.set('q', q);
  if (type) params.set('type', type);

  try {
    const res = await sendAuthRequest(`/api/audit/export?${params.toString()}`);
    if (!res.ok) throw new Error('export failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Audit log exported');
  } catch {
    showToast('Could not export log', 'error');
  }
});

document.getElementById('auditLiveToggle').addEventListener('change', e => {
  if (e.target.checked) {
    pollNewAuditEntries();   // catch up immediately
    startAuditPolling();
  } else {
    stopAuditPolling();
  }
});

document.getElementById('auditSearchInput').addEventListener('input', () => {
  clearTimeout(auditQueryTimer);
  auditQueryTimer = setTimeout(() => reloadAuditLog(), 250);
});
document.getElementById('auditTypeFilter').addEventListener('change', () => reloadAuditLog());

document.getElementById('auditClearBtn').addEventListener('click', async () => {
  const ok = await showConfirm({
    title:       'Clear audit log',
    message:     'Permanently delete every audit entry? This cannot be undone.',
    confirmText: 'Clear log',
    danger:      true,
  });
  if (!ok) return;
  const res = await sendAuthRequest('/api/audit', { method: 'DELETE' });
  if (res.ok) {
    showToast('Audit log cleared');
    await reloadAuditLog();
  } else {
    showToast('Could not clear log', 'error');
  }
});


const OVERLAY_IDS = [
  'statsOverlay', 'settingsOverlay', 'linkModalOverlay',
  'groupModalOverlay', 'deleteLinkOverlay', 'deleteGroupOverlay', 'confirmOverlay',
  'iconLibraryOverlay', 'versionOverlay', 'fileEditorOverlay', 'iconPresetsOverlay',
  'auditOverlay',
];

OVERLAY_IDS.forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id === id) e.target.classList.add('hidden');
  });
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;

  // If any overlay is visible, close it first — same behaviour as before.
  const openOverlay = OVERLAY_IDS
    .map(id => document.getElementById(id))
    .find(el => el && !el.classList.contains('hidden'));
  if (openOverlay) {
    OVERLAY_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));
    return;
  }

  // Otherwise, drain the bulk-selection state. First Esc clears the selection
  // (keeps bulk mode active so the user can keep picking); a second Esc with
  // nothing selected exits bulk mode entirely. Same flow as Finder / Gmail.
  if (bulkModeActive) {
    const selected = document.querySelectorAll('#linksGrid .link-card-wrap.selected');
    if (selected.length) {
      selected.forEach(w => w.classList.remove('selected'));
      lastClickedLinkId = null;
      updateBulkBar();
    } else {
      exitBulkMode();
    }
  }
});


// ─── 22. EASTER EGG ──────────────────────────────────────────────────────────

console.log(
  '%c Engineered by Tomás Neto in Portugal \n%c "Não tentes. Faz!" ',
  'background:#0071e3; color:#fff; padding:6px 14px; border-radius:6px 6px 0 0; font-size:13px; font-weight:700; font-family:-apple-system,sans-serif;',
  'background:#1d1d1f; color:#f5f5f7; padding:4px 14px 8px; border-radius:0 0 6px 6px; font-size:12px; font-style:italic; font-family:-apple-system,sans-serif;'
);

const KONAMI_SEQUENCE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let konamiIndex = 0;

document.addEventListener('keydown', e => {
  konamiIndex = (e.key === KONAMI_SEQUENCE[konamiIndex]) ? konamiIndex + 1 : (e.key === KONAMI_SEQUENCE[0] ? 1 : 0);
  if (konamiIndex === KONAMI_SEQUENCE.length) { konamiIndex = 0; showEasterEgg(); }
});

function showEasterEgg() {
  if (document.getElementById('easterEggOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id        = 'easterEggOverlay';
  overlay.className = 'easteregg-overlay';
  overlay.innerHTML = `
    <div class="easteregg-card" onclick="event.stopPropagation()">
      <span class="easteregg-flag">🇵🇹</span>
      <p class="easteregg-by">Engineered by</p>
      <h2 class="easteregg-name">Tomás Neto</h2>
      <p class="easteregg-location">in Portugal</p>
      <div class="easteregg-divider"></div>
      <p class="easteregg-quote">"Não tentes. Faz!"</p>
      <a class="easteregg-github" href="https://github.com/Tomasneto404" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
        github.com/Tomasneto404
      </a>
      <p class="easteregg-dismiss">Click anywhere to close</p>
    </div>`;

  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.appendChild(overlay);
}


// ─── 22b. MOBILE OVERFLOW MENU ────────────────────────────────────────────────
//
// On phones the theme / settings / logout buttons are hidden and replaced by
// a single kebab button that opens this popover. Menu items just programmatically
// click the real (hidden) buttons so their existing handlers fire — no duplicate
// logic.

(function setupMobileMenu() {
  const moreBtn = document.getElementById('mobileMoreBtn');
  const menu    = document.getElementById('mobileMenu');
  if (!moreBtn || !menu) return;

  function setOpen(open) {
    menu.classList.toggle('hidden', !open);
    moreBtn.setAttribute('aria-expanded', String(open));
  }

  moreBtn.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(menu.classList.contains('hidden'));
  });

  document.addEventListener('click', e => {
    if (menu.classList.contains('hidden')) return;
    if (menu.contains(e.target) || moreBtn.contains(e.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) setOpen(false);
  });

  // Forward each item to the real button so existing handlers run unchanged.
  const forward = (itemId, targetId) => {
    const item = document.getElementById(itemId);
    if (!item) return;
    item.addEventListener('click', () => {
      setOpen(false);
      document.getElementById(targetId)?.click();
    });
  };
  forward('mobileThemeItem',    'themeToggle');
  forward('mobileSettingsItem', 'openSettingsBtn');
  forward('mobileLogoutItem',   'logoutBtn');
})();


// ─── 23. STARTUP ─────────────────────────────────────────────────────────────

checkStoredToken();
