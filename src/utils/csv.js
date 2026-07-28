/** CSV helpers. */

/** Wraps a value for safe inclusion in a CSV cell (RFC-4180 quoting). */
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { csvCell };
