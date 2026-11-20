// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const harness=require('../helpers/harness');const {launchBrowser,browserTest}=require('./helpers/browser');
let c,browser,group;const password='analytics-browser-password';
before(async()=>{
  c=await harness.start();browser=await launchBrowser();await c.makeUser({email:'analytics-admin@example.test',password,role:'admin'});group=await c.makeGroup({name:'Engineering analytics'});
  const used=await c.makeLink({name:'Engineering handbook',groups:[group.id]}),other=await c.makeLink({name:'Operations console'});await c.makeLink({name:'Unused resource',groups:[group.id]});
  const {db}=require('../../src/config/db'),insert=db.prepare('INSERT INTO link_clicks(link_id,ip_address,user_agent,clicked_at) VALUES(?,?,?,?)');
  for(let day=0;day<10;day++)for(let count=0;count<day%4+1;count++)insert.run(used.id,'203.0.113.'+(day%3+1),day%2?'Mozilla/5.0 (iPhone) Mobile Safari/605':'Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537',new Date(Date.now()-day*86400000).toISOString().slice(0,19).replace('T',' '));
  insert.run(used.id,'203.0.113.99','ExampleCrawler/1.0',new Date().toISOString().slice(0,19).replace('T',' '));insert.run(other.id,'203.0.113.4','Mozilla/5.0 Firefox/120',new Date().toISOString().slice(0,19).replace('T',' '));
});
after(async()=>{await browser?.close();await harness.stop();});const btest=browserTest(test,()=>browser);
for(const width of [1280,390])btest(`analytics filters, comparison, charts and CSV work without overflow at ${width}px`,async()=>{
  const context=await browser.newContext({baseURL:c.baseUrl,viewport:{width,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  try{
    await page.goto('/login/');await page.fill('#signInEmail','analytics-admin@example.test');await page.fill('#signInPassword',password);await Promise.all([page.waitForURL('**/admin/**'),page.click('#signInBtn')]);await page.evaluate(()=>document.getElementById('openAnalyticsBtn').click());await page.getByRole('heading',{name:'Click activity',exact:true}).waitFor();
    assert.equal(await page.locator('.analytics-totals .stat-box').count(),4);assert.equal(await page.locator('.analytics-heat-row i').count(),168);assert.equal(await page.locator('.analytics-chart-previous').count(),1);
    await Promise.all([page.waitForResponse(response=>response.url().includes('/api/analytics?')&&new URL(response.url()).searchParams.get('group_id')===String(group.id)),page.selectOption('#analyticsGroup',String(group.id))]);await page.locator('.analytics-scope').filter({hasText:'Engineering analytics'}).waitFor();await page.locator('#analyticsCards .analytics-quiet-links').getByText('Unused resource',{exact:true}).waitFor();
    await page.check('#analyticsExcludeBots');await page.locator('.analytics-scope').filter({hasText:'automation excluded'}).waitFor();await page.selectOption('#analyticsPeriod','7d');await page.locator('.analytics-scope').filter({hasText:'Last 7 days'}).waitFor();
    await page.locator('.analytics-chart-data summary').click();assert.ok(await page.locator('.analytics-chart-data tbody tr').count()>=7);await page.locator('.analytics-chart-data summary').click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.click('#analyticsExportBtn')]);assert.match(download.suggestedFilename(),/analytics-7d\.csv/);
    await page.evaluate(()=>{window.analyticsChart=document.querySelector('.analytics-line-chart');});await page.click('#analyticsRefreshBtn');await page.waitForFunction(()=>document.getElementById('analyticsStatus').textContent.startsWith('Updated'));assert.equal(await page.evaluate(()=>window.analyticsChart===document.querySelector('.analytics-line-chart')),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const bounds=await page.locator('.analytics-modal').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=900);await page.screenshot({path:`.cache/analytics-${width}.png`});assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
