// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: the group tab strip and the unlock modal. */

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function linkBelongsToGroup(link, groupId) {
  return Array.isArray(link.group_ids)
    ? link.group_ids.includes(groupId)
    : link.group_id === groupId;
}

const LOCK_SVG = `
  <svg class="tab-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Locked">
    <rect x="3" y="11" width="18" height="11" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>`;

const STAR_SVG = `
  <svg class="star-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.53L12 17.5l-5.87 3.07 1.12-6.53L2.5 9.41l6.56-.95z"/>
  </svg>`;

/** The mark on a group or link only its owner can see. */
const MINE_SVG = `
  <svg class="tab-mine-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Yours">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>`;

function isGroupLocked(group) {
  return group.is_protected && !group.is_unlocked;
}

/** One group pill. `dup` marks a clone from the loop, hidden from a11y tools. */
function groupTabHtml(g, dup) {
  const count  = links.filter(l => linkBelongsToGroup(l, g.id)).length;
  const active = activeGroup === g.id;
  const locked = isGroupLocked(g);
  // When active, paint the tab with the group's own colour instead of the
  // default primary (inline style overrides the .tab.active rule).
  const activeStyle = (active && tabsUseGroupColor)
    ? ` style="background:${escapeHtml(g.color)};border-color:${escapeHtml(g.color)};--tab-rgb:${hexToRgb(g.color).join(',')}"`
    : '';
  const mine = isPersonal(g);
  return `
    <button class="tab${active ? ' active' : ''}${locked ? ' locked' : ''}${mine ? ' tab-mine' : ''}"
            data-group="${g.id}" data-locked="${locked ? '1' : '0'}"${activeStyle}${dup ? ' aria-hidden="true" tabindex="-1"' : ''}
            ${mine ? 'title="Only you can see this group"' : ''}>
      <span class="tab-dot" style="background:${escapeHtml(active ? '#fff' : g.color)}"></span>
      ${escapeHtml(g.name)}
      ${mine ? MINE_SVG : ''}
      ${locked ? LOCK_SVG : ''}
      <span class="tab-count">${count}</span>
    </button>`;
}

/**
 * The Favourites pill. Only for a member who has starred something, so a
 * member who never uses favourites never sees an empty tab — the star on a card
 * is what introduces it. It stays while it is the tab being looked at, so
 * unstarring the last one does not pull the floor out from under the reader.
 */
function renderFavoritesTab() {
  const btn = document.getElementById('tabFav');
  if (!btn) return;
  const count = favoriteLinks().length;
  const show  = !!currentUser && (count > 0 || activeGroup === 'fav');
  btn.className = `tab tab-fav${activeGroup === 'fav' ? ' active' : ''}${show ? '' : ' hidden'}`;
  btn.innerHTML = `${STAR_SVG} Favourites <span class="tab-count">${count}</span>`;
}

function renderTabs() {
  const allBtn = document.getElementById('tabAll');
  allBtn.className = `tab tab-all${activeGroup === 'all' ? ' active' : ''}`;
  allBtn.innerHTML = `All <span class="tab-count">${links.length}</span>`;
  renderFavoritesTab();
  // A member can add a group of their own; nobody else has groups to add to.
  document.getElementById('tabAddGroup')?.classList.toggle('hidden', !currentUser);
  if (!currentUser) document.getElementById('tabAddPop')?.classList.add('hidden');

  const t = tabScroller();
  // Keep the reader where they were across re-renders (a tab click rebuilds the
  // whole strip); null means "first paint", which reveals the active group.
  const keep = t.painted ? t.vp.scrollLeft : null;
  t.oneCopy  = groups.map(g => groupTabHtml(g, false)).join('');
  t.dupCopy  = groups.map(g => groupTabHtml(g, true)).join('');
  layoutTabScroller(keep);
}

// ─── Group tabs: looping horizontal scroller ──────────────────────────────────

