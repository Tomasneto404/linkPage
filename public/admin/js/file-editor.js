// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: the file editor, its highlighter, find bar and markdown preview. */

// ─── 20.6. FILE EDITOR ───────────────────────────────────────────────────────
//
// In-place editor for text-flavoured file attachments (.html, .json, .txt …).
// Loads the bytes from /api/links/:id/file, lets the admin edit, saves back
// to the same path. /uploads serves no-cache so the public side sees the new
// bytes on the very next click — no rename, no cache busting needed.

const FILE_EDITOR_EXTS = new Set([
  '.htm', '.html', '.xml', '.json', '.txt', '.md', '.log', '.csv', '.svg',
]);

function fileExtension(name) {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isFileEditable(link) {
  return !!(link?.file_path && FILE_EDITOR_EXTS.has(fileExtension(link.file_name || link.file_path)));
}

let fileEditorLink     = null;     // link object being edited
let fileEditorOriginal = '';       // last-saved text — Revert restores it
let fileEditorDirty    = false;
let fileEditorLanguage = 'text';   // 'html' | 'xml' | 'json' | 'md' | 'csv' | 'text'

function languageForFile(name) {
  const ext = fileExtension(name);
  switch (ext) {
    case '.html':
    case '.htm':  return 'html';
    case '.xml':
    case '.svg':  return 'xml';
    case '.json': return 'json';
    case '.md':   return 'md';
    case '.csv':  return 'csv';
    default:      return 'text';
  }
}

// ─── Minimal syntax highlighter ───────────────────────────────────────────
//
// Walks the source once per known language, collecting non-overlapping spans
// and emitting safely-escaped HTML with <span class="tok-…"> wrappers. Good
// enough for HTML/XML/JSON/CSV/Markdown viewing inside the editor — not a
// full Prism/highlight.js drop-in.

const HIGHLIGHT_PATTERNS = {
  json: [
    { re: /"(?:[^"\\]|\\.)*"(?=\s*:)/g,         cls: 'tok-key' },
    { re: /"(?:[^"\\]|\\.)*"/g,                 cls: 'tok-str' },
    { re: /\b(?:true|false|null)\b/g,           cls: 'tok-bool' },
    { re: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, cls: 'tok-num' },
    { re: /[{}\[\],:]/g,                        cls: 'tok-punct' },
  ],
  md: [
    { re: /^#{1,6} .+$/gm,                      cls: 'tok-heading' },
    { re: /`[^`\n]+`/g,                         cls: 'tok-code' },
    { re: /\*\*([^*\n]+)\*\*/g,                 cls: 'tok-bold' },
    { re: /(?:^|\s)_([^_\n]+)_/g,               cls: 'tok-em' },
    { re: /\[[^\]\n]+\]\([^)\n]+\)/g,           cls: 'tok-link' },
    { re: /^\s*[-*+] /gm,                       cls: 'tok-bullet' },
  ],
  csv: [
    { re: /^[^,\n]+/gm,                         cls: 'tok-key' },
    { re: /,/g,                                 cls: 'tok-punct' },
  ],
  // HTML/XML need a different approach (matched tag blocks, then attributes
  // inside). Handled in highlightMarkup() below.
};

function highlightCode(code, language) {
  if (!code) return '';
  if (language === 'html' || language === 'xml') return highlightMarkup(code);
  const patterns = HIGHLIGHT_PATTERNS[language];
  if (!patterns) return escapeHtml(code);
  return applyPatterns(code, patterns);
}

function applyPatterns(code, patterns) {
  // Collect all candidate matches across every pattern.
  const matches = [];
  for (const { re, cls } of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      // Some patterns include leading whitespace/anchors (e.g. "(?:^|\s)" in
      // markdown em). Trim that off so the span only colours the meaningful
      // run.
      const ws = m[0].match(/^\s*/)[0].length;
      const start = m.index + (cls === 'tok-em' || cls === 'tok-bullet' ? ws : 0);
      matches.push({ start, end: m.index + m[0].length, cls });
      if (m[0].length === 0) re.lastIndex++;  // guard against zero-width
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Drop overlaps — keep first by source order; subsequent matches inside
  // the same span are skipped.
  let lastEnd = 0;
  const chosen = [];
  for (const m of matches) {
    if (m.start >= lastEnd) {
      chosen.push(m);
      lastEnd = m.end;
    }
  }

  let out = '';
  let pos = 0;
  for (const m of chosen) {
    if (m.start > pos) out += escapeHtml(code.slice(pos, m.start));
    out += `<span class="${m.cls}">${escapeHtml(code.slice(m.start, m.end))}</span>`;
    pos = m.end;
  }
  if (pos < code.length) out += escapeHtml(code.slice(pos));
  return out;
}

/**
 * Tag-aware HTML/XML highlighter: walks the source linearly, tagging each
 * tag, attribute name, attribute value, comment and text run separately. Plain
 * regex passes can't handle these because attribute matches need to be
 * constrained to inside-a-tag context.
 */
function highlightMarkup(code) {
  const COMMENT = /<!--[\s\S]*?-->/g;
  const TAG     = /<\/?[A-Za-z][^>]*\/?>/g;
  // Build a list of "outer" blocks first (comments + tags), then text in between.
  const blocks = [];
  let m;
  COMMENT.lastIndex = 0;
  while ((m = COMMENT.exec(code)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, kind: 'comment', raw: m[0] });
  }
  TAG.lastIndex = 0;
  while ((m = TAG.exec(code)) !== null) {
    // Skip tags that fall inside a comment we already captured.
    if (blocks.some(b => b.kind === 'comment' && m.index >= b.start && m.index < b.end)) continue;
    blocks.push({ start: m.index, end: m.index + m[0].length, kind: 'tag', raw: m[0] });
  }
  blocks.sort((a, b) => a.start - b.start);

  let out = '';
  let pos = 0;
  for (const b of blocks) {
    if (b.start > pos) out += escapeHtml(code.slice(pos, b.start));
    if (b.kind === 'comment') {
      out += `<span class="tok-comment">${escapeHtml(b.raw)}</span>`;
    } else {
      out += colourTag(b.raw);
    }
    pos = b.end;
  }
  if (pos < code.length) out += escapeHtml(code.slice(pos));
  return out;
}

function colourTag(tag) {
  // Split out the opening "<" / "</" / closing ">"/"/>" plus the tag name
  // and any attributes. We escape every literal piece before emitting.
  const head = tag.match(/^<\/?[A-Za-z][\w:-]*/);
  if (!head) return escapeHtml(tag);
  const headLen = head[0].length;
  const headPart = head[0];                            // "<tag" or "</tag"
  const tail     = tag.slice(headLen, -1);             // attrs body
  const close    = tag.endsWith('/>') ? '/>' : '>';
  const tailBody = tag.endsWith('/>') ? tail.slice(0, -1) : tail;

  let attrs = '';
  // attr-name = "value" | 'value' | bare
  const re = /([A-Za-z_:][\w:.\-]*)(\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s>]+)?|\s+/g;
  let last = 0;
  let am;
  while ((am = re.exec(tailBody)) !== null) {
    if (am[0].trim() === '') { attrs += escapeHtml(am[0]); last = re.lastIndex; continue; }
    const name  = am[1];
    const eq    = am[2] || '';
    const value = am[3] || '';
    attrs += `<span class="tok-attr">${escapeHtml(name)}</span>`;
    if (eq)    attrs += escapeHtml(eq);
    if (value) attrs += `<span class="tok-str">${escapeHtml(value)}</span>`;
    last = re.lastIndex;
  }
  if (last < tailBody.length) attrs += escapeHtml(tailBody.slice(last));

  return `<span class="tok-tag">${escapeHtml(headPart)}</span>${attrs}<span class="tok-tag">${escapeHtml(close)}</span>`;
}

// ─── Layered editor rendering ─────────────────────────────────────────────

function refreshFileEditorLayers() {
  const ta      = document.getElementById('fileEditorTextarea');
  const code    = document.getElementById('fileEditorHighlightCode');
  const gutter  = document.getElementById('fileEditorGutter');
  if (!ta || !code) return;

  const text = ta.value;
  // Trailing newline so the highlight layer ends one line deep — keeps the
  // last line visible when the user is typing at the end.
  code.innerHTML = highlightCode(text, fileEditorLanguage) + '\n';

  const lines = text.split('\n').length;
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
}

function syncFileEditorScroll() {
  const ta     = document.getElementById('fileEditorTextarea');
  const hl     = document.getElementById('fileEditorHighlight');
  const gutter = document.getElementById('fileEditorGutter');
  const ov     = document.getElementById('fileEditorSearchOverlay');
  if (!ta || !hl || !gutter) return;
  // The highlight + overlay match the textarea pixel-for-pixel by scrolling
  // their own viewports; the gutter only moves vertically.
  hl.scrollTop      = ta.scrollTop;
  hl.scrollLeft     = ta.scrollLeft;
  gutter.scrollTop  = ta.scrollTop;
  if (ov) {
    ov.scrollTop  = ta.scrollTop;
    ov.scrollLeft = ta.scrollLeft;
  }
}

// ─── Find bar (Ctrl/Cmd+F) ─────────────────────────────────────────────────

let fileEditorSearchMatches = [];     // [{ start, end }, ...]
let fileEditorSearchIndex   = -1;

function openFileEditorSearch() {
  const bar   = document.getElementById('fileEditorSearch');
  const input = document.getElementById('fileEditorSearchInput');
  const ta    = document.getElementById('fileEditorTextarea');
  bar.classList.remove('hidden');

  // Seed the input with the textarea's current selection if it's short — same
  // ergonomic that most editors use: select a word, hit Ctrl+F, find it.
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes('\n') && sel.length <= 200) input.value = sel;

  input.focus();
  input.select();
  recomputeFileEditorSearch();
}

function closeFileEditorSearch() {
  const bar = document.getElementById('fileEditorSearch');
  if (bar.classList.contains('hidden')) return;
  bar.classList.add('hidden');
  fileEditorSearchMatches = [];
  fileEditorSearchIndex   = -1;
  renderFileEditorSearchOverlay();    // wipe the marks
  document.getElementById('fileEditorTextarea').focus({ preventScroll: true });
}

function findAllMatches(haystack, needle) {
  if (!needle) return [];
  const hay = haystack.toLowerCase();
  const ndl = needle.toLowerCase();
  const out = [];
  let pos = 0;
  while ((pos = hay.indexOf(ndl, pos)) !== -1) {
    out.push({ start: pos, end: pos + ndl.length });
    pos += ndl.length || 1;     // never loop on empty needle
  }
  return out;
}

function recomputeFileEditorSearch() {
  const input  = document.getElementById('fileEditorSearchInput');
  const count  = document.getElementById('fileEditorSearchCount');
  const prev   = document.getElementById('fileEditorSearchPrev');
  const next   = document.getElementById('fileEditorSearchNext');
  const ta     = document.getElementById('fileEditorTextarea');
  const needle = input.value;

  fileEditorSearchMatches = findAllMatches(ta.value, needle);

  if (!needle) {
    count.textContent = '';
    count.classList.remove('is-empty');
    prev.disabled = true;
    next.disabled = true;
    fileEditorSearchIndex = -1;
    renderFileEditorSearchOverlay();
    return;
  }
  if (!fileEditorSearchMatches.length) {
    count.textContent = 'No results';
    count.classList.add('is-empty');
    prev.disabled = true;
    next.disabled = true;
    fileEditorSearchIndex = -1;
    renderFileEditorSearchOverlay();
    return;
  }
  count.classList.remove('is-empty');
  fileEditorSearchIndex = 0;
  prev.disabled = false;
  next.disabled = false;
  jumpToFileEditorMatch();
}

/**
 * Paints all matches onto the overlay <pre>, with the current one styled
 * distinctively. Operates on the textarea's current value so it auto-tracks
 * edits made while the find bar is open.
 */
function renderFileEditorSearchOverlay() {
  const ov = document.getElementById('fileEditorSearchOverlay');
  if (!ov) return;
  if (!fileEditorSearchMatches.length) {
    ov.innerHTML = '';
    return;
  }
  const text = document.getElementById('fileEditorTextarea').value;
  let html = '';
  let pos  = 0;
  for (let i = 0; i < fileEditorSearchMatches.length; i++) {
    const m = fileEditorSearchMatches[i];
    if (m.start > pos) html += escapeHtml(text.slice(pos, m.start));
    const cls = i === fileEditorSearchIndex ? 'search-match is-current' : 'search-match';
    html += `<mark class="${cls}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  if (pos < text.length) html += escapeHtml(text.slice(pos));
  // Trailing newline so the overlay sizes the same as the highlight pre.
  ov.innerHTML = html + '\n';
}

/**
 * Updates the overlay (current-match styling moves), sets the textarea's
 * selection so the cursor will be at the match if/when the user closes the
 * find bar, and scrolls the editor to bring the match into view — all
 * without stealing focus from the search input.
 */
function jumpToFileEditorMatch() {
  if (fileEditorSearchIndex < 0 || !fileEditorSearchMatches[fileEditorSearchIndex]) return;
  const m  = fileEditorSearchMatches[fileEditorSearchIndex];
  const ta = document.getElementById('fileEditorTextarea');

  // Selection survives focus loss (Chrome dims it but it's still set); when
  // the user closes the find bar the cursor will already be at the match.
  ta.setSelectionRange(m.start, m.end);

  // Compute the match's line number and scroll the textarea so the match
  // sits in the middle of the visible area. The mark overlay tracks via
  // syncFileEditorScroll.
  const lineHeight  = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  const linesBefore = ta.value.slice(0, m.start).split('\n').length - 1;
  const targetY     = linesBefore * lineHeight - (ta.clientHeight / 2);
  ta.scrollTop      = Math.max(0, targetY);

  renderFileEditorSearchOverlay();
  syncFileEditorScroll();

  document.getElementById('fileEditorSearchCount').textContent =
    `${fileEditorSearchIndex + 1} / ${fileEditorSearchMatches.length}`;
}

function nextFileEditorMatch() {
  if (!fileEditorSearchMatches.length) return;
  fileEditorSearchIndex = (fileEditorSearchIndex + 1) % fileEditorSearchMatches.length;
  jumpToFileEditorMatch();
}

function prevFileEditorMatch() {
  if (!fileEditorSearchMatches.length) return;
  fileEditorSearchIndex =
    (fileEditorSearchIndex - 1 + fileEditorSearchMatches.length) % fileEditorSearchMatches.length;
  jumpToFileEditorMatch();
}

document.getElementById('fileEditorSearchInput').addEventListener('input', recomputeFileEditorSearch);
document.getElementById('fileEditorSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); e.shiftKey ? prevFileEditorMatch() : nextFileEditorMatch(); }
  if (e.key === 'Escape') { e.preventDefault(); closeFileEditorSearch(); }
});
document.getElementById('fileEditorSearchPrev' ).addEventListener('click', prevFileEditorMatch);
document.getElementById('fileEditorSearchNext' ).addEventListener('click', nextFileEditorMatch);
document.getElementById('fileEditorSearchClose').addEventListener('click', closeFileEditorSearch);


