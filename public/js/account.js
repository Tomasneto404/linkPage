// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public page: the account control in the header, group colours, and the composer for your own links. */

// ─── Your account, in the header ──────────────────────────────────────────────
//
// Signed out: the Admin button stays exactly where it was — it is the way in
// for whoever runs the instance — with Sign in beside it. Signed in: an initial
// in a circle, which opens a short menu.

/**
 * One letter per name, two at most: "Sam Lee" is SL, "Administrator" is A.
 * Two letters of a single word read as the initials of two people.
 */
function initialsOf(user) {
  const name = (user.display_name || '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  // No name: the address, before the @.
  return ((user.email || '?')[0]).toUpperCase();
}

function renderAccountControl() {
  const slot = document.getElementById('accountSlot');
  if (!slot) return;
  document.getElementById('accountBanner')
    ?.classList.toggle('hidden', !currentUser?.must_change_password);
  const next = encodeURIComponent(location.pathname + location.search);

  if (!currentUser) {
    // One way in for everybody. The sign-in page works out who is an
    // administrator and sends them to the panel; everyone else comes back
    // here. From the front page no `next` is sent, so that choice is made by
    // role; from anywhere else, it is where they were.
    const here = location.pathname + location.search;
    const href = here === '/' ? '/login/' : `/login/?next=${next}`;
    slot.innerHTML = `
      <a href="${href}" class="admin-btn account-signin">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        <span class="admin-btn-label">Sign in</span>
      </a>`;
    return;
  }

  const isAdmin = currentUser.role === 'admin';
  slot.innerHTML = `
    <button type="button" class="account-btn" id="accountBtn"
            aria-haspopup="menu" aria-expanded="false"
            title="${escapeHtml(currentUser.email)}">${escapeHtml(initialsOf(currentUser))}</button>
    <div class="account-menu hidden" id="accountMenu" role="menu">
      <div class="account-menu-head">
        <span class="account-menu-name">${escapeHtml(currentUser.display_name || currentUser.email)}</span>
        ${currentUser.display_name ? `<span class="account-menu-email">${escapeHtml(currentUser.email)}</span>` : ''}
      </div>
      <button type="button" class="account-menu-item" role="menuitem" data-act="add-link">Add a link</button>
      <button type="button" class="account-menu-item" role="menuitem" data-act="groups">Your groups</button>
      <button type="button" class="account-menu-item" role="menuitem" data-act="account">Your account</button>
      ${isAdmin ? '<a class="account-menu-item" role="menuitem" href="/admin">Admin panel</a>' : ''}
      <div class="account-menu-divider" role="separator"></div>
      <button type="button" class="account-menu-item account-menu-danger" role="menuitem" data-act="sign-out">Sign out</button>
    </div>`;
}

function setAccountMenu(open) {
  const menu = document.getElementById('accountMenu');
  const btn  = document.getElementById('accountBtn');
  if (!menu || !btn) return;
  menu.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('.account-menu-item')?.focus();
}

document.addEventListener('click', async e => {
  if (e.target.closest('#accountBtn')) {
    const open = document.getElementById('accountMenu')?.classList.contains('hidden');
    setAccountMenu(!!open);
    return;
  }

  const item = e.target.closest('#accountMenu [data-act]');
  if (item) {
    setAccountMenu(false);
    if (item.dataset.act === 'add-link') openComposer(null);
    if (item.dataset.act === 'groups')   openGroupsManager();
    if (item.dataset.act === 'account')  openAccount();
    if (item.dataset.act === 'sign-out') await signOut();
    return;
  }

  // Anywhere else closes it. Not a .modal-overlay, so the overlay's own
  // backdrop and Escape handling do not reach it.
  if (!e.target.closest('#accountMenu')) setAccountMenu(false);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('accountMenu')?.classList.contains('hidden')) {
    setAccountMenu(false);
    document.getElementById('accountBtn')?.focus();
  }
});

async function signOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* leaving anyway */ }
  // A full reload: the surest way to have nothing of theirs left in memory.
  location.reload();
}

