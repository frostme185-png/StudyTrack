# CLAUDE.md

Context for Claude Code when working in this repo. This is a personal-use desktop app — prioritize data accuracy, customization, and self-serve insight over engagement/gamification mechanics (streak freezes, badges, social features) when proposing features.

## What this is

StudyTrack — Electron desktop app (Windows only) that auto-tracks time spent studying on websites and native apps (e.g. Claude desktop), with a dashboard, floating widget, manual timer, and optional cloud sync across devices.

No framework, no bundler, no TypeScript — plain HTML/CSS/JS in the renderer, plain Node in the main process.

## Architecture

- `src/main/main.js` — single file containing everything in the main process: data load/save, the 1s auto-track polling loop, native helper compilation, IPC handlers, tray, sticky widget lifecycle, daily reminder notifications, auto-updater.
- `src/main/preload.js` — contextBridge API exposed to renderers as `window.api`.
- `src/renderer/index.html` — main window: Dashboard / Websites / Debug / Settings / Account tabs, all in one file (inline `<style>` + `<script>`).
- `src/renderer/sticky.html` — floating widget (progress ring, mascot emoji, 4 themes).
- `src/renderer/firebase-config.js` — **gitignored**, contains real Firebase API key. Copy from `firebase-config.example.js` and fill in your own project to get login/sync working. Without it, everything except the Account tab works fine.

## Data model

`%APPDATA%\studytrack\data.json`:
```
{
  sites: [{ name, color, domain, kind?, process? }],
  sessions: [{ domain, seconds, manual, date, device }],
  settings: { goalHours, autoTrack, idlePause, notifications, reminderHour,
              streakColor, showSticky, widgetTheme, startOnBoot, deviceId, ... }
}
```

- **`domain`** is the universal tracking key for both websites and apps — an app entry stores `domain: "app:<process>"` so every existing piece of code keyed on `domain` (sessions, breakdown, sync merge) works for apps with zero extra plumbing. Real field for matching an app is `process` (exe name without `.exe`); `kind: 'app'` distinguishes it from a website entry.
- **`device`** = a per-install UUID (`settings.deviceId`). Used so cloud-sync merges never let one device's row get overwritten by another device's stale snapshot — see "Cloud sync" below.

## Tracking mechanics (the part most likely to break)

- `tick()` runs every 1s in main.js, calls `getActiveWindowInfo()` → `{ proc, title }` for the foreground window.
- Fast path: a tiny native helper (`WINHELPER_CS`, compiled with `csc.exe` on first run, cached in `%TEMP%`) — falls back to a PowerShell one-liner if no C# compiler is found.
- **Cache invalidation gotcha (already fixed once, watch for regressions):** the compiled helper is cached by content hash (`WINHELPER_HASH` in main.js) precisely because editing `WINHELPER_CS` without bumping anything used to silently keep using the stale cached `.exe` forever — this broke website auto-track for a while (title came back empty) while app-tracking partially worked by coincidence. If you touch `WINHELPER_CS` or `PS_SCRIPT`, the hash changes automatically and the cache self-invalidates — no manual step needed, but if tracking misbehaves after an edit, check `%TEMP%\studytrack_winhelper.*` first.
- `matchSite(info)` — website entries match by domain keyword in title; app entries match by exact process name (case-insensitive). Shared keyword logic lives in `matchesByTitle()`.
- Cross-process string passing uses `\x01` as a field separator (titles/URLs can contain `|`, so plain pipe-delimiting was unsafe). When editing the PowerShell scripts, the separator is written as `` $([char]1) `` — don't try to type a literal control character into a string edit; use `[char]1` in PowerShell or `'\x01'` in JS.

## Insights (Dashboard)

Self-serve analytics built from `sessions[]` already in memory — no extra tracking. Lives in `buildInsights()` in `index.html`, rendered into `#insightsBox`.

- **Trend vs last week** — anchored to the actual Monday-start calendar week (not a rolling 7-day window), comparing the same number of elapsed days on both sides so a partial current week isn't unfairly stacked against a full previous week.
- **Goal hit-rate** — % of days in a trailing window that hit `goalHours`; window caps at 30 days but shrinks to days-since-first-session so a new install isn't penalized for days before tracking started. Only shown once ≥3 days of history exist.
- **Best weekday** — average seconds per occurrence (not total), so a weekday with more calendar occurrences in the data doesn't win unfairly.
- **Top site this month** — % share of this month's total time.

`sessions[]` only stores one row per `domain`+`date`+`device` (merged, see `addOrMergeSession()` in main.js) — there's no intra-day timestamp, so time-of-day or session-length insights aren't possible without a data model change.

## Achievements (Level + Badges)

The one deliberate exception to the anti-gamification principle above — added on request, kept **non-punitive**: both are derived from cumulative, monotonically-increasing totals (all-time hours, current streak), so a level never drops and a badge, once earned, is never revoked. No streak-freezes, no loss mechanics.

Data + pure computation live in `src/renderer/achievements.js` — a plain `<script src>` include (no build step, so this is the only way to share code between `index.html` and `sticky.html` without duplicating it). Both pages load it before their own inline `<script>`.

