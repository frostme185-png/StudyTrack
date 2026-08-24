#!/usr/bin/env node
// Generates every level/badge SVG in this folder. Run: node assets/badges/generate.js
//
// Hand-authoring 31 icons guarantees drift; this keeps one shared silhouette,
// one palette table and one set of proportions, so a tweak applies everywhere.
//
// Sizing drives the whole design. The level icon renders at 15x15 in the
// widget (sticky.html) and 34x34 on the dashboard; badges at ~20px and 30px.
// At 15px nothing thin survives, so tier reads from SILHOUETTE + MATERIAL,
// and sub-rank from pip count — which degrades to "a smudge at the bottom"
// rather than becoming misleading. The exact rank is in the tooltip anyway.
//
// Colours are explicit rather than currentColor: these are meant to look like
// materials, and they sit on backgrounds ranging from #f5f5f5 to pure black
// (widget neon theme) to a saturated accent fill (widget solid theme). Every
// icon carries its own dark rim plus a light inner bevel so it separates from
// both extremes without knowing anything about the host.

const fs = require('fs')
const path = require('path')
const OUT = __dirname

const SHIELD = 'M32 3 L57 13 V33 C57 46 45 57 32 61 C19 57 7 46 7 33 V13 Z'

// [dark, mid, light, rim] — mid is the body, light the top bevel.
const TIERS = {
  iron:      { fill: ['#5b616b', '#868c96', '#b9bfc7'], rim: '#3a3f47', pip: '#e8ecf1', ink: '#2b2f35' },
  bronze:    { fill: ['#8a4f22', '#c07a3e', '#efb883'], rim: '#5d3315', pip: '#ffe3c4', ink: '#4a2810' },
  silver:    { fill: ['#98a1ac', '#c8d0d9', '#f2f6fa'], rim: '#6b737d', pip: '#ffffff', ink: '#4c545d' },
  gold:      { fill: ['#c2921c', '#eec44e', '#fff3c0'], rim: '#8a6510', pip: '#fffbe8', ink: '#6b4d09' },
  prismatic: { fill: ['#6d3fd4', '#a066f0', '#f0a6ff'], rim: '#3f2185', pip: '#ffffff', ink: '#2d1660' },
  holo:      { fill: ['#00c2b2', '#7a6bff', '#ff7ad9'], rim: '#1b1150', pip: '#ffffff', ink: '#140c3c' },
}

// One emblem per tier, so the six tiers are told apart instantly at any size.
// Every path is drawn inside a 24x24 box centred at (32, 27) by the caller.
const EMBLEM = {
  // sprout: two leaves off a stem
  sprout: c => `
    <path d="M12 21 V13" stroke="${c}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M12 14 C12 8 7 5 3 5 C3 11 7 14 12 14 Z" fill="${c}"/>
    <path d="M12 16 C12 10 17 7 21 7 C21 13 17 16 12 16 Z" fill="${c}"/>`,
  // book: open pages
  book: c => `
    <path d="M2 5 C6 3 10 3 12 5 V20 C10 18 6 18 2 20 Z" fill="${c}"/>
    <path d="M22 5 C18 3 14 3 12 5 V20 C14 18 18 18 22 20 Z" fill="${c}" opacity=".78"/>`,
  // flame — badge-only. The Diligent tier deliberately does NOT use this:
  // the streak badges do, and the level icon sits right beside the badge strip
  // in the widget, where two flames would read as the same idea twice.
  flame: c => `
    <path d="M12 1 C15 7 21 9 21 15 A9 9 0 0 1 3 15 C3 10 7 9 8 5 C10 8 11 9 12 8 C12 5 11 3 12 1 Z" fill="${c}"/>`,
  // gem: cut stone, for the Diligent tier
  gem: c => `
    <path d="M6 2 H18 L23 9 L12 23 L1 9 Z" fill="${c}"/>
    <path d="M6 2 L9 9 L12 23 L15 9 L18 2" fill="none" stroke="#fff" stroke-width="1.3" opacity=".45"/>
    <path d="M1 9 H23" stroke="#fff" stroke-width="1.3" opacity=".45"/>`,
  // star
  star: c => `
    <path d="M12 1 L15.2 8.6 L23.4 9.3 L17.2 14.7 L19.1 22.7 L12 18.4 L4.9 22.7 L6.8 14.7 L0.6 9.3 L8.8 8.6 Z" fill="${c}"/>`,
  // crown
  crown: c => `
    <path d="M2 19 L4 6 L9 12 L12 4 L15 12 L20 6 L22 19 Z" fill="${c}"/>
    <rect x="3.5" y="19.5" width="17" height="3.2" rx="1.2" fill="${c}"/>`,
  // radiant burst — capstone
  burst: c => `
    <path d="M12 0 L14.4 8.2 L22.6 5.6 L17.2 12 L22.6 18.4 L14.4 15.8 L12 24 L9.6 15.8 L1.4 18.4 L6.8 12 L1.4 5.6 L9.6 8.2 Z" fill="${c}"/>
    <circle cx="12" cy="12" r="3" fill="#fff" opacity=".9"/>`,
}

