// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: link requests and IP attribution. */

// ─── 20.5. LINK REQUESTS ──────────────────────────────────────────────────────
//
// Visitor-submitted link requests. The admin reviews them here: approve opens
// the Add-Link modal prefilled from the request (Save publishes it and marks the
// request approved), or reject/delete the request outright.

let requestsStatus = 'pending';
let loadedRequests = [];

/** Shows/hides the Requests button + mobile entry based on the feature flag. */
function updateRequestsFeatureUI(enabled) {
  document.getElementById('openRequestsBtn').classList.toggle('hidden', !enabled);
  document.getElementById('mobileRequestsItem').classList.toggle('hidden', !enabled);
}

/** Refreshes the pending-count badge on the Requests button. */
async function refreshRequestsBadge() {
  try {
    const data  = await fetchLinkRequests('pending');
    const count = data.pending_count || 0;
    const label = count > 99 ? '99+' : String(count);
    // Header button on wide screens, kebab dot on phones (where that button is
    // hidden) — both stay in sync so a pending request is never invisible.
    for (const id of ['requestsBadge', 'mobileRequestsBadge']) {
      const badge = document.getElementById(id);
      if (!badge) continue;
      badge.textContent = label;
      badge.classList.toggle('hidden', count === 0);
    }
    const mob = document.getElementById('mobileRequestsCount');
    if (mob) mob.textContent = count ? `(${count})` : '';
  } catch { /* non-critical */ }
}

