// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The sign-in page.
 *
 * Three modes, decided by the query string:
 *
 *   /login/                 sign in
 *   /login/?invite=<token>  accept an invite: pick an address and a password
 *   /login/?reset=<token>   finish a reset: pick a new password
 *
 * The last two are the same form with different fields showing, because they
 * are the same request to the same endpoint — the server works out which from
 * the token, and this page only decides what to ask for.
 *
 * `next` carries where to go afterwards. It is only ever honoured as a path on
 * this origin: an absolute URL in a query parameter is how a sign-in page gets
 * turned into an open redirect.
 */

const params = new URLSearchParams(location.search);
const inviteToken = params.get('invite');
const resetToken  = params.get('reset');
const token = inviteToken || resetToken;

const el = id => document.getElementById(id);

/** Where to land after signing in. A path on this site, or the front page. */
function destination() {
  const next = params.get('next');
  // Must start with a single slash: "//evil.example" is a protocol-relative URL
  // that leaves this origin, and "https://…" plainly does.
  return typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/';
}

function showError(box, message) {
  box.textContent = message;
  box.classList.remove('hidden');
}

/** Runs a submit handler with the button disabled and a label that says so. */
async function whileSubmitting(btn, label, work) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { await work(); } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ─── Picking a mode ───────────────────────────────────────────────────────────

async function start() {
  // The instance's own palette, so this page looks like the rest of it.
  try {
    const settings = await fetch('/api/settings').then(r => r.json());
    window.LinkPageTheme?.applyVariants({
      light: settings.theme_light_variant,
      dark:  settings.theme_dark_variant,
    });
    if (settings.site_title) document.title = `Sign in · ${settings.site_title}`;
  } catch { /* the page works perfectly well with the stock palette */ }

  // Already signed in and nothing to redeem: there is nothing to do here.
  if (!token) {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json());
      if (me.authenticated) { location.replace(destination()); return; }
    } catch { /* carry on and show the form */ }

    el('forgotNote').classList.remove('hidden');
    el('signInEmail').focus();
    return;
  }

  await prepareRedemption();
}

/**
 * Checks the link before asking anybody to type anything.
 *
 * Finding out the link is dead *after* choosing a password is a small cruelty
 * that costs one request to avoid.
 */
async function prepareRedemption() {
  el('signInForm').classList.add('hidden');

  let info;
  try {
    const res = await fetch(`/api/tokens/${encodeURIComponent(token)}`);
    info = res.ok ? await res.json() : null;
  } catch { info = null; }

  if (!info?.valid) {
    el('gateTitle').textContent = 'This link has expired';
    el('gateSubtitle').classList.add('hidden');
    el('badLink').classList.remove('hidden');
    return;
  }

  const isInvite = info.kind === 'invite';
  el('redeemForm').classList.remove('hidden');

  if (isInvite) {
    el('gateTitle').textContent = 'Create your account';
    el('gateSubtitle').textContent = 'Pick an address and a password to finish setting up.';
    el('redeemEmail').required = true;
    el('redeemEmail').focus();
  } else {
    el('gateTitle').textContent = 'Choose a new password';
    el('gateSubtitle').textContent = info.email
      ? `For ${info.email}.`
      : 'For your account.';
    // Nothing to ask: the token already says which account this is.
    el('redeemEmailGroup').classList.add('hidden');
    el('redeemNameGroup').classList.add('hidden');
    el('redeemBtn').textContent = 'Set password';
    el('redeemPassword').focus();
  }
}

// ─── Signing in ───────────────────────────────────────────────────────────────

el('signInForm').addEventListener('submit', async e => {
  e.preventDefault();
  const error = el('signInError');
  error.classList.add('hidden');

  await whileSubmitting(el('signInBtn'), 'Signing in…', async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email:    el('signInEmail').value.trim(),
          password: el('signInPassword').value,
          remember: el('rememberMe').checked,
        }),
      });

      if (res.ok) { location.assign(destination()); return; }

      showError(error, res.status === 429
        ? 'Too many attempts. Try again in a few minutes.'
        : 'Wrong email or password.');
      el('signInPassword').select();
    } catch {
      showError(error, 'Could not reach the server.');
    }
  });
});

// ─── Accepting an invite, or finishing a reset ────────────────────────────────

el('redeemForm').addEventListener('submit', async e => {
  e.preventDefault();
  const error = el('redeemError');
  error.classList.add('hidden');

  const password = el('redeemPassword').value;
  if (password !== el('redeemConfirm').value) {
    showError(error, 'Those two passwords are different.');
    el('redeemConfirm').select();
    return;
  }

  await whileSubmitting(el('redeemBtn'), 'Saving…', async () => {
    const body = { password };
    if (!el('redeemEmailGroup').classList.contains('hidden')) {
      body.email = el('redeemEmail').value.trim();
      body.display_name = el('redeemName').value.trim();
    }

    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(token)}/redeem`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body:        JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      // Redemption signs the person in, so there is nowhere else to send them.
      if (res.ok) { location.assign(destination()); return; }

      showError(error, data.error || 'That did not work. The link may have expired.');
    } catch {
      showError(error, 'Could not reach the server.');
    }
  });
});

start();
