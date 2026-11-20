// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Public appearance only, in the first HTML response, so a cold visit paints
 * the correct colours before JavaScript's settings request returns. */
const fs=require('node:fs');const path=require('node:path');
const {PUBLIC_DIR}=require('../config/env');const {db}=require('../config/db');
const keys=['default_theme','motion_style','ambient_background','ambient_speed','ambient_colors','ambient_effect','ambient_blend','accent_color','accent_dark_adjust','bar_opacity','theme_light_variant','theme_dark_variant','season_theme','season_schedule','season_effects','season_background','wallpaper_light','wallpaper_dark','wallpaper_fog'];
const templates=new Map();
function html(relative){const file=path.join(PUBLIC_DIR,relative),mtime=fs.statSync(file).mtimeMs;const cached=templates.get(file);if(cached?.mtime===mtime)return cached.text;const text=fs.readFileSync(file,'utf8');templates.set(file,{mtime,text});return text;}
function appearanceBoot(req,res,next){
  const file=({'/':'index.html','/index.html':'index.html','/admin/':'admin/index.html','/admin/index.html':'admin/index.html','/login/':'login/index.html','/login/index.html':'login/index.html'})[req.path]||(/^\/g\/[^/]+\/?$/.test(req.path)?'index.html':null);
  if(!file||!['GET','HEAD'].includes(req.method))return next();
  try{
    const rows=Object.fromEntries(db.prepare(`SELECT key,value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys).map(row=>[row.key,row.value]));
    const settings={...Object.fromEntries(keys.map(key=>[key,null])),default_theme:'system',motion_style:'subtle',ambient_background:'off',...rows};
    for(const key of ['accent_dark_adjust','season_effects'])settings[key]=rows[key]===undefined?key==='season_effects':rows[key]==='1';
    for(const [key,fallback]of [['bar_opacity',82],['wallpaper_fog',60]])settings[key]=rows[key]===undefined?fallback:Number(rows[key]);
    Object.assign(settings,require('../../public/ambient-settings').read(rows));
    settings.season_manual_theme=rows.season_theme||'none';
    try{settings.season_schedule=JSON.parse(rows.season_schedule||'null');}catch{delete settings.season_schedule;}
    const json=JSON.stringify(settings).replace(/</g,'\\u003c');
    res.set('Cache-Control','no-cache, must-revalidate').type('html').send(html(file).replace('<head>','<head>\n<script id="linkpageAppearanceBoot" type="application/json">'+json+'</script>'));
  }catch(error){next(error);}
}
module.exports=appearanceBoot;
