// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: loading data, auto re-lock, start-up and live updates. Loaded last: it starts everything. */

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData({ transition = false } = {}) {
  const [fl, fg, mine] = await Promise.all([
    authorisedFetch('/api/links'),
    authorisedFetch('/api/groups'),
    fetchPersonal(),
  ]);
  // Shared first, then the member's own, so their tabs sit after the ones
  // everybody sees.
  links  = [...fl, ...mine.links];
  groups = [...fg, ...mine.groups];

  // First-time landing: returning visitors keep the tab they last viewed
  // (stored in localStorage). Only when nothing is stored do we fall back to
  // the admin-configured pinned default, so brand-new visitors still see it.
  if (!pinnedAppliedOnce) {
    pinnedAppliedOnce = true;
    const stored = loadStoredGroup();
    if (stored === 'all') {
      activeGroup = 'all';
    } else if (stored === 'fav' && favoriteLinks().length > 0) {
      // Somebody who reads from their favourites should come back to them.
      activeGroup = 'fav';
    } else if (stored && groups.some(g => g.id === stored)) {
      activeGroup = stored;
    } else if (pinnedGroupId && groups.some(g => g.id === pinnedGroupId)) {
      activeGroup = pinnedGroupId;
    }
  }

  // If the active tab was a now-locked group — or a personal one that has gone,
  // because it was deleted or because its owner signed out — fall back to "All"
  // rather than leave an empty grid with no explanation.
  if (activeGroup === 'fav') {
    // Signed out, or every star gone since: there is no Favourites to be in.
    if (!currentUser || favoriteLinks().length === 0) activeGroup = 'all';
  } else if (activeGroup !== 'all') {
    const current = groups.find(g => g.id === activeGroup);
    if (!current || isGroupLocked(current)) activeGroup = 'all';
  }

  renderTabs(); renderLinks(transition);
  scheduleRelockRefresh();
}

// ─── Auto re-lock ─────────────────────────────────────────────────────────────

/**
 * When the earliest unlock cookie is about to expire, refetch so the UI flips
 * the lock back on. The server is the source of truth — this just keeps the
 * page in sync without needing the user to interact.
 */
let relockTimerId = null;

