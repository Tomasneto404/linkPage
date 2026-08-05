#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tomás Neto
#
# Idempotently add SPDX license headers to first-party source files.
#
# Core files (everything outside ee/) get the AGPL-3.0-or-later header; files
# under ee/ get the proprietary Enterprise header. Safe to run repeatedly (e.g.
# in CI): any file that already carries an SPDX identifier in its first lines is
# left untouched. Shebang lines, a line-1 "use strict" directive, and an HTML
# <!DOCTYPE> are preserved — the header is inserted immediately after them.
#
# Usage: bash scripts/add-license-headers.sh
set -euo pipefail
cd "$(dirname "$0")/.."

COPYRIGHT="Copyright (C) 2026 Tomás Neto"
CORE_SPDX="AGPL-3.0-or-later"
EE_SPDX="LicenseRef-linkPage-Enterprise"

added=0
skipped=0

emit_header() {
  # $1 = comment style, $2 = SPDX id, $3 = copyright line
  local style="$1" spdx="$2" copy="$3"
  case "$style" in
    slash) printf '// SPDX-License-Identifier: %s\n// %s\n' "$spdx" "$copy" ;;
    hash)  printf '# SPDX-License-Identifier: %s\n# %s\n' "$spdx" "$copy" ;;
    dash)  printf -- '-- SPDX-License-Identifier: %s\n-- %s\n' "$spdx" "$copy" ;;
    block) printf '/* SPDX-License-Identifier: %s */\n/* %s */\n' "$spdx" "$copy" ;;
    html)  printf '<!-- SPDX-License-Identifier: %s -->\n<!-- %s -->\n' "$spdx" "$copy" ;;
  esac
}

process() {
  local f="$1"

  # Never touch generated / vendored artifacts.
  case "$(basename "$f")" in
    package-lock.json|pnpm-lock.yaml|*.min.js|*.min.css) skipped=$((skipped+1)); return ;;
  esac

  # Idempotent: skip if an SPDX id already appears near the top.
  if head -5 "$f" | grep -q 'SPDX-License-Identifier:'; then
    skipped=$((skipped+1)); return
  fi

  local ext="${f##*.}" style
  case "$ext" in
    js|mjs|cjs|ts|jsx|tsx) style=slash ;;
    css)                   style=block ;;
    html|htm)              style=html ;;
    py|sh|yml|yaml)        style=hash ;;
    sql)                   style=dash ;;
    *) skipped=$((skipped+1)); return ;;
  esac

  local spdx copy
  case "$f" in
    ee/*|./ee/*) spdx="$EE_SPDX"; copy="$COPYRIGHT. All rights reserved." ;;
    *)           spdx="$CORE_SPDX"; copy="$COPYRIGHT" ;;
  esac

  local first keep_first=0
  first="$(head -1 "$f")"
  if printf '%s' "$first" | grep -qE '^#!'; then
    keep_first=1
  elif printf '%s' "$first" | grep -qiE '^[[:space:]]*(["'\'']use strict["'\''])[[:space:]]*;?[[:space:]]*$'; then
    keep_first=1
  elif [ "$style" = html ] && printf '%s' "$first" | grep -qiE '^[[:space:]]*<!doctype'; then
    keep_first=1
  fi

  local tmp; tmp="$(mktemp)"
  if [ "$keep_first" -eq 1 ]; then
    { printf '%s\n' "$first"; emit_header "$style" "$spdx" "$copy"; tail -n +2 "$f"; } > "$tmp"
  else
    { emit_header "$style" "$spdx" "$copy"; cat "$f"; } > "$tmp"
  fi
  cat "$tmp" > "$f"
  rm -f "$tmp"
  added=$((added+1))
  echo "  + $f"
}

# First-party source in scope: src/, public/, tests/, scripts/, .github
# workflows, and the root docker-compose files. node_modules/.git/data pruned.
while IFS= read -r -d '' f; do
  process "$f"
done < <(
  find . \
    \( -path ./node_modules -o -path ./.git -o -path ./data -o -path ./linkPagePrints \) -prune -o \
    -type f \( \
      -name '*.js'  -o -name '*.mjs' -o -name '*.cjs' -o -name '*.ts' \
      -o -name '*.jsx' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' \
      -o -name '*.py' -o -name '*.sh' -o -name '*.sql' \
      -o -name '*.yml' -o -name '*.yaml' \
    \) -print0
)

echo "Done. Headers added: ${added}, skipped (already present or ignored): ${skipped}"
