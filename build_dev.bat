@echo off
set PATH=C:\msys64\mingw64\bin;C:\msys64\usr\bin;%PATH%
cd /d "%~dp0src-tauri"
cargo build 2>&1
