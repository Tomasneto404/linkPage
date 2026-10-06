// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: adding, editing and deleting a group. */

// ─── 13. GROUP MODAL ──────────────────────────────────────────────────────────

function buildColorPalette(selected) {
  const palette  = document.getElementById('colorPalette');
  const isCustom = !GROUP_COLORS.includes(selected);

  // Preset swatches + one "custom" swatch that opens the native colour picker.
  // The custom swatch's background previews the currently-chosen custom colour.
  const presets = GROUP_COLORS.map(c => `
    <div class="color-swatch${c === selected ? ' selected' : ''}"
         data-color="${c}" style="background:${c}" title="${c}"></div>`).join('');
  const customSwatchColor = isCustom ? selected : '#888888';
  palette.innerHTML = `${presets}
    <label class="color-swatch color-swatch-custom${isCustom ? ' selected' : ''}"
           title="Custom colour"
           style="background:${escapeHtml(customSwatchColor)}">
      <span class="color-swatch-plus">+</span>
      <input type="color" id="groupColorPicker"
             value="${escapeHtml(isCustom ? selected : GROUP_COLORS[0])}" />
    </label>`;

  function markSelected(el, color) {
    palette.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('groupColorInput').value = color;
  }

  palette.querySelectorAll('.color-swatch[data-color]').forEach(s =>
    s.addEventListener('click', () => markSelected(s, s.dataset.color)));

  const customSwatch = palette.querySelector('.color-swatch-custom');
  const colorInput   = palette.querySelector('#groupColorPicker');
  colorInput.addEventListener('input', e => {
    const c = e.target.value;
    customSwatch.style.background = c;
    markSelected(customSwatch, c);
  });
}

/**
 * `clearPasswordOnSave` — when true, the next form submit will send password=null
 * to strip the password from the group being edited. Reset between modal opens.
 */
let clearPasswordOnSave = false;

function updateGroupPasswordStatus(isProtected) {
  const status = document.getElementById('groupPasswordStatus');
  const clear  = document.getElementById('clearGroupPasswordBtn');
  if (isProtected && !clearPasswordOnSave) {
    status.textContent = 'This group is currently password-protected.';
    status.classList.remove('hidden'); status.classList.add('protected');
    clear.classList.remove('hidden');
  } else if (clearPasswordOnSave) {
    status.textContent = 'Password will be removed when you save.';
    status.classList.remove('hidden', 'protected');
    clear.classList.add('hidden');
  } else {
    status.classList.add('hidden');
    clear.classList.add('hidden');
  }
}

function setUnlockModeRadio(mode) {
  const value = mode === 'session' ? 'session' : 'timeout';
  document.querySelectorAll('input[name="groupUnlockMode"]').forEach(r => {
    r.checked = (r.value === value);
  });
}

/**
 * Shows the unlock-behavior radio group only when the group will end up
 * password-protected after save. Re-evaluated on input + clear-button clicks.
 */
function refreshUnlockModeRowVisibility() {
  const row    = document.getElementById('groupUnlockModeRow');
  const editId = document.getElementById('editingGroupId').value;
  const pwTyped = document.getElementById('groupPasswordInput').value.length > 0;
  const existing = editId
    ? (groups.find(g => g.id === Number(editId))?.is_protected ?? false)
    : false;
  // Protected after save if a new password was typed, OR an existing one is
  // kept (no clear), OR the existing one was overwritten with a new one.
  const willBeProtected = pwTyped || (existing && !clearPasswordOnSave);
  row.classList.toggle('hidden', !willBeProtected);
}

