// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: accounts and invites. */

// ─── Accounts ────────────────────────────────────────────────────────────────

/**
 * Who this browser is signed in as, when it is signed in rather than holding a
 * token. Used to grey out the actions somebody must not perform on themselves —
 * the server refuses them anyway, but a button that always errors is bad UI.
 */
function currentAdminId() {
  return adminAuthMode === 'session' ? adminIdentity?.id ?? null : null;
}

const fetchUsers        = ()        => apiJson('/api/users');
const fetchInvites      = ()        => apiJson('/api/invites');
const createInviteApi   = body      => jsonPost('/api/invites', body);
const revokeInviteApi   = id        => sendAuthRequest(`/api/invites/${id}`, { method: 'DELETE' });
const patchUserApi      = (id, b)   => sendAuthRequest(`/api/users/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
});
const deleteUserApi     = id        => sendAuthRequest(`/api/users/${id}`, { method: 'DELETE' });
const resetLinkApi      = id        => jsonPost(`/api/users/${id}/reset-link`, {});
const signOutUserApi    = id        => jsonPost(`/api/users/${id}/logout-all`, {});

async function loadAccounts() {
  const [users, invites] = await Promise.all([
    fetchUsers().catch(() => ({ users: [] })),
    fetchInvites().catch(() => ({ invites: [] })),
  ]);
  renderUsersList(users.users || []);
  renderInvitesList(invites.invites || []);
}

function renderUsersList(users) {
  const box = document.getElementById('usersList');
  if (!users.length) {
    box.innerHTML = '<div class="audit-empty">No accounts yet. Create an invite to add one.</div>';
    return;
  }

  const me = currentAdminId();
  box.innerHTML = users.map(u => {
    // Self-protection, mirroring what the server enforces.
    const isSelf = u.id === me;
    const lastAdmin = u.role === 'admin' && u.is_active
                   && users.filter(x => x.role === 'admin' && x.is_active).length === 1;
    const locked = isSelf || lastAdmin;
    const why = isSelf ? 'This is your own account'
              : lastAdmin ? 'The last administrator cannot be removed' : '';

    return `
      <div class="user-row" data-user-id="${u.id}" data-has-password="${u.has_password ? '1' : '0'}">
        <div class="user-row-main">
          <div class="user-row-name">
            ${escapeHtml(u.display_name || u.email)}
            <span class="role-pill role-${u.role}">${u.role === 'admin' ? 'Admin' : 'Member'}</span>
            ${u.is_active ? '' : '<span class="role-pill role-off">Disabled</span>'}
            ${u.must_change_password ? '<span class="role-pill role-warn">Must change password</span>' : ''}
            ${u.sso ? '<span class="role-pill role-user" title="Signs in through single sign-on">SSO</span>' : ''}
          </div>
          <div class="user-row-meta">
            ${escapeHtml(u.email)}
            · ${u.last_login_at ? `last seen ${formatRequestDate(u.last_login_at)}` : 'never signed in'}
            · ${u.session_count} session${u.session_count === 1 ? '' : 's'}
          </div>
          ${u.storage ? `
          <div class="user-row-storage">
            <span class="user-storage-bar"><span style="width:${Math.min(100, u.storage.quota ? (u.storage.used / u.storage.quota) * 100 : 0).toFixed(1)}%"></span></span>
            <span>${formatBytes(u.storage.used)} of ${formatBytes(u.storage.quota)}${u.storage_quota === null ? '' : ' · own allowance'}</span>
            <button type="button" class="user-storage-edit" data-action="quota">Change</button>
          </div>
          <div class="user-quota-form hidden">
            <input type="number" min="0" step="1" placeholder="Default"
                   value="${u.storage_quota === null ? '' : Math.round(u.storage_quota / 1024 / 1024)}"
                   aria-label="Allowance for ${escapeHtml(u.email)} in megabytes" />
            <span class="settings-row-desc">MB</span>
            <button type="button" class="btn btn-ghost btn-sm" data-action="quota-save">Save</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="quota-default">Use the default</button>
          </div>` : ''}
        </div>
        <div class="user-row-actions">
          <select class="bulk-group-select" data-action="role" ${locked ? 'disabled' : ''}
                  title="${escapeHtml(why)}" style="width:104px">
            <option value="user"  ${u.role === 'user'  ? 'selected' : ''}>Member</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
          <button class="btn btn-ghost btn-sm" data-action="reset">Reset link</button>
          ${u.sso ? '<button class="btn btn-ghost btn-sm" data-action="sso-disconnect">Disconnect SSO</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-action="signout"
                  ${u.session_count ? '' : 'disabled'}>Sign out</button>
          <button class="btn btn-ghost btn-sm" data-action="toggle"
                  ${locked ? 'disabled' : ''} title="${escapeHtml(why)}">
            ${u.is_active ? 'Disable' : 'Enable'}
          </button>
          <button class="btn btn-ghost-danger btn-sm" data-action="delete"
                  ${locked ? 'disabled' : ''} title="${escapeHtml(why)}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

/** Whether the account on this row has a password of its own. */
const rowHasPassword = el => el.closest('.user-row')?.dataset.hasPassword === '1';

function renderInvitesList(invites) {
  const box = document.getElementById('invitesList');
  const live = invites.filter(i => i.status === 'pending');

  if (!invites.length) {
    box.innerHTML = '<div class="audit-empty">No invites yet.</div>';
    return;
  }

  // Pending first: the others are history, and only the pending ones can be
  // acted on.
  const ordered = [...live, ...invites.filter(i => i.status !== 'pending')].slice(0, 40);

  box.innerHTML = ordered.map(i => `
    <div class="invite-row" data-invite-id="${i.id}">
      <div class="user-row-main">
        <div class="user-row-name">
          ${escapeHtml(i.label || 'Unlabelled invite')}
          <span class="role-pill role-${i.role}">${i.role === 'admin' ? 'Admin' : 'Member'}</span>
          <span class="role-pill role-${i.status === 'pending' ? 'ok' : 'off'}">${i.status}</span>
        </div>
        <div class="user-row-meta">
          ${i.status === 'redeemed'
            ? `used by ${escapeHtml(i.redeemed_email || 'somebody')} ${formatRequestDate(i.redeemed_at)}`
            : `expires ${formatRequestDate(i.expires_at)}`}
          ${i.created_by_email ? `· from ${escapeHtml(i.created_by_email)}` : ''}
        </div>
      </div>
      <div class="user-row-actions">
        ${i.status === 'pending'
          ? '<button class="btn btn-ghost-danger btn-sm" data-action="revoke">Revoke</button>'
          : ''}
      </div>
    </div>`).join('');
}

document.getElementById('saveUserQuotaBtn').addEventListener('click', async () => {
  const mb = Number(document.getElementById('userQuotaInput').value);
  if (!Number.isFinite(mb) || mb < 0) { showToast('Enter a number of megabytes', 'error'); return; }
  const r = await sendAuthRequest('/api/settings/user-quota', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ megabytes: mb }),
  });
  if (!r.ok) { showToast('Could not save the allowance', 'error'); return; }
  showToast(`Each member may now keep ${mb} MB`);
  await loadAccounts();
});

