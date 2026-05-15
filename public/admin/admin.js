/**
 * Admin page — link and group management with token authentication.
 *
 * File structure:
 *  1.  THEME          — light/dark switching
 *  2.  AUTHENTICATION — token gate logic
 *  3.  SERVER CALLS   — all fetch wrappers
 *  4.  BRANDING       — logo upload and header display
 *  5.  HELPERS        — shared utility functions
 *  6.  STATE          — global data variables
 *  7.  DATA LOADING   — fetching from the API
 *  8.  SIDEBAR        — rendering and group nav
 *  9.  LINK CARDS     — building and rendering the grid
 *  10. LINK MODAL     — add/edit link form
 *  11. DELETE LINK    — confirmation flow
 *  12. GROUP MODAL    — add/edit group form
 *  13. DELETE GROUP   — confirmation flow
 *  14. SIDEBAR TOGGLE — mobile/desktop collapse
 *  15. NAV & SEARCH   — filter events
 *  16. MODAL CLOSE    — overlay clicks and Escape key
 *  17. STARTUP        — boot sequence
 */


// These must be declared before anything runs because applyTheme (called
// during theme init below) calls updateHeaderLogo → getLogoForCurrentTheme,
// which reads these variables. They are populated later by loadLogos().
let logoLightUrl = null;
let logoDarkUrl  = null;


// ─── 1. THEME ─────────────────────────────────────────────────────────────────

/** Returns the saved theme, the OS preference, or 'light' as a last resort. */
function getInitialTheme() {
  const savedTheme  = localStorage.getItem('linkpage_theme');
  if (savedTheme) return savedTheme;

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Applies a theme by setting data-theme on <html>.
 * CSS variables in style.css react to this automatically.
 * Also updates the toggle icon and refreshes the header logo.
 */
function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);

  document.getElementById('iconMoon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('iconSun').classList.toggle('hidden', theme === 'light');

  // The header logo may differ between light and dark
  updateHeaderLogo();

  if (save) localStorage.setItem('linkpage_theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(currentTheme === 'light' ? 'dark' : 'light');
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// Apply immediately so the page never briefly shows the wrong colors
applyTheme(getInitialTheme(), false);


// ─── 2. AUTHENTICATION ────────────────────────────────────────────────────────

const TOKEN_STORAGE_KEY = 'linkpage_admin_token';

function getAdminToken()          { return localStorage.getItem(TOKEN_STORAGE_KEY) || ''; }
function saveAdminToken(token)    { localStorage.setItem(TOKEN_STORAGE_KEY, token); }
function clearAdminToken()        { localStorage.removeItem(TOKEN_STORAGE_KEY); }

/** Asks the server whether a token is valid. Returns true or false. */
async function verifyToken(token) {
  const response = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const result = await response.json();
  return result.valid === true;
}

/** Shows the admin UI and loads all data. Called after successful auth. */
async function showAdminUI() {
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('adminWrap').classList.remove('hidden');
  await loadLogos();
  await loadAllData();
}

/**
 * Checks the stored token on startup.
 * If valid, enters the admin UI directly.
 * Otherwise, shows the gate (token input form).
 */
async function checkStoredToken() {
  const storedToken = getAdminToken();
  if (storedToken && await verifyToken(storedToken)) {
    await showAdminUI();
  }
  // If no valid token, the gate is already visible — nothing else to do.
}

// Gate form: verify the entered token and enter the admin UI
document.getElementById('gateForm').addEventListener('submit', async event => {
  event.preventDefault();

  const token    = document.getElementById('tokenInput').value.trim();
  const submitBtn = document.getElementById('gateSubmitBtn');
  const errorBox  = document.getElementById('gateError');

  errorBox.classList.add('hidden');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Verifying…';

  try {
    const isValid = await verifyToken(token);

    if (isValid) {
      saveAdminToken(token);
      await showAdminUI();
    } else {
      errorBox.classList.remove('hidden');
      document.getElementById('tokenInput').focus();
    }
  } catch {
    errorBox.textContent = 'Could not reach the server. Is it running?';
    errorBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Unlock Admin';
  }
});

// Show/hide the token text in the password input
document.getElementById('toggleVisibilityBtn').addEventListener('click', () => {
  const input = document.getElementById('tokenInput');
  input.type  = input.type === 'password' ? 'text' : 'password';
});

// Logout: clear the stored token and show the gate again
document.getElementById('logoutBtn').addEventListener('click', () => {
  clearAdminToken();
  location.reload();
});


// ─── 3. SERVER CALLS ─────────────────────────────────────────────────────────

/**
 * Sends an authenticated request to the server.
 * Attaches the admin token as a request header.
 * If the server returns 401 (unauthorized), clears the token and reloads
 * so the user is shown the token gate again.
 */
async function sendAuthRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'X-Admin-Token': getAdminToken(),
    },
  });

  if (response.status === 401) {
    // Token is no longer valid — force a fresh login
    clearAdminToken();
    location.reload();
  }

  return response;
}

