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

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);
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
const LAST_GROUP_KEY = 'linkpage_last_group';

function loadStoredGroup() {
  try {
    const raw = localStorage.getItem(LAST_GROUP_KEY);
    if (raw === 'all') return 'all';
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

function saveStoredGroup(group) {
  try { localStorage.setItem(LAST_GROUP_KEY, String(group)); } catch {}
}

/** Returns the section_id this link has within `groupId`, or null. */
function linkSectionInGroup(link, groupId) {
  const m = (link.groups || []).find(g => g.id === groupId);
  return m ? (m.section_id ?? null) : null;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function linkBelongsToGroup(link, groupId) {
  return Array.isArray(link.group_ids)
    ? link.group_ids.includes(groupId)
    : link.group_id === groupId;
}

const LOCK_SVG = `
  <svg class="tab-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Locked">
    <rect x="3" y="11" width="18" height="11" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>`;

function isGroupLocked(group) {
  return group.is_protected && !group.is_unlocked;
}

function renderTabs() {
  const container = document.getElementById('tabs');
  const groupsHtml = groups.map(g => {
    const count  = links.filter(l => linkBelongsToGroup(l, g.id)).length;
    const active = activeGroup === g.id;
    const locked = isGroupLocked(g);
    return `
      <button class="tab${active ? ' active' : ''}${locked ? ' locked' : ''}"
              data-group="${g.id}" data-locked="${locked ? '1' : '0'}">
        <span class="tab-dot" style="background:${escapeHtml(active ? '#fff' : g.color)}"></span>
        ${escapeHtml(g.name)}
        ${locked ? LOCK_SVG : ''}
        <span class="tab-count">${count}</span>
      </button>`;
  }).join('');

  container.innerHTML = `
    <button class="tab${activeGroup === 'all' ? ' active' : ''}" data-group="all">
      All <span class="tab-count">${links.length}</span>
    </button>${groupsHtml}`;

  container.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.locked === '1') {
        const gid = Number(btn.dataset.group);
        const g   = groups.find(x => x.id === gid);
        if (g) openUnlockModal(g);
        return;
      }
      activeGroup = btn.dataset.group === 'all' ? 'all' : Number(btn.dataset.group);
      saveStoredGroup(activeGroup);
      renderTabs(); renderLinks(true);
    });
  });
}

// ─── Unlock modal ─────────────────────────────────────────────────────────────

let pendingUnlockGroup = null;

