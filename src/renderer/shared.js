// ── Shared renderer helpers ───────────────────────────────────────────
// Loaded by index.html and sticky.html before achievements.js and their own
// inline scripts. Everything here previously existed as a near-identical copy
// in two or three of those files.

// Local calendar date — must match main.js's todayStr() exactly. Using
// toISOString() instead would key on UTC, so around the day boundary "today"
// silently loses sessions logged just before it and gains them back later.
// index.html, sticky.html and achievements.js each carried their own copy.
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function todayStr() { return dateStr(new Date()) }
function monthStr(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }

// HH:MM:SS for the running clocks. Clamped at zero: the widget's total is
// savedSecs + live counters, and a flush landing between ticks can put it
// briefly below zero.
function fmtClock(s) {
  s = Math.max(0, s)
  return [Math.floor(s/3600), Math.floor(s%3600/60), s%60].map(v => String(v).padStart(2,'0')).join(':')
}

// Accent choices offered in Settings → Display. The dashboard paints --accent
// from this; the widget reads the same setting and needs the same table. They
// held separate identical copies, so adding a colour to one left the other
// silently falling back to green.
const ACCENT_COLORS = {
  green: '#1D9E75', blue: '#378ADD', pink: '#D4537E', purple: '#7F77DD',
  orange: '#C9710D', coral: '#B8331E', gray: '#6B6B6B',
}