function toggleFileEditorExpanded() {
  const modal = document.querySelector('#fileEditorOverlay .file-editor-modal');
  const btn   = document.getElementById('fileEditorExpandBtn');
  if (!modal) return;
  const next = !modal.classList.contains('is-expanded');
  modal.classList.toggle('is-expanded', next);
  btn.classList.toggle('is-expanded', next);
  btn.title = next ? 'Collapse editor' : 'Expand editor (Esc collapses)';
  // Re-sync once the modal finishes resizing so the highlight tracks.
  setTimeout(syncFileEditorScroll, 220);
}

// ─── Markdown preview inside the file editor ────────────────────────────────
//
// The preview renders server-side, through the very endpoint that serves
// readers, so what the admin approves here is what a visitor will see. A
// second renderer in the browser would be free to drift from it.

let fileEditorView        = 'source';   // 'source' | 'preview'
let fileEditorPreviewTimer;
let fileEditorPreviewedText = null;     // what the pane currently shows
let fileEditorPreviewSeq    = 0;        // increments per request; see below

/** True when the open file is a markdown document. */
function fileEditorIsMarkdown() {
  return fileExtension(fileEditorLink?.file_name || '') === '.md';
}

function setFileEditorView(view) {
  fileEditorView = view === 'preview' ? 'preview' : 'source';

  document.querySelectorAll('.file-editor-view-tab').forEach(tab =>
    tab.classList.toggle('active', tab.dataset.editorView === fileEditorView));
  document.getElementById('fileEditorPane')
          .classList.toggle('hidden', fileEditorView === 'preview');
  document.getElementById('fileEditorPreview')
          .classList.toggle('hidden', fileEditorView === 'source');

  if (fileEditorView === 'preview') refreshFileEditorPreview();
  else document.getElementById('fileEditorTextarea').focus({ preventScroll: true });
}

