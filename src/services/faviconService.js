// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Favicon fetching + server-side caching.
 *
 * Best-effort: walks redirect chains (handling SSO loops), parses declared
 * <link rel="icon"> tags, probes conventional favicon paths, and falls back to
 * Google's favicon service. Entirely Express-free — the admin preview route and
 * the link save flow both call in here.
 */

const path = require('path');
const fs   = require('fs');
const { Agent: UndiciAgent } = require('undici');

const { UPLOADS_DIR } = require('../config/env');
const db = require('../models');
const { broadcastDataUpdate } = require('./sseService');

const FAVICON_REQUEST_TIMEOUT_MS = 4500;
const FAVICON_TOTAL_BUDGET_MS    = 8000;   // hard ceiling for the whole favicon hunt
const FAVICON_MAX_HTML_BYTES     = 256 * 1024;
const FAVICON_MAX_IMAGE_BYTES    = 2   * 1024 * 1024;
const FAVICON_USER_AGENT         = 'Mozilla/5.0 (compatible; LinkPage favicon fetcher)';
const FAVICON_EXT_FROM_TYPE = ct => (
  /svg/.test(ct)                                ? '.svg'  :
  /gif/.test(ct)                                ? '.gif'  :
  /webp/.test(ct)                               ? '.webp' :
  /(x-icon|vnd\.microsoft\.icon|^image\/ico\b)/.test(ct) ? '.ico'  :
                                                  '.png'
);

// undici Agent that skips TLS verification, used ONLY by the favicon fetcher
// so intranet sites with self-signed certs resolve correctly. Scoped — every
// other outbound request in this process still verifies certs normally.
const faviconInsecureDispatcher = new UndiciAgent({
  connect:               { rejectUnauthorized: false },
  connectTimeout:        FAVICON_REQUEST_TIMEOUT_MS,
  headersTimeout:        FAVICON_REQUEST_TIMEOUT_MS,
  bodyTimeout:           FAVICON_REQUEST_TIMEOUT_MS,
});

/**
 * fetch() wrapper with a hard timeout, body-size cap, and TLS bypass.
 * Returns the raw Response on success, or null on any failure.
 *
 * `redirect: 'manual'` lets the caller walk redirects step-by-step — fetch's
 * `'follow'` mode has a hidden 20-hop cap that breaks SSO chains looping
 * without cookies. Callers that want the simple follow behaviour can request
 * `redirect: 'follow'`.
 */
async function fetchWithLimits(url, {
  timeoutMs = FAVICON_REQUEST_TIMEOUT_MS,
  maxBytes,
  redirect  = 'follow',
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal:     controller.signal,
      redirect,
      headers:    { 'User-Agent': FAVICON_USER_AGENT, 'Accept': '*/*' },
      // Skip TLS validation — intranet hosts often serve self-signed certs.
      dispatcher: faviconInsecureDispatcher,
    });
    // Don't reject on !res.ok here — image probes deliberately want to read
    // bodies from 4xx responses (e.g. Google's "unknown domain" 404 ships a
    // valid PNG body). HTML/non-image callers re-check res.ok themselves.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Manually follows redirects up to `maxHops` (default 10), stopping on a loop
 * or non-3xx. Calls `onHop(url, response)` for every response (3xx or final).
 * Used to walk SSO chains where Node's built-in redirect handling would either
 * give up at 20 hops or burn time on an infinite OAuth loop.
 */
async function walkRedirects(startUrl, onHop, maxHops = 10) {
  let url = startUrl;
  const visited = new Set();
  for (let i = 0; i < maxHops; i++) {
    if (visited.has(url)) return;
    visited.add(url);

    const res = await fetchWithLimits(url, {
      maxBytes: FAVICON_MAX_HTML_BYTES,
      redirect: 'manual',
    });
    if (!res) return;

    const cont = await onHop(url, res);
    if (cont === false) return;

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return;
      try { url = new URL(loc, url).href; }
      catch { return; }
      continue;
    }
    return; // 2xx/4xx/5xx — the chain is over
  }
}

