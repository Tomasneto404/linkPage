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

function broadcastDataUpdate() {
  const payload = `event: data\ndata: ${Date.now()}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch { /* client gone, will be cleaned up on close */ }
  }
}

module.exports = { sseClients, broadcastDataUpdate };
