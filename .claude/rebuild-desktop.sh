#!/bin/bash
# Rebuilds the desktop app.asar whenever source files have changed since the last build.
# Kills any running instance first, rebuilds, then relaunches.

PROJ="g:/My Drive/Apps and Projects/GL 3d render/garage-designer"
ASAR="$PROJ/release/win-unpacked/resources/app.asar"
ASAR_WIN="g:\\My Drive\\Apps and Projects\\GL 3d render\\garage-designer\\release\\win-unpacked\\resources\\app.asar"
INSTALLED_ASAR="C:/Users/james/AppData/Local/Programs/garage-designer/resources/app.asar"
INSTALLED_ASAR_WIN="C:\\Users\\james\\AppData\\Local\\Programs\\garage-designer\\resources\\app.asar"
EXE_WIN="C:\\Users\\james\\AppData\\Local\\Programs\\garage-designer\\Garage Living Designer.exe"
ASAR_BIN="$PROJ/node_modules/@electron/asar/bin/asar.mjs"

# Only rebuild if any src file is newer than the current asar
if [ -f "$ASAR" ] && ! find "$PROJ/src" -newer "$ASAR" \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" \) 2>/dev/null | grep -q .; then
  exit 0
fi

echo "Source changed — rebuilding desktop app..."

# Kill running instance so the asar lock is released
cmd.exe /c "taskkill /F /IM \"Garage Living Designer.exe\" 2>nul"
sleep 2

# Build the Vite bundle into a local (non-Google-Drive) temp dir.
# Google Drive locks files inside $PROJ/renderer/assets, causing vite's
# prepare-out-dir step to fail with EINVAL on mkdir. Writing somewhere
# local avoids the GDrive filesystem altogether.
RENDER_OUT="C:/Users/james/AppData/Local/Temp/gl-renderer-build"
rm -rf "$RENDER_OUT" 2>/dev/null
cd "$PROJ" && npx vite build --outDir "$RENDER_OUT" --emptyOutDir || { echo "Vite build failed"; exit 1; }

# Stage: renderer/ (vite output) + electron/ + package.json.
# main.cjs loads '../renderer/index.html' so the staged folder name must be 'renderer'.
STAGE=$(mktemp -d)
cp -r "$RENDER_OUT"    "$STAGE/renderer"
cp -r "$PROJ/electron" "$STAGE/"
cp    "$PROJ/package.json" "$STAGE/"

# Copy node_modules that are bundled in the existing asar (needed by Electron main)
node "$ASAR_BIN" extract-file "$ASAR" package.json /dev/null 2>/dev/null || true
if node "$ASAR_BIN" list "$ASAR" 2>/dev/null | grep -q "^\\\\node_modules"; then
  TMPEXTRACT=$(mktemp -d)
  node "$ASAR_BIN" extract "$ASAR" "$TMPEXTRACT" 2>/dev/null
  if [ -d "$TMPEXTRACT/node_modules" ]; then
    cp -r "$TMPEXTRACT/node_modules" "$STAGE/"
  fi
  rm -rf "$TMPEXTRACT"
fi

# Pack new asar into win-unpacked
node "$ASAR_BIN" pack "$STAGE" "$ASAR_WIN" || { echo "asar pack failed"; rm -rf "$STAGE"; exit 1; }
rm -rf "$STAGE"

# Also copy to the installed location (what the desktop shortcut opens)
cp "$ASAR" "$INSTALLED_ASAR" && echo "Synced to installed app" || echo "Warning: could not sync to installed app"

# Relaunch from the installed location (same as desktop shortcut)
cmd.exe /c "start \"\" \"$EXE_WIN\""

echo "Desktop app rebuilt and relaunched!"
