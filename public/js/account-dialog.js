// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: the Your account dialog — password, sessions, export and import, single sign-on. */

// ─── Your account ─────────────────────────────────────────────────────────────

/** "Chrome on macOS", roughly — enough to recognise a device, not to fingerprint it. */
function describeDevice(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera'
                : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome'
                : /Safari\//.test(s) ? 'Safari' : /curl|node|undici/i.test(s) ? 'A script' : 'A browser';
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
           : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows'
           : /Linux/.test(s) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

/** "3 minutes ago" from a SQLite UTC timestamp. */
function sinceText(raw) {
  const then = Date.parse(`${String(raw).replace(' ', 'T')}Z`);
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

async function openAccount({ focusPassword = false, ssoNotice = null } = {}) {
  if (!currentUser) return;
  el('accountWho').textContent = currentUser.display_name
    ? `${currentUser.display_name} · ${currentUser.email}` : currentUser.email;
  el('accountMustChange').classList.toggle('hidden', !currentUser.must_change_password);
  el('accountPasswordForm').reset();
  el('accountPasswordError').classList.add('hidden');
  el('accountImportResult').classList.add('hidden');
  el('accountOverlay').classList.remove('hidden');
  (focusPassword || currentUser.must_change_password ? el('accountCurrentPw') : el('closeAccountBtn')).focus();
  await Promise.all([renderSessions(), renderSso(ssoNotice)]);
}

// What the server's sso_error codes mean when connecting an account.
const SSO_CONNECT_ERRORS = {
  already_linked: 'That sign-in is already connected to a different account here.',
  expired:        'That took too long, or you were signed out on the way. Try again.',
  denied:         'Connecting was cancelled at the provider.',
  unavailable:    'The sign-in provider could not be reached. Try again later.',
  disabled:       'Single sign-on is not set up here.',
};

/** The single sign-on section: whether it exists here, and whether you are connected. */
async function renderSso(notice) {
  const section = el('accountSso');
  const r = await fetch('/api/auth/identities', { credentials: 'same-origin' }).catch(() => null);
  if (!r || !r.ok) { section.classList.add('hidden'); return; }
  const info = await r.json();
  const connected = info.identities.length > 0;

  // An account with no password of its own has nothing to change it from.
  el('accountNoPassword').classList.toggle('hidden', info.has_password);
  el('accountPasswordForm').classList.toggle('hidden', !info.has_password);

  section.classList.toggle('hidden', !info.available && !connected);
  el('accountSsoStatus').textContent = connected
    ? `Connected${info.identities[0].email ? ` as ${info.identities[0].email}` : ''}. You can sign in with "${info.label}".`
    : `Not connected. Connect it to sign in with "${info.label}".`;
  el('accountSsoConnect').classList.toggle('hidden', connected || !info.available);
  // Disconnecting the only way in is refused by the server; do not offer it.
  el('accountSsoDisconnect').classList.toggle('hidden', !connected || !info.has_password);

  const box = el('accountSsoNotice');
  box.classList.toggle('hidden', !notice);
  box.textContent = notice || '';
}

// ─── Export and import ────────────────────────────────────────────────────────

el('accountImport')?.addEventListener('click', () => el('accountImportFile').click());

el('accountImportFile')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const box = el('accountImportResult');

  let payload;
  try { payload = JSON.parse(await file.text()); } catch {
    showToast('That file is not a LinkPage export', { type: 'error' });
    return;
  }

  const res  = await myRequest('/api/my/import', { json: payload });
  const data = res.body;
  if (!res.ok) { showToast(data.error || 'Could not import that file', { type: 'error' }); return; }

  const parts = [
    `${data.links_imported} link${data.links_imported === 1 ? '' : 's'} imported`,
    data.groups_created   ? `${data.groups_created} new group${data.groups_created === 1 ? '' : 's'}` : '',
    data.favorites_added  ? `${data.favorites_added} favourite${data.favorites_added === 1 ? '' : 's'}` : '',
    data.links_skipped    ? `${data.links_skipped} already here or skipped` : '',
  ].filter(Boolean);
  box.textContent = `${parts.join(', ')}.${data.problems.length ? ` ${data.problems.slice(0, 3).join(' · ')}` : ''}`;
  box.classList.remove('hidden');
  showToast('Import finished');
  await loadData();
});

