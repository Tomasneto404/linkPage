// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/** Trusted particle artwork and random placement shared by pages and script-free Markdown. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LinkPageParticles = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  const configs = {
    christmas: { kind: 'snow', count: 36, duration: 24, size: 17 },
    winter: { kind: 'snow', count: 30, duration: 29, size: 15 },
    halloween: { kind: 'bats', count: 9, duration: 29, size: 39 },
    autumn: { kind: 'leaves', count: 22, duration: 23, size: 25 },
    spring: { kind: 'seeds', count: 22, duration: 32, size: 28 },
    easter: { kind: 'petals', count: 20, duration: 27, size: 18 },
    summer: { kind: 'glints', count: 17, duration: 30, size: 13 },
  };
  const artwork = {
    snow: [
      '<g fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M16 2v28M4 9l24 14M4 23 28 9M16 7l-4-3m4 3 4-3M16 25l-4 3m4-3 4 3M8 11l-5 1m5-1-1-5M24 21l5-1m-5 1 1 5M8 21l-1 5m1-5-5-1M24 11l1-5m-1 5 5 1"/></g>',
      '<circle cx="16" cy="16" r="4" fill="currentColor"/>',
    ],
    bats: [
      '<g fill="currentColor"><path class="season-bat-wing season-bat-wing-left" d="M16 15C11 8 5 6 1 7c2 3 2 6 2 9 4-2 6 0 7 3 2-2 4-2 6 0Z"/><path class="season-bat-wing season-bat-wing-right" d="M16 15C21 8 27 6 31 7c-2 3-2 6-2 9-4-2-6 0-7 3-2-2-4-2-6 0Z"/><path d="m13 12 1-5 2 3 2-3 1 5c3 4 1 10-3 12-4-2-6-8-3-12Z"/></g>',
    ],
    leaves: [
      '<path fill="currentColor" d="m16 2 3 7 5-3-1 7 7 1-5 6 3 4-9 1-2 6-2-1 1-6-10-1 2-5-6-5 7-2-1-6 5 3Z"/><path d="m17 9-1 17m0-8-5-4m5 8 6-5" fill="none" stroke="var(--leaf-vein)" stroke-width=".8"/>',
      '<path d="M7 27C0 11 15 1 29 3 30 18 22 31 7 27Z" fill="currentColor"/><path d="M5 30 24 8m-13 15-1-8m6 3 8-1" fill="none" stroke="var(--leaf-vein)" stroke-width=".9" stroke-linecap="round"/>',
      '<path d="M16 29C15 22 1 20 2 11 5-1 12 7 16 5c5-5 14-3 14 6 0 8-12 13-14 18Z" fill="currentColor"/><path d="M16 30V10m0 12L7 12m9 10 9-10" fill="none" stroke="var(--leaf-vein)" stroke-width=".8"/>',
    ],
    seeds: [
      '<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M16 13q-1 9 5 16" stroke-width="1.1"/><path d="M16 13 4 8m12 5L7 3m9 10L13 1m3 12L19 1m-3 12L25 3m-9 10 12-5M4 8 3 5m1 3-3 1M7 3 6 1m1 2 3-1m3-1-2 1m2-1 2 1m4-1-2 1m2-1 2 1m4 1-3-1m3 1 1-2m2 7 3 1m-3-1 1-3" stroke-width=".85"/></g><ellipse cx="21" cy="29" rx="1.1" ry="2.3" fill="var(--seed-grain)" transform="rotate(-24 21 29)"/>',
    ],
    petals: [
      '<path d="M16 29C-2 21 1 4 15 3c14-2 20 13 1 26Z" fill="currentColor"/><path d="M16 25q-6-9-3-17" fill="none" stroke="var(--leaf-vein)" stroke-width=".7"/>',
    ],
    glints: [
      '<path d="M16 2c1 11 3 13 14 14-11 1-13 3-14 14C15 19 13 17 2 16 13 15 15 13 16 2Z" fill="currentColor"/>',
    ],
  };
  function markup(theme, { count, preview = false } = {}) {
    const config = Object.hasOwn(configs, theme) ? configs[theme] : null;
    if (!config) return '';
    count = Math.min(config.count, Math.max(0, Number.isFinite(count) ? Math.floor(count) : config.count));
    const particles = [];
    const phases = Array.from({ length: count }, (_, index) => index);
    for (let i = phases.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [phases[i], phases[j]] = [phases[j], phases[i]];
    }
    for (let i = 0; i < count; i++) {
      // Stratified positions and negative delays fill the screen immediately.
      const duration = config.duration * (.8 + Math.random() * .5) * (preview ? .5 : 1);
      const size = config.size * (.5 + Math.random() * .7) * (preview ? .85 : 1);
      // Independently shuffled phases fill the height from the very first frame.
      const phase = (phases[i] + Math.random()) / count;
      const properties = {
        '--start-x': `${((i + Math.random()) / count * 100).toFixed(2)}%`,
        '--start-y': `${(8 + Math.random() * 75).toFixed(2)}%`,
        '--duration': `${duration.toFixed(2)}s`,
        '--delay': `${(-duration * phase).toFixed(2)}s`,
        '--size': `${size.toFixed(1)}px`,
        '--wind': `${((Math.random() - .35) * (preview ? 90 : 240)).toFixed(1)}px`,
        '--sway': `${(10 + Math.random() * (preview ? 12 : 36)).toFixed(1)}px`,
        '--sway-duration': `${(3 + Math.random() * 5).toFixed(2)}s`,
        '--sway-delay': `${(-Math.random() * 12).toFixed(2)}s`,
        '--turn': `${(Math.random() * 120 - 60).toFixed(1)}deg`,
        '--flap-duration': `${(.38 + Math.random() * .28).toFixed(2)}s`,
        '--particle-alpha': (.35 + Math.random() * .4).toFixed(2),
      };
      const style = Object.entries(properties).map(([key, value]) => `${key}:${value}`).join(';');
      const svg = artwork[config.kind][i % artwork[config.kind].length];
      particles.push(`<span class="season-particle season-particle-variant-${i % 3}" style="${style}"><span class="season-particle-drift"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" focusable="false" aria-hidden="true">${svg}</svg></span></span>`);
    }
    return particles.join('');
  }
  return { configs, markup };
});
