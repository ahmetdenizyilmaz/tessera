# Installs only the preview build, leaving stable Tessera and cgui untouched.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'src-tauri\target\release\tessera.exe'
$dest = Join-Path $env:USERPROFILE 'Apps\Tessera-Preview'
$target = Join-Path $dest 'Tessera Preview.exe'
if (-not (Test-Path -LiteralPath $source)) { throw 'Build first: npm run build:preview' }
if ((Get-Item -LiteralPath $source).VersionInfo.ProductName -ne 'Tessera Preview') {
    throw 'This binary is not Tessera Preview. Build with npm run build:preview first.'
}
# Refuse to overwrite an active preview; never stop the stable app by name.
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }
if ($running) { throw 'Close Tessera Preview, then run this script again.' }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force
Get-ChildItem -LiteralPath (Split-Path -Parent $source) -Filter '*.dll' | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
}
. (Join-Path $PSScriptRoot 'copy-codex-terminal.ps1')
Copy-CodexTerminalRuntime (Split-Path -Parent $source) $dest
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'Tessera Preview.lnk'))
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $dest
$shortcut.Description = 'Tessera preview with Claude and Codex; separate workspace and settings'
$shortcut.Save()
Write-Host "Installed: $target"
Write-Host 'Launch the Tessera Preview desktop shortcut.'
