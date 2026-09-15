# LAN remote subgroups

Tessera can pair directly with another Tessera installation on the same private IPv4 subnet. Each
computer appears in the other's workspace as a group containing its currently open Claude and Codex
panels. The agents continue to run on the computer that owns them; only panel metadata, recent
conversation reads, and message delivery cross the connection.

## Pairing

1. Open **Settings → Local Network** on both computers and enable **Share on local network**.
2. On the host, generate a one-time pairing code and copy one of the displayed LAN addresses.
3. Enter that address and code on the other computer and select **Pair**.
4. If Windows Firewall asks, allow Tessera on **Private networks** only.

The code contains 128 random bits, expires after five minutes, and works once. The first connection
uses a Noise XX handshake authenticated by that code. Tessera then stores its private device identity
in the operating-system keychain and pins the other computer's public key. Later connections use a
Noise IK handshake, so a computer with the wrong key cannot impersonate a paired device.

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
metadata, read up to 100 recent transcript messages, and deliver a user message. Delivery goes through
the same local panel bus used inside one Tessera window, including Codex's automatic busy-turn queue.

Pairing does not expose filesystem APIs, shell commands, raw terminal input, session creation or
deletion, interrupts, permission answers, API keys, or CLI credentials. Use **Forget** in Local Network
settings to revoke the pinned device key and remove its subgroup.
