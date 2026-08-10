// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Test harness: boots the real Express app against a throwaway database and
 * exposes a small HTTP client.
 *
 * Every test file calls start() before requiring anything from src/. That order
 * matters: src/config/env.js resolves DATA_DIR at import time and
 * src/config/db.js runs the migrations as an import side effect, so the temp
 * directory has to exist in process.env first. Node's test runner gives each
 * file its own process, so one database (and one admin token) per file.
 *
 * Nothing here talks to the network. Tests point links at hosts under .invalid
 * so the fire-and-forget favicon fetch fails on DNS instead of leaving the box.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

let server;      // http.Server
let dataDir;     // temp DATA_DIR for this file
let baseUrl;     // http://127.0.0.1:<ephemeral>
let token;       // admin token generated on first boot
const openReaders = new Set();   // SSE readers to release on stop()
const logs = [];                 // captured app console output
let realConsole;                 // saved console methods

/**
 * Captures the app's console output for the duration of the run.
 *
 * Two reasons: the startup/rotation banners are noise in the test report, and
 * the emoji in the rotation banner can split across stdout chunks and corrupt
 * the test runner's child-process protocol ("Unable to deserialize cloned
 * data"). Everything stays available in `logs` for assertions or debugging.
 */
function captureConsole() {
  realConsole = { log: console.log, warn: console.warn, error: console.error };
  for (const level of ['log', 'warn', 'error']) {
    console[level] = (...args) => { logs.push({ level, message: args.map(String).join(' ') }); };
  }
}

function restoreConsole() {
  if (realConsole) Object.assign(console, realConsole);
  realConsole = null;
}

/** Recorded { linkId, url } pairs the app asked the favicon service to fetch. */
const faviconCalls = [];

/**
 * Replaces the favicon service with a no-op before the app loads it.
 *
 * Creating a link fire-and-forgets cacheFavicon(), whose last resort is Google's
 * public favicon endpoint — so without this the suite would reach the internet,
 * write files late and emit stray SSE broadcasts mid-test. Tests can still
 * assert the pipeline was invoked via `faviconCalls`.
 */
function stubFaviconService() {
  const id = require.resolve('../../src/services/faviconService.js');
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports: {
      cacheFavicon: async (linkId, url) => { faviconCalls.push({ linkId, url }); },
      fetchFaviconForUrl: async () => null,
    },
  };
}

/**
 * Creates a temp data dir, boots the app on an ephemeral port and returns the
 * client bundle. Call once per test file, inside before().
 */
async function start({ stubFavicons = true } = {}) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkpage-test-'));
  process.env.DATA_DIR    = dataDir;
  process.env.UPLOADS_DIR = path.join(dataDir, 'uploads');
  captureConsole();
  if (stubFavicons) stubFaviconService();

  const app = require('../../src/app');
  token = require('../../src/config/secrets').getAdminToken();

  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  return client();
}

/** Closes the server, releases SSE readers and removes the temp data dir. */
async function stop() {
  for (const reader of openReaders) {
    try { await reader.cancel(); } catch { /* already gone */ }
  }
  openReaders.clear();
  if (server) await new Promise(resolve => server.close(resolve));
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  restoreConsole();
}

// ─── HTTP client ─────────────────────────────────────────────────────────────

/**
 * Performs a request and returns { status, headers, body, text, res }. `body`
 * is the parsed JSON when the response is JSON, otherwise null — so a test can
 * assert on a status without worrying about the content type.
 */
async function request(method, urlPath, { headers = {}, body, json, form, redirect = 'manual' } = {}) {
  const init = { method, headers: { ...headers }, redirect };
  // fetch throws on a GET/HEAD with a body, and tests pass `json: {}` freely to
  // sweep many routes at once — drop the payload instead of blowing up.
  const bodyAllowed = method !== 'GET' && method !== 'HEAD';

  if (json !== undefined && bodyAllowed) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form !== undefined && bodyAllowed) {
    init.body = form;                   // FormData: fetch sets the boundary
  } else if (body !== undefined && bodyAllowed) {
    init.body = body;
  }

  const res  = await fetch(`${baseUrl}${urlPath}`, init);
  const text = await res.text();
  let parsed = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    try { parsed = JSON.parse(text); } catch { /* leave null */ }
  }
  return { status: res.status, headers: res.headers, body: parsed, text, res };
}

