// Launcher: strips ELECTRON_RUN_AS_NODE before spawning the actual Electron app
// This is needed when running from within another Electron-based environment (e.g. VS Code, Claude Code)
const { spawn } = require('child_process')
const { join } = require('path')
const electronExe = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const appDir = join(__dirname, '..')

const child = spawn(electronExe, [appDir], {
  stdio: 'inherit',
  env,
  windowsHide: false,
  detached: false,
})

child.on('close', (code) => process.exit(code || 0))
