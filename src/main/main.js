const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, powerMonitor, screen, Notification, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')
const crypto = require('crypto')
const { exec, execFile } = require('child_process')
const { autoUpdater } = require('electron-updater')

const DATA_PATH = path.join(app.getPath('userData'), 'data.json')

// ── Data ──────────────────────────────────────────────────────
function loadData() {
  try { if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) } catch {}
  return {
    sites: [
      { name: 'Coursera',     domain: 'coursera.com',    color: '#378ADD' },
      { name: 'Khan Academy', domain: 'khanacademy.org', color: '#D4537E' },
      { name: 'YouTube Edu',  domain: 'youtube.com',     color: '#EF9F27' },
      { name: 'Duolingo',     domain: 'duolingo.com',    color: '#7F77DD' },
    ],
    sessions: [],
    deletedSites: [],
    deletedSessions: [],
    settings: {
      goalHours: 3, autoTrack: true, idlePause: true,
      notifications: true, startOnBoot: false,
      streakColor: 'green', accentColor: 'green', dashTheme: 'default', showSticky: true,
    }
  }
}
// Write to a temp file then rename — rename is atomic on the same volume, so a
// crash/power-loss mid-write can't leave data.json half-written/corrupted.
function saveData(d) {
  try {
    const tmp = DATA_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2))
    fs.renameSync(tmp, DATA_PATH)
  } catch {}
}
let appData = loadData()
if (!Array.isArray(appData.deletedSites)) appData.deletedSites = []
if (!Array.isArray(appData.deletedSessions)) appData.deletedSessions = []

// Stable per-install id so cloud-synced sessions can be tagged by the device
// that recorded them. Without this, merging two devices' sessions by
// domain/date/kind alone would let addOrMergeSession on device A silently
// absorb seconds that device B already recorded, double-counting on next sync.
if (!appData.settings.deviceId) {
  appData.settings.deviceId = crypto.randomUUID()
  saveData(appData)
}
const DEVICE_ID = appData.settings.deviceId

// Strips protocol/www/path so users can paste a full URL and still get a
// clean matchable domain (e.g. "https://www.coursera.org/learn/x" → "coursera.org").
function normalizeDomain(input) {
  let v = String(input || '').trim()
  if (!v) return v
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v
  try { return new URL(v).hostname.replace(/^www\./i, '').toLowerCase() }
  catch { return String(input).trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase() }
}

// Adds seconds to an existing same-domain/same-day/same-kind (auto vs manual)
// session instead of appending a new row every flush — keeps data.json from
// growing one entry per 30s tick and makes "Website Breakdown" sums accurate
// without needing to group at read time.
// Mirrors sessionKey() in index.html's sync code — identifies a session row
// for tombstoning, same shape used to key the merge-dedup map.
function sessionKey(s) { return `${s.domain}|${s.date}|${!!s.manual}|${s.device || 'legacy'}` }

// hours ({hourOfDay: seconds}) rides along the same row — it must be recorded
// at capture time because a day-level total can't be split back into hours later.
function addOrMergeSession(domain, seconds, manual, hours) {
  const date = todayStr()
  let row = appData.sessions.find(s => s.domain === domain && s.date === date && !!s.manual === !!manual && s.device === DEVICE_ID)
  if (!row) { row = { domain, seconds: 0, manual, date, device: DEVICE_ID }; appData.sessions.push(row) }
  row.seconds += seconds
  if (hours) {
    row.hours = row.hours || {}
    for (const h in hours) row.hours[h] = (row.hours[h] || 0) + hours[h]
  }
}

// The manual timer runs continuously right up to the moment it's stopped, so
// its hour buckets can be recovered by walking the duration backwards from
// "now" across each hour boundary it crossed — no per-tick state needed.
function hoursSpread(seconds) {
  const hours = {}
  const end = Date.now()
  let t = end - seconds * 1000
  while (t < end) {
    const d = new Date(t)
    const next = new Date(t); next.setMinutes(60, 0, 0)
    const chunkEnd = Math.min(next.getTime(), end)
    const secs = Math.round((chunkEnd - t) / 1000)
    if (secs > 0) hours[d.getHours()] = (hours[d.getHours()] || 0) + secs
    t = chunkEnd
  }
  return hours
}

// ── Windows ───────────────────────────────────────────────────
let mainWin = null, stickyWin = null, tray = null

function send(win, channel, data) {
  try { if (win && !win.isDestroyed()) win.webContents.send(channel, data) } catch {}
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 860, height: 620, minWidth: 720, minHeight: 520,
    frame: false, backgroundColor: '#1c1c1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  mainWin.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWin.on('closed', () => { mainWin = null })
}

