// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The API description, checked against the API.
 *
 * The document is written by hand, so the thing worth testing is not that it
 * parses but that it still matches the router: every route documented, nothing
 * documented that no longer exists, and the auth in the document matching the
 * auth the router actually enforces. Add a route without describing it and
 * this suite fails.
 */

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

const harness = require('./helpers/harness');

let c, app, spec;

before(async () => {
  c = await harness.start();
  // Same module instance the harness booted, so this is the live router.
  app  = require('../src/app');
  spec = require('../src/docs/openapi').buildOpenApiSpec();
});
after(harness.stop);

// ─── Reading the router ───────────────────────────────────────────────────────

/** Express writes `:id`; OpenAPI writes `{id}`. */
const toOpenApiPath = p => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** Every route the app actually serves, with the middleware guarding it. */
function routerRoutes() {
  const found = [];
  (function walk(stack) {
    for (const layer of stack) {
      if (layer.route) {
        const names = layer.route.stack.map(s => s.name);
        for (const method of Object.keys(layer.route.methods)) {
          if (!layer.route.methods[method]) continue;
          found.push({
            method: method.toLowerCase(),
            path:   toOpenApiPath(layer.route.path),
            admin:  names.includes('requireAdminToken'),
          });
        }
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  })(app._router.stack);
  return found;
}

/** Every operation in the document. */
function specOperations() {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      out.push({ method, path, operation });
    }
  }
  return out;
}

const key = r => `${r.method.toUpperCase()} ${r.path}`;

describe('the document covers the router', () => {
  test('every route the app serves is documented', () => {
    const documented = new Set(specOperations().map(key));
    const missing = routerRoutes().filter(r => !documented.has(key(r))).map(key);

    assert.deepEqual(missing, [],
      `these routes have no entry in src/docs/openapi.js:\n  ${missing.join('\n  ')}`);
  });

  test('nothing is documented that the app no longer serves', () => {
    const live = new Set(routerRoutes().map(key));
    const stale = specOperations().map(key).filter(k => !live.has(k));

    assert.deepEqual(stale, [],
      `these entries describe routes that do not exist:\n  ${stale.join('\n  ')}`);
  });

  test('the counts line up', () => {
    assert.equal(specOperations().length, routerRoutes().length);
  });
});

describe('the document tells the truth about auth', () => {
  test('every admin-gated route asks for the token, and only those', () => {
    const documented = new Map(specOperations().map(o => [key(o), o.operation]));
    const wrong = [];

    for (const route of routerRoutes()) {
      const operation = documented.get(key(route));
      if (!operation) continue;                     // covered by the tests above

      const declaresToken = (operation.security || [])
        .some(s => Object.prototype.hasOwnProperty.call(s, 'AdminToken'));

      if (route.admin && !declaresToken) wrong.push(`${key(route)} is gated but documented as open`);
      if (!route.admin && declaresToken) wrong.push(`${key(route)} is open but documented as gated`);
    }

    assert.deepEqual(wrong, [], wrong.join('\n  '));
  });

  test('a gated operation documents its 401', () => {
    for (const { operation, ...r } of specOperations()) {
      const gated = (operation.security || []).some(s => 'AdminToken' in s);
      if (!gated) continue;
      assert.ok(operation.responses['401'], `${key(r)} should document a 401`);
    }
  });
});

describe('the document is well formed', () => {
  test('it is OpenAPI 3 with the pieces a reader needs', () => {
    assert.match(spec.openapi, /^3\./);
    assert.ok(spec.info.title);
    assert.ok(spec.info.version, 'version comes from package.json');
    assert.ok(spec.info.description.length > 200, 'there is an orientation blurb');
    assert.ok(spec.components.securitySchemes.AdminToken);
  });

  test('every operation has a summary, a tag and at least one response', () => {
    for (const { operation, ...r } of specOperations()) {
      assert.ok(operation.summary, `${key(r)} needs a summary`);
      assert.ok(operation.tags?.length, `${key(r)} needs a tag`);
      assert.ok(Object.keys(operation.responses || {}).length, `${key(r)} needs responses`);
    }
  });

  test('every tag used is declared up front', () => {
    const declared = new Set(spec.tags.map(t => t.name));
    for (const { operation, ...r } of specOperations()) {
      for (const tag of operation.tags) {
        assert.ok(declared.has(tag), `${key(r)} uses undeclared tag "${tag}"`);
      }
    }
  });

  test('every $ref points at something that exists', () => {
    const refs = [];
    (function walk(node) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string') refs.push(v);
        else walk(v);
      }
    })(spec);

    assert.ok(refs.length > 20, 'the document leans on shared schemas');
    for (const r of refs) {
      const target = r.replace(/^#\//, '').split('/')
        .reduce((node, part) => (node ? node[part] : undefined), spec);
      assert.ok(target, `${r} does not resolve`);
    }
  });

  test('it survives a round trip through JSON', () => {
    const round = JSON.parse(JSON.stringify(spec));
    assert.deepEqual(round, spec, 'nothing in here is unserialisable');
  });
});

describe('serving it', () => {
  test('the document needs the admin token', async () => {
    assert.equal((await c.pub('/api/openapi.json')).status, 401);

    const res = await c.api('/api/openapi.json');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.body.openapi, spec.openapi);
    assert.equal(Object.keys(res.body.paths).length, Object.keys(spec.paths).length);
  });

  test('the page itself is open, and asks for the token', async () => {
    const res = await c.pub('/api/docs');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.text, /SwaggerUIBundle/, 'it boots Swagger UI');
    assert.match(res.text, /\/api\/openapi\.json/, 'pointed at the document');
    assert.match(res.text, /X-Admin-Token/, 'and sends the token with each request');
    assert.doesNotMatch(res.text, /https?:\/\/(cdn|unpkg)/, 'no CDN: this has to work offline');
  });

  test('Swagger UI\'s own assets are served locally', async () => {
    for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js']) {
      const res = await c.pub(`/api/docs/assets/${asset}`);
      assert.equal(res.status, 200, `${asset} should be served`);
      assert.ok(res.text.length > 1000, `${asset} looks empty`);
    }
  });

  test('the assets directory is not browsable', async () => {
    assert.equal((await c.pub('/api/docs/assets/')).status, 404);
  });
});
