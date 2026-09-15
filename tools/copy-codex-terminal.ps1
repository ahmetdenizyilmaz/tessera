# Shared by the portable preview/stable installers. The app must be closed.
function Copy-CodexTerminalRuntime([string]$BuildDirectory, [string]$InstallDirectory) {
    $runtimeSource = Join-Path $BuildDirectory 'codex-terminal'
    $runtimeTarget = Join-Path $InstallDirectory 'codex-terminal'
    $sourceManifest = Join-Path $runtimeSource 'manifest.json'
    $targetManifest = Join-Path $runtimeTarget 'manifest.json'
    if ((Test-Path -LiteralPath $sourceManifest) -and
        (Test-Path -LiteralPath (Join-Path $runtimeSource 'codex.exe'))) {
        New-Item -ItemType Directory -Path $runtimeTarget -Force | Out-Null
        Get-ChildItem -LiteralPath $runtimeSource -File | Where-Object Name -NE 'manifest.json' | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $runtimeTarget $_.Name) -Force
        }
        # Enable the renderer only after its files have been copied successfully.
        Copy-Item -LiteralPath $sourceManifest -Destination $targetManifest -Force
    } elseif (Test-Path -LiteralPath $targetManifest) {
        # A build without the optional renderer must not activate a stale package.
        Remove-Item -LiteralPath $targetManifest
    }
}
