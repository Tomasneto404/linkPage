// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** One calendar shared by the server, the appearance editor and open pages. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPageSeasons = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  const names = ['easter', 'halloween', 'christmas', 'spring', 'summer', 'autumn', 'winter'];
  function defaults() {
    return { enabled: false, timezone: 'Europe/Lisbon', rules: [
      { theme: 'christmas', enabled: true, start: '12-01', end: '12-31' },
      { theme: 'easter', enabled: true, kind: 'easter', before: 7, after: 1 },
      { theme: 'halloween', enabled: true, start: '10-24', end: '10-31' },
      { theme: 'spring', enabled: true, start: '03-01', end: '05-31' },
      { theme: 'summer', enabled: true, start: '06-01', end: '08-31' },
      { theme: 'autumn', enabled: true, start: '09-01', end: '11-30' },
      { theme: 'winter', enabled: true, start: '12-01', end: '02-29' },
    ] };
  }
  function validDay(value) {
    if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return false;
    const [month, day] = value.split('-').map(Number);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(2000, month, 0)).getUTCDate();
  }
  function validate(schedule) {
    if (!schedule || typeof schedule.enabled !== 'boolean') throw new Error('Choose whether automatic themes are enabled.');
    if (typeof schedule.timezone !== 'string' || schedule.timezone.length > 100) throw new Error('Enter a valid time zone.');
    try { new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }).format(); }
    catch { throw new Error('Enter a valid time zone, such as Europe/Lisbon.'); }
    if (!Array.isArray(schedule.rules) || schedule.rules.length !== names.length) throw new Error('Provide one calendar rule for each theme.');
    const seen = new Set();
    const rules = schedule.rules.map(rule => {
      if (!rule || !names.includes(rule.theme) || seen.has(rule.theme) || typeof rule.enabled !== 'boolean') throw new Error('Each theme must appear once in the calendar.');
      seen.add(rule.theme);
      if (rule.kind === 'easter') {
        if (rule.theme !== 'easter' || ![rule.before, rule.after].every(n => Number.isInteger(n) && n >= 0 && n <= 60)) throw new Error('Easter offsets must be between 0 and 60 days.');
        return { theme: rule.theme, enabled: rule.enabled, kind: 'easter', before: rule.before, after: rule.after };
      }
      if ((rule.kind && rule.kind !== 'fixed') || !validDay(rule.start) || !validDay(rule.end)) throw new Error('Use valid start and end dates for every theme.');
      return { theme: rule.theme, enabled: rule.enabled, start: rule.start, end: rule.end };
    });
    return { enabled: schedule.enabled, timezone: schedule.timezone, rules };
  }
  /** Gregorian Easter Sunday (Meeus/Jones/Butcher). */
  function easter(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
    return new Date(Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1));
  }
  function dateParts(now, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = type => parts.find(p => p.type === type).value;
    return { year: Number(get('year')), day: `${get('month')}-${get('day')}` };
  }
  function matches(rule, year, day) {
    if (!rule.enabled) return false;
    if (rule.kind === 'easter') {
      const offset = (Date.parse(`${year}-${day}T00:00:00Z`) - easter(year).getTime()) / 86400000;
      return offset >= -rule.before && offset <= rule.after;
    }
    // A Feb 29 end date includes the last day of February in every year.
    return rule.start <= rule.end ? day >= rule.start && day <= rule.end : day >= rule.start || day <= rule.end;
  }
  function resolve(manual, schedule, now = new Date()) {
    if (schedule?.enabled) {
      const { year, day } = dateParts(now, schedule.timezone);
      const rule = schedule.rules.find(r => matches(r, year, day));
      if (rule) return rule.theme;
    }
    return names.includes(manual) ? manual : 'none';
  }
  return { names, defaults, validate, validDay, easter, dateParts, matches, resolve };
});
