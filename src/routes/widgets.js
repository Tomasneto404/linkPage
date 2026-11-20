// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const router=require('express').Router();
const {requireAuth,requireAdmin,requireLoginIfPrivate,requirePublicAuth}=require('../middleware/auth');
const {wrapAsync}=require('../middleware/error');
const {createRateLimiter}=require('../middleware/rateLimit');
const widgets=require('../services/widgetService');
const metadata=require('../models/workspace');
const models=require('../models');
const management=[requireAuth,(req,res,next)=>{if(req.user.role==='admin'||metadata.managedIds(req.user.id,4).length)return next();res.status(403).json({error:'Manage a group to edit its widgets'});}];
const pageAccess=[requireLoginIfPrivate,requirePublicAuth];
const refreshLimit=createRateLimiter(20,60000);
function selected(req,res){const row=widgets.visible(req).find(row=>row.id===Number(req.params.id));if(!row)res.status(404).json({error:'Widget not found'});return row;}
router.get('/api/workspace/widgets/weather-locations',...management,wrapAsync(async(req,res)=>{try{res.json(await widgets.locations(req.query.q));}catch(error){if(error.status===400)throw error;res.status(502).json({error:'Location search is unavailable. Enter coordinates or try again later.'});}}));
router.get('/api/workspace/widgets',...management,(req,res)=>res.set('Cache-Control','private, no-store').json(widgets.managed(req).map(widgets.adminRow)));
router.get('/api/widgets/manage',...management,(req,res)=>{
  const groups=models.getAllGroups().filter(group=>req.user.role==='admin'||metadata.role(req.user.id,group.id)==='manager').map(({id,name})=>({id,name}));
  res.set('Cache-Control','private, no-store').json({widgets:widgets.managed(req).map(widgets.adminRow),groups,admin:req.user.role==='admin'});
});
router.post('/api/workspace/widgets/reorder',requireAdmin,(req,res)=>res.json(widgets.reorder(req,req.body.order)));
router.post('/api/workspace/widgets/preview',...management,refreshLimit,wrapAsync(async(req,res)=>{try{res.json(await widgets.preview(req,req.body));}catch(error){if(error.status)throw error;res.status(502).json({error:'Could not load the preview. Check the source and try again.'});}}));
router.post('/api/workspace/widgets',...management,(req,res)=>res.status(201).json(widgets.save(req.body,null,req)));
router.put('/api/workspace/widgets/:id',...management,(req,res)=>res.json(widgets.save(req.body,Number(req.params.id),req)));
router.post('/api/workspace/widgets/:id/duplicate',...management,(req,res)=>res.status(201).json(widgets.duplicate(req,req.params.id)));
router.post('/api/workspace/widgets/:id/task',...management,(req,res)=>res.json(widgets.toggleTask(req,req.params.id,req.body)));
router.delete('/api/workspace/widgets/:id',...management,(req,res)=>{widgets.remove(req,req.params.id);res.status(204).end();});
router.get('/api/widgets',...pageAccess,(req,res)=>res.set('Cache-Control','private, no-store').json(widgets.visible(req).map(row=>widgets.publicRow(req,row))));
router.get('/api/widgets/:id/data',...pageAccess,wrapAsync(async(req,res)=>{const row=selected(req,res);if(row)res.set('Cache-Control','private, no-store').json(await widgets.viewData(req,row));}));
router.post('/api/widgets/:id/refresh',...pageAccess,refreshLimit,wrapAsync(async(req,res)=>{const row=selected(req,res);if(row)res.set('Cache-Control','private, no-store').json(await widgets.viewData(req,row,{force:true}));}));
router.post('/api/widgets/:id/read',...pageAccess,requireAuth,wrapAsync(async(req,res)=>{const row=selected(req,res);if(row)res.json(await widgets.markRead(req,row,req.body.ids));}));
router.use((error,req,res,next)=>{if([401,403,404,409].includes(error.status))return res.status(error.status).json({error:error.message});next(error);});
module.exports=router;
