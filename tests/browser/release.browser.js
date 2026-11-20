// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Portable release checks. Firefox narrow viewports do not emulate an iPhone. */
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const harness=require('../helpers/harness');const {launchBrowser,browserTest}=require('./helpers/browser');
let c,browser,group,note;const password='release-browser-password',report={engine:process.env.LINKPAGE_BROWSER||'chromium',checks:[]};
before(async()=>{c=await harness.start();browser=await launchBrowser();if(!browser)return;report.version=browser.version();await c.makeUser({email:'release-admin@example.test',password,role:'admin'});group=await c.makeGroup({name:'Release resources'});await c.makeFileLink({name:'Release handbook',fileName:'release.md',bytes:Buffer.from('# Release handbook\n\nA persistent Markdown document.'),groups:[group.id],slug:'release-handbook'});note=(await c.api('/api/workspace/widgets',{method:'POST',json:{kind:'note',title:'Release checklist',group_id:group.id,config:{format:'markdown',text:'## Ready\n- [ ] Review release'}}})).body;});
after(async()=>{await browser?.close();await harness.stop();fs.mkdirSync('.cache',{recursive:true});fs.writeFileSync('.cache/browser-'+report.engine+'-release.json',JSON.stringify(report,null,2));});const btest=browserTest(test,()=>browser);
async function fresh(width){const firefox=report.engine==='firefox',context=await browser.newContext({baseURL:c.baseUrl,viewport:{width,height:900},...(firefox?{}:{isMobile:width<600,hasTouch:width<600})}),page=await context.newPage();page.setDefaultTimeout(12000);return page;}
async function login(page){await page.goto('/login/');await page.fill('#signInEmail','release-admin@example.test');await page.fill('#signInPassword',password);await Promise.all([page.waitForURL('**/admin/**'),page.click('#signInBtn')]);await page.locator('#adminWrap').waitFor();}
btest('replacing theme transitions preserves the final theme without browser errors',async()=>{
  const page=await fresh(1280),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto('/g/'+group.slug);await page.locator('.link-card[data-link-id]').waitFor();
    await page.evaluate(async()=>{
      const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      for(const theme of ['dark','light','dark','light','dark','light']){
        window.applyTheme(theme);
        for(let frame=0;frame<60&&document.documentElement.dataset.theme!==theme;frame++)await nextFrame();
        if(document.documentElement.dataset.theme!==theme)throw new Error('Theme update did not commit');
      }
      for(let frame=0;frame<60&&document.documentElement.classList.contains('theme-view-transition');frame++)await nextFrame();
    });
    assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
    assert.equal(await page.locator('html').evaluate(element=>element.classList.contains('theme-view-transition')),false);
    assert.deepEqual(errors,[]);report.checks.push({name:'interrupted theme transitions',width:1280});
  }finally{await page.context().close();}
});
for(const width of [1280,390]){
  btest(`release public navigation, search, Markdown and PWA at ${width}px`,async()=>{
    const page=await fresh(width),errors=[];page.on('pageerror',error=>errors.push(error.message));try{
      await page.goto('/g/'+group.slug);await page.locator('.link-card[data-link-id]').waitFor();await page.getByRole('heading',{name:'Release checklist',exact:true}).waitFor();await page.keyboard.press('Control+k');await page.fill('#globalSearchInput','Release handbook');await page.locator('#globalSearchResults a').first().waitFor();assert.equal(await page.locator('#globalSearchResults a').first().getAttribute('target'),'_blank');await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.goto('/f/release-handbook');await page.getByRole('heading',{name:'Release handbook',exact:true}).waitFor();assert.equal(await page.locator('script').count(),0);const manifest=await page.request.get('/manifest.webmanifest');assert.equal((await manifest.json()).display,'standalone');assert.equal((await page.request.get('/sw.js')).status(),200);assert.deepEqual(errors,[]);report.checks.push({name:'public, search, Markdown and PWA',width});
    }finally{await page.context().close();}
  });
  btest(`release admin settings, widgets and analytics at ${width}px`,async()=>{
    const page=await fresh(width),errors=[];page.on('pageerror',error=>errors.push(error.message));try{
      await login(page);if(width<640){await page.click('#mobileMoreBtn');await page.screenshot({path:'.cache/release-mobile-menu-'+report.engine+'.png'});await page.click('.lp-admin-menu [data-forward="openSettingsBtn"]');}else await page.click('#openSettingsBtn');await page.locator('#settingsOverlay').waitFor({state:'visible'});if(width<640)await page.selectOption('#settingsCategorySelect','themes');else await page.click('#settingsNav [data-tab=themes]');await page.selectOption('#defaultThemeSelect','daylight');await page.waitForFunction(()=>!document.getElementById('defaultThemeSelect').disabled);assert.equal(await page.locator('#defaultThemeSelect').inputValue(),'daylight');await page.selectOption('#ambientBackgroundSelect','custom');await page.waitForFunction(()=>document.documentElement.dataset.ambient==='custom');await page.locator('#ambientEffectsEditor details').evaluate(el=>el.open=true);await page.selectOption('#ambientEffectsEditor select[data-ambient-effect]','drift');await page.locator('#ambientEffectsEditor [data-ambient-speed]').fill('1.5');await page.click('#ambientEffectsEditor [data-save-ambient]');await page.locator('#ambientEffectsEditor [role=status]').filter({hasText:'saved'}).waitFor();await page.keyboard.press('Escape');
      await page.click('#workspaceBtn');const size=await page.locator('#workspaceDialog').boundingBox();await page.click('#workspaceDialog [data-tab=widgets]');await page.locator('#lpWidgetForm').waitFor();const changed=await page.locator('#workspaceDialog').boundingBox();assert.ok(Math.abs(size.height-changed.height)<1);await page.keyboard.press('Escape');
      if(width<640){await page.click('#mobileMoreBtn');await page.click('.lp-admin-menu [data-forward="openAnalyticsBtn"]');}else await page.click('#openAnalyticsBtn');await page.locator('.analytics-line-chart').waitFor();assert.equal(await page.locator('.analytics-heat-row i').count(),168);await page.selectOption('#analyticsGroup',String(group.id));await page.locator('.analytics-scope').filter({hasText:group.name}).waitFor();await page.keyboard.press('Escape');
      await page.goto('/g/'+group.slug);const card=page.locator(`[data-widget="${note.id}"]`);await card.getByRole('checkbox',{name:'Review release'}).waitFor();assert.equal(await card.getAttribute('draggable'),'true');const handle=card.locator('[data-resize-widget]');await handle.scrollIntoViewIfNeeded();const bounds=await handle.boundingBox(),saved=page.waitForResponse(response=>response.request().method()==='PUT'&&response.url().endsWith('/widgets/'+note.id));await page.mouse.move(bounds.x+12,bounds.y+12);await page.mouse.down();await page.locator('.lp-widget-size-preview').waitFor();await page.mouse.move(bounds.x+12,bounds.y+60,{steps:6});await page.mouse.up();assert.equal((await saved).status(),200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);report.checks.push({name:'settings, widget resize, workspace and analytics',width});
    }finally{await page.context().close();}
  });
}
