// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: closing modals, and the audit log viewer. */

// ─── 21. MODAL CLOSE ──────────────────────────────────────────────────────────

// ─── Audit log viewer ─────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE   = 100;
const AUDIT_POLL_MS     = 5000;   // how often "Live" checks for new entries
let auditEntries  = [];
let auditAllLoaded = false;
let auditQueryTimer = null;
let auditPollTimer  = null;       // setInterval handle while modal is open + live

// SVG glyph per entity type, with a colour class for the dot.
const AUDIT_TYPE_META = {
  click:    { cls: 'click',    label: 'Click' },
  link:     { cls: 'link',     label: 'Link' },
  group:    { cls: 'group',    label: 'Group' },
  section:  { cls: 'section',  label: 'Section' },
  icon:     { cls: 'icon',     label: 'Icon' },
  settings: { cls: 'settings', label: 'Settings' },
  request:  { cls: 'request',  label: 'Request' },
  auth:     { cls: 'auth',     label: 'Auth' },
  audit:    { cls: 'audit',    label: 'Audit' },
  user:     { cls: 'user',     label: 'Account' },
  invite:   { cls: 'invite',   label: 'Invite' },
  personal: { cls: 'personal', label: 'Member page' },
  // Entries written before personal changes shared one type keep their old,
  // separate ones; shown the same way.
  my_link:     { cls: 'personal', label: 'Member page' },
  my_group:    { cls: 'personal', label: 'Member page' },
  my_section:  { cls: 'personal', label: 'Member page' },
  my_favorite: { cls: 'personal', label: 'Member page' },
};

/**
 * Who did it. A person, by the name they had at the time; the admin token,
 * which is not a person; or a visitor nobody knows. Entries from before
 * accounts existed have no actor recorded and read back as the token — the
 * only thing that could change anything then.
 */
function auditActorHtml(e) {
  if (e.actor_type === 'user' && e.actor_label) {
    return `<span class="audit-actor audit-actor-user" title="Signed-in account">${escapeHtml(e.actor_label)}</span>`;
  }
  if (e.actor_type === 'public') return '<span class="audit-actor">Visitor</span>';
  return '<span class="audit-actor audit-actor-token" title="The admin token">Admin token</span>';
}

function auditActionVerb(action) {
  // Maps an action to a dot colour. Clicks get their own neutral colour;
  // mutations are create/update/delete.
  if (action === 'link.click')               return 'click';
  const tail = String(action || '').split('.').pop();
  if (/create|import/.test(tail))            return 'create';
  if (/delete|clear|bulk_delete/.test(tail)) return 'delete';
  return 'update';
}

function formatAuditTime(iso) {
  // SQLite stores UTC "YYYY-MM-DD HH:MM:SS"; render in the viewer's locale.
  const d = new Date(String(iso).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  const now  = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000)        return 'just now';
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function openAuditLog() {
  document.getElementById('settingsOverlay').classList.add('hidden');
  document.getElementById('auditOverlay').classList.remove('hidden');
  document.getElementById('auditSearchInput').value = '';
  document.getElementById('auditTypeFilter').value = '';
  await refreshIpTagMap();   // so attribution tags render next to IPs
  await reloadAuditLog();
  startAuditPolling();
}

function closeAuditLog() {
  stopAuditPolling();
  document.getElementById('auditOverlay').classList.add('hidden');
}

function startAuditPolling() {
  stopAuditPolling();
  if (!document.getElementById('auditLiveToggle').checked) return;
  auditPollTimer = setInterval(pollNewAuditEntries, AUDIT_POLL_MS);
}

function stopAuditPolling() {
  if (auditPollTimer) { clearInterval(auditPollTimer); auditPollTimer = null; }
}

/**
 * Fetches only entries newer than the newest one we already have (respecting
 * the active search/type filter) and prepends them with a brief highlight.
 * Cheap — returns an empty array when nothing changed. Skips while the user
 * is scrolled away from the top so we don't yank their position.
 */
async function pollNewAuditEntries() {
  if (document.getElementById('auditOverlay').classList.contains('hidden')) {
    stopAuditPolling();
    return;
  }
  // Nothing loaded yet (e.g. empty filter result) — just re-run the query.
  const newestId = auditEntries.length ? auditEntries[0].id : null;
  if (newestId == null) { await reloadAuditLog({ silent: true }); return; }

  const q    = document.getElementById('auditSearchInput').value.trim();
  const type = document.getElementById('auditTypeFilter').value;
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE), after: String(newestId) });
  if (q)    params.set('q', q);
  if (type) params.set('type', type);

  let data;
  try { data = await apiJson(`/api/audit?${params.toString()}`); }
  catch { return; }

  document.getElementById('auditCount').textContent =
    data.total ? `${data.total} ${data.total === 1 ? 'entry' : 'entries'}` : '';

  if (!data.entries || !data.entries.length) return;
  // Entries come newest-first; prepend so order is preserved.
  auditEntries = [...data.entries, ...auditEntries];
  const newIds = new Set(data.entries.map(e => e.id));
  renderAuditList(newIds);
}

async function reloadAuditLog({ silent = false } = {}) {
  auditEntries = [];
  auditAllLoaded = false;
  if (!silent) {
    document.getElementById('auditList').innerHTML = '';
    document.getElementById('auditEmpty').classList.add('hidden');
    document.getElementById('auditMoreBtn').classList.add('hidden');
    document.getElementById('auditLoading').classList.remove('hidden');
  }
  await fetchAuditPage();
}

