@echo off
rem claude-or - run Claude Code through OpenRouter in THIS terminal only.
rem Your plain `claude` command keeps its normal Anthropic login path.
rem
rem   claude-or                  interactive session on the default model
rem   claude-or -p "prompt"      any claude args pass straight through
rem   set OPENROUTER_MODEL=qwen/qwen3-coder:free   then run claude-or
rem
rem Key lookup, in order:
rem   1. OPENROUTER_API_KEY environment variable
rem   2. %USERPROFILE%\.openrouter_key
rem   3. the key saved in Tessera (Settings, LLM Providers, OpenRouter), read
rem      from the Windows Credential Manager - save once, works everywhere
rem
rem NOTE: keep this file ASCII-only and keep redirect/pipe characters out of
rem rem-lines. cmd reads .cmd in the OEM codepage and still parses operators
rem inside comments, so a stray dash or angle bracket runs junk commands.
setlocal
if "%OPENROUTER_API_KEY%"=="" (
  if exist "%USERPROFILE%\.openrouter_key" (
    set /p OPENROUTER_API_KEY=<"%USERPROFILE%\.openrouter_key"
  )
)
if "%OPENROUTER_API_KEY%"=="" (
  for /f "usebackq delims=" %%K in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.local\bin\tessera-key.ps1" openrouter 2^>nul`) do set "OPENROUTER_API_KEY=%%K"
)
if "%OPENROUTER_API_KEY%"=="" (
  echo [claude-or] No OpenRouter key found.
  echo   Easiest: open Tessera, Settings - LLM Providers - OpenRouter, save your key once.
  echo   Or: setx OPENROUTER_API_KEY sk-or-...
  echo   Or: save the key as the only line of %USERPROFILE%\.openrouter_key
  exit /b 1
)
if "%OPENROUTER_MODEL%"=="" set "OPENROUTER_MODEL=deepseek/deepseek-chat-v3.1:free"
if "%OPENROUTER_SMALL_MODEL%"=="" set "OPENROUTER_SMALL_MODEL=%OPENROUTER_MODEL%"

set "ANTHROPIC_BASE_URL=https://openrouter.ai/api"
set "ANTHROPIC_AUTH_TOKEN=%OPENROUTER_API_KEY%"
set "ANTHROPIC_API_KEY="
set "CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS=600000"
set "ANTHROPIC_MODEL=%OPENROUTER_MODEL%"
set "ANTHROPIC_DEFAULT_SONNET_MODEL=%OPENROUTER_MODEL%"
set "ANTHROPIC_DEFAULT_OPUS_MODEL=%OPENROUTER_MODEL%"
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%OPENROUTER_SMALL_MODEL%"
set "ANTHROPIC_SMALL_FAST_MODEL=%OPENROUTER_SMALL_MODEL%"
set "CLAUDE_CODE_SUBAGENT_MODEL=%OPENROUTER_SMALL_MODEL%"

call claude %*
endlocal
