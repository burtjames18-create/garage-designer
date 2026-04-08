const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')

// License server URL — update this after deploying to Railway
const LICENSE_SERVER = process.env.LICENSE_SERVER || 'https://gl-license-server-production.up.railway.app'
const SIGNUP_URL = LICENSE_SERVER

// Credentials file path (stored in user's appData)
const credentialsPath = path.join(app.getPath('userData'), 'credentials.json')

let loginWindow = null
let launcherWindow = null
let mainWindow = null

// ---------------------------------------------------------------------------
// Credentials persistence
// ---------------------------------------------------------------------------
function saveCredentials(email, token) {
  fs.writeFileSync(credentialsPath, JSON.stringify({ email, token }), 'utf8')
}

function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Login window
// ---------------------------------------------------------------------------
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 420,
    height: 480,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-launcher.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#111111',
  })

  loginWindow.loadFile(path.join(__dirname, 'login-window.html'))
  loginWindow.once('ready-to-show', () => loginWindow.show())
}

// ---------------------------------------------------------------------------
// Launcher window (splash / updater)
// ---------------------------------------------------------------------------
function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-launcher.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../build/icon.ico'),
    backgroundColor: '#111111',
  })

  launcherWindow.loadFile(path.join(__dirname, 'launcher-window.html'))

  launcherWindow.once('ready-to-show', () => {
    launcherWindow.show()
    // Close login window if still open
    if (loginWindow && !loginWindow.isDestroyed()) {
      loginWindow.close()
      loginWindow = null
    }
  })
}

// ---------------------------------------------------------------------------
// Main application window
// ---------------------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Garage Living Designer',
    icon: path.join(__dirname, '../build/icon.ico'),
    autoHideMenuBar: true,
  })

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.close()
      launcherWindow = null
    }
  })
}

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------
function sendToLauncher(channel, data) {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send(channel, data)
  }
}

ipcMain.handle('get-app-version', () => app.getVersion())

ipcMain.handle('app-quit', () => app.quit())

ipcMain.handle('open-signup', () => {
  shell.openExternal(SIGNUP_URL)
})

ipcMain.handle('get-saved-credentials', () => loadCredentials())

// Validate license against the server
ipcMain.handle('validate-license', async (_event, email, token) => {
  try {
    const res = await fetch(`${LICENSE_SERVER}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, access_token: token }),
    })

    const data = await res.json()

    if (data.valid) {
      // Save credentials for next launch
      saveCredentials(email, token)
      // Proceed to launcher/updater
      setTimeout(() => {
        createLauncherWindow()
        launcherWindow.webContents.once('did-finish-load', () => checkForUpdates())
      }, 800)
    }

    return data
  } catch (err) {
    // If server is unreachable, check for saved credentials as fallback
    const saved = loadCredentials()
    if (saved && saved.email === email && saved.token === token) {
      setTimeout(() => {
        createLauncherWindow()
        launcherWindow.webContents.once('did-finish-load', () => checkForUpdates())
      }, 800)
      return { valid: true, name: 'User', offline: true }
    }
    return { valid: false, error: 'Could not connect to license server' }
  }
})

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------
function checkForUpdates() {
  let autoUpdater

  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (err) {
    console.error('electron-updater load error:', err)
    sendToLauncher('update-status', {
      status: 'error',
      message: `Update module error: ${err.message}`,
    })
    setTimeout(launchApp, 3000)
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'burtjames18-create',
    repo: 'garage-designer',
  })

  sendToLauncher('update-status', {
    status: 'checking',
    message: 'Checking for updates\u2026',
  })

  autoUpdater.on('update-available', (info) => {
    sendToLauncher('update-status', {
      status: 'available',
      message: `Update v${info.version} found. Downloading\u2026`,
    })
    autoUpdater.downloadUpdate()
  })

  autoUpdater.on('update-not-available', () => {
    sendToLauncher('update-status', {
      status: 'up-to-date',
      message: 'App is up to date',
    })
    setTimeout(launchApp, 1500)
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToLauncher('update-status', {
      status: 'downloading',
      message: `Downloading update\u2026 ${Math.round(progress.percent)}%`,
      percent: progress.percent,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    sendToLauncher('update-status', {
      status: 'downloaded',
      message: 'Update downloaded. Restarting\u2026',
    })
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 2000)
  })

  autoUpdater.on('error', () => {
    sendToLauncher('update-status', {
      status: 'error',
      message: 'Update check failed. Launching app\u2026',
    })
    setTimeout(launchApp, 2000)
  })

  autoUpdater.checkForUpdates().catch(() => {
    sendToLauncher('update-status', {
      status: 'error',
      message: 'Could not reach update server. Launching app\u2026',
    })
    setTimeout(launchApp, 2000)
  })
}

// ---------------------------------------------------------------------------
// Transition from launcher -> main app
// ---------------------------------------------------------------------------
function launchApp() {
  sendToLauncher('update-status', {
    status: 'launching',
    message: 'Launching Garage Living Designer\u2026',
  })
  setTimeout(createMainWindow, 500)
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  // Try auto-login with saved credentials
  const saved = loadCredentials()
  if (saved && saved.email && saved.token) {
    // Validate silently in the background
    createLauncherWindow()
    launcherWindow.webContents.once('did-finish-load', async () => {
      sendToLauncher('update-status', {
        status: 'checking',
        message: 'Verifying license\u2026',
      })

      try {
        const res = await fetch(`${LICENSE_SERVER}/api/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: saved.email, access_token: saved.token }),
        })
        const data = await res.json()

        if (data.valid) {
          checkForUpdates()
        } else {
          // Credentials revoked or invalid — show login
          if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.close()
            launcherWindow = null
          }
          createLoginWindow()
        }
      } catch {
        // Server unreachable — allow offline launch with saved credentials
        checkForUpdates()
      }
    })
  } else {
    // No saved credentials — show login
    createLoginWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
