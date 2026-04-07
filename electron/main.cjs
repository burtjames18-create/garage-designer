const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let launcherWindow = null
let mainWindow = null

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

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------
function checkForUpdates() {
  let autoUpdater

  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch {
    // electron-updater not available (dev mode) — skip straight to launch
    sendToLauncher('update-status', {
      status: 'up-to-date',
      message: 'Development mode — skipping update check',
    })
    setTimeout(launchApp, 1500)
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // silence default logging

  // GitHub private repo — needs a token for release access.
  // Set GH_TOKEN env var or place a github-token.txt next to the exe.
  const tokenPath = path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'github-token.txt')
  let ghToken = process.env.GH_TOKEN || ''
  try { ghToken = ghToken || require('fs').readFileSync(tokenPath, 'utf8').trim() } catch {}

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'burtjames18-create',
    repo: 'garage-designer',
    private: true,
    token: ghToken || undefined,
  })

  sendToLauncher('update-status', {
    status: 'checking',
    message: 'Checking for updates\u2026',
  })

  // --- Update available ---------------------------------------------------
  autoUpdater.on('update-available', (info) => {
    sendToLauncher('update-status', {
      status: 'available',
      message: `Update v${info.version} found. Downloading\u2026`,
    })
    autoUpdater.downloadUpdate()
  })

  // --- Already up to date -------------------------------------------------
  autoUpdater.on('update-not-available', () => {
    sendToLauncher('update-status', {
      status: 'up-to-date',
      message: 'App is up to date',
    })
    setTimeout(launchApp, 1500)
  })

  // --- Download progress --------------------------------------------------
  autoUpdater.on('download-progress', (progress) => {
    sendToLauncher('update-status', {
      status: 'downloading',
      message: `Downloading update\u2026 ${Math.round(progress.percent)}%`,
      percent: progress.percent,
    })
  })

  // --- Download complete --------------------------------------------------
  autoUpdater.on('update-downloaded', () => {
    sendToLauncher('update-status', {
      status: 'downloaded',
      message: 'Update downloaded. Restarting\u2026',
    })
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 2000)
  })

  // --- Error --------------------------------------------------------------
  autoUpdater.on('error', () => {
    sendToLauncher('update-status', {
      status: 'error',
      message: 'Update check failed. Launching app\u2026',
    })
    setTimeout(launchApp, 2000)
  })

  // Kick off the check
  autoUpdater.checkForUpdates().catch(() => {
    sendToLauncher('update-status', {
      status: 'error',
      message: 'Could not reach update server. Launching app\u2026',
    })
    setTimeout(launchApp, 2000)
  })
}

// ---------------------------------------------------------------------------
// Transition from launcher → main app
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
  createLauncherWindow()

  launcherWindow.webContents.once('did-finish-load', () => {
    checkForUpdates()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLauncherWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
