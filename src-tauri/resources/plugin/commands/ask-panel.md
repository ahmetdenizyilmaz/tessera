---
description: Ask another panel a question and wait for its answer — /ask-panel <panel> <question>
argument-hint: <panel> <question>
allowed-tools: mcp__panels__list_panels, mcp__panels__send_to_panel
---

Ask another Claude panel a question and wait for its reply.

Arguments: $ARGUMENTS

The first word is the target panel's name or id; everything after it is the
question. Call `list_panels` first if the name is ambiguous.

Send it with `send_to_panel` and `wait_for_reply: true`. Include enough context
in the question that a session which cannot see this conversation can answer it.

When the reply comes back, give the user the answer. If the result says the
panel is awaiting user input, tell them it is blocked on a prompt over there
rather than pretending it did not answer.
