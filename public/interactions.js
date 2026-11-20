// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/* Local, opt-in motion: no background refresh may replay a view's entrance. */
(function(){
  const root=document.documentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
  const enabled=()=>root.dataset.motion!=='off'&&!reduced.matches&&!document.hidden;
  const expressive=()=>enabled()&&['smooth','spring'].includes(root.dataset.motion);
  const duration=()=>root.dataset.motion==='spring'?440:300;
  const ease='cubic-bezier(.22,1,.36,1)';
  const running=new Set();
  // A bounded selected-content slot keeps long labels from pushing out the
  // picker arrow. Older browsers retain their native select implementation.
  if(CSS.supports('appearance','base-select')){
    const enhance=select=>{if(select.multiple||select.querySelector(':scope>button'))return;const button=document.createElement('button');button.type='button';button.className='lp-select-value';button.innerHTML='<selectedcontent></selectedcontent>';select.prepend(button);};
    document.querySelectorAll('select').forEach(enhance);
    new MutationObserver(records=>{for(const record of records){if(record.target instanceof HTMLSelectElement)enhance(record.target);for(const node of record.addedNodes)if(node instanceof Element){if(node.matches('select'))enhance(node);node.querySelectorAll('select').forEach(enhance);}}}).observe(document.documentElement,{childList:true,subtree:true});
  }
  function play(element,frames,options){const animation=element.animate(frames,options);running.add(animation);animation.finished.catch(()=>{}).finally(()=>running.delete(animation));return animation;}
  const views=new WeakMap();
  function entrance(style,dense){
    if(style==='spring')return {
      frames:[
        {opacity:dense ? .92 : .8,transform:`scale(${dense ? .985 : .94})`,offset:0,easing:ease},
        {opacity:1,transform:`scale(${dense?1.003:1.015})`,offset:.6,easing:'ease-in-out'},
        {opacity:1,transform:`scale(${dense?1:.997})`,offset:.82,easing:'ease-out'},
        {opacity:1,transform:'scale(1)',offset:1},
      ],duration:dense?300:460,easing:'linear',stagger:dense?0:14,
    };
    if(style==='smooth')return {
      frames:[{opacity:dense ? .9 : .65,transform:`translateY(${dense?4:12}px)`},{opacity:1,transform:'translateY(0)'}],
      duration:dense?240:320,easing:ease,stagger:dense?0:12,
    };
    return {frames:[{opacity:dense ? .92 : .82},{opacity:1}],duration:160,easing:'ease-out',stagger:0};
  }
  function enterView(container,key,selector='.link-card',options={}){
    if(!container)return;
    if(views.get(container)===key)return;
    views.set(container,key);
    if(!enabled())return;
    const cards=[...container.querySelectorAll(selector)],profile=entrance(root.dataset.motion,options.dense??cards.length>24);
    if(options.fresh)profile.frames[0]={...profile.frames[0],opacity:0};
    cards.filter(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}).slice(0,16).forEach((card,i)=>{
      // Delayed cards start in their first frame. Otherwise they paint fully,
      // then flash backwards when each staggered animation begins.
      card.classList.add('lp-entering');
      const animation=play(card,profile.frames,{duration:profile.duration,delay:Math.min(i*profile.stagger,72),easing:profile.easing,fill:'backwards'});
      animation.finished.catch(()=>{}).finally(()=>card.classList.remove('lp-entering'));
    });
  }
  function capture(container,selector,key){
    if(!enabled()||!container)return ()=>{};
    const before=new Map([...container.querySelectorAll(selector)].map(el=>[key(el),el.getBoundingClientRect()]));
    return ()=>{
      if(!enabled())return;
      container.querySelectorAll(selector).forEach(el=>{
        const old=before.get(key(el)),next=el.getBoundingClientRect();if(!old)return;
        const dx=old.left-next.left,dy=old.top-next.top;
        if(Math.abs(dx)+Math.abs(dy)<1)return;
        play(el,[{transform:`translate(${dx}px,${dy}px) scale(.985)`},{transform:'translate(0,0) scale(1)'}],{duration:duration(),easing:ease});
      });
    };
  }
  window.LinkPageMotion={enterView,capture};

  let card=null,frame=0,pointer={x:0,y:0},position={x:0,y:0};
  function clearCard(){if(card){card.style.removeProperty('--card-rx');card.style.removeProperty('--card-ry');card.style.removeProperty('--card-light-x');card.style.removeProperty('--card-light-y');card.classList.remove('lp-pointer-hover');card=null;}}
  function tick(){
    frame=0;if(!enabled()||!fine.matches){clearCard();return;}
    position.x+=(pointer.x-position.x)*.075;position.y+=(pointer.y-position.y)*.075;
    root.style.setProperty('--scene-pointer-x',position.x.toFixed(3));root.style.setProperty('--scene-pointer-y',position.y.toFixed(3));
    if(Math.abs(pointer.x-position.x)+Math.abs(pointer.y-position.y)>.002)frame=requestAnimationFrame(tick);
  }
  document.addEventListener('pointermove',event=>{
    if(!enabled()||!fine.matches||event.pointerType==='touch')return;
    if(['orbital','prism'].includes(root.dataset.ambient)){
      pointer={x:event.clientX/innerWidth*2-1,y:event.clientY/innerHeight*2-1};if(!frame)frame=requestAnimationFrame(tick);
    }
    const target=expressive()?event.target.closest('.link-card:not(.link-card-add):not(.lp-entering),.lp-widget:not(.lp-entering):not(.lp-widget-resizing):not(.lp-widget-dragging)'):null;
    if(target!==card){clearCard();card=target;}
    if(!card||card.matches('.dragging,.is-dragging,.lp-widget-resizing,.lp-widget-dragging')||document.body.classList.contains('is-link-dragging'))return;
    const box=card.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),y=Math.max(0,Math.min(1,(event.clientY-box.top)/box.height));
    card.style.setProperty('--card-rx',((.5-y)*5).toFixed(2)+'deg');card.style.setProperty('--card-ry',((x-.5)*7).toFixed(2)+'deg');
    card.style.setProperty('--card-light-x',x*100+'%');card.style.setProperty('--card-light-y',y*100+'%');card.classList.add('lp-pointer-hover');
  },{passive:true});
  document.documentElement.addEventListener('pointerleave',()=>{clearCard();pointer={x:0,y:0};if(!frame&&enabled())frame=requestAnimationFrame(tick);});
  document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-resize-widget]'))clearCard();},true);
  document.addEventListener('dragstart',event=>{clearCard();const item=event.target.closest('.link-card,.lp-widget,.group-nav-item,.section-nav-item');if(item&&enabled()){item.classList.add('lp-lifted');document.body.classList.add('lp-reordering');}},true);
  const release=()=>{document.querySelectorAll('.lp-lifted').forEach(el=>el.classList.remove('lp-lifted'));document.body.classList.remove('lp-reordering');};
  document.addEventListener('dragend',release,true);document.addEventListener('drop',()=>queueMicrotask(release),true);window.addEventListener('blur',release);
  function reset(){root.dataset.motionPaused=document.hidden?'on':'off';if(!expressive())clearCard();if(enabled())return;running.forEach(animation=>animation.cancel());cancelAnimationFrame(frame);frame=0;root.style.removeProperty('--scene-pointer-x');root.style.removeProperty('--scene-pointer-y');}
  reduced.addEventListener('change',reset);document.addEventListener('visibilitychange',reset);
  new MutationObserver(reset).observe(root,{attributes:true,attributeFilter:['data-motion']});
})();
