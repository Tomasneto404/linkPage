// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * Picks a theme and applies it before the page paints.
 *
 * Loaded from <head>, synchronously, on purpose: anything that waits for the
 * body or for a fetch gives a dark-mode visitor a white flash first. The whole
 * file has to be cheap enough to run inline on the critical path.
 *
 * This is the small shared core — read the preference, set the attribute. The
 * public page and the admin panel each have a richer version on top of it that
 * also moves logos, wallpapers and accent colours around, because those are
 * their own furniture. A standalone page like the sign-in screen wants only
 * this much.
 */

(function () {
  const KEY = 'linkpage_theme';
  const CACHE_KEY='linkpage_appearance_v1';
  const APPEARANCE_KEYS=['ambient_speed','ambient_colors','ambient_effect','ambient_blend','ambient_background','motion_style','default_theme','accent_color','accent_dark_adjust','bar_opacity','theme_light_variant','theme_dark_variant','season_theme','season_manual_theme','season_schedule','season_effects','season_background','wallpaper_light','wallpaper_dark','wallpaper_fog'];
  let appearance={};try{appearance=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');}catch{}
  try{const boot=JSON.parse(document.getElementById('linkpageAppearanceBoot')?.textContent||'null');if(boot&&typeof boot==='object'&&!Array.isArray(boot))appearance={...appearance,...boot};}catch{}
  function daylight(now=new Date()){
    let hours={start:'07:00',end:'19:00'};try{hours={...hours,...JSON.parse(localStorage.getItem('linkpage_daylight_hours')||'{}')};}catch{}
    const minutes=value=>{const match=/^(\d{2}):(\d{2})$/.exec(value);return match?Number(match[1])*60+Number(match[2]):null;};
    const start=minutes(hours.start)??420,end=minutes(hours.end)??1140,current=now.getHours()*60+now.getMinutes();
    return (start<end?current>=start&&current<end:current>=start||current<end)?'light':'dark';
  }
  function applyMotion(){
    let style=appearance.motion_style||'subtle',ambient=appearance.ambient_background||'off',blend=appearance.ambient_blend||'separate';
    try{style=localStorage.getItem('linkpage_motion')||style;ambient=localStorage.getItem('linkpage_ambient')||ambient;blend=localStorage.getItem('linkpage_ambient_blend')||blend;}catch{}
    if(!['off','subtle','smooth','spring'].includes(style))style='subtle';if(!['off','aurora','mesh','waves','starlight','orbital','prism','custom'].includes(ambient))ambient='off';
    if(document.documentElement.dataset.motion!==style)document.documentElement.setAttribute('data-motion',style);
    if(document.documentElement.dataset.ambient!==ambient)document.documentElement.setAttribute('data-ambient',ambient);
    let options=appearance;try{options={...appearance,...JSON.parse(localStorage.getItem('linkpage_ambient_options')||'{}')};}catch{}
    const data=window.LinkPageAmbient?.read(options)||{ambient_speed:1,ambient_colors:['#6aa7ff','#a38cff','#efb4cd'],ambient_effect:'fade'};document.documentElement.dataset.ambientEffect=data.ambient_effect;
    document.documentElement.style.setProperty('--ambient-speed',String(data.ambient_speed));for(let index=0;index<6;index++)document.documentElement.style.setProperty('--ambient-color-'+(index+1),data.ambient_colors[index%data.ambient_colors.length]);
    document.documentElement.dataset.ambientBlend=['particles','season'].includes(blend)?blend:'separate';
  }
  function rememberAppearance(settings){appearance=Object.fromEntries(APPEARANCE_KEYS.filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]]));try{localStorage.setItem(CACHE_KEY,JSON.stringify(appearance));}catch{}applyMotion();}

  /** What this browser has been told to use, or what the system prefers. */
  function initialTheme(fallback) {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
      if (saved === 'daylight') return daylight();
      if (saved === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
    } catch { /* private window, or storage turned off */ }

    fallback=fallback||appearance.default_theme;
    if(fallback==='daylight')return daylight();
    if (fallback === 'light' || fallback === 'dark') return fallback;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme, save) {
    if(document.documentElement.dataset.theme!==theme)document.documentElement.setAttribute('data-theme', theme);
    if (save) {
      try { localStorage.setItem(KEY, theme); } catch { /* nothing to be done */ }
    }
  }

  /** Light and dark palette variants, which the server supplies per instance. */
  function applyVariants({ light, dark } = {}) {
    const root = document.documentElement;
    if (light) root.setAttribute('data-light-variant', light);
    if (dark)  root.setAttribute('data-dark-variant', dark);
  }

  // ─── The rest of the instance's look ──────────────────────────────────────
  //
  // The accent, the wallpaper and its fog, and how solid the bars are — what
  // the public page applies, for the pages that sign somebody in. The numbers
  // are the public page's exactly (public/js/core.js applyAccent, applyWallpaper,
  // applyBarOpacity), so a sign-in screen and the page it leads to cannot look
  // like two different products. tests/color.test.js holds the colour maths to
  // the same answers as the other copies.

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shadeColor(hex, pct) {
    const target = pct < 0 ? 0 : 255;
    const amount = Math.abs(pct) / 100;
    return '#' + hexToRgb(hex)
      .map(c => Math.round((target - c) * amount + c).toString(16).padStart(2, '0'))
      .join('');
  }

  function applyAccent(settings, theme) {
    const root = document.documentElement.style;
    const accent = settings.accent_color;
    if (!/^#[0-9a-f]{6}$/i.test(accent || '')) {
      root.removeProperty('--primary');
      root.removeProperty('--primary-rgb');
      root.removeProperty('--primary-hover');
      root.removeProperty('--on-primary');
      return;
    }
    const dark = theme === 'dark';
    const base = dark && settings.accent_dark_adjust ? shadeColor(accent, 18) : accent;
    root.setProperty('--primary', base);
    root.setProperty('--primary-rgb', hexToRgb(base).join(','));
    root.setProperty('--primary-hover', shadeColor(base, dark ? 12 : -8));
    const luminance = hexToRgb(base).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    root.setProperty('--on-primary', luminance[0] * .2126 + luminance[1] * .7152 + luminance[2] * .0722 > .179 ? '#111111' : '#ffffff');
  }

  function applyBarOpacity(value) {
    const raw = Number.isFinite(value) ? value : 82;
    const t = Math.min(100, Math.max(0, raw)) / 100;
    const root = document.documentElement.style;
    root.setProperty('--bar-alpha', t.toFixed(3));
    root.setProperty('--bar-blur', `${(t * 24).toFixed(1)}px`);
  }

  /**
   * Puts the wallpaper for `theme` up, or takes it down when there is none.
   *
   * The variables go on the root, not on the #wallpaper element, because two
   * things read them: that element behind the page, and the sign-in gate, which
   * paints its own copy so it can stay an opaque cover.
   */
  function applyWallpaper(settings, theme) {
    const url = theme === 'dark' ? settings.wallpaper_dark : settings.wallpaper_light;
    if (!url) { clearWallpaper(); return; }

    const raw = Number.isFinite(settings.wallpaper_fog) ? settings.wallpaper_fog : 60;
    const fog = Math.min(100, Math.max(0, raw)) / 100;

    const root = document.documentElement.style;
    // encodeURI, and quoted, so a path can never break out of the url() token.
    root.setProperty('--wallpaper-image', `url("${encodeURI(url)}")`);
    root.setProperty('--wallpaper-blur', `${(fog * 18).toFixed(1)}px`);
    root.setProperty('--wallpaper-veil', (fog * 0.94).toFixed(3));
    document.getElementById('wallpaper')?.classList.add('is-on');
    document.body?.classList.add('has-wallpaper');
  }

  function clearWallpaper() {
    const root = document.documentElement.style;
    root.removeProperty('--wallpaper-image');
    root.removeProperty('--wallpaper-blur');
    root.removeProperty('--wallpaper-veil');
    document.getElementById('wallpaper')?.classList.remove('is-on');
    document.body?.classList.remove('has-wallpaper');
  }

  /**
   * Everything above, from the public settings payload. A page calls this once
   * it has /api/settings, and again whenever the theme changes, since both the
   * accent and the wallpaper have a light and a dark version.
   */
  /**
   * Dresses the page in a season — Easter, Halloween, Christmas, Spring,
   * Autumn, Winter or Summer — as a data attribute the stylesheet keys on.
   * 'none' takes it off. Applied before the accent so an admin's chosen
   * accent still wins; a season decides surfaces, backgrounds and shapes.
   */
  const SEASONS = ['easter', 'halloween', 'christmas', 'spring', 'autumn', 'winter', 'summer'];
  function applySeason(name) {
    const root = document.documentElement;
    if (SEASONS.includes(name)) {if(root.dataset.season!==name)root.setAttribute('data-season', name);}
    else if(root.hasAttribute('data-season'))root.removeAttribute('data-season');
  }

  let seasonSettings;
  function refreshSeason() {
    if (!seasonSettings) return;
    const s = seasonSettings;
    applySeason(window.LinkPageSeasons
      ? window.LinkPageSeasons.resolve(s.season_manual_theme ?? s.season_theme, s.season_schedule)
      : s.season_theme);
  }
  function applySeasonSettings(settings) {
    seasonSettings = settings;
    document.documentElement.setAttribute('data-season-effects', settings.season_effects === false ? 'off' : 'on');
    document.documentElement.setAttribute('data-season-background', ['static', 'animated'].includes(settings.season_background) ? settings.season_background : 'minimal');
    refreshSeason();
  }
  // Open pages switch after midnight too, including after a suspended tab wakes.
  setInterval(refreshSeason, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSeason(); });

  function applyAppearance(settings, theme) {
    rememberAppearance(settings);
    const t = theme || initialTheme(settings.default_theme);
    applyTheme(t, false);
    applyVariants({ light: settings.theme_light_variant, dark: settings.theme_dark_variant });
    applySeasonSettings(settings);
    applyAccent(settings, t);
    applyBarOpacity(settings.bar_opacity);
    applyWallpaper(settings, t);
    return t;
  }
  function refreshTheme(){const theme=initialTheme(appearance.default_theme);if(document.documentElement.dataset.theme!==theme){if(typeof window.applyTheme==='function')window.applyTheme(theme,false);else applyAppearance(appearance,theme);}}
  let applyingTransition=false,currentTransition=null;
  function transitionTheme(theme,commit){
    if(applyingTransition||document.documentElement.dataset.theme===theme||document.readyState==='loading'||document.hidden||document.documentElement.dataset.motion==='off'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||typeof document.startViewTransition!=='function')return false;
    currentTransition?.skipTransition();
    document.documentElement.classList.add('theme-view-transition');
    try{
      const transition=document.startViewTransition(()=>{applyingTransition=true;try{commit();}finally{applyingTransition=false;}});currentTransition=transition;
      transition.finished.catch(()=>{}).finally(()=>{if(currentTransition===transition){currentTransition=null;document.documentElement.classList.remove('theme-view-transition');}});
      return true;
    }catch{document.documentElement.classList.remove('theme-view-transition');return false;}
  }
  function animateNavigation(element){
    const style=document.documentElement.dataset.motion||'subtle';if(!element||style==='off'||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    element.getAnimations().forEach(animation=>animation.cancel());
    element.animate([{transform:`translateY(${style==='subtle'?3:8}px)`},{transform:'translateY(0)'}],{duration:style==='subtle'?130:style==='smooth'?220:320,easing:style==='spring'?'cubic-bezier(.34,1.3,.64,1)':'cubic-bezier(.22,1,.36,1)'});
  }
  function openPreferences(){
    const dialog=document.createElement('dialog');dialog.className='lp-dialog lp-appearance-dialog';dialog.setAttribute('aria-label','Appearance');
    let saved='';try{saved=localStorage.getItem(KEY)||'';}catch{}
    dialog.innerHTML='<div class="lp-dialog-head"><h2>Appearance</h2><button type="button" class="lp-close" aria-label="Close">×</button></div><form><label>Theme<select name="mode"><option value="">Use site default</option><option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option><option value="daylight">Automatic day / night</option></select></label><p>Automatic mode follows the local time on this device.</p><div class="ws-columns"><label>Light from<input name="start" type="time" value="07:00" required></label><label>Dark from<input name="end" type="time" value="19:00" required></label></div><div class="lp-share-actions"><button type="submit" class="lp-action lp-action-primary">Save preference</button></div><p role="status"></p></form>';
    dialog.querySelector('select').value=saved;
    const motion=document.createElement('label');motion.className='ws-field';motion.innerHTML='UI animations<select name="motion"><option value="">Use site default</option><option value="off">Off</option><option value="subtle">Subtle · fade</option><option value="smooth">Smooth · glide</option><option value="spring">Spring · bounce</option></select><small>Your device’s reduced-motion preference always applies.</small>';dialog.querySelector('.lp-share-actions').before(motion);
    try{motion.querySelector('select').value=localStorage.getItem('linkpage_motion')||'';}catch{}
    const ambient=document.createElement('label');ambient.className='ws-field';ambient.innerHTML='Background<select name="ambient"><option value="">Use site default</option><option value="off">Original / minimalist</option><option value="aurora">Aurora</option><option value="mesh">Colour mesh</option><option value="waves">Soft colour waves</option><option value="starlight">Starlight</option><option value="orbital">Orbital · 3D</option><option value="prism">Glass sculptures · 3D</option><option value="custom">Custom fade</option></select>';dialog.querySelector('.lp-share-actions').before(ambient);
    try{ambient.querySelector('select').value=localStorage.getItem('linkpage_ambient')||'';}catch{}
    const effects=document.createElement('div');dialog.querySelector('.lp-share-actions').before(effects);let savedEffects={};try{savedEffects=JSON.parse(localStorage.getItem('linkpage_ambient_options')||'{}');}catch{}window.LinkPageAmbientEditor.mount(effects,{...appearance,...savedEffects},{inherit:true,inherited:!Object.keys(savedEffects).length});
    const blend=document.createElement('label');blend.className='ws-field';blend.innerHTML='Background composition<select name="blend"><option value="">Use site default</option><option value="separate">Custom background only</option><option value="particles">Season particles + custom</option><option value="season">Full season + custom</option></select>';dialog.querySelector('.lp-share-actions').before(blend);
    try{blend.querySelector('select').value=localStorage.getItem('linkpage_ambient_blend')||'';}catch{}
    try{const hours=JSON.parse(localStorage.getItem('linkpage_daylight_hours')||'{}');for(const key of ['start','end'])if(/^\d{2}:\d{2}$/.test(hours[key]))dialog.querySelector(`[name=${key}]`).value=hours[key];}catch{}
    dialog.querySelector('.lp-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
    dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const data=new FormData(event.target);if(data.get('start')===data.get('end')){dialog.querySelector('[role=status]').textContent='Choose two different times.';return;}try{data.get('mode')?localStorage.setItem(KEY,data.get('mode')):localStorage.removeItem(KEY);data.get('motion')?localStorage.setItem('linkpage_motion',data.get('motion')):localStorage.removeItem('linkpage_motion');data.get('ambient')?localStorage.setItem('linkpage_ambient',data.get('ambient')):localStorage.removeItem('linkpage_ambient');data.get('blend')?localStorage.setItem('linkpage_ambient_blend',data.get('blend')):localStorage.removeItem('linkpage_ambient_blend');Object.keys(effects.ambientValue()).length?localStorage.setItem('linkpage_ambient_options',JSON.stringify(effects.ambientValue())):localStorage.removeItem('linkpage_ambient_options');localStorage.setItem('linkpage_daylight_hours',JSON.stringify({start:data.get('start'),end:data.get('end')}));}catch{}applyMotion();refreshTheme();dialog.close();};
    document.body.appendChild(dialog);dialog.showModal();
  }

  window.LinkPageTheme = {
    initialTheme, applyTheme, applyVariants,
    applyAppearance, clearWallpaper, applySeason, applySeasonSettings,
    hexToRgb, shadeColor,
    STORAGE_KEY: KEY,
    rememberAppearance,daylight,openPreferences,refreshTheme,
    ambientQuery(){const root=document.documentElement,data=window.LinkPageAmbient.read({ambient_speed:root.style.getPropertyValue('--ambient-speed'),ambient_effect:root.dataset.ambientEffect,ambient_colors:Array.from({length:6},(_,i)=>root.style.getPropertyValue('--ambient-color-'+(i+1)))});return '&'+new URLSearchParams({speed:String(data.ambient_speed),effect:data.ambient_effect,colors:JSON.stringify(data.ambient_colors)});},
    transitionTheme,
    animateNavigation,
  };

  // Apply straight away with what we know now. A page that later learns the
  // instance's configured default can call applyTheme again.
  applyAppearance(appearance,initialTheme());
  document.addEventListener('DOMContentLoaded',()=>applyWallpaper(appearance,document.documentElement.dataset.theme));
  document.addEventListener('DOMContentLoaded',()=>{for(const host of [document.body,...document.querySelectorAll('.gate')]){const layer=document.createElement('div');layer.className='ambient-scene';layer.setAttribute('aria-hidden','true');layer.inert=true;host.prepend(layer);}});
  setInterval(refreshTheme,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTheme();});
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change',refreshTheme);
})();
