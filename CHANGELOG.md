# Changelog

Source of truth for both the in-app changelog (Admin → sidebar → Changelog) and
the GitHub release notes: the release workflow lifts the section matching the
pushed tag out of this file. Newest release first; the top section must match
`version` in package.json.

## v1.0.4

### Link requests from the public page
Visitors can propose links (name, URL, description, icon, target group and section), optionally behind their own password. Requests land in a review queue with a pending badge; approving one opens the Add-Link form already filled in.

### Duplicate detection on requests
A request whose URL already exists is flagged with an "Already added" chip that opens the existing link. Matching ignores http/https, `www.`, trailing slashes and #fragments. Approving offers to add that link to the requested group instead of creating a second copy.

### Click analytics dashboard
A dedicated analytics view over any period: totals, unique visitors, busiest days and hours, top links and top IPs — beyond the per-link stats that were already there.

### IP attribution tags
Give a known IP a human-readable name once, and it shows up wherever that IP appears — click stats, the audit log, and link requests.

### Themes & appearance
Pick an accent colour (with optional dark-mode brightening and a glow), choose light and dark palette variants, and set which theme new visitors land on.

### Scrollable group tabs
When there are more groups than fit the bar, the public tab strip becomes a horizontal scroller driven by the mouse wheel, the trackpad, touch, or the two arrows on its faded edges. Each arrow retracts at the end it reaches, and the active tab's glow is no longer clipped into a rectangle. Turn on Looping Group Tabs and the strip wraps around endlessly instead of stopping at the last group.

### Public Page settings tab
Everything visitors see now lives in one place: default group, phone navbar position, group-coloured tabs and looping group tabs. Themes / Design keeps the settings that apply to both the public page and the admin.

### API test suite
209 tests over the real Express app — one file per resource, driven over HTTP against a throwaway database, with no dev dependencies to install. CI runs them on every push and pull request, and a red suite blocks the Docker image from shipping.

### Hardened container
The server process now runs as an unprivileged user instead of root, and the image ships a Docker health check. The entrypoint takes ownership of the data volume before dropping privileges, so existing installs and fresh hosts both come up with no manual `chown`.

### Changelog as a single source
This file drives the in-app changelog, the GitHub release notes and the version guard in CI, so a release only needs the version bumped in package.json and a section added here.

### Fixes
The "IP Attribution" settings tab was spelled "IP Atribution".

### Custom header title & icon
The site title now shows in the page header, next to an icon you choose from the library, the stock icon set, or your own upload. Both are hidden automatically while a light/dark logo is set, since the logo replaces the whole title block.

### Mobile navigation position
Move the group tabs to the bottom of the screen on phones — easier to reach one-handed — or keep them at the top.

### Collapsible groups in the admin
Fold groups and sections in the sidebar to keep a long list manageable.

### Hidden starter link on a fresh install
A brand-new install comes with one hidden "Buy me a coffee" link — visible here in the admin, never on the public page. Its icon is fetched on first boot, with a built-in fallback for offline installs. Delete it and it stays deleted.

### Developer footer toggle
A small credit line from the author, shown on both pages and switchable off in Settings → Branding.

### Reorganised codebase & AGPL licensing
The server was split from two large files into routes, controllers, models, services, middleware and config — easier to read and to contribute to. The project is now AGPL-3.0-or-later with an open-core `ee/` directory, plus CONTRIBUTING and CLA documents.

## v1.0.3

### In-place file editor
Edit the contents of attached text files (HTML, XML, JSON, TXT, CSV, MD…) right in the admin — with an expand view, line numbers, language-aware syntax highlighting, a Ctrl/Cmd+F find bar, and Ctrl/Cmd+S to save. Changes are live on the public page immediately.

### Stock icon picker + colours
Pick from a built-in set of line icons and choose a colour, instead of uploading an image. File-backed links also get a tidy file-type icon, and links with no icon fall back to the Settings favicon.

### Icon library: export, import & bulk delete
Export the whole icon library as a single file and import it elsewhere (idempotent). Multi-select icons (shift-click ranges) to delete in bulk. The Settings favicon now appears in the library for reuse.

