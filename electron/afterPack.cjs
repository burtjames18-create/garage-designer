// Runs after electron-builder packs the app but before it builds the installer.
// Invokes the vendored rcedit-x64.exe (in build/) to embed the GL icon and
// version metadata into the packaged exe.
//
// Why not the npm `rcedit` package or electron-builder's `signAndEditExecutable`:
// - npm installs into the Google-Drive-backed node_modules often land as
//   0-byte placeholders, which breaks require() chains.
// - `signAndEditExecutable: true` triggers a winCodeSign download whose
//   macOS symlinks can't be extracted without admin / Developer Mode.
// Shipping rcedit.exe in the repo sidesteps both.

const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const projectDir = context.packager.projectDir
  const iconPath = path.join(projectDir, 'build', 'icon.ico')
  const rceditPath = path.join(projectDir, 'build', 'rcedit-x64.exe')

  for (const [label, p] of [['exe', exePath], ['icon', iconPath], ['rcedit', rceditPath]]) {
    if (!fs.existsSync(p)) throw new Error(`afterPack: ${label} not found at ${p}`)
  }

  const version = context.packager.appInfo.version
  const productName = context.packager.appInfo.productName

  execFileSync(rceditPath, [
    exePath,
    '--set-icon', iconPath,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'FileDescription', productName,
    '--set-version-string', 'CompanyName', 'Garage Living',
    '--set-file-version', version,
    '--set-product-version', version,
  ], { stdio: 'inherit' })

  console.log(`afterPack: embedded icon + metadata into ${exeName}`)
}