// ─── Group colours ────────────────────────────────────────────────────────────
//
// The same ten the admin panel offers for shared groups, so a member's tabs sit
// in the same family as everyone else's, plus one swatch for any colour at all.

const GROUP_COLORS = [
  ['#0071e3', 'Blue'],   ['#5856d6', 'Indigo'], ['#af52de', 'Purple'], ['#ff2d55', 'Pink'],
  ['#ff3b30', 'Red'],    ['#ff9500', 'Orange'], ['#34c759', 'Green'],  ['#00c7be', 'Teal'],
  ['#007aff', 'Sky'],    ['#8e8e93', 'Grey'],
];
const DEFAULT_GROUP_COLOR = GROUP_COLORS[0][0];

/** A row of swatches with `selected` chosen. The value lives in data-value. */
function colorPaletteHtml(selected = DEFAULT_GROUP_COLOR) {
  const pick = String(selected || DEFAULT_GROUP_COLOR).toLowerCase();
  const isPreset = GROUP_COLORS.some(([c]) => c === pick);
  const swatches = GROUP_COLORS.map(([color, name]) => `
    <button type="button" class="color-swatch${color === pick ? ' selected' : ''}"
            data-color="${color}" style="background:${color}"
            aria-label="${name}" aria-pressed="${color === pick}"></button>`).join('');
  return `
    <div class="color-palette" data-value="${escapeHtml(pick)}">
      ${swatches}
      <label class="color-swatch color-swatch-custom${isPreset ? '' : ' selected'}"
             style="background:${isPreset ? 'conic-gradient(#ff3b30, #ff9500, #34c759, #00c7be, #0071e3, #af52de, #ff3b30)' : escapeHtml(pick)}"
             title="Any colour">
        <input type="color" value="${isPreset ? '#888888' : escapeHtml(pick)}" aria-label="Choose any colour" />
        <span class="color-swatch-plus" aria-hidden="true">+</span>
      </label>
    </div>`;
}

/** Marks `color` chosen in a palette, and returns it. */
function setPaletteValue(palette, color) {
  const value = color.toLowerCase();
  palette.dataset.value = value;
  const isPreset = GROUP_COLORS.some(([c]) => c === value);
  for (const sw of palette.querySelectorAll('.color-swatch[data-color]')) {
    const on = sw.dataset.color === value;
    sw.classList.toggle('selected', on);
    sw.setAttribute('aria-pressed', String(on));
  }
  const custom = palette.querySelector('.color-swatch-custom');
  custom.classList.toggle('selected', !isPreset);
  if (!isPreset) custom.style.background = value;
  return value;
}

/**
 * One listener for every palette on the page. A palette announces a change
 * with a `palettechange` event, so whoever owns it decides what picking means
 * — saving straight away in Your groups, remembering it in the composer.
 */
function onPalettePick(e) {
  const palette = e.target.closest('.color-palette');
  if (!palette) return;
  let color = null;
  if (e.type === 'click') {
    const sw = e.target.closest('.color-swatch[data-color]');
    if (sw) color = sw.dataset.color;
  } else if (e.target.matches('input[type="color"]')) {
    color = e.target.value;
  }
  if (!color) return;
  setPaletteValue(palette, color);
  palette.dispatchEvent(new CustomEvent('palettechange', { bubbles: true, detail: { color } }));
}
document.addEventListener('click', onPalettePick);
// "change", not "input": the browser's picker fires input on every drag, and a
// save per pixel of dragging is not a save anyone meant.
document.addEventListener('change', onPalettePick);

// ─── The composer: adding and editing your own links ──────────────────────────

let composerLink = null;      // the link being edited, or null when adding
let composerFile = null;      // a picked attachment
let composerIcon = null;      // a picked icon image
let composerMode = 'url';     // 'url' | 'file'
let composerConfirmingDelete = false;

// The icon a typed address would get, looked up by this server before saving.
let composerPreview = { url: '', state: 'idle', objectUrl: null };
let composerPreviewTimer = null;

const el = id => document.getElementById(id);