/**
 * Re-renders the preview, skipping the round trip when nothing has changed.
 *
 * Requests are numbered because two can be in flight at once — opening the
 * pane fires one, and typing straight away fires another. Without the check a
 * slow first response would land after the fast second one and paint stale
 * content over the newer render.
 */
async function refreshFileEditorPreview() {
  const host = document.getElementById('fileEditorPreview');
  const text = document.getElementById('fileEditorTextarea').value;
  if (text === fileEditorPreviewedText) return;

  const seq    = ++fileEditorPreviewSeq;
  const result = await jsonPost('/api/markdown/preview', { text }).catch(() => null);

  if (seq !== fileEditorPreviewSeq) return;      // a newer render has overtaken this one
  if (fileEditorView !== 'preview') return;      // toggled away while in flight

  if (typeof result?.html !== 'string') {
    host.innerHTML = '<p class="file-editor-preview-error">Could not render this document.</p>';
    return;
  }
  // Safe to insert: the server escapes first and emits only its own tags.
  host.innerHTML = result.html;
  fileEditorPreviewedText = text;
}

document.querySelectorAll('.file-editor-view-tab').forEach(tab =>
  tab.addEventListener('click', () => setFileEditorView(tab.dataset.editorView)));

async function openFileEditor(link) {
  if (!link?.file_path) return;
  fileEditorLink     = link;
  fileEditorOriginal = '';
  fileEditorDirty    = false;
  fileEditorLanguage = languageForFile(link.file_name);

  const overlay  = document.getElementById('fileEditorOverlay');
  const loading  = document.getElementById('fileEditorLoading');
  const pane     = document.getElementById('fileEditorPane');
  const ta       = document.getElementById('fileEditorTextarea');
  const filename = document.getElementById('fileEditorFilename');
  const badge    = document.getElementById('fileEditorBadge');
  const meta     = document.getElementById('fileEditorMeta');
  const status   = document.getElementById('fileEditorStatus');
  const saveBtn  = document.getElementById('saveFileEditorBtn');
  const revert   = document.getElementById('fileEditorRevertBtn');

  filename.textContent = link.file_name || 'file';
  badge.textContent    = fileExtension(link.file_name).replace('.', '') || 'txt';
  meta.textContent     = '—';
  status.textContent   = '';
  saveBtn.disabled     = true;
  revert.disabled      = true;
  pane.classList.add('hidden');
  ta.value             = '';
  loading.classList.remove('hidden');

  // Every open starts on the source, and the toggle only appears for markdown.
  fileEditorPreviewedText = null;
  fileEditorPreviewSeq    = 0;
  document.getElementById('fileEditorPreview').innerHTML = '';
  document.getElementById('fileEditorViewTabs')
          .classList.toggle('hidden', fileExtension(link.file_name) !== '.md');
  setFileEditorView('source');

  overlay.classList.remove('hidden');

  try {
    const data = await apiJson(`/api/links/${link.id}/file`);
    if (data?.error) {
      showFileEditorError(data.error);
      return;
    }
    fileEditorOriginal = data.content || '';
    ta.value           = fileEditorOriginal;
    meta.textContent   = `${formatBytes(data.size)} · ${badge.textContent.toUpperCase()}`;
    loading.classList.add('hidden');
    if (fileEditorView === 'source') pane.classList.remove('hidden');
    refreshFileEditorLayers();
    setTimeout(() => {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(0, 0);
      ta.scrollTop  = 0;
      ta.scrollLeft = 0;
      syncFileEditorScroll();
    }, 60);
    updateFileEditorDirtyState();
  } catch {
    showFileEditorError('Could not load the file.');
  }
}