// Widget stays this compact by default; only grows when the badge strip is
// toggled open (see 'set-sticky-expanded' below) — not a permanent resize.
const STICKY_W = 200, STICKY_H_COMPACT = 258, STICKY_H_EXPANDED = 258 + 122

function createStickyWindow() {
  const x = appData.settings.stickyX ?? 40
  const y = appData.settings.stickyY ?? 40
  stickyWin = new BrowserWindow({
    width: STICKY_W, height: STICKY_H_COMPACT, x, y,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  })
  stickyWin.loadFile(path.join(__dirname, '../renderer/sticky.html'))
  stickyWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  stickyWin.on('closed', () => { stickyWin = null; rebuildTrayMenu() })
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.ico'))
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('StudyTrack')
  rebuildTrayMenu()
  tray.on('click', () => { if (mainWin) mainWin.show(); else createMainWindow() })
}
function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open StudyTrack', click: () => { if (mainWin) mainWin.show(); else createMainWindow() } },
    { label: stickyWin ? 'Hide widget' : 'Show widget', click: () => setStickyEnabled(!stickyWin) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]))
}

// Single source of truth for the floating widget: the Settings toggle, the
// titlebar pin button, the widget's own ✕, and the tray menu item all call
// this — so toggling it from any one of them keeps the rest in sync (they
// used to be two disconnected states: a persisted setting and a runtime-only
// show/hide, which could disagree about whether the widget was "on").
function setStickyEnabled(enabled) {
  appData.settings.showSticky = enabled
  saveData(appData)
  if (enabled) { if (!stickyWin) createStickyWindow(); else stickyWin.show() }
  else if (stickyWin) { stickyWin.destroy(); stickyWin = null }
  rebuildTrayMenu()
  send(mainWin, 'settings-updated', appData.settings)
}

// ── Native window-info helper ──────────────────────────────────
// Spawning `powershell -Command "Add-Type ..."` every tick was costing
// 1000-1200ms PER CALL (Roslyn/csc compiling the inline C# fresh each time),
// which is *slower than the 1s poll interval itself* — that's what caused
// the visible jitter/resets. Fix: compile a tiny native helper .exe ONCE
// (cached in temp, reused across app launches) and just run that directly
// each tick — no PowerShell, no compile, typically <30ms.
// Only handles "title" (the 1s auto-track hot path). Listing every open tab
// needs UI Automation (System.Windows.Automation), which isn't worth wiring
// into this native exe since the tab list only refreshes every 5s anyway —
// see PS_SCRIPT_LIST below, which handles that via PowerShell instead.
const WINHELPER_CS = `
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;

class WinHelper {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

  static void Main(string[] args) {
    IntPtr h = GetForegroundWindow();
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    uint pid = 0;
    GetWindowThreadProcessId(h, out pid);
    string proc = "";
    try { proc = Process.GetProcessById((int)pid).ProcessName; } catch {}
    Console.WriteLine(proc + "" + sb.ToString());
  }
}
`.trim()

const BROWSER_PROCS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'iexplore']

let winHelperExe   = null      // path once compiled/found, else null (fallback to PowerShell)
let trackingMethod = 'powershell'   // 'native' | 'powershell' — surfaced in the Debug tab

function setTrackingMethod(m) {
  trackingMethod = m
  send(mainWin, 'tracking-method', m)
}

function findCsc() {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ]
  return candidates.find(p => fs.existsSync(p)) || null
}

// Compiles the helper once in the background; until it's ready (or if it can't
// be compiled), getActiveWindowTitle/getOpenBrowserTitles fall back to PowerShell.
// A "failed" marker is cached so a machine without csc.exe doesn't retry (and
// wait out the same failure) on every single app launch.
// Hash of the current WINHELPER_CS source, stored alongside the compiled
// .exe — lets us tell a stale cached binary (compiled from an older version
// of this source, e.g. before it learned to also emit the process name)
// apart from an up-to-date one. Without this, editing WINHELPER_CS here
// would silently keep using the old cached .exe forever, since the original
// cache check only asked "does a file exist at this path", not "does it
// match what we'd compile today" — that's what broke website auto-track
// after the app-tracking feature added a proc/title separator to the output.
const WINHELPER_HASH = crypto.createHash('md5').update(WINHELPER_CS).digest('hex')

