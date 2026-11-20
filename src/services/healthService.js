// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const models=require('../models');
const {db}=require('../config/db');
async function probe(url,method){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
  try {
    const response=await fetch(url,{method,signal:controller.signal,redirect:'follow',headers:{'User-Agent':'LinkPage link health checker','Accept':'text/html,*/*;q=0.8',...(method==='GET'?{Range:'bytes=0-1023'}:{})}});
    await response.body?.cancel();return response.status;
  }finally{clearTimeout(timer);}
}
async function checkLinkHealth(linkId,url){
  const old=db.prepare('SELECT * FROM link_health WHERE link_id=?').get(linkId);
  if(old?.enabled===0)return {status:'disabled'};
  let code=null,reason='Could not connect',status='unknown';
  try {
    try{code=await probe(url,'HEAD');}catch{code=null;}
    if(code===null||code>=400&&![401,407].includes(code))code=await probe(url,'GET');
    if(code>=200&&code<400){status='healthy';reason='Reachable';}
    else if([401,403,407].includes(code)){status='restricted';reason='Authentication or automated checks are restricted';}
    else if([404,410].includes(code)){status='missing';reason=`HTTP ${code}: resource not found`;}
    else {reason=code===429?'Rate limited; check later':`HTTP ${code}: temporary or unverified response`;}
  }catch(error){reason=error.name==='AbortError'?'Check timed out':error.cause?.code==='CERT_HAS_EXPIRED'||error.cause?.code==='DEPTH_ZERO_SELF_SIGNED_CERT'?'Certificate could not be verified':'Connection could not be verified';}
  const sameFailure=old?.status===status&&(status==='missing'||code===null&&old?.status_code===null);
  const failures=['healthy','restricted'].includes(status)?0:sameFailure?(old?.failures||0)+1:1;
  const broken=status==='missing'?failures>=2:status==='unknown'&&code===null&&failures>=3;
  db.prepare('INSERT INTO link_health(link_id,status,status_code,reason,failures,checked_at,enabled) VALUES(?,?,?,?,?,?,1) ON CONFLICT(link_id) DO UPDATE SET status=excluded.status,status_code=excluded.status_code,reason=excluded.reason,failures=excluded.failures,checked_at=excluded.checked_at').run(linkId,status,code,reason,failures,new Date().toISOString());
  models.updateLinkBrokenStatus(linkId,broken);
  return {status,code,reason,failures,broken};
}
let running=false;
async function runHealthCheck(){
  if(running)return;running=true;
  try{for(const link of models.getAllLinksForHealthCheck()){if(!/^https?:\/\//i.test(link.url))continue;await checkLinkHealth(link.id,link.url);}}
  finally{running=false;}
}
module.exports={checkLinkHealth,runHealthCheck};
