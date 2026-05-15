/**
 * Public page — read-only view of links for end users.
 *
 *  - Theme (light/dark) management with OS preference fallback
 *  - Logo loading based on active theme
 *  - Public password gate
 *  - Dynamic page title from site_title setting
 *  - Group tab filtering and live search with text highlighting
 *  - Card entrance animations and grid transition
 *  - Favicon shimmer while icons load
 *  - Context-aware empty states
 */

// ─── Theme ────────────────────────────────────────────────────────────────────

let logoLightUrl = null;
let logoDarkUrl  = null;

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
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
});

applyTheme(getInitialTheme(), false);

// ─── Branding ─────────────────────────────────────────────────────────────────

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

// ─── Public password ──────────────────────────────────────────────────────────

let publicPassword = null;

async function verifyPublicPassword(pw) {
  const r = await fetch('/api/auth/verify-public', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  return (await r.json()).valid === true;
}

function showPublicGate()  { document.getElementById('publicGate').classList.remove('hidden'); }
function hidePublicGate()  { document.getElementById('publicGate').classList.add('hidden'); }

document.getElementById('publicGateForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pw  = document.getElementById('publicPasswordInput').value;
  const btn = e.target.querySelector('button[type="submit"]');
  const err = document.getElementById('publicGateError');
  err.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    if (await verifyPublicPassword(pw)) {
      publicPassword = pw;
      localStorage.setItem('linkpage_public_password', pw);
      hidePublicGate(); await loadData();
    } else {
      err.classList.remove('hidden');
      document.getElementById('publicPasswordInput').focus();
    }
  } catch {
    err.textContent = 'Could not reach the server.'; err.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'View Links';
  }
});

async function authorisedFetch(url) {
  const headers = {};
  if (publicPassword) headers['X-Public-Password'] = publicPassword;
  const r = await fetch(url, { headers });
  if (r.status === 401) {
    publicPassword = null; localStorage.removeItem('linkpage_public_password');
    showPublicGate(); throw new Error('Password required');
  }
  return r.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const e = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return String(text ?? '').replace(/[&<>"']/g, c => e[c]);
}

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

const FALLBACK_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
</svg>`;

// ─── State ────────────────────────────────────────────────────────────────────

let links       = [];
let groups      = [];
let activeGroup = 'all';
let searchQuery = '';

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function renderTabs() {
  const container = document.getElementById('tabs');
  const groupsHtml = groups.map(g => {
    const count  = links.filter(l => l.group_id === g.id).length;
    const active = activeGroup === g.id;
    return `
      <button class="tab${active ? ' active' : ''}" data-group="${g.id}">
        <span class="tab-dot" style="background:${escapeHtml(active ? '#fff' : g.color)}"></span>
        ${escapeHtml(g.name)}
        <span class="tab-count">${count}</span>
      </button>`;
  }).join('');

  container.innerHTML = `
    <button class="tab${activeGroup === 'all' ? ' active' : ''}" data-group="all">
      All <span class="tab-count">${links.length}</span>
    </button>${groupsHtml}`;

  container.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeGroup = btn.dataset.group === 'all' ? 'all' : Number(btn.dataset.group);
      renderTabs(); renderLinks(true);
    });
  });
}

// ─── Link cards ───────────────────────────────────────────────────────────────

function getFilteredLinks() {
  let filtered = activeGroup !== 'all'
    ? links.filter(l => l.group_id === activeGroup)
    : links;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.url.toLowerCase().includes(q)  ||
      (l.description || '').toLowerCase().includes(q)
    );
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
  const card    = document.createElement('a');
  card.className = 'link-card';
  card.target    = '_blank';
  card.rel       = 'noopener noreferrer';
  card.href      = `/r/${link.id}`;

  const iconUrl  = link.image_path || link.favicon_path || getFaviconUrl(link.url);
  const q        = searchQuery;
  const descHtml = link.description
    ? `<p class="link-desc">${highlightText(link.description, q)}</p>` : '';
  const badgeHtml = link.group_name
    ? `<div class="link-footer"><span class="group-badge" style="background:${link.group_color}18; color:${link.group_color}">${escapeHtml(link.group_name)}</span></div>` : '';

  card.innerHTML = `
    <div class="link-icon">${buildIconHtml(iconUrl)}</div>
    <div class="link-body">
      <div class="link-name">${highlightText(link.name, q)}</div>
      <div class="link-domain">${highlightText(getDomainName(link.url), q)}</div>
      ${descHtml}${badgeHtml}
    </div>
    <svg class="link-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>`;

  return card;
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EMPTY_ICONS = {
  links:  `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  search: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8.5" y1="8.5" x2="13.5" y2="13.5" stroke-width="1.8"/><line x1="13.5" y1="8.5" x2="8.5" y2="13.5" stroke-width="1.8"/></svg>`,
  folder: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};

function updateEmptyState() {
  document.getElementById('emptyIcon').innerHTML =
    searchQuery ? EMPTY_ICONS.search : (activeGroup !== 'all' ? EMPTY_ICONS.folder : EMPTY_ICONS.links);

  const sub = document.getElementById('emptySubtext');
  if (searchQuery) {
    document.getElementById('emptyMsg').textContent = `No results for "${searchQuery}"`;
    sub.textContent = 'Try a different search term'; sub.classList.remove('hidden');
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
        const card = buildLinkCard(link);
        card.style.animationDelay = `${Math.min(i * 22, 280)}ms`;
        card.classList.add('card-animate');
        grid.appendChild(card);
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

// ─── Search ───────────────────────────────────────────────────────────────────

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim(); renderLinks();
});

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const [fl, fg] = await Promise.all([
    authorisedFetch('/api/links'),
    authorisedFetch('/api/groups'),
  ]);
  links = fl; groups = fg;
  renderTabs(); renderLinks();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const settings = await fetch('/api/settings').then(r => r.json());

  if (settings.site_title) document.title = settings.site_title;
  logoLightUrl = settings.logo_light || null;
  logoDarkUrl  = settings.logo_dark  || null;
  updateHeaderLogo();

  if (settings.public_password_required) {
    const stored = localStorage.getItem('linkpage_public_password');
    if (stored && await verifyPublicPassword(stored)) {
      publicPassword = stored;
    } else {
      localStorage.removeItem('linkpage_public_password');
      showPublicGate(); return;
    }
  }

  await loadData();
}

init();

// ─── Easter egg ───────────────────────────────────────────────────────────────

console.log(
  '%c Engineered by Tomás Neto in Portugal \n%c "Não tentes. Faz!" ',
  'background:#0071e3; color:#fff; padding:6px 14px; border-radius:6px 6px 0 0; font-size:13px; font-weight:700; font-family:-apple-system,sans-serif;',
  'background:#1d1d1f; color:#f5f5f7; padding:4px 14px 8px; border-radius:0 0 6px 6px; font-size:12px; font-style:italic; font-family:-apple-system,sans-serif;'
);

// Konami code: ↑ ↑ ↓ ↓ ← → ← → B A
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
