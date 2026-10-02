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

  window.LinkPageTheme = { initialTheme, applyTheme, applyVariants, STORAGE_KEY: KEY };

  // Apply straight away with what we know now. A page that later learns the
  // instance's configured default can call applyTheme again.
  applyTheme(initialTheme(), false);
})();
