// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Engine-neutral logical snapshots. Imported rows are verified inside the
 * transaction; an error rolls the target back and never changes the source. */
const fs=require('node:fs');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const identifier=name=>{if(!/^[a-z_][a-z0-9_]*$/i.test(name))throw new Error('Invalid database identifier');return '"'+name+'"';};
function tables(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name).filter(n=>!n.startsWith('sqlite_'));}
function signature(rows,columns){return crypto.createHash('sha256').update(JSON.stringify(rows.map(row=>columns.map(key=>row[key]??null)).map(row=>JSON.stringify(row)).sort())).digest('hex');}
function capture(db){
  const data={format:'linkpage-database',version:1,schema_version:Number(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get()?.value),tables:{},sequences:{}};
  db.exec(db.dialect==='postgresql'?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN');
  try {
    for(const table of tables(db)){
      data.tables[table]=db.prepare(`SELECT * FROM ${identifier(table)}`).all();
      if(db.dialect==='postgresql'&&db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='id')){
        data.sequences[table]=db.prepare("SELECT last_value FROM pg_sequences WHERE schemaname=current_schema() AND sequencename=(SELECT relname FROM pg_class WHERE oid=pg_get_serial_sequence(?, 'id')::regclass)").get(`${identifier(db.schema)}.${identifier(table)}`)?.last_value||0;
      }
    }
    if(db.dialect!=='postgresql')for(const row of db.prepare('SELECT name,seq FROM sqlite_sequence').all())data.sequences[row.name]=row.seq;
    db.exec('COMMIT');return data;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function validate(data){
  if(data?.format!=='linkpage-database'||data.version!==1||!data.tables?.settings||!data.tables?.links)throw new Error('Invalid database snapshot');
  for(const [table,rows]of Object.entries(data.tables)){identifier(table);if(!Array.isArray(rows))throw new Error('Invalid table snapshot');}
  return data;
}
function restore(db,data,{emptyOnly=false,allowOlder=false}={}){
  validate(data);const existing=tables(db),current=Number(db.prepare("SELECT value FROM settings WHERE key='schema_version'").get()?.value);
  if(data.schema_version!==current&&!(allowOlder&&data.schema_version<=current))throw new Error('Restore requires the same database schema version');
  if(Object.keys(data.tables).some(name=>!existing.includes(name)))throw new Error('Snapshot contains unknown tables');
  db.exec('BEGIN');
  try {
    if(emptyOnly&&existing.some(table=>table!=='settings'&&db.prepare(`SELECT COUNT(*) AS n FROM ${identifier(table)}`).get().n>0))throw new Error('Migration target must be empty; existing PostgreSQL data was not changed');
    for(const table of existing)db.exec(`DELETE FROM ${identifier(table)}`);
    let total=0;const counts={};
    for(const [table,input]of Object.entries(data.tables)) {
      const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
      for(const row of input){const keys=Object.keys(row).filter(k=>columns.includes(k));if(!keys.length)throw new Error('Snapshot columns do not match');db.prepare(`INSERT INTO ${identifier(table)} (${keys.map(identifier).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
      const keys=input.length?Object.keys(input[0]).filter(k=>columns.includes(k)):columns;
      const actual=db.prepare(`SELECT * FROM ${identifier(table)}`).all();
      if(actual.length!==input.length||signature(input,keys)!==signature(actual,keys))throw new Error(`Verification failed for ${table}`);
      counts[table]=actual.length;total+=actual.length;
      if(db.dialect==='postgresql'&&columns.includes('id')){
        const max=db.prepare(`SELECT COALESCE(MAX(id),0) AS n FROM ${identifier(table)}`).get().n;
        const last=Math.max(max,Number(data.sequences?.[table])||0);
        if(!Number.isSafeInteger(last)||last<0)throw new Error('Invalid identity sequence in snapshot');
        db.exec(`ALTER TABLE ${identifier(table)} ALTER COLUMN id RESTART WITH ${last+1}`);
      }
    }
    db.prepare("UPDATE settings SET value=? WHERE key='schema_version'").run(String(current));
    // Older SQLite snapshots predate group addresses; establish them once.
    for(const group of db.prepare('SELECT id,name FROM groups WHERE slug IS NULL').all()){
      const base=require('../utils/slug').normalizeSlug(group.name)||'group';const slug=db.prepare('SELECT id FROM groups WHERE slug=?').get(base)?base.slice(0,54)+'-'+group.id:base;
      db.prepare('UPDATE groups SET slug=? WHERE id=?').run(slug,group.id);
    }
    db.exec('COMMIT');return {tables:counts,rows:total,verified:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
function fromSQLite(filename){
  const source=new DatabaseSync(filename,{readOnly:true});
  try{return capture(source);}finally{source.close();}
}
function write(filename,db){fs.writeFileSync(filename,JSON.stringify(capture(db)),{mode:0o600});}
module.exports={tables,capture,restore,fromSQLite,write,validate};
