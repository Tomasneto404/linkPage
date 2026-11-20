// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {db}=require('../config/db');
const models=require('../models');
const DAY=86400000;
const periods={today:1,'7d':7,'30d':30,'90d':90,all:null};
const stamp=value=>new Date(value).toISOString().slice(0,19).replace('T',' ');
const botWords=['bot','spider','crawler','headless','curl','wget','python-requests','uptime'];
const botSql='('+botWords.map(()=>"LOWER(COALESCE(c.user_agent,'')) LIKE ?").join(' OR ')+')';
const botParams=botWords.map(word=>'%'+word+'%');
function selection(query={},now=Date.now()){
  const period=Object.hasOwn(periods,query.period)?query.period:'30d';
  const group=query.group_id===undefined||query.group_id===''?null:Number(query.group_id);
  if(group!==null&&(!Number.isSafeInteger(group)||group<1||!models.getGroupById(group)))throw Object.assign(new Error('Choose an existing group'),{status:400});
  const end=Math.floor(now/1000)*1000+1000,start=periods[period]?end-periods[period]*DAY:null;
  return {period,group_id:group,exclude_bots:query.exclude_bots==='true'||query.exclude_bots==='1',start,end,now};
}
function scope(s,start=s.start,end=s.end){
  const clauses=['c.clicked_at < ?'],params=[stamp(end)];
  if(start!==null){clauses.push('c.clicked_at >= ?');params.push(stamp(start));}
  if(s.group_id!==null){clauses.push('EXISTS (SELECT 1 FROM link_groups lg WHERE lg.link_id=c.link_id AND lg.group_id=?)');params.push(s.group_id);}
  if(s.exclude_bots){clauses.push('NOT '+botSql);params.push(...botParams);}
  return {where:clauses.join(' AND '),params};
}
function catalogue(s){return s.group_id===null?{where:'1=1',params:[]}:{where:'EXISTS (SELECT 1 FROM link_groups lg WHERE lg.link_id=l.id AND lg.group_id=?)',params:[s.group_id]};}
function totals(s,start=s.start,end=s.end){
  const t=scope(s,start,end);
  return db.prepare(`SELECT COUNT(*) AS total_clicks,COUNT(DISTINCT NULLIF(c.ip_address,'')) AS unique_visitors,COUNT(DISTINCT c.link_id) AS active_links FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${t.where}`).get(...t.params);
}
function linkRows(s,limit=10){
  const t=scope(s);
  return db.prepare(`SELECT l.id,l.name,l.url,l.file_name,COUNT(*) AS total_clicks,COUNT(DISTINCT NULLIF(c.ip_address,'')) AS unique_visitors,MAX(c.clicked_at) AS last_clicked FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${t.where} GROUP BY l.id,l.name,l.url,l.file_name ORDER BY total_clicks DESC,last_clicked DESC,l.id ASC LIMIT ?`).all(...t.params,limit);
}
function agents(agent){
  const value=String(agent||'');
  const automated=botWords.some(word=>value.toLowerCase().includes(word));
  const device=automated?'Automated':/iPad|Tablet|Android(?!.*Mobile)/i.test(value)?'Tablet':/Mobi|iPhone|iPod/i.test(value)?'Mobile':/Windows|Macintosh|X11|Linux/i.test(value)?'Desktop':'Unknown';
  const browser=automated?'Automated':/Edg\//.test(value)?'Edge':/OPR\//.test(value)?'Opera':/Firefox|FxiOS/.test(value)?'Firefox':/Chrome|CriOS/.test(value)?'Chrome':/Safari/.test(value)?'Safari':'Other / unknown';
  return {device,browser,automated};
}
function distribution(s){
  const t=scope(s),rows=db.prepare(`SELECT c.user_agent,COUNT(*) AS clicks FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${t.where} GROUP BY c.user_agent ORDER BY clicks DESC LIMIT 1000`).all(...t.params);
  const devices=new Map(),browsers=new Map();let classified=0;
  for(const row of rows){const item=agents(row.user_agent);classified+=row.clicks;devices.set(item.device,(devices.get(item.device)||0)+row.clicks);browsers.set(item.browser,(browsers.get(item.browser)||0)+row.clicks);}
  const sorted=map=>[...map].map(([name,clicks])=>({name,clicks})).sort((a,b)=>b.clicks-a.clicks);
  return {devices:sorted(devices),browsers:sorted(browsers),classified_clicks:classified};
}
function trend(s,start=s.start,end=s.end,monthly=false){
  const t=scope(s,start,end),length=monthly?7:10;
  return db.prepare(`SELECT SUBSTR(c.clicked_at,1,${length}) AS day,COUNT(*) AS clicks FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${t.where} GROUP BY day ORDER BY day`).all(...t.params);
}
function dashboard(s){
  const t=scope(s),cat=catalogue(s),current=totals(s),previous=s.start===null?null:totals(s,s.start-(s.end-s.start),s.start);
  const total_links=db.prepare(`SELECT COUNT(*) AS n FROM links l WHERE ${cat.where}`).get(...cat.params).n;
  const first=db.prepare(`SELECT MIN(c.clicked_at) AS first FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${t.where}`).get(...t.params).first;
  const oldest=first?Date.parse(first.replace(' ','T')+'Z'):s.end,monthly=s.start===null&&s.end-oldest>120*DAY;
  const series=trend(s),chart=monthly?trend(s,s.start,s.end,true):series;
  const previousTrend=previous?trend(s,s.start-(s.end-s.start),s.start):[];
  const top_users=db.prepare(`SELECT c.ip_address,tg.tag,COUNT(*) AS click_count,MAX(c.clicked_at) AS last_seen FROM link_clicks c JOIN links l ON l.id=c.link_id LEFT JOIN ip_tags tg ON tg.ip_address=c.ip_address WHERE ${t.where} AND c.ip_address IS NOT NULL AND c.ip_address<>'' GROUP BY c.ip_address,tg.tag ORDER BY click_count DESC,last_seen DESC LIMIT 5`).all(...t.params);
  const top_groups=db.prepare(`SELECT g.id,g.name,COUNT(*) AS clicks,COUNT(DISTINCT c.link_id) AS links FROM link_clicks c JOIN links l ON l.id=c.link_id JOIN link_groups membership ON membership.link_id=l.id JOIN groups g ON g.id=membership.group_id WHERE ${t.where}${s.group_id!==null?' AND g.id=?':''} GROUP BY g.id,g.name ORDER BY clicks DESC,g.id LIMIT 8`).all(...t.params,...(s.group_id!==null?[s.group_id]:[]));
  const unclicked=db.prepare(`SELECT l.id,l.name,l.url,l.file_name,l.created_at FROM links l WHERE ${cat.where} AND NOT EXISTS (SELECT 1 FROM link_clicks c WHERE c.link_id=l.id AND ${t.where}) ORDER BY l.created_at ASC,l.id ASC LIMIT 8`).all(...cat.params,...t.params);
  const recent=db.prepare(`SELECT l.id,l.name,c.clicked_at,c.ip_address,tg.tag,c.user_agent FROM link_clicks c JOIN links l ON l.id=c.link_id LEFT JOIN ip_tags tg ON tg.ip_address=c.ip_address WHERE ${t.where} ORDER BY c.clicked_at DESC,c.id DESC LIMIT 12`).all(...t.params).map(({user_agent,...row})=>({...row,...agents(user_agent)}));
  const heatStart=s.start===null?s.end-365*DAY:s.start,h=scope(s,heatStart),hourRows=db.prepare(`SELECT SUBSTR(c.clicked_at,1,13) AS bucket,COUNT(*) AS clicks FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${h.where} GROUP BY bucket`).all(...h.params);
  const heatmap=Array.from({length:7},()=>Array(24).fill(0));
  for(const row of hourRows){const instant=new Date(row.bucket.replace(' ','T')+':00:00Z');if(!Number.isNaN(+instant))heatmap[(instant.getUTCDay()+6)%7][instant.getUTCHours()]+=row.clicks;}
  const breakdown=distribution(s),difference=Math.max(0,current.total_clicks-breakdown.classified_clicks);if(difference){breakdown.devices.push({name:'Unclassified',clicks:difference});breakdown.browsers.push({name:'Unclassified',clicks:difference});}
  const automated=db.prepare(`SELECT COUNT(*) AS n FROM link_clicks c JOIN links l ON l.id=c.link_id WHERE ${t.where} AND ${botSql}`).get(...t.params,...botParams).n;
  const peak=series.reduce((best,row)=>!best||row.clicks>best.clicks?row:best,null);
  const change=(value,before)=>before?Math.round((value-before)/before*1000)/10:null;
  return {
    period:s.period,group_id:s.group_id,exclude_bots:s.exclude_bots,generated_at:new Date(s.now).toISOString(),
    window:{start:s.start===null?first:stamp(s.start),end:stamp(s.end),timezone:'UTC',bucket:monthly?'month':'day',heatmap_start:stamp(heatStart)},
    totals:{...current,total_links,unclicked_links:Math.max(0,total_links-current.active_links),clicks_per_visitor:current.unique_visitors?Math.round(current.total_clicks/current.unique_visitors*10)/10:0,automated_clicks:automated,clicks_today:totals(s,s.end-DAY).total_clicks,clicks_this_week:totals(s,s.end-7*DAY).total_clicks},
    comparison:previous?{previous,clicks_change:change(current.total_clicks,previous.total_clicks),visitors_change:change(current.unique_visitors,previous.unique_visitors),active_links_change:change(current.active_links,previous.active_links),start:stamp(s.start-(s.end-s.start)),end:stamp(s.start)}:null,
    trend:chart,previous_trend:previousTrend,peak_day:peak,top_links:linkRows(s),top_users,top_groups,unclicked_links:unclicked,recent,heatmap,...breakdown,
    groups:models.getAllGroups().map(({id,name})=>({id,name})),
  };
}
function exportRows(s){
  const t=scope(s),cat=catalogue(s);
  return db.prepare(`SELECT l.id,l.name,l.url,l.file_name,COALESCE(a.clicks,0) AS clicks,COALESCE(a.visitors,0) AS unique_ips,a.last_clicked FROM links l LEFT JOIN (SELECT c.link_id,COUNT(*) AS clicks,COUNT(DISTINCT NULLIF(c.ip_address,'')) AS visitors,MAX(c.clicked_at) AS last_clicked FROM link_clicks c WHERE ${t.where} GROUP BY 1) a ON a.link_id=l.id WHERE ${cat.where} ORDER BY clicks DESC,l.id ASC`).all(...t.params,...cat.params);
}
module.exports={selection,dashboard,exportRows,agents};
