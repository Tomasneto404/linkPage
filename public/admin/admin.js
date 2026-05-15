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

const jsonPost = (url, body) =>
  apiJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const jsonPut = (url, body) =>
  apiJson(url, { method: 'PUT',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function bulkDeleteLinks(ids)    { return jsonPost('/api/links/bulk-delete', { ids }); }
async function reorderLinksApi(order)  { return sendAuthRequest('/api/links/reorder',  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }); }
async function reorderGroupsApi(order) { return sendAuthRequest('/api/groups/reorder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order }) }); }
async function exportLinksApi()        { return apiJson('/api/links/export'); }
async function importLinksApi(payload) { return jsonPost('/api/links/import', payload); }

async function createGroup(d)          { return jsonPost('/api/groups', d); }
async function updateGroup(id, d)      { return jsonPut(`/api/groups/${id}`, d); }
async function deleteGroupById(id)     { return sendAuthRequest(`/api/groups/${id}`, { method: 'DELETE' }); }

async function uploadLogo(variant, file) {
  const fd = new FormData(); fd.append('logo', file);
  return apiJson(`/api/settings/logo/${variant}`, { method: 'POST', body: fd });
}
async function removeLogo(variant)     { return sendAuthRequest(`/api/settings/logo/${variant}`, { method: 'DELETE' }); }
async function saveSiteTitle(title)    { return jsonPost('/api/settings/site-title', { title }); }
async function setPublicPassword(pw)   { return jsonPost('/api/settings/public-password', { password: pw }); }
async function removePublicPassword()  { return sendAuthRequest('/api/settings/public-password', { method: 'DELETE' }); }
async function rotateAdminToken()      { return apiJson('/api/auth/rotate-token', { method: 'POST' }); }


// ─── 4. SETTINGS ──────────────────────────────────────────────────────────────

async function loadSettings() {
  const s      = await fetchSettings();
  logoLightUrl = s.logo_light || null;
  logoDarkUrl  = s.logo_dark  || null;
  updateHeaderLogo();
  if (s.site_title) {
    document.title = `${s.site_title} — Admin`;
    document.getElementById('siteTitleInput').value = s.site_title;
  }
  updatePublicPasswordStatus(s.public_password_required);
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

document.getElementById('openSettingsBtn').addEventListener('click', async () => {
  const s = await fetchSettings();
  updateSettingsPreview('light', logoLightUrl);
  updateSettingsPreview('dark',  logoDarkUrl);
  document.getElementById('siteTitleInput').value = s.site_title || '';
  updatePublicPasswordStatus(s.public_password_required);
  document.getElementById('newTokenDisplay').classList.add('hidden');
  document.getElementById('settingsOverlay').classList.remove('hidden');
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

let links       = [];
let groups      = [];
let activeGroup = 'all';
let searchQuery = '';
let statsMap    = {};
let sortOrder   = 'position'; // 'position'|'name-asc'|'name-desc'|'date-new'|'date-old'|'clicks'


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

let draggedGroupId = null;

function renderSidebar() {
  document.getElementById('countAll').textContent       = links.length;
  document.getElementById('countUngrouped').textContent = links.filter(l => !l.group_id).length;

  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.group === String(activeGroup)));

  const nav = document.getElementById('groupsNav');
  nav.innerHTML = groups.map(g => {
    const count   = links.filter(l => l.group_id === g.id).length;
    const active  = activeGroup === g.id;
    const cStyle  = active ? `background:${g.color}18; color:${g.color}` : '';
    return `
      <div class="group-nav-item${active ? ' active' : ''}" data-group-id="${g.id}" draggable="true">
        <svg class="group-drag-handle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/>
          <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
          <circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
        </svg>
        <span class="group-dot" style="background:${escapeHtml(g.color)}"></span>
        <span>${escapeHtml(g.name)}</span>
        <span class="nav-count" style="${cStyle}">${count}</span>
        <div class="group-item-actions">
          <button class="group-action-btn edit-group-btn" data-group-id="${g.id}" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="group-action-btn danger delete-group-btn" data-group-id="${g.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  nav.querySelectorAll('.group-nav-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.group-item-actions')) return;
      activeGroup = Number(item.dataset.groupId);
      renderSidebar(); renderLinks(true);
    });
  });
  nav.querySelectorAll('.edit-group-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openEditGroupModal(Number(btn.dataset.groupId)); }));
  nav.querySelectorAll('.delete-group-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openDeleteGroupModal(Number(btn.dataset.groupId)); }));

  // Group drag-to-reorder
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
}


// ─── 9. LINK CARDS ────────────────────────────────────────────────────────────

function getFilteredLinks() {
  let filtered = links;

  if      (activeGroup === 'ungrouped') filtered = filtered.filter(l => !l.group_id);
  else if (activeGroup !== 'all')       filtered = filtered.filter(l => l.group_id === activeGroup);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q)  ||
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
  wrap.className   = 'link-card-wrap';
  wrap.dataset.linkId = link.id;

  const checkbox   = document.createElement('div');
  checkbox.className = 'card-checkbox hidden';
  wrap.appendChild(checkbox);

  const card = document.createElement('div');
  card.className = 'link-card';

  const stats    = statsMap[link.id];
  const iconUrl  = link.image_path || link.favicon_path || getFaviconUrl(link.url);
  const iconHtml = buildIconHtml(iconUrl);
  const q        = searchQuery; // capture for highlights

  const footerParts = [];
  if (link.group_name) {
    footerParts.push(`<span class="group-badge" style="background:${link.group_color}18; color:${link.group_color}">${escapeHtml(link.group_name)}</span>`);
  }
  if (link.is_broken && link.last_checked_at) {
    footerParts.push(`<span class="broken-badge">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Dead link
    </span>`);
  }

  const footerHtml = footerParts.length ? `<div class="link-footer">${footerParts.join('')}</div>` : '';
  const descHtml   = link.description ? `<p class="link-desc">${highlightText(link.description, q)}</p>` : '';
  const clickHtml  = stats ? `<div class="card-click-count">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    ${stats.total_clicks} click${stats.total_clicks !== 1 ? 's' : ''} &nbsp;·&nbsp; ${stats.unique_visitors} unique
  </div>` : '';

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
        ${highlightText(getDomainName(link.url), q)}
      </a>
      ${descHtml}${footerHtml}${clickHtml}
    </div>
    <div class="link-side">
      <div class="link-actions">
        <button class="icon-btn stats-link-btn" title="Stats">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </button>
        <button class="icon-btn edit-link-btn" title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn danger delete-link-btn" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <span class="link-date">${formatDate(link.created_at)}</span>
    </div>`;

  card.querySelector('.stats-link-btn').addEventListener('click',  () => openStatsModal(link));
  card.querySelector('.edit-link-btn').addEventListener('click',   () => openEditLinkModal(link));
  card.querySelector('.delete-link-btn').addEventListener('click', () => openDeleteLinkModal(link));

  wrap.addEventListener('click', e => {
    if (!bulkModeActive || e.target.closest('.link-actions')) return;
    wrap.classList.toggle('selected'); updateBulkBar();
  });

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
 * Renders the filtered link grid.
 * Pass transition=true to do a quick fade before swapping content (e.g. group switches).
 */
function renderLinks(transition = false) {
  const grid       = document.getElementById('linksGrid');
  const emptyState = document.getElementById('emptyState');

  function doRender() {
    const filtered = getFilteredLinks();
    grid.innerHTML = '';

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      updateEmptyState();
    } else {
      emptyState.classList.add('hidden');
      filtered.forEach((link, i) => {
        const el = buildLinkCard(link);
        el.style.animationDelay = `${Math.min(i * 22, 280)}ms`;
        el.classList.add('card-animate');
        if (bulkModeActive) el.querySelector('.card-checkbox').classList.remove('hidden');
        grid.appendChild(el);
      });
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

function populateGroupDropdown(selectedId) {
  document.getElementById('inputGroup').innerHTML =
    '<option value="">None</option>' +
    groups.map(g => `<option value="${g.id}"${g.id === selectedId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('');
}

function openAddLinkModal() {
  shouldRemoveIcon = false;
  document.getElementById('linkModalTitle').textContent = 'Add Link';
  document.getElementById('editingLinkId').value = '';
  document.getElementById('linkForm').reset();
  document.getElementById('faviconImg').className = '';
  document.getElementById('faviconImg').src = '';
  document.getElementById('urlDuplicateWarning').classList.add('hidden');
  clearCustomIconPreview(); hideFormError('linkFormError');
  populateGroupDropdown((activeGroup !== 'all' && activeGroup !== 'ungrouped') ? activeGroup : null);
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function openEditLinkModal(link) {
  shouldRemoveIcon = false;
  document.getElementById('linkModalTitle').textContent = 'Edit Link';
  document.getElementById('editingLinkId').value  = link.id;
  document.getElementById('inputName').value      = link.name;
  document.getElementById('inputUrl').value       = link.url;
  document.getElementById('inputDesc').value      = link.description || '';
  document.getElementById('urlDuplicateWarning').classList.add('hidden');
  populateGroupDropdown(link.group_id);
  const fi = document.getElementById('faviconImg');
  const fu = getFaviconUrl(link.url);
  fi.src = fu || ''; fi.className = fu ? 'visible' : '';
  link.image_path ? showCustomIconPreview(link.image_path) : clearCustomIconPreview();
  hideFormError('linkFormError');
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function closeLinkModal() { document.getElementById('linkModalOverlay').classList.add('hidden'); }

function showCustomIconPreview(src) {
  document.getElementById('iconPreviewImg').src = src;
  document.getElementById('iconPreviewWrap').classList.remove('hidden');
  document.getElementById('iconUploadArea').classList.add('hidden');
}
function clearCustomIconPreview() {
  document.getElementById('iconPreviewWrap').classList.add('hidden');
  document.getElementById('iconUploadArea').classList.remove('hidden');
  document.getElementById('iconPreviewImg').src = '';
}

let faviconTimer;
document.getElementById('inputUrl').addEventListener('input', e => {
  const url       = e.target.value.trim();
  const editingId = parseInt(document.getElementById('editingLinkId').value) || null;
  const fi        = document.getElementById('faviconImg');

  // Duplicate URL warning
  const dup = links.find(l => l.url === url && l.id !== editingId);
  const wEl = document.getElementById('urlDuplicateWarning');
  if (dup && url) { wEl.textContent = `URL already exists: "${dup.name}"`; wEl.classList.remove('hidden'); }
  else              wEl.classList.add('hidden');

  // Favicon: clear immediately, then fetch if URL looks complete
  clearTimeout(faviconTimer);
  fi.src = ''; fi.className = '';

  let hostname = null;
  try { const p = new URL(url); if ((p.protocol === 'http:' || p.protocol === 'https:') && p.hostname.includes('.')) hostname = p.hostname; } catch {}
  if (!hostname) return;

  faviconTimer = setTimeout(() => {
    fi.src     = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
    fi.onload  = () => fi.className = 'visible';
    fi.onerror = () => fi.className = '';
  }, 600);
});

document.getElementById('iconUploadArea').addEventListener('click', () => document.getElementById('inputImage').click());
document.getElementById('inputImage').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = ev => showCustomIconPreview(ev.target.result); r.readAsDataURL(f);
  shouldRemoveIcon = false;
});
document.getElementById('removeCustomIconBtn').addEventListener('click', () => {
  shouldRemoveIcon = true; clearCustomIconPreview(); document.getElementById('inputImage').value = '';
});

document.getElementById('linkForm').addEventListener('submit', async e => {
  e.preventDefault(); hideFormError('linkFormError');

  const linkId  = document.getElementById('editingLinkId').value;
  const fd      = new FormData();
  fd.append('name',         document.getElementById('inputName').value.trim());
  fd.append('url',          document.getElementById('inputUrl').value.trim());
  fd.append('description',  document.getElementById('inputDesc').value.trim());
  fd.append('group_id',     document.getElementById('inputGroup').value);
  fd.append('remove_image', shouldRemoveIcon ? 'true' : 'false');
  const imgFile = document.getElementById('inputImage').files[0];
  if (imgFile) fd.append('image', imgFile);

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
  const palette = document.getElementById('colorPalette');
  palette.innerHTML = GROUP_COLORS.map(c =>
    `<div class="color-swatch${c === selected ? ' selected' : ''}" data-color="${c}" style="background:${c}" title="${c}"></div>`
  ).join('');
  palette.querySelectorAll('.color-swatch').forEach(s => s.addEventListener('click', () => {
    palette.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
    s.classList.add('selected'); document.getElementById('groupColorInput').value = s.dataset.color;
  }));
}

function openAddGroupModal() {
  document.getElementById('groupModalTitle').textContent = 'New Group';
  document.getElementById('editingGroupId').value        = '';
  document.getElementById('groupNameInput').value        = '';
  document.getElementById('groupColorInput').value       = GROUP_COLORS[0];
  buildColorPalette(GROUP_COLORS[0]); hideFormError('groupFormError');
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function openEditGroupModal(gid) {
  const g = groups.find(x => x.id === gid); if (!g) return;
  document.getElementById('groupModalTitle').textContent = 'Edit Group';
  document.getElementById('editingGroupId').value        = g.id;
  document.getElementById('groupNameInput').value        = g.name;
  document.getElementById('groupColorInput').value       = g.color;
  buildColorPalette(g.color); hideFormError('groupFormError');
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function closeGroupModal() { document.getElementById('groupModalOverlay').classList.add('hidden'); }

document.getElementById('groupForm').addEventListener('submit', async e => {
  e.preventDefault(); hideFormError('groupFormError');
  const gid   = document.getElementById('editingGroupId').value;
  const name  = document.getElementById('groupNameInput').value.trim();
  const color = document.getElementById('groupColorInput').value;
  if (!name) return;
  try {
    const result = gid
      ? await updateGroup(gid, { name, color })
      : await createGroup({ name, color });
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
  const groupId = groupVal === 'none' ? '' : groupVal;
  await Promise.all(ids.map(id => {
    const link = links.find(l => l.id === id); if (!link) return;
    const fd = new FormData();
    fd.append('name',         link.name);
    fd.append('url',          link.url);
    fd.append('description',  link.description || '');
    fd.append('group_id',     groupId);
    fd.append('remove_image', 'false');
    return updateLink(id, fd);
  }));
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} moved`);
  exitBulkMode(); await loadAllData();
});


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
  activeGroup = btn.dataset.group; renderSidebar(); renderLinks(true);
}));

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim(); renderLinks();
});


// ─── 21. MODAL CLOSE ──────────────────────────────────────────────────────────

const OVERLAY_IDS = [
  'statsOverlay', 'settingsOverlay', 'linkModalOverlay',
  'groupModalOverlay', 'deleteLinkOverlay', 'deleteGroupOverlay', 'confirmOverlay',
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


// ─── 23. STARTUP ─────────────────────────────────────────────────────────────

checkStoredToken();
