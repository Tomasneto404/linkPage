// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * First-run content: an "Examples" group showing the three kinds of link this
 * app carries — a URL, an attached document, and a markdown file that renders
 * as a page — plus a hidden "Buy me a coffee" link.
 *
 * The examples are visible: a new install opens on a page that demonstrates
 * what it can do, and deleting the group clears it in one action. The coffee
 * link stays hidden — it shows in the admin (with the usual eye toggle) but
 * never on the public page — and sits in no group.
 *
 * Its icon goes through the same favicon service a normal link save uses; if
 * that fetch comes back empty — offline install, blocked egress — we fall back
 * to a locally generated glyph so the card is never iconless.
 *
 * Deliberately not a schema migration: a migration would also fire on existing
 * installs upgrading to that version, adding the link to databases that already
 * have real content.
 */

const fs   = require('fs');
const path = require('path');

const { UPLOADS_DIR }      = require('../config/env');
const { ICON_EXT_BY_MIME } = require('../config/constants');
const { db: rawDb }        = require('../config/db');
const db                   = require('../models');
const { fetchFaviconForUrl }  = require('./faviconService');
const { broadcastDataUpdate } = require('./sseService');

const SEED_LINK = {
  name:        'Buy me a coffee',
  url:         'https://buymeacoffee.com/tomasneto26',
  // Pinned at the site's own favicon, NOT at the link URL: a creator page
  // declares that creator's avatar as its icon, so fetching from the link would
  // put a photo of a person on the card instead of the brand's cup.
  iconUrl:     'https://buymeacoffee.com/favicon.ico',
  description: 'LinkPage is free and open source. If you like the project, please consider supporting the developer.',
};

// Orange coffee cup, in the same 24×24 line style as the stock icon set and
// drawn at 128 px so link cards stay crisp. Used when the fetch finds nothing
// (offline install, blocked egress).
const FALLBACK_ICON_COLOR = '#ff9f0a';
const FALLBACK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="${FALLBACK_ICON_COLOR}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`;

const ICON_BASENAME = 'seed-buy-me-a-coffee';

// ─── The Examples group ───────────────────────────────────────────────────────

const EXAMPLE_GROUP = { name: 'Examples', color: '#0071e3' };

const EXAMPLE_URL_LINK = {
  name:        'LinkPage on GitHub',
  url:         'https://github.com/Tomasneto404/linkPage',
  description: 'An ordinary link. Every card you add points somewhere like this.',
};

const EXAMPLE_FILE = {
  name:        'Example Report',
  fileName:    'Example Report.pdf',
  basename:    'seed-example-report.pdf',
  description: 'A file attached to a link. Visitors open it straight from the card.',
};

const EXAMPLE_DOC = {
  name:        'Welcome to LinkPage',
  fileName:    'Welcome to LinkPage.md',
  basename:    'seed-welcome.md',
  slug:        'welcome',
  description: 'A markdown file. Opening it renders the document instead of downloading it.',
};

const WELCOME_MARKDOWN = `# Welcome to LinkPage

This page is a markdown file someone uploaded. Because it ends in \`.md\`,
opening its link **renders** it rather than downloading it.

## What you can put on a card

| Kind | Looks like | Opens as |
| --- | --- | --- |
| A URL | \`https://example.com\` | the site itself |
| A file | \`report.pdf\` | the document |
| Markdown | \`notes.md\` | a page like this one |

## A few things worth trying

- Give a link a **custom URL** in its settings, and it answers at \`/f/your-name\`
- Turn on **Link Requests** so visitors can suggest links, send files, or
  propose a correction to something already here
- Switch **Markdown Documents Open In** to a popup, and this page opens over
  the grid instead of in a new tab

> Raw HTML in a markdown file is shown as text, never run — which is what makes
> it safe to accept one from a visitor.

\`\`\`bash
# Everything here is yours to delete
rm -rf ./examples   # metaphorically: just delete the Examples group
\`\`\`

---

Delete this group whenever you are ready to start for real.
`;

/**
 * A minimal single-page PDF, written by hand because a dependency for one
 * example file is not worth it. Objects are laid out in order and the xref
 * offsets measured as the file is built, which is the only fiddly part.
 */
function buildExamplePdf(lines) {
  const esc = t => t.replace(/([\\()])/g, '\\$1');

  let text = 'BT\n/F1 24 Tf\n72 760 Td\n';
  text += `(${esc(lines[0])}) Tj\n/F1 12 Tf\n`;
  for (const line of lines.slice(1)) text += `0 -22 Td\n(${esc(line)}) Tj\n`;
  text += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
       + `startxref\n${startxref}\n%%EOF\n`;

  // latin1: the content stream is bytes, not UTF-16, and every offset above was
  // measured in bytes.
  return Buffer.from(pdf, 'latin1');
}

const EXAMPLE_PDF_LINES = [
  'Example Report',
  '',
  'This PDF ships with LinkPage as an example of an attached file.',
  'Upload your own from the admin, or turn on link requests and let',
  'visitors send them in for review.',
  '',
  'Delete this example whenever you like.',
];

/**
 * Writes one of the example files into the uploads directory and returns the
 * path to store on its link, or null when the write fails.
 */
