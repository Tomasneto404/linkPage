// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Admin panel — the first of its scripts: theme, signing in, and the calls to
 * the server that everything else uses.
 *
 * The panel is several classic scripts, loaded in order by admin/index.html
 * and sharing one scope, so a function in one file can call a function in any
 * other. The one rule that comes with that: code that runs *while the page is
 * still loading* may only use what is declared in its own file or an earlier
 * one. Anything it needs from a later file is not defined yet, and the error
 * takes the rest of the file down with it. That is why the few helpers
 * applyTheme() calls at load live here rather than in settings.js.
 *
 *   core.js        theme, signing in, server calls
 *   settings.js    branding, wallpaper, header icon, themes
 *   helpers.js     shared helpers, state, data loading
 *   sidebar.js     the group sidebar
 *   cards.js       link cards, the stats modal
 *   link-modal.js  adding, editing and deleting a link
 *   groups.js      adding, editing and deleting a group
 *   bulk.js        bulk selection, drag to reorder
 *   toolbar.js     import/export, sort, navigation, changelog, update check
 *   file-editor.js the file editor
 *   icons.js       the stock icon picker and the icon library
 *   audit.js       closing modals, the audit log
 *   requests.js    link requests, IP attribution
 *   accounts.js    accounts and invites
 *   analytics.js   analytics, the mobile menu
 *   sso.js         single sign-on settings
 *   mail.js        email settings
 *   main.js        start-up — last, because it starts everything
 */

let logoLightUrl = null;
let logoDarkUrl  = null;
let faviconUrl   = null;
let brandIconUrl = null;   // header glyph next to the site title


// ─── 1. THEME ─────────────────────────────────────────────────────────────────

// Admin-configured appearance (accent + palette variants + default theme).
let themeSettings = { accent: null, accentDarkAdjust: false, glow: false, light: 'default', dark: 'default', default: 'system' };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shadeColor(hex, pct) {
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct) / 100;
  const mix = c => Math.round((t - c) * p + c);
  return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

function applyAccent(theme) {
  const root = document.documentElement.style;
  if (!themeSettings.accent) {
    root.removeProperty('--primary');
    root.removeProperty('--primary-rgb');
    root.removeProperty('--primary-hover');
    return;
  }
  const dark = theme === 'dark';
  const base = (dark && themeSettings.accentDarkAdjust) ? shadeColor(themeSettings.accent, 18) : themeSettings.accent;
  root.setProperty('--primary', base);
  root.setProperty('--primary-rgb', hexToRgb(base).join(','));
  root.setProperty('--primary-hover', shadeColor(base, dark ? 12 : -8));
}

function applyThemeVariants() {
  const el = document.documentElement;
  el.setAttribute('data-light-variant', themeSettings.light || 'default');
  el.setAttribute('data-dark-variant',  themeSettings.dark  || 'default');
  el.setAttribute('data-accent-glow',   themeSettings.glow ? 'on' : 'off');
}

function applyThemeSettings(settings) {
  themeSettings = {
    accent:           settings.accent_color || null,
    accentDarkAdjust: !!settings.accent_dark_adjust,
    glow:             !!settings.accent_glow,
    light:            settings.theme_light_variant || 'default',
    dark:             settings.theme_dark_variant  || 'default',
    default:          settings.default_theme || 'system',
  };
  applyThemeVariants();
  if (!localStorage.getItem('linkpage_theme')) {
    applyTheme(getInitialTheme(), false);
  } else {
    applyAccent(document.documentElement.getAttribute('data-theme') || 'light');
  }
}

