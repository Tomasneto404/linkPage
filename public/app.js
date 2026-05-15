/**
 * Public page — read-only view of links for end users.
 *
 * Responsibilities:
 *  - Theme (light/dark) management with OS preference fallback
 *  - Loading and displaying logos based on the active theme
 *  - Fetching and rendering links and groups
 *  - Group tab filtering and live search
 */

// ─── Theme ────────────────────────────────────────────────────────────────────

// Logos for each theme — loaded from the server on startup
let logoLightUrl = null;
let logoDarkUrl  = null;

/** Returns the theme the user last chose, or the OS preference, or 'light'. */
function getInitialTheme() {
  const savedTheme  = localStorage.getItem('linkpage_theme');
  if (savedTheme) return savedTheme;

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Applies a theme by setting the data-theme attribute on <html>.
 * CSS variables in style.css react to this attribute.
 * Also updates the toggle icon and swaps the header logo.
 *
 * @param {string}  theme - 'light' or 'dark'
 * @param {boolean} save  - Whether to persist the choice to localStorage
 */
function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);

  // Show the moon icon in light mode (click → go dark)
  // Show the sun icon in dark mode (click → go light)
  document.getElementById('iconMoon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('iconSun').classList.toggle('hidden', theme === 'light');

  // The correct logo may change when the theme changes
  updateHeaderLogo();

  if (save) localStorage.setItem('linkpage_theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme     = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// Apply theme immediately so the page never flashes the wrong colors
applyTheme(getInitialTheme(), false);

// ─── Branding ─────────────────────────────────────────────────────────────────

/** Fetches logo URLs from the server and updates the header. */
async function loadLogos() {
  const settings  = await fetch('/api/settings').then(r => r.json());
  logoLightUrl    = settings.logo_light || null;
  logoDarkUrl     = settings.logo_dark  || null;
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

/** Shows the logo image or the "LinkPage" text fallback in the header. */
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escapes HTML special characters in a string.
 * Always call this before inserting user-provided text into the DOM
 * to prevent cross-site scripting (XSS) attacks.
 */
function escapeHtml(text) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return String(text ?? '').replace(/[&<>"']/g, char => entities[char]);
}

/**
 * Returns a Google Favicon URL for a given site URL.
 * Returns null if the URL is invalid.
 */
function getFaviconUrl(siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
  } catch {
    return null;
  }
}

/** Extracts the bare domain (e.g. "github.com") from a full URL for display. */
function getDomainName(siteUrl) {
  try {
    const parsed = new URL(siteUrl);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return siteUrl;
  }
}

/** Formats an ISO date string as a short readable date, e.g. "May 14, 2026". */
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
  });
}

