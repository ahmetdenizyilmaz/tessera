@echo off
set PATH=C:\msys64\mingw64\bin;C:\msys64\usr\bin;%PATH%
cd /d C:\Users\user\Desktop\claude_gui_v2\src-tauri
cargo build 2>&1
