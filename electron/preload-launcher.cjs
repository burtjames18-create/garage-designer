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

  // Project file handling (Electron only)
  openProject: () => ipcRenderer.invoke('project-open'),
  saveProjectAs: (suggestedName, content) =>
    ipcRenderer.invoke('project-save-as', suggestedName, content),
  saveProject: (filePath, content) =>
    ipcRenderer.invoke('project-save', filePath, content),
  getProjectsDir: () => ipcRenderer.invoke('projects-dir'),
  createProjectFolder: (suggestedName, content) =>
    ipcRenderer.invoke('project-create-folder', suggestedName, content),

  // Save-before-close hooks: the main process fires 'app-save-before-close'
  // after the user clicks X; the renderer is expected to flush a final save
  // and call confirmClose() so the window can actually close.
  onSaveBeforeClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app-save-before-close', listener)
    return () => ipcRenderer.off('app-save-before-close', listener)
  },
  confirmClose: () => ipcRenderer.send('app-close-confirmed'),
})
