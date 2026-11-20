// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test}=require('node:test');const assert=require('node:assert/strict');
test('PostgreSQL transactions preserve parameters and recover after a lost connection',{skip:!process.env.LINKPAGE_TEST_POSTGRES_URL},async()=>{
  const connectionString=process.env.LINKPAGE_TEST_POSTGRES_URL;
  const schema='lp_driver_'+require('node:crypto').randomUUID().replaceAll('-','');
  const db=require('../src/config/postgres').connect(connectionString,schema),client=new (require('pg').Client)({connectionString});
  try{
    await client.connect();db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY AUTOINCREMENT,value TEXT UNIQUE)');
    const malicious="Value'; DROP TABLE sample; --";const inserted=db.prepare('INSERT INTO sample(value) VALUES(?)').run(malicious);assert.equal(inserted.lastInsertRowid,1);assert.equal(db.prepare('SELECT value FROM sample').get().value,malicious);
    db.exec('BEGIN');db.prepare('INSERT INTO sample(value) VALUES(?)').run('Rolled back');db.exec('ROLLBACK');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n,1);
    const pid=db.prepare('SELECT pg_backend_pid() AS pid').get().pid;await client.query('SELECT pg_terminate_backend($1)',[pid]);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n,1,'new operations reconnect');
    db.exec('BEGIN');db.prepare('INSERT INTO sample(value) VALUES(?)').run('Lost transaction');const second=db.prepare('SELECT pg_backend_pid() AS pid').get().pid;await client.query('SELECT pg_terminate_backend($1)',[second]);await new Promise(resolve=>setTimeout(resolve,100));assert.throws(()=>db.exec('COMMIT'),/lost during a transaction/);db.exec('ROLLBACK');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample').get().n,1,'failed transactions are never reported as committed');
  }finally{try{db.exec(`DROP SCHEMA "${schema}" CASCADE`);}finally{db.destroy();await client.end();}}
});
