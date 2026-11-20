// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const harness=require('../helpers/harness');
const {launchBrowser,browserTest}=require('./helpers/browser');
let c,browser,group,source,clock,note,feed,alerts,weather,manager,linkA,linkB,linkC;
const password='widget-browser-password';
before(async()=>{
  c=await harness.start();browser=await launchBrowser();
  await c.makeUser({email:'widget-browser-admin@example.test',password,role:'admin'});
  group=await c.makeGroup({name:'Widget examples'});
  manager=await c.makeUser({email:'widget-layout-manager@example.test',password});await c.api(`/api/groups/${group.id}/managers`,{method:'PUT',json:{user_ids:[manager.id]}});
  linkA=await c.makeLink({name:'First draggable resource',groups:[group.id]});linkB=await c.makeLink({name:'Middle resource',groups:[group.id]});linkC=await c.makeLink({name:'Last draggable resource',groups:[group.id]});
  source=http.createServer((req,res)=>{if(req.url.startsWith('/message'))res.end(JSON.stringify({messages:[{id:1,title:'Deployment complete',message:'The site is ready',priority:8,date:'2026-11-18T12:00:00Z'}]}));else res.end('<rss><channel><title>News</title><item><title>Security news</title><link>https://example.test/article</link><pubDate>Wed, 18 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[An update <img src="/fixture-image.png">]]></description></item></channel></rss>');});
  await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+source.address().port;
  const add=async(kind,title,config,layout={})=>(await c.api('/api/workspace/widgets',{method:'POST',json:{kind,title,group_id:group.id,config,layout}})).body;
  clock=await add('clock','Lisbon and Tokyo',{mode:'analog',seconds:false,timezone:'Europe/Lisbon',zones:[{timezone:'Asia/Tokyo',label:'Tokyo'}]});
  note=await add('note','Team checklist',{format:'markdown',text:'## Today\n\n- [ ] Review handbook\n- [x] Ship update'},{width:2});
  feed=await add('rss','Security headlines',{url:base,allow_private:true,view:'cards',show_images:true,limit:5});
  alerts=await add('gotify','Team alerts',{url:base,allow_private:true,token:'browser-client-token',min_priority:5});
  weather=await add('weather','Lisbon weather',{latitude:38.7,longitude:-9.1,location:'Lisbon',days:3});
});
after(async()=>{await browser?.close();await new Promise(resolve=>source.close(resolve));await harness.stop();});
const btest=browserTest(test,()=>browser);
async function pageFor({width=1280,admin=false,email='widget-browser-admin@example.test'}={}){
  const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width,height:900},isMobile:width<600,hasTouch:width<600});const page=await context.newPage();page.setDefaultTimeout(10000);
  if(admin){await page.goto('/login/');await page.fill('#signInEmail',email);await page.fill('#signInPassword',password);await Promise.all([page.waitForURL(url=>!url.pathname.startsWith('/login')),page.click('#signInBtn')]);}
  await page.route('**/api/widgets/'+weather.id+'/data',route=>route.fulfill({json:{updated_at:new Date().toISOString(),stale:false,data:{location:'Lisbon',temperature:19,unit:'°C',code:3,is_day:1,feels_like:18,wind:12,wind_unit:'km/h',humidity:65,precipitation:0,forecast:[{date:'2026-11-18',code:3,high:21,low:14,rain:30},{date:'2026-11-19',code:61,high:20,low:13,rain:60}]}}}));
  await page.route('**/fixture-image.png',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="#e8edf0"/></svg>'}));
  await page.goto('/g/'+group.slug);await page.locator(`[data-widget="${clock.id}"] .lp-widget-clock`).filter({hasText:/\d/}).waitFor();return page;
}
const widget=(page,row)=>page.locator(`[data-widget="${row.id}"]`);
async function menu(page,row){const card=widget(page,row);await card.locator('summary').click();return card;}
btest('dashboard presents analog clocks, rich RSS, forecast and safe Markdown without overflow',async()=>{
  const page=await pageFor();try{
    await page.locator('.lp-feed-image').waitFor();assert.equal(await widget(page,clock).locator('.lp-clock-face').count(),1);assert.equal(await widget(page,clock).locator('.lp-clock-second').count(),0);assert.match(await widget(page,clock).locator('[data-clock-zone]').innerText(),/\d/);
    assert.equal(await widget(page,feed).locator('.lp-feed-cards time').count(),1);assert.equal(await widget(page,weather).locator('.lp-weather-forecast>div').count(),2);
    assert.equal(await widget(page,note).getByRole('checkbox',{name:'Review handbook'}).isDisabled(),true);
    assert.equal(await page.locator('[data-add-widget]').isVisible(),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.evaluate(()=>{window.__savedWidget=document.querySelector('.lp-widget-clock');});await page.evaluate(()=>window.LinkPageWidgets.refresh());assert.equal(await page.evaluate(()=>window.__savedWidget===document.querySelector('.lp-widget-clock')),true,'unchanged refresh keeps existing widget nodes');
    await page.screenshot({path:'.cache/widgets-desktop.png',fullPage:true});
  }finally{await page.context().close();}
});
btest('public quick editor previews unsaved notes and preserves or clears source on edit',async()=>{
  const page=await pageFor({admin:true});try{
    await page.locator('[data-add-widget]').click();const dialog=page.getByRole('dialog',{name:'Add widgets',exact:true});await dialog.locator('[data-widget-template=note]').click();await dialog.locator('[name=title]').fill('Previewed note');await dialog.locator('[name=text]').fill('**Unsaved preview**');
    await dialog.locator('[data-preview-widget]').click();await dialog.locator('.lp-widget-preview strong').filter({hasText:'Unsaved preview'}).waitFor();assert.equal((await c.api('/api/workspace/widgets')).body.some(row=>row.title==='Previewed note'),false);
    await dialog.locator('button[type=submit]').click();await dialog.waitFor({state:'hidden'});const saved=(await c.api('/api/workspace/widgets')).body.find(row=>row.title==='Previewed note');await widget(page,saved).waitFor();
    await (await menu(page,saved)).locator('[data-widget-action=edit]').click();const edit=page.getByRole('dialog',{name:'Edit widget',exact:true});assert.equal(await edit.locator('[name=text]').inputValue(),'**Unsaved preview**');await edit.locator('[name=text]').fill('');await edit.locator('button[type=submit]').click();await edit.waitFor({state:'hidden'});
    await page.waitForFunction(id=>{const node=document.querySelector(`[data-widget="${id}"] .lp-widget-note`);return node&&node.textContent==='';},saved.id);
  }finally{await page.context().close();}
});
btest('manager quick actions change width, order, duplicate and visibility',async()=>{
  const page=await pageFor({admin:true});try{
    await (await menu(page,clock)).locator('[data-widget-width]').selectOption('2');await page.waitForFunction(id=>document.querySelector(`[data-widget="${id}"]`)?.dataset.width==='2',clock.id);
    const card=await menu(page,clock);await card.locator('[data-widget-action=down]').click();await page.waitForFunction(id=>document.querySelector('#lpWidgets')?.firstElementChild?.dataset.widget!==String(id),clock.id);
    await (await menu(page,clock)).locator('[data-widget-action=duplicate]').click();await page.getByRole('heading',{name:'Lisbon and Tokyo (copy)',exact:true}).waitFor();const copy=(await c.api('/api/workspace/widgets')).body.find(row=>row.title==='Lisbon and Tokyo (copy)');
    await (await menu(page,copy)).locator('[data-widget-action=hide]').click();await widget(page,copy).waitFor({state:'detached'});assert.equal((await c.api('/api/workspace/widgets')).body.find(row=>row.id===copy.id).enabled,false);
  }finally{await page.context().close();}
});
btest('shared tasks persist and notification read state survives reload',async()=>{
  const page=await pageFor({admin:true});try{
    const task=widget(page,note).getByRole('checkbox',{name:'Review handbook'});await Promise.all([page.waitForResponse(response=>response.url().endsWith('/'+note.id+'/data')&&response.status()===200),task.check()]);assert.equal((await c.pub('/api/widgets/'+note.id+'/data')).body.data.tasks[0].checked,true);
    await widget(page,alerts).locator('[data-read-msg]').click();await widget(page,alerts).getByText('0 unread',{exact:true}).waitFor();await page.reload();await widget(page,alerts).getByText('0 unread',{exact:true}).waitFor();
    assert.equal((await c.pub('/api/widgets/'+alerts.id+'/data')).body.read.length,0);
  }finally{await page.context().close();}
});
btest('phone editor is bounded and device visibility responds to viewport changes',async()=>{
  const mobile=(await c.api('/api/workspace/widgets',{method:'POST',json:{kind:'note',title:'Phone information',group_id:group.id,config:{text:'For small screens'},layout:{device:'mobile'}}})).body;
  const page=await pageFor({width:390,admin:true});try{
    await widget(page,mobile).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'.cache/widgets-mobile.png',fullPage:true});await page.locator('[data-add-widget]').click();const dialog=page.getByRole('dialog',{name:'Add widgets',exact:true});const bounds=await dialog.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900);
    await dialog.locator('[data-widget-template=clock]').click();await dialog.locator('[name=title]').fill('Phone clock');await dialog.locator('[name=mode]').selectOption('analog');assert.equal(await dialog.locator('[name=title]').evaluate(el=>getComputedStyle(el).fontSize),'16px');assert.ok((await dialog.locator('[name=seconds]').boundingBox()).width<=20,'checkboxes retain their compact shape');await dialog.locator('button[type=submit]').scrollIntoViewIfNeeded();const action=await dialog.locator('button[type=submit]').boundingBox();assert.ok(action.y>=0&&action.y+action.height<=900);await page.screenshot({path:'.cache/widget-editor-mobile.png'});await dialog.locator('[data-close-editor]').click();
    await page.setViewportSize({width:1280,height:900});await widget(page,mobile).waitFor({state:'detached'});
  }finally{await page.context().close();}
});
btest('administrators resize with the mouse, persist dimensions and drag the whole widget',async()=>{
  await c.api('/api/workspace/widgets/'+clock.id,{method:'PUT',json:{layout:{width:1,height_px:null}}});
  const page=await pageFor({admin:true});try{
    const card=widget(page,clock),handle=card.locator('[data-resize-widget]');await handle.scrollIntoViewIfNeeded();const start=await handle.boundingBox(),original=await card.boundingBox();
    const resized=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith('/widgets/'+clock.id));
    await page.mouse.move(start.x+12,start.y+12);await page.mouse.down();assert.equal(await card.locator('.lp-widget-size-preview').isVisible(),true);assert.equal(await card.locator('.lp-widget-size-preview').evaluate(el=>getComputedStyle(el).borderTopStyle),'dashed');await page.mouse.move(start.x+360,start.y+90,{steps:12});assert.match(await card.locator('.lp-widget-size-preview span').innerText(),/ × \d+ px/);await page.screenshot({path:'.cache/widget-resize-preview.png'});await page.mouse.up();await card.locator('.lp-widget-size-preview').waitFor({state:'detached'});assert.equal((await resized).status(),200);
    const stored=(await c.api('/api/workspace/widgets')).body.find(row=>row.id===clock.id);assert.equal(stored.layout.width,2);assert.ok(stored.layout.height_px>=Math.round(original.height)+70);
    await page.reload();await widget(page,clock).waitFor();assert.ok(Math.abs((await widget(page,clock).boundingBox()).height-stored.layout.height_px)<2);
    const before=(await c.api('/api/workspace/widgets')).body.map(row=>row.id),target=before.indexOf(clock.id)>before.indexOf(note.id)?note:feed;
    await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/workspace/widgets/reorder')),widget(page,clock).locator('.lp-widget-head h2').dragTo(widget(page,target).locator('.lp-widget-head h2'))]);await page.waitForFunction(id=>!document.querySelector(`[data-widget="${id}"]`).classList.contains('lp-widget-dragging'),clock.id);
    const after=(await c.api('/api/workspace/widgets')).body.map(row=>row.id);assert.notDeepEqual(after,before);
  }finally{await page.context().close();}
});
btest('group managers can edit content but cannot drag or resize shared widgets or links',async()=>{
  const page=await pageFor({admin:true,email:manager.email});try{
    assert.equal(await page.locator('[data-resize-widget],[data-drag-widget],[data-widget-width]').count(),0);assert.equal(await widget(page,clock).getAttribute('draggable'),'false');
    assert.equal(await page.locator('.link-card[draggable=true]').count(),0);
    await (await menu(page,note)).locator('[data-widget-action=edit]').click();const edit=page.getByRole('dialog',{name:'Edit widget',exact:true});assert.equal(await edit.locator('[name=width]').isDisabled(),true);assert.equal(await edit.locator('[name=height]').isDisabled(),true);await edit.locator('[name=title]').fill('Manager edited checklist');await edit.locator('button[type=submit]').click();await edit.waitFor({state:'hidden'});await page.getByRole('heading',{name:'Manager edited checklist'}).waitFor();
  }finally{await page.context().close();}
});
btest('administrators exchange link cards on public and admin pages without moving the middle link',async()=>{
  const page=await pageFor({admin:true});try{
    const ids=()=>page.locator('#linksGrid .link-card[data-link-id]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.linkId))),before=await ids();
    await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/links/swap')),page.locator(`.link-card[data-link-id="${linkA.id}"]`).dragTo(page.locator(`.link-card[data-link-id="${linkC.id}"]`))]);
    await page.waitForFunction(({a,before})=>[...document.querySelectorAll('#linksGrid .link-card[data-link-id]')].findIndex(node=>Number(node.dataset.linkId)===a)!==before,{a:linkA.id,before:before.indexOf(linkA.id)});
    const changed=await ids();assert.equal(changed.indexOf(linkA.id),before.indexOf(linkC.id));assert.equal(changed.indexOf(linkC.id),before.indexOf(linkA.id));assert.equal(changed.indexOf(linkB.id),before.indexOf(linkB.id));
    await page.goto('/admin/');await page.locator(`.link-card[data-link-id="${linkA.id}"]`).waitFor();await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/links/swap')),page.locator(`.link-card[data-link-id="${linkA.id}"]`).dragTo(page.locator(`.link-card[data-link-id="${linkC.id}"]`))]);
    await page.waitForFunction(id=>Number(document.querySelector('#linksGrid .link-card')?.dataset.linkId)===id,before[0]);
  }finally{await page.context().close();}
});
btest('widgets share the three link entrance profiles and pointer motion, without replaying on refresh',async()=>{
  for(const style of ['subtle','smooth','spring']){
    await c.api('/api/settings/theme',{method:'POST',json:{motion_style:style}});
    const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width:1280,height:900}}),page=await context.newPage();try{
      await page.addInitScript(()=>{window.widgetEntrances=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.matches('.lp-widget'))window.widgetEntrances.push({frames,options});return animate.call(this,frames,options);};});
      await page.goto('/g/'+group.slug);await page.waitForFunction(()=>window.widgetEntrances.length>0);const first=await page.evaluate(()=>window.widgetEntrances[0].frames[0]);if(style==='subtle')assert.equal(first.transform,undefined);else assert.match(first.transform,style==='smooth'?/translateY/:/scale/);
      await page.locator('.lp-widget').first().evaluate(async el=>{await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));});const count=await page.evaluate(()=>window.widgetEntrances.length);await page.evaluate(()=>window.LinkPageWidgets.refresh());assert.equal(await page.evaluate(()=>window.widgetEntrances.length),count);
      if(style!=='subtle'){await page.locator('.lp-widget-head h2').first().hover();await page.waitForFunction(()=>document.querySelector('.lp-widget.lp-pointer-hover'));}
      await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('.lp-widget').first().waitFor();assert.equal(await page.evaluate(()=>window.widgetEntrances.length),0);
    }finally{await context.close();}
  }
  await c.api('/api/settings/theme',{method:'POST',json:{motion_style:'subtle'}});
});
btest('resizing height on phones preserves the desktop column span',async()=>{
  await c.api('/api/workspace/widgets/'+clock.id,{method:'PUT',json:{layout:{width:3,height_px:250}}});
  const page=await pageFor({width:390,admin:true});try{
    const handle=widget(page,clock).locator('[data-resize-widget]');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
    const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith('/widgets/'+clock.id));await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+12,box.y+52,{steps:6});await page.mouse.up();assert.equal((await saved).status(),200);
    const row=(await c.api('/api/workspace/widgets')).body.find(item=>item.id===clock.id);assert.equal(row.layout.width,3);assert.equal(row.layout.height_px,290);
  }finally{await page.context().close();}
});
btest('page reload reveals widgets smoothly after their content arrives',async()=>{
  const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width:1280,height:900}}),page=await context.newPage();let release;const ready=new Promise(resolve=>release=resolve);
  try{
    await page.addInitScript(()=>{window.loadedWidgetEntrances=[];const original=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.matches('.lp-widget'))window.loadedWidgetEntrances.push({id:this.dataset.widget,loaded:!!this.querySelector('.lp-widget-clock')?.textContent,opacity:frames[0].opacity});return original.call(this,frames,options);};});
    await page.route('**/api/widgets/'+clock.id+'/data',async route=>{await ready;await route.fulfill({json:{data:{timezone:'Europe/Lisbon',mode:'analog',seconds:false},updated_at:new Date().toISOString(),stale:false}});});
    await page.goto('/g/'+group.slug);const card=widget(page,clock);
    await page.waitForFunction(id=>document.querySelector(`[data-widget="${id}"]`)?.hasAttribute('data-widget-pending'),clock.id);assert.equal(await card.evaluate(el=>getComputedStyle(el).opacity),'0');release();
    await page.waitForFunction(id=>window.loadedWidgetEntrances.some(row=>Number(row.id)===id),clock.id);let entry=await page.evaluate(id=>window.loadedWidgetEntrances.find(row=>Number(row.id)===id),clock.id);assert.equal(entry.loaded,true);assert.equal(entry.opacity,0);
    await page.reload();await page.waitForFunction(id=>window.loadedWidgetEntrances.some(row=>Number(row.id)===id),clock.id);entry=await page.evaluate(id=>window.loadedWidgetEntrances.find(row=>Number(row.id)===id),clock.id);assert.equal(entry.loaded,true);assert.equal(entry.opacity,0);
  }finally{release();await context.close();}
});
