// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Live update channel (Server-Sent Events).
 *
 * The public page subscribes to /api/events and re-renders whenever an admin
 * mutation finishes. Lightweight — single bus, no per-event payload (we just
 * signal "data changed"; the client re-fetches the canonical state).
 *
 * This is a shared singleton: the events controller adds/removes response
 * objects, and both the audit middleware and the favicon service call
 * broadcastDataUpdate() to nudge open pages.
 */

const sseClients = new Set();

/*
 * Which member, if any, each open stream belongs to. Kept beside the set rather
 * than in it, so the set stays a plain collection of responses and nothing that
 * adds to it has to know about accounts.
 */
const streamOwner = new WeakMap();

function broadcastDataUpdate() {
  const payload = `event: data\ndata: ${Date.now()}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* client gone, will be cleaned up on close */ }
  }
}

/** Marks a stream as belonging to a signed-in member. */
function claimStream(res, userId) {
  if (Number.isInteger(userId)) streamOwner.set(res, userId);
}

/**
 * Tells one member's open pages — every tab, every device — that their own
 * links changed. Nobody else's stream hears it: a personal edit has nothing to
 * show anyone else, and a broadcast would tell everyone watching that somebody
 * was busy. A separate event name, so a page can tell a personal change from a
 * shared one.
 */
function broadcastToUser(userId) {
  if (!Number.isInteger(userId)) return;
  const payload = `event: personal\ndata: ${Date.now()}\n\n`;
  for (const res of sseClients) {
    if (streamOwner.get(res) !== userId) continue;
    try { res.write(payload); } catch { /* gone; cleaned up on close */ }
  }
}

module.exports = { sseClients, broadcastDataUpdate, broadcastToUser, claimStream };
