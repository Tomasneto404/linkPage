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

/**
 * Resolves a requested landing place against this origin, or refuses it.
 *
 * Parsed rather than pattern-matched, because a regex over the raw string
 * checks something the browser will not: before resolving a URL a browser
 * normalises backslashes to slashes, strips tabs and newlines, and decodes
 * escapes. "/\\evil.example" looks like a path and resolves to another origin;
 * so does "/\tevil.example" with a real tab in it. Letting the URL parser
 * answer "what origin is this actually?" is the only check that matches what
 * location.assign will do with the same string.
 *
 * Returns a fully-resolved absolute URL rather than a path, so that what is
 * handed to location.assign is exactly the string whose origin was checked.
 * Returning a path re-opens the question: "/..//evil.example" resolves to a
 * same-origin URL whose *pathname* is "//evil.example", and handing that back
 * means the browser resolves it a second time, protocol-relative, straight off
 * this origin. One parse, one check, one string.
 *
 * Takes its inputs rather than reading them from the page, so the test can
 * exercise the real function.
 */
function safeDestination(next, origin) {
  const home = `${origin}/`;
  if (typeof next !== 'string' || next === '') return home;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.href : home;
  } catch {
    return home;
  }
}

/** Where to land after signing in. A path on this site, or the front page. */
function destination() {
  return safeDestination(params.get('next'), location.origin);
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
  // The instance's own look — palette, accent, wallpaper and its fog, and how
  // solid the bars are — so signing in happens on the same page, visibly, as
  // the one it leads back to.
  let settings = {};
  try {
    settings = await fetch('/api/settings').then(r => r.json());
    window.LinkPageTheme?.applyAppearance(settings);
    if (settings.site_title) document.title = `Sign in · ${settings.site_title}`;
    // Members-only: the links are behind this page, so "back to them" would
    // only bring a stranger straight back here.
    if (settings.require_login) document.querySelector('.gate-back')?.classList.add('hidden');
  } catch { /* the page works perfectly well with the stock palette */ }

  // Already signed in and nothing to redeem: there is nothing to do here.
  if (!token) {
    try {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.json());
      if (me.authenticated) { location.replace(destination()); return; }
    } catch { /* carry on and show the form */ }

    // An instance that sends mail offers to send the link; one that does not
    // says who to ask instead.
    el(settings.password_reset_email ? 'forgotLink' : 'forgotNote').classList.remove('hidden');
    await showProviders();
    showSsoError();
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
    //
    // Removed rather than hidden: the stack rounds its first and last rows, and
    // CSS counts a display:none row as a child like any other — hiding these
    // would put the top corners on a row nobody can see.
    el('redeemEmailGroup').remove();
    el('redeemNameGroup').remove();
    el('redeemPassword').placeholder = 'New password';
    el('redeemPassword').setAttribute('aria-label', 'New password');
    el('redeemBtn').textContent = 'Set password';
    el('redeemPassword').focus();
  }
}

/** Wires a show/hide button to the field it sits in. */
function wireReveal(buttonId, inputId) {
  const button = el(buttonId);
  const input  = el(inputId);
  if (!button || !input) return;

  button.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    input.focus();
  });
}
wireReveal('signInReveal', 'signInPassword');
wireReveal('redeemReveal', 'redeemPassword');

// ─── Single sign-on ───────────────────────────────────────────────────────────

/**
 * A button for each provider the server lists with somewhere to send the
 * browser. Links, not buttons with handlers: the trip is a plain navigation,
 * and the server decides everything about it.
 */
async function showProviders() {
  let providers = [];
  try {
    providers = (await fetch('/api/auth/providers').then(r => r.json())).providers || [];
  } catch { return; }

  const external = providers.filter(p => p.url);
  if (external.length === 0) return;

  const next = params.get('next');
  const box  = el('providerButtons');
  for (const provider of external) {
    const a = document.createElement('a');
    a.className = 'btn btn-ghost gate-submit gate-provider';
    a.textContent = provider.label;
    a.href = next ? `${provider.url}?next=${encodeURIComponent(next)}` : provider.url;
    box.append(a);
  }
  el('providerSection').classList.remove('hidden');
}

// What the server's sso_error codes mean, said to the person who can act on it.
// The detail of what went wrong is in the audit log and the server console.
const SSO_ERRORS = {
  disabled:         'Single sign-on is not set up here.',
  unavailable:      'The sign-in provider could not be reached. Try again, or use your password.',
  expired:          'That sign-in took too long, or started in another browser. Try again.',
  denied:           'Sign-in was cancelled at the provider.',
  no_account:       'There is no account here for you yet. Ask an administrator for an invite.',
  account_disabled: 'This account has been disabled.',
  email_taken:      'An account with your address already exists. Sign in with its password, then connect single sign-on from Your account.',
  no_email:         'The provider did not share your email address, which an account here needs.',
  already_linked:   'That sign-in is already connected to a different account here.',
};

function showSsoError() {
  const code = params.get('sso_error');
  if (!code) return;
  showError(el('signInError'), SSO_ERRORS[code]
    || 'Single sign-on did not work. Try again, or ask an administrator to check the server log.');
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

// ─── Asking for a reset link ──────────────────────────────────────────────────

/** Swaps the sign-in form for the "email me a link" one, and back. */
function showForgot(show) {
  for (const id of ['signInForm', 'forgotLink', 'providerSection']) {
    if (show) el(id).dataset.wasHidden = el(id).classList.contains('hidden') ? '1' : '';
    el(id).classList.toggle('hidden', show || el(id).dataset.wasHidden === '1');
  }
  el('forgotForm').classList.toggle('hidden', !show);
  el('gateTitle').textContent = show ? 'Reset your password' : 'Sign in';
  el('gateSubtitle').textContent = show
    ? 'We will email you a link to choose a new one.'
    : 'Sign in to manage this page.';
  if (show) {
    el('forgotEmail').value = el('signInEmail').value.trim();
    el('forgotSent').classList.add('hidden');
    el('forgotError').classList.add('hidden');
    el('forgotBtn').classList.remove('hidden');
    el('forgotEmail').focus();
  } else {
    el('signInEmail').focus();
  }
}

el('forgotLink').addEventListener('click', () => showForgot(true));
el('forgotBack').addEventListener('click', () => showForgot(false));

el('forgotForm').addEventListener('submit', async e => {
  e.preventDefault();
  const error = el('forgotError');
  error.classList.add('hidden');

  await whileSubmitting(el('forgotBtn'), 'Sending…', async () => {
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: el('forgotEmail').value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(error, res.status === 429
          ? 'Too many requests. Try again in a few minutes.'
          : data.error || 'That did not work. Try again.');
        return;
      }
      // The same words whether or not there is an account: the server answers
      // alike on purpose, and so does this page.
      const sent = el('forgotSent');
      sent.textContent = `If there is an account for ${el('forgotEmail').value.trim()}, a link is on its way. `
                       + `It works once, for ${data.minutes || 60} minutes. Check your spam folder if it does not arrive.`;
      sent.classList.remove('hidden');
      el('forgotBtn').classList.add('hidden');
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
    // Present only in invite mode — a reset knows whose account it is.
    if (el('redeemEmail')) {
      body.email = el('redeemEmail').value.trim();
      body.display_name = el('redeemName')?.value.trim() || '';
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
