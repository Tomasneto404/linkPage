// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const harness=require('./helpers/harness');let c;
before(async()=>c=await harness.start());after(harness.stop);
const theme=json=>c.api('/api/settings/theme',{method:'POST',json});
test('effect speed, custom palettes and effects validate and survive presets and first paint',async()=>{
  const chosen={ambient_background:'custom',ambient_speed:1.75,ambient_colors:['#112233','#aabbcc','#cc7733'],ambient_effect:'ripple'};
  assert.equal((await theme(chosen)).status,200);const settings=(await c.pub('/api/settings')).body;for(const [key,value]of Object.entries(chosen))assert.deepEqual(settings[key],value);
  const pack=require('../src/services/appearanceService').pack(),imported=require('../src/services/appearanceService').unpack(pack);assert.equal(imported.ambient_background,'custom');assert.equal(imported.ambient_speed,'1.75');assert.deepEqual(JSON.parse(imported.ambient_colors),chosen.ambient_colors);
  const html=(await c.pub('/')).text;assert.match(html,/"ambient_speed":1.75/);assert.match(html,/"ambient_colors":\["#112233"/);
  for(const invalid of [{ambient_speed:0},{ambient_speed:3.1},{ambient_speed:'fast'},{ambient_colors:['#112233']},{ambient_colors:['red','#112233']},{ambient_colors:['#112233','</style><script>']},{ambient_effect:'flash'}])assert.equal((await theme(invalid)).status,400,JSON.stringify(invalid));
  assert.equal((await c.pub('/api/settings/theme',{method:'POST',json:chosen})).status,401);
});
test('Markdown inherits palettes and timing, with safe optional reader overrides',async()=>{
  await c.makeFileLink({name:'Ambient document',fileName:'ambient.md',bytes:Buffer.from('# Ambient document'),slug:'ambient-document'});
  const inherited=await c.pub('/f/ambient-document');assert.equal(inherited.status,200);assert.match(inherited.text,/data-ambient="custom"/);assert.match(inherited.text,/data-ambient-effect="ripple"/);assert.match(inherited.text,/--ambient-speed:1.75/);assert.match(inherited.text,/--ambient-color-1:#112233/);assert.doesNotMatch(inherited.text,/<script/);
  const query=new URLSearchParams({ambient:'custom',speed:'0.5',effect:'orbit',colors:JSON.stringify(['#123456','#654321'])}),custom=await c.pub('/f/ambient-document?'+query);assert.equal(custom.status,200);assert.match(custom.text,/--ambient-speed:0.5/);assert.match(custom.text,/data-ambient-effect="orbit"/);assert.match(custom.text,/name="colors"/);assert.match(custom.text,/--ambient-color-1:#123456/);
  const unsafe=await c.pub('/f/ambient-document?ambient=custom&speed=999&effect=bad&colors='+encodeURIComponent('["</style><script>alert(1)</script>"]'));assert.equal(unsafe.status,200);assert.doesNotMatch(unsafe.text,/<script|--ambient-speed:999/);
});
