// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: guest contribution settings and guest moderation. */

// ─── Contributions ────────────────────────────────────────────────────────────

const CONTRIB_MODE_DESC = {
  off:     'Nobody. The public page is read-only.',
  members: 'Signed-in members only.',
  anyone:  'Anyone, including guests identified by their browser.',
};

async function loadContributions() {
  document.getElementById('contribError').classList.add('hidden');
  let s, g;
  try {
    s = await apiJson('/api/settings/contributions');
    g = await apiJson('/api/guests');
  } catch {
    showToast('Could not load the contribution settings', 'error');
    return;
  }
  document.getElementById('contribModeSelect').value       = s.mode || 'off';
  document.getElementById('contribRetentionInput').value   = String(s.retention_days || 0);
  document.getElementById('contribModeDesc').textContent   = CONTRIB_MODE_DESC[s.mode || 'off'];
  renderGuests(g.guests || []);
}

function renderGuests(guests) {
  const box = document.getElementById('guestsList');
  if (!guests.length) {
    box.innerHTML = '<div class="audit-empty">No guest contributions yet.</div>';
    document.getElementById('deleteAllGuestsBtn').classList.add('hidden');
    return;
  }
  document.getElementById('deleteAllGuestsBtn').classList.remove('hidden');
  box.innerHTML = guests.map(g => `
    <div class="user-row" data-guest-id="${g.id}">
      <div class="user-row-main">
        <div class="user-row-name">
          Guest #${g.id}
          <span class="role-pill role-user">${g.group_count} group${g.group_count === 1 ? '' : 's'}</span>
          <span class="role-pill role-user">${g.link_count} link${g.link_count === 1 ? '' : 's'}</span>
        </div>
        <div class="user-row-meta">
          first seen ${formatRequestDate(g.created_at)} · last seen ${formatRequestDate(g.last_seen_at)}
          ${g.ip_address ? `· ${escapeHtml(g.ip_address)}` : ''}
          ${g.user_agent ? `· ${escapeHtml(g.user_agent.slice(0, 60))}` : ''}
        </div>
        <div class="user-row-meta">
          ${formatBytes(g.storage_used)} stored
        </div>
      </div>
      <div class="user-row-actions">
        <button class="btn btn-ghost-danger btn-sm" data-action="delete-guest">Delete</button>
      </div>
    </div>`).join('');
}

async function saveContributions() {
  const btn = document.getElementById('saveContribBtn');
  const err = document.getElementById('contribError');
  err.classList.add('hidden');
  const body = {
    mode:           document.getElementById('contribModeSelect').value,
    retention_days: Number(document.getElementById('contribRetentionInput').value) || 0,
  };
  btn.disabled = true;
  try {
    const res = await sendAuthRequest('/api/settings/contributions', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.textContent = data.error || 'Could not save the contribution settings.';
      err.classList.remove('hidden');
      return;
    }
    document.getElementById('contribModeDesc').textContent = CONTRIB_MODE_DESC[data.mode] || CONTRIB_MODE_DESC.off;
    showToast('Contribution settings saved');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('saveContribBtn').addEventListener('click', saveContributions);

document.getElementById('guestsList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="delete-guest"]');
  if (!btn) return;
  const row = btn.closest('.user-row');
  const id  = row.dataset.guestId;
  const confirmed = await showConfirm({
    title: `Delete guest #${id}?`,
    message: 'Their groups, links and files are removed. The browser they used can start a new guest the next time it contributes.',
    confirmText: 'Delete', danger: true,
  });
  if (!confirmed) return;
  const res = await sendAuthRequest(`/api/guests/${id}`, { method: 'DELETE' });
  if (!res.ok) { showToast('Could not delete that guest', 'error'); return; }
  showToast('Guest removed');
  loadContributions();
});

document.getElementById('deleteAllGuestsBtn').addEventListener('click', async () => {
  const confirmed = await showConfirm({
    title: 'Remove every guest?',
    message: 'Every guest\'s groups, links and files are removed. Members\' own content is left alone.',
    confirmText: 'Remove all', danger: true,
  });
  if (!confirmed) return;
  const res = await sendAuthRequest('/api/guests', { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showToast('Could not remove guests', 'error'); return; }
  showToast(`${data.removed} guest(s) removed`);
  loadContributions();
});
