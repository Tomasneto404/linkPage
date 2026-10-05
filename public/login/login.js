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
  try {
    const settings = await fetch('/api/settings').then(r => r.json());
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
