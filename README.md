# LinkPage

A self-hosted link bookmark manager with a clean, Apple-inspired UI. Organize your links into groups, track click analytics, and manage everything through a secure admin panel.

## Features

- **Public page** — read-only view of all links, searchable and grouped
- **Admin panel** — full CRUD for links and groups, protected by a token
- **Click analytics** — tracks clicks per link with source IP, device type, and timestamps
- **Custom branding** — upload separate logos for light and dark mode
- **Auto favicon** — fetches website icons automatically via Google Favicon API
- **Light & dark mode** — Apple-style design with theme toggle
- **Docker ready** — single `docker compose up` deployment with persistent storage

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

All persistent data lives in `/app/data` inside the container (mapped to `./linkpage_data` on the host):

| File | Purpose |
|------|---------|
| `data/links.db` | SQLite database (links, groups, settings, click analytics) |
| `data/admin-token.txt` | Admin token generated on first startup |
| `data/uploads/` | Uploaded images and logos |

### Authentication

There is no login system. On first startup, the server generates a 64-character hex token and saves it to `data/admin-token.txt`. This token must be entered in the admin panel to unlock management features. It is stored only in your browser's `localStorage`.

### Click Tracking

Every link card points to `/r/:id` (a server-side redirect) instead of the destination URL directly. The server records the click (IP, user agent, timestamp) in SQLite before redirecting. This approach works without JavaScript and is not blocked by ad blockers.

---

## Deployment with Docker

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/Tomasneto404/linkPage.git
cd linkPage
```

**2. Start the app**

```bash
docker compose up -d
```

This will:
- Build the image from the `Dockerfile`
- Create a persistent named volume (`linkpage_data`) for the database and uploads
- Start the container on port `3000`

**3. Get your admin token**

```bash
docker compose logs linkpage
```

Look for a line like:

```
Admin token: 08aa5af74e7942af65d3038dd65fe384304711e9d96007fe9d563cb7778571d5
```

You only need to do this once. The token is saved and reused across restarts.

**4. Open the app**

- Public page: [http://localhost:3000](http://localhost:3000)
- Admin panel: [http://localhost:3000/admin](http://localhost:3000/admin)

Enter the token in the admin panel to start managing links.

---

## Updating

When you pull new code changes, rebuild the image:

```bash
docker compose down
docker compose up -d --build
```

Your data is safe — it lives in the named volume, not the image.

### Full reset (wipes all data)

```bash
docker compose down -v
docker compose up -d
```

A new admin token will be generated.

---

## Running Without Docker

### Prerequisites

- [Node.js 24+](https://nodejs.org/)

### Steps

```bash
npm install
npm start
```

The app will start on port `3000`. On first run it creates `data/links.db` and `data/admin-token.txt` in the project root.

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
| `DATA_DIR` | `./data` | Directory for the database and token file |
| `UPLOADS_DIR` | `./data/uploads` | Directory for uploaded images |

---

## API Overview

All write endpoints require the `X-Admin-Token` header.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/verify` | No | Verify admin token |
| GET | `/api/links` | No | List all links |
| POST | `/api/links` | Yes | Create a link |
| PUT | `/api/links/:id` | Yes | Update a link |
| DELETE | `/api/links/:id` | Yes | Delete a link |
| GET | `/api/groups` | No | List all groups |
| POST | `/api/groups` | Yes | Create a group |
| PUT | `/api/groups/:id` | Yes | Update a group |
| DELETE | `/api/groups/:id` | Yes | Delete a group |
| GET | `/api/settings` | No | Get logo settings |
| POST | `/api/settings/logo/:variant` | Yes | Upload logo (`light` or `dark`) |
| DELETE | `/api/settings/logo/:variant` | Yes | Remove logo |
| GET | `/api/stats` | Yes | Get click stats for all links |
| GET | `/api/links/:id/clicks` | Yes | Get click detail for a link |
| GET | `/r/:id` | No | Redirect and record click |
