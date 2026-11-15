// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Seasonal appearance: a saved calendar and a local, reversible preview. */
const SEASON_LABELS = { none: 'Original', christmas: 'Christmas', easter: 'Easter', halloween: 'Halloween', spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
const SEASON_NOTES = { none: 'Quiet & timeless', christmas: 'Pine, berry & gold', easter: 'Lavender & mint', halloween: 'Amber & midnight', spring: 'Sage & blossom', summer: 'Coast & sunshine', autumn: 'Copper & parchment', winter: 'Ice & silver' };
let seasonDraft, seasonManual, seasonSaved, seasonEffects, seasonBackground;
const seasonForm = document.getElementById('seasonForm');
const seasonMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hydrateSeasonEditor(settings) {
  seasonDraft = structuredClone(settings.season_schedule || window.LinkPageSeasons.defaults());
  seasonManual = settings.season_manual_theme ?? settings.season_theme ?? 'none';
  seasonEffects = settings.season_effects !== false;
  seasonBackground = settings.season_background || 'minimal';
  document.getElementById('seasonEffectsToggle').checked = seasonEffects;
  seasonSaved = JSON.stringify({ name: seasonManual, schedule: seasonDraft, effects: seasonEffects, background: seasonBackground });
  document.getElementById('seasonAutoToggle').checked = seasonDraft.enabled;
  document.getElementById('seasonTimezone').value = seasonDraft.timezone;
  const today = window.LinkPageSeasons.dateParts(new Date(), seasonDraft.timezone);
  document.getElementById('seasonTestDate').value = `${today.year}-${today.day}`;
  document.getElementById('seasonTimezones').replaceChildren(...[
    ...new Set([seasonDraft.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])]),
  ].map(zone => Object.assign(document.createElement('option'), { value: zone })));
  document.getElementById('seasonGallery').innerHTML = Object.keys(SEASON_LABELS).map(name => `
    <button type="button" class="season-option" data-season-choice="${name}" aria-pressed="false">
      <span class="season-option-art season-art" data-season-preview="${name}" aria-hidden="true"><i></i><b>✓</b></span>
      <span class="season-option-name">${SEASON_LABELS[name]}</span><span class="season-option-note">${SEASON_NOTES[name]}</span>
    </button>`).join('');
  renderSeasonRules();
  updateSeasonEditor();
}

function seasonDateControl(value, part, label) {
  const [month, day] = value.split('-').map(Number);
  return `<div class="season-date-pair"><select data-date="${part}" aria-label="${label} month">${seasonMonths.map((m, i) => `<option value="${i + 1}"${i + 1 === month ? ' selected' : ''}>${m}</option>`).join('')}</select><input type="number" min="1" max="31" required value="${day}" data-day="${part}" aria-label="${label} day" /></div>`;
}
function renderSeasonRules() {
  document.getElementById('seasonRules').innerHTML = seasonDraft.rules.map((rule, i) => {
    const label = SEASON_LABELS[rule.theme];
    return `<div class="season-rule${rule.enabled ? '' : ' is-disabled'}" data-rule="${rule.theme}">
      <div class="season-rule-top"><label class="season-rule-name"><input type="checkbox" data-enabled ${rule.enabled ? 'checked' : ''} /><span class="season-rule-dot" data-season-preview="${rule.theme}"></span>${label}</label>
        <div class="season-priority"><span>${i + 1}</span><button type="button" data-move="-1" aria-label="Move ${label} earlier" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="1" aria-label="Move ${label} later" ${i === seasonDraft.rules.length - 1 ? 'disabled' : ''}>↓</button></div></div>
      <fieldset class="season-rule-fields" ${rule.enabled ? '' : 'disabled'}><legend class="sr-only">${label} dates</legend>
        ${rule.theme === 'easter' ? `<select data-kind aria-label="Easter date rule"><option value="easter"${rule.kind === 'easter' ? ' selected' : ''}>Follow Easter Sunday</option><option value="fixed"${rule.kind !== 'easter' ? ' selected' : ''}>Choose dates</option></select>` : ''}
        ${rule.kind === 'easter'
          ? `<label class="season-offset"><input type="number" data-offset="before" min="0" max="60" required value="${rule.before}" /> days before</label><span class="season-date-to">→</span><label class="season-offset"><input type="number" data-offset="after" min="0" max="60" required value="${rule.after}" /> days after</label>`
          : seasonDateControl(rule.start, 'start', `${label} start`) + '<span class="season-date-to">→</span>' + seasonDateControl(rule.end, 'end', `${label} end`)}
      </fieldset></div>`;
  }).join('');
}

