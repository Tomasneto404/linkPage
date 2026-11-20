// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const harness=require('../helpers/harness');const {launchBrowser,browserTest}=require('./helpers/browser');
let c,browser,group,other,section,doc,adminUser,member,personalGroup;
const password='a-long-enough-password';
before(async()=>{
  c=await harness.start();browser=await launchBrowser();
  adminUser=await c.makeUser({email:'enhancement-admin@example.test',password,role:'admin'});member=await c.makeUser({email:'enhancement-member@example.test',password});
  group=await c.makeGroup({name:'Engineering handbook'});other=await c.makeGroup({name:'Team resources'});section=await c.makeSection(group.id,'Reference documents');
  doc=await c.makeFileLink({name:'A very long handbook title that should remain fully available when the visible card text is truncated',fileName:'team.md',type:'text/markdown',bytes:Buffer.from('# Team handbook\n\nSearchbright is a useful search phrase.\n\n## Reference\n\nKeep the interface calm.'),groups:[{group_id:group.id,section_id:section.id}],slug:'search-handbook'});
  await c.makeLink({name:'Resource centre',url:'https://example.invalid/resources',groups:[other.id]});
  const s=c.session();await s.login(member.email,password);personalGroup=(await s.fetch('/api/my/groups',{method:'POST',json:{name:'My notes'}})).body;
});
after(async()=>{await browser?.close();await harness.stop();});
const btest=browserTest(test,()=>browser);
async function fresh(width=1280,extra={}){const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width,height:900},...extra});const page=await context.newPage();page.setDefaultTimeout(10000);return page;}
async function login(page,user=adminUser,next){await page.goto('/login/'+(next?'?next='+encodeURIComponent(next):''));await page.fill('#signInEmail',user.email);await page.fill('#signInPassword',password);await Promise.all([page.waitForURL(url=>!url.pathname.startsWith('/login')),page.click('#signInBtn')]);}
async function capture(page,name){if(!process.env.LINKPAGE_SCREENSHOTS)return;fs.mkdirSync(process.env.LINKPAGE_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.LINKPAGE_SCREENSHOTS,name+'.png'),fullPage:false});}
for(const width of [1280,390]){
  btest(`group navigation, section links, tooltips and centred QR dialogs at ${width}px`,async()=>{
    const page=await fresh(width);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await page.goto(`/?group=${group.id}&section=${section.id}`);await page.locator(`.tab.active[data-group="${group.id}"]`).first().waitFor();
      await page.locator(`[data-section-id="${section.id}"]`).waitFor();assert.equal(await page.locator('.link-name').first().getAttribute('title'),doc.name);
      if(width===390){await page.click('#lpGroupsMenu');await page.fill('#lpGroupSearch','Team resources');await page.locator('.lp-group-row [data-open]').first().click();}
      else await page.locator(`.tab[data-group="${other.id}"]`).first().click();
      await page.waitForURL('**/g/'+other.slug);await page.locator('.link-name',{hasText:'Resource centre'}).waitFor();
      await page.goBack();await page.locator(`.tab.active[data-group="${group.id}"]`).first().waitFor();
      await page.locator(`.tab[data-group="${group.id}"]`).first().click({button:'right'});const dialog=page.locator('.lp-share-dialog');await dialog.waitFor();
      await dialog.evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));});
      const box=await dialog.boundingBox();assert.ok(Math.abs(box.x+box.width/2-width/2)<2,'QR popup is horizontally centred');assert.ok(Math.abs(box.y+box.height/2-450)<2,'QR popup is vertically centred');
      await page.waitForFunction(()=>document.querySelector('.lp-share-preview')?.naturalWidth>0);
      assert.match(await dialog.locator('input').inputValue(),new RegExp('/g/'+group.slug));await capture(page,`qr-centred-${width}`);await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached'});assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(width===1280)assert.equal(await page.locator('#lpShareCurrent path').getAttribute('d'),await page.locator('.lp-link-qr path').first().getAttribute('d'),'group and link use the same QR icon');
    }finally{await page.context().close();}
  });
}
btest('sign-in preserves a group and section destination',async()=>{
  const page=await fresh();try{await login(page,member,`/g/${group.slug}?section=${section.id}`);await page.locator(`.tab.active[data-group="${group.id}"]`).first().waitFor();assert.match(page.url(),new RegExp('/g/'+group.slug));assert.equal(new URL(page.url()).searchParams.get('section'),String(section.id));}finally{await page.context().close();}
});
btest('search opens documents in a new tab and offers private recent queries with highlighted results',async()=>{
  const page=await fresh();try{
    await login(page);await page.keyboard.press('Control+k');await page.fill('#globalSearchInput','Searchbright');await page.locator('#globalSearchResults a').first().waitFor();
    assert.equal(await page.locator('#globalSearchResults a').first().getAttribute('target'),'_blank');assert.ok(await page.locator('#globalSearchResults mark').count());assert.match(await page.locator('.ws-result-context').first().textContent(),/Engineering handbook/);
    const [popup]=await Promise.all([page.waitForEvent('popup'),page.keyboard.press('Enter')]);await popup.waitForLoadState('domcontentloaded');assert.match(popup.url(),/\/f\/search-handbook/);await popup.close();
    await page.keyboard.press('Control+k');await page.locator('[data-recent="Searchbright"]').waitFor();await capture(page,'search-recent');
  }finally{await page.context().close();}
});
btest('Workspace retains its size across tabs, adds a widget and creates text without a file picker',async()=>{
  const page=await fresh();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await login(page);await page.click('#workspaceBtn');const first=await page.locator('#workspaceDialog').boundingBox();
    for(const tab of ['widgets','history','backups','notifications','presets','library']){await page.click(`#workspaceDialog [data-tab="${tab}"]`);await page.waitForFunction(()=>document.querySelector('#workspaceDialog').getAttribute('aria-busy')!=='true');const box=await page.locator('#workspaceDialog').boundingBox();assert.ok(Math.abs(box.height-first.height)<1&&Math.abs(box.width-first.width)<1,'workspace size is stable on '+tab);}
    await page.click('#workspaceDialog [data-tab="widgets"]');await page.fill('#lpWidgetForm [name=title]','Team time');await page.selectOption('#lpWidgetForm [name=kind]','clock');await page.selectOption('#lpWidgetForm [name=group_id]',String(group.id));await page.click('#lpWidgetForm button[type=submit]');await page.locator('#lpWidgetRows',{hasText:'Team time'}).waitFor();await capture(page,'widget-editor');await page.keyboard.press('Escape');
    await page.click('#openAddLinkBtn');await page.click('.link-mode-tab[data-mode=text]');await page.fill('#inputName','Written in the app');await page.fill('#inputTextFilename','written.md');await page.fill('#inputTextContent','# Written here\n\nNo upload picker was needed.');await page.click('#linkForm button[type=submit]');await page.locator('#linkModalOverlay').waitFor({state:'hidden'}).catch(()=>{});
    await page.locator('.link-name',{hasText:'Written in the app'}).waitFor();
    const savedResponse=await c.api('/api/links');assert.equal(savedResponse.status,200,savedResponse.text);const saved=savedResponse.body.find(l=>l.name==='Written in the app');assert.ok(saved,JSON.stringify(savedResponse.body.map(l=>({id:l.id,name:l.name}))));assert.equal(saved.file_name,'written.md');assert.match((await c.api(`/api/links/${saved.id}/file`)).body.content,/No upload picker/);
    await page.goto('/g/'+group.slug);await page.locator('.lp-widget-clock').waitFor();await page.waitForFunction(()=>document.querySelector('.lp-widget-clock').textContent.length>0);
    await page.evaluate(()=>window.sameCard=document.querySelector('.link-card'));await page.evaluate(async()=>{await loadData();await loadData();});assert.equal(await page.evaluate(()=>window.sameCard===document.querySelector('.link-card')),true,'unchanged refresh preserves card nodes');
    assert.deepEqual(errors,[]);
  }finally{await page.context().close();}
});
btest('members create their own text documents from the public page',async()=>{
  const page=await fresh(390);try{
    await login(page,member,`/?group=u${personalGroup.id}`);await page.locator('.link-card-add').click();await page.click('[data-compose-mode=text]');await page.fill('#myLinkName','My written notes');await page.fill('#myLinkTextFilename','notes.md');await page.fill('#myLinkTextContent','# Private notes\n\nOnly mine.');await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});await page.locator('.link-name',{hasText:'My written notes'}).waitFor();assert.equal((await c.pub('/api/workspace/search?q=Only%20mine')).body.results.length,0);
  }finally{await page.context().close();}
});
btest('automatic day and night follows local time without replaying card animations',async()=>{
  const page=await fresh(1280,{timezoneId:'Europe/Lisbon'});try{
    await page.clock.install({time:new Date('2026-11-17T22:00:00Z')});await page.addInitScript(()=>localStorage.setItem('linkpage_theme','daylight'));await page.goto('/');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.locator('.link-card').first().waitFor();assert.equal(await page.locator('.card-animate').count(),0);
    await page.clock.setSystemTime(new Date('2026-11-18T08:00:00Z'));await page.clock.runFor(31000);assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    await page.goto('/f/search-handbook?font=large&width=wide');const select=page.locator('select[name=font]');await page.locator('.md-reader-tools summary').click();assert.equal(await select.evaluate(el=>getComputedStyle(el).appearance),'none');
  }finally{await page.context().close();}
});
btest('motion profiles are selectable, portable and respect reduced motion',async()=>{
  const page=await fresh();try{
    await login(page);await page.evaluate(()=>document.getElementById('openSettingsBtn').click());await page.locator('#settingsOverlay').waitFor({state:'visible'});if(await page.locator('#settingsCategorySelect').isVisible())await page.selectOption('#settingsCategorySelect','themes');else await page.click('[data-tab=themes]');await page.selectOption('#motionStyleSelect','smooth');await page.waitForFunction(()=>document.documentElement.dataset.motion==='smooth');await page.selectOption('#ambientBackgroundSelect','aurora');await page.waitForFunction(()=>document.documentElement.dataset.ambient==='aurora');await capture(page,'motion-options');
    await page.goto('/g/'+group.slug);await page.locator('.link-card').first().hover();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.link-card')).transform!=='none');
    await capture(page,'aurora-background');
    const before=await page.locator('html').getAttribute('data-theme');await page.click('#themeToggle');await page.waitForFunction(previous=>document.documentElement.dataset.theme!==previous,before);await page.waitForFunction(()=>!document.documentElement.classList.contains('theme-view-transition'));
    assert.notEqual(await page.locator('body > .ambient-scene').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.link-card').first().evaluate(el=>getComputedStyle(el).transform),'none');
    assert.equal(await page.locator('body > .ambient-scene').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
    await page.evaluate(()=>window.LinkPageTheme.openPreferences());await page.selectOption('.lp-dialog [name=motion]','off');await page.click('.lp-dialog button[type=submit]');assert.equal(await page.locator('html').getAttribute('data-motion'),'off');
  }finally{await c.api('/api/settings/theme',{method:'POST',json:{motion_style:'subtle',ambient_background:'off'}});await page.context().close();}
});
for(const width of [1280,390]){
  btest(`public Markdown editing loads saved text, preserves drafts and fits the screen at ${width}px`,async()=>{
    const page=await fresh(width);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      await login(page,adminUser,'/g/'+group.slug);
      await page.locator(`.link-edit-btn[aria-label="Edit ${doc.name}"]`).click();
      await page.waitForFunction(()=>document.getElementById('myLinkTextContent').value.includes('Team handbook'));
      assert.equal(await page.locator('#myLinkTextFilename').inputValue(),'team.md');
      const draft='# Team handbook\n\nEdited safely on the public page.\n\n'+('A longer document.\n'.repeat(150));
      await page.fill('#myLinkTextContent',draft);
      await page.click('[data-compose-mode=file]');await page.click('[data-compose-mode=text]');
      assert.equal(await page.locator('#myLinkTextContent').inputValue(),draft,'switching tabs keeps the draft');
      const box=await page.locator('.my-link-modal').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=900,'modal stays inside the viewport');
      assert.ok(await page.locator('#myLinkForm').evaluate(el=>el.scrollHeight>el.clientHeight),'the form scrolls internally');
      assert.equal(await page.locator('#myLinkTextFilename').evaluate(el=>getComputedStyle(el).height),'42px');
      await capture(page,'public-markdown-editor-'+width);
      await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});
      assert.equal((await c.api(`/api/links/${doc.id}/file`)).body.content,draft);
      await page.locator(`.link-edit-btn[aria-label="Edit ${doc.name}"]`).click();
      await page.waitForFunction(expected=>document.getElementById('myLinkTextContent').value===expected,draft);
      await page.click('#cancelMyLinkBtn');assert.deepEqual(errors,[]);
    }finally{await page.context().close();}
  });
}
btest('a failed document load cannot save an empty replacement and can be retried',async()=>{
  const page=await fresh();try{
    await login(page,adminUser,'/g/'+group.slug);
    const route=`**/api/links/${doc.id}/file`;await page.route(route,r=>r.fulfill({status:503,json:{error:'Please retry loading this document.'}}));
    await page.locator(`.link-edit-btn[aria-label="Edit ${doc.name}"]`).click();await page.locator('#myLinkTextRetry').waitFor();
    assert.equal(await page.locator('#myLinkSubmitBtn').isDisabled(),true);assert.equal(await page.locator('#myLinkTextContent').inputValue(),'');
    await page.unroute(route);await page.click('#myLinkTextRetry');await page.waitForFunction(()=>document.getElementById('myLinkTextContent').value.startsWith('# Team handbook'));
    assert.equal(await page.locator('#myLinkSubmitBtn').isDisabled(),false);
  }finally{await page.context().close();}
});
btest('members can reopen and edit both uploaded Markdown and their written documents',async()=>{
  const page=await fresh(390);try{
    await login(page,member,`/?group=u${personalGroup.id}`);
    await page.locator('.link-edit-btn[aria-label="Edit My written notes"]').click();
    await page.waitForFunction(()=>document.getElementById('myLinkTextContent').value.includes('Only mine.'));
    await page.fill('#myLinkTextContent','# Updated notes\n\nStill only mine.');await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});
    await page.locator('.link-card-add').click();await page.click('[data-compose-mode=file]');
    await page.locator('#myLinkFileInput').setInputFiles({name:'imported.md',mimeType:'text/markdown',buffer:Buffer.from('# Imported text\n\nKeep these words.')});
    await page.waitForFunction(()=>document.getElementById('myLinkTextContent').value.includes('Keep these words.'));
    await page.fill('#myLinkTextContent','# Imported text\n\nEdited before saving.');await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});
    await page.locator('.link-edit-btn[aria-label="Edit imported"]').click();await page.waitForFunction(()=>document.getElementById('myLinkTextContent').value.includes('Edited before saving.'));
  }finally{await page.context().close();}
});
btest('group owners edit saved Markdown through their own permitted file endpoint',async()=>{
  await c.api(`/api/groups/${group.id}/managers`,{method:'PUT',json:{user_ids:[member.id]}});
  const page=await fresh();try{
    await login(page,member,'/g/'+group.slug);await page.locator(`.link-edit-btn[aria-label="Edit ${doc.name}"]`).click();
    await page.waitForFunction(()=>document.getElementById('myLinkTextContent').value.startsWith('# Team handbook'));
    await page.fill('#myLinkTextContent','# Updated by the group owner');await page.click('#myLinkSubmitBtn');await page.locator('#myLinkOverlay').waitFor({state:'hidden'});
    assert.equal((await c.api(`/api/links/${doc.id}/file`)).body.content,'# Updated by the group owner');
  }finally{await page.context().close();}
});
btest('3D scenes follow the pointer, cards tilt, entrances avoid refresh flicker, and reduced motion stops them',async()=>{
  await c.api('/api/settings/theme',{method:'POST',json:{ambient_background:'orbital',motion_style:'smooth'}});
  const page=await fresh();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto('/g/'+group.slug);const world=page.locator('body > .ambient-scene .scene3d-world');await world.waitFor({state:'attached'});
    assert.equal(await world.evaluate(el=>getComputedStyle(el).display),'block');
    await page.mouse.move(25,500);await page.waitForFunction(()=>Number(document.documentElement.style.getPropertyValue('--scene-pointer-x'))<-.2);
    const first=await world.evaluate(el=>getComputedStyle(el).transform);await page.mouse.move(1200,300);await page.waitForFunction(()=>Number(document.documentElement.style.getPropertyValue('--scene-pointer-x'))>.2);
    assert.notEqual(await world.evaluate(el=>getComputedStyle(el).transform),first);
    const card=page.locator('.link-card').first();await card.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));});
    await card.hover({position:{x:30,y:25}});await page.waitForFunction(()=>document.querySelector('.link-card').classList.contains('lp-pointer-hover'));
    assert.notEqual(await card.evaluate(el=>getComputedStyle(el).transform),'none');assert.notEqual(await card.evaluate(el=>el.style.getPropertyValue('--card-ry')),'0deg');
    assert.ok(await page.locator('.link-name').first().evaluate(el=>el.clientWidth>180),'card tools leave room for the title');
    await capture(page,'orbital-3d-public');
    await page.mouse.move(10,850);await page.evaluate(()=>loadData());assert.equal(await card.evaluate(el=>el.getAnimations().filter(a=>a.effect.getKeyframes().some(k=>k.opacity!==undefined)).length),0,'data refresh does not replay entrances');
    await page.locator(`.tab[data-group="${other.id}"]`).click();assert.ok(await page.locator('.link-card').first().evaluate(el=>el.getAnimations().length)>0,'a user group change animates its cards');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await world.evaluate(el=>getComputedStyle(el).transform),'none');assert.equal(await page.locator('body > .ambient-scene .scene-cube').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.deepEqual(errors,[]);
  }finally{await c.api('/api/settings/theme',{method:'POST',json:{ambient_background:'off',motion_style:'subtle'}});await page.context().close();}
});
btest('admin group reordering animates into place and is saved; glass scenes and select pickers work',async()=>{
  await c.api('/api/settings/theme',{method:'POST',json:{ambient_background:'prism',motion_style:'spring'}});
  const page=await fresh();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await login(page);await page.locator('.group-nav-item').first().waitFor();
    await capture(page,'glass-3d-admin');
    const first=page.locator(`.group-nav-item[data-group-id="${group.id}"]`),second=page.locator(`.group-nav-item[data-group-id="${other.id}"]`);
    await first.dragTo(second);await page.waitForFunction(id=>Number(document.querySelector('.group-nav-item').dataset.groupId)===id,other.id);
    assert.equal((await c.api('/api/groups')).body[0].id,other.id);
    assert.equal(await page.locator('.lp-lifted').count(),0);
    await page.evaluate(()=>document.getElementById('openSettingsBtn').click());await page.locator('#settingsOverlay').waitFor({state:'visible'});if(await page.locator('#settingsCategorySelect').isVisible())await page.selectOption('#settingsCategorySelect','themes');else await page.click('[data-tab=themes]');
    const select=page.locator('#ambientBackgroundSelect');await select.click();await capture(page,'animated-select-picker');await page.keyboard.press('Escape');
    assert.equal(await select.inputValue(),'prism');assert.deepEqual(errors,[]);
  }finally{await c.api('/api/settings/theme',{method:'POST',json:{ambient_background:'off',motion_style:'subtle'}});await page.context().close();}
});
btest('large libraries enter without stagger flashes or moving the whole grid',async()=>{
  const library=await c.makeGroup({name:'Large link library'});
  for(let start=0;start<48;start+=8)await Promise.all(Array.from({length:8},(_,index)=>c.makeLink({name:`Resource ${start+index}`,url:`https://example.invalid/resource/${start+index}`,groups:[library.id]})));
  await c.api('/api/settings/theme',{method:'POST',json:{motion_style:'smooth'}});
  const page=await fresh();try{
    await page.goto('/g/'+group.slug);await page.locator('.link-card').first().waitFor();await page.locator(`.tab[data-group="${library.id}"]`).click();
    const samples=await page.evaluate(async()=>{
      const grid=document.getElementById('linksGrid'),cards=[...grid.querySelectorAll('.link-card')];
      const result={count:cards.length,gridAnimations:grid.getAnimations().length,animated:cards.filter(card=>card.getAnimations().length).length,opacity:[]};
      for(let i=0;i<12;i++){result.opacity.push(Number(getComputedStyle(cards[0]).opacity));await new Promise(requestAnimationFrame);}
      return result;
    });
    assert.equal(samples.count,48);assert.equal(samples.gridAnimations,0);assert.ok(samples.animated<=16);
    assert.ok(samples.opacity.every((opacity,index)=>index===0||opacity>=samples.opacity[index-1]-.005),'opacity never flashes backwards');
    await page.waitForFunction(()=>![...document.querySelectorAll('.link-card')].some(card=>card.getAnimations().length));
    await page.evaluate(()=>loadData());assert.equal(await page.locator('.lp-entering').count(),0,'a background refresh does not restart entry motion');
  }finally{await c.api('/api/settings/theme',{method:'POST',json:{motion_style:'subtle'}});await page.context().close();}
});
btest('seasonal atmosphere combines with a custom background only when selected',async()=>{
  await c.api('/api/settings/season',{method:'POST',json:{name:'christmas',effects:true,background:'static'}});
  await c.api('/api/settings/theme',{method:'POST',json:{ambient_background:'orbital',ambient_blend:'separate'}});
  const page=await fresh();try{
    await page.goto('/g/'+group.slug);await page.locator('.link-card').first().waitFor();assert.equal(await page.locator('#seasonEffects').count(),0);
    assert.equal(await page.locator('.season-backdrop').evaluate(el=>getComputedStyle(el).display),'none');
    await page.evaluate(()=>window.LinkPageTheme.openPreferences());await page.selectOption('.lp-dialog [name=blend]','particles');await page.click('.lp-dialog button[type=submit]');await page.locator('#seasonEffects').waitFor({state:'attached'});
    assert.equal(await page.locator('.season-backdrop').evaluate(el=>getComputedStyle(el).display),'none');
    assert.equal(await page.locator('body > .ambient-scene .scene3d-world').evaluate(el=>getComputedStyle(el).display),'block');await capture(page,'particles-plus-custom');
    await page.goto('/g/'+group.slug);await page.locator('#seasonEffects').waitFor({state:'attached'});assert.equal(await page.locator('html').getAttribute('data-ambient-blend'),'particles');
    await page.evaluate(()=>window.LinkPageTheme.openPreferences());await page.selectOption('.lp-dialog [name=blend]','season');await page.click('.lp-dialog button[type=submit]');await page.locator('#seasonEffects').waitFor({state:'attached'});
    assert.equal(await page.locator('.season-backdrop').evaluate(el=>getComputedStyle(el).display),'block');assert.equal(await page.locator('body > .ambient-scene .scene3d-world').evaluate(el=>getComputedStyle(el).display),'block');
    await capture(page,'season-plus-orbital');
    await page.goto('/g/'+group.slug);await page.locator('#seasonEffects').waitFor({state:'attached'});
    await page.evaluate(()=>window.LinkPageTheme.openPreferences());await page.selectOption('.lp-dialog [name=blend]','separate');await page.click('.lp-dialog button[type=submit]');await page.locator('#seasonEffects').waitFor({state:'detached'});
  }finally{await c.api('/api/settings/season',{method:'POST',json:{name:'none'}});await c.api('/api/settings/theme',{method:'POST',json:{ambient_background:'off',ambient_blend:'separate'}});await page.context().close();}
});
btest('card entrances have distinct fade, glide and spring motion in small and large libraries',async()=>{
  const library=await c.makeGroup({name:'Entrance comparison'});
  for(let start=0;start<32;start+=8)await Promise.all(Array.from({length:8},(_,index)=>c.makeLink({name:`Entrance ${start+index}`,url:`https://example.invalid/entrance/${start+index}`,groups:[library.id]})));
  const page=await fresh();try{
    await page.goto('/g/'+other.slug);await page.locator('.link-card').first().waitFor();await page.mouse.move(0,0);
    for(const target of [group.id,library.id]){
      const samples={};
      for(const style of ['subtle','smooth','spring']){
        samples[style]=await page.evaluate(({style,target})=>{
          navigateGroup('all');document.documentElement.dataset.motion=style;navigateGroup(target);
          const card=document.querySelector('.link-card'),animation=card.getAnimations().find(a=>a.effect.getKeyframes().some(frame=>frame.opacity!==undefined));
          animation.pause();const duration=animation.effect.getComputedTiming().duration;
          const frames=[0,.25,.6,.85,1].map(progress=>{
            animation.currentTime=duration*progress;
            const matrix=new DOMMatrixReadOnly(getComputedStyle(card).transform);
            return {scale:matrix.a,y:matrix.m42,opacity:Number(getComputedStyle(card).opacity)};
          });
          animation.finish();return frames;
        },{style,target});
      }
      assert.ok(samples.subtle.every(frame=>frame.scale===1&&frame.y===0),'Subtle changes opacity without moving the card');
      assert.ok(samples.smooth[0].y>0&&samples.smooth[2].y<samples.smooth[0].y,'Smooth glides upward');
      assert.ok(samples.smooth.every(frame=>frame.scale===1),'Smooth does not bounce');
      assert.ok(samples.spring[0].scale<1&&samples.spring[2].scale>1,'Spring expands and overshoots before settling');
      assert.ok(Math.abs(samples.spring.at(-1).scale-1)<.001,'Spring returns to its resting size');
      for(const frames of Object.values(samples))assert.ok(frames.every((frame,index)=>index===0||frame.opacity>=frames[index-1].opacity-.001),'every style fades in without flashing backwards');
    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(id=>{navigateGroup('all');navigateGroup(id);},group.id);
    assert.equal(await page.locator('.lp-entering').count(),0,'reduced motion suppresses entrances');
  }finally{await page.context().close();}
});
