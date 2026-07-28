// Shared WebSocket type aliases for relay client
// The actual types are used directly in relay::client to avoid dependency issues.

pub type SharedFlag = std::sync::Arc<std::sync::atomic::AtomicBool>;