/**
 * Looks at the first chunk of an HTML page for a declared favicon link.
 * Returns an absolute URL or null. Picks "icon" / "shortcut icon" over
 * "apple-touch-icon" when multiple are present.
 */
function parseDeclaredIconUrl(html, baseUrl) {
  const head = html.slice(0, 64 * 1024);
  const candidates = [];
  const linkRegex = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRegex.exec(head)) !== null) {
    const tag  = m[0];
    const rel  = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!rel || !href || !rel.includes('icon')) continue;
    const score = rel.includes('apple') ? 1 : (rel.includes('shortcut') ? 2 : 3);
    candidates.push({ score, href });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  try { return new URL(candidates[0].href, baseUrl).href; } catch { return null; }
}

async function fetchHtml(url) {
  const res = await fetchWithLimits(url, { maxBytes: FAVICON_MAX_HTML_BYTES });
  if (!res || !res.ok) return null;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct && !ct.includes('html')) return null;
  return (await res.text()).slice(0, FAVICON_MAX_HTML_BYTES);
}

/**
 * Walks the redirect chain manually so we can sniff any HTML page along the
 * way for a declared favicon link. Bypasses fetch's hidden redirect cap and
 * stops at loops, so SSO chains that bounce forever don't strand the request.
 * Returns { html, finalUrl, hopOrigins[] } — hopOrigins is every distinct
 * origin/base path visited, so callers can probe each for /favicon.ico fallbacks.
 */
async function collectFaviconCandidatesAlongRedirects(siteUrl) {
  const hopOrigins = new Set();
  const hopBases   = new Set();   // distinct path prefixes, e.g. /ovirt-engine/
  let bestHtml     = null;
  let finalUrl     = siteUrl;

  await walkRedirects(siteUrl, async (url, res) => {
    try {
      const u = new URL(url);
      hopOrigins.add(u.origin);
      // First path segment (e.g. /ovirt-engine) is a useful fallback root.
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) hopBases.add(`${u.origin}/${seg}`);
    } catch {}

    if (res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('html')) {
        // The body of an Apache "Found" 302 page is also text/html, so don't
        // overwrite a real 200 HTML with a redirect-body one.
        const body = (await res.text()).slice(0, FAVICON_MAX_HTML_BYTES);
        if (!bestHtml || res.status === 200) {
          bestHtml = body;
          finalUrl = url;
        }
      }
    }
  });

  return { html: bestHtml, finalUrl, hopOrigins: [...hopOrigins], hopBases: [...hopBases] };
}

async function fetchImageCandidate(url) {
  // Use redirect:'manual' here too so we don't burn the 20-hop budget on
  // /favicon.ico endpoints that lead into the same SSO loop. Follow one
  // explicit hop manually if needed.
  const res = await fetchWithLimits(url, {
    maxBytes: FAVICON_MAX_IMAGE_BYTES,
    redirect: 'follow',
  });
  if (!res) return null;
  const contentType = (res.headers.get('content-type') || 'application/octet-stream')
    .split(';')[0].trim().toLowerCase();
  // Reject anything that clearly isn't an image. Note: we accept the response
  // even on 404/5xx as long as the body decodes as an image — Google's favicon
  // API famously serves its "unknown domain" globe with HTTP 404 and the bytes
  // are a perfectly good PNG. Browsers render them; so should we.
  const looksImageish = contentType.startsWith('image/')
                     || contentType === 'application/ico'
                     || contentType === 'application/octet-stream';
  if (!looksImageish) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.byteLength || buffer.byteLength > FAVICON_MAX_IMAGE_BYTES) return null;
  return { buffer, contentType };
}

// Conventional locations a browser would try if nothing is declared in HTML.
const FAVICON_FALLBACK_PATHS = [
  '/favicon.ico',
  '/favicon.png',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/static/favicon.ico',
  '/assets/favicon.ico',
  '/images/favicon.ico',
];

