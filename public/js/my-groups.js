// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: managing your own groups and sections. */

// ─── Your groups ──────────────────────────────────────────────────────────────

function openGroupsManager() {
  renderGroupsManager();
  el('myGroupsNewColor').innerHTML = colorPaletteHtml(DEFAULT_GROUP_COLOR);
  el('myGroupsError').classList.add('hidden');
  el('myGroupsOverlay').classList.remove('hidden');
  el('myGroupsNewName').focus();
}

function closeGroupsManager() {
  el('myGroupsOverlay').classList.add('hidden');
}

/** Groups whose Sections panel is open, so a redraw does not snap them shut. */
const openSectionPanels = new Set();

const UP_SVG   = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>';
const DOWN_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

/** Up and down, disabled at the ends. Buttons rather than dragging: they work on a phone. */
function moveButtons(prefix, index, count, what) {
  return `
    <button type="button" class="my-move" data-act="${prefix}-up" ${index === 0 ? 'disabled' : ''}
            aria-label="Move ${escapeHtml(what)} up">${UP_SVG}</button>
    <button type="button" class="my-move" data-act="${prefix}-down" ${index === count - 1 ? 'disabled' : ''}
            aria-label="Move ${escapeHtml(what)} down">${DOWN_SVG}</button>`;
}

function sectionRowHtml(sec, index, count, nested) {
  return `
    <div class="my-section-row${nested ? ' is-nested' : ''}" data-section-id="${sec.id}">
      <input type="text" class="my-section-name" value="${escapeHtml(sec.name)}"
             aria-label="Section name" maxlength="100" />
      ${moveButtons('section', index, count, sec.name)}
      <button type="button" class="btn btn-ghost btn-sm" data-act="delete-section">Delete</button>
    </div>`;
}

