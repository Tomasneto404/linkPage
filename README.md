# LinkPage

A modern, self-hosted WebUI designed for enterprises to centralize and publish internal or external links/URLs for employees, collaborators, and clients.

Instead of scattering important resources across emails, chats, and shared drives, LinkPage provides a single branded landing page (e.g. `linkpage.company.com`) where teams can quickly access everything they need — from internal tools and documentation to public-facing resources.

---

## Features

- **Public page** — clean, searchable landing page for end users with group tabs and live search
- **Admin panel** — full link and group management behind a secure token gate
- **Click analytics** — per-link stats: total clicks, unique visitors, today/week counts, top IPs
- **Broken link checker** — automatic health check every 6 hours, flags dead links in the admin
- **Custom branding** — upload separate logos for light and dark mode, set a custom site title
- **Server-side favicon cache** — favicons downloaded and stored locally, no external requests on page load
- **Drag-to-reorder** — reorder links and groups by dragging
- **Bulk actions** — multi-select links to delete or move to a group at once
- **Import / Export** — backup and restore links as JSON
- **Public password gate** — optionally protect the public page with a password
- **Light & dark mode** — Apple-style design with OS preference detection
- **Docker ready** — single `docker compose up` to deploy with persistent storage

---

## How It Works

### Architecture

```
linkPage/
├── src/
│   ├── server.js      # Express API + static file serving
│   └── database.js    # SQLite setup and all data access functions
├── public/
│   ├── index.html     # Public page (end users)
│   ├── app.js         # Public page logic
│   ├── style.css      # Shared Apple-style theme (CSS variables)
│   └── admin/
│       ├── index.html # Admin panel
│       ├── admin.js   # Admin panel logic
│       └── admin.css  # Admin-specific styles
├── Dockerfile
└── docker-compose.yml
```

### Data Storage

All persistent data lives in `/app/data` inside the container, mapped to `./linkpage_data` on the host:

| Path | Purpose |
|------|---------|
| `data/links.db` | SQLite database — links, groups, settings, click analytics |
| `data/admin-token.txt` | Admin token generated on first startup |
| `data/uploads/` | Uploaded images, logos, and cached favicons |

### Authentication

There is no login system. On first startup the server generates a 64-character hex token and saves it to `data/admin-token.txt`. This token must be entered in the admin panel to unlock management features. It is stored in your browser's `localStorage` and can be rotated from the admin settings at any time.

### Click Tracking

Every link card points to `/r/:id` (a server-side redirect) instead of the destination URL directly. The server records the click — IP address, user agent, timestamp — in SQLite before redirecting. This works without JavaScript and is not blocked by ad blockers.

---

## Deployment with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed

---

### Option A — Pull from Docker Hub (recommended)

The easiest way to run LinkPage. No need to clone the repository or build anything.

**`docker-compose.prod.yml`**

```yaml
services:
  linkpage:
    image: tomasneto26/linkpage:latest
    ports:
      - "3000:3000"
    volumes:
      - ./linkpage_data:/app/data
    restart: unless-stopped
    environment:
      - PORT=3000
      - DATA_DIR=/app/data
      - UPLOADS_DIR=/app/data/uploads
```

**1. Create the file**

```bash
curl -O https://raw.githubusercontent.com/Tomasneto404/linkPage/main/docker-compose.prod.yml
```

Or create it manually with the contents above.

**2. Start the app**

```bash
docker compose -f docker-compose.prod.yml up -d
```

Docker will pull the image from Docker Hub automatically and start the container.

**3. Get your admin token**

```bash
docker compose -f docker-compose.prod.yml logs linkpage
```

Look for a line like:

```
│  🔑 Admin Token: 5c5665cfeaf662e95f98e832e2cdbaa3c2ab5d0b...
```

Copy the full token. It is saved to `linkpage_data/admin-token.txt` and reused across restarts.

**4. Open the app**

| Page | URL |
|------|-----|
| Public page | http://localhost:3000 |
| Admin panel | http://localhost:3000/admin |

Paste the token into the admin panel to unlock link management.

**Updating to the latest image**

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

### Option B — Build from source

Clone the repository and build the image locally.

**`docker-compose.yml`**

```yaml
services:
  linkpage:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./linkpage_data:/app/data
    restart: unless-stopped
    environment:
      - PORT=3000
      - DATA_DIR=/app/data
      - UPLOADS_DIR=/app/data/uploads

volumes:
  linkpage_data:
```

**Steps**

```bash
git clone https://github.com/Tomasneto404/linkPage.git
cd linkPage
docker compose up -d
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

### Full reset (wipes all data)

```bash
docker compose down -v
docker compose up -d
```

A new admin token will be generated on the next startup.

---

## Running Without Docker

### Prerequisites

- [Node.js 24+](https://nodejs.org/)

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

---

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `./data` | Directory for the database and admin token file |
| `UPLOADS_DIR` | `./data/uploads` | Directory for uploaded images and cached favicons |

---

## API Overview

Read endpoints are public. All write endpoints require the `X-Admin-Token` header.  
If a public password is configured, read endpoints also require an `X-Public-Password` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/verify` | — | Verify admin token |
| POST | `/api/auth/verify-public` | — | Verify public password |
| POST | `/api/auth/rotate-token` | Admin | Generate a new admin token |
| GET | `/api/settings` | — | Get site title, logos, password status |
| POST | `/api/settings/site-title` | Admin | Set the site title |
| POST | `/api/settings/logo/:variant` | Admin | Upload logo (`light` or `dark`) |
| DELETE | `/api/settings/logo/:variant` | Admin | Remove logo |
| POST | `/api/settings/public-password` | Admin | Set public password |
| DELETE | `/api/settings/public-password` | Admin | Remove public password |
| GET | `/api/links` | Public | List all links |
| POST | `/api/links` | Admin | Create a link |
| PUT | `/api/links/:id` | Admin | Update a link |
| DELETE | `/api/links/:id` | Admin | Delete a link |
| POST | `/api/links/reorder` | Admin | Save new link order |
| POST | `/api/links/bulk-delete` | Admin | Delete multiple links |
| GET | `/api/links/export` | Admin | Export all links as JSON |
| POST | `/api/links/import` | Admin | Import links from JSON |
| GET | `/api/links/:id/clicks` | Admin | Click detail for a link |
| GET | `/api/groups` | Public | List all groups |
| POST | `/api/groups` | Admin | Create a group |
| PUT | `/api/groups/:id` | Admin | Update a group |
| DELETE | `/api/groups/:id` | Admin | Delete a group |
| POST | `/api/groups/reorder` | Admin | Save new group order |
| GET | `/api/stats` | Admin | Aggregate click stats for all links |
| GET | `/r/:id` | — | Redirect and record click |
