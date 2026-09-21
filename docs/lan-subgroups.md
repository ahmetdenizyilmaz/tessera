# LAN remote subgroups

Tessera can pair directly with another Tessera installation on the same private IPv4 subnet. Each
computer appears in the other's workspace as a group containing its currently open Claude and Codex
panels. The agents continue to run on the computer that owns them; only panel metadata, recent
conversation reads, terminal screen snapshots, and message delivery cross the connection.

## Panel views and updates (0.3.7)

Install 0.3.7 or newer on **both computers** for terminal sharing. Terminal panels now show the
host's actual terminal screen, including ANSI colors, cursor position and alternate-screen programs;
chat panels continue to show their transcript. An older host produces an update message instead of
silently displaying its terminal as chat. Existing pairings remain valid.

Terminal screens refresh while connected, including when the host switches into another group.
The viewer preserves the host's rows and columns; smaller tiles can scroll without resizing the
host's terminal. Recent scrollback is included (up to 2,000 lines, reduced to fit the encrypted frame).
The screen is read-only; the existing message box still delivers a message through the panel bus.
A terminal that has never started must first be opened on its host.

Panel lists include the whole workspace across navigation levels. Group changes and continuous
streaming cannot postpone roster publication indefinitely; failed updates are retried. Disconnected
peers retain their last known panels, and an authoritative empty roster removes closed panels.
Remote groups are reattached after workspace restore and appear at root when discovered while
the user is viewing another group.

In 0.3.8, the **×** button on a remote tile or tab closes that view **only on this computer**. It does not
stop the host's terminal/chat, send a close command, disconnect the peer, or affect other viewers.
Locally closed panels stay hidden across roster refreshes, reconnects and Tessera restarts.
Use **Settings → Local Network → Restore closed panels** under the paired computer to show them
again. New host panels still appear automatically.

## Connecting

1. Click **+** and choose **Local PC**, or open **Settings → Local Network**.
2. Enter the other computer's LAN IP address (shown under **Local Network** on that computer) and
   select **Send request**.
3. The other computer shows a **Connection request** prompt with the requester's name, address, and
   device fingerprint. Selecting **Approve** pairs both computers; **Decline** or two minutes of
   silence rejects the request.
4. If Windows Firewall asks, allow Tessera on **Private networks** only.

**Share on local network** is on by default and is what lets a computer receive requests. It is
turned on automatically on the requesting side too, because the two computers reconnect to each
other later. Turning it off stops the listener and disconnects paired computers.

The first connection uses a Noise XX handshake, so both computers learn each other's static public
key before the request is shown. The person approving can compare the fingerprint in the prompt with
the one displayed on the requesting computer. Tessera then stores its private device identity in the
operating-system keychain and pins the other computer's public key. Later connections use a Noise IK
handshake and need no approval, and a computer with the wrong key cannot impersonate a paired device.

## Network boundary

The listener uses the fixed TCP port `43721`. Before any handshake, Tessera verifies that the source
address belongs to one of the computer's directly connected private IPv4 subnets. Outgoing addresses
are checked by the same rule. Tessera does not use its account relay, multicast discovery, UPnP,
port-forwarding, or any external service for this feature.

Connections carry length-bounded, encrypted protocol frames. Remote panels use device-qualified IDs,
which keeps identical panel names and IDs unambiguous. Direct peers are never forwarded through a
third Tessera computer.

## Access granted to a paired computer

A paired computer can list messageable open panels, see their provider/model/status/working-directory
metadata, read up to 100 recent transcript messages or the current terminal screen, and deliver a user message. Delivery goes through
the same local panel bus used inside one Tessera window, including Codex's automatic busy-turn queue.

Pairing does not expose filesystem APIs, shell commands, raw terminal input, session creation or
deletion, interrupts, permission answers, API keys, or CLI credentials. Use **Forget** in Local Network
settings to revoke the pinned device key and remove its subgroup; a forgotten computer has to send a
new request, which is approved again by hand.

## Regression checks

`npm test` covers roster publication and group reconciliation. `tools/test-rust.ps1 -Stable` covers
legacy protocol reads and bidirectional encrypted terminal frames over isolated TCP sockets.
With `npm run dev` running, `node tools/test-lan-panels.mjs` uses independent browser contexts and
real xterm parsers to verify both providers, chat/terminal routing, hidden panels, reconnects, and
old-host errors. Browser tests mock native IPC and do not start agents or touch saved workspaces;
they do not replace a final test between the user's two physical computers.
