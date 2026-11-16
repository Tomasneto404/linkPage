// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const harness=require('../helpers/harness');
const {launchBrowser,browserTest}=require('./helpers/browser');
let c,browser,group,doc,link,icon;const password='a-long-enough-password';
before(async()=>{c=await harness.start();browser=await launchBrowser();await c.makeUser({email:'workspace-admin@example.test',password,role:'admin'});group=await c.makeGroup({name:'Design team'});doc=await c.makeFileLink({name:'Design handbook',fileName:'design.md',type:'text/markdown',bytes:Buffer.from('# Design handbook\n\nVelvetsearch lives here.\n\n## Guidelines\n\nKeep things calm.'),groups:[group.id],slug:'design-handbook'});icon=await c.makeIcon({name:'design-icon.png',type:'image/png',bytes:harness.pngBytes()});const form=new FormData();form.append('name','Design dashboard');form.append('url','https://design.example.invalid');form.append('icon_id',String(icon.id));form.append('groups',JSON.stringify([{group_id:group.id}]));link=(await c.api('/api/links',{method:'POST',form})).body;});
after(async()=>{await browser?.close();await harness.stop();});
const btest=browserTest(test,()=>browser);
async function fresh(width=1280){const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width,height:900}});const page=await context.newPage();page.setDefaultTimeout(8000);return page;}
async function admin(page){await page.goto('/login/');await page.fill('#signInEmail','workspace-admin@example.test');await page.fill('#signInPassword',password);await Promise.all([page.waitForURL('**/admin/**'),page.click('#signInBtn')]);await page.locator('#adminWrap').waitFor({state:'visible'});}
async function capture(page,name){if(!process.env.LINKPAGE_SCREENSHOTS)return;fs.mkdirSync(process.env.LINKPAGE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.LINKPAGE_SCREENSHOTS,`${name}.png`),fullPage:true});}

