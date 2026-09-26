// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Markdown → HTML, for links whose attached file is a .md.
 *
 * Safety model: the source is HTML-escaped *before* any parsing happens, so
 * the only tags that can reach the output are ones this file writes. Raw HTML
 * in the document comes out as visible text, not markup. That matters because
 * a .md can arrive from an unauthenticated visitor through a file request and
 * is then rendered on the same origin as the admin panel.
 *
 * URLs get a second check of their own (see safeUrl): escaping stops an entity
 * re-forming into a scheme, and the allow-list stops javascript:/data: even
 * when it is spelled oddly. The served page also carries a no-script CSP, so a
 * hole here still could not execute anything.
 *
 * The supported subset is the one documents actually use: headings, code,
 * lists, quotes, rules, tables, emphasis, links and images. Anything outside
 * it degrades to text rather than being guessed at.
 */

// ─── Escaping ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── URLs ─────────────────────────────────────────────────────────────────────

/** Schemes a document may link to. Everything else is not a link at all. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * Returns the URL when it is safe to put in an href/src, else null.
 *
 * The probe strips control characters and spaces first, so "java\tscript:" and
 * " javascript:" are judged on what a browser would actually resolve, not on
 * how they were typed. A relative URL (no scheme at all) is allowed: it can
 * only ever point back at this site.
 */
function safeUrl(escapedUrl) {
  const probe = String(escapedUrl).replace(/[\u0000- \u007f]/g, '').toLowerCase();
  if (!probe) return null;

  const scheme = probe.match(/^([a-z][a-z0-9+.-]*):/);
  if (scheme) return SAFE_SCHEMES.has(scheme[1] + ':') ? escapedUrl.trim() : null;

  // No scheme — a relative reference. Reject protocol-relative "//host", which
  // would leave the site without saying so.
  if (probe.startsWith('//')) return null;
  return escapedUrl.trim();
}

// ─── Inline ───────────────────────────────────────────────────────────────────

// Code spans are pulled out before anything else runs and put back last, so
// their contents are never treated as markdown. NUL cannot occur in the
// escaped text around them, which makes it a safe placeholder marker.
const CODE_MARK = '\u0000';

// A link target runs to the closing paren, but may itself contain a balanced
// pair — "…/wiki/Foo_(bar)" is one URL, not a URL plus a stray bracket. One
// level of nesting is what real links use.
const URL_PATTERN   = '((?:[^()\\s]|\\([^()\\s]*\\))+)';
// An optional "title" after the URL, which escaping turned into &quot;…&quot;.
const TITLE_PATTERN = '(?:\\s+&quot;[^)]*&quot;)?';