function personalGroups() { return groups.filter(isPersonal); }

/**
 * Where a link can go: your own groups, and the shared groups you are a group
 * admin of (value "s<id>"). A shared link being edited stays shared — it can
 * move between the groups you look after, not into your own page.
 */
function fillComposerGroups(selectedKey = null, { sharedOnly = false } = {}) {
  const sel = el('myLinkGroup');
  const own = personalGroups()
    .map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  const shared = managedGroups()
    .map(g => `<option value="s${g.id}">${escapeHtml(g.name)}</option>`).join('');
  const sharedBlock = shared ? `<optgroup label="Groups you look after">${shared}</optgroup>` : '';

  sel.innerHTML = sharedOnly
    ? sharedBlock
    : `<option value="">Not in a group</option>${own}${sharedBlock}<option value="__new">New group…</option>`;
  const exists = [...sel.options].some(o => o.value === selectedKey);
  sel.value = exists ? selectedKey : (sharedOnly ? sel.options[0]?.value || '' : '');
  fillComposerSections();
}

/** The group the composer's select points at, own or shared. */
function composerGroup() {
  const v = el('myLinkGroup').value;
  if (v.startsWith('s')) return managedGroups().find(g => g.id === Number(v.slice(1))) || null;
  return personalGroups().find(g => g.id === v) || null;
}

const composerTargetsShared = () => el('myLinkGroup').value.startsWith('s');

function fillComposerSections(selectedId = null) {
  // A shared group's links count against nobody's allowance.
  el('myLinkStorage').classList.toggle('hidden', composerTargetsShared());
  const group = composerGroup();
  const row = el('myLinkSectionRow');
  const sections = group ? group.sections.flatMap(s => [
    { id: s.id, name: s.name },
    ...(s.subsections || []).map(sub => ({ id: sub.id, name: `${s.name} › ${sub.name}` })),
  ]) : [];

  row.classList.toggle('hidden', sections.length === 0);
  el('myLinkSection').innerHTML = `<option value="">No section</option>` +
    sections.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (selectedId) el('myLinkSection').value = String(selectedId);
}

function setComposerMode(mode) {
  composerMode = mode;
  el('myLinkUrlRow').classList.toggle('hidden', mode !== 'url');
  el('myLinkFileRow').classList.toggle('hidden', mode !== 'file');
  for (const btn of document.querySelectorAll('[data-compose-mode]')) {
    btn.classList.toggle('active', btn.dataset.composeMode === mode);
    btn.setAttribute('aria-pressed', String(btn.dataset.composeMode === mode));
  }
  el('myLinkUrl').required = mode === 'url';
  refreshComposerIcon();
}