// SVG shown when a favicon or custom icon fails to load
const FALLBACK_ICON_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>`;

// ─── State ────────────────────────────────────────────────────────────────────

let links        = [];   // All links from the server
let groups       = [];   // All groups from the server
let activeGroup  = 'all'; // 'all', or a numeric group ID
let searchQuery  = '';   // Current search text

// ─── Tabs ─────────────────────────────────────────────────────────────────────

/** Rebuilds the group tab bar based on the current groups and active selection. */
function renderTabs() {
  const tabsContainer = document.getElementById('tabs');

  const groupTabsHtml = groups.map(group => {
    const linkCount  = links.filter(link => link.group_id === group.id).length;
    const isActive   = activeGroup === group.id;

    // In active tabs the dot is white; in inactive tabs it uses the group's color
    const dotColor = isActive ? '#fff' : group.color;

    return `
      <button class="tab${isActive ? ' active' : ''}" data-group="${group.id}">
        <span class="tab-dot" style="background:${escapeHtml(dotColor)}"></span>
        ${escapeHtml(group.name)}
        <span class="tab-count">${linkCount}</span>
      </button>`;
  }).join('');

  tabsContainer.innerHTML = `
    <button class="tab${activeGroup === 'all' ? ' active' : ''}" data-group="all">
      All <span class="tab-count">${links.length}</span>
    </button>
    ${groupTabsHtml}`;

  // Attach click handlers after injecting the HTML
  tabsContainer.querySelectorAll('.tab').forEach(button => {
    button.addEventListener('click', () => {
      const rawValue  = button.dataset.group;
      activeGroup     = rawValue === 'all' ? 'all' : Number(rawValue);
      renderTabs();
      renderLinks();
    });
  });
}

// ─── Link cards ───────────────────────────────────────────────────────────────

/** Returns the links that match the current group tab and search query. */
function getFilteredLinks() {
  let filtered = links;

  if (activeGroup !== 'all') {
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

/** Builds the icon <img> HTML, with a fallback for failed loads. */
function buildIconHtml(iconUrl) {
  if (!iconUrl) return FALLBACK_ICON_SVG;

  // If the image fails (e.g. no favicon found), hide it and show the SVG fallback
  return `
    <img src="${escapeHtml(iconUrl)}" alt="" loading="lazy"
         onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
    <span style="display:none">${FALLBACK_ICON_SVG}</span>`;
}

/** Builds the colored group badge HTML for a link that belongs to a group. */
function buildGroupBadgeHtml(link) {
  const badgeStyle = `background:${link.group_color}18; color:${link.group_color}`;
  return `
    <div class="link-footer">
      <span class="group-badge" style="${badgeStyle}">${escapeHtml(link.group_name)}</span>
    </div>`;
}

/**
 * Builds a fully clickable link card element.
 * The entire card is an <a> tag so the whole surface opens the link.
 */
function buildLinkCard(link) {
  const card = document.createElement('a');
  card.className  = 'link-card';
  card.target     = '_blank';
  card.rel        = 'noopener noreferrer';

  // Route through the server's redirect endpoint so clicks are counted.
  // The server validates the URL before redirecting, so this is safe.
  card.href = `/r/${link.id}`;

  const iconUrl         = link.image_path || getFaviconUrl(link.url);
  const iconHtml        = buildIconHtml(iconUrl);
  const badgeHtml       = link.group_name ? buildGroupBadgeHtml(link) : '';
  const descriptionHtml = link.description
    ? `<p class="link-desc">${escapeHtml(link.description)}</p>`
    : '';

  card.innerHTML = `
    <div class="link-icon">${iconHtml}</div>
    <div class="link-body">
      <div class="link-name">${escapeHtml(link.name)}</div>
      <div class="link-domain">${escapeHtml(getDomainName(link.url))}</div>
      ${descriptionHtml}
      ${badgeHtml}
    </div>
    <svg class="link-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>`;

  return card;
}

/** Clears the grid and renders all links that match the current filters. */
function renderLinks() {
  const grid           = document.getElementById('linksGrid');
  const emptyState     = document.getElementById('emptyState');
  const emptyMessage   = document.getElementById('emptyMsg');
  const filteredLinks  = getFilteredLinks();

  grid.innerHTML = '';

  if (filteredLinks.length === 0) {
    emptyState.classList.remove('hidden');
    emptyMessage.textContent = searchQuery
      ? `No results for "${searchQuery}"`
      : 'No links here yet.';
    return;
  }

  emptyState.classList.add('hidden');
  filteredLinks.forEach(link => grid.appendChild(buildLinkCard(link)));
}

// ─── Search ───────────────────────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('input', event => {
  searchQuery = event.target.value.trim();
  renderLinks();
});

// ─── Initialisation ───────────────────────────────────────────────────────────

async function init() {
  await loadLogos();

  const [fetchedLinks, fetchedGroups] = await Promise.all([
    fetch('/api/links').then(r  => r.json()),
    fetch('/api/groups').then(r => r.json()),
  ]);

  links  = fetchedLinks;
  groups = fetchedGroups;

  renderTabs();
  renderLinks();
}

init();
