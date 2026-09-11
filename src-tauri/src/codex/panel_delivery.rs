//! FIFO delivery into a busy Codex conversation. The worker belongs to one
//! app-server lifetime, so closing/restarting a panel cancels its queued turns.
use super::rpc::{Client, Reply};
use serde_json::json;
use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

struct Message {
    text: String,
    receipt: oneshot::Sender<Reply>,
    pending: Pending,
}

struct Pending(Arc<AtomicUsize>);
impl Drop for Pending {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::AcqRel); }
}

#[derive(Clone)]
pub(super) struct PanelDelivery {
    tx: mpsc::UnboundedSender<Message>,
    pending: Arc<AtomicUsize>,
}

impl PanelDelivery {
    pub fn new(client: Arc<Client>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        tokio::spawn(async move {
            while let Some(message) = rx.recv().await {
                let result = loop {
                    if !client.alive.load(Ordering::Acquire) {
                        break Err("Codex panel closed before its queued message was delivered".into());
                    }
                    if client.busy.load(Ordering::Acquire) || !client.requests.lock().unwrap().is_empty() {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    let result = super::send_to_client(&client, &message.text, vec![], None, None).await;
                    // Only retry a rejection BEFORE turn/start. A GUI/native
                    // turn may win the idle check; never retry an ambiguous RPC.
                    if matches!(&result, Err(e) if e == super::BUSY_ERROR || e == super::PENDING_REQUEST_ERROR) {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    break result;
                };
                if let Err(error) = &result {
                    client.publish(json!({"method":"tessera/error","params":{
                        "message":format!("Panel message delivery failed: {error}")
                    }}));
                }
                let _ = message.receipt.send(result);
                drop(message.pending);
            }
        });
        Self { tx, pending: Arc::new(AtomicUsize::new(0)) }
    }

    pub fn pending(&self) -> usize { self.pending.load(Ordering::Acquire) }

    pub fn enqueue(&self, text: String) -> Result<oneshot::Receiver<Reply>, String> {
        let (receipt, result) = oneshot::channel();
        self.pending.fetch_add(1, Ordering::AcqRel);
        self.tx.send(Message { text, receipt, pending: Pending(self.pending.clone()) })
            .map_err(|_| "Codex panel delivery queue has closed".to_string())?;
        Ok(result)
    }
}