function openUnlockModal(group) {
  pendingUnlockGroup = group;
  document.getElementById('unlockGroupName').textContent = group.name;
  document.getElementById('unlockPasswordInput').value   = '';
  document.getElementById('unlockError').classList.add('hidden');
  document.getElementById('unlockOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('unlockPasswordInput').focus(), 60);
}

function closeUnlockModal() {
  pendingUnlockGroup = null;
  document.getElementById('unlockOverlay').classList.add('hidden');
}

document.getElementById('closeUnlockBtn').addEventListener('click', closeUnlockModal);
document.getElementById('cancelUnlockBtn').addEventListener('click', closeUnlockModal);
document.getElementById('unlockOverlay').addEventListener('click', e => {
  if (e.target.id === 'unlockOverlay') closeUnlockModal();
});

document.getElementById('unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!pendingUnlockGroup) return;

  const pw    = document.getElementById('unlockPasswordInput').value;
  const btn   = document.getElementById('unlockSubmitBtn');
  const err   = document.getElementById('unlockError');
  const group = pendingUnlockGroup;
  err.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Unlocking…';

  try {
    const r = await fetch(`/api/groups/${group.id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pw }),
    });

    if (r.status === 429) {
      err.textContent = 'Too many attempts. Please wait a few minutes.';
      err.classList.remove('hidden');
      return;
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.valid !== true) {
      err.textContent = 'Wrong password.';
      err.classList.remove('hidden');
      document.getElementById('unlockPasswordInput').focus();
      return;
    }

    // Switch to the just-unlocked group and reload data so the cookie-aware
    // /api/links call returns its previously-hidden links.
    activeGroup = group.id;
    saveStoredGroup(activeGroup);
    closeUnlockModal();
    await loadData();
  } catch {
    err.textContent = 'Could not reach the server.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Unlock';
  }
});

// ─── Request-link feature ───────────────────────────────────────────────────────
//
// Visitors can propose a link for the admin to review. The feature (and an
// optional password gate) is toggled by the admin; the button only appears when
// enabled. The icon picker mirrors the admin's stock-icon presets + upload.

let requestFeatureEnabled = false;
let requestPasswordRequired = false;

const REQ_PRESET_COLORS = [
  '#0071e3', '#34c759', '#ff3b30', '#ff9500', '#ffcc00',
  '#af52de', '#5ac8fa', '#1d1d1f', '#86868b',
];

let reqIconFile      = null;   // File to upload as the icon (preset SVG or upload); null → use favicon
let reqCustomPreview = null;   // preview HTML for a chosen icon; null → show favicon
let reqFaviconUrl    = null;   // live favicon guessed from the URL field
let reqPresetName    = null;   // preset selected inside the popup
let reqPresetColor   = REQ_PRESET_COLORS[0];
let reqPresetQuery   = '';

const REQ_FALLBACK_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

function applyRequestFeature(settings) {
  requestFeatureEnabled   = !!settings.requests_enabled;
  requestPasswordRequired = !!settings.request_password_required;
  const btn = document.getElementById('requestLinkBtn');
  if (btn) btn.classList.toggle('hidden', !requestFeatureEnabled);
}

function presetSvgString(body, color, size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Populates the group <select>, then triggers a section repopulate. */
function populateRequestGroups() {
  const sel = document.getElementById('reqGroup');
  const opts = groups.map(g =>
    `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  sel.innerHTML = `<option value="" disabled selected>Choose a group…</option>${opts}`;
  populateRequestSections();
}

/** Rebuilds the section <select> from the chosen group. Protected groups keep
 *  their section structure private, so the field is hidden for them. */
function populateRequestSections() {
  const groupId = Number(document.getElementById('reqGroup').value);
  const group   = groups.find(g => g.id === groupId);
  const wrap    = document.getElementById('reqSectionGroup');
  const sel     = document.getElementById('reqSection');

  if (group && group.is_protected) {
    wrap.classList.add('hidden');
    sel.innerHTML = '<option value="">None</option>';
    sel.value = '';
    return;
  }
  wrap.classList.remove('hidden');

  let html = '<option value="">None</option>';
  if (group && Array.isArray(group.sections)) {
    for (const s of group.sections) {
      html += `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
      for (const sub of (s.subsections || [])) {
        html += `<option value="${sub.id}">&nbsp;&nbsp;↳ ${escapeHtml(sub.name)}</option>`;
      }
    }
  }
  sel.innerHTML = html;
}

// ─── Icon preview (form) ────────────────────────────────────────────────────
// Shows the chosen icon, else the live site favicon, else a globe fallback.
function refreshReqIconPreview() {
  const box  = document.getElementById('reqIconPreview');
  const clr  = document.getElementById('reqClearIcon');
  const hint = document.getElementById('reqIconHint');
  if (reqCustomPreview) {
    box.innerHTML = reqCustomPreview; clr.hidden = false;
    hint.textContent = 'Custom icon.';
  } else if (reqFaviconUrl) {
    box.innerHTML = `<img src="${escapeHtml(reqFaviconUrl)}" alt="site icon" />`; clr.hidden = true;
    hint.textContent = 'Auto-fetched from the site.';
  } else {
    box.innerHTML = REQ_FALLBACK_ICON; clr.hidden = true;
    hint.textContent = 'Auto-fetched from the site.';
  }
}

function resetRequestIcon() {
  reqIconFile = null; reqCustomPreview = null; reqPresetName = null;
  document.getElementById('reqImageUpload').value = '';
  refreshReqIconPreview();
}

// ─── Icon presets popup ─────────────────────────────────────────────────────
function renderRequestSwatches() {
  document.getElementById('reqSwatches').innerHTML = REQ_PRESET_COLORS.map(c =>
    `<button type="button" class="req-swatch ${c === reqPresetColor ? 'is-active' : ''}"
             data-color="${c}" style="background:${c}" aria-label="Use ${c}"></button>`).join('');
}

function renderRequestPresets() {
  const grid = document.getElementById('reqPresetsGrid');
  const q    = reqPresetQuery.toLowerCase();
  const all  = (window.ICON_PRESETS || []).filter(i =>
    !q || i.name.toLowerCase().includes(q) || (i.cat || '').toLowerCase().includes(q));
  grid.innerHTML = all.map(i =>
    `<button type="button" class="req-preset-tile ${i.name === reqPresetName ? 'is-selected' : ''}"
             data-name="${escapeHtml(i.name)}" title="${escapeHtml(i.name)}">
       ${presetSvgString(i.body, reqPresetColor, 22)}
     </button>`).join('');
}

function openReqPresets() {
  reqPresetQuery = '';
  document.getElementById('reqPresetSearch').value = '';
  renderRequestSwatches();
  renderRequestPresets();
  document.getElementById('reqPresetsApply').disabled = !reqPresetName;
  document.getElementById('reqPresetsOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('reqPresetSearch').focus(), 60);
}
function closeReqPresets() {
  document.getElementById('reqPresetsOverlay').classList.add('hidden');
}

/** Commits the popup's selected preset as the form icon. */
function applyReqPreset() {
  const icon = (window.ICON_PRESETS || []).find(i => i.name === reqPresetName);
  if (!icon) return;
  const svg = presetSvgString(icon.body, reqPresetColor, 128);
  reqIconFile      = new File([new Blob([svg], { type: 'image/svg+xml' })],
                              `icon-${reqPresetName}.svg`, { type: 'image/svg+xml' });
  reqCustomPreview = presetSvgString(icon.body, reqPresetColor, 26);
  document.getElementById('reqImageUpload').value = '';
  closeReqPresets();
  refreshReqIconPreview();
}

function openRequestModal() {
  document.getElementById('requestForm').reset();
  reqPresetColor = REQ_PRESET_COLORS[0];
  reqFaviconUrl  = null;
  resetRequestIcon();
  populateRequestGroups();
  document.getElementById('reqPasswordGroup').classList.toggle('hidden', !requestPasswordRequired);
  document.getElementById('reqError').classList.add('hidden');
  document.getElementById('requestOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('reqName').focus(), 60);
}

function closeRequestModal() {
  document.getElementById('requestOverlay').classList.add('hidden');
}

function showRequestError(msg) {
  const err = document.getElementById('reqError');
  err.textContent = msg;
  err.classList.remove('hidden');
}

document.getElementById('requestLinkBtn')?.addEventListener('click', openRequestModal);
document.getElementById('closeRequestBtn')?.addEventListener('click', closeRequestModal);
document.getElementById('cancelRequestBtn')?.addEventListener('click', closeRequestModal);
document.getElementById('requestOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'requestOverlay') closeRequestModal();
});
document.getElementById('reqGroup')?.addEventListener('change', populateRequestSections);
document.getElementById('reqClearIcon')?.addEventListener('click', resetRequestIcon);

// Live favicon preview as the URL is typed (mirrors the admin add-link form).
document.getElementById('reqUrl')?.addEventListener('input', e => {
  reqFaviconUrl = getFaviconUrl(e.target.value.trim());
  if (!reqIconFile) refreshReqIconPreview();
});

// Presets popup wiring.
document.getElementById('reqOpenPresets')?.addEventListener('click', openReqPresets);
document.getElementById('reqPresetsClose')?.addEventListener('click', closeReqPresets);
document.getElementById('reqPresetsCancel')?.addEventListener('click', closeReqPresets);
document.getElementById('reqPresetsApply')?.addEventListener('click', applyReqPreset);
document.getElementById('reqPresetsOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'reqPresetsOverlay') closeReqPresets();
});
document.getElementById('reqPresetSearch')?.addEventListener('input', e => {
  reqPresetQuery = e.target.value;
  renderRequestPresets();
});
document.getElementById('reqSwatches')?.addEventListener('click', e => {
  const btn = e.target.closest('.req-swatch');
  if (!btn) return;
  reqPresetColor = btn.dataset.color;
  renderRequestSwatches();
  renderRequestPresets();
});
document.getElementById('reqPresetsGrid')?.addEventListener('click', e => {
  const btn = e.target.closest('.req-preset-tile');
  if (!btn) return;
  reqPresetName = btn.dataset.name;
  renderRequestPresets();
  document.getElementById('reqPresetsApply').disabled = false;
});

document.getElementById('reqImageUpload')?.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  reqIconFile      = file;
  reqPresetName    = null;               // an upload overrides a preset pick
  reqCustomPreview = `<img src="${URL.createObjectURL(file)}" alt="icon preview" />`;
  refreshReqIconPreview();
});

document.getElementById('requestForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('reqSubmitBtn');
  const err = document.getElementById('reqError');
  err.classList.add('hidden');

  const name      = document.getElementById('reqName').value.trim();
  const url       = document.getElementById('reqUrl').value.trim();
  const groupId   = document.getElementById('reqGroup').value;
  const sectionId = document.getElementById('reqSection').value;
  const desc      = document.getElementById('reqDesc').value.trim();

  if (!name || !url) { showRequestError('Please provide a name and URL.'); return; }
  if (!groupId)      { showRequestError('Please choose a group.'); return; }
  if (requestPasswordRequired && !document.getElementById('reqPassword').value) {
    showRequestError('Please enter the request password.'); return;
  }

  const fd = new FormData();
  fd.append('name', name);
  fd.append('url', url);
  fd.append('description', desc);
  fd.append('group_id', groupId);
  if (sectionId)  fd.append('section_id', sectionId);
  if (reqIconFile) fd.append('image', reqIconFile);

  const headers = {};
  if (requestPasswordRequired) {
    headers['X-Request-Password'] = document.getElementById('reqPassword').value;
  }

  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const r = await fetch('/api/link-requests', { method: 'POST', headers, body: fd });
    if (r.status === 429) { showRequestError('Too many requests. Please wait a moment.'); return; }
    if (r.status === 401) { showRequestError('Incorrect password.'); return; }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showRequestError(d.error || 'Could not submit your request.');
      return;
    }
    closeRequestModal();
    showToast('Request submitted', { type: 'success' });
  } catch {
    showRequestError('Could not reach the server.');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit request';
  }
});

// Global Escape: close the top-most open modal overlay (request, icon picker,
// group unlock — whichever is frontmost). One press closes one layer.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
  if (open.length) open[open.length - 1].classList.add('hidden');
});

// ─── Link cards ───────────────────────────────────────────────────────────────

/**
 * Joins every searchable string on a link into a single lowercased haystack
 * — name, URL, file name, description, plus every group/section/subsection
 * name the link belongs to. The "tags" the user sees on a card are the group
 * names, so searching for a group name surfaces every link that wears that
 * badge.
 */
function buildLinkHaystack(link) {
  const parts = [
    link.name,
    link.url,
    link.file_name,
    link.description,
  ];
  for (const g of (link.groups || [])) {
    parts.push(g.name, g.section_name, g.parent_section_name);
  }
  return parts.filter(Boolean).join(' \n ').toLowerCase();
}

/**
 * Returns every active search keyword — pinned chips plus whatever the user
 * has typed into the input but not yet pressed Enter on. Lowercased and
 * deduped so the filter walks a clean list.
 */
function effectiveSearchTokens() {
  const tokens = new Set();
  for (const c of searchChips) tokens.add(c.toLowerCase());
  for (const t of parseSearchTokens(searchQuery)) tokens.add(t);
  return Array.from(tokens);
}

function getFilteredLinks() {
  let filtered = activeGroup !== 'all'
    ? links.filter(l => linkBelongsToGroup(l, activeGroup))
    : links;

  const tokens = effectiveSearchTokens();
  if (tokens.length) {
    // AND across tokens — each chip/keyword must match at least one
    // searchable field. "two words" (quoted) matches as a single phrase.
    filtered = filtered.filter(l => {
      const hay = buildLinkHaystack(l);
      return tokens.every(t => hay.includes(t));
    });
  }
  return filtered;
}

/*
 * Icon fallback chain (shared by every link icon <img>):
 *   1. the requested icon (custom upload / cached favicon / Google live)
 *   2. on failure → the Settings "Browser Tab Icon" (siteFaviconUrl), if set
 *   3. on failure → the generic globe glyph
 * Implemented with a global error handler so the chain works without nested
 * inline onerror gymnastics.
 */
window.__lpIconLoaded = function (img) {
  const shimmer = img.parentElement && img.parentElement.querySelector('.favicon-shimmer');
  if (shimmer) shimmer.remove();
};
window.__lpIconError = function (img) {
  const shimmer = img.parentElement && img.parentElement.querySelector('.favicon-shimmer');
  if (shimmer) shimmer.remove();
  // Step down to the site favicon once, if we have one and haven't tried it.
  if (siteFaviconUrl && img.dataset.fb !== 'site' && img.getAttribute('src') !== siteFaviconUrl) {
    img.dataset.fb = 'site';
    img.src = siteFaviconUrl;
    return;
  }
  // Give up → globe glyph.
  const span = document.createElement('span');
  span.className = 'icon-fallback';
  span.innerHTML = FALLBACK_ICON_SVG;
  img.replaceWith(span);
};

/** The static fallback shown when a link has no icon URL to even attempt. */
function fallbackIconHtml() {
  if (siteFaviconUrl) {
    return `<img class="site-favicon-default" src="${escapeHtml(siteFaviconUrl)}" alt="" loading="lazy"
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

const FILE_ICON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
</svg>`;

// Document-style coloured icon for file-backed links that have no custom
// image. Helps visitors visually scan by file type (PDF, JSON, HTML, …).
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
  const fs   = meta.l.length >= 4 ? 6 : 7.5;
  return `<svg class="file-type-tile" width="100%" height="100%" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(meta.l)} file">
    <rect width="40" height="40" rx="9" ry="9" fill="${meta.c}" fill-opacity="0.14"/>
    <path d="M13 9h10.5l6.5 6.5V31a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z" fill="white" stroke="${meta.c}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M23.5 9v6.5H30" fill="${meta.c}" fill-opacity="0.32" stroke="${meta.c}" stroke-width="1.5" stroke-linejoin="round"/>
    <text x="20.5" y="27.5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" font-size="${fs}" font-weight="700" fill="${meta.c}" letter-spacing="0.06em">${escapeHtml(meta.l)}</text>
  </svg>`;
}

function getLinkDisplayLabel(link) {
  if (link.file_path) return link.file_name || 'Attached file';
  return getDomainName(link.url);
}

function buildLinkCard(link) {
  const card    = document.createElement('a');
  card.className = 'link-card';
  card.target    = '_blank';
  card.rel       = 'noopener noreferrer';
  card.href      = `/r/${link.id}`;

  // Icon source: custom upload → server-cached favicon → (nothing). We no
  // longer fall back to Google's client-side favicon service because it
  // returns a generic globe (HTTP 404 w/ image body) for unknown hosts, which
  // browsers render as a successful load and would mask the Settings-favicon
  // default. The server already tries Google when caching favicon_path.
  const iconUrl  = link.image_path
                || (link.file_path ? null : link.favicon_path);
  // Highlight using every active keyword (chips + pending input).
  const q        = effectiveSearchTokens();
  const descHtml = link.description
    ? `<p class="link-desc">${highlightText(link.description, q)}</p>` : '';
  const linkGroups = Array.isArray(link.groups) && link.groups.length
    ? link.groups
    : (link.group_name ? [{ name: link.group_name, color: link.group_color }] : []);
  const badgeHtml = linkGroups.length
    ? `<div class="link-footer">${linkGroups.map(g =>
        `<span class="group-badge" style="background:${g.color}18; color:${g.color}" title="${escapeHtml(g.name)}">${highlightText(g.name, q)}</span>`
      ).join('')}</div>`
    : '';

  const iconHtml = iconUrl
    ? buildIconHtml(iconUrl)
    : (link.file_path
        ? fileTypeIconHtml(link.file_name)
        : fallbackIconHtml());

  card.innerHTML = `
    <div class="link-icon">${iconHtml}</div>
    <div class="link-body">
      <div class="link-name">${highlightText(link.name, q)}</div>
      <div class="link-domain">${highlightText(getLinkDisplayLabel(link), q)}</div>
      ${descHtml}${badgeHtml}
    </div>
    <button type="button" class="link-copy-btn" title="Copy link" aria-label="Copy link">
      <svg class="link-copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <svg class="link-copy-check" width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </button>
    <svg class="link-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>`;

  card.querySelector('.link-copy-btn').addEventListener('click', e => copyLinkFromCard(e, link));

  return card;
}

/**
 * Lightweight toast — appears top-right, auto-dismisses, click to dismiss
 * early. Mirrors the admin's toast contract for visual consistency. Pass an
 * optional second-line string (`detail`) to show under the headline.
 */
function showToast(message, { type = 'success', detail = '', duration = 2600 } = {}) {
  const ICONS = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <div class="toast-stack">
      <span>${escapeHtml(message)}</span>
      ${detail ? `<span class="toast-url" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>` : ''}
    </div>`;

  const dismiss = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

/**
 * Copies a shareable URL for the link to the clipboard, then briefly flashes
 * the button to a check mark. URL-backed links copy the destination directly;
 * file-backed links copy the absolute redirect URL through this server so the
 * file is reachable (and the click is tracked).
 */
async function copyLinkFromCard(e, link) {
  e.preventDefault();
  e.stopPropagation();

  // CAPTURE the button reference NOW, before the first await. After an await
  // in an event handler the browser resets `e.currentTarget` to null, so
  // touching it later silently throws and aborts the rest of the function
  // (including the toast). This is a Chrome/Safari/Firefox-wide behaviour.
  const btn = e.currentTarget;

  const toCopy = link.file_path
    ? `${location.origin}/r/${link.id}`
    : link.url;

  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(toCopy);
      ok = true;
    } else {
      // Fallback for old/insecure contexts: an off-screen textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = toCopy;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
  } catch { ok = false; }

  if (btn) {
    btn.classList.add(ok ? 'is-copied' : 'is-failed');
    btn.setAttribute('aria-label', ok ? 'Link copied' : 'Copy failed');
    setTimeout(() => {
      btn.classList.remove('is-copied', 'is-failed');
      btn.setAttribute('aria-label', 'Copy link');
    }, 1300);
  }

  if (ok) {
    showToast('Link copied', { type: 'success', detail: toCopy });
  } else {
    showToast('Couldn’t copy the link', { type: 'error', detail: 'Clipboard access was blocked.' });
  }
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EMPTY_ICONS = {
  links:  `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  search: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8.5" y1="8.5" x2="13.5" y2="13.5" stroke-width="1.8"/><line x1="13.5" y1="8.5" x2="8.5" y2="13.5" stroke-width="1.8"/></svg>`,
  folder: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};

function updateEmptyState() {
  const tokens = effectiveSearchTokens();
  document.getElementById('emptyIcon').innerHTML =
    tokens.length ? EMPTY_ICONS.search : (activeGroup !== 'all' ? EMPTY_ICONS.folder : EMPTY_ICONS.links);

  const sub = document.getElementById('emptySubtext');
  if (tokens.length) {
    document.getElementById('emptyMsg').textContent =
      `No results for ${tokens.map(t => `"${t}"`).join(' · ')}`;
    sub.textContent = 'Try removing a keyword or refining your search';
    sub.classList.remove('hidden');
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

/**
 * Buckets filtered links into a flat, render-ready sequence of section/sub
 * headings + their cards, in the order the public page should display them:
 *
 *   [ungrouped] → [Section A, A's own links, A.sub1, A.sub1's links, …]
 *
 * Returns an array of { kind: 'heading'|'links', … } entries the renderer
 * can iterate without knowing about the section tree.
 */
function bucketBySectionForActiveGroup(filteredLinks) {
  const group = groups.find(g => g.id === activeGroup);
  if (!group) return null;

  // Map every section id (top-level + sub) to its empty bucket up front so
  // we never miss an id later.
  const linksBySection = new Map();
  linksBySection.set(null, []);
  for (const s of group.sections || []) {
    linksBySection.set(s.id, []);
    for (const sub of (s.subsections || [])) linksBySection.set(sub.id, []);
  }
  for (const link of filteredLinks) {
    const sid = linkSectionInGroup(link, activeGroup);
    (linksBySection.get(sid) || linksBySection.get(null)).push(link);
  }

  const out = [];
  // 1) Links not assigned to any section show up first under an "Ungrouped"
  //    header (only if any exist).
  const orphans = linksBySection.get(null) || [];
  if (orphans.length) {
    out.push({ kind: 'heading', label: 'Ungrouped', count: orphans.length, level: 0 });
    out.push({ kind: 'links',   items: orphans });
  }
  // 2) Then each section, optionally followed by its subsections.
  for (const s of group.sections || []) {
    const own  = linksBySection.get(s.id) || [];
    const subs = (s.subsections || []).map(sub => ({
      sub,
      links: linksBySection.get(sub.id) || [],
    }));
    const total = own.length + subs.reduce((n, x) => n + x.links.length, 0);
    if (total === 0) continue;
    out.push({ kind: 'heading', label: s.name, count: total, level: 0 });
    if (own.length) out.push({ kind: 'links', items: own });
    for (const { sub, links } of subs) {
      if (!links.length) continue;
      out.push({ kind: 'heading', label: sub.name, count: links.length, level: 1 });
      out.push({ kind: 'links', items: links });
    }
  }
  return out;
}

function appendSectionHeading(grid, label, count, level = 0) {
  const heading = document.createElement('div');
  heading.className = 'section-heading' + (level > 0 ? ' subsection-heading' : '');
  heading.innerHTML = `
    <span class="section-heading-text">${escapeHtml(label)}</span>
    <span class="section-heading-count">${count}</span>`;
  grid.appendChild(heading);
}

function renderLinks(transition = false) {
  const grid       = document.getElementById('linksGrid');
  const emptyState = document.getElementById('emptyState');

  function appendCard(link, i) {
    const card = buildLinkCard(link);
    card.style.animationDelay = `${Math.min(i * 22, 280)}ms`;
    card.classList.add('card-animate');
    grid.appendChild(card);
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

    const shouldGroupBySection =
      typeof activeGroup === 'number' &&
      (groups.find(g => g.id === activeGroup)?.sections || []).length > 0;

    if (shouldGroupBySection) {
      const entries = bucketBySectionForActiveGroup(filtered) || [];
      let i = 0;
      for (const entry of entries) {
        if (entry.kind === 'heading') {
          appendSectionHeading(grid, entry.label, entry.count, entry.level || 0);
        } else if (entry.kind === 'links') {
          for (const link of entry.items) appendCard(link, i++);
        }
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

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Renders the pinned-keyword chips. Each chip has an "×" that removes only
 * that chip; the rest stay. The placeholder on the input also updates to
 * give a hint based on whether anything is pinned.
 */
function renderSearchChips() {
  const wrap = document.getElementById('searchChips');
  if (!wrap) return;
  wrap.innerHTML = searchChips.map((chip, i) => `
    <span class="search-chip" data-idx="${i}">
      <span class="search-chip-text" title="${escapeHtml(chip)}">${escapeHtml(chip)}</span>
      <button type="button" class="search-chip-remove" data-idx="${i}"
              aria-label="Remove filter ${escapeHtml(chip)}" title="Remove">×</button>
    </span>
  `).join('');
  const input = document.getElementById('searchInput');
  if (input) {
    input.placeholder = searchChips.length
      ? 'Add another keyword…'
      : 'Search links, groups, sections…';
  }
}

function commitSearchChip() {
  const input = document.getElementById('searchInput');
  const raw   = input.value.trim();
  if (!raw) return;
  // Multiple chips at once if the user typed several space-separated words
  // before pressing Enter. Quoted phrases stay together.
  for (const t of parseSearchTokens(raw)) {
    if (!searchChips.some(c => c.toLowerCase() === t)) searchChips.push(t);
  }
  input.value = '';
  searchQuery = '';
  renderSearchChips();
  renderLinks();
}

function removeSearchChip(idx) {
  if (idx < 0 || idx >= searchChips.length) return;
  searchChips.splice(idx, 1);
  renderSearchChips();
  renderLinks();
}

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  renderLinks();
});

document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitSearchChip();
  } else if (e.key === 'Backspace' && e.target.value === '' && searchChips.length > 0) {
    // Backspace on an empty input nibbles off the last chip — same trick
    // every "tags input" uses (browser address bar suggestions, Gmail filter
    // chips, etc.).
    removeSearchChip(searchChips.length - 1);
  }
});

// Click on a chip's × removes that one specifically. Wrapper-level listener
// so we don't have to re-bind on every render.
document.getElementById('searchChips').addEventListener('click', e => {
  const btn = e.target.closest('.search-chip-remove');
  if (!btn) return;
  removeSearchChip(Number(btn.dataset.idx));
});

// Clicking anywhere on the wrap (but not on a chip) focuses the input — the
// chips visually hijack the input's old click target, so help the user out.
document.getElementById('searchWrap').addEventListener('click', e => {
  if (e.target.closest('.search-chip')) return;
  document.getElementById('searchInput').focus();
});

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData({ transition = false } = {}) {
  const [fl, fg] = await Promise.all([
    authorisedFetch('/api/links'),
    authorisedFetch('/api/groups'),
  ]);
  links = fl; groups = fg;

  // First-time landing: returning visitors keep the tab they last viewed
  // (stored in localStorage). Only when nothing is stored do we fall back to
  // the admin-configured pinned default, so brand-new visitors still see it.
  if (!pinnedAppliedOnce) {
    pinnedAppliedOnce = true;
    const stored = loadStoredGroup();
    if (stored === 'all') {
      activeGroup = 'all';
    } else if (stored && groups.some(g => g.id === stored)) {
      activeGroup = stored;
    } else if (pinnedGroupId && groups.some(g => g.id === pinnedGroupId)) {
      activeGroup = pinnedGroupId;
    }
  }

  // If the active tab was a now-locked group, fall back to "All" so the user
  // isn't stuck looking at an empty filtered grid.
  if (typeof activeGroup === 'number') {
    const current = groups.find(g => g.id === activeGroup);
    if (current && isGroupLocked(current)) activeGroup = 'all';
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
  if (url) link.setAttribute('href', url);
  else     link.removeAttribute('href');
}

async function init() {
  const settings = await fetch('/api/settings').then(r => r.json());

  if (settings.site_title) document.title = settings.site_title;
  logoLightUrl   = settings.logo_light || null;
  logoDarkUrl    = settings.logo_dark  || null;
  siteFaviconUrl = settings.favicon || null;
  pinnedGroupId  = settings.pinned_group_id ?? null;
  applyFavicon(settings.favicon || null);
  updateHeaderLogo();
  applyThemeSettings(settings);
  applyRequestFeature(settings);

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
  connectLiveUpdates();
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

  liveUpdateSource.addEventListener('data', () => {
    clearTimeout(liveUpdateTimer);
    liveUpdateTimer = setTimeout(() => {
      // Don't fight a typing user: skip the fade while they're searching.
      const inSearch = !!searchQuery || searchChips.length > 0;
      loadData({ transition: !inSearch }).catch(() => {});
    }, 250);
  });

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
