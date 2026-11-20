// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const invalid=message=>Object.assign(new Error(message),{status:400});
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const models = require('../models');
const history = require('../models/workspace');
const { UPLOADS_DIR } = require('../config/env');
const calendar = require('../../public/season-calendar');
const KEYS = ['ambient_speed','ambient_colors','ambient_effect','ambient_blend','ambient_background','motion_style','site_title','accent_color','accent_dark_adjust','accent_glow','theme_light_variant','theme_dark_variant','default_theme','season_theme','season_schedule','season_effects','season_background','wallpaper_light','wallpaper_dark','wallpaper_fog','bar_opacity','logo_light','logo_dark','brand_icon','favicon','footer_enabled','mobile_nav_position','group_tab_color','group_tabs_loop'];
const ASSETS = ['wallpaper_light','wallpaper_dark','logo_light','logo_dark','brand_icon','favicon'];
const ENUMS = { ambient_blend:['separate','particles','season'],ambient_background:['off','aurora','mesh','waves','starlight','orbital','prism','custom'],motion_style:['off','subtle','smooth','spring'],theme_light_variant:['default','snow','warm'],theme_dark_variant:['default','midnight','slate'],default_theme:['system','light','dark','daylight'],season_theme:['none',...calendar.names],season_background:['minimal','static','animated'],mobile_nav_position:['top','bottom'] };
function snapshot() { return Object.fromEntries(KEYS.map(key=>[key,models.readSetting(key)]).filter(([,v])=>v !== null)); }
function record(title, actorId) { history.addVersion('settings',0,title,JSON.stringify(snapshot()),actorId); }
function validate(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw invalid('Invalid appearance settings');
  const clean = {};
  for (const [key,value] of Object.entries(settings)) {
    if (!KEYS.includes(key) || typeof value !== 'string' || value.length > (key === 'season_schedule' ? 12000 : 300)) throw invalid(`Invalid setting: ${key}`);
    if (ENUMS[key] && !ENUMS[key].includes(value)) throw invalid(`Invalid value for ${key}`);
    if (key === 'accent_color' && !/^#[0-9a-f]{6}$/i.test(value)) throw invalid('Invalid accent colour');
    if (ASSETS.includes(key) && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(value)) throw invalid('Images must belong to this instance');
    if (['wallpaper_fog','bar_opacity'].includes(key) && (!/^\d{1,3}$/.test(value) || Number(value)>100)) throw invalid(`Invalid ${key}`);
    if (['accent_dark_adjust','accent_glow','season_effects','footer_enabled','group_tab_color','group_tabs_loop'].includes(key) && !['0','1'].includes(value)) throw invalid(`Invalid ${key}`);
    if (key === 'season_schedule') {
      try { calendar.validate(JSON.parse(value)); }
      catch { throw invalid('Invalid seasonal calendar'); }
    }
    if(['ambient_speed','ambient_colors','ambient_effect'].includes(key))try{require('../../public/ambient-settings').validate({[key]:value});}catch(error){throw invalid(error.message);}
    clean[key] = value;
  }
  return clean;
}
function apply(settings, actorId) {
  const clean = validate(settings);
  record('Before appearance restore',actorId);
  const { db } = require('../config/db'); db.exec('BEGIN');
  try { for (const key of KEYS) { if (Object.hasOwn(clean,key)) models.writeSetting(key,clean[key]); else models.deleteSetting(key); } db.exec('COMMIT'); }
  catch(error) { db.exec('ROLLBACK'); throw error; }
  record('Appearance restored',actorId);
  return snapshot();
}
function pack(settings = snapshot()) {
  const assets = {};
  let total = 0;
  for(const key of ASSETS) {
    const stored=settings[key]; if(!stored) continue;
    const full=path.join(UPLOADS_DIR,path.basename(stored));
    if(!fs.existsSync(full)) continue;
    if(fs.statSync(full).size + total > 15*1024*1024) throw invalid('Preset images exceed 15 MB');
    const bytes=fs.readFileSync(full); total+=bytes.length; assets[key]={name:path.basename(full),base64:bytes.toString('base64')};
  }
  return {format:'linkpage-appearance',version:1,settings,assets};
}
function unpack(payload) {
  if(payload?.format!=='linkpage-appearance' || payload.version!==1) throw invalid('Not a LinkPage appearance preset');
  const settings=validate(payload.settings), staged=[];
  let total=0;
  for(const [key,asset] of Object.entries(payload.assets || {})) {
    if(!ASSETS.includes(key) || typeof asset?.base64!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) throw invalid('Invalid preset image');
    const ext=path.extname(String(asset.name)).toLowerCase();
    if(!['.png','.jpg','.jpeg','.gif','.webp','.ico','.svg'].includes(ext)) throw invalid('Preset images must be PNG, JPEG, GIF, WebP, ICO or safe SVG');
    const bytes=Buffer.from(asset.base64,'base64'); total+=bytes.length;
    if(!bytes.length || total>15*1024*1024) throw invalid('Preset images exceed 15 MB');
    const magic=bytes.subarray(0,16);
    const safeSVG=()=>{const text=bytes.toString('utf8');const allowed=new Set(['svg','path','g','defs','lineargradient','radialgradient','stop','circle','ellipse','rect','line','polyline','polygon','title','desc','clippath','mask','pattern','symbol','text','tspan']);return /<svg\b/i.test(text)&&!/(?:<!|\bon[a-z]+\s*=|\b(?:href|src|style)\s*=|javascript:)/i.test(text)&&[...text.matchAll(/<\/?([a-zA-Z_][\w:.-]*)\b/g)].every(m=>allowed.has(m[1].toLowerCase()));};
    const valid=ext==='.svg'?safeSVG():ext==='.png'?magic.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(ext)?magic[0]===255&&magic[1]===216:ext==='.gif'?magic.toString('ascii',0,3)==='GIF':ext==='.webp'?magic.toString('ascii',0,4)==='RIFF'&&magic.toString('ascii',8,12)==='WEBP':magic.length>=4&&magic.readUInt16LE(0)===0;
    if(!valid) throw invalid('Preset image does not match its file type');
    const name=`preset-${crypto.randomUUID()}${ext}`; staged.push({name,bytes}); settings[key]=`/uploads/${name}`;
  }
  for(const key of ASSETS) if(settings[key] && !staged.some(f=>settings[key]===`/uploads/${f.name}`) && !fs.existsSync(path.join(UPLOADS_DIR,path.basename(settings[key])))) throw invalid('Preset references a missing image');
  for(const file of staged) fs.writeFileSync(path.join(UPLOADS_DIR,file.name),file.bytes,{mode:0o600});
  return settings;
}
module.exports={KEYS,snapshot,record,validate,apply,pack,unpack};
