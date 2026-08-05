---
name: panel-messaging
description: Talk to the other Claude sessions running beside you in Claude GUI. Use when the user refers to another panel, when work belongs in a different directory than yours, or when another session already has the context you would otherwise rebuild.
---

# Messaging other panels

You are one of several Claude sessions running side by side in a Claude GUI
window. Each panel is a separate conversation with its own working directory,
its own history, and its own model. They cannot see each other's context.

Three tools connect you to them:

- `list_panels` — who else is open, where they are working, whether they are busy.
- `send_to_panel` — send a message to one of them.
- `read_panel` — read another panel's recent conversation without interrupting it.

## When this is the right move

**Reach for another panel when it already has something you don't:**

- It is working in a different repository or directory that the task touches.
- It has been deep in a problem you are only now being asked about — reading its
  last few turns is cheaper and more accurate than re-deriving its conclusions.
- The user says something like "ask the other one", "tell the API panel", "what
  did the frontend session decide" — they mean this.

**Do not use it to delegate work you can do yourself.** A panel round-trip costs
a full turn on the other side, and the person watching that panel sees your
message land in their conversation. It is a message to a colleague, not a
subroutine call.

## How to address a panel

Call `list_panels` first. Panels are addressed by name, and names are not
guaranteed unique — if two share one, the tool will tell you and you should use
the id instead. `is_self` marks your own panel; you cannot message yourself.

## Writing the message

The other panel cannot see your conversation, so a bare "what about the port?"
is useless to it. Include what it needs: the question, why you are asking, and
any specifics it would otherwise have to guess.

Your message arrives in that panel as a user turn, visibly tagged with your
panel's name. A person may well be reading it.

## Waiting, or not

By default `send_to_panel` returns as soon as the message is delivered, and the
other panel answers in its own conversation. That is usually what you want —
say what you needed to say, tell the user you have passed it on, and finish
your turn.

Pass `wait_for_reply: true` only when you genuinely cannot continue without the
answer. Be aware:

- If that panel is blocked on a permission prompt or a question, you will get
  `awaiting_user_input` back immediately rather than a reply — the person has to
  answer it before that session can do anything.
- If it is mid-task, you wait for its whole current turn.
- Two panels each waiting on the other would deadlock, so nested waits are
  refused.

## Limits

- A message chain is capped at three hops. If you receive a panel-message and
  forward it onward, and that panel forwards it again, the chain stops. Answer
  in your own panel rather than relaying further.
- Five messages per minute per panel.
- Terminal panels can be typed into, but they run the interactive CLI, so there
  is no reply signal — treat those as fire-and-forget.
