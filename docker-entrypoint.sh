#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tomás Neto
#
# Drops the server to an unprivileged user without making the operator prepare
# the volume first.
#
# A bind mount arrives owned by whoever created it on the host — root, when
# Docker creates ./linkpage_data itself — so a container that starts as uid 1000
# cannot even mkdir inside it. Starting as root, fixing ownership, then handing
# off with su-exec keeps the node process unprivileged while `docker compose up`
# still works on a clean host with no manual chown.
#
# Anyone who would rather not grant that momentary root can pin the uid
# themselves (`user: "1000:1000"` in compose, or --user): this script sees it is
# already unprivileged and execs straight through.
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
UPLOADS_DIR="${UPLOADS_DIR:-$DATA_DIR/uploads}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$UPLOADS_DIR"

  # Recursive chown is skipped when the top directory already belongs to us —
  # a large uploads/ tree shouldn't be walked on every restart.
  owner="$(stat -c %u "$DATA_DIR" 2>/dev/null || echo unknown)"
  if [ "$owner" != "$(id -u node)" ]; then
    echo "[entrypoint] claiming $DATA_DIR for the node user (was uid $owner)"
    chown -R node:node "$DATA_DIR"
  fi

  exec su-exec node:node "$@"
fi

# Already running as a non-root user: the operator picked the uid, so respect it
# — but say why we are stuck instead of letting node throw a bare EACCES. Docker
# creates a fresh named volume owned by root, so a pinned uid needs it handed
# over once.
if ! mkdir -p "$DATA_DIR" "$UPLOADS_DIR" 2>/dev/null || [ ! -w "$DATA_DIR" ]; then
  echo "[entrypoint] $DATA_DIR is not writable by uid $(id -u)." >&2
  echo "[entrypoint] This container was started with an explicit user, so it cannot" >&2
  echo "[entrypoint] take ownership itself. Either drop the user override and let the" >&2
  echo "[entrypoint] entrypoint do it, or hand the volume over once:" >&2
  echo "[entrypoint]   docker run --rm -v <volume-or-path>:/data alpine chown -R $(id -u):$(id -g) /data" >&2
  exit 1
fi
exec "$@"
