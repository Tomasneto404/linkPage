# Moving an existing SQLite installation to PostgreSQL

LinkPage 2.1.0 supports both engines. An existing installation can continue using SQLite by upgrading its image without adding PostgreSQL connection variables. Moving to PostgreSQL is a separate, explicit operation.

The importer reads the existing SQLite database, copies its rows into an empty PostgreSQL target, checks row counts and content in a transaction, and retains row IDs and identity sequences. It accepts older LinkPage schemas and creates the new schema fields during import. A failed import rolls back the target. The source `links.db` is opened read-only.

Keep the same complete application data directory. Accounts, password hashes, sessions, groups, permissions, settings, links, analytics and workspace data live in the database. Uploaded files, private attachments, administrator tokens and signing secrets still live in the application data directory. Moving only `links.db` is insufficient.

## Docker Compose: upgrading from the published 2.0.0 image

Run the commands from the directory containing your current Compose file. The examples use the `linkpage` service, `docker-compose.prod.yml`, and the bind mount `./linkpage_data:/app/data`. Adapt those names to your installation before running them.

### 1. Identify and back up the existing data

Check the current Compose configuration and the volume mounted at `/app/data`. If you use a named volume or a different host directory, retain that exact mount in the new configuration. An empty replacement directory would be a new installation.

Stop the old application so SQLite and its uploaded files stop changing:

```bash
docker compose -f docker-compose.prod.yml stop linkpage
```

Save the current Compose file and copy the **entire** application data directory, including hidden files and any SQLite journal files:

```bash
cp docker-compose.prod.yml docker-compose.before-postgres.yml
tar -czf linkpage-before-postgres.tar.gz linkpage_data
```

For a Docker named volume, make a stopped-volume backup using your normal volume backup procedure instead of the `tar` command above. Keep the backup outside the mounted application directory. Retain the old image tag and `.env` file too; the database password is not a substitute for the application signing secrets.

### 2. Add PostgreSQL and keep the same application mount

Use the [2.1.0 production Compose file](../docker-compose.prod.yml), or add its PostgreSQL service and connection variables to your existing configuration. Keep your ports, reverse proxy, custom environment settings and original `/app/data` mount.

Set a strong PostgreSQL password in your existing `.env`; retain any other variables already in that file:

```dotenv
POSTGRES_PASSWORD=replace-with-a-long-random-password
MIGRATE_SQLITE=1
```

The application service must use the 2.1.0 image and point at the new database:

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
      - ./linkpage_data:/app/data # retain YOUR existing mount
    restart: unless-stopped
    environment:
      PORT: "3000"
      DATA_DIR: /app/data
      UPLOADS_DIR: /app/data/uploads
      DB_ENGINE: postgresql
      PGHOST: postgres
      PGPORT: "5432"
      PGDATABASE: linkpage
      PGUSER: linkpage
      PGPASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      MIGRATE_SQLITE: ${MIGRATE_SQLITE:-0}
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

The database service stays on the Compose network; it does not need a host port. `postgres_data` is a new database volume. It does not replace the application data mount. PostgreSQL 18 uses the `/var/lib/postgresql` mount shown above.

### 3. Start the import once

The target PostgreSQL database must be empty. Do not start the application against this target without migration enabled first; that would create first-run data. LinkPage refuses to start a new PostgreSQL installation over an existing SQLite directory until you explicitly select a migration method.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs --tail=100 linkpage
```

A successful import logs a line like:

```text
[db] SQLite → PostgreSQL: verified 654 rows. Source database preserved.
```

The number depends on your data. Startup logs also contain access credentials: keep them private. If the source is missing or the target already contains data, the application stops with an explanation instead of silently creating an empty page. Do not delete an occupied database or its volume to work around an error; inspect the connection and mounts first.

### 4. Verify and disable automatic import

Open the app and verify:

- Existing administrator and member accounts can sign in, including single sign-on when configured.
- Links, groups, order, passwords, private groups and assigned roles are present.
- Shared and personal attachments open; Markdown renders; uploaded icons and branding appear.
- Widgets, appearance settings, analytics, presets and version history are present where available in the source version.
- A new link can be created and remains after restarting the application.

You can inspect basic counts directly in PostgreSQL:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U linkpage -d linkpage \
  -c 'SELECT (SELECT COUNT(*) FROM users) AS accounts, (SELECT COUNT(*) FROM groups) AS groups, (SELECT COUNT(*) FROM links) AS links;'
```

After the import is verified, set `MIGRATE_SQLITE=0` in `.env` and recreate the application service:

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps linkpage
```

The PostgreSQL data is now authoritative. Keep the original SQLite file and the stopped-installation backup until the upgrade is accepted. The importer does not keep SQLite synchronised with subsequent PostgreSQL writes.

## Alternative: run the importer explicitly

Choose this method **instead of** automatic import. Keep the application stopped, set `MIGRATE_SQLITE=0`, and start only PostgreSQL:

```bash
docker compose -f docker-compose.prod.yml up -d --wait postgres
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -e MIGRATE_SQLITE=0 linkpage npm run db:migrate -- /app/data/links.db
docker compose -f docker-compose.prod.yml up -d linkpage
```

The importer is included in the published image. It accepts the Compose `DB_ENGINE`/`PG*` variables or `DATABASE_URL`, verifies the imported data, marks the import complete and exits. Running it again against an occupied target is refused.

For a Node installation, install the 2.1.0 code and dependencies, stop the app, retain the same `DATA_DIR`, and use one of these methods:

```bash
# Automatic import; supply the connection through your environment manager:
DATA_DIR=/path/to/existing/data DATABASE_URL='postgresql://user:password@host:5432/linkpage' MIGRATE_SQLITE=1 npm start

# Explicit import, before starting the app:
DATA_DIR=/path/to/existing/data DATABASE_URL='postgresql://user:password@host:5432/linkpage' npm run db:migrate -- /path/to/existing/data/links.db
```

URL-encode special characters if using `DATABASE_URL`, or use separate `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and `PGPASSWORD` variables with `DB_ENGINE=postgresql`. `npm run db:migrate` loads `.env`; `npm start` expects its variables in the process environment. Supply real credentials through your normal secret configuration rather than saving them in source control.

## Backups after migration

Backing up `links.db` no longer backs up the active database. Retain the application directory **and** a PostgreSQL backup.

Workspace full backups include a logical database snapshot with shared/private attachments and icons. Download them to separate storage. Restores require the same schema version and preserve the current instance's administrator token. Also retain an external copy of the application data directory so signing secrets and token files are available after a host failure.

For a native PostgreSQL dump plus files, stop application writes while taking the pair:

```bash
docker compose -f docker-compose.prod.yml stop linkpage
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U linkpage -d linkpage -Fc > linkpage-postgres.dump
tar -czf linkpage-files-and-secrets.tar.gz linkpage_data
docker compose -f docker-compose.prod.yml start linkpage
```

Retain the PostgreSQL volume across normal updates. `docker compose down` keeps named volumes; `docker compose down -v` removes them and must not be used as an upgrade step.

## Returning to the previous installation

Before accepting new writes, you can stop the 2.1.0 application and restore the old Compose configuration, old image and complete stopped-directory backup as one set. The original SQLite source remains available.

After PostgreSQL has accepted writes, switching back to the old SQLite copy loses those new changes. Keep the PostgreSQL database and files together and use a verified recovery plan; there is no automatic reverse migration. An older application image must not be pointed at a database upgraded by a newer version.
