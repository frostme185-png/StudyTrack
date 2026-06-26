# StudyTrack 📚

Desktop study habit tracker — streak calendar, auto-tracking, manual timer, dashboard stats.

---

## Run (Development)

```
cd studytrack
npm install
npm start
```

`npm install` only needed once (~2 min, downloads Electron).

---

## Build .exe Installer

### Step 1 — Install build tool
```
npm install
```

### Step 2 — Add an icon (required for build)
Place a `icon.ico` file (256x256 px) inside the `assets/` folder.
Free tool to convert PNG→ICO: https://convertio.co/png-ico/

### Step 3 — Build
```
npm run build
```

This runs `electron-builder` and produces:

```
dist/
  StudyTrack Setup 1.0.0.exe   ← installer, share this
  win-unpacked/                 ← portable folder (no install needed)
```

### Step 4 — Install
Double-click `StudyTrack Setup 1.0.0.exe` → installs to Program Files, adds desktop shortcut.

---

## Auto-Track (Windows)

The app polls the active foreground window title every 2 seconds via PowerShell.
If the window title contains a tracked domain keyword (e.g. "coursera"), it counts as study time.
Sessions are saved automatically every 30 seconds and when you switch sites.

Idle detection: if your machine is idle for 5+ minutes, tracking pauses automatically.

---

## Data Location

All data stored locally at:
```
C:\Users\<you>\AppData\Roaming\studytrack\data.json
```

---

## Project Structure

```
studytrack/
├── src/
│   ├── main/
│   │   ├── main.js        ← Electron main process, tracking, IPC
│   │   └── preload.js     ← Secure bridge main ↔ renderer
│   └── renderer/
│       ├── index.html     ← Main window UI
│       └── sticky.html    ← Floating widget
├── assets/
│   └── icon.ico           ← App icon (add before building)
└── package.json
```