/**
 * Best-effort favicon fetcher. Returns { buffer, contentType } or null.
 *
 *   1. Walk the redirect chain (handling SSO loops) and parse any HTML page
 *      we hit for a declared <link rel="icon">.
 *   2. Probe a wide set of conventional favicon paths at every origin / path
 *      prefix we touched along the way — covers servers that hide /favicon.ico
 *      behind auth but expose one under /<app>/favicon.ico, /static/, etc.
 *   3. Fall back to Google's favicon service for public URLs.
 */
async function fetchFaviconForUrl(siteUrl) {
  let parsed;
  try { parsed = new URL(siteUrl); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // Overall wall-clock budget for the *entire* favicon hunt. Without this, an
  // unreachable host could chew through the redirect walk plus a dozen
  // fallback paths, each waiting out its own per-request timeout — minutes in
  // the worst case. Once the deadline passes we stop probing and give up.
  const deadline = Date.now() + FAVICON_TOTAL_BUDGET_MS;
  const outOfTime = () => Date.now() >= deadline;

  const { html, finalUrl, hopOrigins, hopBases } =
    await collectFaviconCandidatesAlongRedirects(siteUrl);

  // 1) HTML-declared icon link.
  if (html && !outOfTime()) {
    const declared = parseDeclaredIconUrl(html, finalUrl);
    if (declared) {
      const img = await fetchImageCandidate(declared);
      if (img) return img;
    }
  }

  // 2) Conventional locations under every origin/base we visited.
  const tried = new Set();
  const roots = [parsed.origin, ...hopOrigins, ...hopBases];
  for (const root of roots) {
    if (outOfTime()) return null;
    for (const p of FAVICON_FALLBACK_PATHS) {
      if (outOfTime()) return null;
      const url = `${root.replace(/\/$/, '')}${p}`;
      if (tried.has(url)) continue;
      tried.add(url);
      const img = await fetchImageCandidate(url);
      if (img) return img;
    }
  }

  if (outOfTime()) return null;

  // 3) Google's service — only works for public hostnames.
  return fetchImageCandidate(
    `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`
  );
}

/**
 * Downloads the favicon for a link and saves it locally. Tries the site itself
 * first (so intranet URLs work) and falls back to Google's favicon service.
 *
 * Always run fire-and-forget (never awaited by a request handler) so a slow or
 * unreachable host can't delay the link save. When it *does* land a favicon it
 * broadcasts an SSE update so open admin/public pages refresh and show it.
 */
async function cacheFavicon(linkId, siteUrl) {
  try {
    const found = await fetchFaviconForUrl(siteUrl);
    if (!found) return;

    const { buffer, contentType } = found;
    const hostname = new URL(siteUrl).hostname;
    const ext      = FAVICON_EXT_FROM_TYPE(contentType);
    const filename = `favicon_${linkId}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Remove any previous favicon for this link (different extension), but
    // skip files that the icon library owns — deleting those would orphan rows.
    for (const oldExt of ['.svg', '.gif', '.webp', '.png', '.ico']) {
      const old       = path.join(UPLOADS_DIR, `favicon_${linkId}${oldExt}`);
      const oldStored = `/uploads/favicon_${linkId}${oldExt}`;
      if (old !== filePath && fs.existsSync(old) && !db.getIconByPath(oldStored)) {
        fs.unlinkSync(old);
      }
    }

    fs.writeFileSync(filePath, buffer);
    const storedPath = `/uploads/${filename}`;
    db.updateLinkFavicon(linkId, storedPath);

    if (db.readSetting('save_favicons_to_library') === '1') {
      db.createIcon({
        filePath:     storedPath,
        originalName: `${hostname} favicon`,
        mimeType:     contentType,
        fileSize:     buffer.byteLength,
      });
    }

    // The link was saved earlier without a favicon; nudge open pages so the
    // freshly-cached icon appears without a manual reload.
    broadcastDataUpdate();
  } catch {
    // Favicon caching is best-effort — silently ignore failures
  }
}

module.exports = { fetchFaviconForUrl, cacheFavicon };
