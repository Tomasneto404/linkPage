// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * In-app changelog.
 *
 * CHANGELOG.md at the repo root is the single source of truth: the admin
 * sidebar renders it, the release workflow lifts the pushed tag's section out
 * of it for the GitHub release notes, and CI refuses a tag whose section is
 * missing. Nothing here is versioned by hand — the only per-release edits are
 * `version` in package.json and a new section in that file.
 *
 * Expected shape (newest release first):
 *
 *   ## v1.0.4
 *   ### Entry title
 *   One paragraph describing it.
 *
 * Parsed on first read and re-parsed whenever the file's mtime changes, so a
 * bind-mounted edit shows up without a restart.
 */

const fs   = require('node:fs');
const path = require('node:path');

const CHANGELOG_PATH = path.join(__dirname, '..', '..', 'CHANGELOG.md');

let cache = null;   // { mtimeMs, releases }

/** Splits the markdown into [{ version, entries: [{ title, description }] }]. */
function parseChangelog(markdown) {
  const releases = [];
  let release = null;
  let entry   = null;

  const flushEntry = () => {
    if (!entry) return;
    entry.description = entry.lines.join(' ').replace(/\s+/g, ' ').trim();
    delete entry.lines;
    release.entries.push(entry);
    entry = null;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();

    const releaseHeading = line.match(/^##\s+(v?\d+\.\d+\.\d+[^\s]*)\s*$/);
    if (releaseHeading) {
      flushEntry();
      release = { version: releaseHeading[1].replace(/^v/, ''), entries: [] };
      releases.push(release);
      continue;
    }

    const entryHeading = line.match(/^###\s+(.+?)\s*$/);
    if (entryHeading && release) {
      flushEntry();
      entry = { title: entryHeading[1], lines: [] };
      continue;
    }

    // Anything before the first release heading (the file's own preamble) is
    // documentation for maintainers, not release notes.
    if (entry && line) entry.lines.push(line);
  }
  flushEntry();

  return releases.filter(r => r.entries.length);
}

/** Cached parse. Returns [] when the file is absent (e.g. a trimmed image). */
function getReleases() {
  let stat;
  try {
    stat = fs.statSync(CHANGELOG_PATH);
  } catch {
    return [];
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.releases;

  try {
    const releases = parseChangelog(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, releases };
    return releases;
  } catch {
    return [];
  }
}

module.exports = { getReleases, parseChangelog, CHANGELOG_PATH };