function compileWinHelperAsync() {
  if (process.platform !== 'win32') return
  const dir       = app.getPath('temp')
  const csPath    = path.join(dir, 'studytrack_winhelper.cs')
  const exePath   = path.join(dir, 'studytrack_winhelper.exe')
  const hashPath  = path.join(dir, 'studytrack_winhelper.hash')
  const failFlag  = path.join(dir, 'studytrack_winhelper.failed')
  const cacheIsCurrent = fs.existsSync(exePath) && fs.existsSync(hashPath) &&
    fs.readFileSync(hashPath, 'utf8') === WINHELPER_HASH
  if (cacheIsCurrent) { winHelperExe = exePath; setTrackingMethod('native'); return }
  if (fs.existsSync(failFlag)) { setTrackingMethod('powershell'); return }
  try {
    fs.writeFileSync(csPath, WINHELPER_CS, 'utf8')
    const csc = findCsc()
    if (!csc) { try { fs.writeFileSync(failFlag, 'csc.exe not found') } catch {}; setTrackingMethod('powershell'); return }
    exec(`"${csc}" /nologo /target:exe /out:"${exePath}" "${csPath}"`, { windowsHide: true, timeout: 15000 }, (err) => {
      if (!err && fs.existsSync(exePath)) {
        try { fs.writeFileSync(hashPath, WINHELPER_HASH) } catch {}
        winHelperExe = exePath; setTrackingMethod('native')
      } else { try { fs.writeFileSync(failFlag, String(err)) } catch {}; setTrackingMethod('powershell') }
    })
  } catch { setTrackingMethod('powershell') }
}

// ── PowerShell fallback (only used if the native helper isn't available) ──
const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ForeWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$h = [ForeWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[ForeWin]::GetWindowText($h, $sb, 512) | Out-Null
$procId = 0
[ForeWin]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
$proc = ''
try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
"$proc$([char]1)$($sb.ToString())"
`.trim()

let psTempFile = null
function getPsFile() {
  if (psTempFile && fs.existsSync(psTempFile)) return psTempFile
  psTempFile = path.join(app.getPath('temp'), 'studytrack_win.ps1')
  fs.writeFileSync(psTempFile, PS_SCRIPT, 'utf8')
  return psTempFile
}

// Returns { proc, title } for the foreground window — proc is the raw exe
// process name (no ".exe"), used to match native-app tracked items by
// identity instead of by window title text (titles change, exe names don't).
function parseProcTitle(raw) {
  const [proc, ...rest] = raw.split('\x01')
  return { proc: (proc || '').trim(), title: rest.join('\x01').trim() }
}

function getActiveWindowInfo(callback) {
  if (process.platform !== 'win32') return callback({ proc: '', title: 'StudyTrack (non-Windows demo)' })
  if (winHelperExe) {
    return execFile(winHelperExe, ['title'], { timeout: 800, windowsHide: true }, (err, stdout) => callback(err ? { proc: '', title: '' } : parseProcTitle(stdout.toString())))
  }
  exec(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${getPsFile()}"`,
    { timeout: 1200, windowsHide: true },
    (err, stdout) => callback(err ? { proc: '', title: '' } : parseProcTitle(stdout.toString()))
  )
}