function getInitialTheme() {
  const saved = localStorage.getItem('linkpage_theme');
  if (saved) return saved;
  if (themeSettings.default === 'light' || themeSettings.default === 'dark') return themeSettings.default;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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


/** Header glyph: a configured image, or the built-in chain-link SVG. */
function applyBrandIcon(url) {
  const slot = document.getElementById('brandIcon');
  if (!slot) return;

  slot.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'brand-icon-img';
  img.src       = url || DEFAULT_BRAND_ICON[isDarkTheme() ? 'dark' : 'light'];
  img.alt       = '';
  slot.appendChild(img);
}

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('iconMoon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('iconSun').classList.toggle('hidden', theme === 'light');
  applyAccent(theme);
  updateHeaderLogo();
  applyBrandIcon(brandIconUrl);
  if (save) localStorage.setItem('linkpage_theme', theme);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

/**
 * The shipped glyph, in the two cuts the public page uses. Kept in step with
 * DEFAULT_BRAND in public/js/core.js so both headers wear the same face. Declared
 * above the load-time applyTheme() below, which paints the glyph.
 */
const DEFAULT_BRAND_ICON = { light: '/brand/icon-light.png', dark: '/brand/icon-dark.png' };

const isDarkTheme = () =>
  (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';

applyTheme(getInitialTheme(), false);


// ─── 2. AUTHENTICATION ────────────────────────────────────────────────────────

const TOKEN_KEY = 'linkpage_admin_token';

/**
 * How this browser is authenticated: 'session' for a signed-in admin account,
 * 'token' for the admin token, null before either.
 *
 * It decides what happens on a 401. Clearing the stored token when the *session*
 * expired would throw away a working credential for an unrelated reason.
 */
let adminAuthMode = null;
let adminIdentity = null;

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
  // The wallpaper dresses the gate; the panel underneath has a look of its own.
  window.LinkPageTheme?.clearWallpaper();
  // The admin token is not an account: there is no password of its own to change.
  document.getElementById('yourAccountRow')?.classList.toggle('hidden', adminAuthMode !== 'session');
  await loadSettings();
  await loadAllData();
  renderChangelog().catch(() => {});
  // Fire-and-forget: a missing/slow GitHub response shouldn't block the UI.
  checkForUpdates().catch(() => {});
}

/**
 * Works out whether this browser is already an administrator, and lets it in.
 *
 * A session is checked first: it is the ordinary way in, and someone who is
 * signed in should not be held up by a stale token sitting in localStorage.
 * Falls through to the gate when neither answers.
 */
/**
 * Dresses the sign-in gate in the instance's look — wallpaper, fog, bar
 * opacity, accent — the way the public page and the sign-in page are dressed.
 * Asked for before anybody is signed in, since /api/settings is public.
 */
async function dressGate() {
  try {
    const settings = await fetch('/api/settings').then(r => r.json());
    // Still on the gate? Someone already signed in has no use for it.
    if (!document.getElementById('gate').classList.contains('hidden')) {
      window.LinkPageTheme?.applyAppearance(settings);
    }
  } catch { /* the gate works perfectly well undressed */ }
}

/**
 * A button for each single sign-on provider, coming back to this panel. The
 * trip and its failures belong to the sign-in page; this only starts it.
 */
let gatePasswordSignIn = true;   // false when single sign-on is the only way in

function showGateProviders(providers = []) {
  const box = document.getElementById('adminProviderButtons');
  if (!box) return;
  // Single sign-on only: no password form, and no "or" before the button.
  const passwords = providers.some(p => p.id === 'local');
  gatePasswordSignIn = passwords;
  document.getElementById('adminLoginForm').classList.toggle('hidden', !passwords);
  document.getElementById('usePasswordBtn').textContent =
    passwords ? 'Sign in with a password' : 'Back to single sign-on';
  document.querySelector('#adminProviderSection .gate-divider')?.classList.toggle('hidden', !passwords);
  box.replaceChildren(...providers.filter(p => p.url).map(p => {
    const a = document.createElement('a');
    a.className = 'btn btn-ghost gate-submit gate-provider';
    a.textContent = p.label;
    a.href = `${p.url}?next=${encodeURIComponent('/admin/')}`;
    return a;
  }));
  document.getElementById('adminProviderSection')
    .classList.toggle('hidden', box.childElementCount === 0);
}

async function resolveAdminIdentity() {
  try {
    const me = await fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { user: null }));
    showGateProviders(me.providers);

    if (me.user) {
      if (me.user.role === 'admin') {
        adminAuthMode = 'session';
        adminIdentity = me.user;
        return showAdminUI();
      }
      // Signed in, but not as an administrator. Say so rather than showing a
      // blank sign-in form to someone who is demonstrably already signed in.
      const intro = document.getElementById('gateIntro');
      if (intro) {
        intro.textContent =
          `You are signed in as ${me.user.email}, which is not an administrator account.`;
      }
    }
  } catch { /* offline, or the server is restarting — fall through to the gate */ }

  const t = getAdminToken();
  if (t && await verifyToken(t)) {
    adminAuthMode = 'token';
    await showAdminUI();
  }
}

