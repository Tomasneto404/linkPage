// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/* Presentation shared by the dashboard and its live editor preview. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=(name,size=16)=>window.LinkPageIcons.svg(name,size);
  function date(value,options){const instant=new Date(value);return Number.isNaN(instant.getTime())?'':new Intl.DateTimeFormat(undefined,options||{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(instant);}
  function weather(code,day=1){const name=code===0?(day?'sun':'moon'):code<=3?'cloud':code>=71&&code<=77||code>=85&&code<=86?'snow':code>=95?'storm':code>=51?'rain':'fog';return icon(name,32);}
  const number=value=>Number.isFinite(value)?Math.round(value):'—';
  function readSet(row,value){
    const read=new Set(value.read||[]);
    if(row.read_tracking==='browser')try{for(const id of JSON.parse(localStorage.getItem('linkpage_widget_read_'+row.id)||'[]'))read.add(String(id));}catch{}
    return read;
  }
  function render(row,value,{preview=false}={}){
    if(!value?.data)return `<p class="lp-widget-status">${esc(value?.error||'Loading…')}</p>`;
    const data=value.data,config=row.options||row.config||{};
    if(row.kind==='clock'){
      const face=config.mode==='analog'?`<div class="lp-clock-face" aria-hidden="true"><span class="lp-clock-twelve">12</span><span class="lp-clock-six">6</span><span class="lp-clock-nine">9</span><span class="lp-clock-three">3</span><i class="lp-clock-hand lp-clock-hour"></i><i class="lp-clock-hand lp-clock-minute"></i>${config.seconds!==false?'<i class="lp-clock-hand lp-clock-second"></i>':''}<b></b></div>`:'';
      const zones=data.zones||config.zones||[];
      return face+'<div class="lp-widget-clock" aria-label="Current time"></div><div class="lp-widget-date"></div>'+(zones.length?'<div class="lp-clock-zones">'+zones.map((zone,i)=>`<div><span>${esc(zone.label)}</span><time data-clock-zone="${i}"></time></div>`).join('')+'</div>':'');
    }
    if(row.kind==='note')return data.format==='markdown'?`<div class="lp-widget-note lp-widget-markdown">${data.html}</div>`:`<div class="lp-widget-note">${esc(data.text)}</div>`;
    if(row.kind==='rss')return data.items.length?`<ul class="lp-widget-list${config.view==='cards'?' lp-feed-cards':''}">`+data.items.map(item=>`<li>${config.show_images&&item.image?`<img class="lp-feed-image" src="${esc(item.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}<div><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>${item.date&&date(item.date)?`<time datetime="${esc(item.date)}">${esc(date(item.date))}</time>`:''}${config.show_description!==false&&item.description?'<p>'+esc(item.description)+'</p>':''}</div></li>`).join('')+'</ul>':'<p class="lp-widget-status">No articles match this feed’s filter.</p>';
    if(row.kind==='gotify'){
      const read=readSet(row,value),unread=data.messages.filter(item=>!read.has(item.id)),only=Boolean(config.unread_only);
      const messages=only?unread:data.messages;
      return `<div class="lp-gotify-summary"><span>${unread.length} unread</span>${unread.length&&!preview?'<button type="button" class="lp-widget-text-button" data-read-all>Mark all read</button>':''}</div>`+(messages.length?'<ul class="lp-widget-list">'+messages.map(item=>`<li class="lp-message${read.has(item.id)?' is-read':''}"><div><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${esc(date(item.date))} · Priority ${esc(item.priority)}</small></div>${!preview&&!read.has(item.id)?`<button type="button" class="lp-widget-text-button" data-read-msg="${esc(item.id)}">Mark read</button>`:''}</li>`).join('')+'</ul>':'<p class="lp-widget-status">You’re all caught up.</p>');
    }
    const details=[['Feels like',data.feels_like,data.unit],['Wind',data.wind,data.wind_unit||'km/h'],['Humidity',data.humidity,'%'],['Rain',data.precipitation,'mm']].filter(([,n])=>Number.isFinite(n));
    return `<div class="lp-weather-main"><span class="lp-weather-symbol" aria-hidden="true">${weather(data.code,data.is_day)}</span><span>${number(data.temperature)}${esc(data.unit)}</span></div><p class="lp-widget-date">${esc(data.location)}</p>${details.length?'<dl class="lp-weather-details">'+details.map(([label,n,unit])=>`<div><dt>${label}</dt><dd>${number(n)}${unit==='%'?'':' '}${esc(unit)}</dd></div>`).join('')+'</dl>':''}${data.forecast?.length?'<div class="lp-weather-forecast" aria-label="Weather forecast">'+data.forecast.map(day=>`<div><time datetime="${esc(day.date)}">${esc(date(day.date+'T12:00:00',{weekday:'short'}))}</time>${weather(day.code)}<strong>${number(day.high)}° <span>${number(day.low)}°</span></strong>${day.rain!==undefined?`<small>${number(day.rain)}% rain</small>`:''}</div>`).join('')+'</div>':''}<a class="lp-widget-attribution" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather by Open-Meteo</a>`;
  }
  function clock(element,data){
    if(!data)return;
    try{
      const options=data.timezone==='local'?{}:{timeZone:data.timezone},now=new Date();
      const value=new Intl.DateTimeFormat(undefined,{...options,hour:'2-digit',minute:'2-digit',...(data.seconds!==false?{second:'2-digit'}:{}),hour12:data.hour12}).format(now);
      const time=element.querySelector('.lp-widget-clock');if(time&&time.textContent!==value)time.textContent=value;
      const dateElement=element.querySelector('.lp-widget-date'),day=new Intl.DateTimeFormat(undefined,{...options,weekday:'long',day:'numeric',month:'long'}).format(now);if(dateElement&&dateElement.textContent!==day)dateElement.textContent=day;
      if(element.querySelector('.lp-clock-face')){
        const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{...options,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(part=>[part.type,part.value]));
        const hour=Number(parts.hour),minute=Number(parts.minute),second=data.seconds!==false?Number(parts.second):0;
        for(const [selector,degrees]of [['hour',(hour%12)*30+minute*.5],['minute',minute*6+second*.1],['second',second*6]])element.querySelector('.lp-clock-'+selector)?.style.setProperty('--hand-angle',degrees+'deg');
      }
      (data.zones||[]).forEach((zone,index)=>{const node=element.querySelector(`[data-clock-zone="${index}"]`);if(!node)return;const value=new Intl.DateTimeFormat(undefined,{...(zone.timezone==='local'?{}:{timeZone:zone.timezone}),hour:'2-digit',minute:'2-digit',hour12:data.hour12}).format(now);if(node.textContent!==value)node.textContent=value;});
    }catch{}
  }
  function hydrate(element,row,value){
    if(row.kind==='clock')clock(element,value?.data);
    element.querySelectorAll('[data-task-line]').forEach(input=>{input.disabled=!row.can_manage;});
  }
  window.LinkPageWidgetView={esc,icon,date,weather,readSet,render,clock,hydrate};
})();
