// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Wraps rendered markdown in a standalone, self-contained page.
 *
 * Self-contained on purpose: the page is served under a CSP that permits no
 * scripts and no external stylesheets, so it carries its own styles inline and
 * follows the reader's system theme rather than the site's theme toggle (which
 * would need script to read). The palette mirrors public/style.css.
 */

const { escapeHtml } = require('./markdownService');

/**
 * The policy the rendered page is served under. `default-src 'none'` means no
 * script can run even if the renderer were ever tricked into emitting one, and
 * `sandbox` drops the document into an opaque origin so it cannot reach this
 * site's storage — where the admin token lives. Images are allowed so that a
 * document's illustrations still show.
 */
const MARKDOWN_CSP = [
  "default-src 'none'",
  "img-src 'self' https: data:",
  "style-src 'unsafe-inline'",
  "sandbox allow-popups",
].join('; ');

const PAGE_STYLES = `
:root {
  --bg: #f5f5f7; --surface: #ffffff; --surface-3: #f0f0f2;
  --border: rgba(0,0,0,0.08); --primary: #0071e3;
  --text: #1d1d1f; --text-muted: #86868b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000; --surface: #1c1c1e; --surface-3: #2c2c2e;
    --border: rgba(255,255,255,0.12); --primary: #0a84ff;
    --text: #f5f5f7; --text-muted: #98989d;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  padding: 24px 16px 64px;
}
.md-shell { max-width: 760px; margin: 0 auto; }
.md-back {
  display: inline-block; margin-bottom: 18px; color: var(--text-muted);
  text-decoration: none; font-size: 0.875rem;
}
.md-back:hover { color: var(--primary); }
.md-doc {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 32px 36px;
}
.md-doc > :first-child { margin-top: 0; }
.md-doc > :last-child { margin-bottom: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.8em 0 0.6em; font-weight: 650; }
h1 { font-size: 1.85rem; } h2 { font-size: 1.45rem; } h3 { font-size: 1.2rem; }
h4, h5, h6 { font-size: 1rem; }
h1, h2 { padding-bottom: 0.3em; border-bottom: 1px solid var(--border); }
p, ul, ol, blockquote, table, pre { margin: 0 0 1em; }
a { color: var(--primary); }
ul, ol { padding-left: 1.6em; }
li { margin: 0.25em 0; }
blockquote {
  margin-left: 0; padding: 2px 0 2px 16px;
  border-left: 3px solid var(--border); color: var(--text-muted);
}
code {
  background: var(--surface-3); padding: 0.15em 0.4em; border-radius: 5px;
  font: 0.875em ui-monospace, SFMono-Regular, Menlo, monospace;
}
pre {
  background: var(--surface-3); padding: 14px 16px; border-radius: 10px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; font-size: 0.8125rem; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
img { max-width: 100%; height: auto; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 0.9375rem; }
th, td { border: 1px solid var(--border); padding: 7px 11px; text-align: left; }
th { background: var(--surface-3); font-weight: 600; }
@media (max-width: 600px) { .md-doc { padding: 22px 18px; } }
`;

/**
 * Builds the full document. `title` is the link's name; `body` is the fragment
 * renderMarkdown produced.
 */
function renderMarkdownPage({ title, body }) {
  const heading = escapeHtml(title || 'Document');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${heading}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<div class="md-shell">
  <a class="md-back" href="/">&larr; Back</a>
  <article class="md-doc">
${body || '<p><em>This document is empty.</em></p>'}
  </article>
</div>
</body>
</html>`;
}

module.exports = { renderMarkdownPage, MARKDOWN_CSP };