// Lists every TAB (not just the one shown in the window's title bar) across
// all open browser windows, via UI Automation's TabItem elements — this is
// the same accessibility tree Narrator/tab-switcher tools read. Only used
// for the manual-timer dropdown (refreshed every 5s), so the extra latency
// of walking the UI tree is fine — this never runs on the 1s auto-track hot path.
// Also reads each window's address bar (an Edit control UI Automation can
// reach the same way), so the dropdown can carry a real URL instead of just
// the tab's display title — UI Automation only exposes the URL for the
// SELECTED tab of a window though, so background tabs still come through
// title-only (joined with  instead of '|' since titles/URLs may contain '|').
const PS_SCRIPT_LIST = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$SEP = [char]1
$browserProcs = @('chrome','msedge','firefox','brave','opera','iexplore')
$results = New-Object System.Collections.Generic.List[string]
$cb = {
  param($hWnd, $lParam)
  if ([WinEnum]::IsWindowVisible($hWnd)) {
    $procId = 0
    [WinEnum]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
    $proc = ''
    try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
    if ($browserProcs -contains $proc.ToLower()) {
      $activeUrl = ''
      try {
        $el = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        $editCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
        $edits = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCond)
        foreach ($edit in $edits) {
          $aid = $edit.Current.AutomationId
          $nm  = $edit.Current.Name
          if ($aid -match 'urlbar|omnibox|address' -or $nm -match 'address|search') {
            try {
              $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
              $activeUrl = $vp.Current.Value
            } catch { $activeUrl = $nm }
            if ($activeUrl) { break }
          }
        }
      } catch {}
      $foundTab = $false
      try {
        $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
        $tabs = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
        foreach ($tab in $tabs) {
          $name = $tab.Current.Name
          if ($name -and $name.Trim().Length -gt 0) {
            $isSelected = $false
            try {
              $sp = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
              $isSelected = $sp.Current.IsSelected
            } catch {}
            $url = if ($isSelected) { $activeUrl } else { '' }
            $results.Add("$proc$SEP$name$SEP$url")
            $foundTab = $true
          }
        }
      } catch {}
      if (-not $foundTab) {
        $sb = New-Object System.Text.StringBuilder 512
        [WinEnum]::GetWindowText($hWnd, $sb, 512) | Out-Null
        $title = $sb.ToString().Trim()
        if ($title.Length -gt 0) { $results.Add("$proc$SEP$title$SEP$activeUrl") }
      }
    }
  }
  return $true
}
[WinEnum]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$results -join "\`n"
`.trim()

let psListTempFile = null
function getPsListFile() {
  if (psListTempFile && fs.existsSync(psListTempFile)) return psListTempFile
  psListTempFile = path.join(app.getPath('temp'), 'studytrack_winlist.ps1')
  fs.writeFileSync(psListTempFile, PS_SCRIPT_LIST, 'utf8')
  return psListTempFile
}

function parseWinList(raw) {
  const seen = new Set()
  const tabs = []
  raw.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const [proc, title, url] = line.split('')
    if (!proc || !BROWSER_PROCS.includes(proc.toLowerCase()) || !title) return
    const key = title + '' + (url || '')
    if (seen.has(key)) return
    seen.add(key)
    tabs.push({ title: title.trim(), url: (url || '').trim() })
  })
  return tabs
}

function getOpenBrowserTitles(callback) {
  if (process.platform !== 'win32') return callback([])
  exec(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${getPsListFile()}"`,
    { timeout: 4000, windowsHide: true },
    (err, stdout) => callback(err ? [] : parseWinList(stdout.toString()))
  )
}

// Lists currently running apps that have a visible top-level window — lets
// the "Add app to track" picker show real running apps (e.g. Claude desktop)
// instead of making the user type an exe name from Task Manager.
const PS_SCRIPT_APPS = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinEnum2 {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$SEP = [char]1
$excludeProcs = @('electron','studytrack','explorer','shellexperiencehost','searchhost','startmenuexperiencehost','textinputhost','applicationframehost','systemsettings')
$results = New-Object System.Collections.Generic.List[string]
$cb = {
  param($hWnd, $lParam)
  if ([WinEnum2]::IsWindowVisible($hWnd) -and [WinEnum2]::GetWindowTextLength($hWnd) -gt 0) {
    $procId = 0
    [WinEnum2]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
    $proc = ''
    try { $proc = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
    if ($proc -and ($excludeProcs -notcontains $proc.ToLower())) {
      $sb = New-Object System.Text.StringBuilder 512
      [WinEnum2]::GetWindowText($hWnd, $sb, 512) | Out-Null
      $title = $sb.ToString().Trim()
      if ($title.Length -gt 0) { $results.Add("$proc$SEP$title") }
    }
  }
  return $true
}
[WinEnum2]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$results -join "\`n"
`.trim()

let psAppsTempFile = null
function getPsAppsFile() {
  if (psAppsTempFile && fs.existsSync(psAppsTempFile)) return psAppsTempFile
  psAppsTempFile = path.join(app.getPath('temp'), 'studytrack_apps.ps1')
  fs.writeFileSync(psAppsTempFile, PS_SCRIPT_APPS, 'utf8')
  return psAppsTempFile
}

function parseAppList(raw) {
  const byProc = new Map()
  raw.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const [proc, title] = line.split('\x01')
    if (!proc || !title) return
    const existing = byProc.get(proc)
    if (!existing || title.trim().length > existing.length) byProc.set(proc, title.trim())
  })
  return [...byProc.entries()].map(([proc, title]) => ({ proc, title }))
}

function getRunningApps(callback) {
  if (process.platform !== 'win32') return callback([])
  exec(
    `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${getPsAppsFile()}"`,
    { timeout: 4000, windowsHide: true },
    (err, stdout) => callback(err ? [] : parseAppList(stdout.toString()))
  )
}