function openAddGroupModal() {
  clearPasswordOnSave = false;
  document.getElementById('groupModalTitle').textContent = 'New Group';
  document.getElementById('editingGroupId').value        = '';
  document.getElementById('groupNameInput').value        = '';
  document.getElementById('groupPasswordInput').value    = '';
  document.getElementById('groupColorInput').value       = GROUP_COLORS[0];
  buildColorPalette(GROUP_COLORS[0]); hideFormError('groupFormError');
  updateGroupPasswordStatus(false);
  setUnlockModeRadio('timeout');
  refreshUnlockModeRowVisibility();
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function openEditGroupModal(gid) {
  const g = groups.find(x => x.id === gid); if (!g) return;
  clearPasswordOnSave = false;
  document.getElementById('groupModalTitle').textContent = 'Edit Group';
  document.getElementById('editingGroupId').value        = g.id;
  document.getElementById('groupNameInput').value        = g.name;
  document.getElementById('groupPasswordInput').value    = '';
  document.getElementById('groupColorInput').value       = g.color;
  buildColorPalette(g.color); hideFormError('groupFormError');
  updateGroupPasswordStatus(!!g.is_protected);
  setUnlockModeRadio(g.unlock_mode || 'timeout');
  refreshUnlockModeRowVisibility();
  document.getElementById('groupModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('groupNameInput').focus(), 50);
}

function closeGroupModal() { document.getElementById('groupModalOverlay').classList.add('hidden'); }

document.getElementById('clearGroupPasswordBtn').addEventListener('click', () => {
  clearPasswordOnSave = true;
  document.getElementById('groupPasswordInput').value = '';
  updateGroupPasswordStatus(true);
  refreshUnlockModeRowVisibility();
});

document.getElementById('groupPasswordInput').addEventListener('input', refreshUnlockModeRowVisibility);

document.getElementById('groupForm').addEventListener('submit', async e => {
  e.preventDefault(); hideFormError('groupFormError');
  const gid      = document.getElementById('editingGroupId').value;
  const name     = document.getElementById('groupNameInput').value.trim();
  const color    = document.getElementById('groupColorInput').value;
  const pwInput  = document.getElementById('groupPasswordInput').value;
  if (!name) return;

  // Decide what to send for `password`:
  //   - clearPasswordOnSave → null (remove protection)
  //   - non-empty input     → set this new password
  //   - empty input on edit → omit the field (keep current state)
  const payload = { name, color };
  if (clearPasswordOnSave)         payload.password = null;
  else if (pwInput.length > 0)     payload.password = pwInput;

  // Send unlock_mode only when the group is/will be protected, so we don't
  // overwrite stored state for a group that has no password.
  const willBeProtected = !!payload.password ||
    (gid && !clearPasswordOnSave &&
     (groups.find(g => g.id === Number(gid))?.is_protected ?? false));
  if (willBeProtected) {
    const chosen = document.querySelector('input[name="groupUnlockMode"]:checked');
    payload.unlock_mode = chosen ? chosen.value : 'timeout';
  }

  try {
    const result = gid
      ? await updateGroup(gid, payload)
      : await createGroup(payload);
    if (result?.error) { showFormError('groupFormError', result.error); return; }
    closeGroupModal();
    showToast(gid ? 'Group saved' : 'Group created');
    await loadAllData();
  } catch { showFormError('groupFormError', 'Something went wrong. Please try again.'); }
});

document.getElementById('openAddGroupBtn').addEventListener('click', openAddGroupModal);
document.getElementById('closeGroupModalBtn').addEventListener('click', closeGroupModal);
document.getElementById('cancelGroupModalBtn').addEventListener('click', closeGroupModal);


// ─── 14. DELETE GROUP ─────────────────────────────────────────────────────────

let pendingDeleteGroupId = null;

function openDeleteGroupModal(gid) {
  pendingDeleteGroupId = gid;
  const g = groups.find(x => x.id === gid);
  document.getElementById('deleteGroupNameLabel').textContent = g?.name ?? '';
  document.getElementById('deleteGroupOverlay').classList.remove('hidden');
}

document.getElementById('confirmDeleteGroupBtn').addEventListener('click', async () => {
  if (!pendingDeleteGroupId) return;
  await deleteGroupById(pendingDeleteGroupId);
  if (activeGroup === pendingDeleteGroupId) activeGroup = 'all';
  pendingDeleteGroupId = null;
  document.getElementById('deleteGroupOverlay').classList.add('hidden');
  showToast('Group deleted');
  await loadAllData();
});
document.getElementById('cancelDeleteGroupBtn').addEventListener('click', () =>
  document.getElementById('deleteGroupOverlay').classList.add('hidden'));

