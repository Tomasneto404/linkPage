// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** A dedicated PostgreSQL connection owns each transaction. The worker keeps
 * the existing synchronous model contract during this database transition;
 * all SQL and persistence happen in PostgreSQL, never in a local mirror. */
const path=require('node:path');
const {Worker,MessageChannel,receiveMessageOnPort}=require('node:worker_threads');
function connect(connectionString,schema=process.env.DATABASE_SCHEMA||'public'){
  if(!/^[a-z_][a-z0-9_]{0,62}$/i.test(schema))throw new Error('Invalid database schema');
  const signal=new SharedArrayBuffer(4),state=new Int32Array(signal);
  const {port1,port2}=new MessageChannel();
  const worker=new Worker(path.join(__dirname,'postgresWorker.js'),{workerData:{connectionString,schema,signal,port:port2},transferList:[port2]});
  worker.unref();port1.unref();
  worker.on('error',()=>{});
  function receive(){
    if(Atomics.wait(state,0,0,35000)==='timed-out')throw new Error('PostgreSQL connection timed out');
    const message=receiveMessageOnPort(port1)?.message;
    if(!message)throw new Error('PostgreSQL worker did not respond');
    if(message.error){const error=new Error(message.error.message);error.code=message.error.code;error.detail=message.error.detail;throw error;}
    return message.result;
  }
  receive();
  function send(action,sql,values){Atomics.store(state,0,0);port1.postMessage({action,sql,values});return receive();}
  let closed=false;
  return {
    dialect:'postgresql',schema,
    prepare(sql){return {all:(...values)=>send('all',sql,values).rows,get:(...values)=>send('get',sql,values).rows[0],run:(...values)=>send('run',sql,values)};},
    exec:sql=>send('exec',sql),
    close(){if(!closed){send('close');closed=true;}},
    open(){if(closed){send('open');closed=false;}},
    destroy(){try{this.close();}finally{port1.close();worker.terminate();}},
  };
}
module.exports={connect};
