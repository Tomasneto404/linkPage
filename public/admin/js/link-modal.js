// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: adding, editing and deleting a link. */

// ─── 11. LINK MODAL ───────────────────────────────────────────────────────────

let shouldRemoveIcon = false;
let pendingIconId    = null;    // id of an icon picked from the library, if any

// When the link modal was opened to approve a pending request, this holds that
// request's id so a successful save can mark it approved. null in every other
// use of the modal (plain add/edit).
let pendingApprovalRequestId = null;

// Tracks Link/File mode state for the link modal.
let linkModalMode      = 'link';        // 'link' or 'file'
let pendingAttachedFile = null;          // File object picked but not yet uploaded
let existingAttachedName = null;         // filename of an existing attachment when editing
let shouldRemoveAttachedFile = false;    // true when user explicitly clears an existing file

function setLinkModalMode(mode) {
  linkModalMode = mode === 'file' ? 'file' : 'link';
  document.querySelectorAll('.link-mode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === linkModalMode));
  document.querySelectorAll('.link-mode-pane').forEach(p =>
    p.classList.toggle('hidden', p.dataset.mode !== linkModalMode));

  // The URL input toggles required-ness based on mode so the browser's native
  // validation matches what the server expects.
  document.getElementById('inputUrl').required = (linkModalMode === 'link');
}

/**
 * Mirrors src/utils/slug.js so the admin sees the slug they will actually get
 * while typing. The server normalises again on save — this is preview only.
 */
function slugify(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

/** Words the server refuses, mirrored so the warning appears as you type. */
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'uploads', 'r', 'f', 'health', 'login', 'logout', 'static',
]);

/**
 * Validates the slug box against the links already loaded and updates the hint,
 * the warning line and the Copy button. Purely advisory: the server is the one
 * that decides, this just avoids a pointless round trip.
 */
function refreshSlugUi() {
  const input     = document.getElementById('inputSlug');
  const hint      = document.getElementById('slugHint');
  const warn      = document.getElementById('slugWarning');
  const copyBtn   = document.getElementById('copySlugUrlBtn');
  const editingId = parseInt(document.getElementById('editingLinkId').value) || null;

  const typed = input.value.trim();
  const slug  = slugify(typed);

  let problem = null;
  if (typed && !slug)                      problem = 'Needs at least one letter or number.';
  else if (slug && RESERVED_SLUGS.has(slug)) problem = `"${slug}" is reserved — pick another one.`;
  else if (slug) {
    const clash = links.find(l => l.slug === slug && l.id !== editingId);
    if (clash) problem = `Already used by "${clash.name}".`;
  }

  if (problem) {
    warn.textContent = problem;
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }

  // Only promise an address the server would actually accept.
  hint.textContent = (slug && !problem)
    ? `Will be saved as ${location.origin}/f/${slug}`
    : 'Letters, numbers and hyphens. The original address keeps working either way.';

  copyBtn.disabled = !slug || !!problem;
}

document.getElementById('inputSlug').addEventListener('input', refreshSlugUi);

document.getElementById('copySlugUrlBtn').addEventListener('click', async () => {
  const slug = slugify(document.getElementById('inputSlug').value);
  if (!slug) return;
  try {
    await navigator.clipboard.writeText(`${location.origin}/f/${slug}`);
    showToast('Custom URL copied');
  } catch {
    showToast('Could not copy the URL', 'error');
  }
});

/**
 * The auto-open checkbox belongs to markdown and nothing else, since nothing
 * else renders as a page. Kept in step with whatever file is currently
 * attached — picked but not yet uploaded, or already saved — and unticked
 * when the row goes away, so a link cannot keep the flag after losing the
 * markdown that earned it.
 */
function refreshAutoOpenRow() {
  const row = document.getElementById('autoOpenRow');
  const box = document.getElementById('inputAutoOpen');

  const name = pendingAttachedFile ? pendingAttachedFile.name
             : (!shouldRemoveAttachedFile && existingAttachedName) ? existingAttachedName
             : '';
  const isMarkdown = /\.md$/i.test(name);

  row.classList.toggle('hidden', !isMarkdown);
  if (!isMarkdown) box.checked = false;
}