function formatBytesShort(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function refreshComposerStorage() {
  const line = el('myLinkStorage');
  if (!personalStorage) { line.textContent = ''; return; }
  const { used, quota } = personalStorage;
  line.textContent = `${formatBytesShort(used)} of ${formatBytesShort(quota)} used`;
  line.classList.toggle('is-near', quota > 0 && used / quota > 0.9);
}

function refreshComposerFileLabel() {
  const existing = composerLink?.file_name && !composerFile ? composerLink.file_name : null;
  el('myLinkFileName').textContent = composerFile
    ? `${composerFile.name} · ${formatBytesShort(composerFile.size)}`
    : existing || 'No file chosen';
}

/**
 * Shows the icon this link will actually have, and says where it comes from —
 * the same order the card itself uses: an image you chose, then the file's
 * type, then the website's own icon, then a plain one.
 */
function refreshComposerIcon() {
  const preview = el('myLinkIconPreview');
  const caption = el('myLinkIconSource');
  const removed = el('myLinkIconRemoved').checked;
  const show = (html, text) => { preview.innerHTML = html; caption.textContent = text; };
  const img  = src => `<img src="${escapeHtml(src)}" alt="" />`;

  el('myLinkClearIcon').classList.toggle('hidden',
    !composerIcon && !(composerLink?.image_path && !removed));

  if (composerIcon) {
    if (composerIcon._previewUrl) URL.revokeObjectURL(composerIcon._previewUrl);
    composerIcon._previewUrl = URL.createObjectURL(composerIcon);
    return show(img(composerIcon._previewUrl), 'Your image');
  }
  if (composerLink?.image_path && !removed) return show(img(composerLink.image_path), 'Your image');

  if (composerMode === 'file') {
    const name = composerFile?.name || composerLink?.file_name;
    return name
      ? show(fileTypeIconHtml(name), 'From the file')
      : show(FALLBACK_ICON_SVG, 'Choose a file, and its type sets the icon');
  }

  const url = el('myLinkUrl').value.trim();
  // An existing link whose address has not changed already has its icon.
  if (composerLink?.favicon_path && url === composerLink.url) {
    return show(img(composerLink.favicon_path), 'From the website');
  }
  if (!url) return show(FALLBACK_ICON_SVG, "The website's own icon will be used");

  if (composerPreview.url === url) {
    if (composerPreview.state === 'found')   return show(img(composerPreview.objectUrl), 'From the website');
    if (composerPreview.state === 'loading') return show(FALLBACK_ICON_SVG, "Looking for the website's icon…");
    if (composerPreview.state === 'none')    return show(FALLBACK_ICON_SVG, 'That website has no icon — a plain one will be used');
  }
  show(FALLBACK_ICON_SVG, "The website's own icon will be used");
}

function resetComposerPreview() {
  clearTimeout(composerPreviewTimer);
  if (composerPreview.objectUrl) URL.revokeObjectURL(composerPreview.objectUrl);
  composerPreview = { url: '', state: 'idle', objectUrl: null };
}

/**
 * Asks this server for the icon a typed address would get. Debounced, so it
 * runs once typing pauses rather than once per key, and a late answer for an
 * address that has since changed is thrown away.
 */
function scheduleComposerPreview() {
  clearTimeout(composerPreviewTimer);
  const url = el('myLinkUrl').value.trim();
  const isAddress = /^https?:\/\/[^\s/]+\.[^\s]+/i.test(url);
  const hasOwn = composerIcon || (composerLink?.image_path && !el('myLinkIconRemoved').checked);
  if (!isAddress || hasOwn || (composerLink?.favicon_path && url === composerLink.url)) {
    refreshComposerIcon();
    return;
  }

  composerPreviewTimer = setTimeout(async () => {
    if (composerPreview.objectUrl) URL.revokeObjectURL(composerPreview.objectUrl);
    composerPreview = { url, state: 'loading', objectUrl: null };
    refreshComposerIcon();

    let state = 'none', objectUrl = null;
    try {
      const r = await fetch(`/api/my/favicon-preview?url=${encodeURIComponent(url)}`,
                            { credentials: 'same-origin' });
      if (r.ok) { objectUrl = URL.createObjectURL(await r.blob()); state = 'found'; }
    } catch { /* treated as none */ }

    // Typing moved on while this was in flight: not this address's answer.
    if (el('myLinkUrl').value.trim() !== url) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return;
    }
    composerPreview = { url, state, objectUrl };
    refreshComposerIcon();
  }, 600);
}