/**
 * When there are more groups than fit the bar, the strip becomes a horizontal
 * scroller driven by the wheel, the trackpad, touch, or the two nudge arrows on
 * its faded edges. There is no scrollbar — the fades and arrows are the
 * affordance, and they retract at whichever end the strip has reached.
 *
 * With the admin's "Looping Group Tabs" setting on it never reaches an end: the
 * whole set is repeated enough times to cover the viewport twice over and the
 * scroll offset is teleported back by exactly one cycle whenever it drifts out
 * of the middle band, so the seam is invisible.
 */
const TABS = {
  vp: null, track: null, strip: null,
  oneCopy: '', dupCopy: '',
  cycle: 0,           // px of one full pass of the group set, gap included
  maxScroll: 0,       // furthest scrollLeft, cached so scroll handlers cause no reflow
  overflowing: false, // false when everything already fits: plain static row
  loop: false,        // overflowing *and* the admin turned looping on
  painted: false,     // laid out at least once (so scroll offset is worth keeping)
  glideRaf: null,     // rAF id of an arrow nudge in flight
  holdTimer: null,    // repeat timer while an arrow is held down
};

function tabScroller() {
  if (!TABS.vp) {
    TABS.vp    = document.getElementById('tabsViewport');
    TABS.track = document.getElementById('tabs');
    TABS.strip = document.getElementById('tabsStrip');
    bindTabScroller();
  }
  return TABS;
}

/** Measures one copy, then repeats it as many times as the loop needs. */
function layoutTabScroller(keep = null) {
  const t = TABS;
  t.track.innerHTML = t.oneCopy;

  const gap  = parseFloat(getComputedStyle(t.track).columnGap) || 0;
  const one  = t.track.scrollWidth;
  // clientWidth counts the viewport's own padding, which is only there to give
  // the end pills' glow room to spill (see .tabs-viewport). Measuring with it
  // would overstate how much strip actually fits and throw the centring off by
  // half the padding, so take it back out.
  const vpW  = t.vp.clientWidth - horizontalPadding(t.vp);

  t.overflowing = groups.length > 0 && one > vpW + 1;
  t.loop        = t.overflowing && tabsLoopEnabled;
  t.cycle       = one + gap;
  t.painted     = true;

  t.vp.classList.toggle('is-scrollable', t.overflowing);
  t.strip.classList.toggle('is-scrollable', t.overflowing);

  if (!t.overflowing) {
    t.vp.scrollLeft = 0;
    updateTabEdges();
    return;
  }

  if (t.loop) {
    // Two spare cycles (one each side) is all the teleport band ever needs.
    const copies = Math.max(3, Math.ceil(vpW / t.cycle) + 2);
    t.track.innerHTML = t.oneCopy + t.dupCopy.repeat(copies - 1);
    t.vp.scrollLeft = normalizeTabScroll(keep ?? activeTabScrollLeft(vpW));
  } else {
    // Out-of-range values are clamped by the browser.
    t.vp.scrollLeft = keep ?? activeTabScrollLeft(vpW);
  }
  // The browser's own ceiling, which counts the padding — unlike vpW above,
  // which deliberately does not. Using vpW here would put maxScroll past the
  // real end, and the strip would never report itself as parked there.
  t.maxScroll = t.vp.scrollWidth - t.vp.clientWidth;
  updateTabEdges();
}

/** Left + right padding of an element, in pixels. */
function horizontalPadding(el) {
  const cs = getComputedStyle(el);
  return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
}

/** Puts the active group's pill in the middle of the viewport. */
function activeTabScrollLeft(vpW) {
  const active = TABS.track.querySelector('.tab.active');
  if (!active) return 0;
  return active.offsetLeft - (vpW - active.offsetWidth) / 2;
}

/**
 * Retracts the fade and its arrow at whichever end the strip has hit. A looping
 * strip has no ends, so both stay put.
 */
