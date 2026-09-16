# LAN remote subgroups

Tessera can pair directly with another Tessera installation on the same private IPv4 subnet. Each
computer appears in the other's workspace as a group containing its currently open Claude and Codex
panels. The agents continue to run on the computer that owns them; only panel metadata, recent
conversation reads, and message delivery cross the connection.

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
metadata, read up to 100 recent transcript messages, and deliver a user message. Delivery goes through
the same local panel bus used inside one Tessera window, including Codex's automatic busy-turn queue.

Pairing does not expose filesystem APIs, shell commands, raw terminal input, session creation or
deletion, interrupts, permission answers, API keys, or CLI credentials. Use **Forget** in Local Network
settings to revoke the pinned device key and remove its subgroup; a forgotten computer has to send a
new request, which is approved again by hand.
