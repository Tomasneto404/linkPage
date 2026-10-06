// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: settings — branding, wallpaper, header icon, themes. */

// ─── 4. SETTINGS ──────────────────────────────────────────────────────────────

async function loadSettings() {
  const s      = await fetchSettings();
  logoLightUrl = s.logo_light || null;
  logoDarkUrl  = s.logo_dark  || null;
  faviconUrl   = s.favicon    || null;
  brandIconUrl = s.brand_icon || null;
  applyBrandText(s.site_title);
  applyBrandIcon(brandIconUrl);
  updateHeaderLogo();
  applyFavicon(faviconUrl);
  if (s.site_title) {
    document.title = `${s.site_title} — Admin`;
    document.getElementById('siteTitleInput').value = s.site_title;
  }
  updatePublicPasswordStatus(s.public_password_required);
  updateRequestsFeatureUI(!!s.requests_enabled);
  refreshRequestsBadge();
  applyThemeSettings(s);
  updateFooterUI(s.footer_enabled);
}

/** Shows or hides the developer credit footer on the admin page. */
function updateFooterUI(enabled) {
  const footer = document.getElementById('devFooter');
  if (footer) footer.classList.toggle('hidden', !enabled);
}

function applyFavicon(url) {
  const link = document.getElementById('favicon');
  if (!link) return;
  // Falls back to the shipped icon rather than clearing the href, which would
  // send the browser hunting for /favicon.ico.
  link.setAttribute('href', url || DEFAULT_BRAND_ICON.light);
}

function updateFaviconPreview(url) {
  const img = document.getElementById('faviconPreview');
  const btn = document.getElementById('removeFaviconBtn');
  if (url) { img.src = url; img.classList.remove('hidden'); btn.classList.remove('hidden'); }
  else      { img.classList.add('hidden');    btn.classList.add('hidden'); }
}

// ─── Header brand (title text + glyph) ──────────────────────────────────────

/** Header title text. Falls back to "LinkPage" when no site title is set. */
function applyBrandText(title) {
  const label = document.querySelector('#brandText .brand-label');
  if (label) label.textContent = title || 'LinkPage';
}

// applyBrandIcon() lives in core.js, beside applyTheme(), which calls it while
// the page is still loading.

// Thumbnail only; updateBrandRowState() owns the Remove button's visibility.
function updateBrandIconPreview(url) {
  const img = document.getElementById('brandIconPreview');
  if (url) { img.src = url; img.classList.remove('hidden'); }
  else     { img.classList.add('hidden'); }
}

/** A light/dark logo replaces the whole title block, title + glyph included. */
function brandIsOverriddenByLogo() {
  return !!(logoLightUrl || logoDarkUrl);
}

/**
 * Greys out and disables the Header Icon controls while a logo is set, and
 * shows the hint that explains why the title/icon aren't visible.
 */
function updateBrandRowState() {
  const overridden = brandIsOverriddenByLogo();
  const row  = document.getElementById('brandIconRow');
  const hint = document.getElementById('brandOverriddenHint');
  if (!row) return;

  row.classList.toggle('is-inactive', overridden);
  hint.classList.toggle('hidden', !overridden);
  ['pickBrandIconLibraryBtn', 'pickBrandIconPresetBtn', 'uploadBrandIconBtn', 'removeBrandIconBtn']
    .forEach(id => { document.getElementById(id).disabled = overridden; });
  document.getElementById('removeBrandIconBtn')
    .classList.toggle('hidden', !brandIconUrl || overridden);
}

// getLogoForCurrentTheme() and updateHeaderLogo() live in core.js, beside
// applyTheme(), which calls them while the page is still loading.

function updateSettingsPreview(variant, url) {
  const img = document.getElementById(variant === 'light' ? 'lightLogoPreview' : 'darkLogoPreview');
  const btn = document.getElementById(variant === 'light' ? 'removeLightLogoBtn' : 'removeDarkLogoBtn');
  if (url) { img.src = url; img.classList.remove('hidden'); btn.classList.remove('hidden'); }
  else      { img.classList.add('hidden'); btn.classList.add('hidden'); }
}

