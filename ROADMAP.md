# Roadmap

What is planned, in the order it is being done. Items are ticked as they land
on `feature/accounts`. Anything deliberately *not* being done says why.

## 1 — Account features that have an API but no screen

Gaps left by the accounts work: the server does all of these, nothing in the
interface reaches them.

- [x] **Personal sections.** A member cannot create, rename or delete sections
      from the page; the composer only offers sections that already exist.
- [x] **Reordering personal links and groups.** Only favourites can be dragged.
- [x] **Storage in the admin panel.** Per-account and instance-wide quotas can
      only be set through the API, and the Accounts tab does not show how much
      each member is using.
- [x] **Who did it, in the audit log.** Every entry records its actor; the
      panel does not show it.
- [x] **Invite expiry.** 1–30 days can be chosen through the API only.

## 2 — Security

- [x] **Attachments in `/uploads` stay public in members-only mode.** Anyone
      with an exact file address can still fetch it. Serve shared links'
      attachments through a gated route; keep only what the sign-in page needs
      (logo, favicon, wallpaper) public.
- [x] **Login throttling is per address only.** An attack spread across many
      addresses against one account gets through. Add a per-account limit.
      Twenty failures per account per fifteen minutes, counted whether or not
      the account exists. The accepted cost: a stranger can hold an account's
      password sign-in shut until the window lapses.
- [x] **Login throttling is forgotten on restart.** The counters live in
      memory. Keep the sign-in ones in the database. Every failure-counting
      limiter now does; the click and request limiters stay in memory.
- [x] **Async handlers that were not wrapped.** Four, not the three first
      counted: `linksController.create` and `update`, `versionController.getVersion`
      and `iconsController.faviconPreview` — a failure left the request hanging
      instead of answering with an error. A test now walks the live router and
      fails on any unwrapped async handler.

## 3 — Operations

- [x] **Two lockfiles that can drift.** Docker and CI build with npm and
      `package-lock.json`; local development may use pnpm. They have already
      diverged once — `swagger-ui-dist` was missing from `pnpm-lock.yaml` and
      `pnpm run dev` broke. Keep both, and add a test that fails when a
      dependency is missing from either. `tests/lockfiles.test.js` also checks
      each declared range and that the resolved versions sit inside it.
- [x] **Node version.** `engines` asks for Node 24, but everything runs and
      passes on 22.13+, where `node:sqlite` needs no flag. Say so, so local
      development on 22 stops warning on every start. Docker and CI stay on 24.
- [x] **Version and changelog.** The accounts work is a minor release: 1.1.0,
      with a CHANGELOG section. *Publishing it is left to the maintainer.*

## 4 — Single sign-on

- [x] **Authentik, through OpenID Connect.** Authorization code flow with
      PKCE; ID token signature, issuer, audience, expiry and nonce all checked;
      accounts linked by the provider's subject, optionally created on first
      sign-in. Generic OIDC underneath, so any compliant provider works.
      Also: matching existing accounts by a *verified* address (optional),
      members connecting their own account, and a fake provider in the tests
      that every check is proven against.

## 5 — From the later list

- [x] **Reordering on touch screens.** HTML drag and drop does not exist on
      touch. Press and hold a favourite or one of your own links, then slide
      it; the page scrolls near the edges, and a finger that moves before the
      hold completes is still a scroll.
- [x] **Exporting and importing personal links.** From *Your account*: groups,
      sections, links and favourites as JSON. Imports merge by name and
      address, so a repeat adds nothing; files and uploaded icons are not
      carried, and favourites are only restored for links the importer can see.
- [x] **Password reset by email.** SMTP in Settings → Email, off by default.
      One-hour links built from a configured page address, never the request;
      the same answer whether or not the account exists; three emails an hour
      per account at most; a link that failed to send is revoked.
- [x] **Roles from the provider.** An administrator group, synced at every
      single sign-on in both directions; never demotes the last administrator.
- [x] **Single sign-on only.** Hides the password form and refuses passwords;
      the admin token is untouched. Switches itself off with single sign-on.
- [x] **Browser tests.** `npm run test:browser`, in headless Chromium through
      playwright-core: sign-in, the admin gate, the composer, favourites with a
      touch reorder, members-only, single sign-on and an emailed reset. They
      found a real bug on their first run — a live update re-rendering the grid
      mid-drag took the card out of the person's hand — now fixed. In CI too.
- [x] **Splitting the two big scripts.** `public/app.js` (3,700 lines) is now
      ten files in `public/js/`, and `public/admin/admin.js` (6,700) eighteen in
      `public/admin/js/`, cut along their existing sections and loaded in their
      original order. Three functions moved to `core.js` because they are
      called while the page is still loading. A test checks every file is
      wired in, and a browser test that every page loads without a script error.

## 6 — Asked for while testing

- [x] **"+ Add a link" card inside a group**, for anyone who may add there.
- [x] **Guest contributions.** A cookie-identified browser gets its own groups
      and links, with an admin setting (off / members / anyone), a retention
      policy, and a Contributions tab in the panel for moderation.
- [x] **The file editor's caret.** Off the text by up to a word on desktop and
      lines on a phone; every layer now shares one set of metrics.
- [x] **A + after the group tabs**, for members to make a group in one step.
- [x] **One sign-in.** A single button; administrators land in the panel.
- [x] **Group admins**, so more people can add links to a shared group.

## Later

Not started; written down so they are not lost.

- **ES modules.** The two scripts are now split by feature (see below) but still
  share one global scope. Real `import`/`export` would make each file's
  dependencies explicit, at the cost of rewiring the shared state; worth doing
  once the browser tests cover more of the admin panel.
