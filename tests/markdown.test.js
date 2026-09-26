// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Markdown rendering. The renderer escapes first and emits only its own tags,
 * so the hostile cases matter as much as the pretty ones — a .md file can
 * arrive from an unauthenticated visitor through a file request.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../src/services/markdownService');

describe('block constructs', () => {
  test('headings, levels one through six', () => {
    assert.match(renderMarkdown('# Title'),        /<h1>Title<\/h1>/);
    assert.match(renderMarkdown('### Smaller'),    /<h3>Smaller<\/h3>/);
    assert.match(renderMarkdown('###### Tiny'),    /<h6>Tiny<\/h6>/);
    assert.doesNotMatch(renderMarkdown('####### Too deep'), /<h7>/);
  });

  test('paragraphs, separated by blank lines', () => {
    const html = renderMarkdown('First para.\n\nSecond para.');
    assert.match(html, /<p>First para\.<\/p>/);
    assert.match(html, /<p>Second para\.<\/p>/);
  });

  test('a hard break inside a paragraph', () => {
    assert.match(renderMarkdown('line one  \nline two'), /line one<br \/>\s*line two/);
  });

  test('unordered and ordered lists', () => {
    const ul = renderMarkdown('- one\n- two');
    assert.match(ul, /<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);

    const ol = renderMarkdown('1. first\n2. second');
    assert.match(ol, /<ol>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/);
  });

  test('a nested list', () => {
    const html = renderMarkdown('- outer\n  - inner');
    assert.match(html, /<li>outer<ul>\s*<li>inner<\/li>\s*<\/ul><\/li>/);
  });

  test('blockquotes, including several lines', () => {
    const html = renderMarkdown('> quoted\n> still quoted');
    assert.match(html, /<blockquote>/);
    assert.match(html, /quoted/);
  });

  test('fenced code keeps its content verbatim and unformatted', () => {
    const html = renderMarkdown('```js\nconst a = **not bold**;\n```');
    assert.match(html, /<pre><code class="language-js">/);
    assert.match(html, /const a = \*\*not bold\*\*;/, 'markdown inside a fence is not processed');
    assert.doesNotMatch(html, /<strong>/);
  });

  test('indented code', () => {
    const html = renderMarkdown('    const indented = 1;');
    assert.match(html, /<pre><code>const indented = 1;/);
  });

  test('horizontal rules', () => {
    assert.match(renderMarkdown('---'),   /<hr \/>/);
    assert.match(renderMarkdown('***'),   /<hr \/>/);
  });

  test('pipe tables', () => {
    const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |');
    assert.match(html, /<table>/);
    assert.match(html, /<th>A<\/th>/);
    assert.match(html, /<td>1<\/td>/);
  });
});

describe('inline constructs', () => {
  test('bold, italic and strikethrough', () => {
    assert.match(renderMarkdown('**bold**'),     /<strong>bold<\/strong>/);
    assert.match(renderMarkdown('__bold__'),     /<strong>bold<\/strong>/);
    assert.match(renderMarkdown('*italic*'),     /<em>italic<\/em>/);
    assert.match(renderMarkdown('_italic_'),     /<em>italic<\/em>/);
    assert.match(renderMarkdown('~~gone~~'),     /<del>gone<\/del>/);
  });

  test('inline code is left alone inside', () => {
    const html = renderMarkdown('use `**literal**` here');
    assert.match(html, /<code>\*\*literal\*\*<\/code>/);
    assert.doesNotMatch(html, /<strong>/);
  });

  test('links and images', () => {
    const link = renderMarkdown('[docs](https://example.com/x)');
    assert.match(link, /<a href="https:\/\/example\.com\/x"[^>]*>docs<\/a>/);
    assert.match(link, /rel="noopener noreferrer"/);
    assert.match(link, /target="_blank"/);

    const img = renderMarkdown('![a cat](https://example.com/cat.png)');
    assert.match(img, /<img src="https:\/\/example\.com\/cat\.png" alt="a cat"/);
  });

  test('a URL may contain balanced parentheses', () => {
    const html = renderMarkdown('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))');
    assert.match(html, /href="https:\/\/en\.wikipedia\.org\/wiki\/Foo_\(bar\)"/);
    assert.doesNotMatch(html, /\)<\/a>\)/, 'the closing paren is not left dangling');
  });

  test('relative and mailto links are kept', () => {
    assert.match(renderMarkdown('[home](/)'),               /<a href="\/"/);
    assert.match(renderMarkdown('[file](/uploads/a.pdf)'),  /<a href="\/uploads\/a\.pdf"/);
    assert.match(renderMarkdown('[mail](mailto:a@b.com)'),  /<a href="mailto:a@b\.com"/);
  });

  test('autolinks', () => {
    assert.match(renderMarkdown('<https://example.com>'), /<a href="https:\/\/example\.com"/);
  });
});

