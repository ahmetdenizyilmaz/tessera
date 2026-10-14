//! A bounded, dedicated Windows media worker. No media operation runs on the UI
//! thread and HTML apps never receive a shell/WinRT handle or arbitrary command.
use serde_json::{json, Value};
use std::time::{Duration, Instant};

type AccessCheck = Box<dyn Fn() -> bool + Send>;

fn validate(method: &str, params: &Value) -> Result<(), String> {
    if let Some(id) = params["sessionId"].as_str() {
        if uuid::Uuid::parse_str(id).is_err() { return Err("Choose an available media player".into()); }
    } else if !params["sessionId"].is_null() || method == "media.control" {
        return Err("Choose an available media player".into());
    }
    if method == "media.control" {
        if !["play", "pause", "toggle", "next", "previous", "seek"].contains(&params["action"].as_str().unwrap_or("")) {
            return Err("Unknown media control".into());
        }
        if params["action"] == "seek" && !params["position"].as_f64().is_some_and(|p|p.is_finite() && (0.0..=604800.0).contains(&p)) {
            return Err("Invalid playback position".into());
        }
    }
    Ok(())
}

pub async fn request(method: &str, params: Value, access: AccessCheck) -> Result<Value, String> {
    validate(method, &params)?;
    #[cfg(not(windows))] {
        let _ = (params, access);
        if method == "media.snapshot" { return Ok(json!({"supported":false,"sessions":[],"current":null})); }
        Err("Desktop media controls are currently available on Windows".into())
    }
    #[cfg(windows)] {
        use std::sync::{mpsc, OnceLock};
        struct Request { method: String, params: Value, access: AccessCheck, expires: Instant, reply: tokio::sync::oneshot::Sender<Result<Value,String>> }
        static QUEUE: OnceLock<mpsc::SyncSender<Request>> = OnceLock::new();
        let queue = QUEUE.get_or_init(|| {
            let (sender, receiver) = mpsc::sync_channel::<Request>(8);
            std::thread::spawn(move || {
                let initialized = unsafe { windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED) };
                let mut worker = native::Worker::default();
                while let Ok(req) = receiver.recv() {
                    if req.reply.is_closed() || req.expires < Instant::now() { continue; }
                    let result = if initialized.is_err() { Err("Windows media controls could not initialize".into()) }
                        else if !(req.access)() { Err("Media access was revoked".into()) }
                        else { worker.call(&req.method, &req.params).map_err(|e|format!("Media player unavailable: {e}")) };
                    let _ = req.reply.send(result);
                }
                if initialized.is_ok() { unsafe { windows::Win32::System::WinRT::RoUninitialize(); } }
            });
            sender
        });
        let (reply, receive) = tokio::sync::oneshot::channel();
        queue.try_send(Request { method:method.into(), params, access, expires:Instant::now()+Duration::from_secs(6), reply })
            .map_err(|_|"Media player is busy. Try again shortly.".to_string())?;
        tokio::time::timeout(Duration::from_secs(7), receive).await.map_err(|_|"Media player did not respond. Try again shortly.")?
            .map_err(|_|"Media controller stopped".to_string())?
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use base64::Engine;
    use windows::Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status};
    use windows::Storage::Streams::{Buffer, DataReader, InputStreamOptions};

    #[derive(Default)]
    pub struct Worker {
        manager: Option<Manager>,
        sessions: Vec<(String, Session)>,
        // Cache only artwork; the live playback state remains current.
        artwork: std::collections::HashMap<String, (String, Option<String>, Instant)>,
    }
    impl Worker {
        fn refresh(&mut self) -> windows::core::Result<Option<Session>> {
            if self.manager.is_none() { self.manager = Some(Manager::RequestAsync()?.get()?); }
            let manager = self.manager.as_ref().unwrap();
            let list = manager.GetSessions()?;
            let mut sessions = Vec::new();
            for index in 0..list.Size()?.min(32) {
                let session = list.GetAt(index)?;
                let id = self.sessions.iter().find(|(_,old)|old==&session).map(|(id,_)|id.clone()).unwrap_or_else(||uuid::Uuid::new_v4().to_string());
                sessions.push((id,session));
            }
            self.artwork.retain(|id,_|sessions.iter().any(|(s,_)|s==id));
            self.sessions = sessions;
            Ok(manager.GetCurrentSession().ok())
        }
        pub fn call(&mut self, method: &str, params: &Value) -> windows::core::Result<Value> {
            let current = self.refresh()?;
            if method == "media.control" {
                let selected = self.sessions.iter().find(|(id,_)|Some(id.as_str())==params["sessionId"].as_str());
                let Some((_,session)) = selected else { return Ok(json!({"accepted":false,"reason":"That player has closed. Choose another player."})); };
                let controls = session.GetPlaybackInfo()?.Controls()?;
                let action = params["action"].as_str().unwrap_or("");
                let accepted = match action {
                    "play" if controls.IsPlayEnabled()? => session.TryPlayAsync()?.get()?,
                    "pause" if controls.IsPauseEnabled()? => session.TryPauseAsync()?.get()?,
                    "toggle" if controls.IsPlayPauseToggleEnabled()? => session.TryTogglePlayPauseAsync()?.get()?,
                    "next" if controls.IsNextEnabled()? => session.TrySkipNextAsync()?.get()?,
                    "previous" if controls.IsPreviousEnabled()? => session.TrySkipPreviousAsync()?.get()?,
                    "seek" if controls.IsPlaybackPositionEnabled()? => {
                        let timeline=session.GetTimelineProperties()?;
                        let start=timeline.StartTime()?.Duration; let end=timeline.EndTime()?.Duration;
                        let requested=start.saturating_add((params["position"].as_f64().unwrap_or(0.0)*10_000_000.0) as i64);
                        if end>start {session.TryChangePlaybackPositionAsync(requested.clamp(start,end))?.get()?} else {false}
                    },
                    _ => false,
                };
                return Ok(json!({"accepted":accepted,"reason":if accepted {""} else {"This player does not support that control right now."}}));
            }
            // A pinned player never silently switches to another app.
            let chosen = if let Some(id)=params["sessionId"].as_str() { self.sessions.iter().find(|(s,_)|s==id) }
                else {self.sessions.iter().find(|(_,s)|Some(s)==current.as_ref()).or_else(||self.sessions.first())}.map(|(id,_)|id.clone());
            let mut rows=Vec::new(); let mut detail=Value::Null;
            for (id,session) in &self.sessions {
                let Ok(source)=session.SourceAppUserModelId() else {continue;};
                let source=source.to_string();
                let properties=session.TryGetMediaPropertiesAsync().and_then(|op|op.get());
                let Ok(properties)=properties else {continue;};
                let title=properties.Title()?.to_string(); let artist=properties.Artist()?.to_string();
                let Ok(info)=session.GetPlaybackInfo() else {continue;}; let playing=info.PlaybackStatus()?==Status::Playing;
                rows.push(json!({"id":id,"source":source,"title":title,"artist":artist,"playing":playing}));
                if chosen.as_ref()!=Some(id) {continue;}
                let controls=info.Controls()?; let timeline=session.GetTimelineProperties()?;
                let start=timeline.StartTime()?.Duration;
                let duration=((timeline.EndTime()?.Duration-start).max(0) as f64/10_000_000.0).min(604800.0);
                let mut position=(timeline.Position()?.Duration-start).max(0) as f64/10_000_000.0;
                if playing {
                    // Windows publishes a position and timestamp, not a ticking counter.
                    if let (Ok(updated),Ok(now))=(timeline.LastUpdatedTime(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)) {
                        let updated=updated.UniversalTime as f64/10_000_000.0-11_644_473_600.0;
                        let rate=info.PlaybackRate().and_then(|rate|rate.Value()).unwrap_or(1.0);
                        if updated>0.0 && rate.is_finite() {position+=(now.as_secs_f64()-updated).max(0.0)*rate.clamp(0.0,16.0);}
                    }
                }
                let position=position.min(duration);
                let track_key=format!("{}\u{0}{}\u{0}{}",title,artist,properties.AlbumTitle()?.to_string());
                if !self.artwork.get(id).is_some_and(|(key,data,checked)|key==&track_key && (data.is_some() || checked.elapsed()<Duration::from_secs(15))) {
                    let data=artwork(&properties).ok().flatten();
                    self.artwork.insert(id.clone(),(track_key.clone(),data,Instant::now()));
                }
                use sha2::{Digest, Sha256};
                let data=self.artwork.get(id).and_then(|(_,data,_)|data.as_ref());
                let art_key=format!("{id}-{:x}-{}",Sha256::digest(track_key.as_bytes()),u8::from(data.is_some()));
                detail=json!({"id":id,"source":source,"title":title,"artist":artist,"album":properties.AlbumTitle()?.to_string(),"playing":playing,
                    "position":position,"duration":duration,"artworkKey":art_key,
                    "controls":{"play":controls.IsPlayEnabled()?,"pause":controls.IsPauseEnabled()?,"toggle":controls.IsPlayPauseToggleEnabled()?,"next":controls.IsNextEnabled()?,"previous":controls.IsPreviousEnabled()?,"seek":controls.IsPlaybackPositionEnabled()?}});
                if params["artworkKey"].as_str()!=Some(&art_key) {detail["artwork"]=json!(data);}
            }
            Ok(json!({"supported":true,"sessions":rows,"current":detail}))
        }
    }
    fn artwork(properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Result<Option<String>,Box<dyn std::error::Error>> {
        let Ok(reference)=properties.Thumbnail() else {return Ok(None);};
        let stream=reference.OpenReadAsync()?.get()?;
        let size=stream.Size()?;
        if size==0 || size>4*1024*1024 {return Ok(None);}
        let buffer=stream.ReadAsync(&Buffer::Create(size as u32)?,size as u32,InputStreamOptions::None)?.get()?;
        let reader=DataReader::FromBuffer(&buffer)?; let mut bytes=vec![0;buffer.Length()? as usize];reader.ReadBytes(&mut bytes)?;
        let mut image_reader=image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
        let mut limits=image::Limits::default();limits.max_image_width=Some(4096);limits.max_image_height=Some(4096);limits.max_alloc=Some(64*1024*1024);image_reader.limits(limits);
        let image=image_reader.decode()?.thumbnail(384,384).to_rgb8();
        let mut jpeg=Vec::new();image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg,85).encode_image(&image)?;
        Ok(Some(format!("data:image/jpeg;base64,{}",base64::engine::general_purpose::STANDARD.encode(jpeg))))
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn controls_are_explicit_and_bounded() {
        let id=uuid::Uuid::new_v4().to_string();
        assert!(validate("media.snapshot",&json!({})).is_ok());
        assert!(validate("media.control",&json!({"action":"next"})).is_err());
        assert!(validate("media.control",&json!({"sessionId":id,"action":"next"})).is_ok());
        for action in ["shell","volume","launch"] {assert!(validate("media.control",&json!({"sessionId":id,"action":action})).is_err());}
        for position in [-1.,604801.] {assert!(validate("media.control",&json!({"sessionId":id,"action":"seek","position":position})).is_err());}
    }
}