function refreshAttachedFileUi() {
  refreshAutoOpenRow();
  const trigger = document.getElementById('attachFileBtn');
  const label   = document.getElementById('attachedFileLabel');
  const clear   = document.getElementById('clearAttachedFileBtn');

  let displayName = null;
  if (pendingAttachedFile)               displayName = pendingAttachedFile.name;
  else if (existingAttachedName && !shouldRemoveAttachedFile)
                                          displayName = existingAttachedName;

  if (displayName) {
    label.textContent = displayName;
    trigger.classList.add('has-file');
    clear.classList.remove('hidden');
  } else {
    label.textContent = 'Choose a file…';
    trigger.classList.remove('has-file');
    clear.classList.add('hidden');
  }
}

document.querySelectorAll('.link-mode-tab').forEach(tab =>
  tab.addEventListener('click', () => setLinkModalMode(tab.dataset.mode)));

document.getElementById('attachFileBtn').addEventListener('click', () =>
  document.getElementById('inputAttachedFile').click());

document.getElementById('inputAttachedFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAttachedFile        = file;
  shouldRemoveAttachedFile   = false;
  refreshAttachedFileUi();
});

document.getElementById('clearAttachedFileBtn').addEventListener('click', () => {
  pendingAttachedFile      = null;
  shouldRemoveAttachedFile = !!existingAttachedName;
  document.getElementById('inputAttachedFile').value = '';
  refreshAttachedFileUi();
});

/**
 * Populates the multi-select group dropdown.
 * `selectedAssignments` is an array of either { id, section_id } objects or
 * raw numeric IDs. Each group entry has a checkbox; when ticked AND the group
 * has sections, a small section dropdown appears beneath it.
 */
function populateGroupDropdown(selectedAssignments = []) {
  const sectionByGroup = new Map();
  const selected       = new Set();
  for (const raw of selectedAssignments) {
    if (typeof raw === 'number') { selected.add(raw); continue; }
    if (raw && typeof raw === 'object') {
      const gid = Number(raw.id ?? raw.group_id);
      if (!gid) continue;
      selected.add(gid);
      const sid = raw.section_id ?? null;
      if (sid !== null) sectionByGroup.set(gid, Number(sid));
    }
  }

  const menu = document.getElementById('inputGroupOptions');

  if (!groups.length) {
    menu.innerHTML = '<div class="multi-select-empty">No groups yet — create one from the sidebar</div>';
    updateMultiSelectLabel();
    return;
  }

  menu.innerHTML = groups.map(g => {
    const isChecked = selected.has(g.id);
    const sections  = g.sections || [];
    const pickedSid = sectionByGroup.get(g.id) ?? null;

    // Flatten the two-level hierarchy into <option>s. Subsections are
    // indented with a non-breaking arrow so the parent → child relationship
    // reads clearly in the native <select> dropdown.
    const sectionOptions = sections.flatMap(s => {
      const opt = `
        <option value="${s.id}" ${pickedSid === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`;
      const subs = (s.subsections || []).map(sub => `
        <option value="${sub.id}" ${pickedSid === sub.id ? 'selected' : ''}>
              ↳ ${escapeHtml(sub.name)}
        </option>`);
      return [opt, ...subs];
    }).join('');

    const sectionPicker = sections.length === 0 ? '' : `
      <div class="multi-select-section${isChecked ? '' : ' hidden'}" data-group-id="${g.id}">
        <span class="multi-select-section-arrow">↳</span>
        <select class="multi-select-section-select" data-group-id="${g.id}">
          <option value="">No section</option>
          ${sectionOptions}
        </select>
      </div>`;

    return `
      <div class="multi-select-row" data-group-id="${g.id}">
        <label class="multi-select-option">
          <input type="checkbox" value="${g.id}" ${isChecked ? 'checked' : ''}>
          <span class="group-dot" style="background:${escapeHtml(g.color)}"></span>
          <span>${escapeHtml(g.name)}</span>
        </label>
        ${sectionPicker}
      </div>`;
  }).join('');

  // Checkbox toggle: update label and reveal/hide section sub-row.
  menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const row   = cb.closest('.multi-select-row');
      const subRow = row && row.querySelector('.multi-select-section');
      if (subRow) subRow.classList.toggle('hidden', !cb.checked);
      // Reset section to "None" when un-ticking — picking the group again starts fresh.
      if (!cb.checked && subRow) {
        const sel = subRow.querySelector('.multi-select-section-select');
        if (sel) sel.value = '';
      }
      updateMultiSelectLabel();
    });
  });

  updateMultiSelectLabel();
}

/**
 * Returns the current group assignments as an array of { id, section_id }
 * objects, suitable for sending to POST/PUT /api/links via the `groups` field.
 */