describe('hostile input', () => {
  test('raw HTML is shown as text, never as markup', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /&lt;script&gt;/);
  });

  test('an img with an onerror handler cannot be smuggled in', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    // The words survive as visible text; what must not survive is the markup.
    assert.doesNotMatch(html, /<img/i, 'no element is emitted');
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'it reads as literal text');
  });

  test('a javascript: link renders as plain text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /<a /, 'no anchor at all');
    assert.doesNotMatch(html, /javascript:alert\(1\)"/, 'and certainly not as an href');
    assert.match(html, /<p>click<\/p>/, 'the label survives as text, with no syntax left over');
  });

  test('scheme obfuscation does not get past the check', () => {
    for (const url of [
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      '\u0000javascript:alert(1)',
    ]) {
      const html = renderMarkdown(`[x](${url})`);
      assert.doesNotMatch(html, /<a /, `anchor emitted for ${JSON.stringify(url)}`);
    }
  });

  test('an image source is checked the same way', () => {
    const html = renderMarkdown('![x](javascript:alert(1))');
    assert.doesNotMatch(html, /<img/);
  });

  test('an HTML entity cannot re-form into a scheme', () => {
    const html = renderMarkdown('[x](&#106;avascript:alert(1))');
    assert.doesNotMatch(html, /<a [^>]*javascript/i);
  });

  test('quotes in a URL cannot break out of the attribute', () => {
    const html = renderMarkdown('[x](https://example.com/a"onmouseover="alert(1))');
    // The quote is escaped, so it stays part of the href value instead of
    // closing it — the payload never becomes an attribute of its own.
    assert.match(html, /&quot;onmouseover=&quot;/, 'the quotes are entities inside the value');
    assert.doesNotMatch(html, /"\s*onmouseover\s*=/, 'no attribute breaks out');
  });

  test('a code fence cannot emit markup', () => {
    const html = renderMarkdown('```\n<script>alert(1)</script>\n```');
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /&lt;script&gt;/);
  });

  test('a heading and a list item are escaped too', () => {
    assert.doesNotMatch(renderMarkdown('# <script>x</script>'), /<script/i);
    assert.doesNotMatch(renderMarkdown('- <script>x</script>'), /<script/i);
    assert.doesNotMatch(renderMarkdown('> <script>x</script>'), /<script/i);
    assert.doesNotMatch(renderMarkdown('| <script>x</script> |\n| --- |\n| a |'), /<script/i);
  });

  test('an image alt cannot break out', () => {
    const html = renderMarkdown('![" onerror="alert(1)](https://example.com/a.png)');
    assert.match(html, /alt="&quot; onerror=&quot;alert\(1\)"/, 'the quotes are escaped inside alt');
    assert.doesNotMatch(html, /"\s*onerror\s*=/, 'no attribute breaks out');
  });
});

describe('robustness', () => {
  test('empty and non-string input render to nothing', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown(undefined), '');
    assert.equal(renderMarkdown(42), '');
  });

  test('an unclosed fence still terminates', () => {
    const html = renderMarkdown('```\nnever closed');
    assert.match(html, /<pre><code>/);
    assert.match(html, /never closed/);
  });

  test('CRLF input is handled', () => {
    assert.match(renderMarkdown('# Title\r\n\r\nBody.'), /<h1>Title<\/h1>/);
  });
});