for(const width of [1280,390]){
  btest(`global search uses custom link icons, keyboard navigation and document content at ${width}px`,async()=>{
    const page=await fresh(width);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.locator('#globalSearchBtn').waitFor();await page.keyboard.press('Control+k');await page.fill('#globalSearchInput','Design dashboard');const result=page.locator('#globalSearchResults a').first();await result.waitFor();assert.match(await result.locator('img').getAttribute('src'),/\/uploads\//);await page.waitForFunction(()=>document.querySelector('#globalSearchResults img')?.naturalWidth>0);await page.keyboard.press('ArrowDown');assert.equal(await result.getAttribute('aria-selected'),'true');await capture(page,`global-search-${width}`);await page.fill('#globalSearchInput','Velvetsearch');await page.locator('#globalSearchResults a',{hasText:'Design handbook'}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#globalSearchDialog').isVisible(),false);assert.deepEqual(errors,[]);await page.context().close();
  });
  btest(`workspace manages tags, layouts, history, presets and backup scheduling at ${width}px`,async()=>{
    const page=await fresh(width);const errors=[];page.on('pageerror',e=>errors.push(e.message));await admin(page);await page.click('#workspaceBtn');await page.selectOption('#workspaceResource',String(link.id));await page.fill('#workspaceTags','design, team');await page.click('#workspaceLinkForm button[type=submit]');await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('saved'));
    await page.click('[data-resource="groups"]');await page.selectOption('#workspaceResource',String(group.id));await page.selectOption('#workspaceLayout','list');await page.click('#workspaceGroupForm button[type=submit]');await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('saved'));await capture(page,`workspace-library-${width}`);
    await page.click('#workspaceDialog [data-tab="history"]');await page.selectOption('#workspaceHistoryDoc',String(doc.id));await page.waitForFunction(()=>document.getElementById('workspaceVersions').textContent.includes('Design handbook'));
    await page.click('#workspaceDialog [data-tab="presets"]');await page.fill('#workspacePresetName',`Test preset ${width}`);await page.click('#wsPresetForm button[type=submit]');await page.waitForFunction(name=>document.getElementById('workspaceContent').textContent.includes(name),`Test preset ${width}`);assert.match(await page.locator('#workspaceContent').textContent(),new RegExp(`Test preset ${width}`));
    await page.click('#workspaceDialog [data-tab="backups"]');await page.fill('#wsBackupHour','5');await page.click('#workspaceBackupSchedule button[type=submit]');await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('schedule saved'));await page.click('#workspaceCreateBackup');await page.locator('[data-download-backup]').first().waitFor();await capture(page,`workspace-backups-${width}`);
    await page.click('#workspaceDialog [data-tab="notifications"]');await page.locator('#wsReadAll').waitFor();await page.click('#wsReadAll');await page.waitForFunction(()=>document.getElementById('workspaceStatus').textContent.includes('marked as read'));await page.keyboard.press('Escape');
    await page.goto(`/?group=${group.id}`);await page.waitForFunction(()=>document.getElementById('linksGrid').dataset.layout==='list');await page.selectOption('#workspaceTagSelect','design');assert.equal(await page.locator('.link-card:visible .link-name').count(),1);await page.click('#workspaceSaveFilter');await page.locator('.ws-filter-dialog input').fill(`Team filter ${width}`);await page.locator('.ws-filter-dialog button[type=submit]').click();await page.locator('.ws-filter-dialog').waitFor({state:'detached'});await page.locator('#workspaceSavedFilter').waitFor();assert.deepEqual(errors,[]);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,'page fits the viewport');await page.context().close();
  });
}
btest('reading options submit safely, show a contents index and highlight document matches',async()=>{
  const page=await fresh();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/f/design-handbook?theme=dark');await page.locator('.md-reader-tools summary').click();await page.selectOption('select[name=font]','large');await page.selectOption('select[name=width]','wide');await page.fill('input[name=q]','Velvetsearch');await Promise.all([page.waitForURL(/font=large/),page.click('.md-reader-form button')]);assert.equal(await page.locator('html').getAttribute('data-reading-font'),'large');assert.equal(await page.locator('#md-match-1').textContent(),'Velvetsearch');await page.locator('.md-toc summary').click();assert.equal(await page.locator('.md-toc nav a').count(),2);assert.equal(await page.locator('script').count(),0);await capture(page,'markdown-reading-options');assert.deepEqual(errors,[]);await page.context().close();
});
btest('general administrators edit shared links from the public page, including ungrouped links, without losing memberships',async()=>{
  const other=await c.makeGroup({name:'Another shared group'});
  const grouped=await c.makeLink({name:'Admin public edit',url:'https://admin-edit.invalid',groups:[group.id,other.id]});
  const ungrouped=await c.makeLink({name:'Admin ungrouped edit',url:'https://ungrouped.invalid'});
  const hidden=await c.makeLink({name:'Still hidden from public',url:'https://hidden.invalid'});await c.api(`/api/links/${hidden.id}/visibility`,{method:'POST',json:{hidden:true}});
  const page=await fresh();await admin(page);await page.goto('/');
  for(const [source,name]of [[grouped,'Admin edited shared'],[ungrouped,'Admin edited ungrouped']]){
    await page.click('#tabAll');
    await page.locator(`.link-edit-btn[aria-label="Edit ${source.name}"]`).click();await page.fill('#myLinkName',name);await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});await page.locator('.link-card',{hasText:name}).waitFor();
  }
  const saved=(await c.api('/api/links')).body.find(l=>l.id===grouped.id);assert.deepEqual(saved.group_ids.sort((a,b)=>a-b),[group.id,other.id].sort((a,b)=>a-b));
  assert.equal((await c.api('/api/links')).body.find(l=>l.id===ungrouped.id).group_ids.length,0);
  assert.equal(await page.locator('.link-card',{hasText:hidden.name}).count(),0);
  await page.context().close();
});
btest('the verified administrator token also enables editing on the public page',async()=>{
  const item=await c.makeLink({name:'Token public edit',url:'https://token-edit.invalid'});
  const page=await fresh();await page.addInitScript(token=>localStorage.setItem('linkpage_admin_token',token),c.token);await page.goto('/');
  await page.locator('.link-edit-btn',{hasText:''}).first().waitFor();await page.locator(`.link-edit-btn[aria-label="Edit ${item.name}"]`).click();await page.fill('#myLinkName','Token changed this');await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});await page.locator('.link-card',{hasText:'Token changed this'}).waitFor();
  assert.equal((await c.api('/api/links')).body.find(l=>l.id===item.id).name,'Token changed this');await page.context().close();
});
btest('group arrows occupy their own lanes and never select a group',async()=>{
  for(let i=0;i<22;i++)await c.makeGroup({name:`Scroll group ${String(i+1).padStart(2,'0')}`});
  for(const width of [1280,390])for(const loop of [false,true]){
    await c.api('/api/settings/group-tabs-loop',{method:'POST',json:{enabled:loop}});
    const page=await fresh(width);await page.goto('/');await page.locator('#tabsNext').waitFor({state:'visible'});
    const initial=await page.locator('#tabsRow .tab.active').getAttribute('data-group');
    const geometry=await page.evaluate(()=>{const viewport=document.getElementById('tabsViewport').getBoundingClientRect();return ['tabsPrev','tabsNext'].map(id=>{const button=document.getElementById(id),rect=button.getBoundingClientRect();return {separate:rect.right<=viewport.left+.5||rect.left>=viewport.right-.5,hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('button')?.id===id};});});
    assert.ok(geometry.every(g=>g.separate&&g.hit),'arrow hit targets are physically separate from the group viewport');
    const before=await page.locator('#tabsViewport').evaluate(el=>el.scrollLeft);await page.click('#tabsNext');await page.waitForFunction(old=>document.getElementById('tabsViewport').scrollLeft!==old,before);assert.equal(await page.locator('#tabsRow .tab.active').getAttribute('data-group'),initial);await capture(page,`group-arrows-${width}-${loop?'loop':'bounded'}`);await page.context().close();
  }
});
