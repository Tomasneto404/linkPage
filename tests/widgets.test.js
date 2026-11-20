// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const harness=require('./helpers/harness');
let c,service,server,base,team,other,manager,viewer,managerSession,viewerSession;
const rss='<rss><channel><title>News</title><item><title>Security update</title><link>https://example.test/update</link><pubDate>Wed, 18 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[<img src="https://example.test/image.jpg"><b>Details</b>]]></description></item><item><title>Other news</title><link>https://example.test/other</link><enclosure type="image/jpeg" url="javascript:alert(1)"/></item></channel></rss>';
const post=(path,json,session)=>session?session.fetch(path,{method:'POST',json}):c.api(path,{method:'POST',json});
before(async()=>{
  c=await harness.start();service=require('../src/services/widgetService');
  team=await c.makeGroup({name:'Widget team'});other=await c.makeGroup({name:'Restricted widget team'});
  manager=await c.makeUser({email:'widget-manager@example.test'});viewer=await c.makeUser({email:'widget-viewer@example.test'});
  managerSession=c.session();viewerSession=c.session();await managerSession.login(manager.email,manager.password);await viewerSession.login(viewer.email,viewer.password);
  await c.api(`/api/groups/${team.id}/managers`,{method:'PUT',json:{user_ids:[manager.id]}});
  await c.api(`/api/workspace/groups/${other.id}`,{method:'PUT',json:{is_private:true,access:[]}});
  server=http.createServer((req,res)=>{if(req.url.startsWith('/message')){assert.equal(req.headers['x-gotify-key'],'server-secret');res.end(JSON.stringify({messages:[{id:99,title:'Urgent',message:'Act now',priority:8,date:'2026-11-18T12:00:00Z'},{id:98,title:'Routine',priority:1}]}));}else res.end(rss);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));await harness.stop();});
