# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tomás Neto
FROM node:24-alpine

# su-exec lets the entrypoint hand the server to an unprivileged user after it
# has prepared the data volume (see docker-entrypoint.sh).
RUN apk add --no-cache su-exec

WORKDIR /app

# package-lock.json is copied too so `npm ci` installs the exact, audited tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
# Served to the admin sidebar through /api/changelog.
COPY CHANGELOG.md ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/data/uploads

EXPOSE 3000

VOLUME ["/app/data"]

# Marks the container unhealthy if the HTTP layer stops answering. Uses the
# public settings endpoint: no token needed, and it touches the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The entrypoint starts as root only to take ownership of the volume, then
# execs the server as the `node` user — so the long-running process is never
# root, and no manual chown is needed on a fresh host.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/server.js"]
