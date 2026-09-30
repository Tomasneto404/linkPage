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

/**
 * Holds cookies across requests, the way a browser would.
 *
 * `fetch` does not do this: every call starts with no cookies and throws away
 * whatever came back. A session lives in a cookie, so without this a test can
 * sign in and then be a stranger on the very next line.
 */
class CookieJar {
  constructor() { this.cookies = new Map(); }

  /** Reads every Set-Cookie on a response, honouring deletions. */
  capture(res) {
    // getSetCookie keeps them separate. headers.get('set-cookie') folds them
    // into one comma-joined string, which is unparseable once an Expires date
    // (which contains a comma) is in play.
    const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
    for (const line of raw) {
      const [pair, ...attrs] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name  = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();

      const expired = attrs.some(a => /^\s*Max-Age\s*=\s*0\s*$/i.test(a))
                   || value === '';
      if (expired) this.cookies.delete(name);
      else         this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name) { return this.cookies.get(name) || null; }
  clear()   { this.cookies.clear(); }
}

function client() {
  /** Admin-authenticated request. */
  const api = (urlPath, opts = {}) => request(opts.method || 'GET', urlPath, {
    ...opts,
    headers: { 'X-Admin-Token': token, ...(opts.headers || {}) },
  });

  /** Unauthenticated (public visitor) request. */
  const pub = (urlPath, opts = {}) => request(opts.method || 'GET', urlPath, opts);

  /**
   * A browser-shaped client: carries its cookies, and announces where its
   * requests come from.
   *
   * The Origin header is not decoration — verifySameOrigin refuses a
   * cookie-bearing write that cannot say where it came from, which is exactly
   * what a real browser always can. Pass `noOrigin: true` or an `origin` to
   * play the part of a page on another site.
   */
  function session({ jar = new CookieJar() } = {}) {
    const send = async (urlPath, opts = {}) => {
      const method  = opts.method || 'GET';
      const headers = { ...(opts.headers || {}) };

      const cookie = jar.header();
      if (cookie && !headers.Cookie) headers.Cookie = cookie;

      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (unsafe && !opts.noOrigin && !headers.Origin) {
        headers.Origin = opts.origin || baseUrl;
      }

      const res = await request(method, urlPath, { ...opts, headers });
      jar.capture(res.res);
      return res;
    };

    return {
      fetch: send,
      jar,
      /** Signs in, and from then on this client is that person. */
      async login(email, password, opts = {}) {
        const res = await send('/api/auth/login', {
          method: 'POST', json: { email, password, ...opts },
        });
        return res;
      },
      async logout() { return send('/api/auth/logout', { method: 'POST' }); },
      get sessionCookie() { return jar.get('lp_sess'); },
    };
  }

  return {
    api, pub, request, session, CookieJar,
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
  /**
   * Creates an account, straight through the models.
   *
   * Not through the API: there is no endpoint that creates a user outright —
   * accounts come from an invite — and a test that only needs somebody to sign
   * in as should not have to act out the whole invitation.
   */
  async function makeUser({ email, password = 'correct-horse-battery', role = 'user',
                            displayName = null } = {}) {
    const models = require('../../src/models');
    const { hashPassword } = require('../../src/utils/password');
    const address = email || `user-${Math.random().toString(36).slice(2, 8)}@example.test`;

    const user = models.createUser({
      email:        address,
      displayName,
      passwordHash: await hashPassword(password),
      role,
    });
    return { ...user, password };
  }

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
  async function makeLink({ name = 'Test link', url, groups = [], description, slug } = {}) {
    const form = new FormData();
    form.append('name', name);
    form.append('url', url || `https://${Math.random().toString(36).slice(2, 8)}.invalid/page`);
    if (description) form.append('description', description);
    if (slug) form.append('slug', slug);
    // `groups` (not the legacy `group_ids`) is the shape that carries sections.
    if (groups.length) form.append('groups', JSON.stringify(normaliseGroups(groups)));
    const { status, body } = await api('/api/links', { method: 'POST', form });
    if (status !== 201 && status !== 200) throw new Error(`makeLink failed: ${status} ${JSON.stringify(body)}`);
    return body;
  }

  /** Creates a file-backed link from in-memory bytes. */
  async function makeFileLink({ name = 'Doc', fileName = 'demo.html', type = 'text/html', bytes = Buffer.from('<h1>hi</h1>\n'), groups = [], slug } = {}) {
    const fields = { name };
    if (slug) fields.slug = slug;
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

  return { makeUser, makeGroup, makeLink, makeFileLink, makeSection, makeIcon };
}

module.exports = { start, stop, pngBytes, svgBytes, fileForm };
