//! Test-only media session. No user's player is controlled and no sound plays.
use serde_json::{json,Value};
use std::sync::{Arc,Mutex};
use windows::{Foundation::TypedEventHandler, Media::{Playback::MediaPlayer, MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs, PlaybackPositionChangeRequestedEventArgs, SystemMediaTransportControlsTimelineProperties}, Storage::{StorageFile,Streams::RandomAccessStreamReference}};

pub struct Fixture { player:MediaPlayer, controls:SystemMediaTransportControls, events:Arc<Mutex<Vec<String>>>, folder:std::path::PathBuf }
#[derive(Default)] pub struct State(pub Mutex<Option<Fixture>>);
fn timeline(controls:&SystemMediaTransportControls,seconds:i64)->windows::core::Result<()> {
    let timeline=SystemMediaTransportControlsTimelineProperties::new()?;
    timeline.SetStartTime(windows::Foundation::TimeSpan{Duration:0})?;
    timeline.SetEndTime(windows::Foundation::TimeSpan{Duration:180*10_000_000})?;
    timeline.SetMinSeekTime(windows::Foundation::TimeSpan{Duration:0})?;
    timeline.SetMaxSeekTime(windows::Foundation::TimeSpan{Duration:180*10_000_000})?;
    timeline.SetPosition(windows::Foundation::TimeSpan{Duration:seconds*10_000_000})?;
    controls.UpdateTimelineProperties(&timeline)
}
fn start()->Result<Fixture,Box<dyn std::error::Error>> {
    let player=MediaPlayer::new()?;player.SetIsMuted(true)?;player.CommandManager()?.SetIsEnabled(false)?;
    let controls=player.SystemMediaTransportControls()?;
    controls.SetIsEnabled(true)?;controls.SetIsPlayEnabled(true)?;controls.SetIsPauseEnabled(true)?;controls.SetIsNextEnabled(true)?;controls.SetIsPreviousEnabled(true)?;
    let update=controls.DisplayUpdater()?;update.SetType(MediaPlaybackType::Music)?;
    update.MusicProperties()?.SetTitle(&"Tessera validation track".into())?;update.MusicProperties()?.SetArtist(&"Synthetic player".into())?;
    let folder=std::env::temp_dir().join(format!("tessera-music-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&folder)?;
    let image=folder.join("cover.png");image::RgbImage::from_pixel(40,40,image::Rgb([96,168,128])).save(&image)?;
    let file=StorageFile::GetFileFromPathAsync(&image.to_string_lossy().as_ref().into())?.get()?;
    update.SetThumbnail(&RandomAccessStreamReference::CreateFromFile(&file)?)?;update.Update()?;
    timeline(&controls,25)?;controls.SetPlaybackStatus(MediaPlaybackStatus::Playing)?;
    let events=Arc::new(Mutex::new(Vec::new()));let log=events.clone();
    controls.ButtonPressed(&TypedEventHandler::<SystemMediaTransportControls,SystemMediaTransportControlsButtonPressedEventArgs>::new(move|sender,args|{
        if let (Some(sender),Some(args))=(sender.as_ref(),args.as_ref()) {
            let button=args.Button()?;
            let action=match button {SystemMediaTransportControlsButton::Play=>"play",SystemMediaTransportControlsButton::Pause=>"pause",SystemMediaTransportControlsButton::Next=>"next",SystemMediaTransportControlsButton::Previous=>"previous",_=>"other"};
            log.lock().unwrap().push(action.into());
            if action=="play" {sender.SetPlaybackStatus(MediaPlaybackStatus::Playing)?;}if action=="pause" {sender.SetPlaybackStatus(MediaPlaybackStatus::Paused)?;}
        }Ok(())
    }))?;
    let log=events.clone();
    controls.PlaybackPositionChangeRequested(&TypedEventHandler::<SystemMediaTransportControls,PlaybackPositionChangeRequestedEventArgs>::new(move|sender,args|{
        if let (Some(sender),Some(args))=(sender.as_ref(),args.as_ref()) {let seconds=args.RequestedPlaybackPosition()?.Duration/10_000_000;log.lock().unwrap().push(format!("seek:{seconds}"));timeline(sender,seconds)?;}Ok(())
    }))?;
    Ok(Fixture{player,controls,events,folder})
}
impl Drop for Fixture {fn drop(&mut self){let _=self.controls.SetIsEnabled(false);let _=self.player.Close();let _=std::fs::remove_file(self.folder.join("cover.png"));let _=std::fs::remove_dir(&self.folder);}}
#[tauri::command]
pub async fn validation_media(action:String,state:tauri::State<'_,State>)->Result<Value,String>{
    let mut state=state.0.lock().unwrap();
    match action.as_str(){"start"=>{*state=Some(start().map_err(|e|e.to_string())?);Ok(json!(true))},"stop"=>{*state=None;Ok(json!(true))},"events"=>Ok(json!(state.as_ref().map(|s|s.events.lock().unwrap().clone()).unwrap_or_default())),_=>Err("Unknown fixture action".into())}
}
