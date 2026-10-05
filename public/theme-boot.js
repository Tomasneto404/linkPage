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

  /** What this browser has been told to use, or what the system prefers. */
  function initialTheme(fallback) {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* private window, or storage turned off */ }

    if (fallback === 'light' || fallback === 'dark') return fallback;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme, save) {
    document.documentElement.setAttribute('data-theme', theme);
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
  // are the public page's exactly (public/app.js applyAccent, applyWallpaper,
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
      return;
    }
    const dark = theme === 'dark';
    const base = dark && settings.accent_dark_adjust ? shadeColor(accent, 18) : accent;
    root.setProperty('--primary', base);
    root.setProperty('--primary-rgb', hexToRgb(base).join(','));
    root.setProperty('--primary-hover', shadeColor(base, dark ? 12 : -8));
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
    document.body.classList.add('has-wallpaper');
  }

  function clearWallpaper() {
    const root = document.documentElement.style;
    root.removeProperty('--wallpaper-image');
    root.removeProperty('--wallpaper-blur');
    root.removeProperty('--wallpaper-veil');
    document.getElementById('wallpaper')?.classList.remove('is-on');
    document.body.classList.remove('has-wallpaper');
  }

  /**
   * Everything above, from the public settings payload. A page calls this once
   * it has /api/settings, and again whenever the theme changes, since both the
   * accent and the wallpaper have a light and a dark version.
   */
  function applyAppearance(settings, theme) {
    const t = theme || initialTheme(settings.default_theme);
    applyTheme(t, false);
    applyVariants({ light: settings.theme_light_variant, dark: settings.theme_dark_variant });
    applyAccent(settings, t);
    applyBarOpacity(settings.bar_opacity);
    applyWallpaper(settings, t);
    return t;
  }

  window.LinkPageTheme = {
    initialTheme, applyTheme, applyVariants,
    applyAppearance, clearWallpaper,
    hexToRgb, shadeColor,
    STORAGE_KEY: KEY,
  };

  // Apply straight away with what we know now. A page that later learns the
  // instance's configured default can call applyTheme again.
  applyTheme(initialTheme(), false);
})();
