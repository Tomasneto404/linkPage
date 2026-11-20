// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {escapeHtml}=require('./markdownService');
function reader(body,query={},theme,embed){
  const font=['small','normal','large'].includes(query.font)?query.font:'normal';
  const width=['narrow','standard','wide'].includes(query.width)?query.width:'standard';
  const focus=query.focus==='1';const q=typeof query.q==='string'?query.q.trim().slice(0,80):'';
  const headings=[];
  body=body.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g,(_,level,text)=>{const id=`heading-${headings.length+1}`;headings.push({id,level,text:text.replace(/<[^>]+>/g,'')});return `<h${level} id="${id}">${text}</h${level}>`;});
  let matches=0;
  if(q){const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');body=body.split(/(<[^>]*>|&(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi).map(part=>/^[<&]/.test(part)?part:part.replace(re,text=>`<mark id="md-match-${++matches}">${text}</mark>`)).join('');}
  const select=(name,values,current)=>`<select name="${name}" aria-label="${name==='font'?'Text size':'Reading width'}">${values.map(([value,label])=>`<option value="${value}"${current===value?' selected':''}>${label}</option>`).join('')}</select>`;
  const ambientValues=require('../../public/ambient-settings').read({ambient_speed:query.speed,ambient_effect:query.effect,ambient_colors:query.colors});
  const effectInputs=[['speed',String(ambientValues.ambient_speed)],['effect',ambientValues.ambient_effect],['colors',JSON.stringify(ambientValues.ambient_colors)]].filter(([key])=>query[key]!==undefined).map(([key,value])=>`<input type="hidden" name="${key}" value="${escapeHtml(value)}">`).join('');
  const appearanceInputs=effectInputs+[['blend',['separate','particles','season']],['ambient',['off','aurora','mesh','waves','starlight','orbital','prism','custom']],['motion',['off','subtle','smooth','spring']]].filter(([key,values])=>values.includes(query[key])).map(([key])=>`<input type="hidden" name="${key}" value="${query[key]}">`).join('');
  const controls=`<details class="md-reader-tools"${q?' open':''}><summary>Reading options</summary><form method="get" class="md-reader-form">${theme?`<input type="hidden" name="theme" value="${theme}">`:''}${embed?'<input type="hidden" name="embed" value="1">':''}
  ${appearanceInputs}<label>Text size ${select('font',[['small','Small'],['normal','Default'],['large','Large']],font)}</label><label>Page width ${select('width',[['narrow','Narrow'],['standard','Reading'],['wide','Wide']],width)}</label>
  <label class="md-reader-focus"><input type="checkbox" name="focus" value="1"${focus?' checked':''}> Focus mode</label>
  <label>Find in document <input type="search" name="q" value="${escapeHtml(q)}" placeholder="Search this document"></label><button type="submit">Apply</button></form>
  ${q?`<p class="md-reader-results" role="status">${matches} match${matches===1?'':'es'}${matches?' · '+Array.from({length:Math.min(matches,20)},(_,i)=>`<a href="#md-match-${i+1}" aria-label="Match ${i+1}">${i+1}</a>`).join(' '):''}</p>`:''}</details>`;
  const toc=headings.length>1?`<details class="md-toc"><summary>Contents · ${headings.length} headings</summary><nav aria-label="Document contents">${headings.map(h=>`<a class="md-toc-level-${h.level}" href="#${h.id}">${h.text}</a>`).join('')}</nav></details>`:'';
  return {body,toolbar:controls+toc,attributes:` data-reading-font="${font}" data-reading-width="${width}"${focus?' data-reading-focus="on"':''}`};
}
const styles=`
:root { --reading-width: 760px; --reading-size: 16px; }
[data-reading-font="small"] { --reading-size: 14px; }
[data-reading-font="large"] { --reading-size: 19px; }
[data-reading-width="narrow"] { --reading-width: 600px; }
[data-reading-width="wide"] { --reading-width: 1080px; }
.md-shell { max-width: var(--reading-width); }
.md-doc { font-size: var(--reading-size); }
.md-reader-tools,.md-toc { background:var(--surface); border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:12px;font-size:13px; }
.md-reader-tools summary,.md-toc summary { cursor:pointer;font-weight:600;color:var(--text-2); }
.md-reader-form { display:flex;align-items:end;flex-wrap:wrap;gap:12px;padding-top:12px; }
.md-reader-form label { display:flex;flex-direction:column;gap:5px;color:var(--text-muted);font-size:12px; }
.md-reader-form input,.md-reader-form select,.md-reader-form button { font:inherit;color:var(--text);background:var(--surface-2);border:1px solid var(--border-strong);border-radius:8px;min-height:34px;padding:6px 9px; }
.md-reader-form button { cursor:pointer;background:var(--surface-3);font-weight:600; }
.md-reader-form .md-reader-focus { flex-direction:row;align-items:center;padding-bottom:6px; }
.md-reader-form input[type=checkbox] { min-height:0; }
.md-reader-form select { appearance:none;-webkit-appearance:none;min-width:128px;padding:9px 34px 9px 12px;min-height:40px;background-color:var(--surface-2);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='m3 4.5 3 3 3-3' fill='none' stroke='%23868e96' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;border-radius:10px;cursor:pointer;box-shadow:0 1px 2px rgb(0 0 0/.025); }
.md-reader-form select option{background:var(--surface);color:var(--text)}
.md-reader-form input[type=search],.md-reader-form button{min-height:40px;border-radius:10px;padding:9px 12px}
.md-reader-form label{font-weight:500;gap:7px}.md-reader-form .md-reader-focus{min-height:40px;padding-bottom:0}
.md-reader-results { margin:12px 0 0; }.md-reader-results a { display:inline-block;min-width:22px; }
.md-toc nav { display:flex;flex-direction:column;padding-top:10px;gap:6px; }.md-toc a { text-decoration:none; }.md-toc-level-3,.md-toc-level-4,.md-toc-level-5,.md-toc-level-6 { padding-left:16px; }
.md-doc :is(h1,h2,h3,h4,h5,h6,mark) { scroll-margin-top:20px; }
.md-doc mark { background:color-mix(in srgb,var(--primary) 20%,var(--surface));color:var(--text);border-radius:3px;padding:0 2px; }.md-doc mark:target { outline:2px solid var(--primary);outline-offset:2px; }
[data-reading-focus="on"] .md-back,[data-reading-focus="on"] .md-toc { display:none; }
[data-reading-focus="on"] .season-backdrop,[data-reading-focus="on"] .season-effects { display:none !important; }
[data-reading-focus="on"] body::before { display:none !important; }
.md-reader-form :focus-visible { outline:2px solid var(--primary);outline-offset:2px; }
@media(max-width:600px){.md-reader-form label:last-of-type { flex-basis:100%; }.md-reader-form input[type=search]{width:100%;}}
`;
module.exports={reader,styles};
