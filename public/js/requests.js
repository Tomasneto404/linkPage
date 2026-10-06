// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: requesting a link, a file or a change, and its icon pickers. */

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

function applyFooter(settings) {
  const footer = document.getElementById('devFooter');
  if (footer) footer.classList.toggle('hidden', !settings.footer_enabled);
}

function presetSvgString(body, color, size = 64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Populates the group <select>, then triggers a section repopulate. */
function populateRequestGroups() {
  const sel = document.getElementById('reqGroup');
  // Only shared groups. A member's own group is not somewhere a request can
  // go, and its name would end up in front of whoever reviews the request.
  const opts = groups.filter(g => !isPersonal(g)).map(g =>
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

// ─── Request kinds: link / file / change ─────────────────────────────────────
//
// One modal serves all three. `reqMode` decides which fields are on show, what
// the submit sends, and which of them are required.

let reqMode     = 'link';   // 'link' | 'file' | 'change'
let reqFile     = null;     // the document a file request attaches

const REQ_MODE_COPY = {
  link:   'Suggest a link for the admin to review. They’ll publish it if approved.',
  file:   'Send a file for the admin to publish. They’ll review it before it appears.',
  change: 'Spotted something out of date? Propose a correction to an existing link.',
};

const REQ_MODE_TITLE = {
  link:   'Request a link',
  file:   'Send a file',
  change: 'Propose a change',
};

const REQ_MODE_SUBMIT = {
  link:   'Submit request',
  file:   'Send file',
  change: 'Propose change',
};

function setRequestMode(mode) {
  reqMode = ['link', 'file', 'change'].includes(mode) ? mode : 'link';

  document.querySelectorAll('.req-mode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.reqMode === reqMode));

  const show = (id, on) => document.getElementById(id)?.classList.toggle('hidden', !on);
  show('reqTargetGroup', reqMode === 'change');
  // In change mode the picker waits for a file-backed link to be chosen; until
  // then there is nothing a file could replace (see prefillFromTarget).
  show('reqFileGroup',   reqMode === 'file');
  show('reqUrlGroup',    reqMode !== 'file');
  show('reqNoteGroup',   reqMode === 'change');
  // A change targets a link that already lives somewhere, and its icon is the
  // admin's call — neither field means anything here.
  show('reqGroupRow',    reqMode !== 'change');
  show('reqIconGroup',   reqMode !== 'change');

  // Keep native validation in step with what the server will actually demand.
  // A required field that is hidden can never be focused, and the browser then
  // refuses to submit the form at all — so every one of these has to be dropped
  // the moment its field leaves the screen.
  document.getElementById('reqUrl').required    = (reqMode === 'link');
  document.getElementById('reqName').required   = (reqMode !== 'change');
  document.getElementById('reqGroup').required  = (reqMode !== 'change');
  document.getElementById('reqTarget').required = (reqMode === 'change');

  // The current-file line belongs to change mode only.
  document.getElementById('reqFileCurrent').classList.toggle('hidden', reqMode !== 'change');
  document.getElementById('reqFileHint').classList.toggle('hidden', reqMode === 'change');

  document.getElementById('reqIntro').textContent      = REQ_MODE_COPY[reqMode];
  document.getElementById('reqSubmitBtn').textContent  = REQ_MODE_SUBMIT[reqMode];
  document.getElementById('reqModalTitle').textContent = REQ_MODE_TITLE[reqMode];

  if (reqMode === 'change') populateRequestTargets();
}

/** Fills the "link to change" picker with every link this visitor can see. */
function populateRequestTargets() {
  const sel = document.getElementById('reqTarget');
  // Only shared links, for the same reason.
  const opts = links
    .filter(l => !isPersonal(l))
    .map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`)
    .join('');
  sel.innerHTML = `<option value="" disabled selected>Choose a link…</option>${opts}`;
}

/**
 * Prefills the form with the chosen link's current values, so the visitor edits
 * what is there instead of retyping it. A file-backed link has no editable URL.
 */
function prefillFromTarget() {
  const link = links.find(l => l.id === Number(document.getElementById('reqTarget').value));
  if (!link) return;

  document.getElementById('reqName').value = link.name || '';
  document.getElementById('reqDesc').value = link.description || '';

  const urlGroup  = document.getElementById('reqUrlGroup');
  const urlInput  = document.getElementById('reqUrl');
  const fileGroup = document.getElementById('reqFileGroup');

  // A file-backed link has no URL to correct, but its document can be replaced
  // with a newer one. A URL link is the other way round.
  if (link.file_path) {
    urlInput.value = '';
    urlGroup.classList.add('hidden');
    fileGroup.classList.remove('hidden');
    document.getElementById('reqFileCurrent').textContent =
      `Currently ${link.file_name || 'a file'}. Attach a newer one to replace it.`;
  } else {
    urlInput.value = link.url || '';
    urlGroup.classList.remove('hidden');
    fileGroup.classList.add('hidden');
  }

  // A file picked for a previous target must not follow the visitor across.
  reqFile = null;
  document.getElementById('reqFileUpload').value = '';
  refreshReqFileUi();
}

function refreshReqFileUi() {
  document.getElementById('reqFileName').textContent = reqFile
    ? `${reqFile.name} (${formatBytes(reqFile.size)})` : '';
  document.getElementById('reqFileClear').hidden = !reqFile;
}

/** Bytes as a short human string, for the picked-file label. */
function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

document.querySelectorAll('.req-mode-tab').forEach(tab =>
  tab.addEventListener('click', () => setRequestMode(tab.dataset.reqMode)));

document.getElementById('reqTarget')?.addEventListener('change', prefillFromTarget);

document.getElementById('reqFileBtn')?.addEventListener('click', () =>
  document.getElementById('reqFileUpload').click());

document.getElementById('reqFileUpload')?.addEventListener('change', e => {
  reqFile = e.target.files?.[0] || null;
  refreshReqFileUi();
});

document.getElementById('reqFileClear')?.addEventListener('click', () => {
  reqFile = null;
  document.getElementById('reqFileUpload').value = '';
  refreshReqFileUi();
});

function openRequestModal(mode = 'link') {
  document.getElementById('requestForm').reset();
  reqPresetColor = REQ_PRESET_COLORS[0];
  reqFaviconUrl  = null;
  reqFile        = null;
  document.getElementById('reqFileUpload').value = '';
  refreshReqFileUi();
  resetRequestIcon();
  populateRequestGroups();
  setRequestMode(mode);
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
  const targetId  = document.getElementById('reqTarget').value;
  const note      = document.getElementById('reqNote').value.trim();

  // Per-kind checks, mirroring what the server enforces.
  if (reqMode === 'change') {
    if (!targetId) { showRequestError('Please choose the link you want changed.'); return; }
    if (!name && !reqFile) { showRequestError('Please propose a change.'); return; }
  } else {
    if (!name)     { showRequestError('Please provide a name.'); return; }
    if (!groupId)  { showRequestError('Please choose a group.'); return; }
    if (reqMode === 'link' && !url) { showRequestError('Please provide a URL.'); return; }
    if (reqMode === 'file' && !reqFile) { showRequestError('Please attach a file.'); return; }
  }
  if (requestPasswordRequired && !document.getElementById('reqPassword').value) {
    showRequestError('Please enter the request password.'); return;
  }

  const fd = new FormData();
  fd.append('kind', reqMode);
  fd.append('name', name);
  fd.append('description', desc);

  if (reqMode === 'change') {
    fd.append('target_link_id', targetId);
    // Only sent when the field is on show: a file-backed link has no URL to
    // propose, and the server would refuse one anyway.
    if (!document.getElementById('reqUrlGroup').classList.contains('hidden')) {
      fd.append('url', url);
    }
    // Only offered for a file-backed target, and optional even then.
    if (reqFile) fd.append('file', reqFile);
    if (note) fd.append('note', note);
  } else {
    fd.append('group_id', groupId);
    if (reqMode === 'link') fd.append('url', url);
    if (reqMode === 'file' && reqFile) fd.append('file', reqFile);
    if (sectionId)  fd.append('section_id', sectionId);
    if (reqIconFile) fd.append('image', reqIconFile);
  }

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
    showToast(reqMode === 'change' ? 'Change proposed'
            : reqMode === 'file'   ? 'File sent for review'
            : 'Request submitted', { type: 'success' });
  } catch {
    showRequestError('Could not reach the server.');
  } finally {
    btn.disabled = false; btn.textContent = REQ_MODE_SUBMIT[reqMode];
  }
});

// Global Escape: close the top-most open modal overlay (request, icon picker,
// group unlock — whichever is frontmost). One press closes one layer.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
  if (open.length) open[open.length - 1].classList.add('hidden');
});