function sectionsPanelHtml(g) {
  const tops = g.sections || [];
  const rows = tops.map((sec, i) => sectionRowHtml(sec, i, tops.length, false)
    + (sec.subsections || []).map((sub, j, arr) => sectionRowHtml(sub, j, arr.length, true)).join('')
  ).join('');

  return `
    <div class="my-sections">
      ${rows || '<p class="my-groups-empty">No sections yet. They become headings inside the group.</p>'}
      <div class="my-section-add">
        <input type="text" class="my-section-new" placeholder="New section" maxlength="100"
               aria-label="New section name" />
        <select class="my-section-parent" aria-label="Where it goes">
          <option value="">At the top</option>
          ${tops.map(t => `<option value="${t.id}">Inside ${escapeHtml(t.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-primary btn-sm" data-act="add-section">Add</button>
      </div>
    </div>`;
}

function renderGroupsManager() {
  const list = el('myGroupsList');
  const mine = personalGroups();
  if (!mine.length) {
    list.innerHTML = '<p class="my-groups-empty">You have no groups yet. They become tabs, after the shared ones, that only you can see.</p>';
    return;
  }
  list.innerHTML = mine.map((g, i) => {
    const open = openSectionPanels.has(g.personal_id);
    const sectionCount = (g.sections || []).reduce((n, sec) => n + 1 + (sec.subsections || []).length, 0);
    return `
    <div class="my-group-item" data-personal-id="${g.personal_id}">
      <div class="my-group-row">
        <button type="button" class="my-group-color" data-act="toggle-color"
                style="background:${escapeHtml(g.color)}"
                aria-label="Change the colour of ${escapeHtml(g.name)}" aria-expanded="false"></button>
        <input type="text" class="my-group-name" value="${escapeHtml(g.name)}"
               aria-label="Group name" maxlength="100" />
        <span class="my-group-count">${g.link_count} link${g.link_count === 1 ? '' : 's'}</span>
        ${moveButtons('group', i, mine.length, g.name)}
        <button type="button" class="btn btn-ghost btn-sm" data-act="delete-group">Delete</button>
      </div>
      <div class="my-group-colors hidden">${colorPaletteHtml(g.color)}</div>
      <button type="button" class="my-sections-toggle" data-act="toggle-sections" aria-expanded="${open}">
        ${sectionCount ? `${sectionCount} section${sectionCount === 1 ? '' : 's'}` : 'Sections'}
      </button>
      <div class="my-sections-wrap${open ? '' : ' hidden'}">${sectionsPanelHtml(g)}</div>
    </div>`;
  }).join('');
}

/** Swaps an id one step within an ordered list. */
function shifted(ids, id, step) {
  const at = ids.indexOf(id), to = at + step;
  if (at < 0 || to < 0 || to >= ids.length) return null;
  const next = ids.slice();
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The section and the siblings it is ordered among, inside one group. */
function sectionSiblings(group, sectionId) {
  for (const top of group.sections || []) {
    if (top.id === sectionId) return (group.sections || []).map(x => x.id);
    if ((top.subsections || []).some(x => x.id === sectionId)) return top.subsections.map(x => x.id);
  }
  return null;
}

async function refreshGroupsManager() {
  await loadData();
  renderGroupsManager();
}

el('myGroupsList')?.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const item  = btn.closest('.my-group-item');
  const group = personalGroups().find(g => g.personal_id === Number(item?.dataset.personalId));
  if (!group) return;
  const act = btn.dataset.act;

  if (act === 'group-up' || act === 'group-down') {
    const order = shifted(personalGroups().map(g => g.personal_id), group.personal_id, act === 'group-up' ? -1 : 1);
    if (!order) return;
    const res = await myRequest(`${myBase()}/groups/reorder`, { json: { order } });
    if (!res.ok) { showToast('Could not move that group', { type: 'error' }); return; }
    await refreshGroupsManager();
    return;
  }

  if (act === 'toggle-sections') {
    if (openSectionPanels.has(group.personal_id)) openSectionPanels.delete(group.personal_id);
    else openSectionPanels.add(group.personal_id);
    renderGroupsManager();
    return;
  }

  if (act === 'add-section') {
    const panel  = btn.closest('.my-sections');
    const name   = panel.querySelector('.my-section-new').value.trim();
    const parent = panel.querySelector('.my-section-parent').value;
    if (!name) { panel.querySelector('.my-section-new').focus(); return; }
    const res = await myRequest(`${myBase()}/groups/${group.personal_id}/sections`, {
      json: { name, parent_section_id: parent ? Number(parent) : null },
    });
    if (!res.ok) { showToast(res.body.error || 'Could not add that section', { type: 'error' }); return; }
    await refreshGroupsManager();
    el('myGroupsList').querySelector(`.my-group-item[data-personal-id="${group.personal_id}"] .my-section-new`)?.focus();
    return;
  }

  const row = btn.closest('.my-section-row');
  const sectionId = Number(row?.dataset.sectionId);

  if (act === 'section-up' || act === 'section-down') {
    const siblings = sectionSiblings(group, sectionId);
    const order = siblings && shifted(siblings, sectionId, act === 'section-up' ? -1 : 1);
    if (!order) return;
    const res = await myRequest(`${myBase()}/sections/reorder`, { json: { order } });
    if (!res.ok) { showToast('Could not move that section', { type: 'error' }); return; }
    await refreshGroupsManager();
    return;
  }

  if (act === 'delete-section') {
    // Twice, on the button, as everywhere else on this page.
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Delete section?';
      btn.classList.add('btn-ghost-danger');
      return;
    }
    const res = await myRequest(`${myBase()}/sections/${sectionId}`, { method: 'DELETE' });
    if (!res.ok) { showToast('Could not delete that section', { type: 'error' }); return; }
    await refreshGroupsManager();
    showToast('Section deleted', { detail: 'Its links are still in the group.' });
  }
});

// A section is renamed when its field is left, like a group.
el('myGroupsList')?.addEventListener('change', async e => {
  const input = e.target.closest('.my-section-name');
  if (!input) return;
  const name = input.value.trim();
  const id   = Number(input.closest('.my-section-row').dataset.sectionId);
  if (!name) { await refreshGroupsManager(); return; }
  const res = await myRequest(`${myBase()}/sections/${id}`, { method: 'PUT', json: { name } });
  if (!res.ok) { showToast('Could not rename that section', { type: 'error' }); return; }
  await loadData();
  showToast('Section renamed');
});

// Enter in a new section's name adds it.
el('myGroupsList')?.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('.my-section-new')) return;
  e.preventDefault();
  e.target.closest('.my-sections').querySelector('[data-act="add-section"]').click();
});

el('myGroupsAddForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = el('myGroupsNewName').value.trim();
  if (!name) return;
  const color = el('myGroupsNewColor').querySelector('.color-palette')?.dataset.value;
  const res = await myRequest(`${myBase()}/groups`, { json: { name, color } });
  if (!res.ok) {
    el('myGroupsError').textContent = res.body.error || 'Could not create that group.';
    el('myGroupsError').classList.remove('hidden');
    return;
  }
  el('myGroupsNewName').value = '';
  el('myGroupsNewColor').innerHTML = colorPaletteHtml(DEFAULT_GROUP_COLOR);
  await loadData();
  renderGroupsManager();
});

// Renames save when the field is left, like the admin's inline edits.
el('myGroupsList')?.addEventListener('change', async e => {
  const input = e.target.closest('.my-group-name');
  if (!input) return;
  const row = input.closest('.my-group-item');
  const group = personalGroups().find(g => g.personal_id === Number(row.dataset.personalId));
  const name = input.value.trim();
  if (!group || !name || name === group.name) { input.value = group?.name || ''; return; }

  const res = await myRequest(`${myBase()}/groups/${group.personal_id}`, {
    method: 'PUT', json: { name, color: group.color },
  });
  if (!res.ok) { input.value = group.name; showToast('Could not rename that group', { type: 'error' }); return; }
  await loadData();
  showToast('Group renamed');
});

el('myGroupsList')?.addEventListener('click', async e => {
  // The dot opens the row's palette; only one is open at a time.
  const dot = e.target.closest('[data-act="toggle-color"]');
  if (dot) {
    const colors = dot.closest('.my-group-item').querySelector('.my-group-colors');
    const opening = colors.classList.contains('hidden');
    for (const other of el('myGroupsList').querySelectorAll('.my-group-colors')) other.classList.add('hidden');
    for (const other of el('myGroupsList').querySelectorAll('.my-group-color')) other.setAttribute('aria-expanded', 'false');
    colors.classList.toggle('hidden', !opening);
    dot.setAttribute('aria-expanded', String(opening));
    return;
  }

  const btn = e.target.closest('[data-act="delete-group"]');
  if (!btn) return;
  // Twice, on the button, as with links.
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'Delete group?';
    btn.classList.add('btn-ghost-danger');
    return;
  }
  const id = Number(btn.closest('.my-group-item').dataset.personalId);
  const res = await myRequest(`${myBase()}/groups/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Could not delete that group', { type: 'error' }); return; }
  await loadData();
  renderGroupsManager();
  showToast('Group deleted', { detail: 'Its links are still in All.' });
});

// A colour picked in a row is saved at once, and the tab changes behind it.
el('myGroupsList')?.addEventListener('palettechange', async e => {
  const item  = e.target.closest('.my-group-item');
  const group = personalGroups().find(g => g.personal_id === Number(item?.dataset.personalId));
  if (!group || e.detail.color === group.color) return;

  const name = item.querySelector('.my-group-name').value.trim() || group.name;
  const res = await myRequest(`${myBase()}/groups/${group.personal_id}`, {
    method: 'PUT', json: { name, color: e.detail.color },
  });
  if (!res.ok) { showToast('Could not change that colour', { type: 'error' }); return; }

  item.querySelector('.my-group-color').style.background = e.detail.color;
  await loadData();
});

el('closeMyGroupsBtn')?.addEventListener('click', closeGroupsManager);
el('myGroupsOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'myGroupsOverlay') closeGroupsManager();
});