el('accountSsoDisconnect')?.addEventListener('click', async () => {
  const r = await fetch('/api/auth/identities', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
  if (!r || !r.ok) {
    const d = r ? await r.json().catch(() => ({})) : {};
    showToast(d.error || 'Could not disconnect', { type: 'error' });
    return;
  }
  showToast('Disconnected from single sign-on');
  renderSso();
});

function closeAccount() { el('accountOverlay').classList.add('hidden'); }

async function renderSessions() {
  const box = el('accountSessions');
  box.innerHTML = '<p class="my-link-hint">Loading…</p>';
  const r = await fetch('/api/auth/sessions', { credentials: 'same-origin' }).catch(() => null);
  if (!r || !r.ok) { box.innerHTML = '<p class="my-link-hint">Could not load your sessions.</p>'; return; }
  const { sessions } = await r.json();

  // This device first: it is the one people look for.
  sessions.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0));
  el('accountSignOutOthers').classList.toggle('hidden', !sessions.some(x => !x.current));

  box.innerHTML = sessions.map(x => `
    <div class="account-session" data-session="${escapeHtml(x.id)}">
      <div class="account-session-main">
        <div class="account-session-what">
          ${escapeHtml(describeDevice(x.user_agent))}
          ${x.current ? '<span class="account-this">This device</span>' : ''}
        </div>
        <div class="account-session-when">
          ${x.current ? 'Using it now' : `Last seen ${escapeHtml(sinceText(x.last_seen_at))}`}
          ${x.ip_address ? ` · ${escapeHtml(x.ip_address)}` : ''}
        </div>
      </div>
      ${x.current ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-act="end-session">Sign out</button>'}
    </div>`).join('') || '<p class="my-link-hint">Only this device.</p>';
}

el('accountSessions')?.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act="end-session"]');
  if (!btn) return;
  const id = btn.closest('.account-session').dataset.session;
  btn.disabled = true;
  const res = await myRequest(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) { btn.disabled = false; showToast('Could not sign that device out', { type: 'error' }); return; }
  showToast('Signed out of that device');
  await renderSessions();
});

el('accountSignOutOthers')?.addEventListener('click', async () => {
  const res = await myRequest('/api/auth/logout-all', { method: 'POST' });
  if (!res.ok) { showToast('Could not sign out the other devices', { type: 'error' }); return; }
  showToast(`Signed out of ${res.body.ended} other device${res.body.ended === 1 ? '' : 's'}`);
  await renderSessions();
});

el('accountPasswordForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const err = el('accountPasswordError');
  err.classList.add('hidden');
  const fail = message => { err.textContent = message; err.classList.remove('hidden'); };

  const current = el('accountCurrentPw').value;
  const next    = el('accountNewPw').value;
  if (next !== el('accountRepeatPw').value) { fail('Those two new passwords are different.'); return; }
  if (next === current) { fail('Choose a different password from the one you have now.'); return; }

  const btn = el('accountPasswordBtn');
  btn.disabled = true; btn.textContent = 'Changing…';
  try {
    const res = await myRequest('/api/auth/password', {
      json: { current_password: current, new_password: next },
    });
    if (res.status === 401) { fail('Your current password is not right.'); el('accountCurrentPw').select(); return; }
    if (res.status === 429) { fail('Too many attempts. Try again in a few minutes.'); return; }
    if (!res.ok) { fail(res.body.error || 'Could not change your password.'); return; }

    currentUser = { ...currentUser, must_change_password: false };
    renderAccountControl();
    el('accountMustChange').classList.add('hidden');
    el('accountPasswordForm').reset();
    showToast('Password changed', { detail: 'Every other device has been signed out.' });
    await renderSessions();
  } finally {
    btn.disabled = false; btn.textContent = 'Change password';
  }
});

el('closeAccountBtn')?.addEventListener('click', closeAccount);
el('accountOverlay')?.addEventListener('click', e => { if (e.target.id === 'accountOverlay') closeAccount(); });
el('accountBannerBtn')?.addEventListener('click', () => openAccount({ focusPassword: true }));
