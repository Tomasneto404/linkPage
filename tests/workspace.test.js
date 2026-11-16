// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const harness=require('./helpers/harness');
let c,models,doc,group,privateGroup,privateDoc,viewer,contributor,editor,viewerSession,contributorSession,editorSession;
const password='a-long-enough-password';
const get=url=>c.api('/api/workspace/'+url);
const put=(url,json)=>c.api('/api/workspace/'+url,{method:'PUT',json});
const post=(url,json={})=>c.api('/api/workspace/'+url,{method:'POST',json});
before(async()=>{
  c=await harness.start();models=require('../src/models');
  group=await c.makeGroup({name:'Workspace team'});privateGroup=await c.makeGroup({name:'Restricted vault'});
  doc=await c.makeFileLink({name:'Team handbook',slug:'team-handbook',fileName:'handbook.md',type:'text/markdown',bytes:Buffer.from('# Team handbook\n\nThe saffronneedle is in this document.\n\n## Notes\n\nRead it calmly.'),groups:[group.id]});
  privateDoc=await c.makeFileLink({name:'Private handbook',fileName:'private.md',type:'text/markdown',bytes:Buffer.from('# Secret\n\nsaffronneedle private material'),groups:[privateGroup.id]});
  viewer=await c.makeUser({email:'viewer@example.test',password});contributor=await c.makeUser({email:'contributor@example.test',password});editor=await c.makeUser({email:'editor@example.test',password});
  viewerSession=c.session();contributorSession=c.session();editorSession=c.session();await viewerSession.login(viewer.email,password);await contributorSession.login(contributor.email,password);await editorSession.login(editor.email,password);
  await put(`groups/${privateGroup.id}`,{is_private:true,access:[{user_id:viewer.id,role:'viewer'}]});
});
after(harness.stop);
test('workspace administration and saved filters enforce authentication',async()=>{
  for(const resource of ['library','versions','notifications','presets','backups'])assert.equal((await c.pub('/api/workspace/'+resource)).status,401,resource);
  assert.equal((await c.pub('/api/workspace/filters')).status,401);
  assert.equal((await viewerSession.fetch('/api/workspace/library')).status,401);
});
test('search indexes document content without disclosing private or hidden content',async()=>{
  const pub=await c.pub('/api/workspace/search?q=saffronneedle');assert.equal(pub.status,200);assert.deepEqual(pub.body.results.map(r=>r.name),['Team handbook']);
  const permitted=await viewerSession.fetch('/api/workspace/search?q=saffronneedle');assert.equal(permitted.body.results.length,2);
  assert.equal((await c.pub(privateDoc.file_path)).status,404);
  assert.equal((await contributorSession.fetch(privateDoc.file_path)).status,404);
  assert.equal((await viewerSession.fetch(privateDoc.file_path)).status,200);
  assert.equal((await c.pub('/api/groups')).body.some(g=>g.id===privateGroup.id),false);
  const hidden=await c.makeLink({name:'Hidden saffronneedle',url:'https://hidden.invalid'});models.updateLinkVisibility(hidden.id,true);
  assert.equal((await c.pub('/api/workspace/search?q=saffronneedle')).body.results.length,1);
  assert.ok((await get('search?q=saffronneedle&view=admin')).body.results.some(r=>r.name===hidden.name));
  await c.api('/api/settings/public-password',{method:'POST',json:{password:'secret'}});
  assert.equal((await c.pub('/api/workspace/search?q=saffronneedle')).status,401);
  await c.api('/api/settings/public-password',{method:'DELETE'});
});
test('search keeps each member’s personal URLs and document contents separate',async()=>{
  const mine=await contributorSession.fetch('/api/my/links',{method:'POST',json:{name:'Onlymyneedle',url:'https://mine.invalid'}});assert.equal(mine.status,201,mine.text);
  const found=await contributorSession.fetch('/api/workspace/search?q=Onlymyneedle');assert.equal(found.body.results[0].href,'https://mine.invalid');
  assert.equal((await viewerSession.fetch('/api/workspace/search?q=Onlymyneedle')).body.results.length,0);
  const file=await contributorSession.fetch('/api/my/links',{method:'POST',form:harness.fileForm('file',{name:'personal.md',type:'text/markdown',bytes:Buffer.from('# Private notes\n\nPrismneedle exists only here.')},{name:'Personal notes'})});assert.equal(file.status,201,file.text);
  const content=await contributorSession.fetch('/api/workspace/search?q=Prismneedle');assert.equal(content.body.results.length,1);assert.match(content.body.results[0].href,/\/api\/my\/links\/\d+\/file/);
  assert.equal((await viewerSession.fetch('/api/workspace/search?q=Prismneedle')).body.results.length,0);assert.equal((await c.pub('/api/workspace/search?q=Prismneedle')).body.results.length,0);
});
test('tags normalise, saved filters are owned, and invalid dates leave metadata untouched',async()=>{
  const saved=await put(`links/${doc.id}`,{tags:['Design','team','design']});assert.equal(saved.status,200);assert.deepEqual(saved.body.tags,['design','team']);
  assert.equal((await c.pub('/api/workspace/search?q=design')).body.results[0].name,doc.name);
  const filter=await contributorSession.fetch('/api/workspace/filters',{method:'POST',json:{name:'Design work',tags:['design']}});assert.equal(filter.status,201);
  assert.equal((await viewerSession.fetch('/api/workspace/filters')).body.length,0);
  await viewerSession.fetch(`/api/workspace/filters/${filter.body.id}`,{method:'DELETE'});
  assert.equal((await contributorSession.fetch('/api/workspace/filters')).body.length,1);
  const invalid=await put(`links/${doc.id}`,{tags:['changed'],publish_at:'2027-01-01T10:00:00',expires_at:'invalid'});assert.equal(invalid.status,400);assert.deepEqual(models.getLinkById(doc.id).tags,['design','team']);
});
test('scheduled links disappear from listings, search, direct navigation and attachment URLs',async()=>{
  const future=new Date(Date.now()+86400000).toISOString();
  assert.equal((await put(`links/${doc.id}`,{publish_at:future})).status,200);
  assert.equal((await c.pub('/api/links')).body.some(l=>l.id===doc.id),false);
  assert.equal((await c.pub('/api/workspace/search?q=saffronneedle')).body.results.length,0);
  assert.equal((await c.pub('/f/team-handbook')).headers.get('location'),'/');
  assert.equal((await c.pub(doc.file_path)).status,404);
  await put(`links/${doc.id}`,{publish_at:null,expires_at:new Date(Date.now()-1000).toISOString()});assert.equal((await c.pub(doc.file_path)).status,404);
  await put(`links/${doc.id}`,{publish_at:null,expires_at:null});assert.equal((await c.pub(doc.file_path)).status,200);
});
test('viewers, contributors and editors have distinct abilities in a shared group',async()=>{
  await put(`groups/${group.id}`,{layout:'gallery',access:[{user_id:viewer.id,role:'viewer'},{user_id:contributor.id,role:'contributor'},{user_id:editor.id,role:'editor'}]});
  assert.equal((await c.pub('/api/groups')).body.find(g=>g.id===group.id).layout,'gallery');
  const payload={name:'Contribution',url:'https://contribution.invalid',group_id:group.id};
  assert.equal((await viewerSession.fetch('/api/managed/links',{method:'POST',json:payload})).status,404);
  const own=await contributorSession.fetch('/api/managed/links',{method:'POST',json:payload});assert.equal(own.status,201,own.text);
  assert.equal((await contributorSession.fetch(`/api/managed/links/${own.body.id}`,{method:'PUT',json:{name:'My edited contribution',url:payload.url}})).status,200);
  assert.equal((await contributorSession.fetch(`/api/managed/links/${doc.id}`,{method:'PUT',json:{name:'Not mine',url:doc.url}})).status,403);
  assert.equal((await editorSession.fetch(`/api/managed/links/${own.body.id}`,{method:'PUT',json:{name:'Editor updated this',url:payload.url}})).status,200);
});
test('document history captures both sides of an edit and restoring also keeps the replaced version',async()=>{
  const edit=await c.api(`/api/links/${doc.id}/file`,{method:'PUT',json:{content:'# A new revision\n\nRestorable text.'}});assert.equal(edit.status,200,edit.text);
  const versions=(await get(`versions?kind=document&link_id=${doc.id}`)).body;assert.equal(versions.length,2);
  const old=(await get(`versions/${versions[1].id}`)).body;assert.match(old.content,/saffronneedle/);
  assert.equal((await post(`versions/${old.id}/restore`)).status,200);
  assert.match((await c.pub(doc.file_path)).text,/saffronneedle/);
  assert.equal((await get(`versions?kind=document&link_id=${doc.id}`)).body.length,3);
});
test('Markdown has a table of contents, text controls and safe in-document search with no scripts',async()=>{
  const res=await c.pub('/f/team-handbook?theme=dark&font=large&width=wide&focus=1&q=saffronneedle');assert.equal(res.status,200);
  assert.match(res.text,/data-reading-font="large"/);assert.match(res.text,/data-reading-width="wide"/);assert.match(res.text,/data-reading-focus="on"/);assert.match(res.text,/id="heading-1"/);assert.match(res.text,/id="md-match-1"/);assert.match(res.text,/Document contents/);assert.doesNotMatch(res.text,/<script\b/i);
  const hostile=await c.pub('/f/team-handbook?q='+encodeURIComponent('<img src=x onerror=alert(1)>'));assert.doesNotMatch(hostile.text,/<img src=x/);
});
test('appearance history and portable presets restore configuration without importing secrets',async()=>{
  await c.api('/api/settings/site-title',{method:'POST',json:{title:'Earlier title'}});
  await c.api('/api/settings/site-title',{method:'POST',json:{title:'Later title'}});
  const rows=(await get('versions?kind=settings')).body;let earlier;
  for(const row of rows){const full=(await get(`versions/${row.id}`)).body;if(JSON.parse(full.content).site_title==='Earlier title'){earlier=full;break;}}
  assert.ok(earlier);assert.equal((await post(`versions/${earlier.id}/restore`)).status,200);assert.equal((await c.pub('/api/settings')).body.site_title,'Earlier title');
  const preset=await post('presets',{name:'Saved appearance'});assert.equal(preset.status,201,preset.text);
  const exported=await get(`presets/${preset.body.id}`);assert.equal(exported.body.format,'linkpage-appearance');assert.doesNotMatch(JSON.stringify(exported.body),/public_password|oidc_client_secret|mail_password/);
  await c.api('/api/settings/site-title',{method:'POST',json:{title:'Changed again'}});
  assert.equal((await post(`presets/${preset.body.id}/apply`)).status,200);assert.equal((await c.pub('/api/settings')).body.site_title,'Earlier title');
  assert.equal((await post('presets',{name:'Imported',payload:exported.body})).status,201);
  assert.equal((await post('presets',{name:'Hostile',payload:{format:'linkpage-appearance',version:1,settings:{require_login:'0'}}})).status,400);
  assert.equal((await post('presets',{name:'Malformed calendar',payload:{format:'linkpage-appearance',version:1,settings:{season_schedule:'{broken'}}})).status,400);
});
test('deleting an account removes its workspace access and saved personal state',async()=>{
  const user=await c.makeUser({email:'removed-workspace@example.test',password});const session=c.session();await session.login(user.email,password);
  await put(`groups/${privateGroup.id}`,{access:[{user_id:user.id,role:'viewer'}]});
  await session.fetch('/api/workspace/filters',{method:'POST',json:{name:'Private filter',tags:['team']}});
  const {db}=require('../src/config/db');
  db.prepare('INSERT INTO workspace_notification_reads(owner,item_key) VALUES(?,?)').run(`user:${user.id}`,'test:read');
  assert.equal((await c.api(`/api/users/${user.id}`,{method:'DELETE'})).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_group_access WHERE user_id=?').get(user.id).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_filters WHERE owner=?').get(`user:${user.id}`).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workspace_notification_reads WHERE owner=?').get(`user:${user.id}`).n,0);
  await put(`groups/${privateGroup.id}`,{access:[{user_id:viewer.id,role:'viewer'}]});
});
test('notification reads are personal, with pending requests and link health in the same centre',async()=>{
  models.createLinkRequest({name:'Review this',url:'https://review.invalid'});models.updateLinkBrokenStatus(doc.id,true);
  const data=(await get('notifications')).body;assert.ok(data.items.some(i=>i.type==='request'));assert.ok(data.items.some(i=>i.type==='health'));assert.ok(data.unread>0);
  assert.equal((await post('notifications/read',{keys:data.items.map(i=>i.key)})).status,200);assert.equal((await get('notifications')).body.unread,0);
});
test('delegated group managers can update their groups and grant roles without reaching global administration',async()=>{
  await put(`groups/${group.id}`,{access:[{user_id:contributor.id,role:'manager'}]});
  const groups=await contributorSession.fetch('/api/workspace/managed-groups');assert.equal(groups.body.length,1);assert.equal(groups.body[0].id,group.id);
  const updated=await contributorSession.fetch(`/api/workspace/managed-groups/${group.id}`,{method:'PUT',json:{name:'Managed team',color:'#1255aa',layout:'list'}});assert.equal(updated.status,200,updated.text);assert.equal(updated.body.name,'Managed team');
  assert.equal((await viewerSession.fetch(`/api/workspace/managed-groups/${group.id}`,{method:'PUT',json:{name:'Not allowed'}})).status,404);
  assert.equal((await contributorSession.fetch(`/api/workspace/managed-groups/${privateGroup.id}`,{method:'PUT',json:{name:'Not allowed'}})).status,404);
  assert.equal((await contributorSession.fetch(`/api/workspace/managed-groups/${group.id}/members`,{method:'POST',json:{email:editor.email,role:'viewer'}})).status,200);
  assert.equal((await contributorSession.fetch('/api/workspace/backups')).status,401);
  assert.equal((await contributorSession.fetch(`/api/workspace/managed-groups/${group.id}/members/${editor.id}`,{method:'DELETE'})).status,200);
});
test('automatic backup scheduling creates one copy per interval and honours the off switch',async()=>{
  const service=require('../src/services/backupService');service.saveSettings({enabled:false,frequency:'daily',hour:0,retention:7});await service.tick();assert.equal(service.list().length,0);
  service.saveSettings({enabled:true,frequency:'daily',hour:0,retention:7});await service.tick();assert.equal(service.list().filter(x=>x.reason==='automatic').length,1);await service.tick();assert.equal(service.list().filter(x=>x.reason==='automatic').length,1);
  service.saveSettings({enabled:false,frequency:'daily',hour:3,retention:7});
});
test('complete backups can be downloaded, imported and restored with database and file recovery',async()=>{
  const schedule=await put('backups/schedule',{enabled:false,frequency:'weekly',hour:4,retention:7});assert.equal(schedule.status,200);
  assert.equal((await put('backups/schedule',{enabled:true,frequency:'never',hour:25,retention:0})).status,400);
  const original=fs.readFileSync(path.join(c.dataDir,'uploads',path.basename(doc.file_path)),'utf8');
  const backup=await post('backups');assert.equal(backup.status,201,backup.text);assert.ok(backup.body.size>0);
  const full=await fetch(c.baseUrl+`/api/workspace/backups/${backup.body.id}/file`,{headers:{'X-Admin-Token':c.token}});assert.equal(full.status,200);const bytes=Buffer.from(await full.arrayBuffer());assert.equal(bytes[0],31);
  const imported=await c.api('/api/workspace/backups/import',{method:'POST',form:harness.fileForm('backup',{name:'copy.tgz',type:'application/gzip',bytes})});assert.equal(imported.status,201,imported.text);
  await c.api('/api/settings/site-title',{method:'POST',json:{title:'After backup'}});fs.writeFileSync(path.join(c.dataDir,'uploads',path.basename(doc.file_path)),'Changed after backup');
  assert.equal((await post(`backups/${backup.body.id}/restore`,{confirm:'no'})).status,400);
  const restored=await post(`backups/${backup.body.id}/restore`,{confirm:'RESTORE'});assert.equal(restored.status,200,restored.text);
  assert.equal((await c.pub('/api/settings')).body.site_title,'Earlier title');assert.equal(fs.readFileSync(path.join(c.dataDir,'uploads',path.basename(doc.file_path)),'utf8'),original);
  assert.ok((await get('backups')).body.backups.some(b=>b.reason==='before-restore'));
  assert.equal((await get('library')).status,200,'current token still works after restoration');
});
