# StudyTrack 📚

Desktop study habit tracker for Windows — auto-tracks time spent on chosen websites and apps (e.g. Claude, VS Code), streak calendar, manual timer, insights, floating widget, multi-device sync, and auto-update.

---

## Run (Development)

```
npm install
npm start
```

`npm install` only needed once (~2 min, downloads Electron).

Reading other processes' window titles needs administrator rights, so a plain `npm start` can show empty titles and track nothing. `start.bat` relaunches itself elevated and then runs `npm start` — use it if auto-track looks dead in development. (The installed build always runs elevated; see `requestedExecutionLevel` in `package.json`.)

### Cloud sync setup (optional, for login/multi-device sync)

The Account tab needs a Firebase project config that isn't checked into git (it carries a real API key).

```
cp src/renderer/firebase-config.example.js src/renderer/firebase-config.js
```

Then paste your Firebase project's config (Console → Project settings → Your apps → Web app) into that file. Without this file, everything except login/sync still works normally.

---

## Build .exe Installer

### Step 1 — Install build tool
```
npm install
```

### Step 2 — Icon
`assets/icon.ico` (256×256px) must exist before building — `electron-builder` fails without it.

### Step 3 — Build
```
npm run build
```

This runs `electron-builder` and produces:

```
dist/
  StudyTrack Setup x.x.x.exe   ← installer, share this
  win-unpacked/                 ← portable folder (no install needed)
```

### Step 4 — Install
Double-click `StudyTrack Setup x.x.x.exe` → installs to Program Files, adds desktop shortcut.

> Building on Windows requires Developer Mode enabled (Settings → Privacy & security → For developers) — `electron-builder` needs symlink permissions it doesn't otherwise have.

---

## Releasing an update

Installed copies auto-check GitHub Releases on launch and silently download newer versions (see Auto-Update below).

1. Bump `"version"` in `package.json`.
2. Publish to GitHub Releases:
   ```
   $env:GH_TOKEN = "<a GitHub personal access token with repo scope>"
   npm run release
   ```
   Or build with `npm run build` and manually upload `StudyTrack Setup x.x.x.exe`, `.exe.blockmap`, and `latest.yml` from `dist/` to a new GitHub Release tagged `vx.x.x`.

---

## Features

- **Auto-track** — websites (by domain keyword in window title) and native apps (by process name, e.g. `claude`, `anki`) you add to the tracked list.
- **Manual timer** — for study the app can't observe at all: a PDF, a paper textbook, a lecture. Type what you're working on and start; suggestions come from labels you've used before and your tracked items. Typing the name of something already tracked logs against that same item rather than creating a duplicate.
- **Dashboard** — streak calendar (6 months), last-7-days chart, focus heatmap (hour × weekday), time breakdown, and auto-generated insights: week-over-week trend, goal hit-rate, best weekday, peak focus window, month-over-month habit shift, and top item.
- **Level & Badges** — 21-rank level and 10 one-time badges derived from your existing hours/streak data, no extra tracking. Non-punitive: a level never drops and a badge never gets revoked. Ships with a full icon set in `assets/badges/`; drop in your own art to replace it.
- **Personalization** — separate streak and accent colours (7 each), Default/Glass dashboard theme, macOS or Windows window controls, and 6 widget themes (Minimal/Gradient/Glass/Neon/Solid/Mono).
- **Floating widget** — always-on-top progress ring showing today against your goal, the current auto-tracked item or a running manual timer, your level icon, and a collapsible badge strip.
- **Cloud sync** — optional email/password login, syncs sessions across devices via Firebase (per-device merge, safe against double-counting; removals propagate rather than reappearing).
- **Daily reminder** — desktop notification at a configurable hour if today's goal isn't met.
- **Auto-update** — checks GitHub Releases on launch, downloads silently, prompts to restart when ready.

---

## Auto-Track (Windows)

The app reads the foreground window every second via a tiny native helper (falls back to PowerShell if no C# compiler is available). A website entry matches by keyword-in-title (e.g. "coursera" matches a tab titled "Coursera | Learn X"); an app entry matches by exact process name. Sessions flush to disk every 30 seconds and on switch/idle.

Idle detection: auto-tracking pauses after 5+ minutes without keyboard/mouse input.

The **manual timer deliberately does not** — an hour without input is what reading a book looks like, and the app can't tell that apart from you having walked away. It keeps counting, shows the idle portion live on the widget, and offers to trim it when you stop. If it's still running after 2 hours it sends a reminder, and it's banked rather than lost if you quit or the app crashes.

---

## Data Location

All data stored locally at:
```
C:\Users\<you>\AppData\Roaming\studytrack\data.json
```

---

## Project Structure

```
StudyTrack/
├── src/
│   ├── main/
│   │   ├── main.js                    ← Electron main process: tracking, IPC, auto-update, notifications
│   │   └── preload.js                 ← Secure bridge main ↔ renderer
│   └── renderer/
│       ├── index.html                 ← Main window UI (Dashboard, Tracking, Settings, Account — Debug lives inside Settings)
│       ├── sticky.html                ← Floating widget
│       ├── shared.js                  ← Date/clock helpers + accent palette, loaded by both renderers
│       ├── achievements.js            ← Level/Badges data + logic, loaded by both renderers
│       ├── firebase-config.example.js ← Template — copy to firebase-config.js with your own project
│       └── firebase-config.js         ← Your real config (gitignored, not in repo)
├── assets/
│   ├── icon.ico                       ← App icon (must exist before building)
│   └── badges/                        ← Level/Badge icons + generate.js that produces them
└── package.json
```
