// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const harness=require('../helpers/harness');const {launchBrowser,browserTest}=require('./helpers/browser');
let c,browser,group;const password='a-long-enough-password';
before(async()=>{
  c=await harness.start();browser=await launchBrowser();
  await c.makeUser({email:'interface-admin@example.test',password,role:'admin'});
  group=await c.makeGroup({name:'Team resources'});
  await c.makeFileLink({name:'Team handbook',fileName:'handbook.md',type:'text/markdown',bytes:Buffer.from('# Team handbook\n\nA useful shared document.'),groups:[group.id]});
});
after(async()=>{await browser?.close();await harness.stop();});
const btest=browserTest(test,()=>browser);
async function fresh(width=390){const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width,height:844},hasTouch:width<600,isMobile:width<600});const page=await context.newPage();page.setDefaultTimeout(10000);return page;}
async function admin(page){await page.goto('/login/');await page.fill('#signInEmail','interface-admin@example.test');await page.fill('#signInPassword',password);await Promise.all([page.waitForURL('**/admin/**'),page.click('#signInBtn')]);await page.locator('#adminWrap').waitFor();}
for(const width of [1280,390]){
  btest(`search keeps its accessible name and gives the input its full space at ${width}px`,async()=>{
    const page=await fresh(width);try{
      await page.goto('/g/'+group.slug);await page.locator('.link-card').waitFor();await page.click('#globalSearchBtn');
      const search=page.getByRole('searchbox',{name:'Search everywhere'});await search.fill('handbook');await page.getByRole('option',{name:/Team handbook/}).waitFor();
      const label=await page.locator('label[for=globalSearchInput]').boundingBox(),input=await search.boundingBox(),dialog=await page.locator('#globalSearchDialog').boundingBox();
      assert.ok(label.width<=1&&label.height<=1,'the assistive label does not take space in the header');assert.ok(input.width>dialog.width*.6,'search receives most of the header width');
      assert.equal(await page.getByRole('dialog',{name:'Search all resources'}).count(),1);
      assert.equal(await page.locator('.ws-result-icon svg').count(),1,'the fallback uses the shared line icon');
      const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('option',{name:/Team handbook/}).click()]);await popup.close();
    }finally{await page.context().close();}
  });
}
btest('the phone document composer is bounded, has reachable actions, and creates Markdown',async()=>{
  const page=await fresh();try{
    await admin(page);await page.evaluate(()=>document.getElementById('openAddLinkBtn').click());
    await page.locator('.link-mode-tab[data-mode=link]').focus();await page.keyboard.press('End');
    assert.equal(await page.locator('.link-mode-tab[data-mode=text]').getAttribute('aria-selected'),'true');
    await page.fill('#inputName','A document from the phone');await page.fill('#inputTextFilename','phone.md');await page.fill('#inputTextContent','# Created on a phone\n\nThe controls remain usable.');
    const modal=await page.locator('#linkModalOverlay .modal').boundingBox(),filename=await page.locator('#inputTextFilename').boundingBox();
    assert.ok(modal.y>=0&&modal.y+modal.height<=844);assert.ok(filename.height>=40);
    const submit=page.locator('#linkForm button[type=submit]');await submit.scrollIntoViewIfNeeded();const button=await submit.boundingBox();assert.ok(button.y>=0&&button.y+button.height<=844);
    await submit.click();await page.locator('#linkModalOverlay').waitFor({state:'hidden'});
    const saved=(await c.api('/api/links')).body.find(link=>link.name==='A document from the phone');assert.equal(saved.file_name,'phone.md');assert.match((await c.api(`/api/links/${saved.id}/file`)).body.content,/Created on a phone/);
  }finally{await page.context().close();}
});
btest('Appearance keeps time controls aligned and mobile inputs do not require focus zoom',async()=>{
  const page=await fresh();try{
    await page.goto('/');await page.evaluate(()=>window.LinkPageTheme.openPreferences());
    const start=await page.locator('.lp-dialog [name=start]').boundingBox(),end=await page.locator('.lp-dialog [name=end]').boundingBox();
    assert.ok(Math.abs(start.y-end.y)<1&&Math.abs(start.width-end.width)<1,'day/night fields share a row');
    assert.equal(await page.locator('.lp-dialog [name=start]').evaluate(el=>getComputedStyle(el).fontSize),'16px');
    await page.selectOption('.lp-dialog [name=motion]','smooth');await page.selectOption('.lp-dialog [name=ambient]','orbital');await page.selectOption('.lp-dialog [name=blend]','particles');await page.locator('.lp-dialog button[type=submit]').click();
    assert.equal(await page.locator('html').getAttribute('data-motion'),'smooth');assert.equal(await page.locator('html').getAttribute('data-ambient'),'orbital');assert.equal(await page.locator('html').getAttribute('data-ambient-blend'),'particles');
  }finally{await page.context().close();}
});
btest('mobile settings and Workspace keep selected controls identifiable and usable',async()=>{
  const page=await fresh();try{
    await admin(page);await page.evaluate(()=>document.getElementById('openSettingsBtn').click());await page.selectOption('#settingsCategorySelect','themes');
    assert.equal(await page.locator('#settingsNav [data-tab=themes]').getAttribute('aria-current'),'page');
    const toggle=page.locator('.settings-row:has(#accentDarkAdjustToggle)');const text=await toggle.locator('div').first().boundingBox(),control=await toggle.locator('.switch').boundingBox();assert.ok(control.x>=text.x+text.width,'a switch stays beside its description');
    await page.selectOption('#settingsCategorySelect','users');await page.locator('.user-row').first().waitFor();
    assert.ok((await page.locator('.user-row-main').first().boundingBox()).height<160,'a stacked account row does not retain the desktop flex basis as empty vertical space');
    assert.ok((await page.locator('#inviteLabelInput').boundingBox()).width>250,'the invite label has room for a full name');
    await page.keyboard.press('Escape');await page.evaluate(()=>document.getElementById('workspaceBtn').click());
    assert.equal(await page.getByRole('dialog',{name:'Workspace',exact:true}).count(),1);
    for(const button of await page.locator('.ws-tabs button').all())assert.ok((await button.boundingBox()).height>=40,'workspace tabs have touch targets');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }finally{await page.context().close();}
});
for(const width of [1280,390])btest(`theme selectors fit their selected labels and the default picker stays visible at ${width}px`,async()=>{
  const page=await fresh(width);try{
    await admin(page);await page.evaluate(()=>document.getElementById('openSettingsBtn').click());await page.locator('#settingsOverlay').waitFor({state:'visible'});if(width<640)await page.selectOption('#settingsCategorySelect','themes');else await page.click('#settingsNav [data-tab=themes]');
    const widths=await page.locator('[data-panel=themes] .settings-row>select').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));assert.ok(widths.every(value=>Math.abs(value-widths[0])<1));
    for(const value of ['daylight','light','dark','system']){
      await page.selectOption('#defaultThemeSelect',value);await page.waitForFunction(()=>!document.getElementById('defaultThemeSelect').disabled);assert.equal((await c.api('/api/settings')).body.default_theme,value);
    }
    await page.selectOption('#defaultThemeSelect','daylight');await page.waitForFunction(()=>!document.getElementById('defaultThemeSelect').disabled);await page.locator('#defaultThemeSelect').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#defaultThemeSelect').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'selected text fits inside the control');
    await page.click('#defaultThemeSelect');await page.waitForFunction(()=>document.getElementById('defaultThemeSelect').matches(':open'));await page.waitForFunction(()=>getComputedStyle(document.getElementById('defaultThemeSelect'),'::picker(select)').opacity==='1');await page.keyboard.press('Escape');assert.equal(await page.locator('#settingsOverlay').isVisible(),true);
  }finally{await page.context().close();}
});
