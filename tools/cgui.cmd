@echo off
rem cgui — open Tessera with a new tab in the current (or given) directory.
rem   cgui           -> current directory
rem   cgui .         -> current directory
rem   cgui subdir    -> ./subdir (resolved to absolute)
rem   cgui C:\path   -> that path
rem If the app is already running, the single-instance handler adds the tab to
rem the existing window instead of launching a second copy.
setlocal
if "%~1"=="" ( set "TARGET=%CD%" ) else ( set "TARGET=%~f1" )
start "" "%USERPROFILE%\Apps\Tessera\Tessera.exe" "%TARGET%"
endlocal