function updateWallpaperPreview(variant, url) {
  const img = document.getElementById(variant === 'light' ? 'lightWallpaperPreview' : 'darkWallpaperPreview');
  const btn = document.getElementById(variant === 'light' ? 'removeLightWallpaperBtn' : 'removeDarkWallpaperBtn');
  if (url) { img.src = url; img.classList.remove('hidden'); btn.classList.remove('hidden'); }
  else      { img.classList.add('hidden'); btn.classList.add('hidden'); }
}

function updatePublicPasswordStatus(isSet) {
  document.getElementById('publicPasswordDesc').textContent =
    isSet ? 'Public page requires a password' : 'Public page is open to anyone';
  document.getElementById('removePublicPasswordBtn').classList.toggle('hidden', !isSet);
}

function updateRequestPasswordStatus(isSet) {
  document.getElementById('requestPasswordDesc').textContent =
    isSet ? 'A password is required to submit a request' : 'Anyone can submit a request';
  document.getElementById('removeRequestPasswordBtn').classList.toggle('hidden', !isSet);
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
  brandIconUrl = s.brand_icon || null;
  updateBrandIconPreview(brandIconUrl);
  updateBrandRowState();
  populatePinnedGroupSelect(s.pinned_group_id ?? null);
  document.getElementById('siteTitleInput').value = s.site_title || '';
  document.getElementById('saveFaviconsToggle').checked = !!s.save_favicons_to_library;
  updatePublicPasswordStatus(s.public_password_required);
  document.getElementById('requestsEnabledToggle').checked = !!s.requests_enabled;
  document.getElementById('footerEnabledToggle').checked = !!s.footer_enabled;
  document.getElementById('requireLoginToggle').checked = !!s.require_login;
  if (Number.isFinite(s.user_storage_quota)) {
    document.getElementById('userQuotaInput').value = Math.round(s.user_storage_quota / 1024 / 1024);
  }
  document.getElementById('groupTabColorToggle').checked = s.group_tab_color !== false;
  document.getElementById('groupTabsLoopToggle').checked = !!s.group_tabs_loop;
  document.getElementById('markdownOpenModeSelect').value =
    s.markdown_open_mode === 'tab' ? 'tab' : 'modal';
  updateWallpaperPreview('light', s.wallpaper_light || null);
  updateWallpaperPreview('dark',  s.wallpaper_dark  || null);
  const fog = Number.isFinite(s.wallpaper_fog) ? s.wallpaper_fog : 60;
  document.getElementById('wallpaperFogRange').value = String(fog);
  document.getElementById('wallpaperFogValue').textContent = `${fog}%`;
  const barPct = Number.isFinite(s.bar_opacity) ? s.bar_opacity : 82;
  document.getElementById('barOpacityRange').value = String(barPct);
  document.getElementById('barOpacityValue').textContent = `${barPct}%`;
  updateRequestPasswordStatus(s.request_password_required);
  hydrateThemeControls(s);
  resetSettingsTabs();
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
  updateHeaderLogo(); updateSettingsPreview('light', logoLightUrl); updateBrandRowState();
  e.target.value = ''; showToast('Light logo updated');
});
document.getElementById('removeLightLogoBtn').addEventListener('click', async () => {
  await removeLogo('light'); logoLightUrl = null;
  updateHeaderLogo(); updateSettingsPreview('light', null); updateBrandRowState();
  showToast('Light logo removed');
});

// ─── Wallpaper ──────────────────────────────────────────────────────────────
//
// Same shape as the logos: one image per theme, uploaded and removed on its
// own. The fog slider is saved when the drag ends rather than on every pixel,
// so dragging it is one request and not a hundred.

for (const variant of ['light', 'dark']) {
  const Cap = variant === 'light' ? 'Light' : 'Dark';

  document.getElementById(`upload${Cap}WallpaperBtn`).addEventListener('click', () =>
    document.getElementById(`${variant}WallpaperInput`).click());

  document.getElementById(`${variant}WallpaperInput`).addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const r = await uploadWallpaper(variant, file).catch(() => null);
    e.target.value = '';
    if (!r?.wallpaper_url) { showToast('Could not upload that image', 'error'); return; }
    updateWallpaperPreview(variant, r.wallpaper_url);
    showToast(`${Cap} wallpaper updated`);
  });

  document.getElementById(`remove${Cap}WallpaperBtn`).addEventListener('click', async () => {
    await removeWallpaper(variant);
    updateWallpaperPreview(variant, null);
    showToast(`${Cap} wallpaper removed`);
  });
}

