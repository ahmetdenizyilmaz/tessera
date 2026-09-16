use snow::{Builder, HandshakeState, TransportState};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::protocol::MAX_FRAME_BYTES;

// First contact: both sides learn each other's static key (XX). The human on
// the receiving computer approves the request before any panel data flows.
const INTRODUCE_PATTERN: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const RECONNECT_PATTERN: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
const NOISE_CHUNK: usize = 60_000;
const TAG_BYTES: usize = 16;

pub fn generate_keypair() -> Result<(Vec<u8>, Vec<u8>), String> {
    let params = INTRODUCE_PATTERN
        .parse()
        .map_err(|e| format!("Noise params: {e}"))?;
    let pair = Builder::new(params)
        .generate_keypair()
        .map_err(|e| format!("Generate LAN identity: {e}"))?;
    Ok((pair.private, pair.public))
}

pub fn introduce_state(initiator: bool, private: &[u8]) -> Result<HandshakeState, String> {
    let params = INTRODUCE_PATTERN
        .parse()
        .map_err(|e| format!("Noise params: {e}"))?;
    let builder = Builder::new(params).local_private_key(private);
    if initiator {
        builder.build_initiator()
    } else {
        builder.build_responder()
    }
    .map_err(|e| format!("Introduction handshake: {e}"))
}

pub fn reconnect_state(
    initiator: bool,
    private: &[u8],
    peer_public: Option<&[u8]>,
) -> Result<HandshakeState, String> {
    let params = RECONNECT_PATTERN
        .parse()
        .map_err(|e| format!("Noise params: {e}"))?;
    let mut builder = Builder::new(params).local_private_key(private);
    if initiator {
        builder = builder.remote_public_key(peer_public.ok_or("Missing peer public key")?);
        builder.build_initiator()
    } else {
        builder.build_responder()
    }
    .map_err(|e| format!("Reconnect handshake: {e}"))
}

pub async fn run_handshake<S>(
    stream: &mut S,
    mut state: HandshakeState,
    initiator: bool,
) -> Result<(TransportState, Vec<u8>), String>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut read_buf = vec![0u8; 65_535];
    let mut write_buf = vec![0u8; 65_535];
    let mut write_turn = initiator;
    while !state.is_handshake_finished() {
        if write_turn {
            write_handshake(stream, &mut state, &mut write_buf).await?;
        } else {
            read_handshake(stream, &mut state, &mut read_buf).await?;
        }
        write_turn = !write_turn;
    }
    let remote = state
        .get_remote_static()
        .ok_or("Peer did not provide a static identity")?
        .to_vec();
    let transport = state
        .into_transport_mode()
        .map_err(|e| format!("Enter encrypted transport: {e}"))?;
    Ok((transport, remote))
}

async fn write_handshake<S: AsyncWrite + Unpin>(
    stream: &mut S,
    state: &mut HandshakeState,
    buf: &mut [u8],
) -> Result<(), String> {
    let n = state
        .write_message(&[], buf)
        .map_err(|e| format!("Handshake write: {e}"))?;
    write_packet(stream, &buf[..n]).await
}

async fn read_handshake<S: AsyncRead + Unpin>(
    stream: &mut S,
    state: &mut HandshakeState,
    buf: &mut [u8],
) -> Result<(), String> {
    let packet = read_packet(stream, 65_535).await?;
    state
        .read_message(&packet, buf)
        .map_err(|e| format!("Handshake read: {e}"))?;
    Ok(())
}

pub fn encrypt_message(
    noise: &mut TransportState,
    plaintext: &[u8],
) -> Result<Vec<Vec<u8>>, String> {
    if plaintext.len() > MAX_FRAME_BYTES {
        return Err("LAN message exceeds the 1 MiB frame limit".into());
    }
    let chunks = if plaintext.is_empty() {
        vec![&[][..]]
    } else {
        plaintext.chunks(NOISE_CHUNK).collect::<Vec<_>>()
    };
    let total = chunks.len().max(1) as u16;
    let mut packets = Vec::with_capacity(total as usize);
    for (index, chunk) in chunks.into_iter().enumerate() {
        let mut body = Vec::with_capacity(chunk.len() + TAG_BYTES + 4);
        body.extend_from_slice(&(index as u16).to_be_bytes());
        body.extend_from_slice(&total.to_be_bytes());
        let start = body.len();
        body.resize(start + chunk.len() + TAG_BYTES, 0);
        let n = noise
            .write_message(chunk, &mut body[start..])
            .map_err(|e| format!("Encrypt LAN frame: {e}"))?;
        body.truncate(start + n);
        packets.push(body);
    }
    Ok(packets)
}

