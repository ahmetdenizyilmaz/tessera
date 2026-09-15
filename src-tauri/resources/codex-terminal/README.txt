Optional Codex terminal renderer

tools/build-codex-terminal.ps1 prepares this directory before packaging Tessera.
The renderer batches terminal history writes without limiting scrollback or
altering the terminal protocol. The official installed Codex CLI continues to
run the app-server and tools. A version mismatch falls back to the official CLI.

Source, patch and build instructions: patches/codex-terminal/README.md
