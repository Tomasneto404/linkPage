/**
 * Version / update check.
 *
 * Polls GitHub Releases for newer tags. Cached in-process so the admin page
 * can hit /api/version on every load without burning GitHub's 60/hour
 * anonymous rate limit. Cache TTL is generous (6 h) because LinkPage updates
 * aren't time-sensitive — if a release just dropped the admin can refresh.
 */

const { RELEASES_REPO, CURRENT_VERSION } = require('../config/env');

const VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let versionCache = null;     // { fetchedAt, data }

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.\-]/).map(s => Number(s) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.\-]/).map(s => Number(s) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const dbb = pb[i] || 0;
    if (da > dbb) return 1;
    if (da < dbb) return -1;
  }
  return 0;
}

async function fetchReleasesFromGitHub() {
  const url = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'Accept':        'application/vnd.github+json',
        'User-Agent':    `LinkPage/${CURRENT_VERSION}`,
        // Help the GitHub API stay forward-compatible.
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list)) return null;
    return list
      .filter(r => r && !r.draft && !r.prerelease)
      .map(r => ({
        tag:          r.tag_name,
        name:         r.name,
        body:         r.body,
        published_at: r.published_at,
        html_url:     r.html_url,
      }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function buildVersionPayload({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && versionCache && (now - versionCache.fetchedAt) < VERSION_CACHE_TTL_MS) {
    return versionCache.data;
  }
  const releases = await fetchReleasesFromGitHub();
  let data;
  if (!releases) {
    data = {
      current:          CURRENT_VERSION,
      latest:           null,
      update_available: false,
      newer_releases:   [],
      releases_url:     `https://github.com/${RELEASES_REPO}/releases`,
      error:            'github_unreachable',
    };
  } else {
    const latestTag = releases[0]?.tag ?? null;
    const latest    = latestTag ? latestTag.replace(/^v/, '') : null;
    const newer     = releases.filter(r => compareSemver(r.tag, CURRENT_VERSION) > 0);
    data = {
      current:          CURRENT_VERSION,
      latest,
      update_available: !!latest && compareSemver(latest, CURRENT_VERSION) > 0,
      newer_releases:   newer,
      releases_url:     `https://github.com/${RELEASES_REPO}/releases`,
    };
  }
  versionCache = { fetchedAt: now, data };
  return data;
}

module.exports = { compareSemver, buildVersionPayload };