function formatRequestDate(raw) {
  if (!raw) return '';
  // SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; normalise to an ISO instant.
  const d = new Date(raw.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return escapeHtml(raw);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const REQUEST_FALLBACK_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

/**
 * True when the request points at a link that already exists — ignoring the
 * link this very request created, which is expected for approved requests.
 */
function requestHasExistingLink(r) {
  return !!(r.existing_link && r.existing_link.id !== r.created_link_id);
}

/** Group names the already-existing link belongs to. */
function existingLinkGroupNames(existing) {
  return (existing?.groups ?? []).map(g => g.name).filter(Boolean);
}

/** True when the existing link is already in the group this request asks for. */
function existingLinkHasRequestedGroup(r) {
  return !!r.existing_link?.groups?.some(g => g.id === r.group_id);
}

/** "Already added" chip; opens the existing link for editing when clicked. */
function requestDupeChip(r) {
  if (!requestHasExistingLink(r)) return '';
  const ex     = r.existing_link;
  const names  = existingLinkGroupNames(ex);
  const suffix = names.length ? ` · ${names.join(', ')}` : '';
  const title  = `Already added as "${ex.name}"${suffix} — click to open it`;
  return `
    <button type="button" class="request-row-dupe" data-req-existing="${ex.id}"
            title="${escapeHtml(title)}">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      Already added${escapeHtml(suffix)}
    </button>`;
}

/** Small badge naming what kind of request a row is. */
function requestKindBadge(kind) {
  if (kind === 'file')   return '<span class="request-kind request-kind-file">File</span>';
  if (kind === 'change') return '<span class="request-kind request-kind-change">Change</span>';
  return '';
}

/**
 * The body of a change request: one line per field the visitor wants different,
 * old value struck through beside the new one, plus their note.
 */
function requestChangeBody(r) {
  const rows = [
    ['Name',        r.target_name,        r.name],
    ['URL',         r.target_url,         r.url],
    ['Description', r.target_description, r.description],
  ];

  const diff = rows
    // A blank proposal means "leave this alone", so it never shows as a change.
    .filter(([, before, after]) => after && after !== (before || ''))
    .map(([label, before, after]) => `
      <div class="request-diff-row">
        <span class="request-diff-label">${label}</span>
        <span class="request-diff-before">${escapeHtml(before || '—')}</span>
        <span class="request-diff-arrow">→</span>
        <span class="request-diff-after">${escapeHtml(after)}</span>
      </div>`).join('');

  // A proposed replacement file gets its own row, with the new file linked so
  // it can be opened before the change is applied.
  const size = Number.isFinite(r.file_size) ? ` · ${formatBytes(r.file_size)}` : '';
  const fileDiff = r.file_path ? `
      <div class="request-diff-row">
        <span class="request-diff-label">File</span>
        <span class="request-diff-before">${escapeHtml(r.target_file_name || '—')}</span>
        <span class="request-diff-arrow">→</span>
        <a class="request-diff-after request-diff-file" href="${escapeHtml(r.file_path)}"
           target="_blank" rel="noopener noreferrer">${escapeHtml(r.file_name || 'new file')}${size}</a>
      </div>` : '';

  const missing = r.target_name == null
    ? '<div class="request-diff-gone">The link this targets has been deleted.</div>'
    : '';

  return `<div class="request-diff">${missing}${diff}${fileDiff}</div>` +
         (r.note ? `<div class="request-row-desc">“${escapeHtml(r.note)}”</div>` : '');
}

/** The body of a file request: what was uploaded, and how big it is. */
function requestFileBody(r) {
  const size = Number.isFinite(r.file_size) ? ` · ${formatBytes(r.file_size)}` : '';
  return `
    <a class="request-row-url" href="${escapeHtml(r.file_path)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(r.file_name || 'attached file')}${size}
    </a>`;
}

function renderRequestsList(requests) {
  loadedRequests = requests;
  const list  = document.getElementById('requestsList');
  const empty = document.getElementById('requestsEmpty');
  document.getElementById('requestsLoading').classList.add('hidden');
  document.getElementById('requestsCount').textContent = requests.length ? String(requests.length) : '';

  if (!requests.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  list.innerHTML = requests.map(r => {
    const sectionLabel = r.section_name
      ? (r.parent_section_name ? `${r.parent_section_name} › ${r.section_name}` : r.section_name)
      : null;
    const icon = r.image_path
      ? `<img src="${escapeHtml(r.image_path)}" alt="" />`
      : REQUEST_FALLBACK_ICON;
    const statusBadge = r.status !== 'pending'
      ? `<span class="request-row-status request-status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>`
      : '';
    // A change request is applied, not published — everything else approves.
    const approveLabel = r.kind === 'change' ? 'Apply change' : 'Approve';
    const approveAttr  = r.kind === 'change' ? 'data-req-apply' : 'data-req-approve';
    const actions = r.status === 'pending'
      ? `<button class="btn btn-primary btn-sm" ${approveAttr}="${r.id}">${approveLabel}</button>
         <button class="btn btn-ghost btn-sm" data-req-reject="${r.id}">Reject</button>
         <button class="btn btn-ghost-danger btn-sm" data-req-delete="${r.id}">Delete</button>`
      : `<button class="btn btn-ghost-danger btn-sm" data-req-delete="${r.id}">Delete</button>`;
    // What sits under the name: the proposed URL, the upload, or the diff.
    const body = r.kind === 'file'   ? requestFileBody(r)
               : r.kind === 'change' ? requestChangeBody(r)
               : `<a class="request-row-url" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a>`;

    // A change request belongs to the link it targets, not to a group.
    const groupMeta = r.kind === 'change' ? '' : `
            <span class="request-row-group">
              <span class="request-row-group-dot" style="background:${escapeHtml(r.group_color || '#888')}"></span>
              ${escapeHtml(r.group_name || 'Unknown group')}${sectionLabel ? ' · ' + escapeHtml(sectionLabel) : ''}
            </span>`;

    return `
      <div class="request-row">
        <div class="request-row-icon">${icon}</div>
        <div class="request-row-main">
          <div class="request-row-name">${requestKindBadge(r.kind)}${escapeHtml(r.kind === 'change' ? (r.target_name || r.name) : r.name)}</div>
          ${body}
          <div class="request-row-meta">
            ${groupMeta}
            <span>${formatRequestDate(r.created_at)}</span>
            ${r.ip_address ? `<span class="request-row-ip" title="Submitter IP">${escapeHtml(r.ip_address)}</span>${ipTagChip(r.ip_address)}` : ''}
            ${statusBadge}
            ${requestDupeChip(r)}
          </div>
          ${r.description && r.kind !== 'change' ? `<div class="request-row-desc">${escapeHtml(r.description)}</div>` : ''}
        </div>
        <div class="request-row-actions">${actions}</div>
      </div>`;
  }).join('');
}

async function loadRequests() {
  document.getElementById('requestsLoading').classList.remove('hidden');
  document.getElementById('requestsEmpty').classList.add('hidden');
  document.getElementById('requestsList').innerHTML = '';
  try {
    const [data] = await Promise.all([fetchLinkRequests(requestsStatus), refreshIpTagMap()]);
    renderRequestsList(data.requests || []);
    const badge = document.getElementById('requestsBadge');
    const count = data.pending_count || 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
  } catch {
    document.getElementById('requestsLoading').classList.add('hidden');
    showToast('Could not load requests', { type: 'error' });
  }
}

function openRequestsModal() {
  requestsStatus = document.getElementById('requestsStatusFilter').value || 'pending';
  document.getElementById('requestsOverlay').classList.remove('hidden');
  loadRequests();
}
function closeRequestsModal() {
  document.getElementById('requestsOverlay').classList.add('hidden');
}

/** Opens the Add-Link modal prefilled from a pending request. */
function openAddLinkModalFromRequest(req) {
  openAddLinkModal();      // resets the form + clears pendingApprovalRequestId
  document.getElementById('inputName').value = req.name || '';
  document.getElementById('inputUrl').value  = req.url  || '';
  document.getElementById('inputDesc').value = req.description || '';
  setLinkModalMode('link');
  populateGroupDropdown(req.group_id
    ? [{ id: req.group_id, section_id: req.section_id ?? null }]
    : []);
  if (req.icon_id) {
    pendingIconId    = req.icon_id;
    shouldRemoveIcon = false;
    showCustomIconPreview(req.image_path, { fromLibrary: true });
  }
  // Bind AFTER openAddLinkModal (which cleared it) so Save finalises approval.
  pendingApprovalRequestId = req.id;
}

document.getElementById('openRequestsBtn').addEventListener('click', openRequestsModal);
document.getElementById('closeRequestsBtn').addEventListener('click', closeRequestsModal);
document.getElementById('requestsRefreshBtn').addEventListener('click', loadRequests);
document.getElementById('requestsStatusFilter').addEventListener('change', e => {
  requestsStatus = e.target.value;
  loadRequests();
});

document.getElementById('requestsList').addEventListener('click', async e => {
  const approveBtn  = e.target.closest('[data-req-approve]');
  const applyBtn    = e.target.closest('[data-req-apply]');
  const rejectBtn   = e.target.closest('[data-req-reject]');
  const deleteBtn   = e.target.closest('[data-req-delete]');
  const existingBtn = e.target.closest('[data-req-existing]');

  // "Already added" chip — jump straight to the link that already exists.
  if (existingBtn) {
    const linkId = Number(existingBtn.dataset.reqExisting);
    const link   = links.find(l => l.id === linkId);
    if (!link) { showToast('That link no longer exists — refresh the list'); return; }
    closeRequestsModal();
    openEditLinkModal(link);
    return;
  }

  // A change request is applied straight onto the link it targets.
  if (applyBtn) {
    const id  = Number(applyBtn.dataset.reqApply);
    const req = loadedRequests.find(r => r.id === id);
    if (!req) return;

    const result = await applyRequestApi(id);
    if (result?.ok !== true) {
      showToast(result?.error || 'Could not apply the change', 'error');
      return;
    }
    showToast(`Change applied to "${result.link?.name || 'the link'}"`);
    await loadRequests();
    refreshRequestsBadge();
    await loadAllData();
    return;
  }

  if (approveBtn) {
    const id  = Number(approveBtn.dataset.reqApprove);
    const req = loadedRequests.find(r => r.id === id);
    if (!req) return;

    // A file request already carries the file, so approving it publishes the
    // link outright — there is nothing left for the admin to fill in.
    if (req.kind === 'file') {
      const result = await approveRequestApi(id);
      if (result?.ok !== true) {
        showToast(result?.error || 'Could not publish the file', 'error');
        return;
      }
      showToast(`Published "${result.link?.name || req.name}"`);
      await loadRequests();
      refreshRequestsBadge();
      await loadAllData();
      return;
    }
    // The URL is already published: offer to add that link to the requested
    // group instead of creating a second copy of it.
    if (requestHasExistingLink(req)) {
      const ex        = req.existing_link;
      const names     = existingLinkGroupNames(ex);
      const target    = req.group_name || 'the requested group';
      const alreadyIn = existingLinkHasRequestedGroup(req);
      const choice    = await showConfirm({
        title:   'Link already exists',
        message: alreadyIn
          ? `"${ex.name}" already points at this URL and is already in ${target}. Approve the request as-is, or add a second copy of the link?`
          : `"${ex.name}" already points at this URL${names.length ? ` (in ${names.join(', ')})` : ''}. Add that link to ${target} instead of creating a duplicate?`,
        confirmText: 'Create duplicate',
        altText:     alreadyIn ? 'Approve only' : `Add to ${target}`,
      });
      if (!choice) return;

      if (choice === 'alt') {
        const result = await attachRequestApi(req.id);
        if (result?.ok !== true) {
          showToast(result?.error || 'Could not approve the request', 'error');
          return;
        }
        showToast(result.added
          ? `Existing link added to ${target}`
          : 'Request approved — the link was already in that group');
        await loadRequests();
        refreshRequestsBadge();
        await loadAllData();   // the link's groups changed
        return;
      }
      // choice === true → fall through and create the duplicate as usual.
    }
    closeRequestsModal();
    openAddLinkModalFromRequest(req);
    return;
  }
  if (rejectBtn) {
    const id  = Number(rejectBtn.dataset.reqReject);
    const req = loadedRequests.find(r => r.id === id);

    // Rejecting a file request deletes the uploaded file. That cannot be undone,
    // so ask before doing it.
    if (req?.kind === 'file') {
      const ok = await showConfirm({
        title:   'Reject this file?',
        message: `"${req.file_name || 'The uploaded file'}" will be deleted from the server. This cannot be undone.`,
        confirmText: 'Reject and delete',
      });
      if (!ok) return;
    }

    await rejectRequestApi(id);
    showToast('Request rejected');
    await loadRequests();
    refreshRequestsBadge();
    return;
  }
  if (deleteBtn) {
    const id  = Number(deleteBtn.dataset.reqDelete);
    const req = loadedRequests.find(r => r.id === id);

    // Same as rejecting: an unpublished upload goes with the row.
    if (req?.kind === 'file' && !req.created_link_id) {
      const ok = await showConfirm({
        title:   'Delete this request?',
        message: `"${req.file_name || 'The uploaded file'}" will be deleted from the server. This cannot be undone.`,
        confirmText: 'Delete',
      });
      if (!ok) return;
    }

    await deleteRequestApi(id);
    showToast('Request deleted');
    await loadRequests();
    refreshRequestsBadge();
  }
});

// ─── IP ATTRIBUTION ────────────────────────────────────────────────────────
//
// Lists every IP the app has seen (from clicks + requests) so the admin can
// attach a human-readable tag naming who is behind it.

let loadedIpTags = [];

function renderIpTagsList(ips) {
  loadedIpTags = ips;
  const list  = document.getElementById('ipTagsList');
  const empty = document.getElementById('ipTagsEmpty');
  document.getElementById('ipTagsLoading').classList.add('hidden');

  const q = (document.getElementById('ipTagSearch').value || '').toLowerCase().trim();
  const rows = q
    ? ips.filter(r => r.ip_address.toLowerCase().includes(q) || (r.tag || '').toLowerCase().includes(q))
    : ips;

  if (!rows.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  list.innerHTML = rows.map(r => {
    const events = r.event_count === 0
      ? 'no activity'
      : `${r.event_count} event${r.event_count !== 1 ? 's' : ''}`;
    const seen = r.last_seen ? `last seen ${formatRequestDate(r.last_seen)}` : 'never seen';
    return `
      <div class="ip-tag-row" data-ip="${escapeHtml(r.ip_address)}">
        <div class="ip-tag-main">
          <span class="ip-tag-addr">${escapeHtml(r.ip_address)}</span>
          <span class="ip-tag-meta">${events} · ${seen}</span>
        </div>
        <div class="ip-tag-actions">
          <input type="text" class="ip-tag-input" placeholder="Name / tag…"
                 value="${escapeHtml(r.tag || '')}" maxlength="120" />
          <button class="btn btn-primary btn-sm" data-ip-save>Save</button>
          <button class="btn btn-ghost-danger btn-sm ${r.tag ? '' : 'hidden'}" data-ip-clear>Clear</button>
        </div>
      </div>`;
  }).join('');
}
