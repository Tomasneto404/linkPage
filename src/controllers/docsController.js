// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** The OpenAPI document, and the Swagger UI that renders it. */

const { buildOpenApiSpec } = require('../docs/openapi');

// Built once: the document is static apart from the version, which cannot
// change while the process is running.
let cached = null;

function spec(req, res) {
  if (!cached) cached = buildOpenApiSpec();
  res.json(cached);
}

/**
 * The Swagger UI shell.
 *
 * Served without a token, exactly like /admin: it is markup and nothing else,
 * and the document it fetches is what carries the gate. The page asks for the
 * token, keeps it in localStorage under the same key the admin panel uses —
 * so a logged-in admin never has to paste it twice — and sends it on every
 * request the UI makes, including the *Try it out* ones.
 */
function page(req, res) {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LinkPage API</title>
<link rel="icon" href="/brand/icon-light.png" />
<link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
<style>
  body { margin: 0; background: #fafafa; }
  .topbar { display: none; }
  .lp-bar {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 12px 20px; background: #1d1d1f; color: #f5f5f7;
    font: 14px -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  }
  .lp-bar img { height: 22px; }
  .lp-bar .lp-spacer { flex: 1; }
  .lp-bar input {
    background: #2c2c2e; border: 1px solid #3a3a3c; border-radius: 7px;
    color: #f5f5f7; padding: 6px 10px; font: inherit; font-size: 13px; width: 320px;
    max-width: 50vw;
  }
  .lp-bar button {
    background: #0071e3; border: 0; border-radius: 7px; color: #fff;
    padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer;
  }
  .lp-bar .lp-state { font-size: 12px; color: #98989d; }

  /* Shown instead of the UI when there is no token: a bare "failed to load"
     from Swagger is a poor way to say "you have not signed in". */
  #lpEmpty {
    max-width: 640px; margin: 80px auto; padding: 0 24px;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
    color: #1d1d1f;
  }
  #lpEmpty h1 { font-size: 1.4rem; font-weight: 650; margin: 0 0 12px; }
  #lpEmpty code { background: #ececee; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
  #lpEmpty .lp-quiet { color: #6e6e73; font-size: 0.9375rem; }
</style>
</head>
<body>
<div class="lp-bar">
  <img src="/brand/icon-dark.png" alt="" />
  <strong>LinkPage API</strong>
  <span class="lp-spacer"></span>
  <label for="lpToken" class="lp-state">Admin token</label>
  <input id="lpToken" type="password" autocomplete="off" spellcheck="false"
         placeholder="Paste it to try requests…" />
  <button id="lpSave" type="button">Use</button>
  <span class="lp-state" id="lpState"></span>
</div>
<div id="swagger"></div>
<div id="lpEmpty" hidden>
  <h1>Paste your admin token to load the documentation</h1>
  <p>
    The document this page renders is gated like the API it describes, so it needs the
    token before it will load. It is printed to the console when the server starts, and
    kept in <code>data/admin-token.txt</code>.
  </p>
  <p class="lp-quiet">
    Signed in to the admin panel in this browser already? Then it is stored and this page
    picks it up on its own.
  </p>
</div>

<script src="/api/docs/assets/swagger-ui-bundle.js"></script>
<script src="/api/docs/assets/swagger-ui-standalone-preset.js"></script>
<script>
  // The same key the admin panel stores its token under, so opening the docs
  // while signed in to the admin just works.
  var TOKEN_KEY = 'linkpage_admin_token';
  var input = document.getElementById('lpToken');
  var state = document.getElementById('lpState');

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function showState() {
    state.textContent = token() ? 'Sent with every request' : 'Not set — admin routes will answer 401';
  }

  input.value = token();
  showState();

  document.getElementById('lpSave').addEventListener('click', function () {
    try { localStorage.setItem(TOKEN_KEY, input.value.trim()); } catch (e) { /* private window */ }
    showState();
    location.reload();   // so the document itself is fetched with the new token
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('lpSave').click();
  });

  if (!token()) {
    // Nothing to authenticate with, so do not boot the UI just to have it fail.
    document.getElementById('lpEmpty').hidden = false;
    input.focus();
  } else window.ui = SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'BaseLayout',
    deepLinking: true,
    persistAuthorization: true,
    tryItOutEnabled: true,
    // Every request the UI makes carries the token, including the fetch of
    // the document itself.
    requestInterceptor: function (req) {
      var t = token();
      if (t) req.headers['X-Admin-Token'] = t;
      return req;
    },
  });
</script>
</body>
</html>`);
}

module.exports = { spec, page };