const fogRange = document.getElementById('wallpaperFogRange');
const fogValue = document.getElementById('wallpaperFogValue');

fogRange.addEventListener('input', () => { fogValue.textContent = `${fogRange.value}%`; });
fogRange.addEventListener('change', async () => {
  const res = await saveWallpaperFog(Number(fogRange.value)).catch(() => null);
  if (!res || typeof res.wallpaper_fog !== 'number') {
    showToast('Could not save the fog', 'error');
    return;
  }
  showToast(`Fog set to ${res.wallpaper_fog}%`);
});

const barRange = document.getElementById('barOpacityRange');
const barValue = document.getElementById('barOpacityValue');

barRange.addEventListener('input', () => { barValue.textContent = `${barRange.value}%`; });
barRange.addEventListener('change', async () => {
  const res = await saveBarOpacity(Number(barRange.value)).catch(() => null);
  if (!res || typeof res.bar_opacity !== 'number') {
    showToast('Could not save the bar opacity', 'error');
    return;
  }
  showToast(`Bars set to ${res.bar_opacity}%`);
});

document.getElementById('uploadDarkLogoBtn').addEventListener('click', () =>
  document.getElementById('darkLogoFileInput').click());
document.getElementById('darkLogoFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const r    = await uploadLogo('dark', file);
  logoDarkUrl  = r.logo_url;
  updateHeaderLogo(); updateSettingsPreview('dark', logoDarkUrl); updateBrandRowState();
  e.target.value = ''; showToast('Dark logo updated');
});
document.getElementById('removeDarkLogoBtn').addEventListener('click', async () => {
  await removeLogo('dark'); logoDarkUrl = null;
  updateHeaderLogo(); updateSettingsPreview('dark', null); updateBrandRowState();
  showToast('Dark logo removed');
});

// ─── Header icon: library pick / stock icon / upload / remove ───────────────

/** Applies a saved brand-icon path to state, header, and the settings row. */
function adoptBrandIcon(url) {
  brandIconUrl = url || null;
  applyBrandIcon(brandIconUrl);
  updateBrandIconPreview(brandIconUrl);
  updateBrandRowState();
}

/**
 * Adopts the response of a brand-icon write. apiJson resolves with the error
 * body on failure, so a missing path means the write didn't happen — leave the
 * current icon alone in that case.
 */
function adoptBrandIconResponse(res) {
  if (!res?.brand_icon) {
    showToast(res?.error || 'Could not update the header icon', 'error');
    return;
  }
  adoptBrandIcon(res.brand_icon);
  showToast('Header icon updated');
}

document.getElementById('uploadBrandIconBtn').addEventListener('click', () =>
  document.getElementById('brandIconFileInput').click());
document.getElementById('brandIconFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  try {
    adoptBrandIconResponse(await uploadBrandIcon(file));
  } catch {
    showToast('Could not update the header icon', 'error');
  }
});

document.getElementById('removeBrandIconBtn').addEventListener('click', async () => {
  await removeBrandIconApi();
  adoptBrandIcon(null);
  showToast('Header icon removed');
});

// Both pickers reuse the link-form modals; they hide Settings while open and
// restore it once a choice is applied or cancelled.
document.getElementById('pickBrandIconLibraryBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').classList.add('hidden');
  openIconLibrary({ pickerMode: true, target: 'brand' });
});

document.getElementById('pickBrandIconPresetBtn').addEventListener('click', () => {
  document.getElementById('settingsOverlay').classList.add('hidden');
  openIconPresets({ target: 'brand' });
});

/** Re-opens Settings after a brand-icon picker closes. */
function reopenSettingsAfterBrandPick() {
  document.getElementById('settingsOverlay').classList.remove('hidden');
}

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
  applyBrandText(result.site_title);
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

document.getElementById('requestsEnabledToggle').addEventListener('change', async e => {
  const enabled = e.target.checked;
  const res = await sendAuthRequest('/api/settings/requests-enabled', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    e.target.checked = !enabled;
    showToast('Could not save setting');
    return;
  }
  updateRequestsFeatureUI(enabled);
  showToast(enabled ? 'Link requests enabled' : 'Link requests disabled');
});