- **Level** — 21 ranks by cumulative all-time study hours, defined in `LEVELS` (0h → 550h). 6 tiers (Mầm/Học Viên/Chuyên Cần/Tinh Anh/Huyền Thoại/Vĩnh Hằng); tiers 1-5 each split into 4 sub-ranks I-IV, tier 6 ("Vĩnh Hằng") is a single capstone rank with no sub-rank — mirrors Valorant's Radiant sitting alone above Immortal I-III. `computeLevel()`'s current/next lookup is index-generic so the tier/sub-rank split is just data, not special-cased in code.
- **Badges** — 10 one-time achievements defined in `BADGES`, each with a `kind` that `computeBadgeStates()` maps to a computed value: `hours` (total all-time hours: 10/50/100/500), `streak` (current streak: 7/30/100 days), `sessions` (any session ever — "Bước Đầu Tiên"), `multisite` (max distinct sites/apps studied in one day, peak-so-far — "Đa Nhiệm"), `perfectweek` (any Mon-Sun week, scanned via `hasPerfectWeek()`, where every day hit `goalHours` — "Tuần Hoàn Hảo"). All five kinds are monotonic (peaks/counts/any-ever), so every badge stays non-punitive once earned.
- **Icons**: user-provided SVG/PNG, not generated — see `assets/badges/README.md` for the `level-<n>.{svg,png}` / `<badge-id>.{svg,png}` naming convention. Missing icons fall back to a built-in emoji (`resolveAchievementIcon()` in achievements.js), so both the Dashboard grid and the widget work unchanged with zero assets present.
- **Dashboard** (`index.html`) — `buildLevel()`/`buildBadges()` render into `#levelCard`/`#badgeGrid`. Rebuilt at init and after cloud-sync merges only (same cadence as Insights/Streak/Bar chart) — not live-updated on every `stats-updated` tick.
- **Widget** (`sticky.html`) — the current Level icon is always visible in the site-row (`#levelIcon`); the 10-badge strip (`#badgeStrip`) is collapsed by default and toggled via the 🏅 header button (`toggleBadgeStrip()`), which also **resizes the widget's actual OS window** via `window.api.setStickyExpanded()` → main.js's `set-sticky-expanded` handler (`STICKY_H_COMPACT`/`STICKY_H_EXPANDED`, 258/334px) rather than permanently reserving that space — deliberate choice so the always-on widget footprint doesn't grow. The 258/334 in sticky.html's `toggleBadgeStrip()` must stay in sync with main.js's constants. Rebuilt at init and on `stats-updated` (re-fetches full `sessions[]` via `getData()`, same "don't trust a stale cached aggregate" approach as `syncWithCloud()`).

## Cloud sync

- Firebase Auth (email/password) + Firestore, loaded via CDN ES module imports directly in `index.html` (no npm package) — requires internet to load that script block; rest of the app works offline.
- Merge logic lives in two halves: renderer (`syncWithCloud()`) computes a dedup-union by `domain|date|manual|device`; main process (`apply-synced-data` handler) only ever *adopts* rows from **other** devices — it never lets a sync overwrite this device's own rows, because the renderer's snapshot can be stale by the time the Firestore round-trip finishes. Don't "simplify" this back to a blind overwrite — it was the cause of a visible time-jumping-backward bug.
- `syncWithCloud()` always re-fetches fresh data via `window.api.getData()` right before merging — don't let it merge from a cached renderer-side `appData` variable.

## Build / release

- `npm run build` → `electron-builder`, produces `dist/StudyTrack Setup x.x.x.exe`.
- **Requires Windows Developer Mode enabled** (Settings → Privacy & security → For developers) — without it, `electron-builder`'s winCodeSign extraction fails on symlink creation (non-admin accounts can't create symlinks otherwise).
- `assets/icon.ico` must exist (256×256) or the build fails outright.
- Auto-update: `electron-updater`, checks GitHub Releases (`build.publish` in package.json points at `frostme185-png/StudyTrack`). Only active when `app.isPackaged` — never fires under `npm start`. To ship an update: bump `version` in package.json, then `npm run release` (needs `GH_TOKEN` env var) or manually upload the `dist/` artifacts to a new GitHub Release.
- `requestedExecutionLevel: requireAdministrator` is intentional — reading other processes' window titles needs it.

## Known environment quirks (not code bugs)

- Multiple `electron.exe` entries in Task Manager for one running app instance is normal (Chromium multi-process: main + GPU + renderer, etc).
- If `start.bat` (which relaunches itself elevated) was used, leftover admin-elevated `electron.exe` processes can survive and can't be killed from a non-elevated shell — they can also race-write `data.json`. Kill via Task Manager or reboot if test data looks inconsistent.

## Conventions

- Comments explain *why*, not *what* — only added where the reasoning isn't obvious from the code itself (a past bug, a non-obvious constraint, a perf tradeoff). Don't add docstring-style comments.
- No build step for the renderer — keep it plain HTML/CSS/JS that runs unmodified in Chromium.
