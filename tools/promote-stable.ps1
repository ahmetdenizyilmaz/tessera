# Promote the current release build to the stable app you use day to day.
#
#   powershell -ExecutionPolicy Bypass -File tools\promote-stable.ps1
#
# The stable copy lives OUTSIDE the build tree, so "npx tauri build" can never
# overwrite it or fail because the running app locks the binary. Run this only
# when you want the app you use to pick up new work.
#
# Build the stable release first (it carries its own icon):
#   npx tauri build --config src-tauri/tauri.stable.conf.json
#
# NOTE: keep this file ASCII-only. PowerShell reads it as ANSI, so non-ASCII
# punctuation turns into mojibake and breaks parsing.

$ErrorActionPreference = 'Stop'

$repo   = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'src-tauri\target\release\claude-gui.exe'
$dest   = 'C:\Users\user\Apps\ClaudeGUI'
$target = Join-Path $dest 'Claude GUI.exe'

if (-not (Test-Path $source)) {
    throw "No release build found at $source. Build it first with: npx tauri build --config src-tauri/tauri.stable.conf.json"
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null

# The stable app must not be running, or the copy is denied
$running = Get-Process -Name 'Claude GUI' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host 'Stable app is running - closing it first.'
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 800
}

Copy-Item $source -Destination $target -Force

# The exe is NOT standalone: this GNU-toolchain build loads WebView2Loader.dll
# at runtime. Without it Windows reports "WebView2Loader.dll was not found"
# and the app never starts. Ship every DLL that sits beside the built exe.
$srcDir = Split-Path -Parent $source
Get-ChildItem -Path $srcDir -Filter '*.dll' | ForEach-Object {
    Copy-Item $_.FullName -Destination $dest -Force
    Write-Host ("  + " + $_.Name)
}

# Install the `cgui` CLI launcher into ~/.local/bin (already on PATH, where
# `claude` lives) so `cgui` works from any directory.
$binDir = Join-Path (Join-Path $env:USERPROFILE '.local') 'bin'
$cguiSrc = Join-Path $PSScriptRoot 'cgui.cmd'
if (Test-Path $cguiSrc) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Copy-Item $cguiSrc -Destination (Join-Path $binDir 'cgui.cmd') -Force
    Write-Host '  + cgui.cmd -> ~/.local/bin'
}

$info = Get-Item $target
Write-Host ("Promoted: {0:N0} MB, built {1}" -f ($info.Length / 1MB), $info.LastWriteTime)
Write-Host "Launch it from the 'Claude GUI' desktop shortcut."
