//! A disposable first-contact peer for checking a real incoming approval UI.
//! No saved identity, panel reads or terminal input. Run with a private IP:port
//! and decline "Tessera LAN self-test" in the host's approval prompt.
#![allow(dead_code)]
#[path = "../src/lan/protocol.rs"] mod protocol;
#[path = "../src/lan/transport.rs"] mod transport;
#[path = "../src/lan/network.rs"] mod network;
use protocol::{NodeInfo, WireMessage};
use sha2::{Digest, Sha256};
use std::{net::SocketAddr, time::Duration};
use tokio::io::AsyncWriteExt;

#[tokio::main]
async fn main() -> Result<(), String> {
    let address: SocketAddr = std::env::args().nth(1).ok_or("Pass the host's private IP:port")?
        .parse().map_err(|_| "Invalid address")?;
    if !matches!(address.ip(), std::net::IpAddr::V4(ip) if ip.is_private()) {
        return Err("This diagnostic only connects to private IPv4 addresses".into());
    }
    let (private, public) = transport::generate_keypair()?;
    let mut stream = tokio::time::timeout(Duration::from_secs(5), network::connect(address)).await
        .map_err(|_| "Connect timed out")?.map_err(|e| e.to_string())?;
    stream.write_all(b"TESSLAN2\x01").await.map_err(|e| e.to_string())?;
    let (mut noise, _) = tokio::time::timeout(Duration::from_secs(10),
        transport::run_handshake(&mut stream, transport::introduce_state(true, &private)?, true))
        .await.map_err(|_| "Handshake timed out")??;
    let hello = WireMessage::Hello { node: NodeInfo {
        device_id: Sha256::digest(&public)[..16].iter().map(|b| format!("{b:02x}")).collect(),
        name: "Tessera LAN self-test".into(), protocol_version: protocol::PROTOCOL_VERSION,
        listen_port: protocol::DEFAULT_PORT,
    }};
    let packets = transport::encrypt_message(&mut noise, &serde_json::to_vec(&hello).unwrap())?;
    transport::write_encrypted_packets(&mut stream, &packets).await?;
    let mut identified = false;
    loop {
        let packets = tokio::time::timeout(Duration::from_secs(125), transport::read_encrypted_packets(&mut stream))
            .await.map_err(|_| "Approval timed out")??;
        let data = transport::decrypt_message(&mut noise, &packets)?;
        match serde_json::from_slice::<WireMessage>(&data).map_err(|e| e.to_string())? {
            WireMessage::Hello { .. } => { identified = true; println!("Encrypted handshake complete; decline Tessera LAN self-test in the host UI."); }
            WireMessage::PairDecision { accepted: false, .. } if identified => {
                println!("PASS encrypted request reached the host; explicit decline received. No panels were accessed.");
                return Ok(());
            }
            WireMessage::PairDecision { accepted: true, .. } => return Err("Diagnostic was approved; forget Tessera LAN self-test in Local Network settings. No panels were accessed.".into()),
            _ => return Err("Unexpected message before approval".into()),
        }
    }
}
