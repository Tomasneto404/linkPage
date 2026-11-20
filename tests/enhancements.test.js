// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const harness=require('./helpers/harness');
let c,source,base,group,privateGroup,user,session,gotifyRequests=0;
const token='test-gotify-client-secret';
before(async()=>{
  c=await harness.start();group=await c.makeGroup({name:'Engenharia e produto'});privateGroup=await c.makeGroup({name:'Private updates'});
  user=await c.makeUser({email:'widget-member@example.test'});session=c.session();await session.login(user.email,user.password);
  await c.api(`/api/workspace/groups/${privateGroup.id}`,{method:'PUT',json:{is_private:true,access:[{user_id:user.id,role:'viewer'}]}});
  source=http.createServer((req,res)=>{
    if(req.url.startsWith('/message')){assert.equal(req.headers['x-gotify-key'],token);gotifyRequests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({messages:[{id:1,title:'Build complete',message:'Ready for review',priority:5,date:'2026-11-17T12:00:00Z'}]}));return;}
    if(req.url==='/feed'){res.setHeader('Content-Type','application/rss+xml');res.end('<rss version="2.0"><channel><title>Team</title><item><title>New release</title><link>https://example.test/release</link><description><![CDATA[<b>Ready</b> for everyone]]></description></item><item><title>Unsafe</title><link>javascript:alert(1)</link></item></channel></rss>');return;}
    if(req.url==='/head-blocked'){res.statusCode=req.method==='HEAD'?405:200;res.end();return;}
    if(req.url==='/auth'){res.statusCode=401;res.end();return;}
    if(req.url==='/limited'){res.statusCode=429;res.end();return;}
    if(req.url==='/temporary'){res.statusCode=503;res.end();return;}
    res.statusCode=404;res.end();
  });
  await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+source.address().port;
});
after(async()=>{if(source)await new Promise(resolve=>source.close(resolve));await harness.stop();});
const post=(url,json)=>c.api(url,{method:'POST',json});
test('group slugs are readable, unique and stable after a rename',async()=>{
  assert.equal(group.slug,'engenharia-e-produto');
  const duplicate=await c.makeGroup({name:'Engenharia e produto'});assert.notEqual(duplicate.slug,group.slug);
  await c.api(`/api/groups/${group.id}`,{method:'PUT',json:{name:'A new name',color:'#0071e3'}});
  assert.equal((await c.api('/api/groups')).body.find(g=>g.id===group.id).slug,group.slug);
  const page=await c.pub('/g/'+group.slug);assert.equal(page.status,200);assert.match(page.text,/href="\/style.css"/);
});
test('QR codes are generated as SVG and unsafe or excessive URLs are refused',async()=>{
  const qr=await c.pub('/api/share/qr?url='+encodeURIComponent('https://example.test/g/team?section=42'));
  assert.equal(qr.status,200);assert.match(qr.headers.get('content-type'),/image\/svg\+xml/);assert.match(qr.text,/<svg/);assert.match(qr.text,/<path/);
  for(const value of ['javascript:alert(1)','https://user:password@example.test','https://example.test/'+ 'a'.repeat(2100)])assert.equal((await c.pub('/api/share/qr?url='+encodeURIComponent(value))).status,400);
});
test('health checks fall back to GET, recognise authentication and rate limiting, and confirm missing pages',async()=>{
  for(const [path,status]of [['/head-blocked','healthy'],['/auth','restricted'],['/limited','unknown'],['/temporary','unknown']]){
    const link=await c.makeLink({url:base+path});const result=await post(`/api/links/${link.id}/health`,{});assert.equal(result.status,200,result.text);assert.equal(result.body.status,status);assert.equal(result.body.broken,false);
  }
  const missing=await c.makeLink({url:base+'/missing'});
  assert.equal((await post(`/api/links/${missing.id}/health`,{})).body.broken,false);
  assert.equal((await post(`/api/links/${missing.id}/health`,{})).body.broken,true);
  assert.equal((await post(`/api/links/${missing.id}/health`,{enabled:false})).body.status,'disabled');
  assert.equal((await c.api('/api/links')).body.find(l=>l.id===missing.id).is_broken,0);
  assert.equal((await c.pub(`/api/links/${missing.id}/health`,{method:'POST',json:{}})).status,401);
});
test('RSS and Gotify widgets enforce group access, redact secrets and cache source requests',async()=>{
  const rss=await post('/api/workspace/widgets',{kind:'rss',title:'Team news',group_id:group.id,config:{url:base+'/feed',allow_private:true}});assert.equal(rss.status,201,rss.text);
  const result=await c.pub(`/api/widgets/${rss.body.id}/data`);assert.equal(result.status,200);assert.equal(result.body.data.items.length,1);assert.equal(result.body.data.items[0].description,'Ready for everyone');
  const gotify=await post('/api/workspace/widgets',{kind:'gotify',title:'Private alerts',group_id:privateGroup.id,config:{url:base,token,allow_private:true}});assert.equal(gotify.status,201,gotify.text);
  assert.doesNotMatch(gotify.text,new RegExp(token));assert.equal(gotify.body.has_secret,true);
  assert.equal((await c.pub('/api/widgets')).body.some(w=>w.id===gotify.body.id),false);
  assert.equal((await c.pub(`/api/widgets/${gotify.body.id}/data`)).status,404);
  const data=await session.fetch(`/api/widgets/${gotify.body.id}/data`);assert.equal(data.body.data.messages[0].title,'Build complete');assert.doesNotMatch(data.text,new RegExp(token));
  await session.fetch(`/api/widgets/${gotify.body.id}/data`);assert.equal(gotifyRequests,1,'source response is cached, without bypassing group access');
  const edited=await c.api(`/api/workspace/widgets/${gotify.body.id}`,{method:'PUT',json:{title:'Renamed alerts',config:{url:base,allow_private:true}}});assert.equal(edited.status,200);assert.equal(edited.body.has_secret,true);
  assert.equal((await c.pub('/api/workspace/widgets')).status,401);
});
test('feed parsing excludes unsafe URLs and declarations; weather uses the configured coordinates',async()=>{
  const widgets=require('../src/services/widgetService');
  assert.throws(()=>widgets.rss('<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>','https://example.test'),/declarations/);
  const atom=widgets.rss('<feed><entry><title>Update</title><link rel="self" href="https://example.test/self"/><link rel="alternate" href="/read"/></entry></feed>','https://example.test/feed');assert.equal(atom.items[0].url,'https://example.test/read');
  const weather=await widgets.load({kind:'weather',config:{latitude:38.72,longitude:-9.13,location:'Lisbon',fahrenheit:false}},{fetcher:async address=>{const url=new URL(address);assert.equal(url.searchParams.get('latitude'),'38.72');return new Response(JSON.stringify({current:{temperature_2m:18.5,weather_code:0,is_day:1,time:'2026-11-17T12:00'}}),{headers:{'Content-Type':'application/json'}});}});
  assert.equal(weather.temperature,18.5);assert.equal(weather.location,'Lisbon');
  assert.equal((await post('/api/workspace/widgets',{kind:'weather',title:'Invalid',config:{latitude:200,longitude:0}})).status,400);
});
test('recent queries belong to each account and clearing them leaves other accounts untouched',async()=>{
  const other=await c.makeUser({email:'another-searcher@example.test'}),s=c.session();await s.login(other.email,other.password);
  assert.equal((await c.pub('/api/workspace/search/recent')).status,401);
  await session.fetch('/api/workspace/search/recent',{method:'POST',json:{query:'My private words'}});
  assert.deepEqual((await s.fetch('/api/workspace/search/recent')).body,[]);
  await s.fetch('/api/workspace/search/recent',{method:'DELETE'});
  assert.equal((await session.fetch('/api/workspace/search/recent')).body[0].query,'My private words');
});
test('failed logical imports roll back data and identity sequences',async()=>{
  const {db}=require('../src/config/db'),snapshots=require('../src/services/databaseSnapshot');
  const before=snapshots.capture(db),broken=structuredClone(before);broken.tables.groups.push({...broken.tables.groups[0]});
  assert.throws(()=>snapshots.restore(db,broken));
  assert.deepEqual(snapshots.capture(db).tables.groups,before.tables.groups);
  const next=await c.makeGroup({name:'After rollback'});assert.ok(next.id>Math.max(...before.tables.groups.map(g=>g.id)));
  assert.throws(()=>snapshots.restore(db,before,{emptyOnly:true}),/empty/);
});
test('managed document reads use editing permissions and never disclose another group’s text',async()=>{
  const own=await c.makeFileLink({fileName:'owned.md',bytes:Buffer.from('# Saved source'),groups:[group.id]});
  const elsewhere=await c.makeFileLink({fileName:'elsewhere.md',bytes:Buffer.from('# Other source'),groups:[privateGroup.id]});
  assert.equal((await session.fetch(`/api/managed/links/${own.id}/file`)).status,404);
  await c.api(`/api/groups/${group.id}/managers`,{method:'PUT',json:{user_ids:[user.id]}});
  const read=await session.fetch(`/api/managed/links/${own.id}/file`);assert.equal(read.status,200,read.text);assert.equal(read.body.content,'# Saved source');
  assert.equal((await session.fetch(`/api/managed/links/${elsewhere.id}/file`)).status,404);
  assert.equal((await c.pub(`/api/managed/links/${own.id}/file`)).status,401);
  const mixed=await c.makeFileLink({fileName:'mixed.md',bytes:Buffer.from('# Both groups'),groups:[group.id,privateGroup.id]});
  assert.equal((await session.fetch(`/api/managed/links/${mixed.id}/file`)).status,403);
});
test('animated background and motion preferences are validated, portable, present before first paint and applied to Markdown',async()=>{
  for(const ambient of ['off','aurora','mesh','waves','starlight','orbital','prism'])assert.equal((await post('/api/settings/theme',{ambient_background:ambient,motion_style:'smooth'})).status,200);
  assert.equal((await post('/api/settings/theme',{ambient_background:'unknown'})).status,400);
  const appearance=require('../src/services/appearanceService');const preset=appearance.pack();assert.equal(preset.settings.ambient_background,'prism');assert.equal(preset.settings.motion_style,'smooth');
  assert.equal(appearance.unpack(preset).motion_style,'smooth');
  const page=await c.pub('/');assert.match(page.text,/<script id="linkpageAppearanceBoot" type="application\/json">/);assert.match(page.text,/"ambient_background":"prism"/);assert.doesNotMatch(page.text,new RegExp(token));
  const file=await c.makeFileLink({fileName:'appearance.md',bytes:Buffer.from('# Ambient page'),slug:'appearance-test'});
  const markdown=await c.pub('/f/appearance-test?ambient=aurora&motion=off');assert.equal(markdown.status,200);assert.match(markdown.text,/data-ambient="aurora"[^>]*data-motion="off"/);assert.match(markdown.text,/class="ambient-scene"/);assert.doesNotMatch(markdown.text,/<script/);
  await post('/api/settings/theme',{ambient_background:'off',motion_style:'subtle'});
});
test('guest Markdown raw text is owner-only and remains editable without rendered HTML',async()=>{
  await c.api('/api/settings/contributions',{method:'PUT',json:{mode:'anyone'}});
  const guest=c.session(),other=c.session();const form=new FormData();form.append('name','Guest document');form.append('file',new Blob(['# Original guest Markdown\n\nKeep the source.'],{type:'text/markdown'}),'guest.md');
  const saved=await guest.fetch('/api/guest/links',{method:'POST',form});assert.equal(saved.status,201,saved.text);
  const raw=await guest.fetch(`/api/guest/links/${saved.body.id}/file?raw=1`);assert.equal(raw.status,200);assert.equal(raw.text,'# Original guest Markdown\n\nKeep the source.');
  assert.equal((await other.fetch(`/api/guest/links/${saved.body.id}/file?raw=1`)).status,404);
  await c.api('/api/settings/contributions',{method:'PUT',json:{mode:'off'}});
});
test('season and custom background composition is explicit and also applies to script-free documents',async()=>{
  await post('/api/settings/season',{name:'christmas',effects:true,background:'static'});
  await post('/api/settings/theme',{ambient_background:'orbital',ambient_blend:'separate'});
  const separate=await c.pub('/f/appearance-test');assert.match(separate.text,/data-ambient-blend="separate"/);assert.doesNotMatch(separate.text,/id="seasonEffects"/);
  const combined=await c.pub('/f/appearance-test?blend=season');assert.match(combined.text,/id="seasonEffects"/);assert.match(combined.text,/scene3d-world/);assert.doesNotMatch(combined.text,/<script/);
  const particlesOnly=await c.pub('/f/appearance-test?blend=particles');assert.match(particlesOnly.text,/data-ambient-blend="particles"/);assert.match(particlesOnly.text,/id="seasonEffects"/);assert.match(particlesOnly.text,/name="blend" value="particles"/);
  assert.equal((await post('/api/settings/theme',{ambient_blend:'particles'})).status,200);
  await post('/api/settings/theme',{ambient_blend:'season'});
  assert.equal((await c.pub('/api/settings')).body.ambient_blend,'season');assert.equal(require('../src/services/appearanceService').pack().settings.ambient_blend,'season');
  assert.equal((await post('/api/settings/theme',{ambient_blend:'invalid'})).status,400);
  await post('/api/settings/season',{name:'none'});await post('/api/settings/theme',{ambient_background:'off',ambient_blend:'separate'});
});