function getSelectedAssignments() {
  const out = [];
  document.querySelectorAll('#inputGroupOptions .multi-select-row').forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb || !cb.checked) return;
    const gid = Number(cb.value);
    const sel = row.querySelector('.multi-select-section-select');
    const sidRaw = sel ? sel.value : '';
    const section_id = sidRaw ? Number(sidRaw) : null;
    out.push({ id: gid, section_id });
  });
  return out;
}

/** Back-compat thin wrapper used by older code paths that only need IDs. */
function getSelectedGroupIds() {
  return getSelectedAssignments().map(a => a.id);
}

function updateMultiSelectLabel() {
  const assignments = getSelectedAssignments();
  const label       = document.getElementById('inputGroupLabel');
  if (assignments.length === 0) {
    label.textContent = 'None';
    label.classList.add('placeholder');
    return;
  }
  if (assignments.length === 1) {
    const a = assignments[0];
    const g = groups.find(x => x.id === a.id);
    const groupName = g ? g.name : '1 group';
    // Include the section name so the user sees their section pre-selection
    // without having to expand the dropdown.
    if (a.section_id && g) {
      const sec = (g.sections || []).find(s => s.id === a.section_id);
      if (sec) {
        label.textContent = `${groupName} · ${sec.name}`;
        label.classList.remove('placeholder');
        return;
      }
    }
    label.textContent = groupName;
    label.classList.remove('placeholder');
    return;
  }
  label.textContent = `${assignments.length} groups`;
  label.classList.remove('placeholder');
}

function closeGroupMulti() {
  document.getElementById('inputGroupMulti').classList.remove('open');
  document.getElementById('inputGroupOptions').classList.add('hidden');
  document.getElementById('inputGroupToggle').setAttribute('aria-expanded', 'false');
}

document.getElementById('inputGroupToggle').addEventListener('click', () => {
  const wrap   = document.getElementById('inputGroupMulti');
  const menu   = document.getElementById('inputGroupOptions');
  const isOpen = wrap.classList.toggle('open');
  menu.classList.toggle('hidden', !isOpen);
  document.getElementById('inputGroupToggle').setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', e => {
  const wrap = document.getElementById('inputGroupMulti');
  if (!wrap.classList.contains('open')) return;
  if (!wrap.contains(e.target)) closeGroupMulti();
});

function resetLinkModalAttachmentState() {
  pendingAttachedFile        = null;
  existingAttachedName       = null;
  shouldRemoveAttachedFile   = false;
  document.getElementById('inputAttachedFile').value = '';
  refreshAttachedFileUi();
}

function openAddLinkModal() {
  shouldRemoveIcon = false;
  pendingIconId    = null;
  pendingApprovalRequestId = null;
  document.getElementById('linkModalTitle').textContent = 'Add Link';
  document.getElementById('editingLinkId').value = '';
  document.getElementById('linkForm').reset();
  document.getElementById('faviconImg').className = '';
  document.getElementById('faviconImg').src = '';
  document.getElementById('urlDuplicateWarning').classList.add('hidden');
  clearCustomIconPreview(); hideFormError('linkFormError');
  closeGroupMulti();
  document.getElementById('inputAutoOpen').checked = false;
  resetLinkModalAttachmentState();
  setLinkModalMode('link');
  refreshSlugUi();
  // Preselect the currently-active group/section so the new link lands there.
  const preselect = (typeof activeGroup === 'number')
    ? [{ id: activeGroup, section_id: activeSection ?? null }]
    : [];
  populateGroupDropdown(preselect);
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function openEditLinkModal(link) {
  shouldRemoveIcon = false;
  pendingIconId    = null;
  pendingApprovalRequestId = null;
  // Edit doesn't call linkForm.reset() (we need to populate fields from the
  // link). Clear the icon file input by hand so a file picked while editing
  // a previous link doesn't bleed into this one's submit.
  document.getElementById('inputImage').value = '';
  document.getElementById('linkModalTitle').textContent = 'Edit Link';
  document.getElementById('editingLinkId').value  = link.id;
  document.getElementById('inputName').value      = link.name;
  document.getElementById('inputDesc').value      = link.description || '';
  document.getElementById('inputSlug').value      = link.slug || '';
  document.getElementById('urlDuplicateWarning').classList.add('hidden');
  refreshSlugUi();
  closeGroupMulti();
  // Hydrate the multi-select with each group plus its section assignment.
  const currentAssignments = Array.isArray(link.groups) && link.groups.length
    ? link.groups.map(g => ({ id: g.id, section_id: g.section_id ?? null }))
    : (link.group_id ? [{ id: link.group_id, section_id: null }] : []);
  populateGroupDropdown(currentAssignments);

  resetLinkModalAttachmentState();
  if (link.file_path) {
    // File-backed link: open in File mode and remember the current filename
    // so the user can replace or remove it.
    existingAttachedName = link.file_name || 'Current file';
    document.getElementById('inputUrl').value = '';
    setLinkModalMode('file');
    refreshAttachedFileUi();
  } else {
    document.getElementById('inputUrl').value = link.url;
    setLinkModalMode('link');
  }

  // After the attachment state, not before: refreshAutoOpenRow() unticks the
  // box whenever the row does not apply, and until the filename above is in
  // place it does not yet know this is a markdown link.
  document.getElementById('inputAutoOpen').checked = !!link.auto_open;

  const fi = document.getElementById('faviconImg');
  const fu = link.file_path ? null : getFaviconUrl(link.url);
  fi.src = fu || ''; fi.className = fu ? 'visible' : '';
  link.image_path ? showCustomIconPreview(link.image_path) : clearCustomIconPreview();
  hideFormError('linkFormError');
  document.getElementById('linkModalOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputName').focus(), 50);
}

