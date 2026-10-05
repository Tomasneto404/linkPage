// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Every async route handler is wrapped.
 *
 * Express 4 does not await what a handler returns. A rejected promise from an
 * async handler goes nowhere: the request hangs until the client gives up, and
 * the process logs an unhandled rejection with no hint of which route it came
 * from. wrapAsync (src/middleware/error.js) hands the rejection to the error
 * handler instead.
 *
 * Checked structurally, over the live router, rather than route by route — so
 * an async handler added later without the wrapper fails here the day it is
 * written, not the day it first throws in production.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let app;
before(async () => {
  await harness.start();
  app = require('../src/app');
});
after(harness.stop);

const AsyncFunction = (async () => {}).constructor;

test('no route hands Express an unwrapped async function', () => {
  const unwrapped = [];
  (function walk(stack) {
    for (const layer of stack) {
      if (layer.route) {
        for (const handler of layer.route.stack) {
          if (handler.handle instanceof AsyncFunction) {
            const method = Object.keys(layer.route.methods)[0].toUpperCase();
            unwrapped.push(`${method} ${layer.route.path} → ${handler.handle.name || '(anonymous)'}`);
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  })(app._router.stack);

  assert.deepEqual(unwrapped, [],
    `wrap these in wrapAsync (src/middleware/error.js):\n  ${unwrapped.join('\n  ')}`);
});

test('a wrapped handler that rejects answers with an error instead of hanging', async () => {
  const express = require('express');
  const { wrapAsync, errorHandler } = require('../src/middleware/error');

  const probe = express();
  probe.get('/boom', wrapAsync(async () => { throw new Error('kaboom'); }));
  probe.use(errorHandler);

  const server = await new Promise(r => { const s = probe.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/boom`,
                            { signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 500, 'answered, and promptly');
  } finally {
    server.close();
  }
});