async function fetchAuditPage() {
  const q    = document.getElementById('auditSearchInput').value.trim();
  const type = document.getElementById('auditTypeFilter').value;
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
  if (q)    params.set('q', q);
  if (type) params.set('type', type);
  const beforeId = auditEntries.length ? auditEntries[auditEntries.length - 1].id : null;
  if (beforeId)  params.set('before', String(beforeId));

  let data;
  try {
    data = await apiJson(`/api/audit?${params.toString()}`);
  } catch {
    document.getElementById('auditLoading').classList.add('hidden');
    showToast('Could not load audit log', 'error');
    return;
  }

  document.getElementById('auditLoading').classList.add('hidden');
  auditEntries.push(...(data.entries || []));
  if (!data.entries || data.entries.length < AUDIT_PAGE_SIZE) auditAllLoaded = true;

  document.getElementById('auditCount').textContent =
    data.total ? `${data.total} ${data.total === 1 ? 'entry' : 'entries'}` : '';

  renderAuditList();
}

function renderAuditList(newIds = null) {
  const list = document.getElementById('auditList');
  const empty = document.getElementById('auditEmpty');
  const moreBtn = document.getElementById('auditMoreBtn');

  if (!auditEntries.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    moreBtn.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = auditEntries.map(e => {
    const meta = AUDIT_TYPE_META[e.entity_type] || { cls: 'other', label: e.entity_type || '—' };
    const verb = auditActionVerb(e.action);
    const ua   = e.user_agent ? deviceFromUA(e.user_agent) : '';
    // Build origin as HTML (not a pre-escaped string) so the IP can carry its
    // attribution chip. Each text part is still escaped individually.
    const originParts = [];
    if (e.ip_address) originParts.push(`${escapeHtml(e.ip_address)}${ipTagChip(e.ip_address)}`);
    if (ua)           originParts.push(escapeHtml(ua));
    const originHtml = originParts.join(' · ');
    const isNew = newIds && newIds.has(e.id);
    return `
      <div class="audit-row${isNew ? ' audit-row-new' : ''}">
        <span class="audit-dot audit-dot-${verb}" title="${escapeHtml(verb)}"></span>
        <div class="audit-main">
          <div class="audit-summary">${escapeHtml(e.summary || e.action)}</div>
          <div class="audit-meta">
            ${auditActorHtml(e)}
            <span class="audit-badge audit-badge-${meta.cls}">${escapeHtml(meta.label)}</span>
            <span class="audit-action-code">${escapeHtml(e.action)}</span>
            ${originHtml ? `<span class="audit-origin">${originHtml}</span>` : ''}
          </div>
        </div>
        <time class="audit-time" title="${escapeHtml(e.created_at)} UTC">${escapeHtml(formatAuditTime(e.created_at))}</time>
      </div>`;
  }).join('');

  moreBtn.classList.toggle('hidden', auditAllLoaded);

  // Strip the highlight class after the entrance animation so it doesn't
  // re-trigger on the next render.
  if (newIds && newIds.size) {
    setTimeout(() => {
      list.querySelectorAll('.audit-row-new').forEach(el => el.classList.remove('audit-row-new'));
    }, 2000);
  }
}

// Tiny UA → device string. Mirrors the stats modal's intent without importing.
function deviceFromUA(ua) {
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return 'Mobile';
  if (/Macintosh|Windows|Linux/i.test(ua))  return 'Desktop';
  return '';
}

document.getElementById('openAuditLogBtn').addEventListener('click', openAuditLog);
document.getElementById('closeAuditBtn').addEventListener('click', closeAuditLog);
document.getElementById('auditMoreBtn').addEventListener('click', fetchAuditPage);

document.getElementById('auditRefreshBtn').addEventListener('click', () => reloadAuditLog());

document.getElementById('auditExportBtn').addEventListener('click', async () => {
  // Export honours the active search + type filter so "export what I'm
  // viewing" works. The download needs the admin token header, so we fetch
  // the blob then trigger a synthetic <a> download rather than a plain link.
  const q    = document.getElementById('auditSearchInput').value.trim();
  const type = document.getElementById('auditTypeFilter').value;
  const params = new URLSearchParams({ format: 'csv' });
  if (q)    params.set('q', q);
  if (type) params.set('type', type);

  try {
    const res = await sendAuthRequest(`/api/audit/export?${params.toString()}`);
    if (!res.ok) throw new Error('export failed');
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Audit log exported');
  } catch {
    showToast('Could not export log', 'error');
  }
});

document.getElementById('auditLiveToggle').addEventListener('change', e => {
  if (e.target.checked) {
    pollNewAuditEntries();   // catch up immediately
    startAuditPolling();
  } else {
    stopAuditPolling();
  }
});

document.getElementById('auditSearchInput').addEventListener('input', () => {
  clearTimeout(auditQueryTimer);
  auditQueryTimer = setTimeout(() => reloadAuditLog(), 250);
});
document.getElementById('auditTypeFilter').addEventListener('change', () => reloadAuditLog());

document.getElementById('auditClearBtn').addEventListener('click', async () => {
  const ok = await showConfirm({
    title:       'Clear audit log',
    message:     'Permanently delete every audit entry? This cannot be undone.',
    confirmText: 'Clear log',
    danger:      true,
  });
  if (!ok) return;
  const res = await sendAuthRequest('/api/audit', { method: 'DELETE' });
  if (res.ok) {
    showToast('Audit log cleared');
    await reloadAuditLog();
  } else {
    showToast('Could not clear log', 'error');
  }
});

