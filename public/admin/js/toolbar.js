// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: import and export, sort, navigation, changelog and the update check. */

// ─── 17. IMPORT/EXPORT ────────────────────────────────────────────────────────

document.getElementById('exportBtn').addEventListener('click', async () => {
  const data  = await exportLinksApi();
  const json  = JSON.stringify(data, null, 2);
  const blob  = new Blob([json], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = `linkpage-export-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exported ${data.links.length} links`);
});

document.getElementById('importBtn').addEventListener('click', () =>
  document.getElementById('importFileInput').click());

document.getElementById('importFileInput').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { showToast('Invalid JSON file', 'error'); e.target.value = ''; return; }

  if (!Array.isArray(data?.links)) {
    showToast('File must contain a "links" array', 'error'); e.target.value = ''; return;
  }

  const groupCount = Array.isArray(data.groups) ? data.groups.length : 0;
  const linkCount  = data.links.length;

  const ok = await showConfirm({
    title: 'Import Links',
    message:
      `Add ${linkCount} link${linkCount !== 1 ? 's' : ''}` +
      (groupCount ? ` and ${groupCount} group${groupCount !== 1 ? 's' : ''}` : '') +
      ` to your existing data? Items already present (by URL or file path) will be skipped.`,
    confirmText: 'Import',
    danger:      false,
  });
  if (!ok) { e.target.value = ''; return; }

  // Pass the full payload through — server handles groups, sections, and
  // links idempotently (creates only what's missing).
  const result = await importLinksApi({
    version: data.version,
    groups:  data.groups,
    links:   data.links,
  });

  const parts = [];
  if (result.imported)          parts.push(`${result.imported} link${result.imported !== 1 ? 's' : ''}`);
  if (result.groups_created)    parts.push(`${result.groups_created} group${result.groups_created !== 1 ? 's' : ''}`);
  if (result.sections_created)  parts.push(`${result.sections_created} section${result.sections_created !== 1 ? 's' : ''}`);
  const skipNote = result.skipped ? ` · ${result.skipped} already existed` : '';
  const errNote  = result.errors?.length ? ` · ${result.errors.length} invalid` : '';
  const summary  = parts.length ? `Imported ${parts.join(', ')}` : 'Nothing to import';
  showToast(summary + skipNote + errNote,
    result.errors?.length ? 'info' : 'success');

  e.target.value = ''; await loadAllData();
});


// ─── 18. SORT ─────────────────────────────────────────────────────────────────

document.getElementById('sortSelect').addEventListener('change', e => {
  sortOrder = e.target.value;
  renderLinks(true);
});


// ─── 19. SIDEBAR TOGGLE ───────────────────────────────────────────────────────

const sidebar = document.getElementById('sidebar');

function toggleSidebar() {
  const mobile = window.innerWidth <= 720;
  if (mobile) { sidebar.classList.toggle('open'); }
  else {
    sidebar.classList.toggle('collapsed');
    document.getElementById('mainContent').style.marginLeft =
      sidebar.classList.contains('collapsed') ? '0' : '';
  }
}

document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
document.addEventListener('click', e => {
  if (window.innerWidth > 720) return;
  if (!sidebar.classList.contains('open')) return;
  if (!sidebar.contains(e.target) && !document.getElementById('sidebarToggle').contains(e.target))
    sidebar.classList.remove('open');
});


// ─── 20. NAV & SEARCH ────────────────────────────────────────────────────────

document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
  activeGroup   = btn.dataset.group;
  activeSection = null;
  renderSidebar(); renderLinks(true);
}));

document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value.trim(); renderLinks();
});


// ─── 20.3b. CHANGELOG ────────────────────────────────────────────────────────
//
// The sidebar list is rendered from /api/changelog, which parses CHANGELOG.md.
// That file is also what the release workflow turns into the GitHub release
// notes, so the two can never drift apart.

/** Renders one release section per entry group, newest first. */
async function renderChangelog() {
  const host = document.getElementById('changelogBody');
  if (!host) return;

  const data = await apiJson('/api/changelog').catch(() => null);
  if (!data?.releases?.length) {
    host.innerHTML = '<div class="changelog-entry-desc">Release notes are unavailable.</div>';
    return;
  }

  host.innerHTML = data.releases.map(release => `
    <div class="changelog-release-label">v${escapeHtml(release.version)}</div>
    <ul class="changelog-list">
      ${release.entries.map(entry => `
        <li>
          <div class="changelog-entry-title">${escapeHtml(entry.title)}</div>
          <div class="changelog-entry-desc">${renderChangelogText(entry.description)}</div>
        </li>`).join('')}
    </ul>`).join('');
}

