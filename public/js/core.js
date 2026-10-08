// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Public page — the first of its scripts: theme, branding, the public password,
 * who is signed in, and shared helpers and state.
 *
 * The page is several classic scripts, loaded in order by index.html and
 * sharing one scope, so a function in one file can call a function in any
 * other. The one rule that comes with that: code that runs *while the page is
 * still loading* may only use what is declared in its own file or an earlier
 * one. That is why refreshMarkdownViewerTheme(), which applyTheme() calls at
 * load, lives here rather than with the markdown viewer in cards.js.
 *
 *   core.js            theme, branding, public password, session, helpers, state
 *   tabs.js            the group tab strip, the unlock modal
 *   requests.js        requesting a link, a file or a change
 *   cards.js           link cards, markdown documents
 *   reorder.js         reordering by mouse and by touch
 *   render.js          the empty state, rendering, search
 *   account.js         the account control, group colours, the composer
 *   account-dialog.js  Your account: password, sessions, export/import, SSO
 *   my-groups.js       managing your own groups and sections
 *   main.js            data loading, start-up, live updates — last
 */

// ─── Theme ────────────────────────────────────────────────────────────────────

let logoLightUrl = null;
let logoDarkUrl  = null;
// The favicon uploaded in Settings ("Browser Tab Icon"). Used as the default
// link icon whenever a link has no custom/cached/fetchable icon of its own.
let siteFaviconUrl = null;

// Admin-configured appearance (accent + palette variants + default theme).
// Populated from /api/settings after load; defaults are the built-in look.
let themeSettings = { accent: null, accentDarkAdjust: false, glow: false, mobileNav: 'top', light: 'default', dark: 'default', default: 'system' };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Lighten (pct > 0, toward white) or darken (pct < 0, toward black) a #rrggbb.
function shadeColor(hex, pct) {
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct) / 100;
  const mix = c => Math.round((t - c) * p + c);
  return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

// Overrides --primary/--primary-rgb/--primary-hover for the given theme. Clears
// the overrides (reverting to the CSS defaults) when no accent is configured.
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
  el.setAttribute('data-mobile-nav',    themeSettings.mobileNav || 'top');
}