// ─── A new group, from the + in the tab bar ──────────────────────────────────
//
// The quick way in: a name and a colour, and the new group's tab opens. The
// full manager (Your groups, in the account menu) is still where groups are
// renamed, reordered, coloured and given sections.

function openTabAddPop() {
  const btn = el('tabAddGroup');
  const pop = el('tabAddPop');
  el('tabAddName').value = '';
  el('tabAddColor').innerHTML = colorPaletteHtml(DEFAULT_GROUP_COLOR);
  el('tabAddError').classList.add('hidden');
  pop.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  placeTabAddPop();
  el('tabAddName').focus();
}

function closeTabAddPop({ restoreFocus = false } = {}) {
  if (el('tabAddPop').classList.contains('hidden')) return;
  el('tabAddPop').classList.add('hidden');
  el('tabAddGroup').setAttribute('aria-expanded', 'false');
  if (restoreFocus) el('tabAddGroup').focus();
}

/** Under the +, kept inside the window with a 16px margin on narrow screens. */
function placeTabAddPop() {
  const pop = el('tabAddPop');
  if (pop.classList.contains('hidden')) return;
  const b = el('tabAddGroup').getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.min(Math.max(16, b.left - 8), window.innerWidth - w - 16);
  pop.style.left = `${left}px`;
  pop.style.top  = `${b.bottom + 8}px`;
}

el('tabAddGroup')?.addEventListener('click', () => {
  if (el('tabAddPop').classList.contains('hidden')) openTabAddPop();
  else closeTabAddPop();
});
el('tabAddCancel')?.addEventListener('click', () => closeTabAddPop({ restoreFocus: true }));

// Picking a colour hands focus back to the name, so Enter still creates the
// group rather than pressing the swatch that was just clicked again.
el('tabAddColor')?.addEventListener('palettechange', () => el('tabAddName').focus());

// Not a modal, so neither the global Escape handler nor a backdrop closes it.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTabAddPop({ restoreFocus: true });
});
document.addEventListener('mousedown', e => {
  if (e.target.closest('#tabAddPop, #tabAddGroup')) return;
  closeTabAddPop();
});
window.addEventListener('resize', placeTabAddPop);
window.addEventListener('scroll', placeTabAddPop, { passive: true });

el('tabAddForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const name  = el('tabAddName').value.trim();
  if (!name) return;
  const color = el('tabAddColor').querySelector('.color-palette')?.dataset.value;
  const btn   = el('tabAddSubmit');
  btn.disabled = true;
  try {
    const res = await myRequest(`${myBase()}/groups`, { json: { name, color } });
    if (!res.ok) {
      el('tabAddError').textContent = res.body.error || 'Could not create that group.';
      el('tabAddError').classList.remove('hidden');
      return;
    }
    closeTabAddPop();
    // Open the new group's tab, where its first links will go.
    activeGroup = `u${res.body.id}`;
    saveStoredGroup(activeGroup);
    await loadData({ transition: true });
    showToast(`Group "${name}" created`);
  } finally {
    btn.disabled = false;
  }
});