function updateTabEdges() {
  const t = TABS;
  const atStart = !t.overflowing || (!t.loop && t.vp.scrollLeft <= 1);
  const atEnd   = !t.overflowing || (!t.loop && t.vp.scrollLeft >= t.maxScroll - 1);

  t.strip.classList.toggle('at-start', atStart);
  t.strip.classList.toggle('at-end', atEnd);
  t.vp.style.setProperty('--fade-l', atStart ? '0px' : '');
  t.vp.style.setProperty('--fade-r', atEnd   ? '0px' : '');
}

/** Folds any offset into the middle band [0.5, 1.5] cycles. */
function normalizeTabScroll(x) {
  const c = TABS.cycle;
  if (c <= 0) return 0;
  let s = x;
  while (s < c * 0.5) s += c;
  while (s > c * 1.5) s -= c;
  return s;
}

/**
 * Arrow nudge. Animated by hand in relative steps rather than with
 * scroll-behavior:smooth, because the loop teleport moves scrollLeft under any
 * absolute target mid-animation and the glide would snap.
 */
function glideTabs(dir) {
  const t = TABS;
  if (!t.overflowing) return;
  if (t.glideRaf) cancelAnimationFrame(t.glideRaf);

  const total    = Math.max(120, t.vp.clientWidth * 0.8) * dir;
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 340;
  let elapsed    = 0;
  let done       = 0;
  let last       = null;

  const step = now => {
    if (last !== null) elapsed += now - last;
    last = now;
    const p    = Math.min(1, elapsed / duration);
    const ease = 1 - Math.pow(1 - p, 3);
    const want = total * ease;
    t.vp.scrollLeft += want - done;
    done = want;
    t.glideRaf = p < 1 ? requestAnimationFrame(step) : null;
  };
  t.glideRaf = requestAnimationFrame(step);
}

function bindTabScroller() {
  const t = TABS;

  // Delegated so the clones — rebuilt on every render — need no wiring.
  document.getElementById('tabsRow').addEventListener('click', e => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    const key = parseGroupKey(btn.dataset.group);
    if (key === null) return;
    if (btn.dataset.locked === '1') {
      const g = groups.find(x => x.id === key);
      if (g) openUnlockModal(g);
      return;
    }
    activeGroup = key;
    saveStoredGroup(activeGroup);
    renderTabs(); renderLinks(true);
  });

  t.vp.addEventListener('scroll', () => {
    if (t.loop) {
      // Teleport a whole cycle so the strip under the cursor is unchanged.
      if      (t.vp.scrollLeft < t.cycle * 0.5) t.vp.scrollLeft += t.cycle;
      else if (t.vp.scrollLeft > t.cycle * 1.5) t.vp.scrollLeft -= t.cycle;
    }
    updateTabEdges();
  }, { passive: true });

  // Vertical wheel over the strip scrolls it sideways; a horizontal gesture is
  // left to the browser, and with nothing to scroll the page scrolls as usual.
  t.vp.addEventListener('wheel', e => {
    if (!t.overflowing || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    // Without a loop, hand the wheel back to the page once the strip is
    // parked at the end the reader is pushing towards.
    if (!t.loop) {
      if (delta < 0 && t.vp.scrollLeft <= 0)               return;
      if (delta > 0 && t.vp.scrollLeft >= t.maxScroll - 1) return;
    }
    e.preventDefault();
    t.vp.scrollLeft += delta;
  }, { passive: false });

  // Touch panning, done by hand for the same reason the wheel is: the viewport
  // is pointer-events:none so its padding cannot steal clicks from the header
  // and the grid it overhangs, and a scroller the browser will not hit-test is
  // a scroller the browser will not pan either. Events still bubble up here
  // from the pills and the track, which are the only part of the bar a finger
  // can land on, so that is where a swipe is picked up.
  let panX = 0, panY = 0, panning = null;   // null until the axis is decided

  t.vp.addEventListener('touchstart', e => {
    if (!t.overflowing || e.touches.length !== 1) return;
    panX = e.touches[0].clientX;
    panY = e.touches[0].clientY;
    panning = null;
  }, { passive: true });

  t.vp.addEventListener('touchmove', e => {
    if (!t.overflowing || e.touches.length !== 1) return;

    const dx = panX - e.touches[0].clientX;
    const dy = panY - e.touches[0].clientY;

    // Decide once per gesture which way it is going, so a mostly-vertical
    // swipe scrolls the page and never stutters the strip sideways.
    if (panning === null) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      panning = Math.abs(dx) > Math.abs(dy);
    }
    if (!panning) return;

    // At either end of a strip that does not loop, hand the gesture back so
    // the page can take over rather than the finger sticking.
    if (!t.loop) {
      if (dx < 0 && t.vp.scrollLeft <= 0)               return;
      if (dx > 0 && t.vp.scrollLeft >= t.maxScroll - 1) return;
    }

    e.preventDefault();
    t.vp.scrollLeft += dx;
    panX = e.touches[0].clientX;
    panY = e.touches[0].clientY;
  }, { passive: false });

  for (const ev of ['touchend', 'touchcancel']) {
    t.vp.addEventListener(ev, () => { panning = null; }, { passive: true });
  }

  // Edge arrows: one nudge per click, and keep nudging while held down.
  for (const [id, dir] of [['tabsPrev', -1], ['tabsNext', 1]]) {
    const btn = document.getElementById(id);
    btn.addEventListener('click', () => glideTabs(dir));
    btn.addEventListener('pointerdown', () => {
      clearInterval(t.holdTimer);
      t.holdTimer = setInterval(() => glideTabs(dir), 300);
    });
  }
  for (const ev of ['pointerup', 'pointercancel', 'blur']) {
    window.addEventListener(ev, () => { clearInterval(t.holdTimer); t.holdTimer = null; });
  }

  // Pill widths (and therefore the cycle length) shift once webfonts land, so
  // re-measure or the loop seam would show a gap.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (TABS.oneCopy) layoutTabScroller(TABS.loop ? TABS.vp.scrollLeft : 0);
    });
  }

  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      layoutTabScroller(TABS.loop ? TABS.vp.scrollLeft : 0);
    });
  });
}

