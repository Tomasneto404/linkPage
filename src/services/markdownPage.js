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

const fs   = require('fs');
const path = require('path');

const { PUBLIC_DIR } = require('../config/env');
const { escapeHtml } = require('./markdownService');
const { shadeColor, hexToRgb } = require('../utils/color');

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
  // Inline only. The sandbox below gives this document an opaque origin, and
  // 'self' matches nothing from one — a linked stylesheet is refused, and a
  // refused render-blocking stylesheet leaves the page blank. So the palette
  // is inlined instead (see themeTokens).
  "style-src 'unsafe-inline'",
  // The public page may show a document in an overlay, which frames this page
  // rather than injecting its HTML — that keeps the document inside its own
  // sandbox instead of running beside the admin token. Only this site may.
  "frame-ancestors 'self'",
  "sandbox allow-popups",
].join('; ');

/** Themes the page will honour; anything else falls back to the system one. */
const PAGE_THEMES = new Set(['light', 'dark']);

/**
 * Normalises a ?theme= value. The result is written into an attribute, so
 * nothing but these two literals may ever come back.
 */
function normalizePageTheme(raw) {
  return PAGE_THEMES.has(String(raw || '').trim()) ? String(raw).trim() : null;
}

/**
 * The site's palette, read off disk and inlined into every rendered document.
 *
 * Inlined rather than linked because this page is sandboxed: an opaque origin
 * cannot satisfy style-src 'self', so a <link> to it is refused. Reading the
 * one file keeps a single source of truth — the same tokens the site itself
 * loads — rather than a second copy drifting in here.
 */
let cachedTokens = null;

function themeTokens() {
  if (cachedTokens !== null) return cachedTokens;
  try {
    cachedTokens = fs.readFileSync(path.join(PUBLIC_DIR, 'theme-tokens.css'), 'utf8');
  } catch (err) {
    // Without them the document still reads; it simply falls back to the
    // browser's own colours rather than the site's.
    console.warn(`[markdown] Could not read theme-tokens.css: ${err.message}`);
    cachedTokens = '';
  }
  return cachedTokens;
}

const PAGE_STYLES = `
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  padding: 24px 16px 64px;
}
body:has(.is-embedded) { background: var(--surface); padding: 18px 22px 40px; }
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

/* Inside the site's overlay the surrounding modal is the card, so this page
   flattens itself rather than drawing a second one. */
.is-embedded { max-width: none; }
.is-embedded .md-doc { background: none; border: 0; border-radius: 0; padding: 4px 8px 24px; }
`;

/**
 * Builds the full document. `title` is the link's name; `body` is the fragment
 * renderMarkdown produced.
 */
/**
 * The accent overrides the site applies on top of the palette. Mirrors
 * applyAccent() in public/app.js, which this page cannot run: it has no
 * script. Only --primary and --primary-rgb matter here (links, and the focus
 * ring the tokens derive), so the hover shade is left out.
 */
function accentVariables({ accent, accentDarkAdjust, dark }) {
  if (!accent) return '';

  const base = (dark && accentDarkAdjust) ? shadeColor(accent, 18) : accent;
  const rgb  = hexToRgb(base);
  if (!base || !rgb) return '';

  return `--primary:${base};--primary-rgb:${rgb.join(',')};`;
}

/** Only these appear in an attribute, so nothing else can be reflected. */
const VARIANT_RE = /^[a-z][a-z0-9-]{0,24}$/;
const safeVariant = v => (VARIANT_RE.test(String(v || '')) ? String(v) : 'default');

/**
 * Builds the full document.
 *
 * `palette` carries the site's own theme choices — the light and dark variant
 * names and the accent — so the document wears the same colours as the page
 * the reader came from, rather than an approximation of them.
 */
function renderMarkdownPage({ title, body, theme, embed = false, palette = {} }) {
  const heading   = escapeHtml(title || 'Document');
  const pageTheme = normalizePageTheme(theme);
  const themeAttr = pageTheme ? ` data-theme="${pageTheme}"` : '';

  // Both variants ride along, exactly as they do on the site: which one
  // applies is decided by data-theme, in theme-tokens.css.
  const variantAttrs = ` data-light-variant="${safeVariant(palette.lightVariant)}"`
                     + ` data-dark-variant="${safeVariant(palette.darkVariant)}"`;

  const accent = accentVariables({
    accent:           palette.accent,
    accentDarkAdjust: palette.accentDarkAdjust,
    dark:             pageTheme === 'dark',
  });
  const styleAttr = accent ? ` style="${accent}"` : '';
  // Embedded in the site's overlay: the modal already provides the frame and
  // a way out, so the page drops its own card and Back link.
  const shellClass = embed ? 'md-shell is-embedded' : 'md-shell';
  const backLink   = embed ? '' : '\n  <a class="md-back" href="/">&larr; Back</a>';
  return `<!DOCTYPE html>
<html lang="en"${themeAttr}${variantAttrs}${styleAttr}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${heading}</title>
<style>${themeTokens()}${PAGE_STYLES}</style>
</head>
<body>
<div class="${shellClass}">${backLink}
  <article class="md-doc">
${body || '<p><em>This document is empty.</em></p>'}
  </article>
</div>
</body>
</html>`;
}

module.exports = { renderMarkdownPage, MARKDOWN_CSP, normalizePageTheme };
