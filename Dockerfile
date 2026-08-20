# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tomás Neto
FROM node:24-alpine

WORKDIR /app

# package-lock.json is copied too so `npm ci` installs the exact, audited tree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
# Served to the admin sidebar through /api/changelog.
COPY CHANGELOG.md ./

ENV PORT=3000
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/data/uploads

# The data directory is created up front and handed to the unprivileged `node`
# user that ships with the base image, so the server never needs root. An
# existing bind mount keeps its host ownership, so installs created by an older
# root-running image need one `chown -R 1000:1000 ./linkpage_data` (see README).
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node

EXPOSE 3000

VOLUME ["/app/data"]

# Marks the container unhealthy if the HTTP layer stops answering. Uses the
# public settings endpoint: no token needed, and it touches the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
