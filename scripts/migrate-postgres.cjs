// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const fs=require('node:fs');const path=require('node:path');
if(!process.env.DATABASE_URL&&process.env.DB_ENGINE!=='postgresql'){console.error('Set DATABASE_URL or DB_ENGINE=postgresql and PG connection settings to an empty target first.');process.exit(1);}
// This command owns the import, even when .env enables automatic boot imports.
process.env.MIGRATE_SQLITE='0';
process.env.LINKPAGE_MIGRATION_COMMAND='1';
const source=path.resolve(process.argv[2]||path.join(process.env.DATA_DIR||'data','links.db'));
if(!fs.existsSync(source)){console.error('SQLite source does not exist.');process.exit(1);}
let db;
try{
  const snapshots=require('../src/services/databaseSnapshot');
  const data=snapshots.fromSQLite(source);
  db=require('../src/config/db').db;
  const result=snapshots.restore(db,data,{emptyOnly:true,allowOlder:true});
  db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run('sqlite_migrated',new Date().toISOString());
  console.log(JSON.stringify({source,engine:db.dialect,...result,source_unchanged:true},null,2));
}catch(error){console.error('Migration stopped:',error.message);process.exitCode=1;}
finally{db?.destroy?.();}
