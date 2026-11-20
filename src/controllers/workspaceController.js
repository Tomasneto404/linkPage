// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const fs=require('node:fs');
const path=require('node:path');
const {db}=require('../config/db');
const models=require('../models');
const metadata=require('../models/workspace');
const appearance=require('../services/appearanceService');
const backups=require('../services/backupService');
const {visibleSharedLinks}=require('../services/linkService');
const {resolveStoredFilePath}=require('../services/uploadService');
const {resolvePrivateFilePath}=require('../services/privateFiles');
const bad=message=>{const e=new Error(message);e.status=400;throw e;};
const owner=req=>req.user?.id?`user:${req.user.id}`:'admin-token';
function recentSearches(req,res){
  if(req.method==='DELETE')db.prepare('DELETE FROM workspace_search_recent WHERE owner=?').run(owner(req));
  if(req.method==='POST'){
    const query=typeof req.body.query==='string'?req.body.query.trim().slice(0,160):'';if(!query)return res.status(400).json({error:'Enter a search query'});
    db.prepare('INSERT INTO workspace_search_recent(owner,query,used_at) VALUES(?,?,?) ON CONFLICT(owner,query) DO UPDATE SET used_at=excluded.used_at').run(owner(req),query,new Date().toISOString());
    db.prepare('DELETE FROM workspace_search_recent WHERE owner=? AND query NOT IN (SELECT query FROM workspace_search_recent WHERE owner=? ORDER BY used_at DESC LIMIT 10)').run(owner(req),owner(req));
  }
  res.set('Cache-Control','private, no-store').json(db.prepare('SELECT query FROM workspace_search_recent WHERE owner=? ORDER BY used_at DESC LIMIT 10').all(owner(req)));
}
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const cache=new Map(); let cacheBytes=0;
function textOf(full){
  if(!full)return '';
  try{const stat=fs.statSync(full);if(stat.size>5*1024*1024)return '';const old=cache.get(full);if(old?.mtime===stat.mtimeMs&&old?.size===stat.size)return old.text;const text=fs.readFileSync(full,'utf8');if(old)cacheBytes-=Buffer.byteLength(old.text);cache.delete(full);cache.set(full,{mtime:stat.mtimeMs,size:stat.size,text});cacheBytes+=Buffer.byteLength(text);while(cacheBytes>24*1024*1024){const key=cache.keys().next().value;cacheBytes-=Buffer.byteLength(cache.get(key).text);cache.delete(key);}return text;}catch{return '';}
}
function search(req,res){
  const query=typeof req.query.q==='string'?req.query.q.trim().slice(0,160):'';
  const terms=fold(query).split(/\s+/).filter(Boolean);if(!terms.length)return res.json({results:[]});
  const admin=req.user?.role==='admin'&&(req.isAdminToken||req.query.view==='admin');
  const shared=admin?models.getAllLinks():visibleSharedLinks(req);
  const personal=req.user?.id?models.getPersonalLinks(req.user.id):[];
  const guest=!req.user&&req.guest?models.getGuestLinks(req.guest.id):[];
  const results=[];
  for(const [scope,links]of [['shared',shared],['personal',personal],['guest',guest]])for(const link of links){
    let text='';if(/\.md$/i.test(link.file_name||'')){
      const row=scope==='shared'?null:db.prepare(`SELECT attachment_file FROM ${scope==='personal'?'user_links':'guest_links'} WHERE id=? AND ${scope==='personal'?'owner_user_id':'owner_guest_id'}=?`).get(link.id,scope==='personal'?req.user.id:req.guest.id);
      text=textOf(scope==='shared'?resolveStoredFilePath(link.file_path):resolvePrivateFilePath(row?.attachment_file));
    }
    const haystack=[link.name,link.description,link.url,...(link.tags||[]),...(link.groups||[]).map(g=>g.name),text].join(' ');
    if(!terms.every(term=>fold(haystack).includes(term)))continue;
    const at=text?Math.max(0,fold(text).indexOf(terms[0])):0;
    results.push({type:text?'document':'link',id:link.id,scope,name:link.name,icon_url:link.image_path||link.favicon_path||null,groups:(link.groups||[]).map(g=>g.name),description:text?text.slice(Math.max(0,at-60),at+180):link.description||link.url,snippet:!!text,tags:link.tags||[],href:scope==='shared'?(link.slug?`/f/${encodeURIComponent(link.slug)}`:`/r/${link.id}`):link.file_path?`/api/${scope==='personal'?'my':'guest'}/links/${link.id}/file`:link.url,score:fold(link.name).includes(fold(query))?3:text?1:2});
  }
  const groups=[...(admin?models.getAllGroups():models.getAllGroups().filter(g=>metadata.canViewGroup(req,g))).map(g=>({...g,scope:'shared'})),...models.getPersonalGroups(req.user?.id||-1).map(g=>({...g,scope:'personal'}))];
  for(const group of groups)if(terms.every(t=>fold(group.name).includes(t)))results.push({type:'group',id:group.id,scope:group.scope,name:group.name,description:'Open group',href:group.scope==='shared'&&group.slug?`/g/${encodeURIComponent(group.slug)}`:`/?group=${group.scope==='personal'?'u':''}${group.id}`,score:4});
  res.set('Cache-Control','private, no-store').json({results:results.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,60)});
}
function tags(value){if(!Array.isArray(value)||value.length>24)bad('Use up to 24 tags');return [...new Set(value.map(v=>{if(typeof v!=='string'||!v.trim()||v.trim().length>50)bad('Tags must contain 1–50 characters');return v.trim().normalize('NFC').toLowerCase();}))];}
function date(value){if(value===null||value==='')return null;if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))bad('Dates must include a time zone');return new Date(value).toISOString();}
function updateLink(req,res){
  const id=Number(req.params.id);if(!models.getLinkById(id))return res.status(404).json({error:'Link not found'});
  const old=metadata.linkDetails(id),data={};if(req.body.tags!==undefined)data.tags=tags(req.body.tags);
  for(const key of ['publish_at','expires_at'])if(req.body[key]!==undefined)data[key]=date(req.body[key]);
  const merged={...old,...data};if(merged.publish_at&&merged.expires_at&&merged.publish_at>=merged.expires_at)bad('Expiry must be after publication');
  res.json(metadata.setLinkDetails(id,data));
}
function updateGroup(req,res){
  const id=Number(req.params.id);if(!models.getGroupById(id))return res.status(404).json({error:'Group not found'});
  const value={};if(req.body.layout!==undefined){if(!['grid','list','gallery'].includes(req.body.layout))bad('Choose grid, list or gallery');value.layout=req.body.layout;}
  if(req.body.is_private!==undefined){if(typeof req.body.is_private!=='boolean')bad('Private must be true or false');value.is_private=req.body.is_private;}
  let entries;
  if(req.body.access!==undefined){if(!Array.isArray(req.body.access)||req.body.access.length>500)bad('Invalid member list');const seen=new Set();entries=req.body.access.map(entry=>{if(!entry||!Number.isInteger(entry.user_id)||!models.getUserById(entry.user_id)||!Object.hasOwn(metadata.ranks,entry.role)||seen.has(entry.user_id))bad('Choose existing members and a valid role once each');seen.add(entry.user_id);return {user_id:entry.user_id,role:entry.role};});}
  if(entries)metadata.setAccess(id,entries);metadata.setGroupDetails(id,value);
  res.json({...models.getGroupById(id),access:metadata.access(id)});
}
function library(req,res){res.json({links:models.getAllLinks(),groups:models.getAllGroups().map(g=>({...g,access:metadata.access(g.id)})),appearance:appearance.snapshot(),users:models.getAllUsers().map(u=>({id:u.id,email:u.email,display_name:u.display_name}))});}
function managedGroups(req,res){res.json(models.getAllGroups().filter(g=>req.user.role==='admin'||metadata.role(req.user.id,g.id)==='manager').map(g=>({...g,access:metadata.access(g.id)})));}
function requireManager(req,res,next){const group=models.getGroupById(Number(req.params.id));if(!group||(req.user.role!=='admin'&&metadata.role(req.user.id,group.id)!=='manager'))return res.status(404).json({error:'Group not found'});next();}
function updateManagedGroup(req,res){
  const group=models.getGroupById(Number(req.params.id));const name=req.body.name===undefined?group.name:req.body.name;const color=req.body.color===undefined?group.color:req.body.color;
  if(typeof name!=='string'||!name.trim()||name.length>120||typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color))bad('Choose a valid group name and colour');
  // The shared validator checks layout, privacy and the member roles before
  // changing anything; only then are the cosmetic group fields written.
  const send=res.json.bind(res);res.json=value=>{models.updateGroup(group.id,{name:name.trim(),color});return send({...value,name:name.trim(),color});};
  return updateGroup(req,res);
}
function grantMember(req,res){if(typeof req.body.email!=='string'||!Object.hasOwn(metadata.ranks,req.body.role))bad('Enter an existing member’s email and role');const user=models.getUserByEmail(req.body.email);if(!user)return res.status(404).json({error:'No account with that email'});const id=Number(req.params.id),entries=metadata.access(id).filter(x=>x.user_id!==user.id).map(({user_id,role})=>({user_id,role}));entries.push({user_id:user.id,role:req.body.role});metadata.setAccess(id,entries);res.json({access:metadata.access(id)});}
function revokeMember(req,res){const id=Number(req.params.id);metadata.setAccess(id,metadata.access(id).filter(x=>x.user_id!==Number(req.params.userId)).map(({user_id,role})=>({user_id,role})));res.json({access:metadata.access(id)});}
function filters(req,res){res.json(db.prepare('SELECT id,name,tags FROM workspace_filters WHERE owner=? ORDER BY id DESC').all(owner(req)).map(r=>({...r,tags:JSON.parse(r.tags)})));}
function saveFilter(req,res){if(typeof req.body.name!=='string'||!req.body.name.trim()||req.body.name.length>80)bad('Name the filter (up to 80 characters)');const clean=tags(req.body.tags);const result=db.prepare('INSERT INTO workspace_filters(owner,name,tags) VALUES(?,?,?)').run(owner(req),req.body.name.trim(),JSON.stringify(clean));res.status(201).json({id:Number(result.lastInsertRowid),name:req.body.name.trim(),tags:clean});}
function deleteFilter(req,res){db.prepare('DELETE FROM workspace_filters WHERE owner=? AND id=?').run(owner(req),Number(req.params.id));res.status(204).end();}
function versions(req,res){const kind=req.query.kind==='settings'?'settings':'document';const id=kind==='settings'?0:Number(req.query.link_id);res.json(metadata.versions(kind,id||0));}
function version(req,res){const row=metadata.version(Number(req.params.id));if(!row)return res.status(404).json({error:'Version not found'});res.json(row);}
function restoreVersion(req,res){
  const row=metadata.version(Number(req.params.id));if(!row)return res.status(404).json({error:'Version not found'});
  if(row.kind==='settings'){appearance.apply(JSON.parse(row.content),req.user.id);return res.json({restored:true});}
  const link=models.getLinkById(row.entity_id);if(!require('../config/constants').EDITABLE_FILE_EXTENSIONS.has(path.extname(link?.file_name||'').toLowerCase()))bad('The current attachment must be a text-editable file to restore this version');const full=resolveStoredFilePath(link?.file_path);if(!full||!fs.existsSync(full))return res.status(404).json({error:'Document not found'});
  metadata.addVersion('document',link.id,link.name,fs.readFileSync(full,'utf8'),req.user.id);fs.writeFileSync(`${full}.restore`,row.content,'utf8');fs.renameSync(`${full}.restore`,full);metadata.addVersion('document',link.id,link.name,row.content,req.user.id);cache.clear();cacheBytes=0;res.json({restored:true});
}
function notifications(req,res){
  const items=[];
  for(const r of models.getLinkRequests({status:'pending'}))items.push({key:`request:${r.id}`,type:'request',title:`Review: ${r.name}`,description:'A contribution is waiting for approval',created_at:r.created_at,href:'/admin/?workspace=requests'});
  for(const l of models.getAllLinks().filter(l=>l.is_broken))items.push({key:`broken:${l.id}:${l.last_checked_at}`,type:'health',title:l.name,description:'This link could not be reached',created_at:l.last_checked_at,link_id:l.id,href:l.slug?`/f/${encodeURIComponent(l.slug)}`:`/r/${l.id}`});
  try{const last=JSON.parse(models.readSetting('backup_last_result'));if(last)items.push({key:`backup:${last.id}`,type:'backup',title:last.status==='complete'?'Backup completed':'Backup failed',description:last.status==='complete'?'Database, files and configuration saved.':'Open Backups to retry.',created_at:last.created_at,href:'/admin/?workspace=backups'});}catch{}
  const read=new Set(db.prepare('SELECT item_key FROM workspace_notification_reads WHERE owner=?').all(owner(req)).map(r=>r.item_key));
  res.json({items:items.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,100).map(item=>({...item,read:read.has(item.key)})),unread:items.filter(item=>!read.has(item.key)).length});
}
function readNotification(req,res){const keys=req.body.keys;if(!Array.isArray(keys)||keys.length>100||keys.some(k=>typeof k!=='string'||k.length>200))bad('Invalid notification IDs');for(const key of keys)db.prepare('INSERT OR IGNORE INTO workspace_notification_reads(owner,item_key) VALUES(?,?)').run(owner(req),key);res.json({ok:true});}
function presets(req,res){res.json(db.prepare('SELECT id,name,created_at FROM workspace_presets ORDER BY id DESC').all());}
function savePreset(req,res){if(typeof req.body.name!=='string'||!req.body.name.trim()||req.body.name.length>80)bad('Name the preset (up to 80 characters)');const payload=req.body.payload?appearance.pack(appearance.unpack(req.body.payload)):appearance.pack();const r=db.prepare('INSERT INTO workspace_presets(name,payload) VALUES(?,?)').run(req.body.name.trim(),JSON.stringify(payload));res.status(201).json({id:Number(r.lastInsertRowid),name:req.body.name.trim()});}
function preset(req,res){const row=db.prepare('SELECT * FROM workspace_presets WHERE id=?').get(Number(req.params.id));if(!row)return res.status(404).json({error:'Preset not found'});if(req.method==='DELETE'){db.prepare('DELETE FROM workspace_presets WHERE id=?').run(row.id);return res.status(204).end();}const payload=JSON.parse(row.payload);if(req.method==='POST'){appearance.apply(appearance.unpack(payload),req.user.id);return res.json({applied:true});}res.set('Content-Disposition',`attachment; filename="appearance-${row.id}.json"`).json(payload);}
function backupList(req,res){res.json({backups:backups.list(),schedule:backups.settings(),busy:backups.isBusy()});}
function backupSettings(req,res){res.json(backups.saveSettings(req.body));}
async function createBackup(req,res){res.status(201).json(await backups.create());}
async function importBackup(req,res){if(!req.file)bad('Choose a backup archive');res.status(201).json(await backups.importArchive(req.file.path));}
async function restoreBackup(req,res){if(req.body.confirm!=='RESTORE')bad('Type RESTORE to confirm replacement of the current data');res.json(await backups.restore(req.params.id));}
function backupFile(req,res){const full=backups.file(req.params.id);if(!full||!fs.existsSync(full))return res.status(404).json({error:'Backup not found'});if(req.method==='DELETE'){backups.remove(req.params.id);return res.status(204).end();}res.download(full,`linkpage-${req.params.id}.tgz`);}
module.exports={search,recentSearches,updateLink,updateGroup,library,managedGroups,requireManager,updateManagedGroup,grantMember,revokeMember,filters,saveFilter,deleteFilter,versions,version,restoreVersion,notifications,readNotification,presets,savePreset,preset,backupList,backupSettings,createBackup,importBackup,restoreBackup,backupFile};
