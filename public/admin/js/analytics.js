// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Shared admin overlays, keyboard controls and mobile menu. */
const OVERLAY_IDS = [
  'statsOverlay', 'settingsOverlay', 'linkModalOverlay',
  'groupModalOverlay', 'deleteLinkOverlay', 'deleteGroupOverlay', 'confirmOverlay',
  'iconLibraryOverlay', 'versionOverlay', 'fileEditorOverlay', 'iconPresetsOverlay',
  'auditOverlay', 'requestsOverlay', 'analyticsOverlay',
];

// Overlays whose own close function restores state (e.g. handing the user back
// to Settings after picking a header icon) instead of just hiding the element.
const OVERLAY_CLOSERS = {
  iconLibraryOverlay: closeIconLibrary,
  iconPresetsOverlay: closeIconPresets,
};

OVERLAY_IDS.forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id !== id) return;
    const closer = OVERLAY_CLOSERS[id];
    if (closer) closer();
    else        e.target.classList.add('hidden');
  });
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('select:open')) return;

  // If any overlay is visible, close it first — same behaviour as before.
  const openOverlay = OVERLAY_IDS
    .map(id => document.getElementById(id))
    .find(el => el && !el.classList.contains('hidden'));
  if (openOverlay) {
    // Escape dismisses everything, so drop any pending picker target instead of
    // bouncing the user back into Settings.
    iconLibraryTarget = 'link';
    iconPresetsTarget = 'link';
    OVERLAY_IDS.forEach(id => document.getElementById(id).classList.add('hidden'));
    return;
  }

  // Otherwise, drain the bulk-selection state. First Esc clears the selection
  // (keeps bulk mode active so the user can keep picking); a second Esc with
  // nothing selected exits bulk mode entirely. Same flow as Finder / Gmail.
  if (bulkModeActive) {
    const selected = document.querySelectorAll('#linksGrid .link-card-wrap.selected');
    if (selected.length) {
      selected.forEach(w => w.classList.remove('selected'));
      lastClickedLinkId = null;
      updateBulkBar();
    } else {
      exitBulkMode();
    }
  }
});


// ─── 22. EASTER EGG ──────────────────────────────────────────────────────────

console.log(
  '%c Engineered by Tomás Neto in Portugal \n%c "Não tentes. Faz!" ',
  'background:#0071e3; color:#fff; padding:6px 14px; border-radius:6px 6px 0 0; font-size:13px; font-weight:700; font-family:-apple-system,sans-serif;',
  'background:#1d1d1f; color:#f5f5f7; padding:4px 14px 8px; border-radius:0 0 6px 6px; font-size:12px; font-style:italic; font-family:-apple-system,sans-serif;'
);

const KONAMI_SEQUENCE = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
let konamiIndex = 0;

document.addEventListener('keydown', e => {
  konamiIndex = (e.key === KONAMI_SEQUENCE[konamiIndex]) ? konamiIndex + 1 : (e.key === KONAMI_SEQUENCE[0] ? 1 : 0);
  if (konamiIndex === KONAMI_SEQUENCE.length) { konamiIndex = 0; showEasterEgg(); }
});

function showEasterEgg() {
  if (document.getElementById('easterEggOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id        = 'easterEggOverlay';
  overlay.className = 'easteregg-overlay';
  overlay.innerHTML = `
    <div class="easteregg-card" onclick="event.stopPropagation()">
      <span class="easteregg-flag">🇵🇹</span>
      <p class="easteregg-by">Engineered by</p>
      <h2 class="easteregg-name">Tomás Neto</h2>
      <p class="easteregg-location">in Portugal</p>
      <div class="easteregg-divider"></div>
      <p class="easteregg-quote">"Não tentes. Faz!"</p>
      <a class="easteregg-github" href="https://github.com/Tomasneto404" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
        github.com/Tomasneto404
      </a>
      <p class="easteregg-dismiss">Click anywhere to close</p>
    </div>`;

  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.appendChild(overlay);
}


// ─── 22b. MOBILE OVERFLOW MENU ────────────────────────────────────────────────
//
// On phones the theme / settings / logout buttons are hidden and replaced by
// a single kebab button that opens this popover. Menu items just programmatically
// click the real (hidden) buttons so their existing handlers fire — no duplicate
// logic.

(function setupMobileMenu() {
  const moreBtn = document.getElementById('mobileMoreBtn');
  const menu    = document.getElementById('mobileMenu');
  if (!moreBtn || !menu) return;

  function setOpen(open) {
    menu.classList.toggle('hidden', !open);
    moreBtn.setAttribute('aria-expanded', String(open));
  }

  moreBtn.addEventListener('click', e => {
    e.stopPropagation();
    setOpen(menu.classList.contains('hidden'));
  });

  document.addEventListener('click', e => {
    if (menu.classList.contains('hidden')) return;
    if (menu.contains(e.target) || moreBtn.contains(e.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.classList.contains('hidden')) setOpen(false);
  });

  // Forward each item to the real button so existing handlers run unchanged.
  const forward = (itemId, targetId) => {
    const item = document.getElementById(itemId);
    if (!item) return;
    item.addEventListener('click', () => {
      setOpen(false);
      document.getElementById(targetId)?.click();
    });
  };
  forward('mobileThemeItem',     'themeToggle');
  forward('mobileRequestsItem',  'openRequestsBtn');
  forward('mobileAnalyticsItem', 'openAnalyticsBtn');
  forward('mobileSettingsItem',  'openSettingsBtn');
  forward('mobileLogoutItem',    'logoutBtn');
})();