function scheduleRelockRefresh() {
  if (relockTimerId) { clearTimeout(relockTimerId); relockTimerId = null; }

  const now = Date.now();
  let soonest = Infinity;
  for (const g of groups) {
    if (!g.is_protected || !g.is_unlocked) continue;
    // Session-mode unlocks never auto-relock client-side; the cookie is
    // bound to the browser session and disappears on its own when the user
    // closes the tab/window. No countdown timer needed.
    if (g.unlock_mode === 'session') continue;
    if (typeof g.unlocked_until === 'number' && g.unlocked_until < soonest) {
      soonest = g.unlocked_until;
    }
  }
  if (soonest === Infinity) return;

  // +200 ms buffer so the server is sure to see the cookie as expired.
  const delay = Math.max(0, soonest - now) + 200;
  relockTimerId = setTimeout(() => { relockTimerId = null; loadData(); }, delay);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function applyFavicon(url) {
  const link = document.getElementById('favicon');
  if (!link) return;
  // A tab strip can be light or dark and the page cannot tell which, so the
  // light cut is the default: its blue half reads on either.
  link.setAttribute('href', url || DEFAULT_BRAND.icon.light);
}

async function init() {
  // In parallel: the settings were always a round trip, and asking who is
  // signed in at the same time adds nothing to it, for anyone.
  const [settings, me] = await Promise.all([
    fetch('/api/settings').then(r => r.json()),
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : { user: null }))
      .catch(() => ({ user: null })),
  ]);
  // The admin token is not a member: it has no page of its own.
  currentUser = me.via === 'session' ? me.user : null;

  // A members-only page shows a stranger nothing at all, not even its frame.
  if (settings.require_login && !currentUser) { goToSignIn(); return; }

  renderAccountControl();

  if (settings.site_title) document.title = settings.site_title;
  applyBrandText(settings.site_title);
  applyBrandIcon(settings.brand_icon || null);
  logoLightUrl   = settings.logo_light || null;
  logoDarkUrl    = settings.logo_dark  || null;
  wallpaperLightUrl = settings.wallpaper_light || null;
  wallpaperDarkUrl  = settings.wallpaper_dark  || null;
  wallpaperFog      = Number.isFinite(settings.wallpaper_fog) ? settings.wallpaper_fog : 60;
  barOpacity        = Number.isFinite(settings.bar_opacity) ? settings.bar_opacity : 82;
  applyWallpaper();
  applyBarOpacity();
  siteFaviconUrl = settings.favicon || null;
  pinnedGroupId  = settings.pinned_group_id ?? null;
  applyFavicon(settings.favicon || null);
  updateHeaderLogo();
  applyThemeSettings(settings);
  applyRequestFeature(settings);
  applyFooter(settings);
  tabsUseGroupColor = settings.group_tab_color !== false;
  tabsLoopEnabled   = !!settings.group_tabs_loop;
  markdownOpenMode  = settings.markdown_open_mode === 'tab' ? 'tab' : 'modal';

  // A member has already said who they are; the site password is for strangers.
  if (settings.public_password_required && !currentUser) {
    const stored = localStorage.getItem('linkpage_public_password');
    if (stored && await verifyPublicPassword(stored)) {
      publicPassword = stored;
    } else {
      localStorage.removeItem('linkpage_public_password');
      showPublicGate(); return;
    }
  }

  await loadData();
  connectLiveUpdates();

  // /?account=1 opens the account screen — how the admin panel links to it,
  // and where connecting single sign-on comes back to, with how it went.
  const query = new URLSearchParams(location.search);
  if (currentUser && query.get('account') === '1') {
    history.replaceState(null, '', location.pathname);
    const ssoError = query.get('sso_error');
    openAccount({
      ssoNotice: query.get('sso') === 'connected' ? 'Connected. You can now sign in with it.'
               : ssoError ? (SSO_CONNECT_ERRORS[ssoError] || 'Connecting did not work. Try again.')
               : null,
    });
  }
}

// ─── Live updates (Server-Sent Events) ────────────────────────────────────────
//
// Whenever the admin mutates data the server broadcasts on /api/events; we
// debounce a smooth re-render so rapid edits coalesce into a single fade.
// EventSource auto-reconnects on transient drops; if the stream is closed for
// good (server restart) we restart it manually after a short backoff.

let liveUpdateTimer  = null;
let liveUpdateSource = null;

function connectLiveUpdates() {
  if (typeof EventSource === 'undefined') return;
  try { liveUpdateSource?.close(); } catch {}

  liveUpdateSource = new EventSource('/api/events');

  const refresh = () => {
    clearTimeout(liveUpdateTimer);
    liveUpdateTimer = setTimeout(() => {
      // Not while a card is being moved: the re-render would take it away.
      // Asked again shortly, so the update lands as soon as it is let go.
      if (reorderInProgress()) { refresh(); return; }
      // Don't fight a typing user: skip the fade while they're searching.
      const inSearch = !!searchQuery || searchChips.length > 0;
      loadData({ transition: !inSearch }).catch(() => {});
    }, 250);
  };

  // Something shared changed — an administrator's edit.
  liveUpdateSource.addEventListener('data', refresh);
  // Something of this member's own changed, in another of their tabs or on
  // another device. Only their stream is told.
  liveUpdateSource.addEventListener('personal', () => { if (currentUser) refresh(); });

  liveUpdateSource.addEventListener('error', () => {
    if (liveUpdateSource && liveUpdateSource.readyState === EventSource.CLOSED) {
      setTimeout(connectLiveUpdates, 4000);
    }
  });
}

// Stop the heartbeat ping from holding the socket open when the tab is hidden
// for a long time, then reconnect when it comes back. Saves battery on mobile.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (liveUpdateSource && liveUpdateSource.readyState === EventSource.CLOSED) {
    connectLiveUpdates();
  }
});

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