pub async fn write_encrypted_packets<S: AsyncWrite + Unpin>(
    stream: &mut S,
    packets: &[Vec<u8>],
) -> Result<(), String> {
    for packet in packets {
        write_packet(stream, packet).await?;
    }
    Ok(())
}

pub async fn read_encrypted_packets<S: AsyncRead + Unpin>(
    stream: &mut S,
) -> Result<Vec<Vec<u8>>, String> {
    let mut packets = Vec::new();
    let mut expected_total = None;
    let mut expected_index = 0u16;
    loop {
        let packet = read_packet(stream, NOISE_CHUNK + TAG_BYTES + 4).await?;
        if packet.len() < 4 {
            return Err("Malformed encrypted LAN frame".into());
        }
        let index = u16::from_be_bytes([packet[0], packet[1]]);
        let total = u16::from_be_bytes([packet[2], packet[3]]);
        if total == 0 || index != expected_index || expected_total.is_some_and(|v| v != total) {
            return Err("Out-of-order encrypted LAN frame".into());
        }
        expected_total = Some(total);
        packets.push(packet);
        expected_index += 1;
        if expected_index == total {
            return Ok(packets);
        }
    }
}

pub fn decrypt_message(noise: &mut TransportState, packets: &[Vec<u8>]) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    for packet in packets {
        let mut plain = vec![0u8; packet.len()];
        let n = noise
            .read_message(&packet[4..], &mut plain)
            .map_err(|e| format!("Decrypt LAN frame: {e}"))?;
        result.extend_from_slice(&plain[..n]);
        if result.len() > MAX_FRAME_BYTES {
            return Err("LAN message exceeds the 1 MiB frame limit".into());
        }
    }
    Ok(result)
}

async fn write_packet<S: AsyncWrite + Unpin>(stream: &mut S, body: &[u8]) -> Result<(), String> {
    let len = u32::try_from(body.len()).map_err(|_| "LAN packet too large")?;
    stream
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| format!("LAN write: {e}"))?;
    stream
        .write_all(body)
        .await
        .map_err(|e| format!("LAN write: {e}"))?;
    stream.flush().await.map_err(|e| format!("LAN flush: {e}"))
}

async fn read_packet<S: AsyncRead + Unpin>(stream: &mut S, max: usize) -> Result<Vec<u8>, String> {
    let mut len = [0u8; 4];
    stream
        .read_exact(&mut len)
        .await
        .map_err(|e| format!("LAN read: {e}"))?;
    let len = u32::from_be_bytes(len) as usize;
    if len == 0 || len > max {
        return Err(format!("Invalid LAN packet length: {len}"));
    }
    let mut body = vec![0u8; len];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|e| format!("LAN read: {e}"))?;
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn introduction_exchanges_static_keys_and_encrypts_large_frames() {
        let (a_private, a_public) = generate_keypair().unwrap();
        let (b_private, b_public) = generate_keypair().unwrap();
        let (mut a_io, mut b_io) = tokio::io::duplex(2 * 1024 * 1024);
        let (a_result, b_result) = tokio::join!(
            run_handshake(&mut a_io, introduce_state(true, &a_private).unwrap(), true),
            run_handshake(&mut b_io, introduce_state(false, &b_private).unwrap(), false),
        );
        let (mut a_noise, seen_b) = a_result.unwrap();
        let (mut b_noise, seen_a) = b_result.unwrap();
        assert_eq!(seen_a, a_public);
        assert_eq!(seen_b, b_public);

        let original = vec![0x5a; 150_000];
        let packets = encrypt_message(&mut a_noise, &original).unwrap();
        assert!(packets.len() > 1);
        assert_eq!(decrypt_message(&mut b_noise, &packets).unwrap(), original);
        assert!(encrypt_message(&mut a_noise, &vec![0; MAX_FRAME_BYTES + 1]).is_err());
    }

    #[tokio::test]
    async fn reconnect_uses_the_pinned_responder_key() {
        let (a_private, a_public) = generate_keypair().unwrap();
        let (b_private, b_public) = generate_keypair().unwrap();
        let (mut a_io, mut b_io) = tokio::io::duplex(65_536);
        let (a_result, b_result) = tokio::join!(
            run_handshake(
                &mut a_io,
                reconnect_state(true, &a_private, Some(&b_public)).unwrap(),
                true
            ),
            run_handshake(
                &mut b_io,
                reconnect_state(false, &b_private, None).unwrap(),
                false
            ),
        );
        assert_eq!(a_result.unwrap().1, b_public);
        assert_eq!(b_result.unwrap().1, a_public);
    }
}
