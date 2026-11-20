// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const router=require('express').Router();
const {PUBLIC_DIR}=require('../config/env');
const {requireAdmin}=require('../middleware/auth');
const {wrapAsync}=require('../middleware/error');
const {createRateLimiter}=require('../middleware/rateLimit');
const models=require('../models');
router.get('/g/:slug',(req,res)=>res.sendFile(require('node:path').join(PUBLIC_DIR,'index.html')));
router.get('/api/share/qr',createRateLimiter(60,60000),wrapAsync(async(req,res)=>{
  const value=req.query.url;
  if(typeof value!=='string'||value.length>2048)return res.status(400).json({error:'Use an HTTP or HTTPS URL of up to 2048 characters'});
  let url;try{url=new URL(value);}catch{return res.status(400).json({error:'Invalid URL'});}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return res.status(400).json({error:'Use an HTTP or HTTPS URL without credentials'});
  const svg=await require('qrcode').toString(url.href,{type:'svg',errorCorrectionLevel:'M',margin:3,width:320});
  res.set('Cache-Control','private, no-store').type('image/svg+xml').send(svg);
}));
router.post('/api/links/:id/health',requireAdmin,wrapAsync(async(req,res)=>{
  const link=models.getLinkById(Number(req.params.id));if(!link)return res.status(404).json({error:'Link not found'});
  if(link.file_path)return res.status(400).json({error:'Local attachments do not need an external health check'});
  if(typeof req.body.enabled==='boolean'){
    const {db}=require('../config/db');
    db.prepare('INSERT INTO link_health(link_id,enabled) VALUES(?,?) ON CONFLICT(link_id) DO UPDATE SET enabled=excluded.enabled').run(link.id,+req.body.enabled);
    if(!req.body.enabled){models.updateLinkBrokenStatus(link.id,false);return res.json({status:'disabled'});}
  }
  res.json(await require('../services/healthService').checkLinkHealth(link.id,link.url));
}));
module.exports=router;
