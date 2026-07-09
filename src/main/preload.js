const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getData:      ()       => ipcRenderer.invoke('get-data'),
  saveSettings: (s)      => ipcRenderer.invoke('save-settings', s),
  addSite:      (site)   => ipcRenderer.invoke('add-site', site),
  removeSite:   (domain) => ipcRenderer.invoke('remove-site', domain),
  logSession:   (s)      => ipcRenderer.invoke('log-session', s),
  getOpenTabs:  ()       => ipcRenderer.invoke('get-open-tabs'),
  getRunningApps: ()     => ipcRenderer.invoke('get-running-apps'),
  updateSite:   (domain, site) => ipcRenderer.invoke('update-site', { domain, site }),
  applySyncedData: (data) => ipcRenderer.invoke('apply-synced-data', data),

  minimize:    () => ipcRenderer.send('window-minimize'),
  maximize:    () => ipcRenderer.send('window-maximize'),
  close:       () => ipcRenderer.send('window-close'),
  closeSticky: () => ipcRenderer.send('close-sticky'),   // ← X button
  toggleSticky:() => ipcRenderer.send('toggle-sticky'),
  openMain:    () => ipcRenderer.send('open-main'),
  stickyDragStart: () => ipcRenderer.send('sticky-drag-start'),
  stickyDragEnd:   () => ipcRenderer.send('sticky-drag-end'),
  setStickyExpanded: (expanded) => ipcRenderer.send('set-sticky-expanded', expanded),

  on:  (ch, fn) => {
    const ok = ['active-window','auto-track-update','stats-updated','settings-updated','idle-state','tracking-method']
    if (ok.includes(ch)) ipcRenderer.on(ch, (_, d) => fn(d))
  },
})
