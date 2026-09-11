---
description: Send a message to another session, panel, subwindow, pane, or tab — /send <panel> <message>
argument-hint: <panel> <message>
allowed-tools: mcp__panels__list_panels, mcp__panels__send_to_panel
---

Send a message to another Claude or Codex session in this window. Session,
panel, subwindow, sub-window, pane, tab, chat, and conversation mean the same
destination. Call `list_panels` to identify the intended non-self recipient;
ask which one if several match instead of guessing or broadcasting.

Arguments: $ARGUMENTS

The first word is the target panel's name or id; everything after it is the
message. If the panel name is ambiguous or you cannot tell where the name ends,
call `list_panels` first and match against the real names.

Send it with `send_to_panel` without waiting for a reply, then tell the user in
one line that it was delivered and to which panel. Do not answer the message
yourself.