// ── Tracking state (all in main process) ─────────────────────
let autoCurrentDomain = null   // domain being tracked right now
let autoAccumSecs     = 0      // seconds for current session (not yet flushed)
let todayLiveExtra    = 0      // live seconds not yet in sessions[] (auto)
let liveHours         = {}     // hourOfDay → unflushed seconds; mirrors todayLiveExtra, reset together
let lastFlushTime     = Date.now()
let trackInterval     = null

const FLUSH_MS = 30_000   // save to disk every 30s

function startTracking() {
  if (trackInterval) return
  compileWinHelperAsync()   // build the fast native helper in the background
  // Poll every 1 second for responsive UI
  trackInterval = setInterval(tick, 1000)
}

let tickBusy = false

function tick() {
  if (tickBusy) return   // previous PowerShell call hasn't returned yet — skip this beat
  // ── idle check ──
  const idleSecs = powerMonitor.getSystemIdleTime()
  const isIdle   = appData.settings.idlePause && idleSecs > 300

  if (isIdle) {
    if (autoCurrentDomain) flushAutoSession('idle')
    awayTicks = 0
    send(mainWin,   'idle-state', true)
    send(stickyWin, 'idle-state', true)
    return
  }

  tickBusy = true
  getActiveWindowInfo(info => {
    tickBusy = false
    onTitleResolved(info)
  })
}

// Website-kind entries match by keyword-in-title; shared by matchSite (the
// 1s auto-track hot path) and matchSiteByTitle (the manual-timer tab list).
function matchesByTitle(site, titleLo) {
  const kw = site.domain.replace(/^www\./, '').split('.')[0].toLowerCase()
  return titleLo.includes(kw) || titleLo.includes(site.domain.toLowerCase())
}

// Matches the foreground window against tracked items. Website-kind entries
// match by keyword-in-title; app-kind entries match by exe process name
// instead, since a native app's title text varies per document/view (e.g.
// Claude's window title changes per conversation) but its process name doesn't.
function matchSite(info) {
  const sites   = appData.sites || []
  const titleLo = (info.title || '').toLowerCase()
  const procLo  = (info.proc  || '').toLowerCase()
  return sites.find(s => {
    if (s.kind === 'app') return s.process && procLo === s.process.toLowerCase()
    return matchesByTitle(s, titleLo)
  })
}

// Title-only variant for the manual-timer's open-tabs list, which only ever
// deals with browser tabs (no process info available per-tab) — only checks
// website-kind entries since app-kind ones can't be matched from a tab title.
function matchSiteByTitle(title) {
  const sites   = (appData.sites || []).filter(s => s.kind !== 'app')
  const titleLo = (title || '').toLowerCase()
  return sites.find(s => matchesByTitle(s, titleLo))
}

// Tolerates brief "not matched" reads (PowerShell polling lag, momentary alt-tab,
// title not yet updated) for a few seconds before actually ending the session —
// otherwise a single flaky tick reset the whole session timer back to 0.
let awayTicks       = 0
let lastMatchedName = null
const GRACE_TICKS = 3   // seconds of "no match" tolerated before treating the site as left

function onTitleResolved(info) {
  const title = info.title
  send(mainWin, 'active-window', title)   // debug panel

  if (!appData.settings.autoTrack) {
    send(mainWin,   'idle-state', false)
    return
  }

  // ── match against tracked sites/apps ──
  const matched = matchSite(info)

  if (matched) {
    awayTicks        = 0
    lastMatchedName  = matched.name
  } else if (autoCurrentDomain) {
    awayTicks++
  }

  // Still within grace period? keep counting the previous site instead of resetting.
  const effective = matched || (autoCurrentDomain && awayTicks < GRACE_TICKS
    ? { domain: autoCurrentDomain, name: lastMatchedName }
    : null)

  if (effective) {
    // switched site mid-session → flush old, start new
    if (autoCurrentDomain && autoCurrentDomain !== effective.domain) {
      flushAutoSession('switch', true)
    }
    autoCurrentDomain = effective.domain
    autoAccumSecs    += 1   // total seconds of this continuous session — only reset on switch/leave/idle
    todayLiveExtra   += 1   // seconds not yet written to disk — reset on every flush (periodic or full stop)
    const hr = new Date().getHours()
    liveHours[hr] = (liveHours[hr] || 0) + 1

    const todaySecs = todaySeconds() + todayLiveExtra

    const payload = {
      domain:        effective.domain,
      siteName:      effective.name,
      accumSecs:     autoAccumSecs,   // current session seconds (keeps counting across periodic flushes) — for the dashboard's session clock
      liveUnflushed: todayLiveExtra,  // seconds NOT yet on disk — this is what the widget should add on top of its saved total
      todaySecs,                      // total today (saved + live)
      title,
      isIdle:        false,
    }
    send(mainWin,   'auto-track-update', payload)
    send(stickyWin, 'auto-track-update', payload)  // ← sticky gets every tick

    // periodic flush: write progress to disk WITHOUT resetting the session timer
    if (Date.now() - lastFlushTime >= FLUSH_MS) flushAutoSession('periodic', false)

  } else {
    // genuinely not on a study site (grace period exhausted)
    if (autoCurrentDomain) flushAutoSession('left', true)
    awayTicks = 0
    send(mainWin,   'auto-track-update', { domain: null, title, isIdle: false })
    send(stickyWin, 'auto-track-update', { domain: null, title, isIdle: false })
  }

  send(mainWin,   'idle-state', false)
}