function updateSeasonEditor() {
  document.getElementById('seasonCalendarFields').hidden = !seasonDraft.enabled;
  document.getElementById('seasonCalendarFields').disabled = !seasonDraft.enabled;
  document.querySelectorAll('[data-season-choice]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.seasonChoice === seasonManual)));
  let active = seasonManual;
  try { active = window.LinkPageSeasons.resolve(seasonManual, window.LinkPageSeasons.validate(seasonDraft)); } catch { /* allow incomplete edits */ }
  document.getElementById('seasonShowcase').dataset.seasonPreview = active;
  document.getElementById('seasonShowcase').dataset.seasonEffectsPreview = seasonEffects ? 'on' : 'off';
  document.getElementById('seasonShowcase').dataset.seasonBackgroundPreview = seasonBackground;
  document.querySelectorAll('.season-option-art').forEach(el => { el.dataset.seasonBackgroundPreview = seasonBackground; });
  document.querySelectorAll('[data-background]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.background === seasonBackground)));
  document.getElementById('seasonBackgroundDesc').textContent = {
    minimal: 'Soft colour and delicate seasonal illustrations.',
    static: 'An original landscape for each season, softly blended with your theme.',
    animated: 'A living landscape with a slow, gentle drift. Particle effects are controlled separately.',
  }[seasonBackground];
  document.getElementById('seasonPreviewLabel').textContent = `${SEASON_LABELS[active]} · ${seasonDraft.enabled ? 'Calendar preview for today' : 'Selected theme'}`;
  const dirty = seasonSaved !== JSON.stringify({ name: seasonManual, schedule: seasonDraft, effects: seasonEffects, background: seasonBackground });
  document.getElementById('saveSeasonBtn').disabled = !dirty;
  document.getElementById('seasonChoiceLabel').textContent = seasonDraft.enabled ? 'Your fallback theme' : 'Choose a theme';
  document.getElementById('seasonSaveStatus').textContent = dirty ? 'Preview only · Save to apply.' : `Saved · ${SEASON_LABELS[active]} is active today.`;
  testSeasonDate();
}

function testSeasonDate() {
  const value = document.getElementById('seasonTestDate').value;
  const output = document.getElementById('seasonTestResult');
  if (!value) { output.textContent = 'Choose a date'; return; }
  try {
    const schedule = window.LinkPageSeasons.validate(seasonDraft);
    const year = Number(value.slice(0, 4)), day = value.slice(5);
    const rule = schedule.rules.find(r => window.LinkPageSeasons.matches(r, year, day));
    output.textContent = `${SEASON_LABELS[rule?.theme || seasonManual]}${rule ? '' : ' · fallback'}`;
  } catch { output.textContent = 'Check your calendar dates'; }
}

document.getElementById('seasonGallery').addEventListener('click', e => {
  const choice = e.target.closest('[data-season-choice]');
  if (!choice) return;
  seasonManual = choice.dataset.seasonChoice;
  updateSeasonEditor();
});
document.getElementById('seasonBackgroundPicker').addEventListener('click', e => {
  const button = e.target.closest('[data-background]');
  if (!button) return;
  seasonBackground = button.dataset.background;
  updateSeasonEditor();
});
document.getElementById('seasonEffectsToggle').addEventListener('change', e => {
  seasonEffects = e.target.checked;
  updateSeasonEditor();
});
document.getElementById('seasonAutoToggle').addEventListener('change', e => {
  seasonDraft.enabled = e.target.checked;
  updateSeasonEditor();
});
document.getElementById('seasonTimezone').addEventListener('input', e => {
  e.target.setCustomValidity('');
  seasonDraft.timezone = e.target.value.trim();
  updateSeasonEditor();
});
document.getElementById('seasonTestDate').addEventListener('input', testSeasonDate);
document.getElementById('seasonRules').addEventListener('change', e => {
  const row = e.target.closest('[data-rule]');
  if (!row) return;
  const rule = seasonDraft.rules.find(r => r.theme === row.dataset.rule);
  if (e.target.hasAttribute('data-enabled')) {
    rule.enabled = e.target.checked;
    row.classList.toggle('is-disabled', !rule.enabled);
    row.querySelector('fieldset').disabled = !rule.enabled;
  } else if (e.target.hasAttribute('data-kind')) {
    const index = seasonDraft.rules.indexOf(rule);
    seasonDraft.rules[index] = e.target.value === 'easter'
      ? { theme: 'easter', enabled: rule.enabled, kind: 'easter', before: 7, after: 1 }
      : { theme: 'easter', enabled: rule.enabled, start: '04-01', end: '04-15' };
    renderSeasonRules();
    document.querySelector('[data-kind]').focus();
  } else if (e.target.dataset.offset) rule[e.target.dataset.offset] = Number(e.target.value);
  else {
    for (const part of ['start', 'end']) {
      const month = row.querySelector(`[data-date="${part}"]`);
      const day = row.querySelector(`[data-day="${part}"]`);
      if (!month || !day) continue;
      rule[part] = `${month.value.padStart(2, '0')}-${day.value.padStart(2, '0')}`;
      day.setCustomValidity(window.LinkPageSeasons.validDay(rule[part]) ? '' : 'Choose a valid day for this month.');
    }
  }
  updateSeasonEditor();
});
document.getElementById('seasonRules').addEventListener('click', e => {
  const button = e.target.closest('[data-move]');
  if (!button) return;
  const theme = button.closest('[data-rule]').dataset.rule;
  const index = seasonDraft.rules.findIndex(r => r.theme === theme);
  const next = index + Number(button.dataset.move);
  if (next < 0 || next >= seasonDraft.rules.length) return;
  [seasonDraft.rules[index], seasonDraft.rules[next]] = [seasonDraft.rules[next], seasonDraft.rules[index]];
  renderSeasonRules();
  updateSeasonEditor();
  const row = document.querySelector(`[data-rule="${theme}"]`);
  (row.querySelector(`[data-move="${button.dataset.move}"]:not(:disabled)`) || row.querySelector('[data-move]:not(:disabled)'))?.focus();
});
seasonForm.addEventListener('submit', async e => {
  e.preventDefault();
  const button = document.getElementById('saveSeasonBtn');
  const status = document.getElementById('seasonSaveStatus');
  try {
    const schedule = window.LinkPageSeasons.validate(seasonDraft);
    seasonForm.inert = true;
    button.textContent = 'Saving…';
    seasonForm.setAttribute('aria-busy', 'true');
    const res = await sendAuthRequest('/api/settings/season', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: seasonManual, schedule, effects: seasonEffects, background: seasonBackground }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Could not save the seasonal appearance.');
    window.LinkPageTheme.applySeasonSettings(result);
    seasonSaved = JSON.stringify({ name: seasonManual, schedule: seasonDraft, effects: seasonEffects, background: seasonBackground });
    updateSeasonEditor();
    showToast('Seasonal appearance saved');
  } catch (err) {
    status.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    seasonForm.inert = false;
    seasonForm.removeAttribute('aria-busy');
    button.textContent = 'Save changes';
  }
});