/** Opens the composer, empty for a new link or filled in from an existing one. */
function openComposer(link) {
  composerLink = link;
  composerFile = null;
  composerIcon = null;
  composerConfirmingDelete = false;

  el('myLinkForm').reset();
  el('myLinkError').classList.add('hidden');
  el('myLinkNewGroupRow').classList.add('hidden');
  el('myLinkNewGroupColor').innerHTML = colorPaletteHtml(DEFAULT_GROUP_COLOR);
  el('myLinkIconRemoved').checked = false;
  resetComposerPreview();

  const shared = !!link && !isPersonal(link);
  el('myLinkTitle').textContent = !link ? 'Add a link' : shared ? 'Edit link' : 'Edit your link';
  el('myLinkSubmitBtn').textContent = link ? 'Save changes' : 'Add link';
  el('myLinkDeleteBtn').classList.toggle('hidden', !link);
  el('myLinkDeleteBtn').textContent = 'Delete';

  if (link) {
    el('myLinkName').value = link.name || '';
    el('myLinkUrl').value  = link.url  || '';
    el('myLinkDesc').value = link.description || '';
    setComposerMode(link.file_path ? 'file' : 'url');
    const membership = (link.groups || [])[0];
    fillComposerGroups(shared ? `s${membership?.id}` : (membership?.id || null), { sharedOnly: shared });
    fillComposerSections(membership?.section_id || null);
  } else {
    setComposerMode('url');
    // Adding while looking at one of your groups — or a shared one you look
    // after — puts it there.
    const here = typeof activeGroup === 'string' && activeGroup.startsWith('u') ? activeGroup
               : managedGroupIds.includes(activeGroup) ? `s${activeGroup}` : null;
    fillComposerGroups(here);
  }

  refreshComposerFileLabel();
  refreshComposerIcon();
  refreshComposerStorage();
  el('myLinkOverlay').classList.remove('hidden');
  el('myLinkName').focus();
}

function closeComposer() {
  el('myLinkOverlay').classList.add('hidden');
  resetComposerPreview();
  composerLink = null;
  composerFile = null;
  composerIcon = null;
}

function showComposerError(message) {
  const box = el('myLinkError');
  box.textContent = message;
  box.classList.remove('hidden');
}

el('myLinkGroup')?.addEventListener('change', () => {
  const creating = el('myLinkGroup').value === '__new';
  el('myLinkNewGroupRow').classList.toggle('hidden', !creating);
  if (creating) el('myLinkNewGroup').focus();
  fillComposerSections();
});

for (const btn of document.querySelectorAll('[data-compose-mode]')) {
  btn.addEventListener('click', () => setComposerMode(btn.dataset.composeMode));
}

el('myLinkFileInput')?.addEventListener('change', e => {
  composerFile = e.target.files?.[0] || null;
  refreshComposerFileLabel();
  refreshComposerIcon();
  // A file named for itself: fill the name in when it is still empty.
  if (composerFile && !el('myLinkName').value.trim()) {
    el('myLinkName').value = composerFile.name.replace(/\.[^.]+$/, '');
  }
});

el('myLinkUrl')?.addEventListener('input', scheduleComposerPreview);

el('myLinkIconInput')?.addEventListener('change', e => {
  composerIcon = e.target.files?.[0] || null;
  el('myLinkIconRemoved').checked = false;
  refreshComposerIcon();
});

el('myLinkClearIcon')?.addEventListener('click', () => {
  composerIcon = null;
  el('myLinkIconInput').value = '';
  el('myLinkIconRemoved').checked = true;
  scheduleComposerPreview();
});

/** Creates the group typed into "New group…", returning its personal id. */
async function createGroupFromComposer() {
  const name = el('myLinkNewGroup').value.trim();
  if (!name) { showComposerError('Give the new group a name.'); return undefined; }
  const color = el('myLinkNewGroupColor').querySelector('.color-palette')?.dataset.value;
  const res = await myRequest('/api/my/groups', { json: { name, color } });
  if (!res.ok) { showComposerError(res.body.error || 'Could not create that group.'); return undefined; }
  return res.body.id;
}

