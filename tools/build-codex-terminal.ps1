param(
    [string]$SourceDirectory = (Join-Path $env:LOCALAPPDATA 'Tessera\build\codex-terminal-0.154.0'),
    [string]$Toolchain = '1.95.0-x86_64-pc-windows-gnu'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$sourceCommit = '6b9826e3aa83b1a5947db50f4332cb9c65f1b340'
$patch = Join-Path $repo 'patches\codex-terminal\buffer-history.patch'
$destination = Join-Path $repo 'src-tauri\resources\codex-terminal'

if (-not (Test-Path -LiteralPath $SourceDirectory)) {
    git clone --depth 1 --branch rust-v0.154.0 https://github.com/openai/codex.git $SourceDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Could not obtain pinned Codex source.' }
}
$head = git -C $SourceDirectory rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head.Trim() -ne $sourceCommit) {
    throw 'SourceDirectory must contain the pinned Codex 0.154.0 checkout.'
}
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
git -C $SourceDirectory apply --reverse --check $patch 2>$null
$alreadyPatched = $LASTEXITCODE -eq 0
$ErrorActionPreference = $previousErrorPreference
if (-not $alreadyPatched) {
    git -C $SourceDirectory apply --check $patch
    if ($LASTEXITCODE -ne 0) { throw 'Source changes conflict with the terminal patch.' }
    git -C $SourceDirectory apply $patch
    if ($LASTEXITCODE -ne 0) { throw 'Could not apply the terminal patch.' }
}

$previousToolchain = $env:RUSTUP_TOOLCHAIN
$previousPath = $env:PATH
try {
    $env:RUSTUP_TOOLCHAIN = $Toolchain
    if ($Toolchain.EndsWith('-gnu') -and (Test-Path 'C:\msys64\mingw64\bin')) {
        $env:PATH = 'C:\msys64\mingw64\bin;C:\msys64\usr\bin;' + $env:PATH
    }
    Push-Location (Join-Path $SourceDirectory 'codex-rs')
    try {
        # The release tag changes workspace versions from 0.0.0 to 0.154.0;
        # Cargo must reconcile those entries in the otherwise pinned lockfile.
        # Keep thin LTO compatible with the release dependencies, but limit
        # parallel linking to fit workstation memory. Only the CLI dispatcher
        # uses opt-level 0; the terminal library retains release optimization.
        cargo rustc --release -p codex-cli --bin codex -j 1 -- -C lto=thin -C opt-level=0 -C codegen-units=1 -C debuginfo=0 -C strip=symbols
        if ($LASTEXITCODE -ne 0) { throw 'Codex renderer build failed.' }
    } finally { Pop-Location }
} finally {
    $env:PATH = $previousPath
    if ($null -eq $previousToolchain) { Remove-Item Env:RUSTUP_TOOLCHAIN -ErrorAction SilentlyContinue }
    else { $env:RUSTUP_TOOLCHAIN = $previousToolchain }
}

$binary = Join-Path $SourceDirectory 'codex-rs\target\release\codex.exe'
# MSYS2's liblzma is dynamically linked by this GNU build. Keep the DLL
# beside the executable so the renderer does not depend on a developer's PATH.
$lzma = 'C:\msys64\mingw64\bin\liblzma-5.dll'
if ($Toolchain.EndsWith('-gnu') -and (Test-Path -LiteralPath $lzma)) {
    Copy-Item -LiteralPath $lzma -Destination (Join-Path (Split-Path -Parent $binary) 'liblzma-5.dll') -Force
}
$version = & $binary --version
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne 'codex-cli 0.154.0') {
    throw 'Built renderer version is unexpected.'
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $destination 'codex.exe') -Force
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'LICENSE') -Destination (Join-Path $destination 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'NOTICE') -Destination (Join-Path $destination 'NOTICE') -Force
if ($Toolchain.EndsWith('-gnu') -and (Test-Path -LiteralPath $lzma)) {
    Copy-Item -LiteralPath $lzma -Destination $destination -Force
    Copy-Item -LiteralPath 'C:\msys64\mingw64\share\licenses\xz\COPYING.0BSD' -Destination (Join-Path $destination 'LICENSE-liblzma') -Force
}
@{
    cliVersion = $version.Trim()
    sourceCommit = $sourceCommit
    patchSha256 = (Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash
    exeSha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
    purpose = 'Terminal renderer only; buffered history writes; no scrollback limit'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding ascii
Write-Output "Codex terminal renderer prepared in $destination"
