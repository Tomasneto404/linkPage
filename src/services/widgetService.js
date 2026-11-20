// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {db}=require('../config/db');
const models=require('../models');
const metadata=require('../models/workspace');
const {getUnlockedGroupExpiries}=require('../utils/groupCrypto');
const {clean,layout,invalid}=require('./widgetConfig');
const content=require('./widgetContent');
const cache=new Map();
const owner=req=>req.user?.id?`user:${req.user.id}`:req.user?.role==='admin'?'admin-token':null;
function rows(){
  return db.prepare('SELECT * FROM widgets ORDER BY position,id').all().map(row=>{
    const config=JSON.parse(row.config),display=layout(config._layout||{},row.group_id),revision=config._revision||'legacy:'+row.id;delete config._layout;delete config._revision;
    return {...row,enabled:!!row.enabled,config,layout:display,revision};
  });
}
function adminRow(row){const config={...row.config};const has_secret=!!(config.token||config.api_key);delete config.token;delete config.api_key;return {...row,config,has_secret};}
function canManage(req,row){return req.user?.role==='admin'||!!req.user?.id&&row.layout.group_ids.length>0&&row.layout.group_ids.every(id=>metadata.role(req.user.id,id)==='manager');}
function allowedGroups(req,row){
  const expiries=getUnlockedGroupExpiries(req);
  return row.layout.group_ids.filter(id=>{const group=models.getGroupById(id);return group&&metadata.canViewGroup(req,group)&&(!group.is_protected||req.user?.role==='admin'||metadata.role(req.user?.id,id)==='manager'||expiries.has(id));});
}
function visible(req){return rows().filter(row=>row.enabled&&(!row.layout.group_ids.length||allowedGroups(req,row).length));}
function managed(req){return rows().filter(row=>canManage(req,row));}
function publicRow(req,row){
  const {config}=adminRow(row),groups=allowedGroups(req,row);
  for(const key of ['url','allow_private','text'])delete config[key];
  return {id:row.id,kind:row.kind,title:row.title,position:row.position,revision:row.revision,group_id:row.group_id&&groups.includes(row.group_id)?row.group_id:null,layout:{...row.layout,group_ids:groups},options:config,can_manage:canManage(req,row),can_layout:req.user?.role==='admin',read_tracking:owner(req)?'account':'browser'};
}
function save(body,id,req,copySource){
  const previous=id?rows().find(row=>row.id===id):null;if(id&&!previous)throw invalid('Widget not found');
  if(req&&previous&&!canManage(req,previous))throw Object.assign(new Error('Widget not found'),{status:404});
  if(!id&&rows().length>=40)throw invalid('Use up to 40 widgets');
  const data=clean(body,previous);
  if(req&&!canManage(req,data))throw Object.assign(new Error('You can manage widgets only in groups you manage'),{status:403});
  if(req&&req.user?.role!=='admin'){
    const old=previous?.layout||copySource?.layout||{width:1,height:'auto'};
    if(data.layout.width!==old.width||data.layout.height!==old.height||(data.layout.height_px??null)!==(old.height_px??null))throw Object.assign(new Error('Only administrators can resize widgets'),{status:403});
  }
  if(req?.user?.role!=='admin'&&req&&data.config.allow_private){
    const source=previous||copySource;
    if(!source?.config.allow_private||source.config.url!==data.config.url)throw Object.assign(new Error('An administrator must approve an intranet source'),{status:403});
  }
  const encoded=JSON.stringify({...data.config,_layout:data.layout,_revision:require('node:crypto').randomUUID()});
  if(id)db.prepare('UPDATE widgets SET kind=?,title=?,group_id=?,enabled=?,config=? WHERE id=?').run(data.kind,data.title,data.group_id,+data.enabled,encoded,id);
  else{
    const position=rows().reduce((last,row)=>Math.max(last,row.position+1),0);
    id=Number(db.prepare('INSERT INTO widgets(kind,title,group_id,enabled,config,position) VALUES(?,?,?,?,?,?)').run(data.kind,data.title,data.group_id,+data.enabled,encoded,position).lastInsertRowid);
  }
  cache.delete(id);return adminRow(rows().find(row=>row.id===id));
}
function findManaged(req,id){const row=rows().find(row=>row.id===Number(id));if(!row||!canManage(req,row))throw Object.assign(new Error('Widget not found'),{status:404});return row;}
async function preview(req,body){
  const previous=body.id?findManaged(req,body.id):null,data=clean(body,previous);
  if(!canManage(req,data))throw Object.assign(new Error('Choose groups you manage'),{status:403});
  if(data.config.allow_private&&req.user.role!=='admin'&&(!previous?.config.allow_private||previous.config.url!==data.config.url))throw Object.assign(new Error('An administrator must approve an intranet source'),{status:403});
  return {widget:publicRow(req,{...data,id:0,position:0}),value:{data:await content.load(data),updated_at:new Date().toISOString(),stale:false}};
}
function duplicate(req,id){const row=findManaged(req,id);return save({...row,title:row.title.slice(0,93)+' (copy)'},null,req,row);}
function remove(req,id){findManaged(req,id);db.prepare('DELETE FROM widget_reads WHERE widget_id=?').run(Number(id));db.prepare('DELETE FROM widgets WHERE id=?').run(Number(id));cache.delete(Number(id));}
function reorder(req,order){
  if(req.user?.role!=='admin')throw Object.assign(new Error('Only administrators can move widgets'),{status:403});
  if(!Array.isArray(order)||!order.length||order.length>40||order.some(id=>!Number.isInteger(id))||new Set(order).size!==order.length)throw invalid('Send distinct widget IDs');
  for(const id of order)findManaged(req,id);
  const selected=new Set(order),pending=[...order],ids=rows().map(row=>selected.has(row.id)?pending.shift():row.id);
  db.exec('BEGIN');try{ids.forEach((id,index)=>db.prepare('UPDATE widgets SET position=? WHERE id=?').run(index,id));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  return managed(req).map(adminRow);
}
function removeForGroup(groupId){
  for(const row of rows()){
    if(!row.layout.group_ids.includes(Number(groupId)))continue;
    const groups=row.layout.group_ids.filter(id=>id!==Number(groupId));
    if(groups.length)save({layout:{group_ids:groups}},row.id);
    else{db.prepare('DELETE FROM widget_reads WHERE widget_id=?').run(row.id);db.prepare('DELETE FROM widgets WHERE id=?').run(row.id);cache.delete(row.id);}
  }
}
async function data(row,{force=false,fetcher,now=Date.now}={}){
  const timestamp=now(),previous=cache.get(row.id);
  if(previous?.pending)return previous.pending;
  if(previous?.value&&((!force&&previous.until>timestamp)||(force&&timestamp-previous.attempted<10000)))return previous.value;
  const entry={...previous,attempted:timestamp};
  entry.pending=content.load(row,{fetcher}).then(value=>{
    const result={data:value,updated_at:new Date(now()).toISOString(),stale:false,error:null};
    entry.good=result;entry.value=result;entry.until=now()+(row.config.refresh_seconds||300)*1000;return result;
  }).catch(()=>{
    const error='This widget could not refresh. Check the source or try again.';
    const result=entry.good?{...entry.good,stale:true,error}:{error,stale:false,updated_at:null};
    entry.value=result;entry.until=now()+30000;return result;
  }).finally(()=>{delete entry.pending;});
  cache.set(row.id,entry);return entry.pending;
}
function readKeys(req,id){const key=owner(req);return key?db.prepare('SELECT item_key FROM widget_reads WHERE owner=? AND widget_id=?').all(key,id).map(row=>row.item_key):[];}
async function viewData(req,row,options){const value=await data(row,options);return row.kind==='gotify'?{...value,read:readKeys(req,row.id)}:value;}
async function markRead(req,row,keys){
  const key=owner(req);if(!key)throw Object.assign(new Error('Sign in to save read state'),{status:401});
  if(row.kind!=='gotify'||!Array.isArray(keys)||keys.length>30||keys.some(value=>typeof value!=='string'||value.length>100))throw invalid('Choose valid notification IDs');
  const loaded=await data(row),valid=new Set(loaded.data?.messages.map(item=>item.id)||[]);
  if(keys.some(value=>!valid.has(value)))throw invalid('Notification is no longer in this widget');
  db.exec('BEGIN');try{
    for(const id of keys)db.prepare('INSERT OR IGNORE INTO widget_reads(owner,widget_id,item_key,read_at) VALUES(?,?,?,?)').run(key,row.id,id,new Date().toISOString());
    db.prepare('DELETE FROM widget_reads WHERE owner=? AND widget_id=? AND item_key NOT IN (SELECT item_key FROM widget_reads WHERE owner=? AND widget_id=? ORDER BY read_at DESC LIMIT 300)').run(key,row.id,key,row.id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {read:readKeys(req,row.id)};
}
function toggleTask(req,id,{line,checked,text:expected}){
  const row=findManaged(req,id);if(row.kind!=='note'||row.config.format!=='markdown'||!Number.isInteger(line)||typeof checked!=='boolean')throw invalid('Choose a valid task');
  if(typeof expected!=='string'||expected!==row.config.text)throw Object.assign(new Error('This note changed. Refresh it before updating a task.'),{status:409});
  const task=content.note(row.config).tasks.find(task=>task.line===line);if(!task)throw invalid('Task not found');
  const lines=row.config.text.split('\n');lines[line]=lines[line].replace(/^(\s{0,3}[-*+]\s+)\[[ xX]\]/,`$1[${checked?'x':' '}]`);
  save({config:{text:lines.join('\n')}},row.id,req);return {ok:true};
}
module.exports={rows,adminRow,publicRow,save,visible,managed,canManage,findManaged,preview,duplicate,remove,reorder,removeForGroup,data,viewData,markRead,toggleTask,clean,...content,clear:id=>cache.delete(id)};