el('myLinkForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  el('myLinkError').classList.add('hidden');

  const name = el('myLinkName').value.trim();
  const url  = el('myLinkUrl').value.trim();
  if (!name) return showComposerError('Give the link a name.');
  if (composerMode === 'url' && !url) return showComposerError('Add a web address.');
  if (composerMode === 'file' && !composerFile && !composerLink?.file_path) {
    return showComposerError('Choose a file to attach.');
  }

  const btn = el('myLinkSubmitBtn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (composerTargetsShared()) return await saveSharedLink(name, url);

    // Which of your groups, as the real number the server knows it by.
    let groupId = null;
    const chosen = el('myLinkGroup').value;
    if (chosen === '__new') {
      groupId = await createGroupFromComposer();
      if (groupId === undefined) return;
    } else if (chosen) {
      groupId = personalGroups().find(g => g.id === chosen)?.personal_id ?? null;
    }
    const sectionId = el('myLinkSection').value ? Number(el('myLinkSection').value) : null;

    const form = new FormData();
    form.append('name', name);
    form.append('description', el('myLinkDesc').value.trim());
    form.append('groups', JSON.stringify(groupId ? [{ group_id: groupId, section_id: sectionId }] : []));

    if (composerMode === 'url') {
      form.append('url', url);
      if (composerLink?.file_path) form.append('remove_file', '1');
    } else if (composerFile) {
      form.append('file', composerFile);
    }
    if (composerIcon) form.append('image', composerIcon);
    else if (el('myLinkIconRemoved').checked) form.append('remove_image', '1');

    const res = composerLink
      ? await myRequest(`/api/my/links/${composerLink.personal_id}`, { method: 'PUT', form })
      : await myRequest('/api/my/links', { form });

    if (res.status === 413) {
      const left = res.body.storage ? formatBytesShort(res.body.storage.remaining) : 'not enough';
      return showComposerError(`That file is bigger than the space you have left (${left}).`);
    }
    if (!res.ok) return showComposerError(res.body.error || 'Could not save that link.');

    const wasEditing = !!composerLink;
    closeComposer();
    // Show the link where it now lives.
    if (groupId) { activeGroup = `u${groupId}`; saveStoredGroup(activeGroup); }
    await loadData({ transition: true });
    showToast(wasEditing ? 'Link saved' : 'Link added');
  } catch {
    showComposerError('Could not reach the server.');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

/**
 * Saves a link into a shared group this member looks after, through the group
 * admin routes. The administrator's own field names, since it is the
 * administrator's own link code that does the saving.
 */
async function saveSharedLink(name, url) {
  const group = composerGroup();
  const form = new FormData();
  form.append('name', name);
  form.append('description', el('myLinkDesc').value.trim());
  form.append('group_id', String(group.id));
  if (el('myLinkSection').value) form.append('section_id', el('myLinkSection').value);

  if (composerMode === 'url') {
    form.append('url', url);
    if (composerLink?.file_path) form.append('remove_file', 'true');
  } else if (composerFile) {
    form.append('file', composerFile);
  } else if (composerLink) {
    form.append('url', composerLink.url);   // keeps the file it already has
  }
  if (composerIcon) form.append('image', composerIcon);
  else if (el('myLinkIconRemoved').checked) form.append('remove_image', 'true');

  const res = composerLink
    ? await myRequest(`/api/managed/links/${composerLink.id}`, { method: 'PUT', form })
    : await myRequest('/api/managed/links', { form });
  if (!res.ok) return showComposerError(res.body.error || 'Could not save that link.');

  const wasEditing = !!composerLink;
  closeComposer();
  activeGroup = group.id;
  saveStoredGroup(activeGroup);
  await loadData({ transition: true });
  showToast(wasEditing ? 'Link saved' : `Link added to ${group.name}`);
}

// Deleting asks twice, on the button itself: a modal for one confirmation is
// heavier than the decision, and the codebase never uses confirm().
el('myLinkDeleteBtn')?.addEventListener('click', async () => {
  const btn = el('myLinkDeleteBtn');
  if (!composerConfirmingDelete) {
    composerConfirmingDelete = true;
    btn.textContent = 'Delete for good?';
    return;
  }
  const res = isPersonal(composerLink)
    ? await myRequest(`/api/my/links/${composerLink.personal_id}`, { method: 'DELETE' })
    : await myRequest(`/api/managed/links/${composerLink.id}`, { method: 'DELETE' });
  if (!res.ok) { showComposerError(res.body.error || 'Could not delete that link.'); return; }
  closeComposer();
  await loadData({ transition: true });
  showToast('Link deleted');
});

el('closeMyLinkBtn')?.addEventListener('click', closeComposer);
el('cancelMyLinkBtn')?.addEventListener('click', closeComposer);
el('myLinkOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'myLinkOverlay') closeComposer();
});