document.getElementById('generateInviteBtn').addEventListener('click', async () => {
  const btn = document.getElementById('generateInviteBtn');
  const role  = document.getElementById('inviteRoleSelect').value;
  const label = document.getElementById('inviteLabelInput').value.trim();
  const expires_in_days = Number(document.getElementById('inviteExpirySelect').value) || 7;

  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const invite = await createInviteApi({ role, label, expires_in_days });
    revealInviteUrl(invite.url, 'Invite link — copy it now');
    document.getElementById('inviteLabelInput').value = '';
    await loadAccounts();
  } catch {
    showToast('Could not create the invite', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create invite';
  }
});

/** Shows a one-time link, with the copy button next to it. */
function revealInviteUrl(url, label) {
  document.getElementById('newInviteLabel').textContent = label;
  document.getElementById('newInviteUrl').value = url;
  document.getElementById('newInviteDisplay').classList.remove('hidden');
  document.getElementById('newInviteUrl').select();
}

document.getElementById('copyInviteBtn').addEventListener('click', async () => {
  const input = document.getElementById('newInviteUrl');
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('Link copied');
  } catch {
    // Clipboard access can be refused; selecting it at least makes ⌘C work.
    input.select();
    showToast('Press ⌘C to copy', 'info');
  }
});

document.getElementById('usersList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.tagName === 'SELECT') return;
  const row = btn.closest('.user-row');
  const id  = Number(row.dataset.userId);
  const name = row.querySelector('.user-row-meta').textContent.trim().split(' ')[0];

  if (btn.dataset.action === 'quota') {
    row.querySelector('.user-quota-form').classList.toggle('hidden');
    row.querySelector('.user-quota-form input').focus();
    return;
  }

  if (btn.dataset.action === 'quota-save' || btn.dataset.action === 'quota-default') {
    const input = row.querySelector('.user-quota-form input');
    const usingDefault = btn.dataset.action === 'quota-default' || input.value.trim() === '';
    const mb = Number(input.value);
    if (!usingDefault && (!Number.isFinite(mb) || mb < 0)) {
      showToast('Enter a number of megabytes', 'error');
      return;
    }
    const r = await patchUserApi(id, { storage_quota_mb: usingDefault ? null : mb });
    if (!r.ok) { showToast('Could not change that allowance', 'error'); return; }
    showToast(usingDefault ? 'Back to the default allowance' : 'Allowance saved');
    await loadAccounts();
    return;
  }

  if (btn.dataset.action === 'reset') {
    try {
      const link = await resetLinkApi(id);
      revealInviteUrl(link.url, `Password reset link for ${name} — copy it now`);
    } catch { showToast('Could not create a reset link', 'error'); }
    return;
  }

  if (btn.dataset.action === 'signout') {
    try {
      const res = await signOutUserApi(id);
      showToast(`Signed out of ${res.ended} session${res.ended === 1 ? '' : 's'}`);
      await loadAccounts();
    } catch { showToast('Could not sign them out', 'error'); }
    return;
  }

  if (btn.dataset.action === 'toggle') {
    const enabling = btn.textContent.trim() === 'Enable';
    const r = await patchUserApi(id, { is_active: enabling });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.error || 'Could not change that account', 'error');
    }
    await loadAccounts();
    return;
  }

  if (btn.dataset.action === 'sso-disconnect') {
    const confirmed = await showConfirm({
      title:   'Disconnect from single sign-on?',
      message: `${name} will no longer be signed in by the provider. `
             + (rowHasPassword(btn) ? 'Their password keeps working.'
                                       : 'They have no password here, so they will need a reset link to get back in.'),
      confirmText: 'Disconnect',
      danger:  true,
    });
    if (!confirmed) return;
    const r = await sendAuthRequest(`/api/users/${id}/identities`, { method: 'DELETE' });
    if (!r.ok) { showToast('Could not disconnect that account', 'error'); return; }
    showToast('Disconnected from single sign-on');
    await loadAccounts();
    return;
  }

  if (btn.dataset.action === 'delete') {
    const confirmed = await showConfirm({
      title:   'Delete this account?',
      message: `${name} will lose access immediately, and anything they own goes with it. `
             + 'This cannot be undone.',
      confirmText: 'Delete account',
      danger:  true,
    });
    if (!confirmed) return;

    const r = await deleteUserApi(id);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.error || 'Could not delete that account', 'error');
    } else {
      showToast('Account deleted');
    }
    await loadAccounts();
  }
});

