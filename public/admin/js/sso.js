// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: single sign-on settings. */

// ─── Single sign-on ───────────────────────────────────────────────────────────

/**
 * The single sign-on panel. Everything is saved together with one button:
 * turning it on checks the provider, and a half-entered configuration saved
 * field by field would be checked before it was finished.
 */
let ssoSecretSet = false;

function describeSso(s) {
  const desc = document.getElementById('ssoStatusDesc');
  desc.textContent = s.enabled
    ? `On. The sign-in page offers "${s.label || s.default_label}"${s.sso_only ? ', and nothing else' : ''}.`
    : 'Off. Turning it on checks that the provider answers.';
}

async function loadSsoSettings() {
  document.getElementById('ssoRedirectUri').value = `${location.origin}/api/auth/oidc/callback`;
  document.getElementById('ssoError').classList.add('hidden');
  let s;
  try {
    const res = await sendAuthRequest('/api/settings/oidc');
    if (!res.ok) throw new Error();
    s = await res.json();
  } catch {
    showToast('Could not load the single sign-on settings', 'error');
    return;
  }
  document.getElementById('ssoIssuer').value   = s.issuer || '';
  document.getElementById('ssoClientId').value = s.client_id || '';
  document.getElementById('ssoLabel').value    = s.label || '';
  document.getElementById('ssoLabel').placeholder = s.default_label;
  document.getElementById('ssoAutoCreateToggle').checked  = !!s.auto_create;
  document.getElementById('ssoLinkByEmailToggle').checked = !!s.link_by_email;
  document.getElementById('ssoEnabledToggle').checked     = !!s.enabled;
  document.getElementById('ssoAdminGroup').value          = s.admin_group || '';
  document.getElementById('ssoOnlyToggle').checked        = !!s.sso_only;
  setSsoSecretState(s.client_secret_set);
  describeSso(s);
}

function setSsoSecretState(isSet) {
  ssoSecretSet = !!isSet;
  const input = document.getElementById('ssoClientSecret');
  input.value = '';
  input.placeholder = ssoSecretSet ? 'Saved — type to replace' : 'None';
  document.getElementById('removeSsoSecretBtn').classList.toggle('hidden', !ssoSecretSet);
}

async function saveSso(extra = {}) {
  const btn   = document.getElementById('saveSsoBtn');
  const error = document.getElementById('ssoError');
  error.classList.add('hidden');

  const body = {
    issuer:        document.getElementById('ssoIssuer').value.trim(),
    client_id:     document.getElementById('ssoClientId').value.trim(),
    label:         document.getElementById('ssoLabel').value.trim(),
    auto_create:   document.getElementById('ssoAutoCreateToggle').checked,
    link_by_email: document.getElementById('ssoLinkByEmailToggle').checked,
    enabled:       document.getElementById('ssoEnabledToggle').checked,
    admin_group:   document.getElementById('ssoAdminGroup').value.trim(),
    sso_only:      document.getElementById('ssoOnlyToggle').checked,
    ...extra,
  };
  const secret = document.getElementById('ssoClientSecret').value;
  if (secret && body.client_secret === undefined) body.client_secret = secret;

  btn.disabled = true; btn.textContent = body.enabled ? 'Checking…' : 'Saving…';
  try {
    const res  = await sendAuthRequest('/api/settings/oidc', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.textContent = data.error || 'Could not save the single sign-on settings.';
      error.classList.remove('hidden');
      return;
    }
    setSsoSecretState(data.client_secret_set);
    document.getElementById('ssoOnlyToggle').checked = !!data.sso_only;
    describeSso(data);
    showToast(data.enabled ? 'Single sign-on is on' : 'Single sign-on settings saved');
  } catch {
    error.textContent = 'Could not reach the server.';
    error.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

document.getElementById('saveSsoBtn').addEventListener('click', () => saveSso());
document.getElementById('removeSsoSecretBtn').addEventListener('click', () => saveSso({ client_secret: null }));
document.getElementById('copySsoRedirectBtn').addEventListener('click', async () => {
  const value = document.getElementById('ssoRedirectUri').value;
  try {
    await navigator.clipboard.writeText(value);
    showToast('Redirect URI copied');
  } catch {
    document.getElementById('ssoRedirectUri').select();
  }
});
