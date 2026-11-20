// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const invalid=message=>Object.assign(new Error(message),{status:400});
function integer(value,fallback,min,max,label){const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)throw invalid(`Invalid ${label}`);return n;}
function choice(value,fallback,values,label){const selected=value??fallback;if(!values.includes(selected))throw invalid(`Invalid ${label}`);return selected;}
function sourceUrl(value){let parsed;try{parsed=new URL(value);}catch{throw invalid('Enter a valid source URL');}if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw invalid('Use HTTP or HTTPS without credentials in the URL');return parsed;}
function timeZone(zone){if(zone!=='local')try{new Intl.DateTimeFormat('en',{timeZone:zone});}catch{throw invalid('Enter a valid time zone');}return zone;}
function layout(value={},legacy=null,previous){
  const groups=value.group_ids??previous?.group_ids??(legacy?[legacy]:[]);
  if(!Array.isArray(groups)||groups.length>30||groups.some(id=>!Number.isInteger(Number(id))||Number(id)<1))throw invalid('Choose valid widget groups');
  const pixels=value.height_px===undefined?previous?.height_px??null:value.height_px;
  return {width:integer(value.width,previous?.width??1,1,3,'widget width'),height:choice(value.height,previous?.height??'auto',['auto','compact','tall'],'widget height'),...(pixels===null?{}:{height_px:integer(pixels,undefined,180,1000,'widget height in pixels')}),device:choice(value.device,previous?.device??'all',['all','desktop','mobile'],'device visibility'),group_ids:[...new Set(groups.map(Number))]};
}
function clean(body,previous){
  if(!body||typeof body!=='object'||Array.isArray(body))throw invalid('Invalid widget');
  for(const key of ['config','layout'])if(body[key]!==undefined&&(!body[key]||typeof body[key]!=='object'||Array.isArray(body[key])))throw invalid(`Invalid widget ${key}`);
  const kind=body.kind||previous?.kind;if(!['clock','rss','weather','gotify','note'].includes(kind))throw invalid('Choose a widget type');
  const title=String(body.title??previous?.title??'').trim();if(!title||title.length>100)throw invalid('Give the widget a title of up to 100 characters');
  const old=previous?.kind===kind?previous.config:{};
  const config={...old,...(body.config||{})};
  // Blank password fields preserve the server's saved credentials.
  for(const key of ['token','api_key'])if(body.config?.[key]===''&&old[key])config[key]=old[key];
  const layoutInput={...(body.layout||{})};
  if(body.group_id!==undefined&&!Object.hasOwn(layoutInput,'group_ids'))layoutInput.group_ids=body.group_id?[body.group_id]:[];
  const display=layout(layoutInput,previous?.group_id,previous?.layout);
  const models=require('../models');for(const id of display.group_ids)if(!models.getGroupById(id))throw invalid('Choose existing shared groups');
  const settings={refresh_seconds:integer(config.refresh_seconds,300,60,3600,'refresh interval')};
  if(kind==='clock'){
    settings.timezone=timeZone(String(config.timezone||'local'));
    settings.hour12=config.hour12===true;settings.seconds=config.seconds!==false;
    settings.mode=choice(config.mode,'digital',['digital','analog'],'clock mode');
    const zones=config.zones??[];if(!Array.isArray(zones)||zones.length>4)throw invalid('Use up to four additional time zones');
    settings.zones=zones.map(entry=>{if(!entry||typeof entry!=='object'||Array.isArray(entry))throw invalid('Choose valid additional time zones');return {timezone:timeZone(String(entry.timezone||'local')),label:String(entry.label||entry.timezone||'Local').trim().slice(0,60)};});
  }
  if(kind==='rss'||kind==='gotify'){
    settings.url=sourceUrl(config.url).href;settings.allow_private=config.allow_private===true;
    settings.limit=integer(config.limit,kind==='rss'?10:8,1,30,'item count');
    if(kind==='rss'){
      settings.view=choice(config.view,'list',['list','cards'],'feed layout');settings.show_images=config.show_images===true;
      settings.show_description=config.show_description!==false;settings.filter=String(config.filter||'').trim().slice(0,160);
    }else{
      settings.token=String(config.token||'');if(!settings.token||settings.token.length>500)throw invalid('Enter a Gotify client token');
      settings.min_priority=integer(config.min_priority,0,0,10,'minimum priority');settings.unread_only=config.unread_only===true;
    }
  }
  if(kind==='weather'){
    const latitude=Number(config.latitude),longitude=Number(config.longitude);
    if(!Number.isFinite(latitude)||latitude < -90||latitude>90||!Number.isFinite(longitude)||longitude < -180||longitude>180)throw invalid('Enter valid latitude and longitude');
    Object.assign(settings,{latitude,longitude,location:String(config.location||title).slice(0,100),fahrenheit:config.fahrenheit===true,api_key:String(config.api_key||'').slice(0,500),days:integer(config.days,3,1,7,'forecast days')});
  }
  if(kind==='note'){settings.text=String(config.text||'');if(settings.text.length>20000)throw invalid('Keep notes under 20,000 characters');settings.format=choice(config.format,'plain',['plain','markdown'],'note format');}
  return {kind,title,group_id:display.group_ids.length===1?display.group_ids[0]:null,enabled:body.enabled===undefined?previous?.enabled??true:body.enabled===true,config:settings,layout:display};
}
module.exports={clean,layout,sourceUrl,invalid};
