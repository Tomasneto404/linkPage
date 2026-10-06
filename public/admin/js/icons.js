// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: the stock icon picker and the icon library. */

// ─── 20.7. STOCK ICON PICKER (with color) ────────────────────────────────────
//
// Renders the curated ICON_PRESETS set with a colour-picker, lets the user
// pick one, and feeds the chosen (icon + colour) into the link form as a
// freshly-generated SVG file. It goes through the normal `image` upload path,
// so on save it lands in the icon library and any other link can reuse it.

const ICON_PRESET_DEFAULT_COLOR = '#0071e3';
let iconPresetsQuery        = '';
let iconPresetsColor        = ICON_PRESET_DEFAULT_COLOR;
let iconPresetsSelectedName = null;
let iconPresetsTarget       = 'link';   // 'link' form field, or the header icon

function buildPresetSvgString(body, color, { size = 64, strokeWidth = 2 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function openIconPresets({ target = 'link' } = {}) {
  iconPresetsTarget       = target;
  iconPresetsQuery        = '';
  iconPresetsSelectedName = null;
  document.getElementById('iconPresetsSearchInput').value = '';
  document.getElementById('iconPresetsColorInput').value  = iconPresetsColor;

  renderIconPresetsPalette();
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
  document.getElementById('iconPresetsOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('iconPresetsSearchInput').focus(), 60);
}

function closeIconPresets() {
  document.getElementById('iconPresetsOverlay').classList.add('hidden');
  // The header-icon flow starts in Settings; return the user there.
  if (iconPresetsTarget === 'brand') {
    iconPresetsTarget = 'link';
    reopenSettingsAfterBrandPick();
  }
}

function renderIconPresetsPalette() {
  const palette = document.getElementById('iconPresetsPalette');
  palette.innerHTML = (window.ICON_PRESET_COLORS || []).map(c => `
    <button type="button" class="icon-presets-swatch ${c === iconPresetsColor ? 'is-active' : ''}"
            data-color="${escapeHtml(c)}"
            style="background:${escapeHtml(c)}"
            aria-label="Use ${escapeHtml(c)}"></button>
  `).join('');
}

function renderIconPresetsGrid() {
  const grid     = document.getElementById('iconPresetsGrid');
  const empty    = document.getElementById('iconPresetsNoResults');
  const count    = document.getElementById('iconPresetsCount');
  const all      = window.ICON_PRESETS || [];
  const q        = iconPresetsQuery.toLowerCase();
  const visible  = q ? all.filter(i =>
                        i.name.toLowerCase().includes(q) ||
                        (i.cat || '').toLowerCase().includes(q))
                     : all;

  count.textContent = `${all.length} icon${all.length === 1 ? '' : 's'}`;

  if (!visible.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Group visible icons by category for a tidier layout.
  const byCat = new Map();
  for (const icon of visible) {
    const key = icon.cat || 'Other';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(icon);
  }

  grid.innerHTML = [...byCat.entries()].map(([cat, icons]) => `
    <section class="icon-presets-section">
      <h3 class="icon-presets-section-title">${escapeHtml(cat)}</h3>
      <div class="icon-presets-tiles">
        ${icons.map(i => `
          <button type="button"
                  class="icon-presets-tile ${i.name === iconPresetsSelectedName ? 'is-selected' : ''}"
                  data-name="${escapeHtml(i.name)}"
                  title="${escapeHtml(i.name)}">
            ${buildPresetSvgString(i.body, iconPresetsColor, { size: 28, strokeWidth: 1.8 })}
            <span class="icon-presets-tile-name">${escapeHtml(i.name)}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function updateIconPresetsSelectedState() {
  const sel   = document.getElementById('iconPresetsSelected');
  const prev  = document.getElementById('iconPresetsSelectedPreview');
  const label = document.getElementById('iconPresetsSelectedLabel');
  const apply = document.getElementById('applyIconPresetsBtn');

  if (!iconPresetsSelectedName) {
    sel.classList.remove('is-ready');
    prev.innerHTML  = '';
    label.textContent = 'No icon selected';
    apply.disabled  = true;
    return;
  }
  const icon = (window.ICON_PRESETS || []).find(i => i.name === iconPresetsSelectedName);
  if (!icon) return;

  sel.classList.add('is-ready');
  prev.innerHTML    = buildPresetSvgString(icon.body, iconPresetsColor, { size: 22, strokeWidth: 2 });
  label.textContent = icon.name;
  apply.disabled    = false;
}

/**
 * Renders a preset at icon size in the current colour and wraps it in a File,
 * so both consumers (link form, header icon) go through a normal image upload.
 */
function buildPresetSvgFile(icon) {
  const svgString = buildPresetSvgString(icon.body, iconPresetsColor, { size: 128, strokeWidth: 1.8 });
  const blob      = new Blob([svgString], { type: 'image/svg+xml' });
  return new File([blob], `icon-${icon.name}-${iconPresetsColor.replace('#', '')}.svg`,
                  { type: 'image/svg+xml' });
}

async function applyIconPresetsSelection() {
  if (!iconPresetsSelectedName) return;
  const icon = (window.ICON_PRESETS || []).find(i => i.name === iconPresetsSelectedName);
  if (!icon) return;

  // Header icon: upload the generated SVG straight to the brand-icon setting
  // (which registers it in the library too, same as the link flow).
  if (iconPresetsTarget === 'brand') {
    try {
      adoptBrandIconResponse(await uploadBrandIcon(buildPresetSvgFile(icon)));
    } catch {
      showToast('Could not update the header icon', 'error');
    }
    closeIconPresets();
    return;
  }

  // Stuff the generated SVG into the link form's #inputImage as if the admin
  // had uploaded it themselves — the rest of the submit flow then handles
  // uploading + library auto-registration with no extra plumbing.
  const svgString = buildPresetSvgString(icon.body, iconPresetsColor, { size: 128, strokeWidth: 1.8 });
  const dt = new DataTransfer();
  dt.items.add(buildPresetSvgFile(icon));
  document.getElementById('inputImage').files = dt.files;

  // Wire the preview the same way the upload flow does.
  showCustomIconPreview(`data:image/svg+xml;utf8,${encodeURIComponent(svgString)}`);
  shouldRemoveIcon = false;
  pendingIconId    = null;
  closeIconPresets();
}

// Event wiring
document.getElementById('openIconPresetsBtn').addEventListener('click', () => openIconPresets());
document.getElementById('closeIconPresetsBtn').addEventListener('click', closeIconPresets);
document.getElementById('cancelIconPresetsBtn').addEventListener('click', closeIconPresets);
document.getElementById('applyIconPresetsBtn').addEventListener('click', applyIconPresetsSelection);

document.getElementById('iconPresetsSearchInput').addEventListener('input', e => {
  iconPresetsQuery = e.target.value.trim();
  renderIconPresetsGrid();
});

document.getElementById('iconPresetsPalette').addEventListener('click', e => {
  const btn = e.target.closest('[data-color]');
  if (!btn) return;
  iconPresetsColor = btn.dataset.color;
  document.getElementById('iconPresetsColorInput').value = iconPresetsColor;
  renderIconPresetsPalette();
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
});

document.getElementById('iconPresetsColorInput').addEventListener('input', e => {
  iconPresetsColor = e.target.value;
  renderIconPresetsPalette();
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
});

document.getElementById('iconPresetsGrid').addEventListener('click', e => {
  const tile = e.target.closest('[data-name]');
  if (!tile) return;
  iconPresetsSelectedName = tile.dataset.name;
  renderIconPresetsGrid();
  updateIconPresetsSelectedState();
});


// ─── 20.5. ICON LIBRARY ──────────────────────────────────────────────────────

let iconLibraryItems    = [];
let iconLibraryQuery    = '';
let iconLibraryPicker   = false;  // true when opened from the link modal
let iconLibraryTarget   = 'link'; // where a picked icon goes: 'link' | 'brand'
let iconSelectMode      = false;  // bulk-select mode (manage view)
let iconSelectedIds     = new Set();
let iconLastClickedId   = null;   // anchor for shift-click range selection

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

async function openIconLibrary({ pickerMode = false, target = 'link' } = {}) {
  iconLibraryPicker = pickerMode;
  iconLibraryTarget = pickerMode ? target : 'link';
  iconLibraryQuery  = '';
  exitIconSelectMode();
  // Hide the Select button in picker mode (picking, not managing).
  document.getElementById('iconLibrarySelectBtn').classList.toggle('hidden', pickerMode);
  document.getElementById('iconLibrarySearchInput').value = '';
  document.getElementById('iconLibraryOverlay').classList.remove('hidden');
  document.getElementById('iconLibraryBody').classList.add('loading');
  iconLibraryItems = await fetchIcons();
  document.getElementById('iconLibraryBody').classList.remove('loading');
  renderIconLibrary();
  setTimeout(() => document.getElementById('iconLibrarySearchInput').focus(), 60);
}

function closeIconLibrary() {
  exitIconSelectMode();
  document.getElementById('iconLibraryOverlay').classList.add('hidden');
  // Picking a header icon came from Settings — hand the user back to it.
  if (iconLibraryTarget === 'brand') {
    iconLibraryTarget = 'link';
    reopenSettingsAfterBrandPick();
  }
}

function enterIconSelectMode() {
  iconSelectMode = true;
  iconSelectedIds.clear();
  iconLastClickedId = null;
  document.getElementById('iconLibrarySelectBtn').textContent = 'Done';
  document.getElementById('iconLibraryGrid').classList.add('select-mode');
  updateIconBulkBar();
  renderIconLibrary();
}

function exitIconSelectMode() {
  iconSelectMode = false;
  iconSelectedIds.clear();
  iconLastClickedId = null;
  const btn = document.getElementById('iconLibrarySelectBtn');
  if (btn) btn.textContent = 'Select';
  document.getElementById('iconLibraryGrid')?.classList.remove('select-mode');
  document.getElementById('iconLibraryBulkBar')?.classList.add('hidden');
}

/** Icons currently visible under the search filter, in display order. */
function visibleIconItems() {
  const q = iconLibraryQuery.toLowerCase();
  return q
    ? iconLibraryItems.filter(i => (i.original_name || '').toLowerCase().includes(q))
    : iconLibraryItems;
}

function updateIconBulkBar() {
  const bar = document.getElementById('iconLibraryBulkBar');
  if (!iconSelectMode) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  document.getElementById('iconLibraryBulkCount').textContent = `${iconSelectedIds.size} selected`;
  const total = visibleIconItems().length;
  document.getElementById('iconLibrarySelectAllBtn').textContent =
    (total > 0 && iconSelectedIds.size === total) ? 'Clear selection' : 'Select all';
  document.getElementById('iconLibraryBulkDeleteBtn').disabled = iconSelectedIds.size === 0;
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
    const label      = icon.original_name || 'icon';
    const used        = icon.usage_count || 0;
    const pickedHere  = iconLibraryPicker && (iconLibraryTarget === 'brand'
                          ? icon.file_path === brandIconUrl
                          : pendingIconId === icon.id);
    const bulkPicked  = iconSelectMode && iconSelectedIds.has(icon.id);
    const selected    = pickedHere || bulkPicked;
    // In select mode the whole card toggles selection; the per-card delete
    // button is hidden (bulk bar handles deletion).
    const checkmark = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    return `
      <div class="icon-library-card ${selected ? 'is-selected' : ''} ${bulkPicked ? 'is-checked' : ''}" data-id="${icon.id}" title="${escapeHtml(label)}">
        <button type="button" class="icon-library-card-pick" data-action="pick" data-id="${icon.id}">
          <div class="icon-library-thumb">
            <img src="${escapeHtml(icon.file_path)}" alt="${escapeHtml(label)}" loading="lazy" />
          </div>
          <div class="icon-library-meta">
            <span class="icon-library-name">${escapeHtml(label)}</span>
            <span class="icon-library-usage">${used} ${used === 1 ? 'use' : 'uses'}</span>
          </div>
        </button>
        ${iconSelectMode
          ? `<span class="icon-library-check" aria-hidden="true">${bulkPicked ? checkmark : ''}</span>`
          : `<button type="button" class="icon-library-card-delete" data-action="delete" data-id="${icon.id}" title="Delete from library">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>`}
        ${pickedHere ? '<div class="icon-library-selected-tag">Selected</div>' : ''}
      </div>
    `;
  }).join('');
}

/** Selects every visible icon between two ids (inclusive), in display order. */
function selectIconRange(fromId, toId) {
  const vis = visibleIconItems();
  const fi = vis.findIndex(i => i.id === fromId);
  const ti = vis.findIndex(i => i.id === toId);
  if (fi < 0 || ti < 0) return;
  const [lo, hi] = fi <= ti ? [fi, ti] : [ti, fi];
  for (let i = lo; i <= hi; i++) iconSelectedIds.add(vis[i].id);
}

document.getElementById('iconLibrarySearchInput').addEventListener('input', e => {
  iconLibraryQuery = e.target.value.trim();
  renderIconLibrary();
});

document.getElementById('closeIconLibraryBtn').addEventListener('click', closeIconLibrary);

document.getElementById('iconLibraryUploadBtn').addEventListener('click', () => {
  document.getElementById('iconLibraryUploadInput').click();
});

// Export the whole library as a self-contained JSON bundle (auth'd download).
document.getElementById('iconLibraryExportBtn').addEventListener('click', async () => {
  try {
    const res = await sendAuthRequest('/api/icons/export');
    if (!res.ok) throw new Error('export failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `icon-library-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Icon library exported');
  } catch {
    showToast('Could not export library', 'error');
  }
});

document.getElementById('iconLibraryImportBtn').addEventListener('click', () => {
  document.getElementById('iconLibraryImportInput').click();
});

document.getElementById('iconLibraryImportInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  e.target.value = '';
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { showToast('Invalid icon library file', 'error'); return; }
  if (!Array.isArray(payload?.icons)) {
    showToast('File must contain an "icons" array', 'error');
    return;
  }

  document.getElementById('iconLibraryBody').classList.add('loading');
  try {
    const res = await sendAuthRequest('/api/icons/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ icons: payload.icons }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result?.error || 'import failed');
    iconLibraryItems = await fetchIcons();
    renderIconLibrary();
    const bits = [];
    if (result.imported) bits.push(`${result.imported} added`);
    if (result.skipped)  bits.push(`${result.skipped} already present`);
    showToast(bits.length ? `Imported icons — ${bits.join(', ')}` : 'Nothing to import',
      result.errors?.length ? 'info' : 'success');
  } catch {
    showToast('Could not import library', 'error');
  } finally {
    document.getElementById('iconLibraryBody').classList.remove('loading');
  }
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

// ─── Icon library bulk select + delete ────────────────────────────────────
document.getElementById('iconLibrarySelectBtn').addEventListener('click', () => {
  iconSelectMode ? exitIconSelectMode() : enterIconSelectMode();
});

document.getElementById('iconLibraryBulkCancelBtn').addEventListener('click', exitIconSelectMode);

document.getElementById('iconLibrarySelectAllBtn').addEventListener('click', () => {
  const vis = visibleIconItems();
  const allSelected = vis.length > 0 && vis.every(i => iconSelectedIds.has(i.id));
  if (allSelected) { iconSelectedIds.clear(); iconLastClickedId = null; }
  else { vis.forEach(i => iconSelectedIds.add(i.id)); iconLastClickedId = vis[0]?.id ?? null; }
  updateIconBulkBar();
  renderIconLibrary();
});

document.getElementById('iconLibraryBulkDeleteBtn').addEventListener('click', async () => {
  const ids = [...iconSelectedIds];
  if (!ids.length) return;
  const inUse = iconLibraryItems.filter(i => ids.includes(i.id) && (i.usage_count || 0) > 0).length;
  const message = inUse
    ? `Delete ${ids.length} icon${ids.length !== 1 ? 's' : ''}? ${inUse} ${inUse === 1 ? 'is' : 'are'} in use — those links will fall back to their site favicon.`
    : `Delete ${ids.length} selected icon${ids.length !== 1 ? 's' : ''}? This can't be undone.`;
  const ok = await showConfirm({ title: 'Delete icons', message, confirmText: 'Delete', danger: true });
  if (!ok) return;

  const res = await sendAuthRequest('/api/icons/bulk-delete', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) { showToast('Delete failed', 'error'); return; }
  const { deleted } = await res.json().catch(() => ({ deleted: 0 }));

  // If the link form had one of the deleted icons picked, clear it.
  if (pendingIconId != null && ids.includes(pendingIconId)) {
    pendingIconId = null; shouldRemoveIcon = true; clearCustomIconPreview();
  }
  exitIconSelectMode();
  iconLibraryItems = await fetchIcons();
  renderIconLibrary();
  showToast(`${deleted} icon${deleted !== 1 ? 's' : ''} deleted`);
  if (inUse) loadAllData();   // refresh links that lost an icon
});

document.getElementById('iconLibraryGrid').addEventListener('click', async e => {
  // Select mode: clicking anywhere on a card toggles its selection, with
  // shift-click range selection from the last clicked anchor.
  if (iconSelectMode) {
    const card = e.target.closest('.icon-library-card');
    if (!card) return;
    e.preventDefault();
    const id = Number(card.dataset.id);

    if (e.shiftKey && iconLastClickedId != null && iconLastClickedId !== id) {
      window.getSelection?.()?.removeAllRanges?.();
      selectIconRange(iconLastClickedId, id);
    } else {
      if (iconSelectedIds.has(id)) { iconSelectedIds.delete(id); iconLastClickedId = null; }
      else                         { iconSelectedIds.add(id);    iconLastClickedId = id;   }
    }
    updateIconBulkBar();
    renderIconLibrary();
    return;
  }

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

async function pickIconFromLibrary(id) {
  const icon = iconLibraryItems.find(i => i.id === id);
  if (!icon) return;

  if (iconLibraryTarget === 'brand') {
    try {
      adoptBrandIconResponse(await setBrandIconFromLibrary(icon.id));
    } catch {
      showToast('Could not update the header icon', 'error');
    }
    closeIconLibrary();
    return;
  }

  pendingIconId    = icon.id;
  shouldRemoveIcon = false;
  document.getElementById('inputImage').value = '';
  showCustomIconPreview(icon.file_path, { fromLibrary: true });
  closeIconLibrary();
}

