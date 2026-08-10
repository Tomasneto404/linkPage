// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Server-Sent Events: the live-update channel the public page listens on. */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c;
before(async () => { c = await harness.start(); });
after(harness.stop);

/**
 * Opens the SSE stream and returns a reader plus a helper that resolves with
 * the next chunk of text (or null if none arrives within `ms`).
 */
async function openStream() {
  const controller = new AbortController();
  const res = await fetch(`${c.baseUrl}/api/events`, { signal: controller.signal });
  const reader = res.body.getReader();
  c.trackReader(reader);

  const decoder = new TextDecoder();
  const next = async (ms = 2000) => {
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), ms).unref?.());
    const chunk = await Promise.race([reader.read(), timeout]);
    if (!chunk || chunk.done) return null;
    return decoder.decode(chunk.value);
  };
  return { res, reader, next, close: () => { controller.abort(); } };
}

describe('/api/events', () => {
  test('answers as an event stream that stays open', async () => {
    const stream = await openStream();
    try {
      assert.equal(stream.res.status, 200);
      assert.match(stream.res.headers.get('content-type'), /text\/event-stream/);
      assert.match(stream.res.headers.get('cache-control') || '', /no-cache/);

      // The controller greets a new subscriber so proxies flush the connection.
      const hello = await stream.next();
      assert.ok(hello, 'the server sends something immediately');
    } finally {
      stream.close();
    }
  });

  test('an admin mutation pushes a data event to open subscribers', async () => {
    const stream = await openStream();
    try {
      await stream.next();                          // drain the greeting

      await c.makeLink({ name: 'Triggers a broadcast', url: 'https://sse.invalid/x' });

      let payload = await stream.next();
      // Keep-alive comments may arrive first; look past them.
      for (let i = 0; i < 3 && payload && !payload.includes('event: data'); i++) {
        payload = await stream.next();
      }
      assert.ok(payload && payload.includes('event: data'), `expected a data event, got ${JSON.stringify(payload)}`);
      assert.match(payload, /data: \d+/);
    } finally {
      stream.close();
    }
  });

  test('a read does not trigger a broadcast', async () => {
    const stream = await openStream();
    try {
      await stream.next();

      await c.api('/api/links');
      await c.api('/api/settings');

      const quiet = await stream.next(700);
      if (quiet !== null) {
        assert.ok(!quiet.includes('event: data'), 'GETs must not wake subscribers');
      }
    } finally {
      stream.close();
    }
  });

  test('the client set grows on subscribe and shrinks on disconnect', async () => {
    const { sseClients } = require('../src/services/sseService');
    const settle = async predicate => {
      for (let i = 0; i < 40 && !predicate(); i++) await new Promise(r => setTimeout(r, 25));
    };

    // Earlier tests may still be tearing their sockets down, so start from a
    // quiet baseline instead of assuming zero.
    await settle(() => sseClients.size === 0);
    const before = sseClients.size;

    const stream = await openStream();
    await stream.next();
    await settle(() => sseClients.size > before);
    assert.equal(sseClients.size, before + 1, 'subscriber registered');

    stream.close();
    await settle(() => sseClients.size === before);
    assert.equal(sseClients.size, before, 'subscriber cleaned up on disconnect');
  });

  test('broadcasting with no subscribers is harmless', async () => {
    const { broadcastDataUpdate } = require('../src/services/sseService');
    assert.doesNotThrow(() => broadcastDataUpdate());
  });
});