document.getElementById('requireLoginToggle').addEventListener('change', async e => {
  const enabled = e.target.checked;
  const res = await sendAuthRequest('/api/settings/require-login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    e.target.checked = !enabled;
    // 409 says why: nobody could sign in. Show that rather than a generic error.
    const d = await res.json().catch(() => ({}));
    showToast(d.error || 'Could not save setting', 'error');
    return;
  }
  showToast(enabled ? 'The page is now members-only' : 'The page is open to everyone again');
});

document.getElementById('footerEnabledToggle').addEventListener('change', async e => {
  const enabled = e.target.checked;
  const res = await sendAuthRequest('/api/settings/footer-enabled', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    e.target.checked = !enabled;
    showToast('Could not save setting');
    return;
  }
  updateFooterUI(enabled);
  showToast(enabled ? 'Footer shown' : 'Footer hidden');
});

document.getElementById('groupTabColorToggle').addEventListener('change', async e => {
  const enabled = e.target.checked;
  const res = await sendAuthRequest('/api/settings/group-tab-color', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    e.target.checked = !enabled;
    showToast('Could not save setting');
    return;
  }
  showToast(enabled ? 'Tabs use group colour' : 'Tabs use secondary colour');
});

document.getElementById('markdownOpenModeSelect').addEventListener('change', async e => {
  const mode = e.target.value;
  const res  = await sendAuthRequest('/api/settings/markdown-open-mode', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ mode }),
  });
  if (!res.ok) {
    // Put the control back where it was rather than leaving it showing a
    // choice the server never took.
    e.target.value = mode === 'modal' ? 'tab' : 'modal';
    showToast('Could not save setting');
    return;
  }
  showToast(mode === 'modal' ? 'Markdown opens in a popup' : 'Markdown opens in a new tab');
});

document.getElementById('groupTabsLoopToggle').addEventListener('change', async e => {
  const enabled = e.target.checked;
  const res = await sendAuthRequest('/api/settings/group-tabs-loop', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    e.target.checked = !enabled;
    showToast('Could not save setting');
    return;
  }
  showToast(enabled ? 'Group tabs loop endlessly' : 'Group tabs stop at the ends');
});

document.getElementById('setRequestPasswordBtn').addEventListener('click', async () => {
  const pw = document.getElementById('requestPasswordInput').value;
  if (!pw) return;
  await setRequestPassword(pw);
  document.getElementById('requestPasswordInput').value = '';
  updateRequestPasswordStatus(true); showToast('Request password set');
});
document.getElementById('removeRequestPasswordBtn').addEventListener('click', async () => {
  await removeRequestPassword(); updateRequestPasswordStatus(false); showToast('Request password removed');
});

// ─── Themes / Design ──────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  '#0071e3','#5856d6','#af52de','#ff2d55','#ff3b30',
  '#ff9500','#34c759','#00c7be','#007aff','#1d1d1f',
];

// Builds the accent swatch row (presets + native custom picker), mirroring the
// group-colour picker. `selected` is the current accent hex, or null for default.
function buildAccentPalette(selected) {
  const palette  = document.getElementById('accentPalette');
  if (!palette) return;
  const isCustom = !!selected && !ACCENT_COLORS.includes(selected);

  const presets = ACCENT_COLORS.map(c => `
    <div class="color-swatch${c === selected ? ' selected' : ''}"
         data-color="${c}" style="background:${c}" title="${c}"></div>`).join('');
  palette.innerHTML = `${presets}
    <label class="color-swatch color-swatch-custom${isCustom ? ' selected' : ''}"
           title="Custom colour"
           style="background:${escapeHtml(isCustom ? selected : '#888888')}">
      <span class="color-swatch-plus">+</span>
      <input type="color" id="accentColorPicker" value="${escapeHtml(isCustom ? selected : ACCENT_COLORS[0])}" />
    </label>`;

  function pick(el, color) {
    palette.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    commitAccent(color);
  }
  palette.querySelectorAll('.color-swatch[data-color]').forEach(s =>
    s.addEventListener('click', () => pick(s, s.dataset.color)));
  const customSwatch = palette.querySelector('.color-swatch-custom');
  palette.querySelector('#accentColorPicker').addEventListener('input', e => {
    customSwatch.style.background = e.target.value;
    pick(customSwatch, e.target.value);
  });
}

