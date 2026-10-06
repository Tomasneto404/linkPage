// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: bulk selection and drag to reorder. */

// ─── 15. BULK ACTIONS ─────────────────────────────────────────────────────────

let bulkModeActive = false;

// Anchor for shift-click range selection. Stored as a link ID (not a DOM
// node) because entering bulk mode and other state changes re-render the
// grid — a held DOM reference would become detached and the range walk
// would silently find nothing.
let lastClickedLinkId = null;

/**
 * Marks every visible link-card-wrap between two link IDs as `selected`,
 * inclusive in either order. Operates on the current DOM so it reflects
 * exactly what the user sees (filters, sections, search).
 */
function selectRangeBetween(fromId, toId) {
  const wraps = Array.from(document.querySelectorAll('#linksGrid .link-card-wrap'));
  const fi = wraps.findIndex(w => Number(w.dataset.linkId) === fromId);
  const ti = wraps.findIndex(w => Number(w.dataset.linkId) === toId);
  if (fi < 0 || ti < 0) return;
  const [lo, hi] = fi <= ti ? [fi, ti] : [ti, fi];
  for (let i = lo; i <= hi; i++) wraps[i].classList.add('selected');
  updateBulkBar();
}

// ─── Long-press to enter bulk mode (iOS-style) ────────────────────────────────

const LONG_PRESS_MS         = 450;
const LONG_PRESS_CANCEL_PX  = 10;   // movement that aborts the press (scroll intent)
let   longPressTimer        = null;
let   longPressActiveWrap   = null;
let   longPressJustFired    = false; // suppresses the click that follows a successful press

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  if (longPressActiveWrap) {
    longPressActiveWrap.classList.remove('long-pressing');
    longPressActiveWrap = null;
  }
}

/**
 * Wires pointer events on a card so that a sustained press enters bulk mode
 * and selects the card. Re-selects on the new wrap after the re-render.
 */
function setupLongPress(wrap, linkId) {
  let startX = 0, startY = 0;

  wrap.addEventListener('pointerdown', e => {
    // Don't trigger when already in bulk mode (taps already select).
    if (bulkModeActive) return;
    // Skip when the press lands on a real interactive child.
    if (e.target.closest('.link-actions, .link-url, a, button')) return;
    // Right-click / middle-click pass through.
    if (e.button && e.button !== 0) return;

    cancelLongPress();
    longPressActiveWrap = wrap;
    startX = e.clientX; startY = e.clientY;
    wrap.classList.add('long-pressing');

    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      wrap.classList.remove('long-pressing');
      longPressJustFired = true;

      // Light haptic tap on supported devices (mobile mostly).
      if (typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(30); } catch {}
      }

      // Enter bulk mode (this re-renders the grid; the wrap reference becomes stale)
      if (!bulkModeActive) enterBulkMode();

      // Select the freshly-rendered card and refresh the bulk bar. Also pin
      // it as the shift-click anchor so the user can shift-tap further cards
      // immediately without a preliminary single click.
      const freshWrap = document.querySelector(`.link-card-wrap[data-link-id="${linkId}"]`);
      if (freshWrap) {
        freshWrap.classList.add('selected');
        lastClickedLinkId = linkId;
        updateBulkBar();
      }

      // Release the click-suppression flag after the synthetic tap settles.
      setTimeout(() => { longPressJustFired = false; }, 350);
    }, LONG_PRESS_MS);
  });

  wrap.addEventListener('pointermove', e => {
    if (!longPressTimer) return;
    if (Math.abs(e.clientX - startX) > LONG_PRESS_CANCEL_PX ||
        Math.abs(e.clientY - startY) > LONG_PRESS_CANCEL_PX) {
      cancelLongPress();
    }
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt =>
    wrap.addEventListener(evt, cancelLongPress));
}

function getSelectedIds() {
  return Array.from(document.querySelectorAll('.link-card-wrap.selected'))
    .map(w => Number(w.dataset.linkId));
}