test('managers can configure their groups, while global and multi-owner widgets remain restricted',async()=>{
  const created=await post('/api/workspace/widgets',{kind:'clock',title:'Team clock',group_id:team.id,layout:{device:'desktop'},config:{mode:'analog',seconds:false,zones:[{timezone:'Asia/Tokyo',label:'Tokyo'}]}},managerSession);
  assert.equal(created.status,201,created.text);assert.deepEqual(created.body.layout,{width:1,height:'auto',device:'desktop',group_ids:[team.id]});
  const changed=await managerSession.fetch('/api/workspace/widgets/'+created.body.id,{method:'PUT',json:{title:'Updated team clock'}});assert.equal(changed.status,200);assert.deepEqual(changed.body.layout.group_ids,[team.id]);assert.notEqual(changed.body.revision,created.body.revision);
  assert.equal((await post('/api/workspace/widgets',{kind:'clock',title:'Global'},managerSession)).status,403);
  assert.equal((await post('/api/workspace/widgets',{kind:'clock',title:'Foreign',layout:{group_ids:[team.id,other.id]}},managerSession)).status,403);
  assert.equal((await post('/api/workspace/widgets',{kind:'note',title:'Viewer attempt',group_id:team.id},viewerSession)).status,403);
  assert.equal((await managerSession.fetch('/api/widgets/manage')).body.admin,false);
  assert.equal((await viewerSession.fetch('/api/widgets/manage')).status,403);
  for(const layout of [{width:4},{height:'huge'},{device:'tablet'},{group_ids:[999999]}])assert.equal((await c.api('/api/workspace/widgets/'+created.body.id,{method:'PUT',json:{layout}})).status,400);
});
test('shared widget metadata reveals no inaccessible group IDs or source credentials',async()=>{
  const row=(await post('/api/workspace/widgets',{kind:'rss',title:'Shared feed',layout:{group_ids:[team.id,other.id]},config:{url:base,allow_private:true}})).body;
  const publicRows=(await c.pub('/api/widgets')).body,publicRow=publicRows.find(item=>item.id===row.id);
  assert.deepEqual(publicRow.layout.group_ids,[team.id]);assert.equal(publicRow.group_id,null);assert.equal(publicRow.can_manage,false);assert.equal(publicRow.options.url,undefined);assert.equal(publicRow.options.allow_private,undefined);
  assert.equal((await managerSession.fetch('/api/workspace/widgets/'+row.id,{method:'PUT',json:{title:'Hijacked'}})).status,404);
  assert.equal((await post('/api/workspace/widgets',{kind:'rss',title:'Intranet',group_id:team.id,config:{url:base,allow_private:true}},managerSession)).status,403);
});
test('duplicate, hide and reorder retain saved secrets and enforce ownership',async()=>{
  const first=(await post('/api/workspace/widgets',{kind:'gotify',title:'Alerts',group_id:team.id,config:{url:base,token:'server-secret',allow_private:true,min_priority:5}})).body;
  assert.equal(first.has_secret,true);assert.equal(first.config.token,undefined);
  const copy=await post('/api/workspace/widgets/'+first.id+'/duplicate',{},managerSession);assert.equal(copy.status,201,copy.text);assert.equal(copy.body.has_secret,true);assert.equal(copy.body.config.token,undefined);
  const changed=await managerSession.fetch('/api/workspace/widgets/'+copy.body.id,{method:'PUT',json:{title:'Copy',config:{token:''}}});assert.equal(changed.status,200);assert.equal(changed.body.has_secret,true);
  const data=await c.pub('/api/widgets/'+copy.body.id+'/data');assert.equal(data.body.data.messages.length,1);assert.equal(data.body.data.messages[0].id,'99');assert.doesNotMatch(data.text,/server-secret/);
  assert.equal((await post('/api/workspace/widgets/reorder',{order:[copy.body.id,first.id]},managerSession)).status,401);
  assert.equal((await post('/api/workspace/widgets/reorder',{order:[copy.body.id,first.id]})).status,200);
  const all=(await c.api('/api/workspace/widgets')).body;assert.ok(all.findIndex(row=>row.id===copy.body.id)<all.findIndex(row=>row.id===first.id));
  assert.equal((await post('/api/workspace/widgets/reorder',{order:[first.id,first.id]})).status,400);
  const foreign=(await post('/api/workspace/widgets',{kind:'note',title:'Global note',config:{text:'Hi'}})).body;
  assert.equal((await post('/api/workspace/widgets/reorder',{order:[first.id,foreign.id]},managerSession)).status,401);
  assert.equal((await managerSession.fetch('/api/workspace/widgets/'+copy.body.id,{method:'PUT',json:{enabled:false}})).status,200);
  assert.equal((await c.pub('/api/widgets')).body.some(row=>row.id===copy.body.id),false);
});
test('notification read state is private to each account and validates message IDs',async()=>{
  const row=(await c.api('/api/workspace/widgets')).body.find(row=>row.kind==='gotify'&&row.enabled);
  assert.equal((await post('/api/widgets/'+row.id+'/read',{ids:['99']},managerSession)).status,200);
  assert.deepEqual((await managerSession.fetch('/api/widgets/'+row.id+'/data')).body.read,['99']);
  assert.deepEqual((await viewerSession.fetch('/api/widgets/'+row.id+'/data')).body.read,[]);
  assert.deepEqual((await c.pub('/api/widgets/'+row.id+'/data')).body.read,[]);
  assert.equal((await post('/api/widgets/'+row.id+'/read',{ids:['missing']},managerSession)).status,400);
  assert.equal((await c.pub('/api/widgets/'+row.id+'/read',{method:'POST',json:{ids:['99']}})).status,401);
});
test('Markdown notes escape HTML, support shared tasks and reject conflicting changes',async()=>{
  const text='## Checklist\n\n- [ ] Review docs\n- [x] Done\n\n```\n- [ ] Code sample\n```\n\n<script>alert(1)</script>\n[Unsafe](javascript:alert(1))\n![Tracking](https://example.test/track.png)';
  const row=(await post('/api/workspace/widgets',{kind:'note',title:'Tasks',group_id:team.id,config:{text,format:'markdown'}},managerSession)).body;
  const data=(await c.pub('/api/widgets/'+row.id+'/data')).body.data;
  assert.equal(data.tasks.length,2);assert.match(data.html,/<h2>Checklist/);assert.doesNotMatch(data.html,/<script|<img|href="javascript:/);assert.match(data.html,/data-task-line="2"/);
  assert.equal((await post('/api/workspace/widgets/'+row.id+'/task',{line:2,checked:true,text},viewerSession)).status,403);
  assert.equal((await post('/api/workspace/widgets/'+row.id+'/task',{line:2,checked:true,text},managerSession)).status,200);
  assert.equal((await post('/api/workspace/widgets/'+row.id+'/task',{line:2,checked:false,text},managerSession)).status,409);
  const updated=(await c.pub('/api/widgets/'+row.id+'/data')).body.data;assert.equal(updated.tasks[0].checked,true);
  assert.equal((await post('/api/workspace/widgets/'+row.id+'/task',{line:6,checked:true,text:updated.text},managerSession)).status,400);
  await managerSession.fetch('/api/workspace/widgets/'+row.id,{method:'PUT',json:{config:{text:''}}});assert.equal((await c.pub('/api/widgets/'+row.id+'/data')).body.data.text,'');
});
test('preview uses real configuration without saving or exposing saved credentials',async()=>{
  const count=(await c.api('/api/workspace/widgets')).body.length;
  const preview=await post('/api/workspace/widgets/preview',{kind:'note',title:'Preview',group_id:team.id,config:{text:'**Unsaved**',format:'markdown'}},managerSession);
  assert.equal(preview.status,200,preview.text);assert.match(preview.body.value.data.html,/<strong>Unsaved/);assert.equal((await c.api('/api/workspace/widgets')).body.length,count);
  assert.equal((await post('/api/workspace/widgets/preview',{kind:'clock',title:'Foreign',group_id:other.id},managerSession)).status,403);
});
test('RSS preserves dates and safe images, filters headlines and caps article counts',()=>{
  const parsed=service.rss(rss,'https://example.test',{filter:'SECURITY',limit:1});assert.equal(parsed.items.length,1);assert.equal(parsed.items[0].image,'https://example.test/image.jpg');assert.match(parsed.items[0].date,/2026/);assert.equal(parsed.items[0].description,'Details');
  assert.equal(service.rss(rss,'https://example.test').items[1].image,null);
  assert.deepEqual(service.rss('<rss><channel><title>Empty feed</title></channel></rss>','https://example.test').items,[]);
});
test('weather includes daily forecast, apparent temperature, rain and wind',async()=>{
  const result=await service.load({kind:'weather',config:{latitude:38,longitude:-9,days:5,location:'Lisbon'}},{fetcher:async address=>{
    const url=new URL(address);assert.equal(url.searchParams.get('forecast_days'),'5');assert.match(url.searchParams.get('current'),/apparent_temperature/);assert.match(url.searchParams.get('daily'),/precipitation_probability_max/);
    return new Response(JSON.stringify({current:{temperature_2m:18,apparent_temperature:17,relative_humidity_2m:60,wind_speed_10m:12,precipitation:0.5,weather_code:3,is_day:1},daily:{time:['2026-11-18'],temperature_2m_max:[20],temperature_2m_min:[12],weather_code:[3],precipitation_probability_max:[60]}}));
  }});assert.equal(result.feels_like,17);assert.equal(result.wind,12);assert.equal(result.precipitation,.5);assert.deepEqual(result.forecast[0],{date:'2026-11-18',code:3,high:20,low:12,rain:60});
});
test('failed refresh retains last good data and timestamp, with a bounded retry interval',async()=>{
  const row={id:990001,kind:'rss',config:{url:'https://example.test/feed',refresh_seconds:60}};let now=100000,calls=0;
  const fetcher=async()=>{calls++;if(calls>1)throw new Error('Offline');return new Response(rss);};
  const good=await service.data(row,{fetcher,now:()=>now});assert.equal(good.stale,false);
  now+=1000;assert.deepEqual(await service.data(row,{force:true,fetcher,now:()=>now}),good);assert.equal(calls,1);
  now+=10000;const stale=await service.data(row,{force:true,fetcher,now:()=>now});assert.equal(stale.stale,true);assert.equal(stale.updated_at,good.updated_at);assert.deepEqual(stale.data,good.data);
  await service.data(row,{fetcher,now:()=>now});assert.equal(calls,2);service.clear(row.id);
});
test('deleting a group preserves other assignments and never converts its widget to global',async()=>{
  const a=await c.makeGroup({name:'Delete widget group'}),b=await c.makeGroup({name:'Keep widget group'});
  const shared=(await post('/api/workspace/widgets',{kind:'clock',title:'Shared',layout:{group_ids:[a.id,b.id]}})).body;
  const single=(await post('/api/workspace/widgets',{kind:'clock',title:'Single',group_id:a.id})).body;
  assert.equal((await c.api('/api/groups/'+a.id,{method:'DELETE'})).status,204);
  const rows=(await c.api('/api/workspace/widgets')).body;assert.deepEqual(rows.find(row=>row.id===shared.id).layout.group_ids,[b.id]);assert.equal(rows.some(row=>row.id===single.id),false);
});

test('only global administrators can resize widgets; pixel height is validated and retained',async()=>{
 const row=(await post('/api/workspace/widgets',{kind:'clock',title:'Resizable',group_id:team.id})).body;
 assert.equal((await managerSession.fetch('/api/workspace/widgets/'+row.id,{method:'PUT',json:{layout:{width:2}}})).status,403);
 const updated=await c.api('/api/workspace/widgets/'+row.id,{method:'PUT',json:{layout:{width:2,height_px:420}}});assert.equal(updated.status,200);assert.equal(updated.body.layout.height_px,420);
 assert.equal((await managerSession.fetch('/api/workspace/widgets/'+row.id,{method:'PUT',json:{title:'Still editable'}})).status,200);
 assert.equal((await c.api('/api/workspace/widgets/'+row.id,{method:'PUT',json:{layout:{height_px:1001}}})).status,400);
 const visitor=(await c.pub('/api/widgets')).body.find(item=>item.id===row.id);assert.equal(visitor.can_layout,false);
 assert.equal((await c.api('/api/widgets')).body.find(item=>item.id===row.id).can_layout,true);
});
test('administrator link swaps exchange just two slots and current-group sections',async()=>{
 const sectionA=await c.makeSection(team.id,'First section'),sectionB=await c.makeSection(team.id,'Second section');
 const a=await c.makeLink({name:'Swap A',groups:[{group_id:team.id,section_id:sectionA.id},{group_id:other.id}]}),middle=await c.makeLink({name:'Untouched'}),b=await c.makeLink({name:'Swap B',groups:[{group_id:team.id,section_id:sectionB.id}]});
 const before=(await c.api('/api/links?view=admin')).body.map(row=>row.id);
 const payload={first_id:a.id,second_id:b.id,group_id:team.id};
 assert.equal((await post('/api/links/swap',payload,managerSession)).status,401);assert.equal((await c.pub('/api/links/swap',{method:'POST',json:payload})).status,401);
 assert.equal((await post('/api/links/swap',payload)).status,204);
 const after=(await c.api('/api/links?view=admin')).body,ids=after.map(row=>row.id);assert.equal(ids.indexOf(a.id),before.indexOf(b.id));assert.equal(ids.indexOf(b.id),before.indexOf(a.id));assert.equal(ids.indexOf(middle.id),before.indexOf(middle.id));
 assert.equal(after.find(row=>row.id===a.id).groups.find(group=>group.id===team.id).section_id,sectionB.id);assert.ok(after.find(row=>row.id===a.id).groups.some(group=>group.id===other.id));
 assert.equal((await post('/api/links/swap',{first_id:a.id,second_id:middle.id,group_id:team.id})).status,400);
 assert.equal((await post('/api/links/swap',{first_id:a.id,second_id:a.id})).status,400);
 assert.equal((await post('/api/links/swap',{first_id:a.id,second_id:999999})).status,404);
});