// Applies + persists a chosen accent, live across the admin UI.
function commitAccent(hex) {
  document.getElementById('accentColorInput').value = hex;
  themeSettings.accent = hex;
  applyAccent(document.documentElement.getAttribute('data-theme') || 'light');
  saveTheme({ accent_color: hex }).catch(() => showToast('Could not save accent', 'error'));
}

// Populates all Themes/Design controls from a settings object.
function hydrateThemeControls(s) {
  buildAccentPalette(s.accent_color || null);
  document.getElementById('accentColorInput').value = s.accent_color || '';
  document.getElementById('accentDarkAdjustToggle').checked = !!s.accent_dark_adjust;
  document.getElementById('accentGlowToggle').checked = !!s.accent_glow;
  document.getElementById('lightVariantSelect').value = s.theme_light_variant || 'default';
  document.getElementById('darkVariantSelect').value  = s.theme_dark_variant  || 'default';
  document.getElementById('defaultThemeSelect').value = s.default_theme || 'system';
  document.getElementById('mobileNavSelect').value    = s.mobile_nav_position || 'top';
}

document.getElementById('resetAccentBtn').addEventListener('click', () => {
  document.getElementById('accentColorInput').value = '';
  themeSettings.accent = null;
  applyAccent(document.documentElement.getAttribute('data-theme') || 'light');
  buildAccentPalette(null);
  saveTheme({ accent_color: '' }).then(() => showToast('Accent reset'))
    .catch(() => showToast('Could not reset accent', 'error'));
});

document.getElementById('accentDarkAdjustToggle').addEventListener('change', e => {
  themeSettings.accentDarkAdjust = e.target.checked;
  applyAccent(document.documentElement.getAttribute('data-theme') || 'light');
  saveTheme({ accent_dark_adjust: e.target.checked })
    .catch(() => { e.target.checked = !e.target.checked; showToast('Could not save setting', 'error'); });
});

document.getElementById('accentGlowToggle').addEventListener('change', e => {
  themeSettings.glow = e.target.checked;
  applyThemeVariants();
  saveTheme({ accent_glow: e.target.checked })
    .catch(() => { e.target.checked = !e.target.checked; showToast('Could not save setting', 'error'); });
});

// Settings sidebar tabs: swap the visible panel.
document.getElementById('settingsNav').addEventListener('click', e => {
  const tab = e.target.closest('.settings-tab');
  if (!tab) return;
  const id = tab.dataset.tab;
  document.querySelectorAll('#settingsNav .settings-tab').forEach(t => t.classList.toggle('active', t === tab));
  document.querySelectorAll('#settingsPanels .settings-panel')
    .forEach(p => p.classList.toggle('active', p.dataset.panel === id));
  document.getElementById('settingsPanels').scrollTop = 0;
  if (id === 'ipattribution') loadIpTags();
  if (id === 'users')         loadAccounts();
  if (id === 'sso')           loadSsoSettings();
  if (id === 'mail')          loadMailSettings();
});

// Always open the settings modal on the first tab.
function resetSettingsTabs() {
  const tabs = document.querySelectorAll('#settingsNav .settings-tab');
  tabs.forEach((t, i) => t.classList.toggle('active', i === 0));
  document.querySelectorAll('#settingsPanels .settings-panel')
    .forEach((p, i) => p.classList.toggle('active', i === 0));
}

document.getElementById('lightVariantSelect').addEventListener('change', e => {
  themeSettings.light = e.target.value;
  applyThemeVariants();
  saveTheme({ light_variant: e.target.value }).then(() => showToast('Light palette updated'));
});

document.getElementById('darkVariantSelect').addEventListener('change', e => {
  themeSettings.dark = e.target.value;
  applyThemeVariants();
  saveTheme({ dark_variant: e.target.value }).then(() => showToast('Dark palette updated'));
});

document.getElementById('defaultThemeSelect').addEventListener('change', e => {
  themeSettings.default = e.target.value;
  saveTheme({ default_theme: e.target.value }).then(() => showToast('Default theme updated'));
});

document.getElementById('mobileNavSelect').addEventListener('change', e => {
  saveTheme({ mobile_nav_position: e.target.value })
    .then(() => showToast(`Mobile navbar: ${e.target.value}`))
    .catch(() => showToast('Could not save setting', 'error'));
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