// stop=true fully ends the session (switch/leave/idle/quit) and resets the session timer.
// stop=false is a periodic checkpoint write — keeps autoCurrentDomain/autoAccumSecs running.
function flushAutoSession(reason, stop = true) {
  if (autoCurrentDomain && todayLiveExtra >= 2) {
    addOrMergeSession(autoCurrentDomain, todayLiveExtra, false, liveHours)
    saveData(appData)
    lastFlushTime  = Date.now()
    todayLiveExtra = 0   // now counted in sessions[]
    liveHours      = {}
  }
  if (stop) {
    autoCurrentDomain = null
    autoAccumSecs     = 0
  }

  const payload = { todaySeconds: todaySeconds(), streak: streakDays() }
  send(mainWin,   'stats-updated', payload)
  send(stickyWin, 'stats-updated', payload)
}

// ── Helpers ───────────────────────────────────────────────────
// Local calendar date, NOT toISOString() (which is UTC and rolls over at
// local midnight minus the timezone offset — e.g. 7-8am for UTC+7/+8 —
// causing today's total to suddenly drop sessions logged just before that
// moment, then "catch up" as new ones land under the now-current date key).
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function todaySeconds() {
  const t = todayStr()
  return appData.sessions.filter(s => s.date === t).reduce((a, s) => a + s.seconds, 0)
}
function streakDays() {
  const dates = [...new Set(appData.sessions.map(s => s.date))].sort()
  if (!dates.length) return 0
  let streak = 0, cur = new Date(todayStr())
  for (let i = dates.length - 1; i >= 0; i--) {
    if (Math.round((cur - new Date(dates[i])) / 86400000) > 1) break
    streak++; cur = new Date(dates[i])
  }
  return streak
}

// ── Auto-update ───────────────────────────────────────────────
// Checks GitHub Releases (configured under "build.publish" in package.json)
// for a newer published version, downloads it silently in the background,
// then asks the user to restart — never interrupts an active session by
// restarting on its own. No-op when running unpackaged (npm start), since
// electron-updater requires a real installed/signed app to apply updates to.
function initAutoUpdater() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'StudyTrack',
      message: 'A new update is available',
      detail: 'The update has finished downloading. Restart StudyTrack to install it?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall()
    })
  })

  autoUpdater.checkForUpdates().catch(() => {})   // silent — no internet / no releases yet is fine
}

// ── Daily reminder ────────────────────────────────────────────
// Tracked separately from data.json (not persisted) — a missed/duplicate
// reminder across a restart is harmless, so it's not worth the disk write.
let lastReminderDate = null

function checkDailyReminder() {
  if (!appData.settings.notifications) return
  const reminderHour = appData.settings.reminderHour ?? 20
  if (new Date().getHours() < reminderHour) return   // not at the user's reminder hour yet
  const today = todayStr()
  if (lastReminderDate === today) return   // already reminded today
  const totalSecs = todaySeconds() + todayLiveExtra
  const goalSecs   = (appData.settings.goalHours || 3) * 3600
  if (totalSecs >= goalSecs) return        // goal already met
  lastReminderDate = today
  if (!Notification.isSupported()) return
  const remainingMin = Math.max(1, Math.round((goalSecs - totalSecs) / 60))
  const n = new Notification({
    title: 'StudyTrack — goal not reached today',
    body: `About ${remainingMin} more minutes to reach today's ${appData.settings.goalHours || 3}h goal.`,
  })
  n.on('click', () => { if (mainWin) { mainWin.show(); mainWin.focus() } else createMainWindow() })
  n.show()
}

// ── IPC ───────────────────────────────────────────────────────
ipcMain.handle('get-data', () => ({
  ...appData,
  deletedSites: appData.deletedSites || [],
  deletedSessions: appData.deletedSessions || [],
  todaySeconds: todaySeconds() + todayLiveExtra,
  streak: streakDays(),
  trackingMethod
}))