// Link API calls
async function fetchLinks()               { return fetch('/api/links').then(r => r.json()); }
async function fetchGroups()              { return fetch('/api/groups').then(r => r.json()); }
async function fetchSettings()            { return fetch('/api/settings').then(r => r.json()); }
async function fetchAllStats()            { return sendAuthRequest('/api/stats').then(r => r.json()); }
async function fetchLinkClicks(linkId)    { return sendAuthRequest(`/api/links/${linkId}/clicks`).then(r => r.json()); }

async function createLink(formData)       { return sendAuthRequest('/api/links', { method: 'POST', body: formData }).then(r => r.json()); }
async function updateLink(id, formData)   { return sendAuthRequest(`/api/links/${id}`, { method: 'PUT', body: formData }).then(r => r.json()); }
async function deleteLinkById(id)         { return sendAuthRequest(`/api/links/${id}`, { method: 'DELETE' }); }

async function createGroup(data)          { return sendAuthRequest('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()); }
async function updateGroup(id, data)      { return sendAuthRequest(`/api/groups/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json()); }
async function deleteGroupById(id)        { return sendAuthRequest(`/api/groups/${id}`, { method: 'DELETE' }); }

async function uploadLogo(variant, file) {
  const formData = new FormData();
  formData.append('logo', file);
  return sendAuthRequest(`/api/settings/logo/${variant}`, { method: 'POST', body: formData }).then(r => r.json());
}

async function removeLogo(variant)        { return sendAuthRequest(`/api/settings/logo/${variant}`, { method: 'DELETE' }); }


// ─── 4. BRANDING ──────────────────────────────────────────────────────────────

/** Fetches both logo URLs from the server and updates the header. */
async function loadLogos() {
  const settings = await fetchSettings();
  logoLightUrl   = settings.logo_light || null;
  logoDarkUrl    = settings.logo_dark  || null;
  updateHeaderLogo();
}

/**
 * Returns the logo URL for the current theme, or null if none was uploaded.
 * Light mode → light logo only. Dark mode → dark logo only.
 * No cross-mode fallback — a missing logo shows "LinkPage" text instead.
 */
function getLogoForCurrentTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  return theme === 'dark' ? logoDarkUrl : logoLightUrl;
}

/** Shows the logo image in the header, or the "LinkPage" text if no logo exists. */
function updateHeaderLogo() {
  const logoUrl  = getLogoForCurrentTheme();
  const logoImage = document.getElementById('brandImg');
  const logoText  = document.getElementById('brandText');

  if (logoUrl) {
    logoImage.src = logoUrl;
    logoImage.classList.remove('hidden');
    logoText.classList.add('hidden');
  } else {
    logoImage.classList.add('hidden');
    logoText.classList.remove('hidden');
  }
}

/**
 * Refreshes the preview image and "Remove" button in the settings modal.
 * @param {'light'|'dark'} variant
 * @param {string|null}    logoUrl
 */
function updateSettingsPreview(variant, logoUrl) {
  const previewImg   = document.getElementById(variant === 'light' ? 'lightLogoPreview' : 'darkLogoPreview');
  const removeButton = document.getElementById(variant === 'light' ? 'removeLightLogoBtn' : 'removeDarkLogoBtn');

  if (logoUrl) {
    previewImg.src = logoUrl;
    previewImg.classList.remove('hidden');
    removeButton.classList.remove('hidden');
  } else {
    previewImg.classList.add('hidden');
    removeButton.classList.add('hidden');
  }
}

// Open settings modal and sync preview images with current logo state
document.getElementById('openSettingsBtn').addEventListener('click', () => {
  updateSettingsPreview('light', logoLightUrl);
  updateSettingsPreview('dark',  logoDarkUrl);
  document.getElementById('settingsOverlay').classList.remove('hidden');
});

document.getElementById('closeSettingsBtn').addEventListener('click', () =>
  document.getElementById('settingsOverlay').classList.add('hidden'));

// Light logo upload
document.getElementById('uploadLightLogoBtn').addEventListener('click', () =>
  document.getElementById('lightLogoFileInput').click());

document.getElementById('lightLogoFileInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const result  = await uploadLogo('light', file);
  logoLightUrl  = result.logo_url;
  updateHeaderLogo();
  updateSettingsPreview('light', logoLightUrl);
  event.target.value = ''; // Reset so the same file can be re-uploaded if needed
});

// Dark logo upload
document.getElementById('uploadDarkLogoBtn').addEventListener('click', () =>
  document.getElementById('darkLogoFileInput').click());

document.getElementById('darkLogoFileInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const result = await uploadLogo('dark', file);
  logoDarkUrl  = result.logo_url;
  updateHeaderLogo();
  updateSettingsPreview('dark', logoDarkUrl);
  event.target.value = '';
});

// Remove light logo
document.getElementById('removeLightLogoBtn').addEventListener('click', async () => {
  await removeLogo('light');
  logoLightUrl = null;
  updateHeaderLogo();
  updateSettingsPreview('light', null);
});

// Remove dark logo
document.getElementById('removeDarkLogoBtn').addEventListener('click', async () => {
  await removeLogo('dark');
  logoDarkUrl = null;
  updateHeaderLogo();
  updateSettingsPreview('dark', null);
});


// ─── 5. HELPERS ──────────────────────────────────────────────────────────────

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Always use this when inserting user-supplied text into the DOM.
 */
function escapeHtml(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return String(text ?? '').replace(/[&<>"']/g, char => entities[char]);
}

/** Returns a Google Favicon URL, or null if the URL is invalid. */
function getFaviconUrl(siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return null;
  }
}

/** Returns just the domain name (e.g. "github.com") from a full URL. */
function getDomainName(siteUrl) {
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return siteUrl;
  }
}

/** Formats an ISO date string as a short readable date like "May 14, 2026". */
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  });
}

// Apple system colors used as group color options
const GROUP_COLORS = [
  '#0071e3', // Blue
  '#5856d6', // Purple
  '#af52de', // Violet
  '#ff2d55', // Pink
  '#ff3b30', // Red
  '#ff9500', // Orange
  '#34c759', // Green
  '#00c7be', // Teal
  '#007aff', // Blue alt
  '#8e8e93', // Gray
];

/**
 * Converts a UTC date string from SQLite ("2026-05-14 20:31:22") into a
 * human-readable relative time like "3h ago" or "May 14".
 * SQLite stores timestamps without a timezone suffix, so we append "Z"
 * to tell JavaScript to treat them as UTC instead of local time.
 */
function timeAgo(isoString) {
  if (!isoString) return 'Never';

  const date    = new Date(isoString.replace(' ', 'T') + 'Z');
  const seconds = Math.floor((Date.now() - date) / 1000);

  if (seconds < 60)               return 'Just now';
  if (seconds < 3600)             return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400)            return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400)        return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Returns 'Mobile' or 'Desktop' based on the user-agent string. */
function getDeviceType(userAgent) {
  if (!userAgent) return 'Unknown';
  return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? 'Mobile' : 'Desktop';
}

// SVG shown when a favicon or custom icon fails to load
const FALLBACK_ICON_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>`;

function showFormError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideFormError(elementId) {
  document.getElementById(elementId).classList.add('hidden');
}


// ─── 6. STATE ─────────────────────────────────────────────────────────────────

let links       = [];        // All links from the server
let groups      = [];        // All groups from the server
let activeGroup = 'all';     // 'all', 'ungrouped', or a numeric group ID
let searchQuery = '';        // Current search text
let statsMap    = {};        // Click stats keyed by link_id, e.g. { 5: { total_clicks: 42, ... } }


// ─── 7. DATA LOADING ──────────────────────────────────────────────────────────

/** Fetches links, groups, and click stats together, then re-renders everything. */
async function loadAllData() {
  const [fetchedLinks, fetchedGroups, fetchedStats] = await Promise.all([
    fetchLinks(),
    fetchGroups(),
    fetchAllStats(),
  ]);

  links  = fetchedLinks;
  groups = fetchedGroups;

  // Build a lookup map so cards can find their stats by link ID in O(1)
  statsMap = {};
  fetchedStats.forEach(stat => {
    statsMap[stat.link_id] = stat;
  });

  renderSidebar();
  renderLinks();
}


// ─── 8. SIDEBAR ───────────────────────────────────────────────────────────────

/** Rebuilds the sidebar nav (counts + group list) based on current state. */
function renderSidebar() {
  document.getElementById('countAll').textContent       = links.length;
  document.getElementById('countUngrouped').textContent = links.filter(link => !link.group_id).length;

  // Highlight the correct built-in nav item
  document.querySelectorAll('.nav-item').forEach(button => {
    button.classList.toggle('active', button.dataset.group === String(activeGroup));
  });

  // Rebuild the groups list
  const groupsNav = document.getElementById('groupsNav');
  groupsNav.innerHTML = groups.map(group => {
    const linkCount = links.filter(link => link.group_id === group.id).length;
    const isActive  = activeGroup === group.id;

    const countStyle = isActive
      ? `background:${group.color}18; color:${group.color}`
      : '';

    return `
      <div class="group-nav-item${isActive ? ' active' : ''}" data-group-id="${group.id}">
        <span class="group-dot" style="background:${escapeHtml(group.color)}"></span>
        <span>${escapeHtml(group.name)}</span>
        <span class="nav-count" style="${countStyle}">${linkCount}</span>
        <div class="group-item-actions">
          <button class="group-action-btn edit-group-btn" data-group-id="${group.id}" title="Edit group">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="group-action-btn danger delete-group-btn" data-group-id="${group.id}" title="Delete group">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');

  // Attach click events to the newly created group items
  groupsNav.querySelectorAll('.group-nav-item').forEach(item => {
    item.addEventListener('click', event => {
      // Don't trigger navigation if the user clicked an action button
      if (event.target.closest('.group-item-actions')) return;
      activeGroup = Number(item.dataset.groupId);
      renderSidebar();
      renderLinks();
    });
  });

  groupsNav.querySelectorAll('.edit-group-btn').forEach(btn =>
    btn.addEventListener('click', event => {
      event.stopPropagation();
      openEditGroupModal(Number(btn.dataset.groupId));
    }));

  groupsNav.querySelectorAll('.delete-group-btn').forEach(btn =>
    btn.addEventListener('click', event => {
      event.stopPropagation();
      openDeleteGroupModal(Number(btn.dataset.groupId));
    }));
}


// ─── 9. LINK CARDS ────────────────────────────────────────────────────────────

/** Returns links that match the active group tab and search query. */
function getFilteredLinks() {
  let filtered = links;

  if (activeGroup === 'ungrouped') {
    filtered = filtered.filter(link => !link.group_id);
  } else if (activeGroup !== 'all') {
    filtered = filtered.filter(link => link.group_id === activeGroup);
  }

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(link =>
      link.name.toLowerCase().includes(query) ||
      link.url.toLowerCase().includes(query)  ||
      (link.description || '').toLowerCase().includes(query)
    );
  }

  return filtered;
}

/** Builds the icon <img> element with a fallback for failed loads. */
function buildIconHtml(iconUrl) {
  if (!iconUrl) return FALLBACK_ICON_SVG;

  return `
    <img src="${escapeHtml(iconUrl)}" alt="" loading="lazy"
         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
    <span style="display:none">${FALLBACK_ICON_SVG}</span>`;
}

/** Builds a colored group badge element for links that belong to a group. */
function buildGroupBadgeHtml(link) {
  const style = `background:${link.group_color}18; color:${link.group_color}`;
  return `
    <div class="link-footer">
      <span class="group-badge" style="${style}">${escapeHtml(link.group_name)}</span>
    </div>`;
}

/** Builds a single link card DOM element with stats, edit, and delete buttons. */
function buildLinkCard(link) {
  const card = document.createElement('div');
  card.className = 'link-card';

  const stats           = statsMap[link.id];
  const iconUrl         = link.image_path || getFaviconUrl(link.url);
  const iconHtml        = buildIconHtml(iconUrl);
  const badgeHtml       = link.group_name ? buildGroupBadgeHtml(link) : '';
  const descriptionHtml = link.description
    ? `<p class="link-desc">${escapeHtml(link.description)}</p>`
    : '';

  // Show a small click count below the group badge (only if the link has been clicked)
  const clickCountHtml = stats
    ? `<div class="card-click-count">
         <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
           <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
           <circle cx="12" cy="12" r="3"/>
         </svg>
         ${stats.total_clicks} click${stats.total_clicks !== 1 ? 's' : ''}
         &nbsp;·&nbsp;
         ${stats.unique_visitors} unique
       </div>`
    : '';

  card.innerHTML = `
    <div class="link-icon">${iconHtml}</div>
    <div class="link-body">
      <div class="link-name">${escapeHtml(link.name)}</div>
      <a class="link-url" href="${escapeHtml(link.url)}"
         target="_blank" rel="noopener noreferrer">
        ${escapeHtml(getDomainName(link.url))}
      </a>
      ${descriptionHtml}
      ${badgeHtml}
      ${clickCountHtml}
    </div>
    <div class="link-side">
      <div class="link-actions">
        <button class="icon-btn stats-link-btn" title="View click stats">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </button>
        <button class="icon-btn edit-link-btn" title="Edit link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn danger delete-link-btn" title="Delete link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
      <span class="link-date">${formatDate(link.created_at)}</span>
    </div>`;

  card.querySelector('.stats-link-btn').addEventListener('click',  () => openStatsModal(link));
  card.querySelector('.edit-link-btn').addEventListener('click',   () => openEditLinkModal(link));
  card.querySelector('.delete-link-btn').addEventListener('click', () => openDeleteLinkModal(link));

  return card;
}

/** Clears the grid and renders all links that pass the current filters. */
function renderLinks() {
  const grid          = document.getElementById('linksGrid');
  const emptyState    = document.getElementById('emptyState');
  const emptyMessage  = document.getElementById('emptyMsg');
  const filteredLinks = getFilteredLinks();

  grid.innerHTML = '';

  if (filteredLinks.length === 0) {
    emptyState.classList.remove('hidden');

    if (searchQuery) {
      emptyMessage.textContent = `No results for "${searchQuery}"`;
    } else if (activeGroup === 'ungrouped') {
      emptyMessage.textContent = 'No ungrouped links.';
    } else if (activeGroup !== 'all') {
      emptyMessage.textContent = 'No links in this group yet.';
    } else {
      emptyMessage.textContent = 'No links yet. Add your first one!';
    }

    return;
  }

  emptyState.classList.add('hidden');
  filteredLinks.forEach(link => grid.appendChild(buildLinkCard(link)));
}


// ─── 10. STATS MODAL ──────────────────────────────────────────────────────────

/**
 * Opens the stats modal for a link.
 * Shows aggregate numbers immediately (from the already-loaded statsMap),
 * then fetches the detailed click log and top IPs asynchronously.
 */
async function openStatsModal(link) {
  const stats = statsMap[link.id];

  // Populate the header
  document.getElementById('statsLinkName').textContent = link.name;
  document.getElementById('statsLinkUrl').textContent  = getDomainName(link.url);

  // Populate the summary boxes from the cached stats
  document.getElementById('statTotal').textContent  = stats ? stats.total_clicks    : 0;
  document.getElementById('statUnique').textContent = stats ? stats.unique_visitors  : 0;
  document.getElementById('statToday').textContent  = stats ? stats.clicks_today     : 0;
  document.getElementById('statWeek').textContent   = stats ? stats.clicks_this_week : 0;

  document.getElementById('statsLastSeen').textContent = (stats && stats.last_clicked)
    ? `Last visited ${timeAgo(stats.last_clicked)}`
    : 'No clicks recorded yet';

  // Show loading placeholders while we fetch the detailed data
  document.getElementById('recentClicksContainer').innerHTML = '<div class="stats-loading">Loading…</div>';
  document.getElementById('topIpsContainer').innerHTML       = '<div class="stats-loading">Loading…</div>';

  document.getElementById('statsOverlay').classList.remove('hidden');

  // Fetch the full click log
  const details = await fetchLinkClicks(link.id);
  renderRecentClicks(details.recentClicks);
  renderTopIps(details.topIps);
}

/** Renders the recent clicks table inside the stats modal. */
function renderRecentClicks(clicks) {
  const container = document.getElementById('recentClicksContainer');

  if (clicks.length === 0) {
    container.innerHTML = '<div class="stats-empty">No clicks recorded yet</div>';
    return;
  }

  const rowsHtml = clicks.map(click => `
    <div class="click-row">
      <span class="click-ip">${escapeHtml(click.ip_address)}</span>
      <span class="click-device">${escapeHtml(getDeviceType(click.user_agent))}</span>
      <span class="click-time">${timeAgo(click.clicked_at)}</span>
    </div>`).join('');

  container.innerHTML = `<div class="click-log">${rowsHtml}</div>`;
}

/** Renders the top IPs table with a proportional bar chart. */
function renderTopIps(topIps) {
  const container = document.getElementById('topIpsContainer');

  if (topIps.length === 0) {
    container.innerHTML = '<div class="stats-empty">No data yet</div>';
    return;
  }

  const highestCount = topIps[0].click_count; // First row always has the highest count

  const rowsHtml = topIps.map(ip => {
    const barWidth   = Math.round((ip.click_count / highestCount) * 100);
    const clickLabel = `${ip.click_count} click${ip.click_count !== 1 ? 's' : ''}`;

    return `
      <div class="click-row">
        <span class="click-ip">${escapeHtml(ip.ip_address)}</span>
        <div class="click-bar-wrap">
          <div class="click-bar" style="width:${barWidth}%"></div>
        </div>
        <span class="click-count">${escapeHtml(clickLabel)}</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="click-log">${rowsHtml}</div>`;
}

document.getElementById('closeStatsBtn').addEventListener('click', () =>
  document.getElementById('statsOverlay').classList.add('hidden'));


// ─── 11. LINK MODAL ───────────────────────────────────────────────────────────

// Whether to remove the custom icon when saving (set true when user clicks ✕)
let shouldRemoveCustomIcon = false;

/** Fills the group dropdown with all current groups. */
function populateGroupDropdown(selectedGroupId) {
  const dropdown = document.getElementById('inputGroup');
  dropdown.innerHTML = '<option value="">None</option>' +
    groups.map(group =>
      `<option value="${group.id}"${group.id === selectedGroupId ? ' selected' : ''}>
         ${escapeHtml(group.name)}
       </option>`
    ).join('');
}

/** Opens the modal in "add" mode with a blank form. */
function openAddLinkModal() {
  shouldRemoveCustomIcon = false;

  document.getElementById('linkModalTitle').textContent = 'Add Link';
  document.getElementById('editingLinkId').value        = '';
  document.getElementById('linkForm').reset();
  document.getElementById('faviconImg').className       = '';
  document.getElementById('faviconImg').src             = '';

  clearCustomIconPreview();
  hideFormError('linkFormError');

  // Pre-select the active group if the user is browsing a specific group
  const groupToPreselect = (activeGroup !== 'all' && activeGroup !== 'ungrouped')
    ? activeGroup
    : null;
  populateGroupDropdown(groupToPreselect);

  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

/** Opens the modal in "edit" mode, pre-filled with the link's current data. */
function openEditLinkModal(link) {
  shouldRemoveCustomIcon = false;

  document.getElementById('linkModalTitle').textContent = 'Edit Link';
  document.getElementById('editingLinkId').value        = link.id;
  document.getElementById('inputName').value            = link.name;
  document.getElementById('inputUrl').value             = link.url;
  document.getElementById('inputDesc').value            = link.description || '';

  populateGroupDropdown(link.group_id);

  // Show the auto-fetched favicon
  const faviconImg = document.getElementById('faviconImg');
  const faviconUrl = getFaviconUrl(link.url);
  if (faviconUrl) {
    faviconImg.src       = faviconUrl;
    faviconImg.className = 'visible';
  } else {
    faviconImg.src       = '';
    faviconImg.className = '';
  }

  // Show the existing custom icon if there is one
  if (link.image_path) {
    showCustomIconPreview(link.image_path);
  } else {
    clearCustomIconPreview();
  }

  hideFormError('linkFormError');
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function closeLinkModal() {
  document.getElementById('linkModalOverlay').classList.add('hidden');
}

/** Shows the custom icon preview and hides the upload area. */
function showCustomIconPreview(src) {
  document.getElementById('iconPreviewImg').src = src;
  document.getElementById('iconPreviewWrap').classList.remove('hidden');
  document.getElementById('iconUploadArea').classList.add('hidden');
}

/** Hides the icon preview and shows the upload area. */
function clearCustomIconPreview() {
  document.getElementById('iconPreviewWrap').classList.add('hidden');
  document.getElementById('iconUploadArea').classList.remove('hidden');
  document.getElementById('iconPreviewImg').src = '';
}

// Auto-fetch favicon when the user types a URL (debounced to avoid too many requests)
let faviconFetchTimer;
document.getElementById('inputUrl').addEventListener('input', event => {
  clearTimeout(faviconFetchTimer);
  faviconFetchTimer = setTimeout(() => {
    const faviconUrl = getFaviconUrl(event.target.value);
    const faviconImg = document.getElementById('faviconImg');

    if (faviconUrl) {
      faviconImg.src    = faviconUrl;
      faviconImg.onload = () => faviconImg.className = 'visible';
      faviconImg.onerror = () => faviconImg.className = '';
    } else {
      faviconImg.src       = '';
      faviconImg.className = '';
    }
  }, 400); // Wait 400ms after the user stops typing
});

// Open the file picker when the upload area is clicked
document.getElementById('iconUploadArea').addEventListener('click', () =>
  document.getElementById('inputImage').click());

// Show a preview when the user picks an image file
document.getElementById('inputImage').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;

  const reader  = new FileReader();
  reader.onload = e => showCustomIconPreview(e.target.result);
  reader.readAsDataURL(file);

  shouldRemoveCustomIcon = false;
});

// Remove custom icon button
document.getElementById('removeCustomIconBtn').addEventListener('click', () => {
  shouldRemoveCustomIcon = true;
  clearCustomIconPreview();
  document.getElementById('inputImage').value = '';
});

// Link form submit
document.getElementById('linkForm').addEventListener('submit', async event => {
  event.preventDefault();
  hideFormError('linkFormError');

  const linkId    = document.getElementById('editingLinkId').value;
  const formData  = new FormData();

  formData.append('name',         document.getElementById('inputName').value.trim());
  formData.append('url',          document.getElementById('inputUrl').value.trim());
  formData.append('description',  document.getElementById('inputDesc').value.trim());
  formData.append('group_id',     document.getElementById('inputGroup').value);
  formData.append('remove_image', shouldRemoveCustomIcon ? 'true' : 'false');

  const imageFile = document.getElementById('inputImage').files[0];
  if (imageFile) formData.append('image', imageFile);

  const saveBtn          = document.getElementById('saveLinkBtn');
  saveBtn.disabled       = true;
  saveBtn.textContent    = 'Saving…';

  try {
    const result = linkId
      ? await updateLink(linkId, formData)
      : await createLink(formData);

    if (result?.error) {
      showFormError('linkFormError', result.error);
      return;
    }

    closeLinkModal();
    await loadAllData();
  } catch {
    showFormError('linkFormError', 'Something went wrong. Please try again.');
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Link';
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
  await loadAllData();
});

document.getElementById('cancelDeleteLinkBtn').addEventListener('click', () =>
  document.getElementById('deleteLinkOverlay').classList.add('hidden'));


// ─── 12. GROUP MODAL ──────────────────────────────────────────────────────────

/**
 * Renders the color swatch palette, with the selected color highlighted.
 * @param {string} selectedColor - Hex color that should appear selected
 */
function buildColorPalette(selectedColor) {
  const palette = document.getElementById('colorPalette');

  palette.innerHTML = GROUP_COLORS.map(color =>
    `<div class="color-swatch${color === selectedColor ? ' selected' : ''}"
          data-color="${color}"
          style="background:${color}"
          title="${color}">
     </div>`
  ).join('');

  palette.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      document.getElementById('groupColorInput').value = swatch.dataset.color;
    });
  });
}

function openAddGroupModal() {
  document.getElementById('groupModalTitle').textContent  = 'New Group';
  document.getElementById('editingGroupId').value         = '';
  document.getElementById('groupNameInput').value         = '';
  document.getElementById('groupColorInput').value        = GROUP_COLORS[0];
  buildColorPalette(GROUP_COLORS[0]);
  hideFormError('groupFormError');
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function openEditGroupModal(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  document.getElementById('groupModalTitle').textContent  = 'Edit Group';
  document.getElementById('editingGroupId').value         = group.id;
  document.getElementById('groupNameInput').value         = group.name;
  document.getElementById('groupColorInput').value        = group.color;
  buildColorPalette(group.color);
  hideFormError('groupFormError');
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function closeGroupModal() {
  document.getElementById('groupModalOverlay').classList.add('hidden');
}

document.getElementById('groupForm').addEventListener('submit', async event => {
  event.preventDefault();
  hideFormError('groupFormError');

  const groupId   = document.getElementById('editingGroupId').value;
  const groupName = document.getElementById('groupNameInput').value.trim();
  const groupColor = document.getElementById('groupColorInput').value;

  if (!groupName) return;

  try {
    const result = groupId
      ? await updateGroup(groupId, { name: groupName, color: groupColor })
      : await createGroup({ name: groupName, color: groupColor });

    if (result?.error) {
      showFormError('groupFormError', result.error);
      return;
    }

    closeGroupModal();
    await loadAllData();
  } catch {
    showFormError('groupFormError', 'Something went wrong. Please try again.');
  }
});

document.getElementById('openAddGroupBtn').addEventListener('click', openAddGroupModal);
document.getElementById('closeGroupModalBtn').addEventListener('click', closeGroupModal);
document.getElementById('cancelGroupModalBtn').addEventListener('click', closeGroupModal);


// ─── 13. DELETE GROUP ─────────────────────────────────────────────────────────

let pendingDeleteGroupId = null;

function openDeleteGroupModal(groupId) {
  pendingDeleteGroupId = groupId;
  const group = groups.find(g => g.id === groupId);
  document.getElementById('deleteGroupNameLabel').textContent = group?.name ?? '';
  document.getElementById('deleteGroupOverlay').classList.remove('hidden');
}

document.getElementById('confirmDeleteGroupBtn').addEventListener('click', async () => {
  if (!pendingDeleteGroupId) return;
  await deleteGroupById(pendingDeleteGroupId);

  // If the deleted group was selected, go back to "All"
  if (activeGroup === pendingDeleteGroupId) activeGroup = 'all';

  pendingDeleteGroupId = null;
  document.getElementById('deleteGroupOverlay').classList.add('hidden');
  await loadAllData();
});

document.getElementById('cancelDeleteGroupBtn').addEventListener('click', () =>
  document.getElementById('deleteGroupOverlay').classList.add('hidden'));


// ─── 14. SIDEBAR TOGGLE ───────────────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');

function toggleSidebar() {
  const isMobile = window.innerWidth <= 720;

  if (isMobile) {
    // On mobile: sidebar slides over the content
    sidebar.classList.toggle('open');
  } else {
    // On desktop: sidebar pushes the content
    sidebar.classList.toggle('collapsed');
    const mainContent = document.getElementById('mainContent');
    mainContent.style.marginLeft = sidebar.classList.contains('collapsed') ? '0' : '';
  }
}

document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);

// Close the mobile sidebar when the user taps outside of it
document.addEventListener('click', event => {
  const isMobile        = window.innerWidth <= 720;
  const sidebarIsOpen   = sidebar.classList.contains('open');
  const clickedOutside  = !sidebar.contains(event.target) &&
                          !document.getElementById('sidebarToggle').contains(event.target);

  if (isMobile && sidebarIsOpen && clickedOutside) {
    sidebar.classList.remove('open');
  }
});


// ─── 15. NAV & SEARCH ────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(button => {
  button.addEventListener('click', () => {
    activeGroup = button.dataset.group; // 'all' or 'ungrouped'
    renderSidebar();
    renderLinks();
  });
});

document.getElementById('searchInput').addEventListener('input', event => {
  searchQuery = event.target.value.trim();
  renderLinks();
});


// ─── 16. MODAL CLOSE ──────────────────────────────────────────────────────────

// All overlay IDs that should close when clicking the backdrop or pressing Escape
const OVERLAY_IDS = [
  'statsOverlay',
  'settingsOverlay',
  'linkModalOverlay',
  'groupModalOverlay',
  'deleteLinkOverlay',
  'deleteGroupOverlay',
];

// Close overlay when clicking the dark backdrop (not the modal itself)
OVERLAY_IDS.forEach(id => {
  document.getElementById(id).addEventListener('click', event => {
    if (event.target.id === id) {
      event.target.classList.add('hidden');
    }
  });
});

// Close the topmost open modal when Escape is pressed
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  OVERLAY_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));
});


// ─── 17. STARTUP ─────────────────────────────────────────────────────────────

// Check for a stored token and show the admin UI or gate accordingly
checkStoredToken();