function closeLinkModal() { document.getElementById('linkModalOverlay').classList.add('hidden'); }

function showCustomIconPreview(src, { fromLibrary = false } = {}) {
  document.getElementById('iconPreviewImg').src = src;
  document.getElementById('iconPreviewWrap').classList.remove('hidden');
  document.getElementById('iconSourceBadge').classList.toggle('hidden', !fromLibrary);
}
function clearCustomIconPreview() {
  document.getElementById('iconPreviewWrap').classList.add('hidden');
  document.getElementById('iconPreviewImg').src = '';
  document.getElementById('iconSourceBadge').classList.add('hidden');
}

let faviconTimer;
let faviconPreviewAbort;       // AbortController for any in-flight preview fetch
let faviconPreviewBlobUrl;     // last blob URL we created, so we can revoke it
document.getElementById('inputUrl').addEventListener('input', e => {
  const url       = e.target.value.trim();
  const editingId = parseInt(document.getElementById('editingLinkId').value) || null;
  const fi        = document.getElementById('faviconImg');

  // Duplicate URL warning
  const dup = links.find(l => l.url === url && l.id !== editingId);
  const wEl = document.getElementById('urlDuplicateWarning');
  if (dup && url) { wEl.textContent = `URL already exists: "${dup.name}"`; wEl.classList.remove('hidden'); }
  else              wEl.classList.add('hidden');

  // Cancel anything still running from the previous keystroke.
  clearTimeout(faviconTimer);
  if (faviconPreviewAbort) faviconPreviewAbort.abort();
  if (faviconPreviewBlobUrl) { URL.revokeObjectURL(faviconPreviewBlobUrl); faviconPreviewBlobUrl = null; }
  fi.src = ''; fi.className = '';

  let validUrl = null;
  try {
    const p = new URL(url);
    if ((p.protocol === 'http:' || p.protocol === 'https:') && p.hostname.length >= 1) {
      validUrl = p.href;
    }
  } catch {}
  if (!validUrl) return;

  faviconTimer = setTimeout(async () => {
    faviconPreviewAbort = new AbortController();
    let serverGotIt = false;
    try {
      const res = await sendAuthRequest(
        `/api/favicon-preview?url=${encodeURIComponent(validUrl)}`,
        { signal: faviconPreviewAbort.signal }
      );
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 0) {
          faviconPreviewBlobUrl = URL.createObjectURL(blob);
          fi.src     = faviconPreviewBlobUrl;
          fi.onload  = () => fi.className = 'visible';
          fi.onerror = () => fi.className = '';
          serverGotIt = true;
        }
      }
    } catch { /* aborted by next keystroke, or network error */ }

    // Browser-side display fallback: if the server couldn't fetch the icon
    // (e.g. intranet host the server can't reach), let the admin's own browser
    // try a couple of direct URLs. Display-only — no bytes are read here.
    if (!serverGotIt) showPreviewWithBrowserFallback(validUrl, fi);
  }, 600);
});

function showPreviewWithBrowserFallback(siteUrl, fi) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { fi.className = ''; return; }
  const candidates = [
    `${parsed.origin}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`,
  ];
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { fi.className = ''; return; }
    fi.src     = candidates[i++];
    fi.onload  = () => fi.className = 'visible';
    fi.onerror = tryNext;
  };
  tryNext();
}