function writeExampleFile(basename, contents) {
  try {
    fs.writeFileSync(path.join(UPLOADS_DIR, basename), contents);
    return `/uploads/${basename}`;
  } catch (err) {
    console.warn(`[seed] Could not write ${basename}: ${err.message}`);
    return null;
  }
}

/**
 * Creates the Examples group and its three cards. Anything that fails to write
 * is simply left out — a missing example is not worth failing a first run over.
 */
function seedExamples() {
  const groupId = Number(db.createGroup(EXAMPLE_GROUP).lastInsertRowid);
  const inGroup = [{ group_id: groupId, section_id: null }];

  db.createLink({
    name:        EXAMPLE_URL_LINK.name,
    url:         EXAMPLE_URL_LINK.url,
    description: EXAMPLE_URL_LINK.description,
    groupIds:    inGroup,
  });

  const pdfPath = writeExampleFile(EXAMPLE_FILE.basename, buildExamplePdf(EXAMPLE_PDF_LINES));
  if (pdfPath) {
    db.createLink({
      name:        EXAMPLE_FILE.name,
      // File-backed links mirror the stored path into url, so /r/:id has a
      // uniform redirect target.
      url:         pdfPath,
      description: EXAMPLE_FILE.description,
      groupIds:    inGroup,
      filePath:    pdfPath,
      fileName:    EXAMPLE_FILE.fileName,
    });
  }

  const docPath = writeExampleFile(EXAMPLE_DOC.basename, WELCOME_MARKDOWN);
  if (docPath) {
    db.createLink({
      name:        EXAMPLE_DOC.name,
      url:         docPath,
      description: EXAMPLE_DOC.description,
      groupIds:    inGroup,
      filePath:    docPath,
      fileName:    EXAMPLE_DOC.fileName,
      slug:        EXAMPLE_DOC.slug,
    });
  }

  console.log('[seed] Created the "Examples" group: a link, a document and a markdown page');
}

/**
 * Saves `contents` as the link's custom icon: writes the file, registers it in
 * the shared icon library (which then owns its lifecycle, like every other
 * image_path), points the link at it, and nudges open pages over SSE.
 *
 * Stored as image_path rather than favicon_path on purpose — a custom icon
 * survives the admin re-saving the link, which would otherwise re-run the
 * favicon fetch against the link URL and bring the avatar back.
 */
function applySeedIcon(linkId, { contents, extension, mimeType, label }) {
  try {
    const filename   = `${ICON_BASENAME}${extension}`;
    const storedPath = `/uploads/${filename}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), contents);

    db.createIcon({
      filePath:     storedPath,
      originalName: label,
      mimeType,
      fileSize:     Buffer.byteLength(contents),
    });
    db.updateLinkImage(linkId, storedPath);
    broadcastDataUpdate();
    return true;
  } catch (err) {
    console.warn(`[seed] Could not save the example icon: ${err.message}`);
    return false;
  }
}

/**
 * Fetches the site icon through the same favicon service a normal link save
 * uses, then stores it; falls back to the built-in orange cup when the fetch
 * comes back empty. Never awaited: a slow or unreachable host must not delay
 * startup, and the SSE broadcast makes open pages pick the icon up on their own.
 */
async function attachSeedIcon(linkId) {
  let found = null;
  try {
    found = await fetchFaviconForUrl(SEED_LINK.iconUrl);
  } catch {
    // Same handling as "nothing found" — the fallback below covers it.
  }

  if (found) {
    const type = String(found.contentType || '').split(';')[0].trim().toLowerCase();
    const ok = applySeedIcon(linkId, {
      contents:  found.buffer,
      extension: ICON_EXT_BY_MIME[type] || '.png',
      mimeType:  type || 'image/png',
      label:     'Buy Me a Coffee',
    });
    if (ok) {
      console.log('[seed] Fetched the Buy Me a Coffee icon for the example link');
      return;
    }
  }

  const usedFallback = applySeedIcon(linkId, {
    contents:  FALLBACK_ICON_SVG,
    extension: '.svg',
    mimeType:  'image/svg+xml',
    label:     'Coffee cup',
  });
  if (usedFallback) {
    console.log('[seed] Icon fetch found nothing — used the built-in orange coffee cup');
  }
}

/**
 * Creates the hidden example link. Bails out if any link already exists, so
 * deleting it keeps it deleted and a re-run can never duplicate it. Callers
 * should additionally gate on a fresh database.
 */
function seedFirstRunContent() {
  if (db.getAllLinks().length > 0) return;

  let linkId;

  // The models layer owns SQL, but the insert and the hide have to land
  // together — a link left visible would show up on the public page, which is
  // exactly what this seed must not do.
  rawDb.exec('BEGIN');
  try {
    linkId = Number(db.createLink({
      name:        SEED_LINK.name,
      url:         SEED_LINK.url,
      description: SEED_LINK.description,
      groupIds:    [],
    }).lastInsertRowid);
    db.updateLinkVisibility(linkId, true);
    seedExamples();
    rawDb.exec('COMMIT');
    console.log(`[seed] Created the hidden "${SEED_LINK.name}" link (admin-only)`);
  } catch (err) {
    rawDb.exec('ROLLBACK');
    // Non-fatal: an empty install still works, it just starts with no content.
    console.error(`[seed] Could not create the example content: ${err.message}`);
    return;
  }

  attachSeedIcon(linkId);
}

module.exports = { seedFirstRunContent };
