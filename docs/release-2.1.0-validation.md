# LinkPage 2.1.0 validation

The release uses schema version 24. Upgrading the application and changing database engines are separate choices; the [SQLite migration guide](sqlite-to-postgresql.md) describes the latter.

## Local checks

| Check | Result |
| --- | --- |
| SQLite/API suite | 897 passed; the PostgreSQL-only driver test is skipped in this run |
| PostgreSQL suite | 884 passed in isolated schemas |
| Chromium browser suite | 87 passed, including desktop and mobile emulation; five targeted release checks also passed after the transition fix |
| Installed Firefox 159 | Five release checks passed at desktop and narrow viewport sizes, using WebDriver BiDi |
| Docker production candidate | Published 2.0.0 SQLite fixture imported into PostgreSQL with every original table checked |
| File and credential preservation | SQLite bytes, uploads, private files, administrator token and signing secrets retained |
| Authentication and access | Existing session, existing password, private group access and guarded personal attachments checked |
| Backups | PostgreSQL download/import/restore, recovery copy, session invalidation and SQLite restore checked |
| Explicit migration | The command included in the image imports with Compose `DB_ENGINE`/`PG*` settings and refuses occupied targets |
| Migration startup guards | Missing sources and an unselected migration over an existing SQLite directory are refused |
| Runtime | HTTP healthcheck passes and the application process runs as UID 1000 |
| Documentation | Local document/image links checked; 33 new screenshots generated from a disposable demonstration instance |

The Docker script uses uniquely named temporary resources and preserves its report and test backups under `.cache/production-*`. It never uses the development instance's database or data directory.

## Release gates

GitHub Actions runs the API suite, PostgreSQL suite and complete Chromium browser suite. Separate Firefox and WebKit jobs test public navigation, search, Markdown, PWA assets, Settings, background configuration, widget resizing, Workspace and analytics at desktop and narrow widths, plus interrupted theme transitions. The production job builds the candidate and repeats the 2.0.0 migration/recovery procedure. Repository, base-image and built-image vulnerability checks gate publication.

Only a matching stable version tag publishes the multi-platform image and `latest`. Tag, package version and CHANGELOG section must agree. The GitHub Release is created after the image build and push succeed.

## Device boundaries

Narrow viewports and mobile emulation are automated tests, not physical-device certification. No physical iPhone or Android test session was available during local validation. The installed Safari refused automation because “Allow remote automation” is disabled; enabling it required administrator authentication. WebKit coverage in the release workflow exercises the rendering engine and does not certify the installed Safari application's UI or home-screen installation on an actual iPhone.

For a manual physical-device check, verify sign-in, group navigation, search, modal scrolling, file creation/editing, touch ordering, theme selection, reduced motion and PWA installation over HTTPS. Keep these checks distinct from the automated results above.
