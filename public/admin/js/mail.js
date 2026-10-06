// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: email settings. */

// ─── Email ────────────────────────────────────────────────────────────────────

/** The email panel. Saved with one button, like single sign-on, for the same reason. */
async function loadMailSettings() {
  document.getElementById('mailError').classList.add('hidden');
  let m;
  try {
    const res = await sendAuthRequest('/api/settings/mail');
    if (!res.ok) throw new Error();
    m = await res.json();
  } catch {
    showToast('Could not load the email settings', 'error');
    return;
  }
  document.getElementById('mailSiteUrl').value  = m.site_url || '';
  document.getElementById('mailSiteUrl').placeholder = location.origin;
  document.getElementById('mailHost').value     = m.host || '';
  document.getElementById('mailPort').value     = m.port || 587;
  document.getElementById('mailSecurity').value = m.security || 'starttls';
  document.getElementById('mailUser').value     = m.user || '';
  document.getElementById('mailFrom').value     = m.from || '';
  document.getElementById('mailResetToggle').checked = !!m.password_reset;
  setMailPasswordState(m.password_set);
}

function setMailPasswordState(isSet) {
  const input = document.getElementById('mailPassword');
  input.value = '';
  input.placeholder = isSet ? 'Saved — type to replace' : 'None';
  document.getElementById('removeMailPasswordBtn').classList.toggle('hidden', !isSet);
}

function showMailError(message) {
  const box = document.getElementById('mailError');
  box.textContent = message;
  box.classList.toggle('hidden', !message);
}

async function saveMail(extra = {}) {
  showMailError('');
  const body = {
    site_url:       document.getElementById('mailSiteUrl').value.trim(),
    host:           document.getElementById('mailHost').value.trim(),
    port:           Number(document.getElementById('mailPort').value) || 587,
    security:       document.getElementById('mailSecurity').value,
    user:           document.getElementById('mailUser').value.trim(),
    from:           document.getElementById('mailFrom').value.trim(),
    password_reset: document.getElementById('mailResetToggle').checked,
    ...extra,
  };
  const password = document.getElementById('mailPassword').value;
  if (password && body.password === undefined) body.password = password;

  const btn = document.getElementById('saveMailBtn');
  btn.disabled = true;
  try {
    const res  = await sendAuthRequest('/api/settings/mail', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showMailError(data.error || 'Could not save the email settings.'); return false; }
    setMailPasswordState(data.password_set);
    showToast('Email settings saved');
    return true;
  } catch {
    showMailError('Could not reach the server.');
    return false;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('saveMailBtn').addEventListener('click', () => saveMail());
document.getElementById('removeMailPasswordBtn').addEventListener('click', () => saveMail({ password: null }));
document.getElementById('mailUseOriginBtn').addEventListener('click', () => {
  document.getElementById('mailSiteUrl').value = location.origin;
});

// Saves first, so the test is of what is on the screen rather than what was
// stored before.
document.getElementById('mailTestBtn').addEventListener('click', async () => {
  const btn = document.getElementById('mailTestBtn');
  if (!await saveMail()) return;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res  = await sendAuthRequest('/api/settings/mail/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showMailError(data.error || 'The test did not send.'); return; }
    showToast(`Test sent to ${data.to}`);
  } catch {
    showMailError('Could not reach the server.');
  } finally {
    btn.disabled = false; btn.textContent = 'Send me a test';
  }
});
