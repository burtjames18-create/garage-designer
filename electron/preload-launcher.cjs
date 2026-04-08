const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcher', {
  // Launcher splash screen
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data))
  },
  getVersion: () => ipcRenderer.invoke('get-app-version'),

  // Login screen
  validate: (email, token) => ipcRenderer.invoke('validate-license', email, token),
  getSavedCredentials: () => ipcRenderer.invoke('get-saved-credentials'),
  openSignup: () => ipcRenderer.invoke('open-signup'),
  quit: () => ipcRenderer.invoke('app-quit'),
  uninstall: () => ipcRenderer.invoke('app-uninstall'),
})
