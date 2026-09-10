@echo off
rem claude-local - run Claude Code against your LOCAL Ollama in THIS terminal only.
rem Plain `claude` keeps its normal Anthropic login path; nothing global changes.
rem Needs Ollama 0.14 or newer (Anthropic-compatible /v1/messages). Fully offline.
rem
rem   claude-local                    interactive session on the default model
rem   claude-local -p "prompt"        any claude args pass straight through
rem   set OLLAMA_CC_MODEL=qwen3:4b    then run claude-local  (pick a model)
rem
rem NOTE: keep this file ASCII-only and keep redirect/pipe characters out of
rem rem-lines - cmd parses operators even inside comments.
setlocal
if "%OLLAMA_CC_MODEL%"=="" set "OLLAMA_CC_MODEL=qwen3.8:27b"
if "%OLLAMA_CC_URL%"=="" set "OLLAMA_CC_URL=http://localhost:11434"

set "ANTHROPIC_BASE_URL=%OLLAMA_CC_URL%"
set "ANTHROPIC_AUTH_TOKEN=ollama"
set "ANTHROPIC_API_KEY="
rem Local prefill can be silent for 5+ min; stop the CLI idle watchdogs from
rem killing requests that are still working.
set "API_TIMEOUT_MS=1800000"
set "CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS=1200000"
set "CLAUDE_STREAM_IDLE_TIMEOUT_MS=1200000"
set "API_FORCE_IDLE_TIMEOUT=0"
set "ANTHROPIC_MODEL=%OLLAMA_CC_MODEL%"
set "ANTHROPIC_DEFAULT_SONNET_MODEL=%OLLAMA_CC_MODEL%"
set "ANTHROPIC_DEFAULT_OPUS_MODEL=%OLLAMA_CC_MODEL%"
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%OLLAMA_CC_MODEL%"
set "ANTHROPIC_SMALL_FAST_MODEL=%OLLAMA_CC_MODEL%"
set "CLAUDE_CODE_SUBAGENT_MODEL=%OLLAMA_CC_MODEL%"

call claude %*
endlocal
