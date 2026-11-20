// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {XMLParser}=require('fast-xml-parser');
const {publicOnlyDispatcher}=require('../utils/networkGuard');
const {sourceUrl}=require('./widgetConfig');
const publicDispatcher=publicOnlyDispatcher({timeoutMs:7000});
const array=value=>Array.isArray(value)?value:value?[value]:[];
const text=value=>String(typeof value==='object'?value?.['#text']||'':value||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|apos);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[s]||s)).replace(/\s+/g,' ').trim();
function articleUrl(value,base){if(!value)return null;try{return sourceUrl(new URL(value,base).href).href;}catch{return null;}}
async function read(response){
  if(!response.ok){await response.body?.cancel();throw new Error('Source is unavailable');}
  if(Number(response.headers.get('content-length'))>512*1024){await response.body?.cancel();throw new Error('Source response is too large');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>512*1024)throw new Error('Source response is too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}
async function fetchSource(address,{allowPrivate=false,token,fetcher=fetch}={}){
  let current=sourceUrl(address);
  for(let i=0;i<5;i++){
    const response=await fetcher(current.href,{signal:AbortSignal.timeout(8000),redirect:'manual',headers:{Accept:token?'application/json':'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8','User-Agent':'LinkPage widgets',...(token?{'X-Gotify-Key':token}:{})},...(allowPrivate?{}:{dispatcher:publicDispatcher})});
    if(response.status>=300&&response.status<400){await response.body?.cancel();if(token)throw new Error('Authenticated sources cannot redirect');current=sourceUrl(new URL(response.headers.get('location'),current).href);continue;}
    return read(response);
  }
  throw new Error('Too many source redirects');
}
function rss(input,base,{limit=10,filter=''}={}){
  if(/<!DOCTYPE|<!ENTITY/i.test(input))throw new Error('Feed declarations are not supported');
  const doc=new XMLParser({ignoreAttributes:false,processEntities:false}).parse(input);
  const channel=doc.rss?.channel||doc.feed||doc['rdf:RDF'];
  if(!channel)throw new Error('This source is not an RSS or Atom feed');
  const entries=channel.item||channel.entry;
  const items=array(entries).slice(0,200).map(entry=>{
    const link=typeof entry.link==='string'?entry.link:array(entry.link).find(l=>!l['@_rel']||l['@_rel']==='alternate')?.['@_href'];
    const description=entry.description||entry.summary||entry.content;
    const thumbnail=array(entry['media:thumbnail'])[0]?.['@_url']||array(entry['media:content'])[0]?.['@_url']||array(entry.enclosure).find(item=>String(item['@_type']).startsWith('image/'))?.['@_url']||String(typeof description==='string'?description:'').match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    return {title:text(entry.title).slice(0,240)||'Untitled',url:articleUrl(link,base),description:text(description).slice(0,400),date:text(entry.pubDate||entry.published||entry.updated),image:articleUrl(thumbnail,base)};
  }).filter(item=>item.url&&(!filter||item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))).slice(0,limit);
  return {title:text(channel.title).slice(0,160),items};
}
function note(config){
  if(config.format!=='markdown')return {text:config.text,format:'plain'};
  const tasks=[],marker='LPTask'+require('node:crypto').randomUUID().replaceAll('-','');let fenced=false;
  const source=config.text.split('\n').map((line,index)=>{
    if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;return line;}
    const match=!fenced&&line.match(/^(\s{0,3}[-*+]\s+)\[([ xX])\]\s+(.*)$/);if(!match)return line;
    const task={line:index,checked:match[2].toLowerCase()==='x',label:match[3]};tasks.push(task);
    return match[1]+marker+index+' '+match[3];
  }).join('\n');
  let html=require('./markdownService').renderMarkdown(source).replace(/<img\b[^>]*>/gi,'');
  for(const task of tasks)html=html.replace(marker+task.line,`<input type="checkbox" data-task-line="${task.line}" aria-label="${require('./markdownService').escapeHtml(text(task.label).slice(0,160))}"${task.checked?' checked':''} disabled>`);
  // Widget links follow the same new-tab behaviour as resources.
  html=html.replace(/<a href=/g,'<a target="_blank" rel="noopener noreferrer" href=');
  return {text:config.text,format:'markdown',html,tasks};
}
async function load(row,{fetcher}={}){
  const config=row.config;
  if(row.kind==='clock')return {...config};
  if(row.kind==='note')return note(config);
  if(row.kind==='rss')return rss(await fetchSource(config.url,{allowPrivate:config.allow_private,fetcher}),config.url,{limit:config.limit??10,filter:config.filter||''});
  if(row.kind==='gotify'){
    const address=new URL(config.url);address.pathname=address.pathname.replace(/\/$/,'')+'/message';address.search='?limit=100';
    const source=JSON.parse(await fetchSource(address.href,{allowPrivate:config.allow_private,token:config.token,fetcher}));
    return {messages:array(source.messages).filter(item=>Number(item.priority||0)>=(config.min_priority||0)).slice(0,config.limit||8).map(item=>({id:String(item.id),title:text(item.title).slice(0,160),message:text(item.message).slice(0,1000),priority:Number(item.priority)||0,date:item.date}))};
  }
  const address=new URL(config.api_key?'https://customer-api.open-meteo.com/v1/forecast':'https://api.open-meteo.com/v1/forecast');
  address.search=new URLSearchParams({latitude:config.latitude,longitude:config.longitude,current:'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code,is_day',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:config.days||3,temperature_unit:config.fahrenheit?'fahrenheit':'celsius',timezone:'auto',...(config.api_key?{apikey:config.api_key}:{})}).toString();
  const source=JSON.parse(await fetchSource(address.href,{fetcher})),current=source.current;if(!Number.isFinite(current?.temperature_2m))throw new Error('Weather is unavailable');
  return {location:config.location,temperature:current.temperature_2m,unit:config.fahrenheit?'°F':'°C',code:current.weather_code,is_day:current.is_day,time:current.time,feels_like:current.apparent_temperature??null,humidity:current.relative_humidity_2m??null,wind:current.wind_speed_10m??null,wind_unit:source.current_units?.wind_speed_10m||'km/h',precipitation:current.precipitation??null,forecast:array(source.daily?.time).map((date,i)=>({date,code:source.daily.weather_code?.[i],high:source.daily.temperature_2m_max?.[i],low:source.daily.temperature_2m_min?.[i],rain:source.daily.precipitation_probability_max?.[i]}))};
}
async function locations(query){
  if(typeof query!=='string'||query.trim().length<2||query.length>80)throw Object.assign(new Error('Enter a city name with 2–80 characters'),{status:400});
  const address=new URL('https://geocoding-api.open-meteo.com/v1/search');address.search=new URLSearchParams({name:query.trim(),count:5,language:'en',format:'json'}).toString();
  const source=JSON.parse(await fetchSource(address.href));return array(source.results).slice(0,5).map(item=>({name:String(item.name||'').slice(0,100),country:String(item.country||'').slice(0,100),region:String(item.admin1||'').slice(0,100),latitude:item.latitude,longitude:item.longitude}));
}
module.exports={fetchSource,rss,load,locations,note};
