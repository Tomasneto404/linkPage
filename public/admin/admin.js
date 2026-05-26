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

async function createSectionApi(groupId, name) { return jsonPost(`/api/groups/${groupId}/sections`, { name }); }
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
let addingSectionToGroupId = null; // group ID currently in "add section" mode
let editingSectionId       = null; // section ID currently being renamed inline


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

    const sectionRowsHtml = (g.sections || []).map(s => {
      const sCount = links.filter(l =>
        linkBelongsToGroup(l, g.id) && linkSectionInGroup(l, g.id) === s.id).length;
      const sActive = activeGroup === g.id && activeSection === s.id;
      const sCountStyle = sActive ? `background:${g.color}18; color:${g.color}` : '';

      // Rename mode: an input replaces the section name inline.
      if (editingSectionId === s.id) {
        return `
          <div class="section-nav-item editing" data-section-id="${s.id}" data-group-id="${g.id}">
            <span class="section-tick"></span>
            <input class="section-inline-input" data-mode="rename" data-section-id="${s.id}"
                   value="${escapeHtml(s.name)}" autocomplete="off" />
          </div>`;
      }

      return `
        <div class="section-nav-item${sActive ? ' active' : ''}"
             data-section-id="${s.id}" data-group-id="${g.id}" draggable="true">
          <span class="section-drag-handle" title="Drag to reorder">${SIDEBAR_ICONS.drag}</span>
          <span class="section-tick"></span>
          <span class="section-name">${escapeHtml(s.name)}</span>
          <span class="nav-count" style="${sCountStyle}">${sCount}</span>
          <div class="group-item-actions">
            <button class="group-action-btn edit-section-btn" data-section-id="${s.id}" title="Rename">${SIDEBAR_ICONS.edit}</button>
            <button class="group-action-btn danger delete-section-btn" data-section-id="${s.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
          </div>
        </div>`;
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
      addingSectionToGroupId = Number(btn.dataset.groupId);
      editingSectionId = null;
      renderSidebar();
      const input = nav.querySelector('.section-inline-input[data-mode="create"]');
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

      if (!commit) {
        addingSectionToGroupId = null;
        editingSectionId       = null;
        renderSidebar();
        return;
      }
      const name = input.value.trim();
      if (!name) {
        addingSectionToGroupId = null;
        editingSectionId       = null;
        renderSidebar();
        return;
      }
      try {
        if (input.dataset.mode === 'create') {
          await createSectionApi(Number(input.dataset.groupId), name);
          showToast('Section created');
        } else {
          await updateSectionApi(Number(input.dataset.sectionId), name);
          showToast('Section renamed');
        }
      } catch { showToast('Could not save section', 'error'); }
      addingSectionToGroupId = null;
      editingSectionId       = null;
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
  nav.querySelectorAll('.section-nav-item:not(.editing)').forEach(item => {
    const sid = Number(item.dataset.sectionId);
    const gid = Number(item.dataset.groupId);
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
    item.addEventListener('dragover', e => {
      if (!draggedSectionId || draggedSectionGroupId !== gid || draggedSectionId === sid) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      item.classList.remove('drag-over');
      if (!draggedSectionId || draggedSectionGroupId !== gid || draggedSectionId === sid) return;
      e.preventDefault();
      e.stopPropagation();

      const group = groups.find(g => g.id === gid);
      if (!group || !Array.isArray(group.sections)) return;
      const fi = group.sections.findIndex(s => s.id === draggedSectionId);
      const ti = group.sections.findIndex(s => s.id === sid);
      if (fi === -1 || ti === -1) return;

      const [moved] = group.sections.splice(fi, 1);
      group.sections.splice(ti, 0, moved);
      renderSidebar();
      reorderSectionsApi(group.sections.map(s => s.id));
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
      filtered = filtered.filter(l => linkSectionInGroup(l, activeGroup) === activeSection);
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

function buildIconHtml(iconUrl) {
  if (!iconUrl) return `<span class="icon-fallback">${FALLBACK_ICON_SVG}</span>`;
  return `
    <span class="favicon-shimmer"></span>
    <img src="${escapeHtml(iconUrl)}" alt="" loading="lazy"
         onload="this.previousElementSibling.remove()"
         onerror="this.previousElementSibling.remove(); this.style.display='none'; this.nextElementSibling.style.display='flex'" />
    <span class="icon-fallback" style="display:none">${FALLBACK_ICON_SVG}</span>`;
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
  // the admin uploaded a custom icon).
  const iconUrl  = link.image_path
                || (link.file_path ? null : (link.favicon_path || getFaviconUrl(link.url)));
  const iconHtml = iconUrl
                ? buildIconHtml(iconUrl)
                : (link.file_path
                    ? `<span class="icon-fallback">${FILE_ICON_SVG}</span>`
                    : `<span class="icon-fallback">${FALLBACK_ICON_SVG}</span>`);
  const q        = searchQuery; // capture for highlights

  const footerParts = [];
  const linkGroups = Array.isArray(link.groups) && link.groups.length
    ? link.groups
    : (link.group_name ? [{ name: link.group_name, color: link.group_color }] : []);
  for (const g of linkGroups) {
    footerParts.push(`<span class="group-badge" style="background:${g.color}18; color:${g.color}" title="${escapeHtml(g.name)}">${escapeHtml(g.name)}</span>`);
  }
  if (link.is_hidden) {
    footerParts.push(`<span class="hidden-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
      Hidden
    </span>`);
  }
  if (link.is_broken && link.last_checked_at) {
    footerParts.push(`<span class="broken-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Dead link
    </span>`);
  }

  // Stats join the same meta strip as group/status chips so everything lines
  // up. Chip itself shows the click count; the tooltip carries the full
  // "N clicks · M unique" detail.
  if (stats) {
    const tip = `${stats.total_clicks} click${stats.total_clicks !== 1 ? 's' : ''} · ${stats.unique_visitors} unique visitor${stats.unique_visitors !== 1 ? 's' : ''}`;
    footerParts.push(`<span class="card-click-count" title="${escapeHtml(tip)}">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      ${stats.total_clicks}
    </span>`);
  }

  const metaHtml = footerParts.length ? `<div class="card-meta">${footerParts.join('')}</div>` : '';
  const descHtml = link.description ? `<p class="link-desc">${highlightText(link.description, q)}</p>` : '';

  const canDrag = sortOrder === 'position' && !bulkModeActive;

  card.innerHTML = `
    <svg class="drag-handle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
      <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
      <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
    </svg>
    <div class="link-icon">${iconHtml}</div>
    <div class="link-body">
      <div class="link-name">${highlightText(link.name, q)}</div>
      <a class="link-url" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
        ${highlightText(getLinkDisplayLabel(link), q)}
      </a>
      ${descHtml}${metaHtml}
    </div>
    <div class="link-side">
      <div class="link-actions">
        <button class="icon-btn stats-link-btn" title="Stats">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </button>
        <button class="icon-btn edit-link-btn" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn visibility-btn" title="${link.is_hidden ? 'Show on public page' : 'Hide from public page'}">
          ${link.is_hidden
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`}
        </button>
        <button class="icon-btn danger delete-link-btn" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <span class="link-date">${formatDate(link.created_at)}</span>
    </div>`;

  card.querySelector('.stats-link-btn').addEventListener('click',  () => openStatsModal(link));
  card.querySelector('.edit-link-btn').addEventListener('click',   () => openEditLinkModal(link));
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
    if (!bulkModeActive || e.target.closest('.link-actions')) return;
    wrap.classList.toggle('selected'); updateBulkBar();
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

    const sectionPicker = sections.length === 0 ? '' : `
      <div class="multi-select-section${isChecked ? '' : ' hidden'}" data-group-id="${g.id}">
        <span class="multi-select-section-arrow">↳</span>
        <select class="multi-select-section-select" data-group-id="${g.id}">
          <option value="">No section</option>
          ${sections.map(s => `
            <option value="${s.id}" ${pickedSid === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>
          `).join('')}
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
    try {
      const res = await sendAuthRequest(
        `/api/favicon-preview?url=${encodeURIComponent(validUrl)}`,
        { signal: faviconPreviewAbort.signal }
      );
      if (!res.ok) { fi.className = ''; return; }
      const blob = await res.blob();
      faviconPreviewBlobUrl = URL.createObjectURL(blob);
      fi.src        = faviconPreviewBlobUrl;
      fi.onload     = () => fi.className = 'visible';
      fi.onerror    = () => fi.className = '';
    } catch {
      // Aborted by the next keystroke, or a network error — leave the box empty.
    }
  }, 600);
});

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

  try {
    const result = linkId ? await updateLink(linkId, fd) : await createLink(fd);
    if (result?.error) { showFormError('linkFormError', result.error); return; }
    closeLinkModal();
    showToast(linkId ? 'Link saved' : 'Link added');
    await loadAllData();
  } catch {
    showFormError('linkFormError', 'Something went wrong. Please try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Link';
  }
});

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

function openAddGroupModal() {
  clearPasswordOnSave = false;
  document.getElementById('groupModalTitle').textContent = 'New Group';
  document.getElementById('editingGroupId').value        = '';
  document.getElementById('groupNameInput').value        = '';
  document.getElementById('groupPasswordInput').value    = '';
  document.getElementById('groupColorInput').value       = GROUP_COLORS[0];
  buildColorPalette(GROUP_COLORS[0]); hideFormError('groupFormError');
  updateGroupPasswordStatus(false);
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
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function closeGroupModal() { document.getElementById('groupModalOverlay').classList.add('hidden'); }

document.getElementById('clearGroupPasswordBtn').addEventListener('click', () => {
  clearPasswordOnSave = true;
  document.getElementById('groupPasswordInput').value = '';
  updateGroupPasswordStatus(true);
});

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

      // Select the freshly-rendered card and refresh the bulk bar.
      const freshWrap = document.querySelector(`.link-card-wrap[data-link-id="${linkId}"]`);
      if (freshWrap) { freshWrap.classList.add('selected'); updateBulkBar(); }

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
  document.getElementById('bulkSelectBtn').textContent = 'Select';
  document.getElementById('bulkBar').classList.add('hidden');
  document.getElementById('linksGrid').classList.remove('bulk-mode');
  renderLinks();
}

document.getElementById('bulkSelectBtn').addEventListener('click', () =>
  bulkModeActive ? exitBulkMode() : enterBulkMode());

document.getElementById('bulkCancelBtn').addEventListener('click', exitBulkMode);

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

document.getElementById('bulkMoveBtn').addEventListener('click', async () => {
  const ids      = getSelectedIds();
  const groupVal = document.getElementById('bulkGroupSelect').value;
  if (!ids.length || !groupVal) return;
  const groupIds = groupVal === 'none' ? [] : [Number(groupVal)];
  await Promise.all(ids.map(id => {
    const link = links.find(l => l.id === id); if (!link) return;
    const fd = new FormData();
    fd.append('name',         link.name);
    fd.append('url',          link.url);
    fd.append('description',  link.description || '');
    fd.append('group_ids',    JSON.stringify(groupIds));
    fd.append('remove_image', 'false');
    return updateLink(id, fd);
  }));
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} moved`);
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
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.link-card.drag-over').forEach(el => el.classList.remove('drag-over'));
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

  const ok = await showConfirm({
    title:       'Import Links',
    message:     `Add ${data.links.length} link${data.links.length !== 1 ? 's' : ''} to your existing links?`,
    confirmText: 'Import',
    danger:      false,
  });
  if (!ok) { e.target.value = ''; return; }

  const result = await importLinksApi({ links: data.links });
  const errNote = result.errors?.length ? ` (${result.errors.length} skipped)` : '';
  showToast(`Imported ${result.imported} link${result.imported !== 1 ? 's' : ''}${errNote}`,
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


// ─── 20.5. ICON LIBRARY ──────────────────────────────────────────────────────

let iconLibraryItems    = [];
let iconLibraryQuery    = '';
let iconLibraryPicker   = false;  // true when opened from the link modal

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
  document.getElementById('iconLibrarySearchInput').value = '';
  document.getElementById('iconLibraryOverlay').classList.remove('hidden');
  document.getElementById('iconLibraryBody').classList.add('loading');
  iconLibraryItems = await fetchIcons();
  document.getElementById('iconLibraryBody').classList.remove('loading');
  renderIconLibrary();
  setTimeout(() => document.getElementById('iconLibrarySearchInput').focus(), 60);
}

function closeIconLibrary() {
  document.getElementById('iconLibraryOverlay').classList.add('hidden');
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
    const label    = icon.original_name || 'icon';
    const used     = icon.usage_count || 0;
    const selected = iconLibraryPicker && pendingIconId === icon.id;
    return `
      <div class="icon-library-card ${selected ? 'is-selected' : ''}" data-id="${icon.id}" title="${escapeHtml(label)}">
        <button type="button" class="icon-library-card-pick" data-action="pick" data-id="${icon.id}">
          <div class="icon-library-thumb">
            <img src="${escapeHtml(icon.file_path)}" alt="${escapeHtml(label)}" loading="lazy" />
          </div>
          <div class="icon-library-meta">
            <span class="icon-library-name">${escapeHtml(label)}</span>
            <span class="icon-library-usage">${used} ${used === 1 ? 'use' : 'uses'}</span>
          </div>
        </button>
        <button type="button" class="icon-library-card-delete" data-action="delete" data-id="${icon.id}" title="Delete from library">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
        ${selected ? '<div class="icon-library-selected-tag">Selected</div>' : ''}
      </div>
    `;
  }).join('');
}

document.getElementById('iconLibrarySearchInput').addEventListener('input', e => {
  iconLibraryQuery = e.target.value.trim();
  renderIconLibrary();
});

document.getElementById('closeIconLibraryBtn').addEventListener('click', closeIconLibrary);

document.getElementById('iconLibraryUploadBtn').addEventListener('click', () => {
  document.getElementById('iconLibraryUploadInput').click();
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

document.getElementById('iconLibraryGrid').addEventListener('click', async e => {
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

const OVERLAY_IDS = [
  'statsOverlay', 'settingsOverlay', 'linkModalOverlay',
  'groupModalOverlay', 'deleteLinkOverlay', 'deleteGroupOverlay', 'confirmOverlay',
  'iconLibraryOverlay',
];

OVERLAY_IDS.forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id === id) e.target.classList.add('hidden');
  });
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  OVERLAY_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));
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