document.getElementById('adminLoginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn    = document.getElementById('adminLoginBtn');
  const errBox = document.getElementById('adminLoginError');
  const email    = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;

  errBox.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Signing in…';

  try {
    const r = await fetch('/api/auth/login', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify({ email, password }),
    });
    const data = await r.json().catch(() => ({}));

    if (r.ok && data.user?.role === 'admin') {
      adminAuthMode = 'session';
      adminIdentity = data.user;
      await showAdminUI();
      return;
    }

    errBox.textContent = r.status === 429
      ? 'Too many attempts. Try again in a few minutes.'
      : r.ok
        ? 'That account is not an administrator.'
        : 'Wrong email or password.';
    errBox.classList.remove('hidden');
    document.getElementById('adminPassword').select();
  } catch {
    errBox.textContent = 'Could not reach the server. Is it running?';
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

document.getElementById('togglePasswordBtn').addEventListener('click', e => {
  const input   = document.getElementById('adminPassword');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  e.currentTarget.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  input.focus();
});

/** Swaps between the password form and the token form. */
function showGateForm(which) {
  const password = which === 'password';
  document.getElementById('adminLoginForm').classList.toggle('hidden', !password || !gatePasswordSignIn);
  document.getElementById('useTokenBtn').classList.toggle('hidden', !password);
  // Single sign-on belongs with the account sign-in, not the break-glass token.
  const providers = document.getElementById('adminProviderSection');
  if (document.getElementById('adminProviderButtons').childElementCount > 0) {
    providers.classList.toggle('hidden', !password);
  }
  document.getElementById('gateForm').classList.toggle('hidden', password);
  document.getElementById('usePasswordBtn').classList.toggle('hidden', password);
  (password
    ? (gatePasswordSignIn ? document.getElementById('adminEmail')
                          : document.querySelector('#adminProviderButtons a'))
    : document.getElementById('tokenInput'))?.focus();
}
document.getElementById('useTokenBtn').addEventListener('click', () => showGateForm('token'));
document.getElementById('usePasswordBtn').addEventListener('click', () => showGateForm('password'));

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
      adminAuthMode = 'token';
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

document.getElementById('logoutBtn').addEventListener('click', async () => {
  // End the session on the server as well, not only in this browser. Clearing
  // the token too covers the case of having used both.
  if (adminAuthMode === 'session') {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* leaving anyway */ }
  }
  clearAdminToken();
  location.reload();
});


// ─── 3. SERVER CALLS ─────────────────────────────────────────────────────────

// One reload, however many requests were in flight when authentication died.
// loadAllData fires a dozen at once, and each one used to call location.reload()
// on its own.
let reloadingAfterAuthLoss = false;

async function sendAuthRequest(url, opts = {}) {
  const headers = { ...opts.headers };
  // Only when there is one. Sending an empty header made every request look
  // like a failed token attempt.
  const token = getAdminToken();
  if (token) headers['X-Admin-Token'] = token;

  const r = await fetch(url, { ...opts, headers, credentials: 'same-origin' });

  if (r.status === 401) {
    // A dead session is not a reason to throw away a perfectly good token.
    if (adminAuthMode === 'token') clearAdminToken();
    if (!reloadingAfterAuthLoss) {
      reloadingAfterAuthLoss = true;
      location.reload();
    }
  }
  return r;
}

