// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {workerData}=require('node:worker_threads');
const {Client,types}=require('pg');
const {translate,statements}=require('./postgresSql');
const {port,signal,connectionString,schema}=workerData;
const ready=new Int32Array(signal);
types.setTypeParser(20, value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('Database integer exceeds JavaScript safe range');return n;});
types.setTypeParser(1700, value=>Number(value));
let client;
let lost=false,inTransaction=false;
const hasId=new Map();
async function open(){
  client=new Client({...(typeof connectionString==='string'?{connectionString}:connectionString),connectionTimeoutMillis:10000,statement_timeout:30000,application_name:'LinkPage'});
  client.on('error',()=>{lost=true;});
  await client.connect();
  if(schema!=='public')await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  lost=false;
}
function reply(value){port.postMessage(value);Atomics.store(ready,0,1);Atomics.notify(ready,0);}
async function query(input,values=[],method){
  const translated=translate(input);let sql=translated.sql;
  if(lost){
    if(inTransaction&&!/^ROLLBACK\b/i.test(sql))throw new Error('PostgreSQL connection was lost during a transaction; retry the operation');
    if(/^ROLLBACK\b/i.test(sql)){inTransaction=false;await open();return {rows:[],changes:0,lastInsertRowid:0};}
    await open();
  }
  if(method==='run'&&/^INSERT\b/i.test(sql)&&! /\bRETURNING\b/i.test(sql)){
    const table=sql.match(/^INSERT INTO\s+(\w+)/i)?.[1];
    if(table&&!hasId.has(table))hasId.set(table,(await client.query('SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=\'id\'',[table])).rowCount>0);
    if(hasId.get(table))sql+=' RETURNING id';
  }
  const result=await client.query(sql,translated.params||values);
  if(/^BEGIN\b/i.test(sql))inTransaction=true;
  if(/^(COMMIT|ROLLBACK)\b/i.test(sql))inTransaction=false;
  return {rows:result.rows||[],changes:result.rowCount||0,lastInsertRowid:result.rows?.[0]?.id||0};
}
port.on('message',async message=>{
  try {
    let result;
    if(message.action==='open'){await open();result={};}
    else if(message.action==='close'){await client.end();result={};}
    else if(message.action==='exec'){for(const sql of statements(message.sql))await query(sql);result={};}
    else result=await query(message.sql,message.values,message.action);
    reply({result});
  }catch(error){reply({error:{message:error.message,code:error.code,detail:error.detail}});}
});
open().then(()=>reply({result:{}})).catch(error=>reply({error:{message:error.message,code:error.code}}));
