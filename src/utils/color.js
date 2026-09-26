// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tomás Neto
/**
 * The two bits of colour maths the accent needs, mirroring what public/app.js
 * does in the browser.
 *
 * Duplicated rather than shared because the pages that need it here have no
 * script of their own — a rendered markdown document is served under a CSP
 * that permits none — so the server has to work the shade out itself. Keep
 * these in step with shadeColor/hexToRgb in public/app.js; tests/color.test.js
 * checks the two agree on the values that matter.
 */

/** #rrggbb → [r, g, b]. Returns null for anything that is not one. */
function hexToRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex.trim())) return null;
  const n = parseInt(hex.trim().slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lighten (pct > 0, toward white) or darken (pct < 0, toward black). */
function shadeColor(hex, pct) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const target = pct < 0 ? 0 : 255;
  const amount = Math.abs(pct) / 100;
  const mix = c => Math.round((target - c) * amount + c);

  return '#' + rgb.map(c => mix(c).toString(16).padStart(2, '0')).join('');
}

module.exports = { hexToRgb, shadeColor };