ipcMain.handle('save-settings', (_, s) => {
  const stickyWasEnabled = appData.settings.showSticky
  appData.settings = s; saveData(appData); rebuildTrayMenu()
  if (!!s.showSticky !== !!stickyWasEnabled) setStickyEnabled(!!s.showSticky)
  send(stickyWin, 'settings-updated', s)
  // Unpackaged (npm start / electron .), process.execPath is the generic
  // electron.exe — without passing this app's path as an arg, Windows would
  // launch a blank Electron shell on login instead of StudyTrack. Packaged
  // builds don't need this since execPath already points at StudyTrack.exe.
  app.setLoginItemSettings({
    openAtLogin: !!s.startOnBoot,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  })
  if (!s.autoTrack) flushAutoSession('settings-off')
  return true
})

// Open browser tabs/windows not already covered by an auto-tracked site —
// candidates for the manual timer's dropdown.
ipcMain.handle('get-open-tabs', () => new Promise(resolve => {
  getOpenBrowserTitles(tabs => resolve(
    tabs.filter(t => !matchSiteByTitle(t.title) && !(t.url && matchSiteByTitle(t.url)))
        .map(t => ({ title: t.title, url: t.url, domain: t.url ? normalizeDomain(t.url) : '' }))
  ))
}))

// Running apps with a visible window — candidates for the "Add app to track"
// picker, excluding ones already tracked (so re-adding shows as unavailable).
ipcMain.handle('get-running-apps', () => new Promise(resolve => {
  getRunningApps(apps => resolve(
    apps.filter(a => !appData.sites.some(s => s.kind === 'app' && s.process?.toLowerCase() === a.proc.toLowerCase()))
  ))
}))

// App-kind entries are keyed by domain = "app:<process>" so every existing
// session/breakdown/sync code path (all keyed on the generic `domain` string)
// works unchanged — no separate storage needed for native-app tracking.
function normalizeSiteEntry(site) {
  if (site.kind === 'app') {
    return { name: site.name, kind: 'app', process: site.process, domain: `app:${site.process.toLowerCase()}`, color: site.color }
  }
  return { ...site, domain: normalizeDomain(site.domain) }
}

// Re-adding a domain that was previously removed means the user wants it
// tracked again, so any tombstone for it must be cleared — otherwise the
// next cloud sync would treat it as still-deleted and merge it back out.
function clearTombstone(domain) {
  appData.deletedSites = appData.deletedSites.filter(d => d.domain !== domain)
}

ipcMain.handle('add-site', (_, site) => {
  const entry = normalizeSiteEntry(site)
  appData.sites.push(entry)
  clearTombstone(entry.domain)
  saveData(appData)
  return appData.sites
})
// Removing only locally isn't enough: the next periodic sync would re-merge
// this domain back in from Firestore (which still has the old copy). Record
// a tombstone (domain + timestamp) so the merge in syncWithCloud knows to
// drop it everywhere, not just here.
ipcMain.handle('remove-site', (_, domain) => {
  appData.sites = appData.sites.filter(s => s.domain !== domain)
  appData.deletedSites = appData.deletedSites.filter(d => d.domain !== domain)
  appData.deletedSites.push({ domain, deletedAt: Date.now() })
  saveData(appData)
  return appData.sites
})
ipcMain.handle('update-site', (_, { domain, site }) => {
  const idx = appData.sites.findIndex(s => s.domain === domain)
  if (idx !== -1) appData.sites[idx] = normalizeSiteEntry(site)
  clearTombstone(domain)
  saveData(appData)
  return appData.sites
})

// Applies a cloud-merge computed in the renderer (Firestore SDK only runs
// there). The renderer's snapshot of THIS device's rows can be a few hundred
// ms to seconds stale by the time the Firestore round-trip finishes — ticks
// or a periodic flush may have advanced autoAccumSecs/sessions in the
// meantime. Blindly replacing appData.sessions with that snapshot would roll
// this device's own seconds backward (visible as the count "jumping back"
// then re-climbing). So only adopt rows belonging to OTHER devices from the
// synced set; this device's own rows stay whatever main.js currently has.
const isOwnRow = s => !s.device || s.device === DEVICE_ID