document.getElementById('usersList').addEventListener('change', async e => {
  const select = e.target.closest('select[data-action="role"]');
  if (!select) return;
  const id = Number(select.closest('.user-row').dataset.userId);

  const r = await patchUserApi(id, { role: select.value });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    showToast(d.error || 'Could not change that role', 'error');
  } else {
    showToast('Role updated');
  }
  await loadAccounts();
});

document.getElementById('invitesList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-action="revoke"]');
  if (!btn) return;
  const id = Number(btn.closest('.invite-row').dataset.inviteId);

  const r = await revokeInviteApi(id);
  showToast(r.ok ? 'Invite revoked' : 'Could not revoke that invite', r.ok ? 'success' : 'error');
  await loadAccounts();
});

async function loadIpTags() {
  document.getElementById('ipTagsLoading').classList.remove('hidden');
  document.getElementById('ipTagsEmpty').classList.add('hidden');
  document.getElementById('ipTagsList').innerHTML = '';
  try {
    const data = await fetchIpTags();
    const ips  = data.ips || [];
    // Keep the shared map in sync so other surfaces show fresh tags too.
    ipTagMap = {};
    ips.forEach(r => { if (r.tag) ipTagMap[r.ip_address] = r.tag; });
    renderIpTagsList(ips);
  } catch {
    document.getElementById('ipTagsLoading').classList.add('hidden');
    showToast('Could not load IP attribution', { type: 'error' });
  }
}

document.getElementById('ipTagsRefreshBtn').addEventListener('click', loadIpTags);
document.getElementById('ipTagSearch').addEventListener('input', () => renderIpTagsList(loadedIpTags));
document.getElementById('ipTagsList').addEventListener('click', async e => {
  const row = e.target.closest('.ip-tag-row');
  if (!row) return;
  const ip = row.dataset.ip;

  if (e.target.closest('[data-ip-save]')) {
    const tag = row.querySelector('.ip-tag-input').value.trim();
    if (!tag) { showToast('Enter a tag first', { type: 'error' }); return; }
    try { await saveIpTagApi(ip, tag); showToast('Tag saved'); await loadIpTags(); }
    catch { showToast('Could not save tag', { type: 'error' }); }
    return;
  }
  if (e.target.closest('[data-ip-clear]')) {
    try { await deleteIpTagApi(ip); showToast('Tag removed'); await loadIpTags(); }
    catch { showToast('Could not remove tag', { type: 'error' }); }
  }
});