function client() {
  /** Admin-authenticated request. */
  const api = (urlPath, opts = {}) => request(opts.method || 'GET', urlPath, {
    ...opts,
    headers: { 'X-Admin-Token': token, ...(opts.headers || {}) },
  });

  /** Unauthenticated (public visitor) request. */
  const pub = (urlPath, opts = {}) => request(opts.method || 'GET', urlPath, opts);

  return {
    api, pub, request,
    get token()   { return token; },
    get baseUrl() { return baseUrl; },
    get dataDir() { return dataDir; },
    /** Console output the app produced so far (see captureConsole). */
    get logs()    { return logs; },
    /** Favicon fetches the app requested (see stubFaviconService). */
    get faviconCalls() { return faviconCalls; },
    /** Re-reads the token after a rotation. */
    refreshToken() { token = require('../../src/config/secrets').getAdminToken(); return token; },
    trackReader(reader) { openReaders.add(reader); return reader; },
    ...fixtures(api),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** 1×1 transparent PNG. */
function pngBytes() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/lXKrAAAAAElFTkSuQmCC',
    'base64',
  );
}

/** Tiny valid SVG, handy for icon uploads (and human-readable in failures). */
function svgBytes(color = '#0071e3') {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="7" fill="none" stroke="${color}"/></svg>`,
    'utf8',
  );
}

/** Builds a FormData with a single file field plus optional text fields. */
function fileForm(field, { name, type, bytes }, fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  form.append(field, new Blob([bytes], { type }), name);
  return form;
}

/** Accepts group ids or { group_id, section_id } and returns the v3 shape. */
function normaliseGroups(groups) {
  return groups.map(g => (typeof g === 'object' ? g : { group_id: g, section_id: null }));
}

function fixtures(api) {
  /** Creates a group and returns its row. */
  async function makeGroup(overrides = {}) {
    const payload = { name: `Group ${Math.random().toString(36).slice(2, 8)}`, color: '#0071e3', ...overrides };
    const { status, body } = await api('/api/groups', { method: 'POST', json: payload });
    if (status !== 201 && status !== 200) throw new Error(`makeGroup failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  /**
   * Creates a URL-backed link. `groups` accepts group ids or
   * { group_id, section_id } objects, matching parseGroupAssignments.
   */
  async function makeLink({ name = 'Test link', url, groups = [], description } = {}) {
    const form = new FormData();
    form.append('name', name);
    form.append('url', url || `https://${Math.random().toString(36).slice(2, 8)}.invalid/page`);
    if (description) form.append('description', description);
    // `groups` (not the legacy `group_ids`) is the shape that carries sections.
    if (groups.length) form.append('groups', JSON.stringify(normaliseGroups(groups)));
    const { status, body } = await api('/api/links', { method: 'POST', form });
    if (status !== 201 && status !== 200) throw new Error(`makeLink failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  /** Creates a file-backed link from in-memory bytes. */
  async function makeFileLink({ name = 'Doc', fileName = 'demo.html', type = 'text/html', bytes = Buffer.from('<h1>hi</h1>\n'), groups = [] } = {}) {
    const fields = { name };
    if (groups.length) fields.groups = JSON.stringify(normaliseGroups(groups));
    const form = fileForm('file', { name: fileName, type, bytes }, fields);
    const { status, body } = await api('/api/links', { method: 'POST', form });
    if (status !== 201 && status !== 200) throw new Error(`makeFileLink failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  /** Creates a section (or subsection, with parentId) inside a group. */
  async function makeSection(groupId, name = 'Section', parentId = null) {
    const json = parentId ? { name, parent_section_id: parentId } : { name };
    const { status, body } = await api(`/api/groups/${groupId}/sections`, { method: 'POST', json });
    if (status !== 201 && status !== 200) throw new Error(`makeSection failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  /** Uploads an icon straight into the library. */
  async function makeIcon({ name = 'icon.svg', type = 'image/svg+xml', bytes = svgBytes() } = {}) {
    const { status, body } = await api('/api/icons', {
      method: 'POST',
      form: fileForm('image', { name, type, bytes }),
    });
    if (status !== 201 && status !== 200) throw new Error(`makeIcon failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  return { makeGroup, makeLink, makeFileLink, makeSection, makeIcon };
}

module.exports = { start, stop, pngBytes, svgBytes, fileForm };
