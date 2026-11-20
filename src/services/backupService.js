// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Consistent SQLite snapshots and complete file archives, outside public storage. */
const invalid=message=>Object.assign(new Error(message),{status:400});
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const {db}=require('../config/db');
const models=require('../models');
const {DATA_DIR,UPLOADS_DIR,PRIVATE_UPLOADS_DIR,CURRENT_VERSION}=require('../config/env');
const ROOT=path.join(DATA_DIR,'backups');
let busy=false;
const roots={uploads:UPLOADS_DIR,private:PRIVATE_UPLOADS_DIR};
function directory(){fs.mkdirSync(ROOT,{recursive:true,mode:0o700});return ROOT;}
function file(id){return /^[a-f0-9-]{36}$/.test(id||'')?path.join(directory(),`${id}.tgz`):null;}
function list(){directory();return fs.readdirSync(ROOT).filter(x=>/^[a-f0-9-]{36}\.json$/.test(x)).map(name=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,name),'utf8'));}catch{return null;}}).filter(Boolean).sort((a,b)=>b.created_at.localeCompare(a.created_at));}
function settings(){try{const s=JSON.parse(models.readSetting('backup_schedule'));if(s&&typeof s.enabled==='boolean'&&['daily','weekly'].includes(s.frequency))return s;}catch{}return {enabled:false,frequency:'daily',hour:3,retention:7};}
function saveSettings(s){if(!s||typeof s.enabled!=='boolean'||!['daily','weekly'].includes(s.frequency)||!Number.isInteger(s.hour)||s.hour<0||s.hour>23||!Number.isInteger(s.retention)||s.retention<1||s.retention>30)throw invalid('Choose a valid backup frequency, UTC hour and retention (1–30).');models.writeSetting('backup_schedule',JSON.stringify({enabled:s.enabled,frequency:s.frequency,hour:s.hour,retention:s.retention}));return settings();}
function safeCopy(source,target){if(!fs.existsSync(source))return;const excludeBackups=!path.resolve(source).startsWith(path.resolve(ROOT)+path.sep);fs.cpSync(source,target,{recursive:true,filter:src=>!fs.lstatSync(src).isSymbolicLink()&&(!excludeBackups||(path.resolve(src)!==path.resolve(ROOT)&&!path.resolve(src).startsWith(path.resolve(ROOT)+path.sep)))});}
async function create(reason='manual'){
  if(busy)throw invalid('A backup or restore is already running');busy=true;const id=crypto.randomUUID();const stage=fs.mkdtempSync(path.join(directory(),'.snapshot-'));
  try{
    if(db.dialect==='postgresql')require('./databaseSnapshot').write(path.join(stage,'database.json'),db);
    else db.prepare('VACUUM INTO ?').run(path.join(stage,'links.db'));
    for(const [name,source] of Object.entries(roots))safeCopy(source,path.join(stage,name));
    // Credentials are portable, but restoring preserves the running instance's
    // access keys so the operator is not locked out by a backup from elsewhere.
    const secrets={};for(const name of ['admin-token.txt','group-secret.txt','admin-initial-password.txt']){const src=path.join(DATA_DIR,name);if(fs.existsSync(src))secrets[name]=fs.readFileSync(src,'utf8');}
    fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify({format:'linkpage-backup',version:1,app_version:CURRENT_VERSION,database_engine:db.dialect,secrets}),{mode:0o600});
    await run('tar',['-czf',file(id),'-C',stage,'.'],{maxBuffer:1024*1024});fs.chmodSync(file(id),0o600);
    const item={id,created_at:new Date().toISOString(),size:fs.statSync(file(id)).size,reason,status:'complete',version:CURRENT_VERSION};
    fs.writeFileSync(path.join(ROOT,`${id}.json`),JSON.stringify(item),{mode:0o600});
    models.writeSetting('backup_last_result',JSON.stringify(item));
    if(reason !== 'before-restore') for(const old of list().slice(settings().retention))remove(old.id);
    return item;
  }catch(error){models.writeSetting('backup_last_result',JSON.stringify({id,created_at:new Date().toISOString(),status:'failed',message:'Backup could not be completed'}));throw error;}
  finally{fs.rmSync(stage,{recursive:true,force:true});busy=false;}
}
function remove(id){const full=file(id);if(!full)throw invalid('Invalid backup');fs.rmSync(full,{force:true});fs.rmSync(path.join(ROOT,`${id}.json`),{force:true});}
async function importArchive(source){
  const id=crypto.randomUUID();
  try{
    if(busy)throw invalid('A backup or restore is already running');
    const entries=(await run('tar',['-tzf',source],{maxBuffer:8*1024*1024})).stdout.split('\n').filter(Boolean);
    if(entries.some(name=>path.isAbsolute(name)||name.split('/').includes('..')||!/^\.\/(?:$|links\.db$|database\.json$|manifest\.json$|uploads(?:\/|$)|private(?:\/|$))/.test(name)))throw invalid('Unsafe backup paths');
    const manifest=JSON.parse((await run('tar',['-xOzf',source,'./manifest.json'],{maxBuffer:128*1024})).stdout);
    if(manifest.format!=='linkpage-backup'||manifest.version!==1)throw invalid('Not a supported LinkPage backup');
    fs.renameSync(source,file(id));fs.chmodSync(file(id),0o600);
    const item={id,created_at:new Date().toISOString(),size:fs.statSync(file(id)).size,reason:'imported',status:'complete',version:manifest.app_version};fs.writeFileSync(path.join(directory(),`${id}.json`),JSON.stringify(item),{mode:0o600});return item;
  }catch(error){throw invalid(error.status===400?error.message:'This file is not a supported backup archive');}
  finally{fs.rmSync(source,{force:true});}
}
async function restore(id){
  const full=file(id);if(!full||!fs.existsSync(full))throw invalid('Backup not found');
  if(busy)throw invalid('A backup or restore is already running');
  // Always retain a recovery point immediately before replacing data.
  await create('before-restore');busy=true;const stage=fs.mkdtempSync(path.join(directory(),'.restore-'));
  try{
    const entries=(await run('tar',['-tzf',full],{maxBuffer:8*1024*1024})).stdout.split('\n').filter(Boolean);
    if(entries.some(name=>path.isAbsolute(name)||name.split('/').includes('..')||!/^\.\/(?:$|links\.db$|database\.json$|manifest\.json$|uploads(?:\/|$)|private(?:\/|$))/.test(name)))throw invalid('Unsafe backup paths');
    const details=(await run('tar',['-tvzf',full],{maxBuffer:16*1024*1024})).stdout.split('\n').filter(Boolean);
    if(details.some(line=>!['-','d'].includes(line[0])))throw invalid('Backup contains unsupported file entries');
    await run('tar',['-xzf',full,'-C',stage],{maxBuffer:1024*1024});
    const manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));
    if(manifest.format!=='linkpage-backup'||manifest.version!==1)throw invalid('Not a supported LinkPage backup');
    if(db.dialect==='postgresql'||fs.existsSync(path.join(stage,'database.json'))){
      const snapshots=require('./databaseSnapshot');
      const data=fs.existsSync(path.join(stage,'database.json'))?JSON.parse(fs.readFileSync(path.join(stage,'database.json'),'utf8')):snapshots.fromSQLite(path.join(stage,'links.db'));
      if(data.schema_version!==Number(models.readSetting('schema_version')))throw invalid('Restore requires a backup from the same database schema version');
      const prior=snapshots.capture(db),recovery=path.join(stage,'recovery');fs.mkdirSync(recovery);
      for(const [name,target]of Object.entries(roots))safeCopy(target,path.join(recovery,name));
      try{
        snapshots.restore(db,data);
        for(const [name,target]of Object.entries(roots)){fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});safeCopy(path.join(stage,name),target);}
        db.exec('DELETE FROM sessions; DELETE FROM auth_throttle;');
      }catch(error){snapshots.restore(db,prior);for(const [name,target]of Object.entries(roots)){fs.rmSync(target,{recursive:true,force:true});safeCopy(path.join(recovery,name),target);}throw error;}
      return {restored:true,recovery_backup:list().find(x=>x.reason==='before-restore')?.id};
    }
    const {DatabaseSync}=require('node:sqlite');const check=new DatabaseSync(path.join(stage,'links.db'),{readOnly:true});
    try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw invalid('Backup database is damaged');const v=Number(check.prepare("SELECT value FROM settings WHERE key='schema_version'").get()?.value);const current=Number(models.readSetting('schema_version'));if(v!==current)throw invalid('Restore requires a backup from the same database schema version');}finally{check.close();}
    // Stage the old directories too, so any file-system failure can roll back.
    const recovery=path.join(stage,'recovery');fs.mkdirSync(recovery);
    for(const [name,target] of Object.entries(roots)){safeCopy(target,path.join(recovery,name));}
    fs.copyFileSync(path.join(DATA_DIR,'links.db'),path.join(recovery,'links.db'));
    db.close();
    try{
      fs.copyFileSync(path.join(stage,'links.db'),path.join(DATA_DIR,'links.db'));
      for(const [name,target] of Object.entries(roots)){fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});safeCopy(path.join(stage,name),target);}
      db.open();db.exec('DELETE FROM sessions; DELETE FROM auth_throttle;');
    }catch(error){try{db.close();}catch{}fs.copyFileSync(path.join(recovery,'links.db'),path.join(DATA_DIR,'links.db'));for(const [name,target]of Object.entries(roots)){fs.rmSync(target,{recursive:true,force:true});safeCopy(path.join(recovery,name),target);}db.open();throw error;}
    return {restored:true,recovery_backup:list().find(x=>x.reason==='before-restore')?.id};
  }finally{fs.rmSync(stage,{recursive:true,force:true});busy=false;}
}
async function tick(now=new Date()){
  const s=settings();if(!s.enabled||busy||now.getUTCHours()<s.hour)return;
  const last=list().find(x=>x.reason==='automatic');const elapsed=last?now-new Date(last.created_at):Infinity;
  if(elapsed<(s.frequency==='weekly'?7:1)*86400000)return;
  try{await create('automatic');}catch(error){console.error('[backup]',error.message);}
}
function start(){const timer=setInterval(()=>tick(),60000);timer.unref();const first=setTimeout(()=>tick(),15000);first.unref();return()=>{clearInterval(timer);clearTimeout(first);};}
module.exports={create,list,file,remove,restore,settings,saveSettings,tick,start,importArchive,directory,isBusy:()=>busy};