document.getElementById('iconUploadArea').addEventListener('click', () => document.getElementById('inputImage').click());
document.getElementById('inputImage').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader(); r.onload = ev => showCustomIconPreview(ev.target.result); r.readAsDataURL(f);
  shouldRemoveIcon = false;
  pendingIconId    = null;
});
document.getElementById('removeCustomIconBtn').addEventListener('click', () => {
  shouldRemoveIcon = true;
  pendingIconId    = null;
  clearCustomIconPreview();
  document.getElementById('inputImage').value = '';
});
document.getElementById('openIconLibraryBtn').addEventListener('click', () => openIconLibrary({ pickerMode: true }));

document.getElementById('linkForm').addEventListener('submit', async e => {
  e.preventDefault(); hideFormError('linkFormError');

  const linkId  = document.getElementById('editingLinkId').value;
  const fd      = new FormData();
  fd.append('name',         document.getElementById('inputName').value.trim());
  fd.append('description',  document.getElementById('inputDesc').value.trim());
  fd.append('groups',       JSON.stringify(getSelectedAssignments()));
  fd.append('remove_image', shouldRemoveIcon ? 'true' : 'false');
  // Always sent: an empty value is how the admin drops a slug and goes back to
  // the generated address.
  fd.append('slug',         document.getElementById('inputSlug').value.trim());
  // Only meaningful for markdown, and the row is hidden otherwise — but send
  // it either way so switching a link away from markdown clears the flag.
  fd.append('auto_open',    document.getElementById('inputAutoOpen').checked ? 'true' : 'false');

  if (linkModalMode === 'file') {
    // File mode: no URL is sent. If user picked a new file, attach it.
    // If editing a link that had no file before, the server requires a file.
    fd.append('url', '');
    if (pendingAttachedFile) fd.append('file', pendingAttachedFile);
    if (shouldRemoveAttachedFile) fd.append('remove_file', 'true');
  } else {
    // URL mode: send the URL. If editing a link that *had* a file, drop it.
    fd.append('url', document.getElementById('inputUrl').value.trim());
    if (existingAttachedName) fd.append('remove_file', 'true');
  }

  const imgFile = document.getElementById('inputImage').files[0];
  if (imgFile) {
    fd.append('image', imgFile);
  } else if (pendingIconId) {
    fd.append('icon_id', String(pendingIconId));
  }

  const btn = document.getElementById('saveLinkBtn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const sentOwnIcon = !!(imgFile || pendingIconId);

  try {
    const result = linkId ? await updateLink(linkId, fd) : await createLink(fd);
    if (result?.error) { showFormError('linkFormError', result.error); return; }

    // If this save published a pending request, mark that request approved and
    // point it at the freshly-created link.
    if (pendingApprovalRequestId && !linkId && result?.id) {
      try { await approveRequestApi(pendingApprovalRequestId, result.id); } catch {}
      pendingApprovalRequestId = null;
      refreshRequestsBadge();
    }

    closeLinkModal();
    showToast(linkId ? 'Link saved' : 'Link added');
    await loadAllData();

    // Browser-side favicon fallback: if the server couldn't reach the host
    // (intranet from cloud, blocked egress, etc.) and the admin didn't pick
    // an icon themselves, try fetching from the admin's browser and upload
    // the bytes as a library icon. Fire-and-forget — SSE will re-render the
    // card when the icon is attached.
    const needsFallback = result?.url
                       && !result.file_path
                       && !result.image_path
                       && !result.favicon_path
                       && !sentOwnIcon;
    if (needsFallback) {
      ensureFaviconViaBrowser(result).catch(() => {});
    }
  } catch {
    showFormError('linkFormError', 'Something went wrong. Please try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Link';
  }
});

// ─── Browser-side favicon fallback ────────────────────────────────────────────
//
// When the server can't reach the target host (e.g. intranet from cloud), the
// admin's own browser tries to grab the favicon bytes and uploads them to the
// icon library, then reassigns the saved link to that library icon. CORS
// limits how often this succeeds in practice, but for permissive intranet
// servers and a handful of public ones (GitHub, etc.) it works without fuss.

async function ensureFaviconViaBrowser(link) {
  const blob = await fetchFaviconBlobInBrowser(link.url);
  if (!blob) return;

  // 1) Upload to the icon library.
  const fd = new FormData();
  const ext = (blob.type.split('/')[1] || 'png').replace('svg+xml', 'svg');
  fd.append('image', new File([blob], `favicon-${link.id}.${ext}`, { type: blob.type }));
  const icon = await apiJson('/api/icons', { method: 'POST', body: fd }).catch(() => null);
  if (!icon?.id) return;

  // 2) Reassign the link to point at the new library icon.
  const linkFd = new FormData();
  linkFd.append('name',        link.name);
  linkFd.append('description', link.description || '');
  linkFd.append('url',         link.url);
  linkFd.append('groups',      JSON.stringify(
    (link.groups || []).map(g => ({ id: g.id, section_id: g.section_id ?? null }))
  ));
  linkFd.append('icon_id', String(icon.id));
  await sendAuthRequest(`/api/links/${link.id}`, { method: 'PUT', body: linkFd });
  showToast('Icon fetched from your browser');
}

/**
 * Best-effort browser-side favicon fetch. Returns a Blob of image bytes or null.
 * Tries several strategies (page HTML parse, /favicon.ico, Google), each with
 * either a direct CORS fetch or a canvas-via-Image hack. Every step is wrapped
 * in try/catch — most cross-origin sites will trip CORS, which is fine.
 */
async function fetchFaviconBlobInBrowser(siteUrl) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const candidates = new Set();

  // 1) Parse the page for declared <link rel="icon">.
  try {
    const pageRes = await fetch(siteUrl, { mode: 'cors', credentials: 'omit' });
    if (pageRes.ok) {
      const ct = (pageRes.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('html')) {
        const head = (await pageRes.text()).slice(0, 64 * 1024);
        const re = /<link\b[^>]*>/gi;
        let m;
        while ((m = re.exec(head)) !== null) {
          const tag  = m[0];
          if (!/\brel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
          const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
          if (!href) continue;
          try { candidates.add(new URL(href, siteUrl).href); } catch {}
        }
      }
    }
  } catch { /* CORS-blocked, that's fine */ }

  // 2) Conventional /favicon.ico.
  candidates.add(`${parsed.origin}/favicon.ico`);

  // 3) Google as a last resort (works for public sites where the server-side
  //    fetch failed for some other reason).
  candidates.add(`https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`);

  for (const url of candidates) {
    // Direct fetch — fastest, works when the target sends Access-Control-Allow-Origin.
    try {
      const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (r.ok) {
        const blob = await r.blob();
        if (blob.size > 0 && /^image\//.test(blob.type)) return blob;
      }
    } catch { /* CORS */ }

    // <img> + canvas — also CORS-bound (the canvas taints without permissive headers),
    // but covers servers that allow CORS for binary but not for plain fetch.
    try {
      const blob = await imgUrlToCanvasBlob(url);
      if (blob && blob.size > 0) return blob;
    } catch { /* tainted canvas */ }
  }
  return null;
}

function imgUrlToCanvasBlob(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let done = false;
    const finish = (err, val) => {
      if (done) return; done = true;
      img.onload = null; img.onerror = null;
      err ? reject(err) : resolve(val);
    };
    img.onload = () => {
      try {
        const w = img.naturalWidth  || 64;
        const h = img.naturalHeight || 64;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? finish(null, b) : finish(new Error('null blob')), 'image/png');
      } catch (e) { finish(e); }
    };
    img.onerror = () => finish(new Error('img load failed'));
    img.src = url;
    setTimeout(() => finish(new Error('timeout')), 6000);
  });
}

document.getElementById('openAddLinkBtn').addEventListener('click', openAddLinkModal);
document.getElementById('closeLinkModalBtn').addEventListener('click', closeLinkModal);
document.getElementById('cancelLinkModalBtn').addEventListener('click', closeLinkModal);


// ─── 12. DELETE LINK ──────────────────────────────────────────────────────────

let pendingDeleteLinkId = null;

function openDeleteLinkModal(link) {
  pendingDeleteLinkId = link.id;
  document.getElementById('deleteLinkNameLabel').textContent = link.name;
  document.getElementById('deleteLinkOverlay').classList.remove('hidden');
}

document.getElementById('confirmDeleteLinkBtn').addEventListener('click', async () => {
  if (!pendingDeleteLinkId) return;
  await deleteLinkById(pendingDeleteLinkId);
  pendingDeleteLinkId = null;
  document.getElementById('deleteLinkOverlay').classList.add('hidden');
  showToast('Link deleted');
  await loadAllData();
});
document.getElementById('cancelDeleteLinkBtn').addEventListener('click', () =>
  document.getElementById('deleteLinkOverlay').classList.add('hidden'));