// Applies the fetched theme settings. If the visitor hasn't picked a theme yet,
// honours the admin's default now that we know it.
function applyThemeSettings(settings) {
  themeSettings = {
    accent:           settings.accent_color || null,
    accentDarkAdjust: !!settings.accent_dark_adjust,
    glow:             !!settings.accent_glow,
    mobileNav:        settings.mobile_nav_position || 'top',
    light:            settings.theme_light_variant || 'default',
    dark:             settings.theme_dark_variant  || 'default',
    default:          settings.default_theme || 'system',
  };
  applyThemeVariants();
  if (!localStorage.getItem('linkpage_theme')) {
    applyTheme(getInitialTheme(), false);   // switches theme + applies accent
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

/** Reloads an open document under the new theme; a no-op when none is open. */
function refreshMarkdownViewerTheme() {
  const overlay = document.getElementById('mdViewerOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  const frame = document.getElementById('mdViewerFrame');
  const tab   = document.getElementById('mdViewerOpenTab');
  const base  = (frame.src || '').split('?')[0];
  if (!base || base === 'about:blank') return;

  swapInViewerFrame(`${base}?theme=${currentThemeName()}&embed=1`);
  tab.href = `${base}?theme=${currentThemeName()}`;
}


function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
  // The glyph, the lockup and the wallpaper all have a per-theme version.
  applyBrandIcon(brandIconUrl);
  applyWallpaper();
  // A document showing in the overlay is a separate page with its own copy of
  // the palette, so it has to be told the theme changed.
  refreshMarkdownViewerTheme();
  document.getElementById('iconMoon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('iconSun').classList.toggle('hidden', theme === 'light');
  applyAccent(theme);
  updateHeaderLogo();
  if (save) localStorage.setItem('linkpage_theme', theme);
}

document.getElementById('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'light' ? 'dark' : 'light');
});

/**
 * The shipped header glyph, used until an admin uploads their own. Two cuts,
 * because the light one's dark half disappears against a dark header and the
 * dark one's white half against a light one.
 *
 * Only the icon ships as a default. The full lockup lives in public/brand/ for
 * an admin to upload as a logo if they want it, but nothing points at it.
 */
const DEFAULT_BRAND = {
  icon: { light: '/brand/icon-light.png', dark: '/brand/icon-dark.png' },
};

/** The admin's own header glyph, if they uploaded one. */
let brandIconUrl = null;

/** Background image per theme, and how heavily it is fogged (0–100). */
let wallpaperLightUrl = null;
let wallpaperDarkUrl  = null;
let wallpaperFog      = 60;

/** How solid the sticky bars are, 0–100. */
let barOpacity = 82;

const isDarkTheme = () =>
  (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';

applyTheme(getInitialTheme(), false);

// ─── Branding ─────────────────────────────────────────────────────────────────

/** Header title text. Falls back to "LinkPage" when no site title is set. */
function applyBrandText(title) {
  const label = document.querySelector('#brandText .brand-label');
  if (label) label.textContent = title || 'LinkPage';
}

/** Header glyph: a configured image, else the shipped icon for this theme. */
function applyBrandIcon(url) {
  const slot = document.getElementById('brandIcon');
  if (!slot) return;
  brandIconUrl = url || null;

  slot.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'brand-icon-img';
  img.src       = url || DEFAULT_BRAND.icon[isDarkTheme() ? 'dark' : 'light'];
  img.alt       = '';
  slot.appendChild(img);
}

/**
 * An uploaded logo replaces the whole title block; there is no default one.
 * Left alone, the header is the glyph beside the site title — the same shape
 * the admin header has always had.
 */
function getLogoForCurrentTheme() {
  return isDarkTheme() ? logoDarkUrl : logoLightUrl;
}

/**
 * Applies the bar setting to the header, the tab strip and the footer.
 *
 * One number drives the tint and the blur together, because they only make
 * sense together: a bar with no tint but a blur still smears what is behind
 * it, which is not "see-through" by any reading. So at 0 both go, and the
 * bars become their text floating over the page; at 100 the tint is flat
 * colour and the blur no longer matters because nothing shows through.
 */
function applyBarOpacity() {
  const t = Math.min(100, Math.max(0, Number(barOpacity) || 0)) / 100;
  const root = document.documentElement.style;
  root.setProperty('--bar-alpha', t.toFixed(3));
  root.setProperty('--bar-blur', `${(t * 24).toFixed(1)}px`);
}

/**
 * Paints the wallpaper for the current theme, or takes it away.
 *
 * One number drives both effects. Fully clear leaves the photograph as it
 * was; turning it up blurs it and lays a veil in the page colour over it, so
 * text stays readable over a busy image. The ceilings are chosen so that 100
 * is "all but the plain background" rather than literally it — a hint of the
 * picture is what makes it still look deliberate.
 */
function applyWallpaper() {
  const el = document.getElementById('wallpaper');
  if (!el) return;

  // On the root, not the element: the password gate paints its own copy of the
  // wallpaper, so that it can stay an opaque cover, and reads the same values.
  const root = document.documentElement.style;

  const url = isDarkTheme() ? wallpaperDarkUrl : wallpaperLightUrl;
  if (!url) {
    el.classList.remove('is-on');
    root.removeProperty('--wallpaper-image');
    document.body.classList.remove('has-wallpaper');
    return;
  }

  const fog = Math.min(100, Math.max(0, Number(wallpaperFog) || 0)) / 100;

  // encodeURI, and quoted, so a path can never break out of the url() token.
  root.setProperty('--wallpaper-image', `url("${encodeURI(url)}")`);
  root.setProperty('--wallpaper-blur', `${(fog * 18).toFixed(1)}px`);
  root.setProperty('--wallpaper-veil', (fog * 0.94).toFixed(3));
  el.classList.add('is-on');
  document.body.classList.add('has-wallpaper');
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
  const r = await fetch(url, { headers, credentials: 'same-origin' });
  if (r.status === 401) {
    const body = await r.clone().json().catch(() => ({}));
    // Members-only, and nobody is signed in — most likely a session that ran
    // out mid-visit. The site password would not help; signing in would.
    if (body.code === 'login_required') {
      goToSignIn();
      throw new Error('Sign in required');
    }
    publicPassword = null; localStorage.removeItem('linkpage_public_password');
    showPublicGate(); throw new Error('Password required');
  }
  return r.json();
}

/** Off to the sign-in page, coming back here afterwards. */
function goToSignIn() {
  location.replace(`/login/?next=${encodeURIComponent(location.pathname + location.search)}`);
}

// ─── Who is signed in ─────────────────────────────────────────────────────────
//
// The session is an HttpOnly cookie, which this script cannot read — that is
// the point of it. So the page asks the server who it is, once, alongside the
// settings, and keeps the answer here. A member's own groups and links are then
// fetched and merged with the shared ones.

/** `{ id, email, display_name, role }` when somebody is signed in, else null. */
let currentUser = null;

/** Bytes used against this member's allowance, for the composer to show. */
let personalStorage = null;

/**
 * Shared link ids this member has starred, in their order. Already filtered by
 * the server to links they may see right now.
 */
let favoriteIds = [];

/** Shared groups this member is a group admin of: theirs to add links to. */
let managedGroupIds = [];

const isPersonal = item => item?.owner === 'me';

/** Shared groups this member looks after, in the page's order. */
const managedGroups = () => groups.filter(g => !isPersonal(g) && managedGroupIds.includes(g.id));

/**
 * A shared link this member may change: one that lives only in groups they
 * look after. The server applies the same rule; this only decides whether to
 * offer the pencil.
 */
const canManageLink = link => !isPersonal(link) && (link.groups || []).length > 0
  && link.groups.every(g => managedGroupIds.includes(g.id));

/**
 * Personal ids are the member's own and can coincide with shared ones — their
 * link 5 is not the shared link 5. They are renamed here, the moment they
 * arrive, to "u5": a value no shared id can ever be. After that, every
 * comparison the page already makes (`g.id === activeGroup`, `group_ids.
 * includes(...)`) works unchanged for both, and nothing can mix them up.
 *
 * `personal_id` keeps the real number for talking to /api/my/*.
 */
function adoptPersonal(data) {
  const key = id => `u${id}`;
  return {
    groups: (data.groups || []).map(g => ({ ...g, id: key(g.id), personal_id: g.id })),
    links:  (data.links  || []).map(l => ({
      ...l,
      id:          key(l.id),
      personal_id: l.id,
      group_ids:   (l.group_ids || []).map(key),
      groups:      (l.groups || []).map(m => ({ ...m, id: key(m.id) })),
    })),
  };
}

/**
 * This member's own content, or nothing. A 401 means the session ended since
 * the page loaded; that is handled by treating them as signed out, not by
 * breaking the page — the shared links are still perfectly good.
 */
async function fetchPersonal() {
  if (!currentUser) { favoriteIds = []; managedGroupIds = []; return { groups: [], links: [] }; }
  try {
    const r = await fetch('/api/my/data', { credentials: 'same-origin' });
    if (r.status === 401) { sessionEnded(); return { groups: [], links: [] }; }
    if (!r.ok) return { groups: [], links: [] };
    const data = await r.json();
    personalStorage = data.storage || null;
    favoriteIds = Array.isArray(data.favorites) ? data.favorites : [];
    managedGroupIds = Array.isArray(data.managed_group_ids) ? data.managed_group_ids : [];
    return adoptPersonal(data);
  } catch {
    return { groups: [], links: [] };
  }
}

/** The session went away underneath the page. Carry on as a visitor. */
function sessionEnded() {
  if (!currentUser) return;
  currentUser = null;
  personalStorage = null;
  favoriteIds = [];
  managedGroupIds = [];
  renderAccountControl();
  showToast('You have been signed out', { type: 'info', detail: 'Sign in again to see your own links.' });
}

/** A request to /api/my/* that sends a form or JSON, with the session. */
async function myRequest(url, { method = 'POST', json, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form) {
    init.body = form;
  }
  const r = await fetch(url, init);
  if (r.status === 401) sessionEnded();
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const e = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return String(text ?? '').replace(/[&<>"']/g, c => e[c]);
}

/**
 * Splits a query into search tokens. Whitespace separates tokens, and
 * "quoted phrases" stay intact so "two words" is a single match.
 */
function parseSearchTokens(query) {
  const out = [];
  const re  = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(query || '')) !== null) {
    const t = (m[1] ?? m[2] ?? '').trim().toLowerCase();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Wraps every occurrence of every search token in <mark> for highlighting.
 * Accepts either the raw query string (in which case it tokenises) or a
 * pre-tokenised array. Tokens are matched longest-first so multi-word
 * phrases highlight as a single span instead of being split by sub-matches.
 */
function highlightText(rawText, query) {
  const text = escapeHtml(rawText ?? '');
  if (!query) return text;
  const tokens = Array.isArray(query) ? query : parseSearchTokens(query);
  if (!tokens.length) return text;

  const sorted = [...new Set(tokens)].sort((a, b) => b.length - a.length);
  const pattern = sorted
    .map(t => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return text.replace(new RegExp(`(${pattern})`, 'gi'), '<mark class="hl">$1</mark>');
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

let links         = [];
let groups        = [];
let activeGroup   = 'all';
// When true, the active group tab is painted with the group's own colour;
// when false, it uses the default secondary/accent colour. Set from settings.
let tabsUseGroupColor = true;
// Admin opt-in: when the group strip overflows, wrap it around endlessly
// instead of stopping at the first/last group. Set from settings.
let tabsLoopEnabled = false;
// 'modal' (default) or 'tab' — how a markdown link opens. Set in the admin.
let markdownOpenMode = 'modal';
let activeSection = null;
let searchQuery   = '';
// Pinned keywords. Each one narrows the result set further (AND combined
// with each other and with whatever's currently typed into the input).
let searchChips   = [];

// First-load default group (from settings.pinned_group_id). Applied once,
// then cleared so subsequent re-loads (e.g. after unlocking a protected group
// or a relock refresh) don't yank the user back to the pinned tab.
let pinnedGroupId      = null;
let pinnedAppliedOnce  = false;

// Returning visitors keep the tab they were on across refreshes. The pinned
// default only kicks in when nothing is stored (a fresh, uncached visitor).
//
// Per person when somebody is signed in: "u12" is meaningless to anyone else,
// and on a shared machine the stored value would tell the next person which of
// the last one's groups they were reading.
const LAST_GROUP_KEY = 'linkpage_last_group';
const lastGroupKey = () => (currentUser ? `${LAST_GROUP_KEY}:${currentUser.id}` : LAST_GROUP_KEY);

/** A tab key from its stored or data-attribute form: 'all', 12, or 'u12'. */
function parseGroupKey(raw) {
  if (raw === 'all' || raw === 'fav') return raw;
  if (typeof raw === 'string' && /^u\d+$/.test(raw)) return raw;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function loadStoredGroup() {
  try { return parseGroupKey(localStorage.getItem(lastGroupKey())); }
  catch { return null; }
}

function saveStoredGroup(group) {
  try { localStorage.setItem(lastGroupKey(), String(group)); } catch {}
}

/** Returns the section_id this link has within `groupId`, or null. */
function linkSectionInGroup(link, groupId) {
  const m = (link.groups || []).find(g => g.id === groupId);
  return m ? (m.section_id ?? null) : null;
}