ipcMain.handle('apply-synced-data', (_, { sites, sessions, deletedSites, deletedSessions }) => {
  if (Array.isArray(deletedSites)) appData.deletedSites = deletedSites
  if (Array.isArray(deletedSessions)) appData.deletedSessions = deletedSessions
  if (Array.isArray(sites)) {
    const deadDomains = new Set((appData.deletedSites || []).map(d => d.domain))
    appData.sites = sites.filter(s => !deadDomains.has(s.domain))
  }
  if (Array.isArray(sessions)) {
    const deadKeys    = new Set((appData.deletedSessions || []).map(d => d.key))
    const deadDomains = new Set((appData.deletedSites    || []).map(d => d.domain))
    const ownRows     = appData.sessions.filter(isOwnRow)
    const otherRows   = sessions.filter(s => !isOwnRow(s) && !deadKeys.has(sessionKey(s)) && !deadDomains.has(s.domain))
    appData.sessions = [...ownRows, ...otherRows]
  }
  saveData(appData)
  const payload = { todaySeconds: todaySeconds() + todayLiveExtra, streak: streakDays() }
  send(stickyWin, 'stats-updated', payload)
  send(mainWin,   'stats-updated', payload)
  return payload
})

ipcMain.handle('log-session', (_, session) => {
  if (!session || session.seconds < 2) return { todaySeconds: todaySeconds() + todayLiveExtra, streak: streakDays() }
  addOrMergeSession(session.domain, session.seconds, true, hoursSpread(session.seconds))
  saveData(appData)
  const payload = { todaySeconds: todaySeconds() + todayLiveExtra, streak: streakDays() }
  send(stickyWin, 'stats-updated', payload)   // ← sync widget on manual save
  send(mainWin,   'stats-updated', payload)
  return payload
})

ipcMain.on('window-minimize', () => mainWin?.minimize())
ipcMain.on('window-maximize', () => mainWin?.isMaximized() ? mainWin.unmaximize() : mainWin?.maximize())
ipcMain.on('window-close',    () => mainWin?.hide())
ipcMain.on('toggle-sticky',   () => setStickyEnabled(!stickyWin))
ipcMain.on('open-main',       () => { if (mainWin) mainWin.show(); else createMainWindow() })
// ✕ on the widget just flips the same persisted setting the Settings toggle
// and the titlebar pin button (toggle-sticky) use — see setStickyEnabled for
// why that replaced the old separate runtime-only show/hide.
ipcMain.on('close-sticky',    () => setStickyEnabled(false))
// Badge strip toggle — grows/shrinks the widget's own OS window height
// (resizable:false only blocks user drag-resize, not this) instead of
// permanently making the widget taller. x/y stay put, so it expands downward.
ipcMain.on('set-sticky-expanded', (_, expanded) => {
  if (!stickyWin) return
  const b = stickyWin.getBounds()
  stickyWin.setBounds({ x: b.x, y: b.y, width: STICKY_W, height: expanded ? STICKY_H_EXPANDED : STICKY_H_COMPACT })
})
// ── Manual drag for sticky widget ──────────────────────────────
// Native -webkit-app-region:drag freezes the transparent/blurred widget's
// content mid-move on Windows (OS move loop blocks Chromium repaint until
// mouse-up). Polling the cursor and calling setBounds ourselves keeps it
// rendering smoothly throughout the drag.
let dragInterval = null
ipcMain.on('sticky-drag-start', () => {
  if (!stickyWin || dragInterval) return
  const startCursor = screen.getCursorScreenPoint()
  const startBounds = stickyWin.getBounds()
  dragInterval = setInterval(() => {
    if (!stickyWin || stickyWin.isDestroyed()) { clearInterval(dragInterval); dragInterval = null; return }
    const cur = screen.getCursorScreenPoint()
    stickyWin.setBounds({
      x: startBounds.x + (cur.x - startCursor.x),
      y: startBounds.y + (cur.y - startCursor.y),
      width: startBounds.width, height: startBounds.height
    })
  }, 16)
})
ipcMain.on('sticky-drag-end', () => {
  if (dragInterval) { clearInterval(dragInterval); dragInterval = null }
  if (stickyWin) {
    const b = stickyWin.getBounds()
    appData.settings.stickyX = b.x; appData.settings.stickyY = b.y
    saveData(appData)
  }
})

// ── Lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow()
  if (appData.settings.showSticky) createStickyWindow()
  createTray()
  startTracking()
  checkDailyReminder()
  setInterval(checkDailyReminder, 60_000)
  initAutoUpdater()
})
app.on('window-all-closed', () => {})
app.on('activate',          () => { if (!mainWin) createMainWindow() })
app.on('before-quit',       () => {
  if (trackInterval) clearInterval(trackInterval)
  flushAutoSession('quit')
})
