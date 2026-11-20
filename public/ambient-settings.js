// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.LinkPageAmbient=value;})(typeof globalThis==='object'?globalThis:this,function(){
  const defaults={ambient_speed:1,ambient_colors:['#6aa7ff','#a38cff','#efb4cd'],ambient_effect:'fade'};
  const effects=['fade','drift','ripple','orbit'];
  function validate(input){
    const clean={};
    if(input.ambient_speed!==undefined){const value=Number(input.ambient_speed);if(!Number.isFinite(value)||value<.25||value>3)throw new Error('Choose an effect speed between 0.25 and 3');clean.ambient_speed=value;}
    if(input.ambient_effect!==undefined){if(!effects.includes(input.ambient_effect))throw new Error('Choose a valid custom fade effect');clean.ambient_effect=input.ambient_effect;}
    if(input.ambient_colors!==undefined){let colors=input.ambient_colors;if(typeof colors==='string')try{colors=JSON.parse(colors);}catch{throw new Error('Choose valid background colours');}if(!Array.isArray(colors)||colors.length<2||colors.length>6||colors.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))throw new Error('Choose two to six background colours');clean.ambient_colors=colors.map(color=>color.toLowerCase());}
    return clean;
  }
  function read(input={}){const value={...defaults};for(const key of Object.keys(defaults))if(input[key]!==undefined&&input[key]!==null)try{Object.assign(value,validate({[key]:input[key]}));}catch{}return value;}
  function css(input){const value=read(input);return '--ambient-speed:'+value.ambient_speed+';'+Array.from({length:6},(_,index)=>'--ambient-color-'+(index+1)+':'+value.ambient_colors[index%value.ambient_colors.length]+';').join('');}
  return {defaults,effects,validate,read,css};
});