function renderInline(raw) {
  let text = escapeHtml(raw);

  const codeSpans = [];
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, fence, code) => {
    codeSpans.push(code.replace(/^ | $/g, ''));
    return `${CODE_MARK}${codeSpans.length - 1}${CODE_MARK}`;
  });

  // Images before links: ![alt](src) shares its tail with [text](href).
  text = text.replace(new RegExp(`!\\[([^\\]]*)\\]\\(${URL_PATTERN}${TITLE_PATTERN}\\)`, 'g'), (whole, alt, src) => {
    const safe = safeUrl(src);
    return safe ? `<img src="${safe}" alt="${alt}" loading="lazy" />` : whole;
  });

  text = text.replace(new RegExp(`\\[([^\\]]*)\\]\\(${URL_PATTERN}${TITLE_PATTERN}\\)`, 'g'), (whole, label, href) => {
    const safe = safeUrl(href);
    // An unsafe target is not a link: the label stays as plain text so the
    // reader still sees what was written.
    return safe
      ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  });

  // Autolinks: <https://example.com>, which escaping turned into &lt;…&gt;.
  text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (whole, url) => {
    const safe = safeUrl(url);
    return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>` : whole;
  });

  text = text
    .replace(/\*\*([^\s*][\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\s_][\s\S]*?)__/g,     '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^\s*][\s\S]*?)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^\s_][\s\S]*?)_/g,   '$1<em>$2</em>')
    .replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');

  // Put the code spans back, still escaped and otherwise untouched.
  return text.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'),
    (_, index) => `<code>${codeSpans[Number(index)]}</code>`);
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

const FENCE_RE   = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE    = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const LIST_RE    = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const QUOTE_RE   = /^\s*>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Splits a table row into its cells, ignoring the outer pipes. */
function tableCells(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

/**
 * True when a line opens a block of its own, and so ends any list above it.
 * Anything else that is not blank and not a list item is a wrapped
 * continuation of the item before it.
 */
function startsBlock(line) {
  return HEADING_RE.test(line) || RULE_RE.test(line)
      || FENCE_RE.test(line)   || QUOTE_RE.test(line);
}

/**
 * Renders a list starting at `start`. Items indented further than the first
 * one open a nested list, which recurses. A plain line under an item is a
 * wrapped continuation of it — editors and humans both break long items over
 * several lines, and markdown folds them back together. Returns the HTML and
 * the index of the first line that was not part of the list.
 */
function renderList(lines, start) {
  const first = lines[start].match(LIST_RE);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];

  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(LIST_RE);
    if (!match) {
      // Not an item: either the item above continues onto this line, or the
      // list is over.
      const line = lines[i];
      if (items.length && line.trim() && !startsBlock(line)) {
        items[items.length - 1] += ` ${renderInline(line.trim())}`;
        i++;
        continue;
      }
      break;
    }

    const indent = match[1].length;
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      // Deeper: a sublist hanging off the item we just added.
      const nested = renderList(lines, i);
      items[items.length - 1] += nested.html;
      i = nested.next;
      continue;
    }

    // A list stops mixing types rather than guessing what was meant.
    if (/\d/.test(match[2]) !== ordered) break;

    items.push(renderInline(match[3]));
    i++;
  }

  const tag = ordered ? 'ol' : 'ul';
  return {
    html: `<${tag}>\n${items.map(item => `<li>${item}</li>`).join('\n')}\n</${tag}>`,
    next: i,
  };
}

/**
 * Converts markdown into an HTML fragment. Returns '' for anything that is not
 * a non-empty string, so a missing or unreadable file renders as nothing
 * rather than throwing.
 */
function renderMarkdown(source) {
  if (typeof source !== 'string' || !source) return '';

  const lines = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  let paragraph = [];

  /** Flushes the lines gathered so far as one paragraph. */
  function closeParagraph() {
    if (!paragraph.length) return;
    // Two trailing spaces, or a trailing backslash, is an explicit line break.
    const body = paragraph
      .map((line, index) => {
        const isLast = index === paragraph.length - 1;
        const hard   = /(\s{2,}|\\)$/.test(line);
        const text   = renderInline(line.replace(/(\s{2,}|\\)$/, ''));
        return isLast || !hard ? text : `${text}<br />`;
      })
      .join('\n');
    out.push(`<p>${body}</p>`);
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── fenced code ──────────────────────────────────────────────────────
    const fence = line.match(FENCE_RE);
    if (fence) {
      closeParagraph();
      const marker = fence[1];
      const lang   = fence[2];
      const body   = [];
      i++;
      // An unclosed fence runs to the end of the file rather than swallowing
      // the document into a parse error.
      while (i < lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${classAttr}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { closeParagraph(); continue; }

    // ── heading / rule ───────────────────────────────────────────────────
    const heading = line.match(HEADING_RE);
    if (heading) {
      closeParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      continue;
    }

    if (RULE_RE.test(line)) { closeParagraph(); out.push('<hr />'); continue; }

    // ── table ────────────────────────────────────────────────────────────
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      closeParagraph();
      const head = tableCells(line).map(c => `<th>${renderInline(c)}</th>`).join('');
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        body.push(`<tr>${tableCells(lines[i]).map(c => `<td>${renderInline(c)}</td>`).join('')}</tr>`);
        i++;
      }
      i--;
      out.push(`<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body.join('\n')}\n</tbody>\n</table>`);
      continue;
    }

    // ── blockquote ───────────────────────────────────────────────────────
    if (QUOTE_RE.test(line)) {
      closeParagraph();
      const quoted = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].match(QUOTE_RE)[1]);
        i++;
      }
      i--;
      // Recurse so a quote may hold headings, lists and code of its own.
      out.push(`<blockquote>\n${renderMarkdown(quoted.join('\n'))}\n</blockquote>`);
      continue;
    }

    // ── list ─────────────────────────────────────────────────────────────
    if (LIST_RE.test(line)) {
      closeParagraph();
      const list = renderList(lines, i);
      out.push(list.html);
      i = list.next - 1;
      continue;
    }

    // ── indented code ────────────────────────────────────────────────────
    if (/^ {4}\S/.test(line) && !paragraph.length) {
      closeParagraph();
      const body = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || !lines[i].trim())) {
        if (!lines[i].trim() && !/^ {4}/.test(lines[i + 1] || '')) break;
        body.push(lines[i].slice(4));
        i++;
      }
      i--;
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    paragraph.push(line);
  }

  closeParagraph();
  return out.join('\n');
}

module.exports = { renderMarkdown, escapeHtml, safeUrl };