/** Inline markdown the changelog actually uses: `code` and **bold**. */
function renderChangelogText(text) {
  return escapeHtml(text || '')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// ─── 20.4. UPDATE CHECK ──────────────────────────────────────────────────────
//
// Surfaces newer releases from GitHub. The server caches the response so the
// admin can call /api/version cheaply. Pass `force: true` to bypass that cache.
// Two surfaces consume it:
//   - the small dot on the sidebar Changelog pill (auto-fired on load)
//   - the explicit "Check for updates" modal (user clicks the button)

let lastVersionInfo = null;

async function fetchVersionInfo({ force = false } = {}) {
  const url = `/api/version${force ? '?refresh=1' : ''}`;
  const info = await apiJson(url).catch(() => null);
  if (info) {
    lastVersionInfo = info;
    syncCurrentVersionLabels(info.current);
  }
  return info;
}

async function checkForUpdates() {
  const info = await fetchVersionInfo();
  if (!info) return;
  applyVersionInfo(info);
}

/**
 * Keeps every place that displays the current version (sidebar pill, settings
 * About row, etc.) in sync with the canonical value from the server.
 */
function syncCurrentVersionLabels(current) {
  const label = document.getElementById('changelogVersionLabel');
  if (label) label.textContent = `v${current}`;
  const inline = document.getElementById('settingsCurrentVersion');
  if (inline) inline.textContent = `v${current}`;
}

function applyVersionInfo(info) {
  const pill   = document.getElementById('changelogVersion');
  const dot    = document.getElementById('changelogUpdateDot');
  const banner = document.getElementById('changelogUpdate');
  if (!pill || !banner) return;

  // Keep the pill in sync with package.json regardless of update status.
  syncCurrentVersionLabels(info.current);

  if (!info.update_available || !Array.isArray(info.newer_releases) || !info.newer_releases.length) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    dot?.classList.add('hidden');
    return;
  }

  dot?.classList.remove('hidden');
  const releasesHtml = info.newer_releases.map(r => {
    const tag       = String(r.tag || '').replace(/^v/, '');
    const date      = r.published_at
      ? new Date(r.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const bodyHtml  = renderReleaseBody(r.body);
    const linkHref  = r.html_url || info.releases_url;
    return `
      <article class="changelog-update-release">
        <header class="changelog-update-release-head">
          <span class="changelog-update-tag">v${escapeHtml(tag)}</span>
          ${date ? `<span class="changelog-update-date">${escapeHtml(date)}</span>` : ''}
          <a class="changelog-update-link" href="${escapeHtml(linkHref)}"
             target="_blank" rel="noopener noreferrer">View on GitHub →</a>
        </header>
        <div class="changelog-update-body">${bodyHtml}</div>
      </article>
    `;
  }).join('');

  banner.innerHTML = `
    <div class="changelog-update-head">
      <span class="changelog-update-pulse"></span>
      <span class="changelog-update-title">Update available</span>
      <span class="changelog-update-sub">v${escapeHtml(info.current)} → v${escapeHtml(info.latest)}</span>
    </div>
    ${releasesHtml}
  `;
  banner.classList.remove('hidden');
}

/**
 * Minimal GitHub-flavoured-markdown renderer for release notes.
 * Handles bold, bullet lists, and paragraph breaks. Everything else is escaped.
 */
function renderReleaseBody(text) {
  if (!text) return '<em class="changelog-update-empty">No release notes provided.</em>';
  const safe  = escapeHtml(text.trim());
  // Bold: **text**
  const bold  = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const lines = bold.split(/\r?\n/);

  let html = '';
  let buffer = [];
  const flushList = () => {
    if (buffer.length) {
      html += `<ul class="changelog-update-list">${buffer.map(b => `<li>${b}</li>`).join('')}</ul>`;
      buffer = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }
    const m = line.match(/^[-*]\s+(.+)$/);
    if (m) {
      buffer.push(m[1]);
    } else {
      flushList();
      html += `<p>${line}</p>`;
    }
  }
  flushList();
  return html || '<em class="changelog-update-empty">No release notes provided.</em>';
}

// ─── Update-check popup ──────────────────────────────────────────────────────

function openVersionModal() {
  const overlay = document.getElementById('versionOverlay');
  const body    = document.getElementById('versionBody');
  body.innerHTML = `
    <div class="version-loading">
      <div class="version-spinner" aria-hidden="true"></div>
      <span>Checking for updates…</span>
    </div>`;
  overlay.classList.remove('hidden');

  fetchVersionInfo({ force: true })
    .then(info => {
      if (!info) return renderVersionError();
      // Keep the sidebar dot and About row in sync with whatever the fresh
      // check returned, so closing the popup doesn't leave stale UI behind.
      applyVersionInfo(info);
      renderVersionPopup(info);
    })
    .catch(renderVersionError);
}

function closeVersionModal() {
  document.getElementById('versionOverlay').classList.add('hidden');
}

function renderVersionError() {
  document.getElementById('versionBody').innerHTML = `
    <div class="version-status version-status-error">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8"  x2="12" y2="13"/>
        <line x1="12" y1="16" x2="12" y2="16"/>
      </svg>
      <div>
        <div class="version-status-title">Couldn't reach GitHub</div>
        <div class="version-status-sub">Check your internet connection and try again in a moment.</div>
      </div>
    </div>`;
}

function renderVersionPopup(info) {
  const body    = document.getElementById('versionBody');
  const ghLink  = document.getElementById('versionGithubLink');
  if (ghLink && info.releases_url) ghLink.href = info.releases_url;

  const current = escapeHtml(info.current || '?');
  const latest  = info.latest ? escapeHtml(info.latest) : '—';

  if (info.error || !info.latest) {
    body.innerHTML = `
      <div class="version-summary">
        <div class="version-summary-row">
          <span class="version-summary-label">Current</span>
          <span class="version-summary-value">v${current}</span>
        </div>
        <div class="version-summary-row">
          <span class="version-summary-label">Latest</span>
          <span class="version-summary-value version-summary-muted">unavailable</span>
        </div>
      </div>
      <div class="version-status version-status-info">
        <span>Couldn't fetch release info from GitHub. Try again later.</span>
      </div>`;
    return;
  }

  const isUpdate = !!info.update_available;
  const statusHtml = isUpdate
    ? `
      <div class="version-status version-status-update">
        <span class="version-status-dot"></span>
        <div>
          <div class="version-status-title">Update available</div>
          <div class="version-status-sub">A newer release is published on GitHub.</div>
        </div>
      </div>`
    : `
      <div class="version-status version-status-ok">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div>
          <div class="version-status-title">You're up to date</div>
          <div class="version-status-sub">No newer releases on GitHub.</div>
        </div>
      </div>`;

  const releasesHtml = (info.newer_releases || []).map(r => {
    const tag      = String(r.tag || '').replace(/^v/, '');
    const date     = r.published_at
      ? new Date(r.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const linkHref = r.html_url || info.releases_url;
    return `
      <article class="version-release">
        <header class="version-release-head">
          <span class="version-release-tag">v${escapeHtml(tag)}</span>
          ${date ? `<span class="version-release-date">${escapeHtml(date)}</span>` : ''}
          <a class="version-release-link" href="${escapeHtml(linkHref)}"
             target="_blank" rel="noopener noreferrer">Details →</a>
        </header>
        <div class="version-release-body">${renderReleaseBody(r.body)}</div>
      </article>`;
  }).join('');

  body.innerHTML = `
    <div class="version-summary">
      <div class="version-summary-row">
        <span class="version-summary-label">Current</span>
        <span class="version-summary-value">v${current}</span>
      </div>
      <div class="version-summary-row">
        <span class="version-summary-label">Latest</span>
        <span class="version-summary-value ${isUpdate ? 'version-summary-update' : ''}">v${latest}</span>
      </div>
    </div>
    ${statusHtml}
    ${releasesHtml ? `<div class="version-changes">
      <div class="version-changes-title">What's new</div>
      ${releasesHtml}
    </div>` : ''}
  `;
}

document.getElementById('checkForUpdatesBtn').addEventListener('click', openVersionModal);
document.getElementById('closeVersionBtn').addEventListener('click', closeVersionModal);
document.getElementById('versionCloseBtn').addEventListener('click', closeVersionModal);

