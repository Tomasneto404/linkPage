// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Reproducible release screenshots. Uses a disposable instance, never live data. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const harness = require('../tests/helpers/harness');
const { launchBrowser } = require('../tests/browser/helpers/browser');
const calendar = require('../public/season-calendar');
const folder = path.join(__dirname, '../linkPagePrints');
let browser;
async function main() {
  const c = await harness.start();
  browser = await launchBrowser();
  if (!browser) throw new Error('Install Chromium or set LINKPAGE_BROWSER_PATH');
  async function api(url, method = 'GET', json) {
    const result = await c.api(url, { method, json });
    if (result.status >= 400) throw new Error(`${url}: ${result.status} ${result.text}`);
    return result.body;
  }
  for (const item of await api('/api/links')) await api(`/api/links/${item.id}`, 'DELETE');
  for (const item of await api('/api/groups')) await api(`/api/groups/${item.id}`, 'DELETE');
  const presets = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/admin/icon-presets.js'), 'utf8') + '\nICON_PRESETS');
  const groupNames = [['Team essentials', '#0071e3'], ['Knowledge base', '#8b5cf6'], ['Design studio', '#ec4899'], ['Engineering', '#10b981'], ['Operations', '#f59e0b']];
  const groups = [];
  for (const [name, color] of groupNames) groups.push(await c.makeGroup({ name, color }));
  const admin = await c.makeUser({ email: 'alex@example.test', displayName: 'Alex Morgan', password: 'release-demo-password', role: 'admin' });
  const member = await c.makeUser({ email: 'jamie@example.test', displayName: 'Jamie Parker', password: 'release-demo-password' });
  const entries = [
    ['Team calendar', 'Find your next meeting, team event or quiet focus block.', 'calendar', 0, 'team, planning'],
    ['Project roadmap', 'Our next milestones, priorities and what is coming next.', 'clipboard', 0, 'team, planning'],
    ['Team conversations', 'Stay in the loop with the people you work with.', 'message', 0, 'team, communication'],
    ['Design system', 'Components, foundations and a shared visual language.', 'layers', 2, 'design, resources'],
    ['Brand library', 'Logos, colours and assets for a consistent identity.', 'image', 2, 'design, resources'],
    ['Source code', 'Repositories, reviews and the work behind every release.', 'code', 3, 'engineering, resources'],
    ['Build status', 'A clear view of deployments and release readiness.', 'terminal', 3, 'engineering, operations'],
    ['Service health', 'Availability and the latest updates from our services.', 'server', 4, 'operations'],
    ['Help centre', 'Answers, guidance and a friendly place to ask for help.', 'headphones', 1, 'team, resources'],
    ['Shared files', 'The documents and resources we reach for every day.', 'folder', 1, 'resources'],
    ['Company directory', 'Find a teammate and discover who does what.', 'users', 0, 'team'],
  ];
  const links = [];
  for (const [name, description, glyph, groupIndex, tags] of entries) {
    const color = groupNames[groupIndex][1];
    const preset = presets.find(item => item.name === glyph) || presets[0];
    const bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="20" fill="${color}" fill-opacity=".12"/><g transform="translate(22 22) scale(1.5)" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${preset.body}</g></svg>`);
    const icon = await c.makeIcon({ name: glyph + '.svg', type: 'image/svg+xml', bytes });
    const form = new FormData();
    form.append('name', name); form.append('description', description);
    form.append('url', `https://workspace.example.invalid/${name.toLowerCase().replaceAll(' ', '-')}`);
    form.append('icon_id', String(icon.id)); form.append('groups', JSON.stringify([{ group_id: groups[groupIndex].id }]));
    const result = await c.api('/api/links', { method: 'POST', form });
    if (result.status !== 201) throw new Error('Could not seed demo link');
    links.push(result.body);
    await api(`/api/workspace/links/${result.body.id}`, 'PUT', { tags: tags.split(', ') });
  }
  const addWidget=async(kind,title,config,layout={})=>api('/api/workspace/widgets','POST',{kind,title,group_id:groups[0].id,config,layout});
  const clock=await addWidget('clock','Team time · Lisbon',{timezone:'Europe/Lisbon',mode:'analog',seconds:false,zones:[{timezone:'America/New_York',label:'New York'},{timezone:'Asia/Tokyo',label:'Tokyo'}]});
  const note=await addWidget('note','This week',{format:'markdown',text:'## Ready for the week\n\n- [x] Publish the team handbook\n- [ ] Review the next milestone\n- [ ] Share the design update\n\n[Open the roadmap](https://workspace.example.invalid/project-roadmap)'},{width:2});
  const rss=await addWidget('rss','Team updates',{url:'https://example.invalid/feed',view:'cards',limit:5});
  const weather=await addWidget('weather','Lisbon weather',{location:'Lisbon',latitude:38.72,longitude:-9.13,days:3},{width:2});
  const {db}=require('../src/config/db');
  for(let day=0;day<30;day++)for(let click=0;click<3+(day*7)%19;click++)db.prepare('INSERT INTO link_clicks(link_id,ip_address,user_agent,clicked_at) VALUES(?,?,?,?)').run(links[(day+click)%links.length].id,'192.0.2.'+(click%6+1),click%3?'Mozilla/5.0 (Macintosh) Chrome/153 Safari/537.36':'Mozilla/5.0 (iPhone) Mobile Safari/605',new Date(Date.now()-day*86400000-click*240000).toISOString().slice(0,19).replace('T',' '));
  const markdown = '# Welcome to our workspace\n\nEverything you need for a calmer, more connected working day.\n\n## Start here\n\nOur shared links bring together the tools, documents and people behind our work. Use **⌘K / Ctrl+K** to find a resource or search inside a document.\n\n## A few useful habits\n\n- Keep links clear, useful and easy to recognise.\n- Add a tag so teammates can find related resources.\n- Save the documents you reach for most often.\n\n## Working together\n\nEach group has its own space and the right level of access. Ask your group manager when you need a hand.\n\n> Make a little room for focus. Good work starts with clarity.\n\n## This season\n\nThe workspace follows the year with subtle colour, landscapes and a little atmosphere. Reduced motion is always respected.\n';
  const doc = await c.makeFileLink({ name: 'Team handbook', fileName: 'handbook.md', type: 'text/markdown', bytes: Buffer.from(markdown), groups: [groups[1].id], slug: 'team-handbook' });
  await api(`/api/workspace/links/${doc.id}`, 'PUT', { tags: ['team', 'handbook', 'resources'] });
  await api(`/api/links/${doc.id}/file`, 'PUT', { content: markdown.replace('A few useful habits', 'Everyday essentials') });
  await api(`/api/workspace/groups/${groups[0].id}`, 'PUT', { layout: 'grid', is_private: false, access: [{ user_id: member.id, role: 'editor' }, { user_id: admin.id, role: 'manager' }] });
  await api('/api/workspace/backups/schedule', 'PUT', { enabled: true, frequency: 'daily', hour: 3, retention: 7 });
  await api('/api/workspace/backups', 'POST', {});
  const schedule = calendar.defaults(); schedule.enabled = true;
  const context = await browser.newContext({ baseURL: c.baseUrl, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.route('**/api/widgets/'+rss.id+'/data',route=>route.fulfill({json:{updated_at:new Date().toISOString(),stale:false,data:{title:'Team updates',items:[{title:'The next release is ready for review',url:'https://workspace.example.invalid/releases',description:'A shared checklist for the next milestone.',date:new Date().toISOString()},{title:'New components in the design system',url:'https://workspace.example.invalid/design',description:'Buttons, forms and navigation patterns for every team.',date:new Date(Date.now()-86400000).toISOString()},{title:'Working agreements, in one place',url:'https://workspace.example.invalid/handbook',description:'A practical handbook for everyone in the workspace.',date:new Date(Date.now()-2*86400000).toISOString()}]}}}));
  await page.route('**/api/widgets/'+weather.id+'/data',route=>route.fulfill({json:{updated_at:new Date().toISOString(),stale:false,data:{location:'Lisbon',temperature:19,unit:'°C',code:2,is_day:1,feels_like:18,humidity:63,wind:12,wind_unit:'km/h',precipitation:0,forecast:[{date:'2026-11-20',code:2,high:21,low:13,rain:10},{date:'2026-11-21',code:3,high:20,low:12,rain:20},{date:'2026-11-22',code:61,high:18,low:12,rain:65}]}}}));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { try { localStorage.setItem('linkpage_theme', 'light'); } catch { /* Sandboxed documents have no storage. */ } });
  async function capture(name, options = {}) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
    await page.screenshot({ path: path.join(folder, 'linkPage-v210-' + name + '.png'), fullPage: true, ...options });
  }
  await page.goto('/'); await page.locator('.link-card').first().waitFor(); await capture('public-light');
  await page.evaluate(() => applyTheme('dark')); await capture('public-dark');
  await page.evaluate(() => applyTheme('light'));
  await page.goto('/g/'+groups[0].slug);await page.locator('.lp-widget-clock').waitFor();await page.locator('.lp-weather-forecast').waitFor();await capture('widgets');
  await page.setViewportSize({width:390,height:844});await capture('widgets-mobile',{fullPage:false});await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await page.keyboard.press('Control+k'); await page.fill('#globalSearchInput', 'team');
  await page.locator('#globalSearchResults a').first().waitFor(); await capture('search'); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 }); await capture('public-mobile', { fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [name, theme] of [['christmas', 'light'], ['halloween', 'dark'], ['spring', 'light'], ['autumn', 'dark']]) {
    await api('/api/settings/season', 'POST', { name, background: 'static', effects: true, schedule: calendar.defaults() });
    await page.goto('/'); await page.waitForFunction(season => document.documentElement.dataset.season === season, name);
    await page.evaluate(value => applyTheme(value), theme); await capture('season-' + name);
  }
  await api('/api/settings/season', 'POST', { name: 'christmas', background: 'static', effects: true, schedule: calendar.defaults() });
  await page.goto('/f/team-handbook?theme=light'); await page.locator('.md-reader-tools summary').click(); await page.locator('.md-toc summary').click(); await capture('markdown');
  await api('/api/settings/season', 'POST', { name: 'none', background: 'minimal', effects: true, schedule: calendar.defaults() });
  await page.goto('/login/'); await page.fill('#signInEmail', 'alex@example.test'); await page.fill('#signInPassword', 'release-demo-password');
  await Promise.all([page.waitForURL('**/admin/**'), page.click('#signInBtn')]); await page.locator('#adminWrap').waitFor({ state: 'visible' });
  await page.evaluate(() => applyTheme('light')); await capture('admin-light'); await page.evaluate(() => applyTheme('dark')); await capture('admin-dark'); await page.evaluate(() => applyTheme('light'));
  await page.evaluate(()=>openStatsModal(links.find(link=>link.name==='Team calendar')));await page.locator('#recentClicksContainer .click-row').first().waitFor();await capture('statistics',{fullPage:false});await page.keyboard.press('Escape');
  await page.evaluate(()=>document.getElementById('openAnalyticsBtn').click());await page.locator('.analytics-line-chart').waitFor();await capture('analytics',{fullPage:false});await page.setViewportSize({width:390,height:844});await capture('analytics-mobile',{fullPage:false});await page.setViewportSize({width:1440,height:1000});await page.keyboard.press('Escape');
  await page.goto('/g/'+groups[0].slug);await page.locator('.lp-widget-clock').waitFor();await page.evaluate(id=>window.LinkPageWidgets.openEditor(id),note.id);await page.locator('.lp-widget-editor-dialog').waitFor();await capture('widget-editor',{fullPage:false});await page.keyboard.press('Escape');await page.goto('/admin/');await page.locator('#adminWrap').waitFor();
  await page.click('#workspaceBtn'); await page.selectOption('#workspaceResource', String(doc.id)); await capture('workspace-library');
  await page.click('#workspaceDialog [data-tab="history"]'); await page.selectOption('#workspaceHistoryDoc', String(doc.id)); await page.locator('[data-view-version]').first().waitFor(); await capture('workspace-history');
  await page.click('#workspaceDialog [data-tab="backups"]'); await page.locator('[data-download-backup]').first().waitFor(); await capture('workspace-backups');
  await page.click('#workspaceDialog [data-tab="library"]'); await page.click('[data-resource="groups"]'); await page.selectOption('#workspaceResource', String(groups[0].id)); await capture('workspace-access'); await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('openSettingsBtn').click()); await page.click('[data-tab="seasons"]'); await page.click('[data-season-choice="christmas"]'); await page.click('[data-background="static"]'); await capture('season-editor');
  await page.locator('#seasonAutoToggle').focus(); await page.locator('#seasonAutoToggle').press('Space'); await page.locator('#seasonAutoToggle').scrollIntoViewIfNeeded(); await capture('season-calendar');
  await page.click('[data-tab="sso"]'); await capture('sso');
  await page.click('[data-tab="themes"]');await capture('settings-themes',{fullPage:false});await page.locator('#ambientEffectsEditor details').evaluate(el=>el.open=true);await page.locator('#ambientEffectsEditor').scrollIntoViewIfNeeded();await capture('settings-effects',{fullPage:false});await page.keyboard.press('Escape');
  await api('/api/settings/theme','POST',{ambient_background:'custom',ambient_colors:['#77a8d4','#b7a9e7','#e9c8d6','#a7cfc9'],ambient_effect:'drift',ambient_speed:.5});await page.goto('/g/'+groups[0].slug);await page.locator('.lp-weather-forecast').waitFor();await capture('custom-fade',{fullPage:false});
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  await context.close();
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }).finally(async () => { await browser?.close(); await harness.stop(); });