function updateBulkBar() {
  const count = getSelectedIds().length;
  document.getElementById('bulkCount').textContent = `${count} selected`;
  document.getElementById('bulkBar').classList.toggle('hidden', count === 0);

  // Flip the Select-all button between "select all" and "clear" so a second
  // press is unambiguous.
  const selectAllBtn = document.getElementById('bulkSelectAllBtn');
  if (selectAllBtn) {
    const total = document.querySelectorAll('#linksGrid .link-card-wrap').length;
    const allSelected = total > 0 && count === total;
    selectAllBtn.textContent = allSelected ? 'Clear selection' : 'Select all';
  }
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
  lastClickedLinkId = null;
  document.getElementById('bulkSelectBtn').textContent = 'Select';
  document.getElementById('bulkBar').classList.add('hidden');
  document.getElementById('linksGrid').classList.remove('bulk-mode');
  renderLinks();
}

document.getElementById('bulkSelectBtn').addEventListener('click', () =>
  bulkModeActive ? exitBulkMode() : enterBulkMode());

document.getElementById('bulkCancelBtn').addEventListener('click', exitBulkMode);

/**
 * Selects every currently-visible link card. Doubles as a toggle: clicking
 * again when everything's already selected clears the selection. The button's
 * label flips to "Clear selection" while everything is selected to make the
 * second click obvious.
 */
function toggleSelectAllVisible() {
  if (!bulkModeActive) enterBulkMode();
  const wraps = Array.from(document.querySelectorAll('#linksGrid .link-card-wrap'));
  if (!wraps.length) return;
  const allSelected = wraps.every(w => w.classList.contains('selected'));
  if (allSelected) {
    wraps.forEach(w => w.classList.remove('selected'));
    lastClickedLinkId = null;
  } else {
    wraps.forEach(w => w.classList.add('selected'));
    // Anchor on the first card so a follow-up shift+click contracts the range.
    lastClickedLinkId = Number(wraps[0].dataset.linkId);
  }
  updateBulkBar();
}

document.getElementById('bulkSelectAllBtn').addEventListener('click', toggleSelectAllVisible);

// Cmd/Ctrl + A while in bulk mode also selects all visible — same shortcut as
// every other "list of items" UI on the platform.
document.addEventListener('keydown', e => {
  if (!bulkModeActive) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    // Don't hijack the shortcut when the user is typing in an input/textarea.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleSelectAllVisible();
  }
});

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

/**
 * Refreshes the bulk-bar's section dropdown based on the chosen group.
 * Shows top-level sections + their subsections with a "↳" indent — same
 * format the link form uses, so the layout reads identically.
 */
function refreshBulkSectionDropdown() {
  const groupVal = document.getElementById('bulkGroupSelect').value;
  const sectionSel = document.getElementById('bulkSectionSelect');
  if (!groupVal || groupVal === 'none') {
    sectionSel.classList.add('hidden');
    sectionSel.innerHTML = '<option value="">No section</option>';
    return;
  }
  const group = groups.find(g => g.id === Number(groupVal));
  if (!group || !(group.sections || []).length) {
    sectionSel.classList.add('hidden');
    sectionSel.innerHTML = '<option value="">No section</option>';
    return;
  }
  const opts = group.sections.flatMap(s => {
    const top = `<option value="${s.id}">${escapeHtml(s.name)}</option>`;
    const subs = (s.subsections || []).map(sub =>
      `<option value="${sub.id}">      ↳ ${escapeHtml(sub.name)}</option>`);
    return [top, ...subs];
  }).join('');
  sectionSel.innerHTML = `<option value="">No section</option>${opts}`;
  sectionSel.classList.remove('hidden');
}

document.getElementById('bulkGroupSelect').addEventListener('change', refreshBulkSectionDropdown);