function showFileEditorError(message) {
  const loading = document.getElementById('fileEditorLoading');
  loading.innerHTML = `<span class="file-editor-error-msg">${escapeHtml(message)}</span>`;
}

function closeFileEditor() {
  if (fileEditorDirty) {
    const ok = confirm('You have unsaved changes. Close anyway?');
    if (!ok) return;
  }
  // Drop the expanded mode so the next open starts at standard size.
  document.querySelector('#fileEditorOverlay .file-editor-modal')
          ?.classList.remove('is-expanded');
  document.getElementById('fileEditorExpandBtn')?.classList.remove('is-expanded');
  // Tidy up the find bar so the next open starts fresh.
  document.getElementById('fileEditorSearch')?.classList.add('hidden');
  document.getElementById('fileEditorSearchInput').value = '';
  document.getElementById('fileEditorSearchCount').textContent = '';
  fileEditorSearchMatches = [];
  fileEditorSearchIndex   = -1;
  document.getElementById('fileEditorOverlay').classList.add('hidden');
  fileEditorLink     = null;
  fileEditorOriginal = '';
  fileEditorDirty    = false;
}

function updateFileEditorDirtyState() {
  const ta      = document.getElementById('fileEditorTextarea');
  const status  = document.getElementById('fileEditorStatus');
  const saveBtn = document.getElementById('saveFileEditorBtn');
  const revert  = document.getElementById('fileEditorRevertBtn');
  fileEditorDirty = ta.value !== fileEditorOriginal;
  status.textContent  = fileEditorDirty ? 'Unsaved changes' : 'Saved';
  status.className    = 'file-editor-status' + (fileEditorDirty ? ' is-dirty' : '');
  saveBtn.disabled    = !fileEditorDirty;
  revert.disabled     = !fileEditorDirty;
}

