// ── Achievements (Level + Badges) — shared definitions ──────────────────
// Loaded via <script src="achievements.js"> by both index.html (Dashboard)
// and sticky.html (widget badge strip), so the two never drift out of sync.
// Both non-punitive by design: derived purely from cumulative, monotonically
// increasing totals (all-time hours, current streak) — a level never drops
// and a badge, once earned, is never revoked (no streak-freeze-style loss
// mechanics — see CLAUDE.md's engagement-mechanics principle).

// 6 tiers by cumulative all-time hours — tiers 1-5 each split into 4
// sub-ranks (I-IV), tier 6 ("Vĩnh Hằng") is a single capstone rank with no
// sub-rank, mirroring Valorant's Radiant sitting alone above Immortal I-III.
// Matches the badge art brief in assets/badges/README.md — level-<lvl>.svg
// icon filenames are just the sequential 1-21 lvl number.
const LEVELS = [
  { lvl: 1,  hours: 0,   title: 'Mầm I' },
  { lvl: 2,  hours: 3,   title: 'Mầm II' },
  { lvl: 3,  hours: 6,   title: 'Mầm III' },
  { lvl: 4,  hours: 10,  title: 'Mầm IV' },
  { lvl: 5,  hours: 15,  title: 'Học Viên I' },
  { lvl: 6,  hours: 22,  title: 'Học Viên II' },
  { lvl: 7,  hours: 30,  title: 'Học Viên III' },
  { lvl: 8,  hours: 40,  title: 'Học Viên IV' },
  { lvl: 9,  hours: 50,  title: 'Chuyên Cần I' },
  { lvl: 10, hours: 65,  title: 'Chuyên Cần II' },
  { lvl: 11, hours: 80,  title: 'Chuyên Cần III' },
  { lvl: 12, hours: 100, title: 'Chuyên Cần IV' },
  { lvl: 13, hours: 125, title: 'Tinh Anh I' },
  { lvl: 14, hours: 150, title: 'Tinh Anh II' },
  { lvl: 15, hours: 180, title: 'Tinh Anh III' },
  { lvl: 16, hours: 220, title: 'Tinh Anh IV' },
  { lvl: 17, hours: 260, title: 'Huyền Thoại I' },
  { lvl: 18, hours: 310, title: 'Huyền Thoại II' },
  { lvl: 19, hours: 370, title: 'Huyền Thoại III' },
  { lvl: 20, hours: 450, title: 'Huyền Thoại IV' },
  { lvl: 21, hours: 550, title: 'Vĩnh Hằng' },
]

const BADGES = [
  { id: 'hours-10',       kind: 'hours',       threshold: 10,  label: '10 giờ học' },
  { id: 'hours-50',       kind: 'hours',       threshold: 50,  label: '50 giờ học' },
  { id: 'hours-100',      kind: 'hours',       threshold: 100, label: '100 giờ học' },
  { id: 'hours-500',      kind: 'hours',       threshold: 500, label: '500 giờ học' },
  { id: 'streak-7',       kind: 'streak',      threshold: 7,   label: 'Streak 7 ngày' },
  { id: 'streak-30',      kind: 'streak',      threshold: 30,  label: 'Streak 30 ngày' },
  { id: 'streak-100',     kind: 'streak',      threshold: 100, label: 'Streak 100 ngày' },
  { id: 'first-session',  kind: 'sessions',    threshold: 1,   label: 'Bước Đầu Tiên' },
  { id: 'multi-site-day', kind: 'multisite',   threshold: 3,   label: 'Đa Nhiệm' },
  { id: 'perfect-week',   kind: 'perfectweek', threshold: 1,   label: 'Tuần Hoàn Hảo' },
]
const BADGE_FALLBACK_EMOJI = { hours: '🏅', streak: '🔥', sessions: '🚩', multisite: '🧩', perfectweek: '🗓️' }

// Custom icon per badge/level: assets/badges/<id>.svg (or .png) — falls back
// to the emoji above when no matching file exists, so callers never look
// broken before real art is dropped in. Existence checks are cached since
// both index.html and sticky.html re-resolve on every rebuild.
const ACHIEVEMENT_ICON_DIR = '../../assets/badges'
const achievementIconCache = new Map()   // src → Promise<boolean>
function checkAssetExists(src) {
  if (!achievementIconCache.has(src)) {
    achievementIconCache.set(src, new Promise(resolve => {
      const img = new Image()
      img.onload  = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = src
    }))
  }
  return achievementIconCache.get(src)
}
async function resolveAchievementIcon(id) {
  for (const ext of ['svg', 'png']) {
    const src = `${ACHIEVEMENT_ICON_DIR}/${id}.${ext}`
    if (await checkAssetExists(src)) return src
  }
  return null
}

// current/next lookup is index-generic (LEVELS[i].lvl === i+1), so the
// tier/sub-rank split above is just data — no special-casing needed here.
function computeLevel(totalHours) {
  let current = LEVELS[0], next = LEVELS[1] || null
  for (const l of LEVELS) if (totalHours >= l.hours) { current = l; next = LEVELS[l.lvl] || null }
  return { current, next }
}

// Local date formatter, kept private to this file (not the shared global
// `dateStr` each host page defines) so achievements.js has no load-order
// dependency on either host script.
function _fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Any Monday-start week (from the first tracked date through today) where
// every one of the 7 days hit goalSecs. Once true it stays true forever
// (we're scanning all of history), keeping the badge monotonic like the rest.
function hasPerfectWeek(secsByDate, goalSecs) {
  const dates = Object.keys(secsByDate).sort()
  if (!dates.length) return false
  const [fy, fm, fd] = dates[0].split('-').map(Number)
  const cursor = new Date(fy, fm - 1, fd)
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))   // back up to that week's Monday
  const today = new Date()
  while (cursor <= today) {
    let allHit = true
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor); d.setDate(cursor.getDate() + i)
      if ((secsByDate[_fmtDate(d)] || 0) < goalSecs) { allHit = false; break }
    }
    if (allHit) return true
    cursor.setDate(cursor.getDate() + 7)
  }
  return false
}

// Returns BADGES with an `earned` boolean attached, based on sessions/streak/
// goal data already in memory on the caller's side — no extra tracking.
function computeBadgeStates(sessions, streak, goalSecs) {
  const totalHours = sessions.reduce((a, s) => a + s.seconds, 0) / 3600

  const domainsByDate = {}, secsByDate = {}
  sessions.forEach(s => {
    secsByDate[s.date] = (secsByDate[s.date] || 0) + s.seconds
    if (!domainsByDate[s.date]) domainsByDate[s.date] = new Set()
    domainsByDate[s.date].add(s.domain)
  })
  const maxSitesInADay = Object.values(domainsByDate).reduce((m, set) => Math.max(m, set.size), 0)
  const perfectWeek = hasPerfectWeek(secsByDate, goalSecs) ? 1 : 0

  const VALUE_BY_KIND = {
    hours: totalHours,
    streak: streak,
    sessions: sessions.length,
    multisite: maxSitesInADay,
    perfectweek: perfectWeek,
  }

  return BADGES.map(b => ({ ...b, earned: VALUE_BY_KIND[b.kind] >= b.threshold }))
}
