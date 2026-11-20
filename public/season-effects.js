// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** A small, bounded layer of CSS-animated SVGs. No animation loop or network. */
(function () {
  const root = document.documentElement;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 720px)');
  const showcase = document.getElementById('seasonShowcase');
  const gates = [...document.querySelectorAll('.gate')];
  const { configs, markup } = window.LinkPageParticles;
  const layers = new Map();

  function clear(key) {
    layers.get(key)?.element.remove();
    layers.delete(key);
  }

  function render(key, host, theme, enabled) {
    const config = Object.hasOwn(configs, theme) ? configs[theme] : null;
    if (!host || !enabled || motion.matches || !config) { clear(key); return; }
    const preview = key === 'preview';
    const count = preview ? Math.min(config.count, 9) : Math.round(config.count * (compact.matches ? .55 : 1));
    const signature = `${theme}:${count}:${preview ? host.clientWidth + ':' + host.clientHeight : ''}`;
    const previous = layers.get(key);
    if (previous?.signature === signature) {
      if (previous.element.parentElement !== host) host.appendChild(previous.element);
      return;
    }
    clear(key);
    const layer = document.createElement('div');
    layer.className = `season-effects season-effects-${config.kind}${preview ? ' season-effects-preview' : ''}`;
    layer.dataset.effect = theme;
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    if (!preview) layer.id = 'seasonEffects';
    else {
      layer.style.setProperty('--travel-y', `${host.clientHeight + 110}px`);
      layer.style.setProperty('--travel-x', `${host.clientWidth + 110}px`);
    }
    layer.innerHTML = markup(theme, { count, preview });
    host.appendChild(layer);
    layers.set(key, { element: layer, signature });
  }

  function sync() {
    root.dataset.seasonPaused = document.hidden ? 'on' : 'off';
    const host = gates.find(gate => !gate.classList.contains('hidden')) || document.body;
    const custom=(root.dataset.ambient&&root.dataset.ambient!=='off')||document.body.classList.contains('has-wallpaper');
    const seasonAllowed=!custom||['particles','season'].includes(root.dataset.ambientBlend);
    render('page', host, root.dataset.season, root.dataset.seasonEffects !== 'off'&&seasonAllowed);
    render('preview', showcase, showcase?.dataset.seasonPreview, showcase?.dataset.seasonEffectsPreview !== 'off');
    for (const { element } of layers.values()) element.classList.toggle('is-paused', document.hidden);
    const note = document.getElementById('seasonMotionNote');
    if (note) note.hidden = !motion.matches;
  }
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['data-season', 'data-season-effects','data-ambient','data-ambient-blend'] });
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  if (showcase) observer.observe(showcase, { attributes: true, attributeFilter: ['data-season-preview', 'data-season-effects-preview'] });
  for (const gate of gates) observer.observe(gate, { attributes: true, attributeFilter: ['class'] });
  motion.addEventListener('change', sync);
  compact.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  // Preview dimensions can change when opening Settings or rotating a phone.
  if (showcase && typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(showcase);
  sync();
})();