### Admin audit log
Every admin change and every link click is recorded with the entity's name, time, IP and device. Live auto-refresh, search and type filters, and CSV/JSON export — under Settings → Security → View Log.

### Subsections
Sections can now contain subsections (one level). Add and drag-reorder them in the sidebar; the public page renders the nesting, and the link form lets you drop a link straight into a subsection.

### Smarter bulk editing
Shift-click to select ranges of links, "Select all", Esc to deselect, and move the selection into a specific group section/subsection. You can also drag a link card onto any group, section, or subsection in the sidebar.

### Multi-keyword search
The public search now pins keywords as chips (press Enter), combines them with AND, and matches link names, URLs, groups, sections and subsections.

### Copy link button
Each public card has a copy-link button with a toast confirmation — copies the destination URL, or a tracked redirect link for file attachments.

### Per-group unlock behaviour
Password-protected groups can either auto-lock after 30 seconds (kiosk-safe) or stay unlocked for the whole browser session — chosen per group.

### Redesigned admin cards
A cleaner, premium link card: icon + title header, description, tags, and a footer showing views and date with the action buttons revealing on hover.

### In-app update checker
Settings → About has a "Check for updates" button showing the current build, the latest GitHub release, and its notes. A pulsing dot on the Changelog pill flags when an update is available.

### Versioned database migrations
The DB layer runs transactional, version-tracked migrations on every startup and logs what changed, so upgrading from any past version is safe and automatic.

### Faster saves & polish
Favicon fetching no longer blocks saving a link (it loads in the background and appears live). Plus a scrollable Settings modal and a fix for icons bleeding between consecutive edits.

## v1.0.2

### Reusable icon library
Every uploaded icon goes into a shared library you can browse, search, and re-use across links — no need to upload the same image twice. An optional setting also saves auto-fetched favicons to the library for the same convenience.

### Smarter favicon fetching (intranet-friendly)
Replaced the Google-only fetch with a three-tier strategy: parse the page for `<link rel="icon">`, then try `/favicon.ico`, then fall back to Google. Intranet URLs now resolve correctly. The live preview while typing uses the same fetcher.

### Live updates on the public page
The public page subscribes to a Server-Sent Events channel and fade-refreshes within a fraction of a second whenever an admin adds, edits, reorders, or deletes anything.

### Drag-to-reorder sections
Sections inside a group now have a drag handle in the sidebar; drop one onto another to reorder. The new order persists and is reflected on the public page immediately.

### Remember last viewed group
Returning visitors stay on the tab they were viewing across refreshes. The admin-configured default group only applies to brand-new (uncached) visitors.

### HTML / XML / JSON attachments + 100 MB cap
The attachment whitelist now accepts `.htm`, `.html`, `.xml`, and `.json` files. The per-attachment size limit was raised from 25 MB to 100 MB.

### Logo links to the public page
Clicking the brand logo — on either the admin or public page — navigates to the public home.

## v1.0.1

### Sections inside groups
Groups can now contain sections. Add, rename, and delete them from the sidebar; assign a link to a specific section via the per-group picker in the link modal. Cards in a group view split under section headings.

### File attachments
A link can point to an uploaded file (PDF, Office docs, archives, images, text) instead of a URL. The link modal has a URL / File toggle; click-tracking still records every visit.

### Hide links from the public page
Each card has a new eye-toggle that hides a link from the public page and its `/r/:id` redirect — admins keep full access. Reversible with one click.

### Custom group colors
The group colour palette now includes a "+" swatch that opens the native colour picker, so groups can use any hex colour beyond the ten presets.

### Mobile-friendly UI
Phones get a slide-over sidebar, full-width modal sheets, larger tap targets, and a compact header that drops power-user controls. The public page gets responsive padding, search, and card layout.

## v1.0.0

### Multiple groups per link
A link can now belong to several groups at once. The link form has a multi-select group picker, and cards show one coloured badge per group.

### Password-protected groups
Groups can be locked with a password. Protected groups show a lock icon on the public page; visitors must enter the password to view their links. Unlocks automatically expire after 30 seconds.