async function saveFileEditor() {
  if (!fileEditorLink) return;
  const ta      = document.getElementById('fileEditorTextarea');
  const saveBtn = document.getElementById('saveFileEditorBtn');
  const status  = document.getElementById('fileEditorStatus');

  const content   = ta.value;
  saveBtn.disabled = true;
  status.textContent = 'Saving…';
  status.className   = 'file-editor-status is-saving';

  try {
    const res = await sendAuthRequest(`/api/links/${fileEditorLink.id}/file`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Save failed');
    }
    const data = await res.json();
    fileEditorOriginal = content;
    document.getElementById('fileEditorMeta').textContent =
      `${formatBytes(data.size)} · ${fileExtension(fileEditorLink.file_name).replace('.', '').toUpperCase() || 'TXT'}`;
    updateFileEditorDirtyState();
    showToast('File saved');
  } catch (err) {
    status.textContent = err.message || 'Save failed';
    status.className   = 'file-editor-status is-error';
    saveBtn.disabled   = false;
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

document.getElementById('fileEditorTextarea').addEventListener('input', () => {
  refreshFileEditorLayers();
  updateFileEditorDirtyState();
  // A live preview follows the typing, debounced so it is one request per
  // pause rather than one per keystroke.
  if (fileEditorView === 'preview') {
    clearTimeout(fileEditorPreviewTimer);
    fileEditorPreviewTimer = setTimeout(refreshFileEditorPreview, 300);
  }
  // Keep the find bar accurate if the user types while it's open.
  if (!document.getElementById('fileEditorSearch').classList.contains('hidden')) {
    recomputeFileEditorSearch();
  }
});
document.getElementById('fileEditorTextarea').addEventListener('scroll', syncFileEditorScroll);
document.getElementById('fileEditorExpandBtn').addEventListener('click', toggleFileEditorExpanded);

// Esc first collapses an expanded editor, then (on a second press) the global
// overlay-close handler can dismiss the modal. Capture phase so this runs
// before the existing global Esc.
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const expanded = document.querySelector('#fileEditorOverlay:not(.hidden) .file-editor-modal.is-expanded');
  if (expanded) {
    e.stopImmediatePropagation();
    toggleFileEditorExpanded();
  }
}, { capture: true });

