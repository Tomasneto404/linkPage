// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: reordering favourites and your own links, by mouse and by touch. */

// ─── Reordering by drag ───────────────────────────────────────────────────────
//
// Two things on the page are the member's own to order: their favourites, in
// the Favourites view, and their own links, inside one of their own groups.
// Everywhere else the order is the administrator's and is not theirs to change.
//
// One implementation for both. Each card is wired with a *zone* — where it may
// be dropped — and two functions: the zone's current order, and how to save a
// new one. A card can only land in its own zone: dropping a personal link into
// another section would not move it to that section, so it would only appear to
// snap back.
//
// HTML drag and drop does not exist on touch, so touch has a layer of its own
// below: press and hold a card, then slide it. Both end in dropOnCard().

let dragging = null;   // { id, zone } while a reorder is in progress
let touchHolding = false;   // a finger is down on a card that may become a reorder

/**
 * Whether a card is in somebody's hand. A live update re-renders the grid, and
 * doing that now would pull the card out from under them; it waits instead.
 */
const reorderInProgress = () => dragging !== null || touchHolding;

// Each wired card's zone and callbacks, so the touch layer — which finds the
// card under a finger with elementFromPoint — can ask the same questions the
// mouse handlers answer from their closures.
const dragWiring = new WeakMap();

// A card is a link, and a dragged link carries its address. Let go of it
// anywhere that is not another card and the browser's default is to open that
// address in place of this page. While a reorder is in progress, nothing on
// the page is a place to drop a link.
document.addEventListener('dragover', e => { if (dragging) e.preventDefault(); });
document.addEventListener('drop',     e => { if (dragging) e.preventDefault(); });

/**
 * Makes a card draggable within `zone`. `order()` gives the zone's ids as they
 * are shown; `save(newOrder)` applies and persists a new one, and reports
 * whether it worked.
 */
function wireCardDrag(card, link, { zone, order, save }) {
  card.draggable = true;
  dragWiring.set(card, { link, zone, order, save });
  wireTouchDrag(card);
  card.addEventListener('dragstart', e => {
    dragging = { id: link.id, zone };
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Something has to be set or Firefox will not start the drag at all.
    e.dataTransfer.setData('text/plain', String(link.id));
  });
  card.addEventListener('dragend', () => {
    dragging = null;
    card.classList.remove('is-dragging');
    document.querySelectorAll('.link-card.drop-before, .link-card.drop-after')
      .forEach(c => c.classList.remove('drop-before', 'drop-after'));
  });

  const accepts = () => dragging && dragging.zone === zone && dragging.id !== link.id;

  card.addEventListener('dragover', e => {
    if (!accepts()) return;
    e.preventDefault();
    const box = card.getBoundingClientRect();
    const after = e.clientX > box.left + box.width / 2;
    card.classList.toggle('drop-after', after);
    card.classList.toggle('drop-before', !after);
  });
  card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
  card.addEventListener('drop', e => {
    if (!accepts()) return;
    e.preventDefault();
    dropOnCard(card, dragging.id);
  });
}

/** Moves `movingId` next to `card`, on whichever side its marker says, and saves. */
async function dropOnCard(card, movingId) {
  const target = dragWiring.get(card);
  const after = card.classList.contains('drop-after');
  card.classList.remove('drop-before', 'drop-after');
  if (!target) return;

  const next = target.order().filter(id => id !== movingId);
  next.splice(next.indexOf(target.link.id) + (after ? 1 : 0), 0, movingId);

  if (!await target.save(next)) showToast('Could not save that order', { type: 'error' });
}

/**
 * Reordering by touch: hold a card still for a moment, then slide it.
 *
 * The hold is what tells a reorder from a scroll. A finger that moves before
 * the hold completes is scrolling the page, and is left alone; one that stays
 * put is picking the card up, and from then on the page stops scrolling under
 * it. Touch events rather than pointer events for the moves, because only a
 * non-passive touchmove can stop a scroll that the browser has already begun
 * to consider.
 */
const TOUCH_HOLD_MS    = 380;
const TOUCH_SLOP_PX    = 10;
const TOUCH_EDGE_PX    = 70;    // how close to the top or bottom starts scrolling

function wireTouchDrag(card) {
  let timer = null;
  let start = null;
  let active = false;
  let over = null;
  let scrollRaf = 0;
  let lastY = 0;

  const clearMarker = () => { over?.classList.remove('drop-before', 'drop-after'); over = null; };

  const stop = () => {
    clearTimeout(timer); timer = null;
    touchHolding = false;
    cancelAnimationFrame(scrollRaf); scrollRaf = 0;
    if (active) {
      active = false;
      dragging = null;
      card.classList.remove('is-dragging');
      document.body.classList.remove('is-touch-reordering');
    }
  };

  // Near the top or bottom edge, the page scrolls so a card can travel further
  // than one screen.
  const edgeScroll = () => {
    const speed = lastY < TOUCH_EDGE_PX ? -(TOUCH_EDGE_PX - lastY) / 4
                : lastY > innerHeight - TOUCH_EDGE_PX ? (lastY - (innerHeight - TOUCH_EDGE_PX)) / 4 : 0;
    if (speed) window.scrollBy(0, speed);
    scrollRaf = active ? requestAnimationFrame(edgeScroll) : 0;
  };

  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return stop();
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY };
    lastY = t.clientY;
    touchHolding = true;
    timer = setTimeout(() => {
      const { link, zone } = dragWiring.get(card) || {};
      if (!link) return;
      active = true;
      dragging = { id: link.id, zone };
      card.classList.add('is-dragging');
      document.body.classList.add('is-touch-reordering');
      navigator.vibrate?.(10);
      scrollRaf = requestAnimationFrame(edgeScroll);
    }, TOUCH_HOLD_MS);
  }, { passive: true });

  card.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!active) {
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > TOUCH_SLOP_PX) stop();
      return;
    }
    e.preventDefault();
    lastY = t.clientY;

    const under = document.elementFromPoint(t.clientX, t.clientY)?.closest('.link-card');
    const target = under && dragWiring.get(under);
    if (!target || target.zone !== dragging.zone || target.link.id === dragging.id) {
      clearMarker();
      return;
    }
    if (under !== over) clearMarker();
    over = under;
    const box = under.getBoundingClientRect();
    const after = t.clientX > box.left + box.width / 2;
    under.classList.toggle('drop-after', after);
    under.classList.toggle('drop-before', !after);
  }, { passive: false });

  card.addEventListener('touchend', e => {
    if (!active) return stop();
    // The lift that ends a reorder is not a tap: without this the card it was
    // let go on opens.
    e.preventDefault();
    const target = over;
    const movingId = dragging.id;
    over = null;
    stop();
    if (target) dropOnCard(target, movingId);
  });

  card.addEventListener('touchcancel', () => { clearMarker(); stop(); });

  // A long press on a link is also the browser's cue for its own menu. While
  // the press is becoming a reorder, that menu would only get in the way.
  card.addEventListener('contextmenu', e => { if (timer || active) e.preventDefault(); });
}

