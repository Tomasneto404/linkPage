// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
(() => {
  const grid=document.getElementById('linksGrid');if(!grid)return;
  const view=window.LinkPageWidgetView,editor=window.LinkPageWidgetEditor,{esc,icon}=view;
  const toolbar=document.createElement('div');toolbar.className='lp-widget-toolbar';toolbar.hidden=true;toolbar.innerHTML='<span>Widgets</span><button type="button" class="btn btn-ghost btn-sm" data-add-widget>Add widget</button>';grid.before(toolbar);
  const container=document.createElement('section');container.className='lp-widgets';container.id='lpWidgets';container.setAttribute('aria-label','Workspace widgets');grid.before(container);
  const compact=matchMedia('(max-width:640px)'),values=new Map(),inFlight=new Map();
  let widgets=[],signature='',management=null,lastManagement=0,identity='',dragging=null,refreshing=false,refreshQueued=false,resizing=null;
  const group=()=>typeof activeGroup==='undefined'?'all':activeGroup;
  const belongs=row=>!row.layout.group_ids.length||row.layout.group_ids.includes(group());
  const onDevice=row=>row.layout.device==='all'||(row.layout.device==='mobile')===compact.matches;
  const statusOf=row=>values.get(row.id);
  function liveNotice(text){const status=document.getElementById('lpWidgetNotice')||Object.assign(document.createElement('p'),{id:'lpWidgetNotice',className:'ws-help'});status.setAttribute('role','status');toolbar.after(status);status.textContent=text;}
  function age(value){if(!value?.updated_at)return value?.error?'Not updated':'Waiting for data';const seconds=Math.max(0,Math.floor((Date.now()-new Date(value.updated_at).getTime())/1000));return seconds<60?'Updated just now':seconds<3600?`Updated ${Math.floor(seconds/60)} min ago`:`Updated ${Math.floor(seconds/3600)} hr ago`;}
  function footer(element,row,value){const status=element.querySelector('.lp-widget-update');if(status){status.textContent=value?.stale?'Showing saved data · '+age(value):value?.error?'Could not refresh':age(value);status.classList.toggle('is-stale',!!value?.stale||!!value?.error);status.title=value?.error||value?.updated_at||'';}element.classList.toggle('is-stale',!!value?.stale);}
  function drawBody(element,row,value){
    const body=element.querySelector('.lp-widget-body'),fingerprint=JSON.stringify([value?.data,value?.read,row.options]);
    if(body.dataset.content!==fingerprint){body.innerHTML=view.render(row,value);body.dataset.content=fingerprint;view.hydrate(element,row,value);}
    footer(element,row,value);
    if(element.hasAttribute('data-widget-pending')&&(value?.data||value?.error)){
      delete element.dataset.widgetPending;element.inert=false;element.removeAttribute('aria-busy');
      window.LinkPageMotion?.enterView(container,'widget-ready:'+String(group())+':'+row.id+':'+row.revision,`[data-widget="${row.id}"][data-motion-new]`,{fresh:true,dense:widgets.length>24});
      delete element.dataset.motionNew;
    }
  }
  function render(){
    const visible=widgets.filter(row=>belongs(row)&&onDevice(row));
    document.body.classList.toggle('has-visible-widgets',visible.length>0);
    const current=JSON.stringify([group(),visible]);
    toolbar.hidden=!(management&&(management.admin||management.groups.some(item=>item.id===group())));
    if(current===signature)return;signature=current;
    const existing=new Map([...container.querySelectorAll('[data-widget]')].map(element=>[Number(element.dataset.widget),element]));
    for(const row of visible){
      let element=existing.get(row.id);
      const rowSignature=JSON.stringify(row);
      if(!element||element.dataset.row!==rowSignature){
        const previous=element;
        element=document.createElement('article');element.className='lp-widget';element.dataset.widget=row.id;element.dataset.row=rowSignature;element.dataset.kind=row.kind;element.dataset.width=row.layout.width;element.dataset.height=row.layout.height;element.draggable=!!row.can_layout;if(row.layout.height_px){element.dataset.fixedHeight='true';element.style.setProperty('--widget-height',row.layout.height_px+'px');}
        const title='lpWidgetTitle'+row.id;element.setAttribute('aria-labelledby',title);
        element.innerHTML=`<div class="lp-widget-head">${row.can_layout?`<button type="button" class="lp-widget-icon-button lp-widget-drag" draggable="true" data-drag-widget="${row.id}" aria-label="Drag ${esc(row.title)}">${icon('menu')}</button>`:''}<h2 id="${title}">${esc(row.title)}</h2>${row.can_manage?`<details class="lp-widget-menu"><summary aria-label="Actions for ${esc(row.title)}">${icon('settings')}</summary><div><button type="button" data-widget-action="edit">Edit</button><button type="button" data-widget-action="duplicate">Duplicate</button><button type="button" data-widget-action="hide">Hide</button>${row.can_layout?`<label>Width<select data-widget-width aria-label="Width of ${esc(row.title)}"><option value="1"${row.layout.width===1?' selected':''}>Standard</option><option value="2"${row.layout.width===2?' selected':''}>Wide</option><option value="3"${row.layout.width===3?' selected':''}>Full row</option></select></label><button type="button" data-widget-action="up">Move earlier</button><button type="button" data-widget-action="down">Move later</button>` : ''}<button type="button" data-widget-action="remove">Remove</button></div></details>`:''}</div><div class="lp-widget-body"></div><div class="lp-widget-footer"><span class="lp-widget-update" role="status"></span><button type="button" class="lp-widget-icon-button" data-refresh-widget aria-label="Refresh ${esc(row.title)}">${icon('history')}</button></div>${row.can_layout?`<button type="button" class="lp-widget-resize" data-resize-widget aria-label="Resize ${esc(row.title)}" title="Drag to resize · arrow keys adjust size">${icon('resize',18)}</button>`:''}`;
        if(!previous){element.dataset.motionNew='true';if(!values.has(row.id)){element.dataset.widgetPending='true';element.inert=true;element.setAttribute('aria-busy','true');}}
        drawBody(element,row,values.get(row.id));
        previous?.replaceWith(element);
      }
      // append moves existing cards without resetting their content or scroll.
      element.dataset.width=row.layout.width;
      if(row.layout.height_px){element.dataset.fixedHeight='true';element.style.setProperty('--widget-height',row.layout.height_px+'px');}
      else{delete element.dataset.fixedHeight;element.style.removeProperty('--widget-height');}
      container.appendChild(element);existing.delete(row.id);
    }
    existing.forEach(element=>element.remove());
    window.LinkPageMotion?.enterView(container,'widgets:'+String(group())+':'+visible.map(row=>row.id).join(','),'.lp-widget[data-motion-new]:not([data-widget-pending])',{fresh:true,dense:widgets.length>24});
    container.querySelectorAll('[data-motion-new]:not([data-widget-pending])').forEach(element=>delete element.dataset.motionNew);
  }
  async function hydrate(row,force=false){
    if(inFlight.has(row.id)){await inFlight.get(row.id);if(widgets.some(item=>item.id===row.id&&item.revision===row.revision))return hydrate(row,force);return;}
    const previous=statusOf(row),ageMs=previous?.updated_at?Date.now()-new Date(previous.updated_at).getTime():Infinity;
    if(!force&&previous?.data&&!previous.stale&&ageMs<(row.options.refresh_seconds||300)*1000)return;
    const element=container.querySelector(`[data-widget="${row.id}"]`),button=element?.querySelector('[data-refresh-widget]');
    if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
    const promise=(async()=>{
      try{
        const result=await editor.request('/api/widgets/'+row.id+(force?'/refresh':'/data'),force?'POST':'GET',force?{}:undefined);
        if(!widgets.some(item=>item.id===row.id&&item.revision===row.revision))return;
        const value=!result.data&&previous?.data?{...previous,stale:true,error:result.error}:result;
        values.set(row.id,value);const target=container.querySelector(`[data-widget="${row.id}"]`);if(target)drawBody(target,row,value);
      }catch(error){
        if(!widgets.some(item=>item.id===row.id&&item.revision===row.revision))return;
        if([401,403,404].includes(error.status)){values.delete(row.id);widgets=widgets.filter(item=>item.id!==row.id);signature='';render();}
        else{const value=previous?.data?{...previous,stale:true,error:'Connect to refresh this widget.'}:{error:error.message,updated_at:null};values.set(row.id,value);const target=container.querySelector(`[data-widget="${row.id}"]`);if(target)drawBody(target,row,value);}
      }finally{inFlight.delete(row.id);const target=container.querySelector(`[data-widget="${row.id}"] [data-refresh-widget]`);if(target){target.disabled=false;target.removeAttribute('aria-busy');}}
    })();inFlight.set(row.id,promise);return promise;
  }
  async function permissions(){
    const user=typeof currentUser==='undefined'?null:currentUser,admin=typeof isGlobalPageAdmin==='function'&&isGlobalPageAdmin();
    const current=user?.id||admin?'signed:'+String(user?.id||'token'):'';
    if(current!==identity){management=null;lastManagement=0;identity=current;}
    if(!current||Date.now()-lastManagement<60000)return;
    lastManagement=Date.now();try{management=await editor.request('/api/widgets/manage');}catch{management=null;}
  }
  async function refresh(){
    if(document.hidden||document.querySelector('.gate:not(.hidden)'))return;
    if(refreshing||resizing||dragging){refreshQueued=true;return;}refreshing=true;
    try{
      const next=await editor.request('/api/widgets'),old=new Map(widgets.map(row=>[row.id,row]));
      for(const row of next)if(old.get(row.id)?.revision!==row.revision)values.delete(row.id);
      widgets=next;const ids=new Set(widgets.map(row=>row.id));for(const id of values.keys())if(!ids.has(id))values.delete(id);
      await permissions();render();await Promise.all(widgets.filter(row=>belongs(row)&&onDevice(row)).map(row=>hydrate(row)));
    }catch(error){if([401,403].includes(error.status)){widgets=[];values.clear();management=null;signature='';render();}}
    finally{refreshing=false;if(refreshQueued){refreshQueued=false;queueMicrotask(refresh);}}
  }
  async function move(id,target){
    const visible=widgets.filter(row=>belongs(row)&&onDevice(row)&&row.can_layout),ids=visible.map(row=>row.id);if(!ids.includes(id)||!ids.includes(target)||id===target)return;
    const destination=ids.indexOf(target);ids.splice(ids.indexOf(id),1);ids.splice(destination,0,id);
    const settle=window.LinkPageMotion?.capture(container,'[data-widget]',el=>el.dataset.widget);
    await editor.request('/api/workspace/widgets/reorder','POST',{order:ids});await refresh();settle?.();
  }
  toolbar.querySelector('button').onclick=()=>editor.open(null,Number.isInteger(group())?group():null).catch(error=>liveNotice(error.message));
  container.addEventListener('click',async event=>{
    const element=event.target.closest('[data-widget]');if(!element)return;const row=widgets.find(row=>row.id===Number(element.dataset.widget));if(!row)return;
    const refresh=event.target.closest('[data-refresh-widget]');if(refresh){await hydrate(row,true);return;}
    const action=event.target.closest('[data-widget-action]')?.dataset.widgetAction;
    try{
      if(action==='edit'){await editor.open(row.id);return;}
      if(action==='duplicate')await editor.request('/api/workspace/widgets/'+row.id+'/duplicate','POST',{});
      if(action==='hide')await editor.request('/api/workspace/widgets/'+row.id,'PUT',{enabled:false});
      if(action==='remove'){if(!await editor.confirmRemoval('Remove '+row.title+'?'))return;await editor.request('/api/workspace/widgets/'+row.id,'DELETE');}
      if(action==='up'||action==='down'){const own=widgets.filter(item=>belongs(item)&&onDevice(item)&&item.can_layout),index=own.findIndex(item=>item.id===row.id),target=own[index+(action==='up'?-1:1)];if(target)await move(row.id,target.id);return;}
      if(action){await window.LinkPageWidgets.refresh();return;}
      const message=event.target.closest('[data-read-msg]'),all=event.target.closest('[data-read-all]');
      if(message||all){const value=values.get(row.id),read=view.readSet(row,value),ids=message?[message.dataset.readMsg]:value.data.messages.map(item=>item.id);ids.forEach(id=>read.add(id));if(row.read_tracking==='account'){const result=await editor.request('/api/widgets/'+row.id+'/read','POST',{ids});value.read=result.read;}else{localStorage.setItem('linkpage_widget_read_'+row.id,JSON.stringify([...read].slice(-300)));value.read=[...read];}element.querySelector('.lp-widget-body').dataset.content='';drawBody(element,row,value);}
    }catch(error){liveNotice(error.message);}
  });
  container.addEventListener('change',async event=>{
    const element=event.target.closest('[data-widget]'),row=widgets.find(row=>row.id===Number(element?.dataset.widget));if(!row)return;
    try{
      if(event.target.matches('[data-widget-width]')){await editor.request('/api/workspace/widgets/'+row.id,'PUT',{layout:{width:Number(event.target.value)}});await refresh();}
      if(event.target.matches('[data-task-line]')){const value=values.get(row.id);await editor.request('/api/workspace/widgets/'+row.id+'/task','POST',{line:Number(event.target.dataset.taskLine),checked:event.target.checked,text:value.data.text});values.delete(row.id);await hydrate(row,true);}
    }catch(error){liveNotice(error.message);values.delete(row.id);await hydrate(row,true);}
  });
  container.addEventListener('dragstart',event=>{
    const card=event.target.closest('[data-widget]'),row=widgets.find(item=>item.id===Number(card?.dataset.widget));
    const interactive=event.target.closest('a,button,input,textarea,select,summary,label,[contenteditable=true]');
    if(!row?.can_layout||resizing||interactive&&!interactive.matches('[data-drag-widget]')){event.preventDefault();return;}
    dragging=row.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(dragging));card.classList.add('lp-widget-dragging');
  });
  container.addEventListener('dragover',event=>{const target=event.target.closest('[data-widget]');if(!dragging||!target||Number(target.dataset.widget)===dragging)return;event.preventDefault();container.querySelectorAll('.lp-widget-drop').forEach(el=>el.classList.remove('lp-widget-drop'));target.classList.add('lp-widget-drop');});
  const stop=()=>{dragging=null;container.querySelectorAll('.lp-widget-drop,.lp-widget-dragging').forEach(el=>el.classList.remove('lp-widget-drop','lp-widget-dragging'));if(refreshQueued){refreshQueued=false;refresh();}};
  container.addEventListener('drop',event=>{if(!dragging)return;event.preventDefault();const source=dragging,target=event.target.closest('[data-widget]');dragging=null;stop();if(source&&target)move(source,Number(target.dataset.widget)).catch(error=>liveNotice(error.message));});container.addEventListener('dragend',stop);
  document.addEventListener('dragover',event=>{if(dragging)event.preventDefault();});document.addEventListener('drop',event=>{if(dragging)event.preventDefault();});
  function previewSize(card,width,height){card.dataset.width=width;card.dataset.fixedHeight='true';card.style.setProperty('--widget-height',height+'px');const label=card.querySelector('.lp-widget-size-preview span');if(label)label.textContent=Math.round(card.getBoundingClientRect().width)+' × '+height+' px';}
  async function saveSize(row,width,height){try{await editor.request('/api/workspace/widgets/'+row.id,'PUT',{layout:{width,height_px:height}});}catch(error){liveNotice(error.message);}finally{signature='';await refresh();}}
  container.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-resize-widget]');if(!handle||event.button!==0)return;
    const card=handle.closest('[data-widget]'),row=widgets.find(item=>item.id===Number(card.dataset.widget));if(!row?.can_layout)return;
    event.preventDefault();event.stopPropagation();card.classList.add('lp-widget-resizing');card.getAnimations().forEach(animation=>animation.cancel());const bounds=card.getBoundingClientRect(),columns=getComputedStyle(container).gridTemplateColumns.split(' ').length,gap=parseFloat(getComputedStyle(container).columnGap)||16;
    const preview=document.createElement('div');preview.className='lp-widget-size-preview';preview.setAttribute('aria-hidden','true');preview.innerHTML=icon('resize',22)+'<span>'+Math.round(bounds.width)+' × '+Math.round(bounds.height)+' px</span>';card.appendChild(preview);
    resizing={row,card,handle,preview,x:event.clientX,y:event.clientY,startHeight:bounds.height,startWidth:Math.min(columns,row.layout.width),column:(container.clientWidth+gap)/columns,columns,width:row.layout.width,height:Math.round(bounds.height)};
    card.draggable=false;card.classList.add('lp-widget-resizing');handle.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove',event=>{if(!resizing)return;const state=resizing;const steps=Math.round((event.clientX-state.x)/state.column);state.width=state.columns===1||steps===0?state.row.layout.width:Math.max(1,Math.min(state.columns,state.startWidth+steps));state.height=Math.max(180,Math.min(1000,Math.round(state.startHeight+event.clientY-state.y)));previewSize(state.card,state.width,state.height);});
  async function finishSize(event,cancel=false){if(!resizing)return;const state=resizing;resizing=null;state.preview.remove();state.card.draggable=true;state.card.classList.remove('lp-widget-resizing');if(state.handle.hasPointerCapture(event.pointerId))state.handle.releasePointerCapture(event.pointerId);if(cancel){signature='';render();return;}if(Math.abs(event.clientX-state.x)<3&&Math.abs(event.clientY-state.y)<3){signature='';render();return;}await saveSize(state.row,state.width,state.height);}
  container.addEventListener('pointerup',event=>finishSize(event));container.addEventListener('pointercancel',event=>finishSize(event,true));
  container.addEventListener('lostpointercapture',event=>{if(resizing)finishSize(event,true);});
  container.addEventListener('keydown',event=>{const handle=event.target.closest('[data-resize-widget]');if(!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const card=handle.closest('[data-widget]'),row=widgets.find(item=>item.id===Number(card.dataset.widget));if(!row?.can_layout)return;const width=Math.max(1,Math.min(3,row.layout.width+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0))),height=Math.max(180,Math.min(1000,Math.round((row.layout.height_px||card.getBoundingClientRect().height)+(event.key==='ArrowUp'?-20:event.key==='ArrowDown'?20:0))));previewSize(card,width,height);saveSize(row,width,height);});
  container.addEventListener('toggle',event=>{if(!event.target.matches('details[open]'))return;container.querySelectorAll('details[open]').forEach(details=>{if(details!==event.target)details.open=false;});},true);
  container.addEventListener('error',event=>{if(event.target.matches('img'))event.target.hidden=true;},true);
  document.addEventListener('click',event=>{if(!event.target.closest('.lp-widget-menu'))container.querySelectorAll('details[open]').forEach(details=>details.open=false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')container.querySelectorAll('details[open]').forEach(details=>details.open=false);});
  let active=group();new MutationObserver(()=>{if(group()!==active){active=group();render();widgets.filter(row=>belongs(row)&&onDevice(row)).forEach(row=>hydrate(row));}}).observe(grid,{childList:true});
  compact.addEventListener('change',()=>{signature='';render();widgets.filter(row=>belongs(row)&&onDevice(row)).forEach(row=>hydrate(row));});
  setInterval(()=>{if(document.hidden)return;for(const element of container.querySelectorAll('[data-kind=clock]'))view.clock(element,values.get(Number(element.dataset.widget))?.data);},1000);
  setInterval(()=>{for(const row of widgets){const element=container.querySelector(`[data-widget="${row.id}"]`);if(element)footer(element,row,values.get(row.id));}},30000);
  setInterval(refresh,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('online',refresh);window.addEventListener('linkpage:data',refresh);window.addEventListener('linkpage:widgets',()=>{signature='';refresh();});setTimeout(refresh,500);
  window.LinkPageWidgets={refresh,openEditor:editor.open};
})();
