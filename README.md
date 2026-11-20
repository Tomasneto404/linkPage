# LinkPage

An Enterprise ready link sharing platform.

A modern, self-hosted WebUI designed for enterprises to centralize and publish internal or external links/URLs for employees, collaborators, and clients.

Instead of scattering important resources across emails, chats, and shared drives, LinkPage provides a single branded landing page (e.g. `linkpage.company.com`) where teams can quickly access everything they need — from internal tools and documentation to public-facing resources.

> **v2.1.0** adds **PostgreSQL with verified SQLite migration**, configurable **RSS, clock, weather, Gotify and Markdown widgets**, direct page arrangement, comparative **analytics**, and **Custom fade** backgrounds with adjustable effect speed. It also refines Settings, Workspace, document editing, sharing and motion. PWA installation, seasonal themes, accounts and single sign-on remain included.

Already using SQLite? Read the [SQLite → PostgreSQL guide](docs/sqlite-to-postgresql.md) before changing engines. To stay on SQLite, read the [2.1.0 upgrade notes](#upgrading-to-210).

---

## Screenshots

Screenshots use a disposable demonstration workspace.

### Public Page

| Light Mode | Dark Mode |
|:---:|:---:|
| ![LinkPage 2.1 public page in light mode](linkPagePrints/linkPage-v210-public-light.png) | ![LinkPage 2.1 public page in dark mode](linkPagePrints/linkPage-v210-public-dark.png) |

The public page greets end users with a clean card grid, sticky group tabs, tag filters, a live search bar and auto-fetched favicons. Sign-in is optional unless enabled by an administrator. When groups overflow, dedicated arrow lanes scroll the tab strip without overlapping the groups; mouse wheel, trackpad and touch work too, with optional endless looping.

---

### Admin Panel

| Light Mode | Dark Mode |
|:---:|:---:|
| ![LinkPage 2.1 admin panel in light mode](linkPagePrints/linkPage-v210-admin-light.png) | ![LinkPage 2.1 admin panel in dark mode](linkPagePrints/linkPage-v210-admin-dark.png) |

Sign in with an administrator account or the recovery admin token. The sidebar lists groups, sections and subsections; the main area offers drag-to-reorder, bulk selection, import/export and per-card analytics. The header adds global search, Workspace and a notification centre.

---

### Search and Workspace

| Search everywhere | Tags and publication dates |
|:---:|:---:|
| ![Global search with actual link icons](linkPagePrints/linkPage-v210-search.png) | ![Workspace link tags and publishing controls](linkPagePrints/linkPage-v210-workspace-library.png) |

Press **⌘K / Ctrl+K** to search links, groups and Markdown contents, with keyboard navigation and each link's own icon. Open **Workspace** in the admin header to organise the shared library and manage access, history, backups and appearances.

| Document history | Complete backups |
|:---:|:---:|
| ![Document version history](linkPagePrints/linkPage-v210-workspace-history.png) | ![Complete backups and automatic schedule](linkPagePrints/linkPage-v210-workspace-backups.png) |

---

### Widgets and direct arrangement

| A group dashboard | Edit a widget on the public page |
|:---:|:---:|
| ![Clocks, RSS, weather forecast and shared Markdown tasks](linkPagePrints/linkPage-v210-widgets.png) | ![Widget editor with saved Markdown source](linkPagePrints/linkPage-v210-widget-editor.png) |

Global administrators can drag whole widgets and resize them with a dashed preview. Group managers edit their own groups’ widget content. RSS, weather and Gotify credentials remain on the server; notes support shared Markdown tasks. Cards reveal their loaded content smoothly and retain their size and order after refresh.

| Settings and theme controls | Custom effects and palette |
|:---:|:---:|
| ![Consistent Settings navigation and aligned dropdowns](linkPagePrints/linkPage-v210-settings-themes.png) | ![Background speed, colour palette and effect preview](linkPagePrints/linkPage-v210-settings-effects.png) |

### Click Analytics

| Per-link stats | Dashboard over any period |
|:---:|:---:|
| ![Per-link click stats](linkPagePrints/linkPage-v210-statistics.png) | ![Analytics dashboard](linkPagePrints/linkPage-v210-analytics.png) |

The dashboard compares periods, filters by group, estimates device and browser usage, highlights unopened links and shows when resources are used. Unique IPs are visitor estimates, not account counts. Charts use UTC and expose their data in a table; CSV exports use the same filters. Per-link details remain available from each admin card.

---

### Audit Log

<p align="center">
  <img src="linkPagePrints/linkPage-v210-audit-log.png" width="560" alt="Admin audit log" />
</p>

Every admin change and every public click lands in the audit log, with the entity name, action id, IP (attribution tag included) and device. It auto-refreshes live, filters by search text and entry type, and exports to CSV or JSON.

---

### Settings

| Branding | Public Page |
|:---:|:---:|
| ![Settings – branding](linkPagePrints/linkPage-v210-settings-branding.png) | ![Settings – public page](linkPagePrints/linkPage-v210-settings-public-page.png) |

Settings are split into tabs: **Branding** (site title, header icon, light/dark logos, favicon, developer footer), **Themes / Design** (accent colour, palette variants, default theme), **Public Page** (default group, phone navbar position, group-coloured tabs, looping group tabs), **Icons** (reusable library), **Public Access** (optional password gate), **Link Requests**, **IP Attribution**, **Security** (one-click admin token rotation) and **About** with an on-demand "Check for updates" button.

---

### Signing in

| One sign-in for everybody | Your account |
|:---:|:---:|
| ![Sign in](linkPagePrints/linkPage-v210-signin-light.png) | ![Your account dialog](linkPagePrints/linkPage-v210-your-account.png) |

Admins and members use the same **Sign in** button on the public page. Members land back on the links; administrators land in the admin panel. The admin token stays as the way back in when nobody can sign in. Each account has its own dialog for passwords, active sessions on other devices, export / import of their own links, and — when an administrator has set it up — a one-click **Connect** button for single sign-on through Authentik or any other OpenID Connect provider.

---

### Group permissions

![Workspace group layouts and member access](linkPagePrints/linkPage-v210-workspace-access.png)

Assign **viewer**, **contributor**, **editor** or **manager** access in **Workspace → Library → Groups & access**. Private groups appear only to assigned members and global administrators. Contributors add and edit their own links, editors edit group links, and managers also manage the group's name, colour, layout and members from the public page. Existing group admins keep manager access. Global administrators can edit all visible shared links directly on the public page, including links without a group.

---

### A page of your own

![Member view with a personal group open and the "+ Add a link" card](linkPagePrints/linkPage-v210-member-view.png)

A signed-in member keeps their own private groups and links beside the shared ones, with the **+** at the end of the tab bar to make a new group in one step. Favourites gather starred shared links; everything a member creates is theirs alone, within an administrator-configured storage allowance.

---

### Guest contributions

| On the public page | Admin moderation |
|:---:|:---:|
| ![Guest add-link dialog](linkPagePrints/linkPage-v210-guest-add.png) | ![Settings → Contributions](linkPagePrints/linkPage-v210-contributions.png) |

An administrator can open the page to anonymous **guest contributions**: a browser identified by its own cookie keeps its own groups and links, visible only in that browser. The admin panel lists every guest with counts and storage, with per-guest **Delete** and **Remove every guest**, and a retention sweep that prunes browsers not seen for N days.

---

### Single sign-on and email

| Single sign-on | Email |
|:---:|:---:|
| ![Single sign-on settings](linkPagePrints/linkPage-v210-sso.png) | ![Settings → Email](linkPagePrints/linkPage-v210-mail.png) |

Point LinkPage at an **OpenID Connect** provider (Authentik, Keycloak, Google Workspace, Okta…) and the sign-in page offers a one-click button. The flow uses the authorization code grant with PKCE, verifies the ID token's signature, issuer, audience, expiry and nonce, and optionally creates accounts on first sign-in or links by verified email. With an **SMTP** server, the sign-in page offers *Email me a reset link*; links work once, for an hour, and are built from the configured page address so a forged `Host` header cannot redirect a reset.

---

### Season themes

| Christmas | Halloween · Dark |
|:---:|:---:|
| ![Christmas landscape](linkPagePrints/linkPage-v210-season-christmas.png) | ![Halloween landscape in dark mode](linkPagePrints/linkPage-v210-season-halloween.png) |

| Spring | Autumn · Dark |
|:---:|:---:|
| ![Spring landscape](linkPagePrints/linkPage-v210-season-spring.png) | ![Autumn landscape in dark mode](linkPagePrints/linkPage-v210-season-autumn.png) |

Open **Settings → Seasonal Themes** to preview Original, Easter, Halloween, Christmas, Spring, Summer, Autumn or Winter. Refined palettes, soft ambient backgrounds and subtle vector motifs work in Light and Dark while keeping the same controls and card shapes. Custom accents and wallpapers are preserved.

Choose **Minimalist**, **Still image** or **Animated image** for the background. Minimalist preserves the original soft palette and delicate patterns. Each of the seven seasons also has an original landscape; Animated image adds a slow drift. Particle effects are controlled independently. Custom wallpapers take priority. Markdown files use the same active seasonal palette, background and particles in a new tab or in the document modal, with scripts still disabled. Devices requesting reduced motion see a still background.

**Animated atmosphere** adds slow-moving snowflakes for Christmas and Winter, bats with fluttering wings for Halloween, tumbling leaves for Autumn, floating dandelion seeds for Spring, pastel petals for Easter and sun glints for Summer. Effects follow the active calendar theme and appear in the editor preview before saving. They are decorative, never intercept clicks, use fewer particles on phones, pause in background tabs and switch off when the device requests reduced motion. Turn the option off for a still page.

Turn on **Follow a seasonal calendar** to set an annual date range for each theme, choose a time zone and enable only the themes you want. Dates include both endpoints and can span New Year. Earlier rows take priority; use the arrows to move holidays above the seasons. Easter follows Easter Sunday automatically, with configurable days before and after, or can use fixed dates. Outside scheduled dates, the selected theme is the fallback (choose Original for a neutral page). **Try a date** previews the result without changing the live site. **Save changes** applies the complete selection and calendar together. Open public, admin and sign-in pages re-evaluate the calendar every 30 seconds and when returning to the tab.

| Theme preview and background choices | Automatic calendar |
|:---:|:---:|
| ![Seasonal theme editor](linkPagePrints/linkPage-v210-season-editor.png) | ![Annual calendar with theme priorities](linkPagePrints/linkPage-v210-season-calendar.png) |

---

### Markdown reading

![Seasonal Markdown document with reading options and contents index](linkPagePrints/linkPage-v210-markdown.png)

Markdown documents inherit the active season. Open reading options to find text, adjust font size and width, or enter focus mode; the contents index jumps between headings. The same controls work in a separate tab or the document modal, with document scripts disabled.

Choose **Write text** when adding a link to create Markdown or another text document directly, up to 5 MB. On the public page, editing a Markdown attachment loads its saved source into the editor; uploading a Markdown file also lets you revise it before saving. Personal and guest documents keep their existing privacy rules. A failed load blocks saving an empty replacement and offers a retry.

### Sharing, widgets and animation options

Shared groups have stable addresses such as `/g/engineering`; renaming a group preserves its address. Use the QR button or right-click a group tab to copy or share its link. Sections have their own share action, and link cards offer QR codes too. Browser Back and Forward follow group navigation, and signing in preserves the requested group and section. Passwords and membership checks still apply to shared addresses.

Global search displays each result's group, highlights matches and opens results in a new tab. Recent queries belong to the signed-in account; anonymous queries stay in that browser session. Hover over a truncated card title to read the full name. On phones, the group menu provides a searchable list and page actions.

Open **Workspace → Widgets**, or **Add widget** on the public page, to choose from the widget gallery and preview real content before saving. Administrators can manage all widgets; group managers can edit content in widgets assigned exclusively to groups they manage. Only global administrators can move or resize shared widgets: drag the card to reorder it, or pull its bottom-right corner to change its column span and height. A dashed preview appears immediately and follows the proposed size until release. The resize control also accepts arrow keys. Sizes and order persist after reloading. Each widget supports three widths, automatic/compact/tall content areas or a fixed height, multiple groups and desktop/mobile visibility. Device visibility controls presentation; group permissions control access.

Global administrators can also drag one shared link over another to exchange their positions on the public page and in the admin panel. Inside a group, their section slots are exchanged too. Other memberships and the cards between them are preserved. Personal links and favourites keep their existing personal ordering.

Settings and Workspace use consistent form spacing and controls. On phones, Settings offers a category selector and Workspace keeps every section visible in its navigation. Workspace retains a fixed dialog size while switching sections; less-used widget layout options are grouped in a disclosure.

Widgets share the link cards' Subtle fade, Smooth glide and Spring entrance, pointer hover and animated reordering. Refreshing their data does not replay the entrance. The Off setting and reduced-motion preferences suppress these effects.

**Analytics** compares a selected period with the preceding equivalent window. Choose the last 24 hours, 7, 30 or 90 days, or all recorded activity, and filter by group or exclude detected automation. The dashboard includes click and unique-IP totals, catalogue usage, a comparative activity chart, a weekday/hour heatmap, device and browser estimates, group and address rankings, resources without clicks and recent activity. Shared links count once in totals and may appear in several group rankings. All chart buckets use UTC. IP addresses estimate visitors; they are not account or person counts. Device and automation labels are estimates from the user agents already recorded. CSV export uses the same filters, includes zero-click links and protects text cells from spreadsheet formula execution. Refreshing retains the last loaded view if a request fails.

| Widget | Options |
| --- | --- |
| RSS / Atom | List or cards, dates, optional publisher images and descriptions, headline filter, 1–30 articles |
| Clock | Digital or analog face, optional seconds, 12/24 hours, local or named time zone and up to four additional zones |
| Weather | City lookup or coordinates, feels-like temperature, wind, humidity, rain and up to seven forecast days |
| Gotify | Minimum priority, message count, unread filter and personal read state; no messages are deleted from Gotify |
| Notes | Plain text or Markdown with links and shared tasks; administrators and group managers can tick tasks on the public page |

Source requests run on the server. Refresh intervals range from one minute to one hour, with an updated timestamp and a manual refresh action. A failed refresh retains the last good data with a status message. Manual refreshes have a ten-second cooldown per widget and a request limit. Gotify client tokens and optional weather API keys stay on the server. Gotify read state belongs to the signed-in account; anonymous visitors keep it in their browser. Markdown task changes detect conflicting edits instead of replacing a newer note. Internet feeds are the default; an administrator must explicitly approve trusted intranet sources. Optional RSS images load directly from publishers.

**Settings → Themes** offers Off, Subtle, Smooth and Spring UI motion, plus Aurora, Colour mesh, Soft colour waves, Starlight, **Orbital · 3D** and **Glass sculptures · 3D** backgrounds. The 3D scenes contain rotating rings, spheres and translucent cubes; moving the pointer gently changes the viewing angle. Subtle fades cards in, Smooth glides them upward, and Spring scales them in with a short, damped bounce. Large libraries use shorter, smaller movements without stagger. Smooth and Spring also add pointer-driven card tilt, lifted icons and animated settling after link/group reordering. Data refreshes do not replay entrances. Dropdown pickers animate on browsers supporting customisable selects, with native controls as fallback. The app icon responds to hover, and theme changes crossfade on supported browsers.

The original/minimalist background remains available, and custom wallpapers take priority. Reduced-motion preferences and the Off option stop animation. These are native CSS/browser animations inspired by Smooth UI and Motion. The Appearance menu also lets each browser choose its own background, motion level and automatic day/night hours (07:00–19:00 by default). Markdown pages inherit the selected background and 3D geometry without enabling document scripts; mouse interaction is available on the app pages.

**Effect speed** ranges from 0.25× to 3× and controls animated backgrounds, 3D movement and seasonal particles separately from UI motion. **Custom fade** supports two to six colours and four effects: Crossfade, Drifting clouds, Soft ripples and Slow orbit. Configure the site defaults in **Settings → Themes / Design**, or override the effect settings for one browser in **Appearance**. The editor previews its palette and effect before saving. Palettes and timing are included in appearance presets, backups and Markdown reader links. Reduced-motion settings still take priority.

**Background composition** makes layering explicit: **Custom background only** shows the chosen background without seasonal decoration; **Season particles + custom** keeps snow, bats, leaves or other seasonal particles over that background, without the seasonal landscape or patterns; **Full season + custom** combines the seasonal scenery and particles with the selected animated or 3D background. Uploaded wallpapers can also retain particles or the full seasonal atmosphere. With **Original / seasonal** and the default composition, the normal seasonal design is shown. The same composition applies to public, admin, sign-in and Markdown pages, and can be overridden per browser.

Link health checks retry with GET when HEAD is rejected, distinguish authentication/rate limiting from missing pages, and require repeated failures before marking a link unavailable. **Workspace → Library → Links** shows the reason, a manual recheck and an automatic-check switch.

---

### Installable app

<p align="center">
  <img src="linkPagePrints/linkPage-v210-public-mobile.png" width="260" alt="LinkPage on a phone" />
  <img src="linkPagePrints/linkPage-v200-pwa-offline.png" width="260" alt="PWA offline reconnect page" />
</p>

Install LinkPage on your computer or phone to open it in its own window. Chrome and Edge offer **Install app** when installation is available; on iPhone and iPad, use **Safari → Share → Add to Home Screen**. Safari on Mac offers **File → Add to Dock**. The app also provides an installation guide and an offline reconnect page. Links, documents and changes need a connection. Only the generic offline page and its assets enter the service worker's cache; account data, API replies, documents and uploads do not.

Serve the app over **HTTPS** for installation and service workers. `localhost` works for development; plain HTTP on a LAN address does not. Browser support and installation menus vary; see the [MDN installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

---

## Features

### New in v2.0.0

- **Installable PWA** — home-screen and dock installation, standalone windows, app icons, offline recovery and a controlled worker update prompt.
- **Seasonal redesign** — seven original landscapes, Light and Dark palettes, minimalist/still/animated backgrounds and independently randomised particles.
- **Automatic themes** — annual date ranges, time zones, priorities, Easter-relative dates and date previews.
- **Global search** — ⌘K / Ctrl+K, actual link icons, keyboard navigation and Markdown content search.
- **Workspace library** — tags, saved filters, publication/expiry dates and grid/list/gallery group layouts.
- **Permissions** — private groups and viewer/contributor/editor/manager roles, plus public-page editing for global admins.
- **History and reading tools** — document and appearance versions, compare/restore, Markdown contents, find, size, width and focus controls.
- **Complete backups** — create/download/import/restore, recovery copies, retention and daily/weekly scheduling.
- **Notifications and appearances** — per-admin read state and portable branding/theme presets.
- **UI refinements** — separate scroll-arrow hit targets, responsive controls and SSO without BETA badges.

### Accounts and collaboration

- **Accounts** — invite-only, with an administrator seed on first start and an admin-issued password reset link; one Sign-in button on the public page that lands admins in the panel and members on the links
- **Single sign-on** — any OpenID Connect provider (Authentik, Keycloak, Google Workspace, Okta…); authorization code with PKCE, ID token signature / issuer / audience / expiry / nonce verified, optional account creation and email-linking, administrator group mapping, and single-sign-on-only mode
- **Password reset by email** — optional SMTP settings, one-hour one-use link built from a configured page address (never the request), rate-limited per address and per account
- **Group admins** — administrators pick members to look after a shared group; those members may add and edit links in it, from the public page
- **Your own page** — a signed-in member keeps private groups, links and starred favourites, with export / import to another instance; a `+` after the group tabs creates a new group in one step, and a `+ Add a link to <group>` card appears inside groups you may add to
- **Guest contributions** — optional, three-level setting (off / members / anyone). Guests are identified by a browser cookie, see only their own content, and are listed and prunable from a Contributions tab in the panel; retention sweep deletes dormant guests after N days
- **Season themes** — Easter, Halloween, Christmas, Spring, Autumn, Winter, Summer; each with its own Light and Dark palette, subtle SVG motifs and configurable automatic calendar
- **Touch-friendly reordering** — press and hold a favourite or one of your own links on a touch device, then slide to reorder

### Workspace tools

Open **Workspace** in the admin header for the shared library, history, full backups, notifications and saved appearances. The public page also has **Search everywhere** (**⌘K / Ctrl+K**). Search includes the contents of Markdown attachments, honours group passwords, private group membership and publication windows, and includes only the signed-in member’s own private documents. Results show the link’s custom icon or cached favicon.

- **Library → Links:** add up to 24 tags and set optional publication and expiry dates in your local time zone. Tag filters on the public page work across groups; signed-in members can save filters to their account. Scheduling is enforced by the server for listings, search, document links and raw attachments; open public pages refresh within 30 seconds.
- **Library → Groups & access:** choose a card grid, compact list or large image cards per group. A private group is visible only to assigned members and global administrators. Viewer roles can read; contributors can add and edit their own links; editors can edit group links; managers can also rename the group, choose its layout and manage member access from the public page. Existing group admins retain manager access. A link also placed in a public group stays public. General administrators may edit shared links from the public page, including ungrouped links; an ordinary edit preserves all existing group memberships. Hidden links remain absent from the public page.
- **History:** text-file versions are recorded on creation and each in-place save, with up to 30 versions per document. Compare a saved version with the current text and restore it; restoring first preserves the current version. Appearance and presentation settings have a separate history. Authentication secrets are not included in appearance versions.
- **Markdown reading options:** use the contents index, find text within a document, change the text size or reading width, or enable focus mode. Controls work in a new tab and inside the document modal. Document content stays script-free and sandboxed.
- **Backups:** create or import a complete `.tgz` archive of the database, shared files, private files, icons and configuration. Download it, or restore it after typing `RESTORE`. A recovery copy is made first. Restoring ends existing sessions and preserves the current instance’s administrator token. Restores currently require the same database schema version. Automatic daily or weekly backups have an explicit UTC hour and keep 1–30 copies (default 7); automatic backups are off until enabled. Copies remain on the local data volume, so download them for storage elsewhere.
- **Notifications:** pending contributions, unavailable links and the latest backup result in one place, with read state per administrator.
- **Appearance:** save, export, import and apply named presets of the colours, seasonal calendar, background, particle preference and branding images. Applying a preset preserves the prior appearance in History. Portable images are limited to 15 MB in total.

### Core

- **Public page** — clean, searchable landing page for end users with group tabs and multi-keyword search
- **Scrollable group tabs** — with more groups than fit the bar, use the mouse wheel, trackpad, touch or arrows in separate lanes; arrows disable at each end without exposing a group underneath. Turn on *Looping Group Tabs* for continuous scrolling
- **Admin panel** — full link and group management for administrators; sign in with an account or the break-glass admin token
- **Multiple groups per link** — assign a link to as many groups as needed via a checkbox multi-select
- **Sections & subsections** — organize cards under named section headings, and nest one level of subsections inside them; drag to reorder in the sidebar (reflected on the public page), or drag a link straight onto a group/section/subsection
- **Live updates on the public page** — opened tabs fade-refresh within a fraction of a second when an admin adds, edits, reorders, or deletes anything (Server-Sent Events)
- **Reusable icon library** — every uploaded icon goes into a shared, searchable library; pick an existing icon for new links, bulk-select and delete, and export/import the whole library as a single file; the Settings favicon appears here too
- **Stock icon picker** — choose from a built-in line-icon set and a colour, instead of uploading; file links get a coloured file-type icon, and links with no icon fall back to the Settings favicon
- **In-place file editor** — edit attached text files (HTML, XML, JSON, TXT, CSV, MD, SVG) in the admin with an expand view, line numbers, syntax highlighting, and a find bar; saves go live instantly
- **File attachments** — link cards can point to an uploaded file (PDF, Office docs, archives, images, text, HTML/XML/JSON) instead of a URL, with a 100 MB cap and an extension whitelist
- **Markdown documents** — a `.md` attachment renders as a styled page when its card is opened, in the site's own palette, rather than downloading; choose whether it opens in a popup over the grid (the default) or a new tab, and mark a document to **open automatically when its group is opened**, once per visit
- **Link requests** — let visitors propose links (name, URL, description, icon, target group/section), optionally behind their own password; requests queue up in the admin with a pending badge, and approving one opens the Add-Link form pre-filled
- **Duplicate-aware approvals** — a request whose URL already exists is flagged with an "Already added" chip (matching ignores http/https, `www.`, trailing slashes and fragments), and approving offers to add that link to the requested group instead of creating a second copy
- **Password-protected groups** — gate sensitive groups with a password; per-group unlock behaviour: auto-lock after 30 s (kiosk-safe) or stay unlocked for the browser session
- **Admin audit log** — every admin change and every link click is recorded with the entity name, time, IP and device; live auto-refresh, search/type filters, and CSV/JSON export
- **Hide links from the public page** — keep a link in the admin without exposing it publicly (eye-toggle on every card)
- **Custom group colors** — pick any color via the native picker swatch
- **Pinned default group** — choose which group the public page opens on (new visitors only — returning visitors keep the tab they were last viewing)
- **Copy link** — one-click copy button on every public card, with a toast confirmation
- **Click analytics** — per-link stats (total clicks, unique visitors, today/week counts, top IPs) plus a dashboard over any period: busiest days and hours, top links and top visitors
- **IP attribution tags** — name a known IP once and that name appears wherever the IP shows up: click stats, audit log, and link requests
- **Broken link checker** — automatic health check every 6 hours, flags dead links in the admin
- **Custom branding** — set the site title (shown in the browser tab *and* the page header), pick a header icon from the library / stock set / your own upload, upload separate logos for light and dark mode, and a custom browser-tab favicon; header title and icon step aside automatically when a logo is set
- **Themes & appearance** — accent colour with optional dark-mode brightening and glow, light/dark palette variants, and which theme new visitors land on
- **Public-page controls** — a Settings tab of its own for everything visitors see: default group, phone navbar at the top or bottom, group-coloured active tabs, and looping group tabs
- **Hidden starter link on first install** — a fresh install comes with a single hidden "Buy me a coffee" link: visible in the admin only, never on the public page; its icon is fetched on first boot (with a built-in fallback when offline). Delete it and it stays deleted
- **Smart favicon fetching** — three-tier strategy (parse the page for `<link rel="icon">`, then `/favicon.ico`, then Google as fallback) so favicons work for intranet sites too; fetched in the background so saving a link is never blocked, and cached server-side
- **Drag-to-reorder** — reorder links, groups, sections, and subsections by dragging
- **Bulk actions** — multi-select (shift-click for ranges, Select all, Esc to clear) to delete, move into a section, hide, or show multiple links at once
- **In-app update checker** — Settings shows the current build, and a one-click "Check for updates" button polls GitHub Releases for newer versions and shows the release notes inline
- **Versioned database migrations** — transactional, idempotent schema upgrades run on every startup; logs what changed so any past version upgrades cleanly
- **Mobile-friendly UI** — slide-over sidebar, full-width modal sheets, larger tap targets, and a kebab overflow menu on the admin top bar
- **Import / Export** — backup and restore links, groups, sections and subsections as JSON (idempotent re-import)
- **Public password gate** — optionally protect the public page with a password
- **Light & dark mode** — Apple-style design with OS preference detection
- **Docker ready** — single `docker compose up` to deploy with persistent storage

---

## How It Works

### Architecture

```
linkPage/
├── src/
│   ├── server.js       # Startup: banner, health check, listen
│   ├── app.js          # Express app: middleware order, static files, routes
│   ├── config/         # env vars, constants, PostgreSQL/SQLite connections + migrations, secrets
│   ├── routes/         # One router per resource; index.js mounts them all
│   ├── controllers/    # Request handling and validation per resource
│   ├── models/         # SQL data access (parameterized statements only)
│   ├── services/       # Uploads, favicons, SSE, audit, version check, health
│   ├── middleware/     # Auth, audit+broadcast, rate limits, security headers, errors
│   └── utils/          # HTTP/URL helpers, CSV, group crypto, body parsers
├── public/
│   ├── index.html      # Public page (end users)
│   ├── js/             # Public page logic, one file per feature, loaded in order
│   ├── login/          # Sign-in, invites and password resets
│   ├── theme-boot.js   # Theme and appearance shared by the sign-in screens
│   ├── style.css       # Shared Apple-style theme (CSS variables)
│   └── admin/
│       ├── index.html  # Admin panel
│       ├── js/         # Admin panel logic, one file per feature, loaded in order
│       ├── admin.css   # Admin-specific styles
│       └── icon-presets.js  # Curated stock icon set
├── ee/                 # Reserved for enterprise-licensed modules (see ee/LICENSE)
├── CHANGELOG.md        # Release notes — read at runtime by /api/changelog
├── scripts/            # Maintenance scripts (license headers)
├── Dockerfile
├── docker-entrypoint.sh      # Prepares /app/data, then drops to the `node` user
├── docker-compose.yml       # Build from source
└── docker-compose.prod.yml  # Run the published image
```

### Data Storage

All persistent data lives in `/app/data` inside the container, mapped to `./linkpage_data` on the host:

| Path | Purpose |
|------|---------|
| `data/links.db` | Legacy SQLite database, also used when PostgreSQL is not configured. Kept unchanged by the PostgreSQL import. |
| PostgreSQL | Links, groups, settings, accounts, sessions, analytics and workspace data when configured. Compose stores it in the `postgres_data` volume. Uploads and secrets still live in the app's data directory. |
| `data/admin-token.txt` | Admin token generated on first startup |
| `data/admin-initial-password.txt` | The first administrator's password, written only when one is generated. Deletes itself once that password is changed. |
| `data/group-secret.txt` | Key used to sign group-unlock cookies and hash group passwords |
| `data/uploads/` | Uploaded images, logos, favicons, and link file attachments |
| `data/private-uploads/` | Members' own files — their attachments, icons, and the favicons fetched for their links. Never served as static; every file is read through a route that checks who is asking. |

### Authentication

Two ways in, and both work everywhere.

**Accounts.** On first startup the server creates an administrator account and prints its email and password in the startup banner; the password is also written to `data/admin-initial-password.txt`, which deletes itself once you change it. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to choose them yourself. Signing in sets an HttpOnly, SameSite=Lax session cookie; the session lives in the database, so it can be revoked, and it is keyed by a hash of the cookie rather than the cookie itself.

Further accounts come from **invite links** — Settings → Accounts. There is no open sign-up. The link is shown once, works once, and expires. You hand the link over yourself, and a forgotten password is a reset link issued from the same place.

**Email, optionally.** Give LinkPage an SMTP server in Settings → Email and turn on *Password reset by email*, and the sign-in page offers to email a reset link. The link works once, for an hour. The endpoint answers the same whether or not an address has an account, is limited per address and to three emails an hour per account, and builds every link from the *Page address* you set rather than from the request, so a forged `Host` header cannot redirect a reset. *Send me a test* checks the settings against the real server.

**One sign-in.** Everybody signs in at `/login/`, from the single *Sign in* button. Administrators land in the admin panel and everyone else back on the links; opening `/admin` while signed out goes to the same page and back.

**Group admins.** In a group's dialog in the admin panel, tick the members who look after it. They can add links to that group from the public page — *Add a link* lists the groups they look after — and edit or remove links that live only in groups they manage. Links shared with another group, hidden links, custom addresses and the group's own settings stay with administrators. Their uploads follow the public rules: no SVG or HTML, 50 MB at most.

**The admin token.** A 64-character hex token in `data/admin-token.txt`, generated on first startup and printed at every start. It predates accounts and remains the way back in when nobody can sign in — choose *Use the admin token* on the sign-in page, or open `/admin/?token`. It can be rotated from Settings → Security at any time, which invalidates the old one immediately.

State-changing API requests that carry a session cookie must come from this origin; requests authenticated by the token header are exempt, so scripts and `curl` are unaffected.

**Single sign-on.** Any OpenID Connect provider can sign people in alongside passwords — Settings → Single Sign-On. With [Authentik](https://goauthentik.io):

1. In Authentik, create an **OAuth2/OpenID Provider**: client type *Confidential*, and the **Redirect URI** shown in LinkPage's Single Sign-On tab (`https://<your-linkpage>/api/auth/oidc/callback`, matched exactly). Keep the default scopes `openid`, `email` and `profile`.
2. Create an **Application** that uses it, and note its slug.
3. In LinkPage, set the **Issuer** to the provider's *OpenID Configuration Issuer* — `https://<your-authentik>/application/o/<slug>/` — and paste the client ID and secret. Turn it on and save; LinkPage fetches the discovery document first and says so if it cannot.

Who gets in is decided by two switches. **Create accounts** gives anyone the provider lets through a member account on their first sign-in; off, they need an invite first. **Match existing accounts by email** connects an existing account to the provider when the addresses match, but only when the provider marks the address as verified — otherwise anyone who can edit their own address at the provider could claim any account here. Either way, a signed-in member can connect their own account from *Your account*, which needs no trust in addresses at all. Accounts created this way are members, unless you name an **Administrator group**: members of that provider group are made administrators when they sign in, and members again when they leave it (the last administrator is never demoted). Authentik sends a `groups` claim with the `profile` scope.

**Single sign-on only** hides the password form and refuses password sign-in; email resets are no longer offered. The admin token keeps working, and is the way back in if the provider is ever unreachable.

The sign-in uses the authorization code flow with PKCE, a state value bound to the browser by a cookie, and a nonce; the ID token's signature (against the provider's published keys, or the client secret for HS256), issuer, audience, expiry and nonce are all checked. Behind a reverse proxy, make sure it passes `X-Forwarded-Proto` and the original `Host`, or the redirect URI LinkPage sends will not match the registered one.

Wrong guesses are throttled: ten failed sign-ins from one address, or twenty against one account from anywhere, and further attempts are refused for fifteen minutes. The account limit applies whether or not the account exists, and a successful sign-in clears it. The admin token, invite and reset links, group passwords and the public password have limits of their own. The counts are kept in the database, so a restart does not reset them.

### Click Tracking

Every link card points to `/r/:id` (a server-side redirect) instead of the destination URL directly. The server records the click — IP address, user agent, timestamp — in the configured database before redirecting. This works without JavaScript and is not blocked by ad blockers.

---

## Deployment with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed

---

### Option A — Pull from Docker Hub (recommended)

For a **new PostgreSQL installation**, use the pinned production Compose file below. The published image also supports SQLite without database connection variables. **Existing SQLite users: follow the [migration guide](docs/sqlite-to-postgresql.md), retaining the original data mount and taking a stopped backup, before adopting this Compose configuration.**

**`docker-compose.prod.yml`**

```yaml
services:
  linkpage:
    image: tomasneto26/linkpage:2.1.0
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"
    volumes:
      - ./linkpage_data:/app/data
    restart: unless-stopped
    environment:
      - PORT=3000
      - DATA_DIR=/app/data
      - UPLOADS_DIR=/app/data/uploads
      - DB_ENGINE=postgresql
      - PGHOST=postgres
      - PGPORT=5432
      - PGDATABASE=linkpage
      - PGUSER=linkpage
      - PGPASSWORD=${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      - MIGRATE_SQLITE=${MIGRATE_SQLITE:-0}
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: linkpage
      POSTGRES_DB: linkpage
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkpage -d linkpage"]
      interval: 5s
      timeout: 5s
      retries: 12
volumes:
  postgres_data:
```

**1. Create the file**

```bash
curl -fsSLo docker-compose.prod.yml https://raw.githubusercontent.com/Tomasneto404/linkPage/v2.1.0/docker-compose.prod.yml
```

Or create it manually with the contents above.

**2. Configure the database password**

Create an `.env` file beside the Compose file (preserve existing variables if it already exists):

```dotenv
POSTGRES_PASSWORD=replace-with-a-long-random-password
MIGRATE_SQLITE=0
```

**3. Start the app**

```bash
docker compose -f docker-compose.prod.yml up -d
```

Docker will pull the image from Docker Hub automatically and start the container.

**4. Get your admin token**

```bash
docker compose -f docker-compose.prod.yml logs linkpage
```

Look for a line like:

```
│  Admin Token: 5c5665cfeaf662e95f98e832e2cdbaa3c2ab5d0b...
```

Copy the full token. It is saved to `linkpage_data/admin-token.txt` and reused across restarts.

**5. Open the app**

| Page | URL |
|------|-----|
| Public page | http://localhost:3000 |
| Admin panel | http://localhost:3000/admin |

Paste the token into the admin panel to unlock link management.

**Updating to a newer release**

Change the pinned image tag to the desired version, read its upgrade notes, then recreate the service:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

> **Upgrading from 1.0.3 or earlier:** the server process now runs as the
> unprivileged `node` user (uid 1000) instead of root, and the container reports
> a Docker health check. Nothing to do on your side — the entrypoint takes
> ownership of the data directory on first start, whoever created it.
>
> The one exception is pinning the uid yourself (`user:` in compose, `--user` on
> the CLI): then the entrypoint has no privileges to hand the volume over, so it
> must already be writable by that uid. It says so explicitly and exits instead
> of half-starting.

---

### Option B — Build from source

Clone the repository and build the image locally.

**`docker-compose.yml`**

```yaml
services:
  linkpage:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"
    volumes:
      - ./linkpage_data:/app/data
    restart: unless-stopped
    environment:
      - PORT=3000
      - DATA_DIR=/app/data
      - UPLOADS_DIR=/app/data/uploads
      - DB_ENGINE=postgresql
      - PGHOST=postgres
      - PGPORT=5432
      - PGDATABASE=linkpage
      - PGUSER=linkpage
      - PGPASSWORD=${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      - MIGRATE_SQLITE=${MIGRATE_SQLITE:-0}
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: linkpage
      POSTGRES_DB: linkpage
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U linkpage -d linkpage"]
      interval: 5s
      timeout: 5s
      retries: 12

volumes:
  postgres_data:
```

**Steps**

```bash
git clone https://github.com/Tomasneto404/linkPage.git
cd linkPage
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD before starting.
docker compose up -d --build
```

**Updating**

```bash
git pull
docker compose down
docker compose up -d --build
```

---

### Docker Compose fields explained

| Field | What it does |
|-------|-------------|
| `image` | Pulls the pre-built image from Docker Hub |
| `build: .` | Builds the image from the local `Dockerfile` (Option B only) |
| `ports: "3000:3000"` | Exposes the app on port 3000. Change the left side for a different host port (e.g. `"80:3000"`) |
| `volumes: ./linkpage_data:/app/data` | Maps a local folder to the container so the database and uploads survive restarts and image updates |
| `restart: unless-stopped` | Auto-restarts the container on crash or host reboot |
| `DATA_DIR` / `UPLOADS_DIR` | Tell the app where to store the database and uploaded files inside the container |

---

### Data and database volumes

Normal updates preserve both the application directory and PostgreSQL volume. `docker compose down` retains named volumes. The `-v` option deletes them and is not an upgrade command. Follow the [backup and recovery procedure](docs/sqlite-to-postgresql.md#backups-after-migration) before changing database configuration.

---

## Running Without Docker

### Prerequisites

- [Node.js](https://nodejs.org/) 22.13 or later. The Docker image and CI run on Node 24; 22.13 is the first release where the built-in SQLite module works without a flag.

### Steps

```bash
npm install
npm start
```

The app starts on port `3000`. On first run it creates `data/links.db` and `data/admin-token.txt` in the project root.

For development with auto-restart on file changes:

```bash
npm run dev
```

### PostgreSQL and importing an existing SQLite installation

For the complete procedure, including Docker Compose, named volumes, a verified first start, backups and recovery, read **[Moving an existing SQLite installation to PostgreSQL](docs/sqlite-to-postgresql.md)**.

SQLite remains available without database configuration. To use PostgreSQL, create an empty database and set `DATABASE_URL`; alternatively set `DB_ENGINE=postgresql` and the usual `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD` variables. The app creates and migrates its schema on startup. Connection failures stop startup; there is no silent fallback to SQLite.

For local development, copy `.env.example` to `.env`, configure the connection and run `npm run dev`. This command loads `.env`; `npm start` expects variables supplied by the environment.

Before importing, stop the existing app and back up its complete data directory, including `links.db`, uploads, private uploads and secrets. Then choose one import method:

```bash
# Automatic import on first startup into an empty PostgreSQL database:
DATABASE_URL='postgresql://user:password@localhost/linkpage' MIGRATE_SQLITE=1 npm start

# Or explicit import from an existing SQLite database:
DATABASE_URL='postgresql://user:password@localhost/linkpage' npm run db:migrate -- /path/to/links.db
```

The explicit command runs before starting the app against the target. Do not combine it with `MIGRATE_SQLITE=1`. Import checks row counts and content inside one transaction, preserves row IDs and sequence positions, and refuses an occupied target. The SQLite source remains unchanged. Keep the same `DATA_DIR` to preserve uploaded files, tokens and signing secrets. Test sign-in, groups, documents and private pages before admitting new writes. Returning to SQLite before new writes is possible by removing the PostgreSQL configuration; after new writes, restore a matching complete backup instead of switching to the stale SQLite copy.

The Compose files configure PostgreSQL 18, a health check and an internal database service. Set `POSTGRES_PASSWORD` in `.env` before startup. The database volume is separate from the application data directory; retain both. The published 2.1.0 image includes the explicit importer and both database engines.

Workspace backups on PostgreSQL contain a verified logical database snapshot and the existing files; restore uses a transaction and creates a recovery copy first. Restores require the same schema version. Download backups to separate storage before upgrades.

---

## Tests

The API test suite runs on Node's built-in test runner — no dev dependencies to install:

```bash
npm test                          # whole suite (~5 s)
npm run test:watch                # re-run on change
node --test tests/links.test.js   # one file
```

Each file under [`tests/`](tests/) covers one resource (`auth`, `settings`, `links`, `groups`,
`linkRequests`, `icons`, `redirect`, `analytics`, `audit`, `ipTags`, `security`, `events`,
`seed`, `migrations`, `version`, `changelog`) and drives the real Express app over HTTP.
[`tests/helpers/harness.js`](tests/helpers/harness.js) boots it on an ephemeral port against a
throwaway SQLite database in the system temp directory — your own `data/` is never touched —
and stubs the favicon fetcher so the suite never reaches the network.

**Browser tests** click through the pages in headless Chromium: signing in, the admin panel,
the composer, favourites (including reordering by touch), members-only, single sign-on and a
password reset by email. They use the dev dependency `playwright-core`; the browser itself is a
one-time download:

```bash
npx playwright-core install chromium-headless-shell
npm run test:browser
```

Without a browser they skip, saying how to get one. `LINKPAGE_BROWSER_PATH` points them at any
other Chromium-based executable instead.

The same API suite can run against a dedicated PostgreSQL test database. Each file creates and removes its own isolated schema:

```bash
LINKPAGE_TEST_POSTGRES_URL='postgresql://user:password@localhost/linkpage_test' npm run test:postgres
```

CI runs both suites on every push to `main`, every `v*` tag and every pull request; the
Docker image is only built and pushed when they are green.

---

## Security scans

Every CI build runs **[Trivy](https://aquasecurity.github.io/trivy/)** three times:

- `trivy fs` on the repo (`package-lock.json`, `pnpm-lock.yaml`)
- `trivy image node:24-alpine` on the Dockerfile base image
- `trivy image` on the amd64 image that is about to be published

A single **CRITICAL** finding fails the job and blocks the Docker publish. `--ignore-unfixed` keeps the gate honest: it only trips on CVEs that have a fix available, so an unfixable advisory does not block releases indefinitely.

Run the same scans locally (needs the `trivy` CLI, or point it at the official Docker image):

```bash
npm run security:scan            # package-lock + pnpm-lock
docker build -t linkpage:local . && npm run security:image

# Or via Docker, without installing trivy:
docker run --rm -v "$PWD:/repo" -v "$HOME/.cache/trivy:/root/.cache" \
  aquasec/trivy:latest fs --severity CRITICAL --ignore-unfixed /repo
```

---

## Upgrading to 2.1.0

1. Stop the existing application and back up its complete data directory. Keep the previous image and Compose configuration with that copy.
2. To **retain SQLite**, update your existing service to `tomasneto26/linkpage:2.1.0`, preserve the same volume and omit `DATABASE_URL`/`DB_ENGINE=postgresql`. Schema migrations run at startup.
3. To **move to PostgreSQL**, follow the [migration guide](docs/sqlite-to-postgresql.md): keep the same application data mount, use an empty target and enable the one-time verified import, then disable `MIGRATE_SQLITE` after checking the result.
4. Verify sign-in, protected/private groups, attachments, layouts, widgets and scheduled content. Create and download a new Workspace backup. After moving to PostgreSQL, backing up the old SQLite file alone no longer protects new data.

The PostgreSQL connection is explicit; connection failures do not fall back to SQLite. Backups restore to the same schema version. An older image must be paired with its own stopped-directory backup rather than pointed at an upgraded database.

## Upgrading to 2.0.0

1. Make a complete copy of the persistent `linkpage_data` volume while the container is stopped. Keep the image version that created that copy.
2. Pull `tomasneto26/linkpage:2.0.0`, update your Compose image tag and start the service with the same volume. Database migrations run automatically. Accounts, links, groups and branding are retained.
3. Open **Workspace** in the admin header to review permissions, configure backups and explore the new tools. Automatic backups remain off until enabled. Existing group admins keep manager access.

The backup tools in 2.0 restore archives from the **same database schema version**. To roll back to 1.x, restore your pre-upgrade volume copy together with the previous image. Do not run an older image against the migrated database.

PWA installation requires HTTPS outside localhost. If a reverse proxy adds a Content Security Policy, allow the same-origin manifest, worker, scripts and images. The PWA does not make private resources available offline.

---

## Releasing (maintainers)

The version lives in exactly one place — `version` in [package.json](package.json) — and is
read at runtime by `/api/version`, shown in the admin sidebar and the About row, and compared
against GitHub Releases by the update checker. Nothing else needs editing.

1. Bump `version` in `package.json` and the root package records in `package-lock.json`.
2. Add a `## vX.Y.Z` section at the top of [CHANGELOG.md](CHANGELOG.md), one `### Title` +
   paragraph per entry. This single file feeds the in-app changelog (via `/api/changelog`),
   the GitHub release notes, and the CI guard below.
3. Run `npm test`, `npm run test:postgres` against an isolated test database, and `npm run test:browser`. Build the candidate and run `node scripts/production-smoke.cjs` to verify the real SQLite upgrade and recovery path. See the [validation record](docs/release-2.1.0-validation.md) for browser and physical-device boundaries. Refresh screenshots with `node scripts/screenshots.cjs` (requires Chromium, or set `LINKPAGE_BROWSER_PATH`). The script uses a temporary demo database. Generate PWA icons with `node scripts/pwa-icons.cjs` if the brand mark changes; update the offline cache version in `public/sw.js` when offline assets change.
4. Commit, push `main`, then push the matching tag:

   ```bash
   git push origin main
   git tag -a v2.1.0 -m "LinkPage 2.1.0"
   git push origin v2.1.0
   ```

[The workflow](.github/workflows/docker-publish.yml) takes it from there:

| Job | What it does |
|-----|-------------|
| `test` | Runs the whole suite. Red suite ⇒ nothing else runs. |
| `cross_browser_test` | Checks public/admin and narrow-screen flows in Firefox and WebKit. |
| `postgres_test` | Runs the API regression suite in isolated PostgreSQL schemas. |
| `production_test` | Builds the candidate and verifies the real 2.0.0 SQLite import plus backup recovery in Docker. |
| `verify-tag` | Fails unless the tag, `package.json` and a `CHANGELOG.md` section all agree — a mistyped tag stops here instead of publishing a mislabelled image. |
| `build` | Builds and pushes for amd64 + arm64: `:X.Y.Z` and `:X.Y` from the tag, `:latest` only from a verified stable release tag. Branch pushes verify the candidate without publishing it. |
| `release` | Creates (or updates) the GitHub Release, with the notes lifted straight out of `CHANGELOG.md` plus the `docker pull` line. Re-running the workflow on the same tag is safe. |

Because the release notes and the in-app changelog come from the same file, the "Update
available" banner shows users exactly what the admin panel documents.

---

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `./data` | Directory for the database and admin token file |
| `UPLOADS_DIR` | `./data/uploads` | Directory for uploaded images and cached favicons |
| `PRIVATE_UPLOADS_DIR` | `./data/private-uploads` | Directory for members' own files. Must not be exposed by a reverse proxy — the app serves these itself, to their owner only. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@localhost` / generated | The first administrator account, created at boot when there is none. With `ADMIN_PASSWORD` set, no password is printed or written to disk. |
| `RELEASES_REPO` | `Tomasneto404/linkPage` | GitHub `owner/repo` polled by the in-app update checker. Override to point at a fork or private mirror. |
| `TRUST_PROXY` | `1` | How far to trust `X-Forwarded-For` when identifying a client. The default of one hop suits the shipped compose file, where a reverse proxy sits in front. **Set it to `0` if the container is exposed directly to the internet** — otherwise a caller can pick its own address, which is what the rate limiters count and what the audit log records. Also accepts a hop count, `loopback`, or a subnet list. |

---

## API Overview

### Interactive documentation

Every endpoint is described in an OpenAPI document, browsable on the running instance:

| URL | What it is |
|-----|------------|
| `/api/docs` | Swagger UI. Paste the admin token into the bar at the top and the **Try it out** buttons send it for you. |
| `/api/openapi.json` | The OpenAPI 3 document itself. Point Insomnia, Postman or your own generator at it. |

Swagger UI is served from the instance rather than a CDN, so it works on a box with no
route to the internet. The document is admin-gated, like the API it describes; the page
itself is not, and asks for the token the same way `/admin` does.

The document is kept honest by a test that walks the live Express router: a route with no
entry fails the suite, an entry for a route that no longer exists fails it too, and so does
an operation whose documented auth disagrees with the middleware actually guarding it.

### At a glance

Read endpoints are public. All write endpoints require the `X-Admin-Token` header.  
If a public password is configured, read endpoints also require an `X-Public-Password` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/verify` | — | Verify admin token |
| POST | `/api/auth/verify-public` | — | Verify public password |
| POST | `/api/auth/rotate-token` | Admin | Generate a new admin token |
| GET | `/api/settings` | — | Get branding, theme, feature flags, pinned group, password status |
| POST | `/api/settings/site-title` | Admin | Set the site title (browser tab + header) |
| POST | `/api/settings/brand-icon` | Admin | Set the header icon (image upload or library `icon_id`) |
| DELETE | `/api/settings/brand-icon` | Admin | Remove the header icon |
| POST | `/api/settings/logo/:variant` | Admin | Upload logo (`light` or `dark`) |
| DELETE | `/api/settings/logo/:variant` | Admin | Remove logo |
| POST | `/api/settings/favicon` | Admin | Upload custom browser-tab favicon |
| DELETE | `/api/settings/favicon` | Admin | Remove custom favicon |
| POST | `/api/settings/theme` | Admin | Update accent colour, palette variants, default theme, mobile nav position |
| POST | `/api/settings/group-tab-color` | Admin | Toggle group-coloured active tabs on the public page |
| POST | `/api/settings/group-tabs-loop` | Admin | Toggle endless wrap-around scrolling of the public group tab strip |
| POST | `/api/settings/footer-enabled` | Admin | Show/hide the developer credit footer |
| POST | `/api/settings/pinned-group` | Admin | Pin a default group for the public page |
| POST | `/api/settings/public-password` | Admin | Set public password |
| DELETE | `/api/settings/public-password` | Admin | Remove public password |
| POST | `/api/settings/requests-enabled` | Admin | Enable/disable the public "Request link" feature |
| POST | `/api/settings/markdown-open-mode` | Admin | Whether a markdown link opens in a popup (the default) or a new tab |

### Accounts

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | Public | Sign in; sets the session cookie |
| POST | `/api/auth/logout` | Public | Sign out |
| POST | `/api/auth/logout-all` | User | End every other session |
| GET | `/api/auth/me` | Public | Who is signed in (200 with a null user when nobody is) |
| GET | `/api/auth/providers` | Public | The ways to sign in |
| POST | `/api/auth/password` | User | Change your own password |
| GET | `/api/auth/sessions` | User | Where you are signed in |
| DELETE | `/api/auth/sessions/:id` | User | End one of your sessions |
| GET | `/api/auth/oidc/start` | Public | Sign in with single sign-on (a browser navigation) |
| GET | `/api/auth/oidc/callback` | Public | Where the identity provider returns to |
| GET/DELETE | `/api/auth/identities` | User | Your connection to single sign-on, or disconnect it |
| GET/PUT | `/api/settings/oidc` | Admin | Single sign-on settings |
| POST | `/api/auth/forgot-password` | Public | Email yourself a reset link, when email is set up |
| GET/PUT | `/api/settings/mail` | Admin | Email (SMTP) settings |
| POST | `/api/settings/mail/test` | Admin | Send a test email |
| DELETE | `/api/users/:id/identities` | Admin | Disconnect an account from single sign-on |
| GET/PUT | `/api/groups/:id/managers` | Admin | A group's admins |
| POST | `/api/managed/links` | User | Add a link to a group you manage |
| PUT/DELETE | `/api/managed/links/:id` | User | Change or remove a link in groups you manage |
| GET | `/api/users` | Admin | List accounts |
| PATCH | `/api/users/:id` | Admin | Change a name, role, or whether the account is active |
| DELETE | `/api/users/:id` | Admin | Delete an account |
| POST | `/api/users/:id/password` | Admin | Set somebody's password directly |
| POST | `/api/users/:id/logout-all` | Admin | Sign somebody out everywhere |
| POST | `/api/users/:id/reset-link` | Admin | Issue a password-reset link |
| GET/POST | `/api/invites` | Admin | List or create invites |
| DELETE | `/api/invites/:id` | Admin | Revoke an invite |
| GET | `/api/tokens/:token` | Public | Check an invite or reset link |
| POST | `/api/tokens/:token/redeem` | Public | Accept an invite, or finish a reset |

### Your own page

Every route needs a signed-in member; the admin token has no personal page. Ids are your own, and an id that is not yours answers exactly as one that does not exist.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/my/data` | Your groups, links and storage use, in one response |
| GET | `/api/my/storage` | How much of your allowance you are using |
| GET | `/api/my/icons` | The shared icon library, to pick from |
| GET | `/api/my/export` | Your page as a file: groups, links and favourites (files stay here) |
| POST | `/api/my/import` | Merge an exported file into your page; repeats add nothing |
| POST | `/api/my/groups` | Add a group |
| PUT/DELETE | `/api/my/groups/:id` | Change or delete a group (its links are unfiled, not deleted) |
| POST | `/api/my/groups/reorder` | Put your groups in order |
| POST | `/api/my/groups/:id/sections` | Add a section |
| PUT/DELETE | `/api/my/sections/:id` | Rename or delete a section |
| POST | `/api/my/sections/reorder` | Put your sections in order |
| POST | `/api/my/links` | Add a link — a web address or a file (multipart) |
| PUT/DELETE | `/api/my/links/:id` | Change or delete a link |
| POST | `/api/my/links/reorder` | Put your links in order |
| GET | `/api/my/links/:id/icon` · `/favicon` · `/file` | A link's private files. A markdown file renders as a page; `?raw=1` for the source. |
| GET | `/api/my/favicon-preview?url=` | The icon a web address would get, before saving. Public addresses only. |
| GET | `/api/my/favorites` | Your starred shared links, in your order — filtered to what you can see now |
| POST/DELETE | `/api/my/favorites/:linkId` | Star or unstar a shared link |
| POST | `/api/my/favorites/reorder` | Put your favourites in order |

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/settings/user-quota` | Admin | How many megabytes each member may store |
| POST | `/api/settings/require-login` | Admin | Make the public page members-only |
| POST | `/api/settings/wallpaper/:variant` | Admin | Upload the public page wallpaper (`light` or `dark`) |
| DELETE | `/api/settings/wallpaper/:variant` | Admin | Remove a wallpaper |
| POST | `/api/settings/wallpaper-fog` | Admin | How heavily the wallpaper is veiled and blurred (0–100) |
| POST | `/api/settings/bar-opacity` | Admin | How solid the header, tab strip and footer are (0–100) |
| POST | `/api/settings/request-password` | Admin | Set the password required to submit a request |
| DELETE | `/api/settings/request-password` | Admin | Remove the request password |
| POST | `/api/settings/save-favicons` | Admin | Toggle auto-save of fetched favicons into the icon library |
| GET | `/api/icons` | Admin | List every icon in the reusable library with usage counts |
| POST | `/api/icons` | Admin | Upload a new icon directly into the library |
| DELETE | `/api/icons/:id` | Admin | Delete an icon (also clears it from any link using it) |
| POST | `/api/icons/bulk-delete` | Admin | Delete multiple icons at once |
| GET | `/api/icons/export` | Admin | Export the whole icon library as a self-contained JSON bundle |
| POST | `/api/icons/import` | Admin | Import an icon-library bundle (idempotent, de-duped by content) |
| GET | `/api/favicon-preview` | Admin | Server-side favicon fetch used by the link form's live preview |
| GET | `/api/version` | Admin | Check current build against the latest GitHub release |
| GET | `/api/changelog` | Admin | Release notes parsed from `CHANGELOG.md` (what the admin sidebar renders) |
| GET | `/api/audit` | Admin | List audit-log entries (search, type filter, pagination) |
| DELETE | `/api/audit` | Admin | Clear the audit log (or prune with `?days=N`) |
| GET | `/api/audit/export` | Admin | Export the audit log as CSV or JSON |
| GET | `/api/events` | — | Server-Sent Events stream — fires whenever data changes, so the public page can fade-refresh in real time |
| GET | `/api/links` | Public | List all links (honors `is_hidden`, group locks, and public password) |
| POST | `/api/links` | Admin | Create a link (URL or file upload) |
| PUT | `/api/links/:id` | Admin | Update a link (URL or file upload) |
| POST | `/api/links/:id/visibility` | Admin | Toggle a link's public visibility |
| DELETE | `/api/links/:id` | Admin | Delete a link |
| GET | `/api/links/:id/file` | Admin | Read an attached text file's contents (for the editor) |
| PUT | `/api/links/:id/file` | Admin | Save edited contents back to an attached text file |
| POST | `/api/links/reorder` | Admin | Save new link order |
| POST | `/api/links/bulk-delete` | Admin | Delete multiple links |
| GET | `/api/links/export` | Admin | Export links, groups, sections & subsections as JSON |
| POST | `/api/links/import` | Admin | Import from JSON (idempotent — creates only what's missing) |
| GET | `/api/links/:id/clicks` | Admin | Click detail for a link |
| GET | `/api/groups` | Public | List all groups (with nested sections/subsections) |
| POST | `/api/groups` | Admin | Create a group |
| PUT | `/api/groups/:id` | Admin | Update a group (name, color, password, unlock mode) |
| DELETE | `/api/groups/:id` | Admin | Delete a group |
| POST | `/api/groups/reorder` | Admin | Save new group order |
| POST | `/api/groups/:id/unlock` | — | Unlock a password-protected group (issues a signed cookie) |
| POST | `/api/groups/:id/lock` | — | Lock a group (clears the unlock cookie) |
| POST | `/api/groups/:id/sections` | Admin | Create a section (or subsection, via `parent_section_id`) in a group |
| PUT | `/api/sections/:id` | Admin | Rename a section |
| DELETE | `/api/sections/:id` | Admin | Delete a section (and its subsections) |
| POST | `/api/sections/reorder` | Admin | Save new section/subsection order |
| GET | `/api/stats` | Admin | Aggregate click stats for all links |
| GET | `/api/analytics` | Admin | Dashboard aggregates for a period (`?period=30d`) |
| POST | `/api/link-requests` | — | Submit a link request (rate-limited; honors the request password) |
| GET | `/api/link-requests` | Admin | List requests (`?status=pending\|approved\|rejected\|all`), flagged with any existing link at the same URL |
| POST | `/api/link-requests/:id/approve` | Admin | Mark a request approved and record the published link |
| POST | `/api/link-requests/:id/attach` | Admin | Approve without duplicating — add the existing link to the requested group |
| POST | `/api/link-requests/:id/apply` | Admin | Apply a change request to the link it targets |
| POST | `/api/link-requests/:id/reject` | Admin | Reject a request (an unpublished upload is deleted) |
| DELETE | `/api/link-requests/:id` | Admin | Delete a request |
| GET | `/api/ip-tags` | Admin | List every IP seen, with its attribution tag |
| POST | `/api/ip-tags` | Admin | Tag an IP with a human-readable name |
| DELETE | `/api/ip-tags/:ip` | Admin | Remove an IP tag |
| GET | `/r/:id` | — | Redirect (or stream a file attachment) and record the click |

## Licensing

linkPage uses a **dual-licensing / open-core** model. See [LICENSE](LICENSE),
[NOTICE](NOTICE), and [ee/LICENSE](ee/LICENSE) for the authoritative terms.

Every feature described in this README is core, under the AGPL. `ee/` currently
holds only its licence — the terms below are what will govern enterprise modules
when they ship, so nothing here is gated today.

| | Core | Enterprise (`ee/`) |
|---|---|---|
| **Licence** | GNU AGPL-3.0-or-later | Proprietary (`LicenseRef-linkPage-Enterprise`) |
| **SPDX id** | `AGPL-3.0-or-later` | `LicenseRef-linkPage-Enterprise` |
| **Scope** | Everything outside `ee/` | The `ee/` directory only |
| **Source available** | Yes (free software) | Yes — evaluation & security review only |
| **Production use** | Free, under the AGPL | Requires a paid subscription |
| **Redistribution / resale** | Allowed under the AGPL | Not permitted |
| **Host as a service** | Allowed (AGPL source-disclosure applies) | Not permitted |
| **Key obligation** | Network use ⇒ offer your modified source to users | Keep licence-key verification intact |

> **AGPL note:** if you run a modified version of the core to provide a network
> service, the AGPL requires you to make your modified source available to that
> service's users.

**Need terms other than the AGPL?** A separate **commercial licence** for the
core is available for users who cannot comply with the AGPL. Contact
**tomasneto26@gmail.com**.

Contributions require signing the [Contributor License Agreement](CLA.md) — see
[CONTRIBUTING.md](CONTRIBUTING.md).