const LEVEL_TIERS = [
  { name: 'iron',      emblem: 'sprout', from: 1,  to: 4  },
  { name: 'bronze',    emblem: 'book',   from: 5,  to: 8  },
  { name: 'silver',    emblem: 'gem',    from: 9,  to: 12 },
  { name: 'gold',      emblem: 'star',   from: 13, to: 16 },
  { name: 'prismatic', emblem: 'crown',  from: 17, to: 20 },
  { name: 'holo',      emblem: 'burst',  from: 21, to: 21 },
]

function defs(id, t, extra = '') {
  return `<defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.fill[2]}"/>
      <stop offset=".45" stop-color="${t.fill[1]}"/>
      <stop offset="1" stop-color="${t.fill[0]}"/>
    </linearGradient>${extra}
  </defs>`
}

function levelSvg(lvl) {
  const tier = LEVEL_TIERS.find(t => lvl >= t.from && lvl <= t.to)
  const t = TIERS[tier.name]
  const sub = lvl - tier.from + 1          // 1..4 within the tier
  const capstone = tier.from === tier.to
  // Prismatic/holo get a second sweep so they don't read as flat purple/teal.
  const sheen = tier.name === 'prismatic' || tier.name === 'holo'
    ? `<linearGradient id="s${lvl}" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="#fff" stop-opacity=".55"/>
         <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
         <stop offset="1" stop-color="#fff" stop-opacity=".35"/>
       </linearGradient>` : ''

  const pips = capstone ? '' : Array.from({ length: sub }, (_, i) => {
    const span = (sub - 1) * 7
    const cx = 32 - span / 2 + i * 7
    return `<circle cx="${cx}" cy="49" r="2.4" fill="${t.pip}" stroke="${t.rim}" stroke-width=".7"/>`
  }).join('')

  // Capstone gets rays behind the shield — the one rank that should look
  // different in silhouette, not just in colour.
  const rays = capstone
    ? Array.from({ length: 12 }, (_, i) =>
        `<rect x="31.2" y="-1" width="1.6" height="9" rx=".8" fill="#8be9ff" opacity=".55" transform="rotate(${i * 30} 32 32)"/>`).join('')
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Level ${lvl}">
  ${defs(lvl, t, sheen)}
  ${rays}
  <path d="${SHIELD}" fill="url(#g${lvl})" stroke="${t.rim}" stroke-width="2.5" stroke-linejoin="round"/>
  ${sheen ? `<path d="${SHIELD}" fill="url(#s${lvl})"/>` : ''}
  <path d="M32 8 L52 16 V25 C44 20 20 20 12 25 V16 Z" fill="#fff" opacity=".18"/>
  <g transform="translate(20 15)">${EMBLEM[tier.emblem](t.ink)}</g>
  ${pips}
</svg>
`
}

// ── Badges ────────────────────────────────────────────────────
// Round base so they never read as a level shield. Tier within a family is
// carried by material AND pip count, not colour alone — at 20px in the widget
// strip the colours of adjacent tiers are easy to confuse.
function badgeSvg(id, { tier, glyph, pips = 0, label }) {
  const t = TIERS[tier]
  const pipRow = Array.from({ length: pips }, (_, i) => {
    const span = (pips - 1) * 8
    const cx = 32 - span / 2 + i * 8
    return `<circle cx="${cx}" cy="55" r="2.6" fill="${t.pip}" stroke="${t.rim}" stroke-width=".8"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="${label}">
  ${defs(id.replace(/[^a-z0-9]/gi, ''), t)}
  <circle cx="32" cy="30" r="25" fill="url(#g${id.replace(/[^a-z0-9]/gi, '')})" stroke="${t.rim}" stroke-width="2.5"/>
  <path d="M32 7 A25 25 0 0 1 55 26 A25 25 0 0 0 32 14 A25 25 0 0 0 9 26 A25 25 0 0 1 32 7 Z" fill="#fff" opacity=".22"/>
  <g transform="translate(20 18)">${glyph(t.ink)}</g>
  ${pipRow}
</svg>
`
}

const GLYPH = {
  clock: c => `
    <circle cx="12" cy="12" r="10.5" fill="none" stroke="${c}" stroke-width="2.6"/>
    <path d="M12 5.5 V12 L16.5 15" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  flame: EMBLEM.flame,
  flag: c => `
    <path d="M5 1 V23" stroke="${c}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M6.5 2.5 H20 L16.5 7.5 L20 12.5 H6.5 Z" fill="${c}"/>`,
  cluster: c => `
    <circle cx="8" cy="8" r="5.4" fill="${c}"/>
    <circle cx="17" cy="10" r="5.4" fill="${c}" opacity=".72"/>
    <circle cx="11.5" cy="17.5" r="5.4" fill="${c}" opacity=".86"/>`,
  calendarCheck: c => `
    <rect x="1.5" y="3.5" width="21" height="19" rx="3" fill="none" stroke="${c}" stroke-width="2.4"/>
    <path d="M1.5 9.5 H22.5" stroke="${c}" stroke-width="2.4"/>
    <path d="M7 1 V5 M17 1 V5" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M7.5 15.5 L11 19 L17 12.5" fill="none" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
}

const BADGES = {
  'hours-10':       { tier: 'bronze',    glyph: GLYPH.clock,         pips: 1, label: '10 Hours Studied' },
  'hours-50':       { tier: 'silver',    glyph: GLYPH.clock,         pips: 2, label: '50 Hours Studied' },
  'hours-100':      { tier: 'gold',      glyph: GLYPH.clock,         pips: 3, label: '100 Hours Studied' },
  'hours-500':      { tier: 'prismatic', glyph: GLYPH.clock,         pips: 4, label: '500 Hours Studied' },
  'streak-7':       { tier: 'bronze',    glyph: GLYPH.flame,         pips: 1, label: '7-Day Streak' },
  'streak-30':      { tier: 'silver',    glyph: GLYPH.flame,         pips: 2, label: '30-Day Streak' },
  'streak-100':     { tier: 'gold',      glyph: GLYPH.flame,         pips: 3, label: '100-Day Streak' },
  'first-session':  { tier: 'iron',      glyph: GLYPH.flag,          pips: 0, label: 'First Step' },
  'multi-site-day': { tier: 'bronze',    glyph: GLYPH.cluster,       pips: 0, label: 'Multitasker' },
  'perfect-week':   { tier: 'gold',      glyph: GLYPH.calendarCheck, pips: 0, label: 'Perfect Week' },
}

let n = 0
for (let lvl = 1; lvl <= 21; lvl++) {
  fs.writeFileSync(path.join(OUT, `level-${lvl}.svg`), levelSvg(lvl)); n++
}
for (const [id, spec] of Object.entries(BADGES)) {
  fs.writeFileSync(path.join(OUT, `${id}.svg`), badgeSvg(id, spec)); n++
}
console.log(`wrote ${n} icons to ${OUT}`)