document.getElementById('bulkMoveBtn').addEventListener('click', async () => {
  const ids        = getSelectedIds();
  const groupVal   = document.getElementById('bulkGroupSelect').value;
  const sectionVal = document.getElementById('bulkSectionSelect').value;
  if (!ids.length || !groupVal) return;

  // Build the assignments array sent to PUT /api/links/:id — same shape as
  // the link form. "none" empties the membership list; otherwise we pin every
  // selected link to the chosen (group, section) leaf.
  const sectionId = sectionVal ? Number(sectionVal) : null;
  const assignments = groupVal === 'none'
    ? []
    : [{ group_id: Number(groupVal), section_id: sectionId }];

  await Promise.all(ids.map(id => {
    const link = links.find(l => l.id === id); if (!link) return;
    const fd = new FormData();
    fd.append('name',         link.name);
    fd.append('url',          link.url);
    fd.append('description',  link.description || '');
    fd.append('groups',       JSON.stringify(assignments));
    fd.append('remove_image', 'false');
    return updateLink(id, fd);
  }));

  // Friendly toast: name what they were moved into for confidence.
  let where = 'group';
  if (groupVal === 'none') {
    where = 'no group';
  } else {
    const g = groups.find(x => x.id === Number(groupVal));
    where = g ? g.name : 'group';
    if (sectionId && g) {
      const flat = (g.sections || []).flatMap(s => [s, ...(s.subsections || [])]);
      const s = flat.find(x => x.id === sectionId);
      if (s) where += ` › ${s.name}`;
    }
  }
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} moved to ${where}`);
  exitBulkMode(); await loadAllData();
});

/** Sets visibility on every selected link in parallel, then refreshes. */
async function bulkSetVisibility(hidden) {
  const ids = getSelectedIds();
  if (!ids.length) return;
  await Promise.all(ids.map(id => setLinkVisibility(id, hidden)));
  const label = hidden ? 'hidden' : 'shown';
  showToast(`${ids.length} link${ids.length !== 1 ? 's' : ''} ${label}`);
  exitBulkMode();
  await loadAllData();
}

document.getElementById('bulkHideBtn').addEventListener('click', () => bulkSetVisibility(true));
document.getElementById('bulkShowBtn').addEventListener('click', () => bulkSetVisibility(false));


// ─── 16. DRAG TO REORDER ──────────────────────────────────────────────────────

let draggedLinkId = null;

function enableLinkDrag(card, linkId) {
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', e => {
    if (bulkModeActive || sortOrder !== 'position') { e.preventDefault(); return; }
    draggedLinkId = linkId; card.classList.add('dragging');
    document.body.classList.add('is-link-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.link-card.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.drag-over-link').forEach(el => el.classList.remove('drag-over-link'));
    document.body.classList.remove('is-link-dragging');
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

/**
 * Updates the group/section assignment of a single link without touching its
 * other memberships. Used by drag-to-section in the sidebar.
 *
 *  - Existing memberships in OTHER groups are kept as-is.
 *  - The membership for `groupId` is replaced (added if not present) with
 *    `sectionId` as the leaf section. Pass null to clear the section
 *    (link sits at the top level of that group).
 */
async function moveLinkIntoSection(linkId, groupId, sectionId) {
  const link = links.find(l => l.id === linkId);
  if (!link) return;

  const others = (link.groups || []).filter(g => g.id !== groupId);
  const assignments = [
    ...others.map(g => ({ group_id: g.id, section_id: g.section_id ?? null })),
    { group_id: groupId, section_id: sectionId },
  ];

  const fd = new FormData();
  fd.append('name',         link.name);
  fd.append('url',          link.url);
  fd.append('description',  link.description || '');
  fd.append('groups',       JSON.stringify(assignments));
  fd.append('remove_image', 'false');

  try {
    await updateLink(linkId, fd);
    // Build a friendly destination string for the toast.
    const targetGroup = groups.find(g => g.id === groupId);
    let where = targetGroup?.name || 'group';
    if (sectionId && targetGroup) {
      const flat = (targetGroup.sections || []).flatMap(s => [s, ...(s.subsections || [])]);
      const sec = flat.find(x => x.id === sectionId);
      if (sec) where += ` › ${sec.name}`;
    }
    showToast(`"${link.name}" moved to ${where}`);
    await loadAllData();
  } catch {
    showToast('Could not move link', 'error');
  }
}