/** Favourites: their own list, saved as it is. */
function wireFavoriteDrag(card, link) {
  wireCardDrag(card, link, {
    zone:  'fav',
    order: () => favoriteIds.slice(),
    save:  async next => {
      const before = favoriteIds;
      favoriteIds = next;
      renderLinks();
      const res = await myRequest('/api/my/favorites/reorder', { json: { order: next } });
      if (res.ok) return true;
      favoriteIds = before;
      renderLinks();
      return false;
    },
  });
}

/**
 * A member's own link, inside one of their groups. Its zone is the section it
 * sits in, so it can only be dropped among the links next to it.
 *
 * The server keeps one order across all of a member's links, not one per
 * group, so a reorder inside this zone is spliced back into the whole list:
 * the zone's links swap among the slots they already occupy, and every other
 * link stays exactly where it was.
 */
function wirePersonalDrag(card, link) {
  const section = linkSectionInGroup(link, activeGroup);
  const zone = `${activeGroup}:${section ?? 'none'}`;
  const inZone = () => links
    .filter(l => isPersonal(l) && linkBelongsToGroup(l, activeGroup)
              && (linkSectionInGroup(l, activeGroup) ?? 'none') === (section ?? 'none'))
    .map(l => l.id);

  wireCardDrag(card, link, {
    zone,
    order: inZone,
    save: async next => {
      const before = links;
      const mine   = links.filter(isPersonal);
      const byId   = new Map(mine.map(l => [l.id, l]));
      const moved  = new Set(next);
      let k = 0;
      const reordered = mine.map(l => (moved.has(l.id) ? byId.get(next[k++]) : l));

      links = [...links.filter(l => !isPersonal(l)), ...reordered];
      renderLinks();
      const res = await myRequest('/api/my/links/reorder', {
        json: { order: reordered.map(l => l.personal_id) },
      });
      if (res.ok) return true;
      links = before;
      renderLinks();
      return false;
    },
  });
}

/**
 * Lightweight toast — appears top-right, auto-dismisses, click to dismiss
 * early. Mirrors the admin's toast contract for visual consistency. Pass an
 * optional second-line string (`detail`) to show under the headline.
 */
function showToast(message, { type = 'success', detail = '', duration = 2600 } = {}) {
  const ICONS = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <div class="toast-stack">
      <span>${escapeHtml(message)}</span>
      ${detail ? `<span class="toast-url" title="${escapeHtml(detail)}">${escapeHtml(detail)}</span>` : ''}
    </div>`;

  const dismiss = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

/**
 * Copies a shareable URL for the link to the clipboard, then briefly flashes
 * the button to a check mark. A link with a custom slug copies its /f/<slug>
 * address; otherwise URL-backed links copy the destination directly and
 * file-backed links copy the absolute redirect URL through this server so the
 * file is reachable (and the click is tracked).
 */
async function copyLinkFromCard(e, link) {
  e.preventDefault();
  e.stopPropagation();

  // CAPTURE the button reference NOW, before the first await. After an await
  // in an event handler the browser resets `e.currentTarget` to null, so
  // touching it later silently throws and aborts the rest of the function
  // (including the toast). This is a Chrome/Safari/Firefox-wide behaviour.
  const btn = e.currentTarget;

  // A slug exists to be shared, so it wins whenever the link has one.
  const toCopy = isPersonal(link)
    ? (link.file_path ? `${location.origin}${link.file_path}` : link.url)
    : link.slug
      ? `${location.origin}/f/${link.slug}`
      : (link.file_path ? `${location.origin}/r/${link.id}` : link.url);

  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(toCopy);
      ok = true;
    } else {
      // Fallback for old/insecure contexts: an off-screen textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = toCopy;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
  } catch { ok = false; }

  if (btn) {
    btn.classList.add(ok ? 'is-copied' : 'is-failed');
    btn.setAttribute('aria-label', ok ? 'Link copied' : 'Copy failed');
    setTimeout(() => {
      btn.classList.remove('is-copied', 'is-failed');
      btn.setAttribute('aria-label', 'Copy link');
    }, 1300);
  }

  if (ok) {
    showToast('Link copied', { type: 'success', detail: toCopy });
  } else {
    showToast('Couldn’t copy the link', { type: 'error', detail: 'Clipboard access was blocked.' });
  }
}
