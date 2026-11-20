// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/* The same CSS geometry is rendered on app pages and script-free Markdown. */
(function(root){
  function markup(){
    const cube=()=>'<div class="scene-cube">'+Array.from({length:6},(_,i)=>`<i class="scene-face scene-face-${i}"></i>`).join('')+'</div>';
    return '<div class="scene3d-world" aria-hidden="true"><div class="scene-object scene-primary"><div class="scene-orbits"><i></i><i></i><i></i><b class="scene-orb"></b></div></div><div class="scene-object scene-sculpture">'+cube()+'</div><div class="scene-object scene-secondary">'+cube()+'</div><div class="scene-object scene-satellite"><b class="scene-orb"></b></div><div class="scene-object scene-halo"><i></i></div></div>';
  }
  if(typeof module==='object'&&module.exports)module.exports={markup};
  else{
    root.LinkPageGeometry={markup};
    document.addEventListener('DOMContentLoaded',()=>{
      document.querySelectorAll('.ambient-scene').forEach(layer=>layer.insertAdjacentHTML('beforeend',markup()));
    });
  }
})(typeof window==='undefined'?globalThis:window);
