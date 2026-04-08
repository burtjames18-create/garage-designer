# Garage Living Designer — Project Workflow

## Overview

This is an Electron desktop app (React + Three.js) distributed via GitHub Releases with automatic updates. Users authenticate via a license server before accessing the designer.

---

## Tech Stack

- **Frontend**: React 19 + TypeScript, Three.js via React Three Fiber
- **Desktop**: Electron 41, electron-builder (NSIS installer), electron-updater
- **Build**: Vite
- **State**: Zustand
- **Hosting**: GitHub Releases (app distribution), Railway (license server)
- **Source sync**: Google Drive (`h:\My Drive\Apps and Projects\GL 3d render\`)

---

## Key URLs

| What | URL |
|------|-----|
| GitHub Repo | https://github.com/burtjames18-create/garage-designer |
| GitHub Releases | https://github.com/burtjames18-create/garage-designer/releases |
| License Server | https://gl-license-server-production.up.railway.app |
| License API | https://gl-license-server-production.up.railway.app/api/validate |
| Signup Portal | https://gl-license-server-production.up.railway.app (same root) |

---

## Git Setup

- **Remote**: `origin` → `https://github.com/burtjames18-create/garage-designer.git`
- **Branch**: `master` (single branch, all work here)
- **Git identity** (set per-repo on work machine):
  - Name: `James Burt`
  - Email: `burtjames18@yahoo.com`

---

## Development Workflow

### Local dev
```bash
npm run dev          # Vite dev server (browser)
npm run electron:preview  # Build + launch in Electron locally
```

### Build only (no publish)
```bash
npm run build        # Vite build → renderer/ folder
npm run electron:build   # Build + create installer → release/ folder
```

---

## Release & Update Workflow

### Step-by-step to push a new version to users:

1. **Make changes** and test locally
2. **Bump version** in `package.json` (e.g. `"version": "1.0.10"`)
3. **Commit and push** to GitHub:
   ```bash
   git add .
   git commit -m "v1.0.10: Description of changes"
   git push origin master
   ```
4. **Build and publish** the release:
   ```bash
   npm run electron:publish
   ```
   This does two things:
   - Runs `vite build` (React app → `renderer/`)
   - Runs `electron-builder --win --publish always` (creates NSIS installer, uploads to GitHub Releases)

5. **Users auto-update**: When users open the app, `electron-updater` checks GitHub Releases, downloads the new version, and installs it on quit.

### What gets uploaded to GitHub Releases:
- `Garage Living Designer Setup {version}.exe` — the installer
- `Garage Living Designer Setup {version}.exe.blockmap` — for differential/delta updates
- `latest.yml` — version metadata for electron-updater

---

## App Startup Flow (what the user sees)

1. **Login screen** (`electron/login-window.html`)
   - User enters email + access token
   - Validates against license server (`POST /api/validate`)
   - Saved credentials allow auto-login on next launch
   - Offline fallback: if server is unreachable but saved creds exist, allows access

2. **Splash/launcher screen** (`electron/launcher-window.html`)
   - Shows version number
   - Checks for updates via GitHub Releases
   - Downloads update if available (shows progress bar)
   - If update downloaded: installs on quit via `quitAndInstall()`
   - If up-to-date or error: proceeds to main app

3. **Main app** (React app in `renderer/`)
   - First time: **Setup screen** (`GarageSetup.tsx`) — enter customer, address, dimensions
   - Then: **Designer** with 3D view, sidebar, topbar

---

## License Server

- **Hosted on**: Railway.app
- **URL**: `https://gl-license-server-production.up.railway.app`
- **Validation endpoint**: `POST /api/validate`
  - Body: `{ "email": "...", "access_token": "..." }`
  - Response: `{ "valid": true, "name": "User Name" }` or `{ "valid": false, "error": "..." }`
- **Signup**: Same root URL opens in browser for new users to request access
- **Credentials storage**: `{userData}/credentials.json` (cleared on uninstall)

---

## Electron Builder Config (in package.json)

- **App ID**: `com.garageliving.designer`
- **Installer**: NSIS one-click (no directory selection)
- **Icon**: `build/icon.ico`
- **Publish provider**: GitHub (`burtjames18-create/garage-designer`)
- **Auto-delete app data on uninstall**: yes
- **Output**: `release/` folder (git-ignored)

---

## Project Structure

```
garage-designer/
├── electron/                  # Electron main process
│   ├── main.cjs               # App lifecycle, licensing, auto-update
│   ├── launcher.cjs           # Launcher wrapper
│   ├── preload-launcher.cjs   # IPC bridge (getVersion, validate, etc.)
│   ├── login-window.html      # Login UI
│   └── launcher-window.html   # Splash/update UI
├── src/                       # React app
│   ├── components/            # UI components
│   ├── store/                 # Zustand state (garageStore.ts)
│   └── App.tsx                # Root component
├── build/                     # Build resources (icon)
├── renderer/                  # Vite output (git-ignored)
├── release/                   # Installer output (git-ignored)
├── package.json               # Scripts, deps, electron-builder config
├── vite.config.ts             # Vite config (defines __APP_VERSION__)
└── CLAUDE.md                  # AI assistant context
```

---

## Version Display

Version number (from `package.json`) is shown on every screen:
- **Login screen**: bottom-right, via `window.launcher.getVersion()` IPC
- **Splash screen**: bottom-right, via `window.launcher.getVersion()` IPC
- **Setup screen**: bottom-right, via Vite `__APP_VERSION__` define
- **Main app topbar**: end of topbar, via Vite `__APP_VERSION__` define

---

## No CI/CD

There are no GitHub Actions workflows. All builds and releases are done manually from the local machine using `npm run electron:publish`. The GitHub repo's only role is source control and hosting releases for auto-update.

---

## Google Drive Sync

The project source code lives on Google Drive and syncs across machines automatically. Build outputs (`renderer/`, `release/`, `node_modules/`) are git-ignored and not synced meaningfully — each machine runs its own `npm install` and builds locally.

---

## Node.js Requirement

Node.js must be installed on any machine used for building:
- **Path on work machine**: `/c/Program Files/nodejs`
- Run `npm install` after cloning or syncing to a new machine