// ─── Unlock modal ─────────────────────────────────────────────────────────────

let pendingUnlockGroup = null;

function openUnlockModal(group) {
  pendingUnlockGroup = group;
  document.getElementById('unlockGroupName').textContent = group.name;
  document.getElementById('unlockPasswordInput').value   = '';
  document.getElementById('unlockError').classList.add('hidden');
  document.getElementById('unlockOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('unlockPasswordInput').focus(), 60);
}

function closeUnlockModal() {
  pendingUnlockGroup = null;
  document.getElementById('unlockOverlay').classList.add('hidden');
}

document.getElementById('closeUnlockBtn').addEventListener('click', closeUnlockModal);
document.getElementById('cancelUnlockBtn').addEventListener('click', closeUnlockModal);
document.getElementById('unlockOverlay').addEventListener('click', e => {
  if (e.target.id === 'unlockOverlay') closeUnlockModal();
});

document.getElementById('unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!pendingUnlockGroup) return;

  const pw    = document.getElementById('unlockPasswordInput').value;
  const btn   = document.getElementById('unlockSubmitBtn');
  const err   = document.getElementById('unlockError');
  const group = pendingUnlockGroup;
  err.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Unlocking…';

  try {
    const r = await fetch(`/api/groups/${group.id}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: pw }),
    });

    if (r.status === 429) {
      err.textContent = 'Too many attempts. Please wait a few minutes.';
      err.classList.remove('hidden');
      return;
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.valid !== true) {
      err.textContent = 'Wrong password.';
      err.classList.remove('hidden');
      document.getElementById('unlockPasswordInput').focus();
      return;
    }

    // Switch to the just-unlocked group and reload data so the cookie-aware
    // /api/links call returns its previously-hidden links.
    activeGroup = group.id;
    saveStoredGroup(activeGroup);
    closeUnlockModal();
    await loadData();
  } catch {
    err.textContent = 'Could not reach the server.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Unlock';
  }
});