const apiJson = (url, opts) => sendAuthRequest(url, opts).then(r => r.json());

// ?view=admin: the panel shows every link, hidden ones included. The public
// page's own fetch of the same list must not, so the wide view is asked for.
async function fetchLinks()            { return apiJson('/api/links?view=admin'); }
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

async function uploadWallpaper(variant, file) {
  const fd = new FormData(); fd.append('wallpaper', file);
  return apiJson(`/api/settings/wallpaper/${variant}`, { method: 'POST', body: fd });
}
async function removeWallpaper(variant) {
  return sendAuthRequest(`/api/settings/wallpaper/${variant}`, { method: 'DELETE' });
}
async function saveWallpaperFog(fog) { return jsonPost('/api/settings/wallpaper-fog', { fog }); }
async function saveBarOpacity(opacity) { return jsonPost('/api/settings/bar-opacity', { opacity }); }

async function uploadBrandIcon(file) {
  const fd = new FormData(); fd.append('icon', file);
  return apiJson('/api/settings/brand-icon', { method: 'POST', body: fd });
}
async function setBrandIconFromLibrary(iconId) {
  return jsonPost('/api/settings/brand-icon', { icon_id: iconId });
}
async function removeBrandIconApi() {
  return sendAuthRequest('/api/settings/brand-icon', { method: 'DELETE' });
}

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

async function setRequestsEnabled(enabled) { return jsonPost('/api/settings/requests-enabled', { enabled }); }
async function setRequestPassword(pw)      { return jsonPost('/api/settings/request-password', { password: pw }); }
async function removeRequestPassword()     { return sendAuthRequest('/api/settings/request-password', { method: 'DELETE' }); }
async function saveTheme(patch)            { return jsonPost('/api/settings/theme', patch); }

async function fetchLinkRequests(status = 'pending') { return apiJson(`/api/link-requests?status=${status}`); }
async function approveRequestApi(id, linkId) { return jsonPost(`/api/link-requests/${id}/approve`, { link_id: linkId }); }
// Approves without duplicating: the existing link joins the requested group.
async function attachRequestApi(id)          { return jsonPost(`/api/link-requests/${id}/attach`, {}); }
// Approves a change request by writing its proposed values onto the target link.
async function applyRequestApi(id)           { return jsonPost(`/api/link-requests/${id}/apply`, {}); }
async function rejectRequestApi(id)          { return jsonPost(`/api/link-requests/${id}/reject`, {}); }
async function deleteRequestApi(id)          { return sendAuthRequest(`/api/link-requests/${id}`, { method: 'DELETE' }); }

async function fetchIpTags()         { return apiJson('/api/ip-tags'); }
async function saveIpTagApi(ip, tag) { return jsonPost('/api/ip-tags', { ip_address: ip, tag }); }
async function deleteIpTagApi(ip)    { return sendAuthRequest(`/api/ip-tags/${encodeURIComponent(ip)}`, { method: 'DELETE' }); }

async function fetchAnalytics(period = '30d') { return apiJson(`/api/analytics?period=${encodeURIComponent(period)}`); }

// Cache of ip -> tag, so an attribution tag can be shown wherever an IP appears
// (stats modal, requests list). Refreshed whenever those surfaces open.
let ipTagMap = {};
function refreshIpTagMap() {
  return fetchIpTags()
    .then(data => { ipTagMap = {}; (data.ips || []).forEach(r => { if (r.tag) ipTagMap[r.ip_address] = r.tag; }); })
    .catch(() => { /* non-critical */ });
}
function ipTagChip(ip) {
  const t = ipTagMap[ip];
  return t ? ` <span class="ip-tag-chip" title="Attributed to">${escapeHtml(t)}</span>` : '';
}

