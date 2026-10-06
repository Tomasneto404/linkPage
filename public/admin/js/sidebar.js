// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Admin panel: the sidebar of groups. */

// ─── 8. SIDEBAR ───────────────────────────────────────────────────────────────

let draggedGroupId        = null;
let draggedSectionId      = null;
let draggedSectionGroupId = null;

function linkBelongsToGroup(link, groupId) {
  return Array.isArray(link.group_ids)
    ? link.group_ids.includes(groupId)
    : link.group_id === groupId;
}

function linkIsUngrouped(link) {
  return Array.isArray(link.group_ids)
    ? link.group_ids.length === 0
    : !link.group_id;
}

/** Returns the section_id this link has within `groupId`, or null. */
function linkSectionInGroup(link, groupId) {
  const m = (link.groups || []).find(g => g.id === groupId);
  return m ? (m.section_id ?? null) : null;
}

/** SVG glyphs reused across sidebar rows. */
const SIDEBAR_ICONS = {
  drag:   `<svg class="group-drag-handle" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>`,
  lock:   `<svg class="group-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Protected"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  plus:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  chevron:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  edit:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
};

function renderSidebar() {
  document.getElementById('countAll').textContent       = links.length;
  document.getElementById('countUngrouped').textContent = links.filter(linkIsUngrouped).length;

  // Top-level All/Ungrouped buttons highlight only when no section is in play.
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.classList.toggle('active',
      activeSection === null && btn.dataset.group === String(activeGroup)));

  const nav = document.getElementById('groupsNav');
  nav.innerHTML = groups.map(g => {
    const totalCount = links.filter(l => linkBelongsToGroup(l, g.id)).length;
    const isGroupActive = activeGroup === g.id && activeSection === null;
    const cStyle = isGroupActive ? `background:${g.color}18; color:${g.color}` : '';

    // Build the section + subsection tree under this group. Subsections share
    // the same markup but get a `subsection` class for the indent + smaller
    // type. Top-level sections additionally render their `+` "subsection"
    // button.
    const renderSubsectionRow = (sub) => {
      const subCount = links.filter(l =>
        linkBelongsToGroup(l, g.id) && linkSectionInGroup(l, g.id) === sub.id).length;
      const subActive = activeGroup === g.id && activeSection === sub.id;
      const subCountStyle = subActive ? `background:${g.color}18; color:${g.color}` : '';

      if (editingSectionId === sub.id) {
        return `
          <div class="section-nav-item subsection editing"
               data-section-id="${sub.id}" data-group-id="${g.id}">
            <span class="section-tick"></span>
            <input class="section-inline-input" data-mode="rename" data-section-id="${sub.id}"
                   value="${escapeHtml(sub.name)}" autocomplete="off" />
          </div>`;
      }
      return `
        <div class="section-nav-item subsection${subActive ? ' active' : ''}"
             data-section-id="${sub.id}" data-group-id="${g.id}" draggable="true">
          <span class="section-drag-handle" title="Drag to reorder">${SIDEBAR_ICONS.drag}</span>
          <span class="section-tick"></span>
          <span class="section-name">${escapeHtml(sub.name)}</span>
          <span class="nav-count" style="${subCountStyle}">${subCount}</span>
          <div class="group-item-actions">
            <button class="group-action-btn edit-section-btn"
                    data-section-id="${sub.id}" title="Rename">${SIDEBAR_ICONS.edit}</button>
            <button class="group-action-btn danger delete-section-btn"
                    data-section-id="${sub.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
          </div>
        </div>`;
    };

    const sectionRowsHtml = (g.sections || []).map(s => {
      const sCount = links.filter(l =>
        linkBelongsToGroup(l, g.id) && linkSectionInGroup(l, g.id) === s.id).length;
      const sActive = activeGroup === g.id && activeSection === s.id;
      const sCountStyle = sActive ? `background:${g.color}18; color:${g.color}` : '';

      // Rename mode: an input replaces the section name inline.
      const headHtml = editingSectionId === s.id ? `
        <div class="section-nav-item editing" data-section-id="${s.id}" data-group-id="${g.id}">
          <span class="section-tick"></span>
          <input class="section-inline-input" data-mode="rename" data-section-id="${s.id}"
                 value="${escapeHtml(s.name)}" autocomplete="off" />
        </div>` : `
        <div class="section-nav-item${sActive ? ' active' : ''}"
             data-section-id="${s.id}" data-group-id="${g.id}" draggable="true">
          <span class="section-drag-handle" title="Drag to reorder">${SIDEBAR_ICONS.drag}</span>
          <span class="section-tick"></span>
          <span class="section-name">${escapeHtml(s.name)}</span>
          <span class="nav-count" style="${sCountStyle}">${sCount}</span>
          <div class="group-item-actions">
            <button class="group-action-btn add-subsection-btn"
                    data-section-id="${s.id}" data-group-id="${g.id}"
                    title="Add subsection">${SIDEBAR_ICONS.plus}</button>
            <button class="group-action-btn edit-section-btn"
                    data-section-id="${s.id}" title="Rename">${SIDEBAR_ICONS.edit}</button>
            <button class="group-action-btn danger delete-section-btn"
                    data-section-id="${s.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
          </div>
        </div>`;

      const childrenHtml = (s.subsections || []).map(renderSubsectionRow).join('');

      const addSubRowHtml = addingSubsectionToParent === s.id ? `
        <div class="section-nav-item subsection editing"
             data-group-id="${g.id}" data-parent-section-id="${s.id}">
          <span class="section-tick"></span>
          <input class="section-inline-input" data-mode="create"
                 data-group-id="${g.id}" data-parent-section-id="${s.id}"
                 placeholder="Subsection name…" autocomplete="off" />
        </div>` : '';

      return headHtml + childrenHtml + addSubRowHtml;
    }).join('');

    const addRowHtml = addingSectionToGroupId === g.id ? `
      <div class="section-nav-item editing" data-group-id="${g.id}">
        <span class="section-tick"></span>
        <input class="section-inline-input" data-mode="create" data-group-id="${g.id}"
               placeholder="Section name…" autocomplete="off" />
      </div>` : '';

    const hasSections = (g.sections || []).length > 0;
    const isCollapsed = collapsedGroups.has(g.id);
    // Chevron only when there's a tree to collapse; keeps a consistent left
    // gutter otherwise via the placeholder.
    const chevronHtml = hasSections
      ? `<button class="group-collapse-btn${isCollapsed ? ' collapsed' : ''}" data-group-id="${g.id}"
                 title="${isCollapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!isCollapsed}">${SIDEBAR_ICONS.chevron}</button>`
      : `<span class="group-collapse-spacer"></span>`;

    return `
      <div class="group-nav-item${isGroupActive ? ' active' : ''}" data-group-id="${g.id}" draggable="true">
        ${chevronHtml}
        ${SIDEBAR_ICONS.drag}
        <span class="group-dot" style="background:${escapeHtml(g.color)}"></span>
        <span>${escapeHtml(g.name)}${g.is_protected ? SIDEBAR_ICONS.lock : ''}</span>
        <span class="nav-count" style="${cStyle}">${totalCount}</span>
        <div class="group-item-actions">
          <button class="group-action-btn add-section-btn" data-group-id="${g.id}" title="Add section">${SIDEBAR_ICONS.plus}</button>
          <button class="group-action-btn edit-group-btn"  data-group-id="${g.id}" title="Edit">${SIDEBAR_ICONS.edit}</button>
          <button class="group-action-btn danger delete-group-btn" data-group-id="${g.id}" title="Delete">${SIDEBAR_ICONS.trash}</button>
        </div>
      </div>
      <div class="group-sections${isCollapsed ? ' collapsed' : ''}" data-group-id="${g.id}">
        <div class="group-sections-inner">
          ${sectionRowsHtml}
          ${addRowHtml}
        </div>
      </div>`;
  }).join('');

  // ─── Click handlers ───────────────────────────────────────────────────────
  nav.querySelectorAll('.group-nav-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.group-item-actions')) return;
      if (e.target.closest('.group-collapse-btn')) return;
      activeGroup   = Number(item.dataset.groupId);
      activeSection = null;
      renderSidebar(); renderLinks(true);
    });
  });
  // Collapse/expand a group's section tree. Toggle classes on the live nodes
  // (rather than re-rendering) so the height/chevron transitions animate.
  nav.querySelectorAll('.group-collapse-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = Number(btn.dataset.groupId);
      const collapsed = !collapsedGroups.has(id);
      if (collapsed) collapsedGroups.add(id);
      else           collapsedGroups.delete(id);
      saveCollapsedGroups();
      btn.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.title = collapsed ? 'Expand' : 'Collapse';
      const sec = nav.querySelector(`.group-sections[data-group-id="${id}"]`);
      if (sec) sec.classList.toggle('collapsed', collapsed);
    }));
  nav.querySelectorAll('.edit-group-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openEditGroupModal(Number(btn.dataset.groupId)); }));
  nav.querySelectorAll('.delete-group-btn').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openDeleteGroupModal(Number(btn.dataset.groupId)); }));
  nav.querySelectorAll('.add-section-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addingSectionToGroupId   = Number(btn.dataset.groupId);
      addingSubsectionToParent = null;
      editingSectionId         = null;
      collapsedGroups.delete(addingSectionToGroupId);  // reveal the tree to add into
      saveCollapsedGroups();
      renderSidebar();
      const input = nav.querySelector(
        '.section-inline-input[data-mode="create"]:not([data-parent-section-id])'
      );
      if (input) input.focus();
    }));
  nav.querySelectorAll('.add-subsection-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      addingSubsectionToParent = Number(btn.dataset.sectionId);
      addingSectionToGroupId   = null;
      editingSectionId         = null;
      renderSidebar();
      const input = nav.querySelector(
        `.section-inline-input[data-mode="create"][data-parent-section-id="${addingSubsectionToParent}"]`
      );
      if (input) input.focus();
    }));

  // Section row: click filters; edit/delete on hover
  nav.querySelectorAll('.section-nav-item:not(.editing)').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.group-item-actions')) return;
      activeGroup   = Number(item.dataset.groupId);
      activeSection = Number(item.dataset.sectionId);
      renderSidebar(); renderLinks(true);
    });
  });
  nav.querySelectorAll('.edit-section-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      editingSectionId       = Number(btn.dataset.sectionId);
      addingSectionToGroupId = null;
      renderSidebar();
      const input = nav.querySelector('.section-inline-input[data-mode="rename"]');
      if (input) { input.focus(); input.select(); }
    }));
  nav.querySelectorAll('.delete-section-btn').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const sid = Number(btn.dataset.sectionId);
      const ok = await showConfirm({
        title:       'Delete Section',
        message:     'Delete this section? Links in it become unsectioned (they keep their group membership).',
        confirmText: 'Delete',
      });
      if (!ok) return;
      await deleteSectionApi(sid);
      if (activeSection === sid) activeSection = null;
      showToast('Section deleted');
      await loadAllData();
    }));

  // Inline input handling (create + rename). The closure-level `settled` flag
  // prevents Enter→blur from firing the save twice (which created duplicate
  // sections — pressing Enter triggers a re-render that removes the input,
  // which in turn fires its own blur event).
  nav.querySelectorAll('.section-inline-input').forEach(input => {
    let settled = false;
    const finish = async commit => {
      if (settled) return;
      settled = true;

      const resetState = () => {
        addingSectionToGroupId   = null;
        addingSubsectionToParent = null;
        editingSectionId         = null;
      };

      if (!commit) {
        resetState();
        renderSidebar();
        return;
      }
      const name = input.value.trim();
      if (!name) {
        resetState();
        renderSidebar();
        return;
      }
      try {
        if (input.dataset.mode === 'create') {
          const groupId         = Number(input.dataset.groupId);
          const parentSectionId = input.dataset.parentSectionId
            ? Number(input.dataset.parentSectionId) : null;
          await createSectionApi(groupId, name, parentSectionId);
          showToast(parentSectionId ? 'Subsection created' : 'Section created');
        } else {
          await updateSectionApi(Number(input.dataset.sectionId), name);
          showToast('Section renamed');
        }
      } catch { showToast('Could not save section', 'error'); }
      resetState();
      await loadAllData();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  });

  // ─── Group drag-to-reorder (unchanged) ─────────────────────────────────────
  nav.querySelectorAll('.group-nav-item').forEach(item => {
    const gid = Number(item.dataset.groupId);
    item.addEventListener('dragstart', e => { draggedGroupId = gid; item.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragend',   () => { item.style.opacity = ''; nav.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); draggedGroupId = null; });
    item.addEventListener('dragover',  e => { e.preventDefault(); if (draggedGroupId !== gid) item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('drag-over');
      if (!draggedGroupId || draggedGroupId === gid) return;
      const fi = groups.findIndex(g => g.id === draggedGroupId);
      const ti = groups.findIndex(g => g.id === gid);
      const [m] = groups.splice(fi, 1); groups.splice(ti, 0, m);
      renderSidebar(); reorderGroupsApi(groups.map(g => g.id));
    });
  });

  // ─── Section drag-to-reorder (within a single group only) ─────────────────
  // ─── Section/subsection drag-to-reorder ────────────────────────────────
  // Reordering is scoped to siblings: top-level sections can only swap among
  // other top-level sections in the same group, and subsections can only
  // swap among other subsections of the same parent.
  const findSectionParentId = (gid, sectionId) => {
    const group = groups.find(g => g.id === gid);
    if (!group) return undefined;
    for (const s of group.sections || []) {
      if (s.id === sectionId) return null;
      if ((s.subsections || []).some(sub => sub.id === sectionId)) return s.id;
    }
    return undefined;
  };

  nav.querySelectorAll('.section-nav-item:not(.editing)').forEach(item => {
    const sid = Number(item.dataset.sectionId);
    const gid = Number(item.dataset.groupId);
    const isSub = item.classList.contains('subsection');
    item.addEventListener('dragstart', e => {
      // Don't let a section drag bubble up and trigger a group drag.
      e.stopPropagation();
      draggedSectionId      = sid;
      draggedSectionGroupId = gid;
      item.style.opacity    = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '';
      nav.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedSectionId      = null;
      draggedSectionGroupId = null;
    });
    const compatibleSibling = () => {
      if (!draggedSectionId || draggedSectionGroupId !== gid) return false;
      if (draggedSectionId === sid) return false;
      const draggedIsSub = !!nav.querySelector(
        `.section-nav-item.subsection[data-section-id="${draggedSectionId}"]`
      );
      if (draggedIsSub !== isSub) return false;
      // Subsections additionally need the same parent.
      if (isSub) {
        return findSectionParentId(gid, draggedSectionId) === findSectionParentId(gid, sid);
      }
      return true;
    };
    item.addEventListener('dragover', e => {
      if (!compatibleSibling()) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      item.classList.remove('drag-over');
      if (!compatibleSibling()) return;
      e.preventDefault();
      e.stopPropagation();

      const group = groups.find(g => g.id === gid);
      if (!group || !Array.isArray(group.sections)) return;

      if (isSub) {
        const parentId = findSectionParentId(gid, sid);
        const parent   = group.sections.find(s => s.id === parentId);
        if (!parent || !Array.isArray(parent.subsections)) return;
        const fi = parent.subsections.findIndex(s => s.id === draggedSectionId);
        const ti = parent.subsections.findIndex(s => s.id === sid);
        if (fi === -1 || ti === -1) return;
        const [moved] = parent.subsections.splice(fi, 1);
        parent.subsections.splice(ti, 0, moved);
        renderSidebar();
        reorderSectionsApi(parent.subsections.map(s => s.id));
      } else {
        const fi = group.sections.findIndex(s => s.id === draggedSectionId);
        const ti = group.sections.findIndex(s => s.id === sid);
        if (fi === -1 || ti === -1) return;
        const [moved] = group.sections.splice(fi, 1);
        group.sections.splice(ti, 0, moved);
        renderSidebar();
        reorderSectionsApi(group.sections.map(s => s.id));
      }
    });
  });

  // ─── Drop a link card onto a group/section/subsection in the sidebar ─────
  // The drag is started from the card (enableLinkDrag sets draggedLinkId);
  // here we just register every sidebar row as a valid drop target. Group
  // rows move the link into that group with no section; section/subsection
  // rows move it into that exact leaf. Memberships in other groups are kept.
  nav.querySelectorAll('.group-nav-item, .section-nav-item:not(.editing)').forEach(item => {
    item.addEventListener('dragover', e => {
      if (draggedLinkId == null) return;        // not a link drag
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over-link');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over-link'));
    item.addEventListener('drop', async e => {
      if (draggedLinkId == null) return;
      e.preventDefault();
      e.stopPropagation();
      item.classList.remove('drag-over-link');

      const linkId    = draggedLinkId;
      const groupId   = Number(item.dataset.groupId);
      const sectionId = item.dataset.sectionId ? Number(item.dataset.sectionId) : null;
      if (!Number.isFinite(groupId) || groupId <= 0) return;
      draggedLinkId = null;                       // prevent a follow-up reorder drop
      await moveLinkIntoSection(linkId, groupId, sectionId);
    });
  });
}

