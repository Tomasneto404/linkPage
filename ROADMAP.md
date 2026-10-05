# Roadmap

What is planned, in the order it is being done. Items are ticked as they land
on `feature/accounts`. Anything deliberately *not* being done says why.

## 1 — Account features that have an API but no screen

Gaps left by the accounts work: the server does all of these, nothing in the
interface reaches them.

- [ ] **Personal sections.** A member cannot create, rename or delete sections
      from the page; the composer only offers sections that already exist.
- [ ] **Reordering personal links and groups.** Only favourites can be dragged.
- [ ] **Storage in the admin panel.** Per-account and instance-wide quotas can
      only be set through the API, and the Accounts tab does not show how much
      each member is using.
- [ ] **Who did it, in the audit log.** Every entry records its actor; the
      panel does not show it.
- [ ] **Invite expiry.** 1–30 days can be chosen through the API only.

## 2 — Security

- [ ] **Attachments in `/uploads` stay public in members-only mode.** Anyone
      with an exact file address can still fetch it. Serve shared links'
      attachments through a gated route; keep only what the sign-in page needs
      (logo, favicon, wallpaper) public.
- [ ] **Login throttling is per address only.** An attack spread across many
      addresses against one account gets through. Add a per-account limit.
- [ ] **Login throttling is forgotten on restart.** The counters live in
      memory. Keep the sign-in ones in the database.
- [ ] **Three async handlers are not wrapped.** `linksController.create`,
      `linksController.update`, `versionController.getVersion` — a failure
      leaves the request hanging instead of answering with an error.

## 3 — Operations

- [ ] **Two lockfiles that can drift.** Docker and CI build with npm and
      `package-lock.json`; local development may use pnpm. They have already
      diverged once — `swagger-ui-dist` was missing from `pnpm-lock.yaml` and
      `pnpm run dev` broke. Keep both, and add a test that fails when a
      dependency is missing from either.
- [ ] **Node version.** `engines` asks for Node 24, but everything runs and
      passes on 22.13+, where `node:sqlite` needs no flag. Say so, so local
      development on 22 stops warning on every start. Docker and CI stay on 24.
- [ ] **Version and changelog.** The accounts work is a minor release: 1.1.0,
      with a CHANGELOG section. *Publishing it is left to the maintainer.*

## 4 — Single sign-on

- [ ] **Authentik, through OpenID Connect.** Authorization code flow with
      PKCE; ID token signature, issuer, audience, expiry and nonce all checked;
      accounts linked by the provider's subject, optionally created on first
      sign-in. Generic OIDC underneath, so any compliant provider works.

## Later

Not started; written down so they are not lost.

- **Reordering favourites on touch screens.** HTML drag and drop does not exist
  on touch; needs a pointer-events implementation or move-up/down controls.
- **Exporting and importing personal links**, as the administrator can for
  shared ones.
- **Password reset by email**, with SMTP as an optional setting. Today a reset
  is a link an administrator issues.
- **Splitting the two big scripts.** `public/app.js` is ~3,300 lines and
  `public/admin/admin.js` ~6,400; both want to be modules.
- **Browser tests.** Every browser check during the accounts work was done by
  hand: sign-in, the composer, favourites, members-only. They deserve automated
  coverage.