// Ctrl/Cmd+F opens the editor's find bar (and suppresses the browser's page
// find, which would be useless here since the code lives inside a textarea).
// Capture phase so we run before browser handling.
window.addEventListener('keydown', e => {
  if (e.key !== 'f' && e.key !== 'F') return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const open = document.querySelector('#fileEditorOverlay:not(.hidden)');
  if (!open) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  openFileEditorSearch();
}, { capture: true });
document.getElementById('saveFileEditorBtn').addEventListener('click', saveFileEditor);
document.getElementById('fileEditorRevertBtn').addEventListener('click', () => {
  document.getElementById('fileEditorTextarea').value = fileEditorOriginal;
  refreshFileEditorLayers();
  updateFileEditorDirtyState();
});
document.getElementById('closeFileEditorBtn').addEventListener('click', closeFileEditor);
document.getElementById('cancelFileEditorBtn').addEventListener('click', closeFileEditor);

// Ctrl/Cmd + S inside the editor saves without leaving the keyboard.
document.getElementById('fileEditorTextarea').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!document.getElementById('saveFileEditorBtn').disabled) saveFileEditor();
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    // Insert a 2-space tab rather than yanking focus.
    e.preventDefault();
    const ta = e.target;
    const s = ta.selectionStart, eEnd = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(eEnd);
    ta.selectionStart = ta.selectionEnd = s + 2;
    refreshFileEditorLayers();
    updateFileEditorDirtyState();
  }
});

