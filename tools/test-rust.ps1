# Tauri embeds its Windows manifest in app binaries only. Unit-test executables
# also need common-controls v6 and WebView2Loader.dll before they can start.
param([switch]$Live, [switch]$Permissions, [switch]$Stable, [switch]$OpenCode, [switch]$CodexStartup)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    if (Test-Path 'C:\msys64\mingw64\bin') {
        $env:PATH = 'C:\msys64\mingw64\bin;C:\msys64\usr\bin;' + $env:PATH
    }
    $cargoArgs = @('test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', '--no-run', '--message-format=json')
    if (-not $Stable) { $cargoArgs += @('--features', 'preview') }
    $artifacts = @(& cargo @cargoArgs | ForEach-Object {
        try {
            $entry = $_ | ConvertFrom-Json
            if ($entry.reason -eq 'compiler-message') { Write-Host $entry.message.rendered }
            if ($entry.reason -eq 'compiler-artifact' -and $entry.profile.test -and $entry.executable) { $entry.executable }
        } catch { Write-Host $_ }
    })
    if ($LASTEXITCODE -ne 0) { throw 'Rust test compilation failed' }
    if (-not $artifacts.Count) { throw 'No Rust test executable produced' }
    if (-not ('TesseraTestResource' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TesseraTestResource {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool EndUpdateResource(IntPtr handle, bool discard);
}
'@
    }
    $manifest = [Text.Encoding]::UTF8.GetBytes(@'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>
</assembly>
'@)
    foreach ($artifact in $artifacts) {
        $handle = [TesseraTestResource]::BeginUpdateResource($artifact, $false)
        if ($handle -eq [IntPtr]::Zero) { throw "Cannot update test manifest: $artifact" }
        $updated = [TesseraTestResource]::UpdateResource($handle, [IntPtr]24, [IntPtr]1, 0, $manifest, $manifest.Length)
        $ended = [TesseraTestResource]::EndUpdateResource($handle, -not $updated)
        if (-not $updated -or -not $ended) { throw 'Cannot embed test manifest' }
        $testDir = Split-Path -Parent $artifact
        $profileDir = Split-Path -Parent $testDir
        $loader = Join-Path $profileDir 'WebView2Loader.dll'
        if (Test-Path -LiteralPath $loader) { Copy-Item -LiteralPath $loader -Destination $testDir -Force }
        if ($CodexStartup) { & $artifact 'live_codex_empty_terminal_startup' '--ignored' '--nocapture' }
        elseif ($OpenCode) { & $artifact 'live_opencode_server_and_terminal' '--ignored' '--nocapture' }
        elseif ($Live) { & $artifact 'live_transports_and_exact_thread_resume' '--ignored' '--nocapture' }
        elseif ($Permissions) { & $artifact 'live_native_permission_notifications' '--ignored' '--nocapture' }
        else { & $artifact '--test-threads=1' }
        if ($LASTEXITCODE -ne 0) { throw "Rust tests failed: $LASTEXITCODE" }
    }
} finally { Pop-Location }
