// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
(() => {
  const admin=location.pathname.startsWith('/admin');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qrIcon='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6z"/></svg>';
  const list=()=>typeof groups==='undefined'?[]:groups;
  let dialogSequence=0;
  function groupPath(group,section){
    const path=group?.slug?'/g/'+encodeURIComponent(group.slug):'/?group='+encodeURIComponent(group?.id??'all');
    const url=new URL(path,location.origin);if(section)url.searchParams.set('section',section);return url.pathname+url.search;
  }
  const href=(id,section)=>new URL(groupPath(list().find(g=>g.id===id)||{id},section),location.origin).href;
  function dialog(title,extra=''){
    const element=document.createElement('dialog');element.className='lp-dialog '+extra;
    element.innerHTML=`<div class="lp-dialog-head"><h2>${esc(title)}</h2><button type="button" class="lp-close" aria-label="Close">×</button></div>`;
    element.querySelector('h2').id='lpDialogTitle'+(++dialogSequence);element.setAttribute('aria-labelledby',element.querySelector('h2').id);
    element.querySelector('button').onclick=()=>element.close();element.addEventListener('click',event=>{const bounds=element.getBoundingClientRect();if(event.target===element&&(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom))element.close();});element.addEventListener('close',()=>element.remove());document.body.appendChild(element);return element;
  }
  function share(url,title){
    const d=dialog(title||'Share this page','lp-share-dialog');
    d.insertAdjacentHTML('beforeend',`<img class="lp-share-preview" alt="QR code for ${esc(title||'this page')}" src="/api/share/qr?url=${encodeURIComponent(url)}"><label class="sr-only" for="lpShareUrl">Shareable URL</label><input id="lpShareUrl" readonly value="${esc(url)}"><div class="lp-share-actions"><button type="button" class="lp-action lp-action-primary" data-copy>Copy link</button><button type="button" class="lp-action" data-download>Download QR</button>${navigator.share?'<button type="button" class="lp-action" data-native>Share…</button>':''}</div><p role="status">Access permissions and group passwords still apply.</p>`);
    d.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(url);d.querySelector('[role=status]').textContent='Link copied.';}catch{d.querySelector('input').select();d.querySelector('[role=status]').textContent='Select and copy the link above.';}};
    d.querySelector('[data-download]').onclick=async()=>{try{const r=await fetch('/api/share/qr?url='+encodeURIComponent(url));if(!r.ok)throw Error();const blob=await r.blob(),link=document.createElement('a'),address=URL.createObjectURL(blob);link.href=address;link.download='linkpage-qr.svg';link.click();setTimeout(()=>URL.revokeObjectURL(address),1000);}catch{d.querySelector('[role=status]').textContent='QR code could not be downloaded. Please try again.';}};
    d.querySelector('[data-native]')?.addEventListener('click',()=>navigator.share({title,url}).catch(()=>{}));
    d.showModal();d.querySelector('[data-copy]').focus();return d;
  }
  function readRoute(){
    const url=new URL(location.href),slug=location.pathname.match(/^\/g\/([^/]+)\/?$/)?.[1],raw=url.searchParams.get('group');
    if(slug){let name;try{name=decodeURIComponent(slug);}catch{return {key:null,requested:true};}return {key:list().find(g=>g.slug===name)?.id??null,requested:true};}
    if(raw!==null)return {key:['all','fav'].includes(raw)?raw:/^[ug]\d+$/.test(raw)?raw:Number(raw),requested:true};
    return {requested:false};
  }
  let appliedRoute=null;
  function applyRoute(force=false){
    if(admin)return;
    const address=location.pathname+location.search;
    if(!force&&appliedRoute===address){syncUrl(false);return;}
    appliedRoute=address;
    const route=readRoute();
    if(route.requested){
      const group=list().find(g=>g.id===route.key);
      if(group){if(isGroupLocked(group)){if(document.getElementById('unlockOverlay')?.classList.contains('hidden'))openUnlockModal(group);activeGroup='all';return;}activeGroup=group.id;}
      else if(['all','fav'].includes(route.key))activeGroup=route.key;
      else {activeGroup='all';if(!document.getElementById('lpUnavailable')){const note=document.createElement('p');note.id='lpUnavailable';note.className='ws-help';note.setAttribute('role','status');note.textContent='This group is unavailable or requires a different account.';document.getElementById('linksGrid')?.before(note);}}
    }else if(!location.search)syncUrl(false);
  }
  function syncUrl(push=true,section){if(admin)return;const path=groupPath(list().find(g=>g.id===activeGroup)||{id:activeGroup},section);if(location.pathname+location.search!==path)history[push?'pushState':'replaceState']({group:activeGroup},'',path);appliedRoute=location.pathname+location.search;}
  function scrollSection(){const id=Number(new URLSearchParams(location.search).get('section'));if(id>0)requestAnimationFrame(()=>document.querySelector(`[data-section-id="${id}"]`)?.scrollIntoView({block:'start',behavior:'instant'}));}
  function navigate(id,section){
    const group=list().find(g=>g.id===id);if(group&&isGroupLocked(group)){history.pushState({},'',groupPath(group,section));openUnlockModal(group);return;}
    activeGroup=id;saveStoredGroup(id);syncUrl(true,section);renderTabs();renderLinks();render();scrollSection();
  }
  function picker(){
    const d=dialog('Your groups','lp-group-picker');d.insertAdjacentHTML('beforeend','<label class="sr-only" for="lpGroupSearch">Find a group</label><input id="lpGroupSearch" type="search" placeholder="Find a group…" autocomplete="off"><div class="lp-group-list"></div><div class="lp-menu-actions"><button type="button" class="lp-action" data-page>Share page / QR</button><button type="button" class="lp-action" data-appearance>Appearance</button></div>');
    const target=d.querySelector('.lp-group-list');
    const draw=()=>{const q=d.querySelector('input').value.toLocaleLowerCase();const rows=[{id:'all',name:'All links',color:'#0071e3'},...(typeof currentUser!=='undefined'&&currentUser?[{id:'fav',name:'Favourites',color:'#f59e0b'}]:[]),...list()].filter(g=>g.name.toLocaleLowerCase().includes(q));target.innerHTML=rows.map((g,i)=>`<div class="lp-group-row"><button type="button" data-open="${i}"${activeGroup===g.id?' aria-current="page"':''}><span class="lp-dot" style="background:${esc(g.color)}"></span><span>${esc(g.name)}</span><small>${g.is_protected?'⌑':''}</small></button><button type="button" class="lp-close" data-share="${i}" aria-label="Share ${esc(g.name)}">${qrIcon}</button></div>`).join('')||'<p>No matching groups.</p>';target.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{d.close();navigate(rows[b.dataset.open].id);});target.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>{const group=rows[b.dataset.share];d.close();share(href(group.id),group.name);});};
    d.querySelector('input').oninput=draw;d.querySelector('[data-page]').onclick=()=>{d.close();share(location.href,document.title);};d.querySelector('[data-appearance]').onclick=()=>{d.close();window.LinkPageTheme?.openPreferences?.();};draw();d.showModal();d.querySelector('input').focus();
  }
  function render(){const group=list().find(g=>g.id===activeGroup);const button=document.getElementById('lpShareCurrent');if(button){button.title=group?'Share '+group.name:'Share this page';button.setAttribute('aria-label',button.title);}}
  window.LinkPageNavigation={qrIcon,href,groupPath,applyRoute,syncUrl,scrollSection,render,share,shareGroup:(id,section)=>share(href(id,section),section?'Share section':list().find(g=>g.id===id)?.name||'Share group')};
  window.navigateGroup=navigate;
  if(!admin){
    const header=document.querySelector('.header-inner');
    const button=document.createElement('button');button.type='button';button.className='lp-nav-button lp-share-current';button.id='lpShareCurrent';button.innerHTML=qrIcon;button.onclick=()=>share(href(activeGroup),list().find(g=>g.id===activeGroup)?.name||document.title);header?.appendChild(button);
    const mobile=document.createElement('button');mobile.type='button';mobile.className='lp-nav-button lp-mobile-groups';mobile.id='lpGroupsMenu';mobile.innerHTML=window.LinkPageIcons.svg('menu');mobile.setAttribute('aria-label','Browse groups and page actions');mobile.onclick=picker;header?.appendChild(mobile);
    document.addEventListener('contextmenu',event=>{const tab=event.target.closest('.tab[data-group]');if(tab){event.preventDefault();window.LinkPageNavigation.shareGroup(parseGroupKey(tab.dataset.group));}});
    window.addEventListener('popstate',()=>{applyRoute(true);renderTabs();renderLinks();render();scrollSection();});
    document.getElementById('themeToggle')?.addEventListener('contextmenu',event=>{event.preventDefault();window.LinkPageTheme?.openPreferences();});
  }else{
    document.getElementById('mobileMoreBtn')?.addEventListener('click',event=>{
      event.preventDefault();event.stopImmediatePropagation();
      const d=dialog('Workspace','lp-admin-menu');
      const actions=[['globalSearchBtn','Search everywhere'],['workspaceBtn','Library & workspace'],['notificationCenterBtn','Notifications'],['openSettingsBtn','Settings'],['openAnalyticsBtn','Analytics'],['sidebarToggle','Browse groups'],['themeToggle','Switch light / dark'],['logoutBtn','Sign out']];
      d.insertAdjacentHTML('beforeend','<div class="lp-group-list">'+actions.map(([id,label])=>`<button type="button" class="lp-action" data-forward="${id}">${label}</button>`).join('')+'</div>');d.querySelectorAll('[data-forward]').forEach(b=>b.onclick=event=>{event.preventDefault();event.stopPropagation();const id=b.dataset.forward;d.close();document.getElementById(id)?.click();});d.showModal();
    },true);
  }
  // Titles and QR actions are attached to newly rendered cards, without
  // replacing their contents or interfering with drag-and-drop handlers.
  const grid=document.getElementById('linksGrid');
  function decorate(){
    grid?.querySelectorAll('.link-card').forEach(card=>{
      const title=card.querySelector('.link-name');if(title)title.title=title.textContent.trim();
      if(card.querySelector('.lp-link-qr')||card.classList.contains('link-card-add'))return;
      const id=Number(card.dataset.id||card.dataset.linkId);const link=typeof links==='undefined'?null:links.find(l=>String(l.id)===String(card.dataset.id||card.dataset.linkId));
      const anchor=card.matches('a')?card:card.querySelector('a[href]');let url=anchor?.href;
      if(link&&link.owner!=='me'&&link.owner!=='guest')url=new URL(link.slug?'/f/'+encodeURIComponent(link.slug):'/r/'+link.id,location.origin).href;
      if(!url||!/^https?:/.test(url))return;
      const button=document.createElement('button');button.type='button';button.className='lp-link-qr';button.setAttribute('aria-label','Share link / QR code');button.title='Share link / QR code';button.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6z"/></svg>';button.onclick=event=>{event.preventDefault();event.stopPropagation();share(url,title?.textContent.trim()||'Share link');};(card.querySelector('.lp-card-tools,.link-actions,.card-actions,.card-footer')||card).appendChild(button);
    });
  }
  if(grid)new MutationObserver(decorate).observe(grid,{childList:true,subtree:true});decorate();
})();
