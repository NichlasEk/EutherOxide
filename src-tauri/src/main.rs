use std::collections::VecDeque;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use std::env;

use euther_oxide::savestate::{ArgonSummary, SlotSummary};
use euther_oxide::{Emulator, FrameRun, RomHeader, SystemRegion, TimingMode};
use gilrs::{Axis, Button, Gilrs};
use serde::Serialize;
use tauri::{Manager, State, ipc::Response};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

#[derive(Clone)]
struct AppState {
    emulator: Arc<Mutex<Option<Emulator>>>,
    eutherdogs: Arc<Mutex<euther_oxide::eutherdogs::EutherDogsRuntime>>,
    bridge_url: Arc<Mutex<String>>,
    native_surface_rect: Arc<Mutex<Option<NativeSurfaceRect>>>,
    native_frame: Arc<Mutex<Option<NativeFrameImage>>>,
    native_status: Arc<Mutex<Option<NativeFrameResult>>>,
    native_running: Arc<AtomicBool>,
    native_audio_volume: Arc<AtomicU32>,
    native_audio: Arc<Mutex<Option<mpsc::Sender<AudioCommand>>>>,
    gamepads: Arc<Mutex<GamepadReader>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            emulator: Arc::default(),
            eutherdogs: Arc::new(Mutex::new(euther_oxide::eutherdogs::EutherDogsRuntime::demo())),
            bridge_url: Arc::default(),
            native_surface_rect: Arc::default(),
            native_frame: Arc::default(),
            native_status: Arc::default(),
            native_running: Arc::default(),
            native_audio_volume: Arc::new(AtomicU32::new(1000)),
            native_audio: Arc::default(),
            gamepads: Arc::new(Mutex::new(GamepadReader::new())),
        }
    }
}

struct GamepadReader {
    gilrs: Option<Gilrs>,
    error: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct NativeSurfaceRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Clone)]
struct NativeFrameImage {
    width: usize,
    height: usize,
    bgra: Vec<u8>,
}

struct NativeAudio {
    queue: Arc<Mutex<VecDeque<f32>>>,
    _volume: Arc<AtomicU32>,
    _stream: cpal::Stream,
    sample_rate: u32,
    primed: bool,
}

enum AudioCommand {
    Push {
        samples: Vec<i16>,
        sample_rate: u32,
        response: mpsc::Sender<NativeAudioResult>,
    },
    PushAsync {
        samples: Vec<i16>,
        sample_rate: u32,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeAudioResult {
    active: bool,
    queued_ms: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeFrameResult {
    frame: u64,
    width: usize,
    height: usize,
    frame_rate: f64,
    cpu_cycles: u64,
    cpu_steps: u64,
    frame_ms: f64,
    stopped: bool,
    last_error: Option<String>,
    audio_active: bool,
    audio_lead_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadResult {
    title: String,
    region: String,
    timing: String,
    reset_pc: u32,
    width: usize,
    height: usize,
    state_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameResult {
    frame: u64,
    width: usize,
    height: usize,
    rgba: Vec<u8>,
    cpu_cycles: u64,
    cpu_steps: u64,
    frame_ms: f64,
    stopped: bool,
    last_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioResult {
    frame: u64,
    sample_rate: usize,
    samples: Vec<i16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateSlotsResult {
    path: Option<String>,
    slots: Vec<StateSlotResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateSlotResult {
    slot: usize,
    occupied: bool,
    created_unix_ms: Option<u64>,
    frame_count: Option<u64>,
    label: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadStateResult {
    frame: FrameResult,
    states: StateSlotsResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GamepadSnapshot {
    available: bool,
    error: Option<String>,
    gamepads: Vec<GamepadDevice>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GamepadDevice {
    id: String,
    name: String,
    controls: Vec<GamepadControl>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GamepadControl {
    id: String,
    label: String,
    pressed: bool,
    value: Option<f32>,
    kind: &'static str,
    direction: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RomDirSetting {
    rom_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RomDirListing {
    rom_dir: Option<String>,
    path: String,
    parent: Option<String>,
    entries: Vec<RomDirEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RomDirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputState {
    up: bool,
    down: bool,
    left: bool,
    right: bool,
    a: bool,
    b: bool,
    c: bool,
    start: bool,
}

#[tauri::command]
fn load_rom_bytes(state: State<'_, AppState>, bytes: Vec<u8>) -> Result<LoadResult, String> {
    if bytes.is_empty() {
        return Err("ROM buffer is empty".to_string());
    }

    let mut emulator = Emulator::new();
    emulator.load_rom_bytes(&bytes);
    let result = load_result(&emulator);

    state.native_running.store(false, Ordering::Release);
    *state.emulator.lock().map_err(|err| err.to_string())? = Some(emulator);
    *state.native_status.lock().map_err(|err| err.to_string())? = None;
    *state.native_frame.lock().map_err(|err| err.to_string())? = None;
    Ok(result)
}

#[tauri::command]
fn load_rom_path(state: State<'_, AppState>, path: String) -> Result<LoadResult, String> {
    let mut emulator = Emulator::new();
    emulator
        .load_rom_file(&path)
        .map_err(|err| format!("Could not load ROM: {err}"))?;
    let result = load_result(&emulator);

    state.native_running.store(false, Ordering::Release);
    *state.emulator.lock().map_err(|err| err.to_string())? = Some(emulator);
    *state.native_status.lock().map_err(|err| err.to_string())? = None;
    *state.native_frame.lock().map_err(|err| err.to_string())? = None;
    Ok(result)
}

#[tauri::command]
fn get_rom_dir() -> Result<RomDirSetting, String> {
    Ok(RomDirSetting {
        rom_dir: read_rom_dir_setting().map_err(|err| err.to_string())?,
    })
}

#[tauri::command]
fn set_rom_dir(path: String) -> Result<RomDirSetting, String> {
    let canonical = validate_rom_root(path.trim()).map_err(|err| err.to_string())?;
    write_rom_dir_setting(&canonical).map_err(|err| err.to_string())?;
    Ok(RomDirSetting {
        rom_dir: Some(canonical.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn list_rom_dir(relative_path: String) -> Result<RomDirListing, String> {
    list_rom_dir_inner(&relative_path).map_err(|err| err.to_string())
}

#[tauri::command]
fn load_rom_from_dir(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<LoadResult, String> {
    let path = resolve_rom_file_path(&relative_path).map_err(|err| err.to_string())?;
    load_rom_path(state, path.to_string_lossy().to_string())
}

#[tauri::command]
fn run_frame(state: State<'_, AppState>) -> Result<FrameResult, String> {
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    let run = emulator.run_frame();
    Ok(frame_result(emulator, Some(&run)))
}

#[tauri::command]
fn run_frame_audio_packet(state: State<'_, AppState>) -> Result<Response, String> {
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    let run = emulator.run_frame();
    Ok(Response::new(frame_audio_packet(emulator, &run, 44_100)))
}

#[tauri::command]
fn run_native_frame(state: State<'_, AppState>) -> Result<NativeFrameResult, String> {
    tick_native_frame(&state)
}

#[tauri::command]
fn set_native_running(state: State<'_, AppState>, running: bool) -> Result<(), String> {
    state.native_running.store(running, Ordering::Release);
    Ok(())
}

#[tauri::command]
fn native_frame_status(state: State<'_, AppState>) -> Result<Option<NativeFrameResult>, String> {
    Ok(state
        .native_status
        .lock()
        .map_err(|err| err.to_string())?
        .clone())
}

fn tick_native_frame(state: &AppState) -> Result<NativeFrameResult, String> {
    let (mut result, samples, image) = {
        let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
        let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
        let run = emulator.run_frame();
        let result = native_frame_result(emulator, &run);
        let samples = emulator.render_audio_frame_i16(44_100);
        let image = native_frame_image(emulator);
        (result, samples, image)
    };
    *state.native_frame.lock().map_err(|err| err.to_string())? = Some(image);
    result.audio_active = queue_native_audio_async(&state, samples, 44_100);
    result.audio_lead_ms = 0.0;
    if let Ok(mut status) = state.native_status.lock() {
        *status = Some(result.clone());
    }
    Ok(result)
}

#[tauri::command]
fn native_bridge_url(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state
        .bridge_url
        .lock()
        .map_err(|err| err.to_string())?
        .clone())
}

#[tauri::command]
fn render_audio_frame(state: State<'_, AppState>) -> Result<AudioResult, String> {
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    Ok(AudioResult {
        frame: emulator.frame_count,
        sample_rate: 44_100,
        samples: emulator.render_audio_frame_i16(44_100),
    })
}

#[tauri::command]
fn set_native_surface_rect(
    state: State<'_, AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let rect = NativeSurfaceRect {
        x: x.round().max(0.0) as i32,
        y: y.round().max(0.0) as i32,
        width: width.round().max(1.0) as i32,
        height: height.round().max(1.0) as i32,
    };
    *state
        .native_surface_rect
        .lock()
        .map_err(|err| err.to_string())? = Some(rect);
    Ok(())
}

#[tauri::command]
fn play_native_audio(
    state: State<'_, AppState>,
    samples: Vec<i16>,
    sample_rate: usize,
) -> Result<NativeAudioResult, String> {
    Ok(queue_native_audio(
        &state,
        samples,
        sample_rate.max(1) as u32,
    ))
}

#[tauri::command]
fn set_audio_volume(state: State<'_, AppState>, volume: f32) {
    let volume = volume.clamp(0.0, 1.0);
    state
        .native_audio_volume
        .store((volume * 1000.0).round() as u32, Ordering::Release);
}

fn queue_native_audio(state: &AppState, samples: Vec<i16>, sample_rate: u32) -> NativeAudioResult {
    let sender = {
        let mut guard = match state.native_audio.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return NativeAudioResult {
                    active: false,
                    queued_ms: 0.0,
                };
            }
        };
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => {
                let sender = start_native_audio_thread(state.native_audio_volume.clone());
                *guard = Some(sender.clone());
                sender
            }
        }
    };

    let (response, receiver) = mpsc::channel();
    let command = AudioCommand::Push {
        samples,
        sample_rate: sample_rate.max(1),
        response,
    };

    if let Err(err) = sender.send(command) {
        let sender = start_native_audio_thread(state.native_audio_volume.clone());
        if let Ok(mut guard) = state.native_audio.lock() {
            *guard = Some(sender.clone());
        }
        let (response, receiver) = mpsc::channel();
        let (samples, sample_rate) = match err.0 {
            AudioCommand::Push {
                samples,
                sample_rate,
                ..
            } => (samples, sample_rate),
            AudioCommand::PushAsync {
                samples,
                sample_rate,
            } => (samples, sample_rate),
        };
        sender
            .send(AudioCommand::Push {
                samples,
                sample_rate,
                response,
            })
            .ok();
        return receiver
            .recv_timeout(Duration::from_millis(80))
            .unwrap_or(NativeAudioResult {
                active: false,
                queued_ms: 0.0,
            });
    }

    receiver
        .recv_timeout(Duration::from_millis(80))
        .unwrap_or(NativeAudioResult {
            active: false,
            queued_ms: 0.0,
        })
}

fn native_audio_sender(state: &AppState) -> Option<mpsc::Sender<AudioCommand>> {
    let mut guard = state.native_audio.lock().ok()?;
    Some(match guard.as_ref() {
        Some(sender) => sender.clone(),
        None => {
            let sender = start_native_audio_thread(state.native_audio_volume.clone());
            *guard = Some(sender.clone());
            sender
        }
    })
}

fn queue_native_audio_async(state: &AppState, samples: Vec<i16>, sample_rate: u32) -> bool {
    let Some(sender) = native_audio_sender(state) else {
        return false;
    };
    let command = AudioCommand::PushAsync {
        samples,
        sample_rate: sample_rate.max(1),
    };
    let Err(err) = sender.send(command) else {
        return true;
    };

    let sender = start_native_audio_thread(state.native_audio_volume.clone());
    if let Ok(mut guard) = state.native_audio.lock() {
        *guard = Some(sender.clone());
    }
    sender.send(err.0).is_ok()
}

#[tauri::command]
fn reset_emulator(state: State<'_, AppState>) -> Result<(), String> {
    state.native_running.store(false, Ordering::Release);
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    emulator.reset();
    *state.native_status.lock().map_err(|err| err.to_string())? = None;
    *state.native_frame.lock().map_err(|err| err.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn set_input(state: State<'_, AppState>, input: InputState) -> Result<(), String> {
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    let pad = &mut emulator.bus.controller_a;
    pad.set_pressed(euther_oxide::controller::Controller::UP, input.up);
    pad.set_pressed(euther_oxide::controller::Controller::DOWN, input.down);
    pad.set_pressed(euther_oxide::controller::Controller::LEFT, input.left);
    pad.set_pressed(euther_oxide::controller::Controller::RIGHT, input.right);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_A, input.a);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_B, input.b);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_C, input.c);
    pad.set_pressed(euther_oxide::controller::Controller::START, input.start);
    Ok(())
}

#[tauri::command]
fn start_eutherdogs(
    state: State<'_, AppState>,
    start: Option<euther_oxide::eutherdogs::EutherDogsStart>,
) -> Result<euther_oxide::eutherdogs::EutherDogsFrame, String> {
    let mut dogs = state.eutherdogs.lock().map_err(|err| err.to_string())?;
    let start = start.unwrap_or(euther_oxide::eutherdogs::EutherDogsStart {
        staff: None,
        mission: None,
        players: Some(2),
        characters: None,
    });
    dogs.start(start).map_err(|err| err.to_string())
}

#[tauri::command]
fn advance_eutherdogs_mission(
    state: State<'_, AppState>,
) -> Result<euther_oxide::eutherdogs::EutherDogsFrame, String> {
    let mut dogs = state.eutherdogs.lock().map_err(|err| err.to_string())?;
    dogs.advance_mission().map_err(|err| err.to_string())
}

#[tauri::command]
fn reset_eutherdogs(
    state: State<'_, AppState>,
) -> Result<euther_oxide::eutherdogs::EutherDogsFrame, String> {
    let mut dogs = state.eutherdogs.lock().map_err(|err| err.to_string())?;
    dogs.reset().map_err(|err| err.to_string())?;
    Ok(dogs.snapshot())
}

#[tauri::command]
fn run_eutherdogs_frame(
    state: State<'_, AppState>,
    input: euther_oxide::eutherdogs::EutherDogsInput,
) -> Result<euther_oxide::eutherdogs::EutherDogsFrame, String> {
    let mut dogs = state.eutherdogs.lock().map_err(|err| err.to_string())?;
    Ok(dogs.tick(input))
}

#[tauri::command]
fn purchase_eutherdogs_item(
    state: State<'_, AppState>,
    purchase: euther_oxide::eutherdogs::EutherDogsPurchase,
) -> Result<euther_oxide::eutherdogs::EutherDogsFrame, String> {
    let mut dogs = state.eutherdogs.lock().map_err(|err| err.to_string())?;
    dogs.purchase(purchase).map_err(|err| format!("{err:?}"))
}

#[tauri::command]
fn gamepad_snapshot(state: State<'_, AppState>) -> Result<GamepadSnapshot, String> {
    let mut gamepads = state.gamepads.lock().map_err(|err| err.to_string())?;
    Ok(gamepads.snapshot())
}

#[tauri::command]
fn read_shader_config_toml() -> Result<Option<String>, String> {
    match fs::read_to_string(shader_config_path()) {
        Ok(contents) => Ok(Some(contents)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn save_shader_config_toml(toml: String) -> Result<(), String> {
    fs::create_dir_all(bridge_control_dir()).map_err(|err| err.to_string())?;
    fs::write(shader_config_path(), toml).map_err(|err| err.to_string())
}

fn bridge_control_dir() -> PathBuf {
    PathBuf::from(".euther-bridge")
}

fn shader_config_path() -> PathBuf {
    bridge_control_dir().join("shaders.toml")
}

fn settings_path() -> PathBuf {
    bridge_control_dir().join("settings.toml")
}

fn read_rom_dir_setting() -> std::io::Result<Option<String>> {
    let contents = match fs::read_to_string(settings_path()) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };
    Ok(parse_toml_string(&contents, "rom_dir"))
}

fn write_rom_dir_setting(path: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(bridge_control_dir())?;
    fs::write(
        settings_path(),
        format!(
            "rom_dir = \"{}\"\n",
            escape_toml_string(&path.to_string_lossy())
        ),
    )
}

fn validate_rom_root(path: &str) -> std::io::Result<PathBuf> {
    let canonical = PathBuf::from(path).canonicalize()?;
    if !canonical.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ROM directory must be a directory",
        ));
    }
    Ok(canonical)
}

fn rom_root_path() -> std::io::Result<PathBuf> {
    let root = read_rom_dir_setting()?.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "ROM directory is not set")
    })?;
    validate_rom_root(&root)
}

fn list_rom_dir_inner(relative: &str) -> std::io::Result<RomDirListing> {
    let root = rom_root_path()?;
    let directory = resolve_rom_dir_path(&root, relative)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir();
        let path = entry.path();
        if !is_dir && !is_rom_path(&path) {
            continue;
        }
        let Ok(relative_path) = path.strip_prefix(&root) else {
            continue;
        };
        entries.push(RomDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: normalize_relative_path(relative_path),
            is_dir,
        });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
    let current = directory
        .strip_prefix(&root)
        .map(normalize_relative_path)
        .unwrap_or_default();
    let parent = directory
        .parent()
        .and_then(|parent| parent.strip_prefix(&root).ok())
        .map(normalize_relative_path)
        .filter(|path| path != &current);
    Ok(RomDirListing {
        rom_dir: Some(root.to_string_lossy().to_string()),
        path: current,
        parent,
        entries,
    })
}

fn resolve_rom_dir_path(root: &std::path::Path, relative: &str) -> std::io::Result<PathBuf> {
    let joined = root.join(relative);
    let canonical = joined.canonicalize()?;
    if !canonical.starts_with(root) || !canonical.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "directory is outside ROM root",
        ));
    }
    Ok(canonical)
}

fn resolve_rom_file_path(relative: &str) -> std::io::Result<PathBuf> {
    let root = rom_root_path()?;
    let canonical = root.join(relative).canonicalize()?;
    if !canonical.starts_with(&root) || !canonical.is_file() || !is_rom_path(&canonical) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "ROM path is outside root or not a supported ROM",
        ));
    }
    Ok(canonical)
}

fn is_rom_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "bin" | "gen" | "md" | "smd" | "rom"
            )
        })
        .unwrap_or(false)
}

fn normalize_relative_path(path: &std::path::Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .filter(|component| !component.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

fn parse_toml_string(contents: &str, key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        let (name, value) = line.split_once('=')?;
        if name.trim() != key {
            return None;
        }
        let value = value.trim().trim_matches('"');
        Some(value.replace("\\\"", "\"").replace("\\\\", "\\"))
    })
}

fn escape_toml_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

impl GamepadReader {
    fn new() -> Self {
        match Gilrs::new() {
            Ok(gilrs) => Self {
                gilrs: Some(gilrs),
                error: None,
            },
            Err(err) => Self {
                gilrs: None,
                error: Some(err.to_string()),
            },
        }
    }

    fn snapshot(&mut self) -> GamepadSnapshot {
        let Some(gilrs) = self.gilrs.as_mut() else {
            return GamepadSnapshot {
                available: false,
                error: self.error.clone(),
                gamepads: Vec::new(),
            };
        };

        while gilrs.next_event().is_some() {}

        let gamepads = gilrs
            .gamepads()
            .map(|(id, gamepad)| GamepadDevice {
                id: format!("{id:?}"),
                name: gamepad.name().to_string(),
                controls: gamepad_controls(&gamepad),
            })
            .collect();

        GamepadSnapshot {
            available: true,
            error: None,
            gamepads,
        }
    }
}

fn gamepad_controls(gamepad: &gilrs::Gamepad<'_>) -> Vec<GamepadControl> {
    let mut controls = Vec::new();
    for (button, label) in GAMEPAD_BUTTONS {
        let pressed = gamepad.is_pressed(*button);
        let value = gamepad.button_data(*button).map(|data| data.value());
        controls.push(GamepadControl {
            id: (*label).to_string(),
            label: (*label).to_string(),
            pressed,
            value,
            kind: "button",
            direction: None,
        });
    }
    for (axis, label) in GAMEPAD_AXES {
        let value = gamepad.value(*axis);
        controls.push(GamepadControl {
            id: format!("{label}-negative"),
            label: format!("{label} -"),
            pressed: value < -0.45,
            value: Some(value),
            kind: "axis",
            direction: Some("negative"),
        });
        controls.push(GamepadControl {
            id: format!("{label}-positive"),
            label: format!("{label} +"),
            pressed: value > 0.45,
            value: Some(value),
            kind: "axis",
            direction: Some("positive"),
        });
    }
    controls
}

const GAMEPAD_BUTTONS: &[(Button, &str)] = &[
    (Button::South, "South"),
    (Button::East, "East"),
    (Button::North, "North"),
    (Button::West, "West"),
    (Button::LeftTrigger, "LeftTrigger"),
    (Button::RightTrigger, "RightTrigger"),
    (Button::LeftTrigger2, "LeftTrigger2"),
    (Button::RightTrigger2, "RightTrigger2"),
    (Button::Select, "Select"),
    (Button::Start, "Start"),
    (Button::Mode, "Mode"),
    (Button::LeftThumb, "LeftThumb"),
    (Button::RightThumb, "RightThumb"),
    (Button::DPadUp, "DPadUp"),
    (Button::DPadDown, "DPadDown"),
    (Button::DPadLeft, "DPadLeft"),
    (Button::DPadRight, "DPadRight"),
];

const GAMEPAD_AXES: &[(Axis, &str)] = &[
    (Axis::LeftStickX, "LeftStickX"),
    (Axis::LeftStickY, "LeftStickY"),
    (Axis::RightStickX, "RightStickX"),
    (Axis::RightStickY, "RightStickY"),
    (Axis::LeftZ, "LeftZ"),
    (Axis::RightZ, "RightZ"),
];

#[tauri::command]
fn list_state_slots(state: State<'_, AppState>) -> Result<StateSlotsResult, String> {
    let guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_ref().ok_or_else(|| "No ROM loaded".to_string())?;
    let summary = euther_oxide::savestate::list_slots_for_emulator(emulator)
        .map_err(|err| err.to_string())?;
    Ok(state_slots_result(summary))
}

#[tauri::command]
fn save_state_slot(state: State<'_, AppState>, slot: usize) -> Result<StateSlotsResult, String> {
    let guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_ref().ok_or_else(|| "No ROM loaded".to_string())?;
    let summary = euther_oxide::savestate::save_slot_for_emulator(emulator, slot)
        .map_err(|err| err.to_string())?;
    Ok(state_slots_result(summary))
}

#[tauri::command]
fn load_state_slot(state: State<'_, AppState>, slot: usize) -> Result<LoadStateResult, String> {
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    let summary = euther_oxide::savestate::load_slot_for_emulator(emulator, slot)
        .map_err(|err| err.to_string())?;
    Ok(LoadStateResult {
        frame: frame_result(emulator, None),
        states: state_slots_result(summary),
    })
}

fn load_result(emulator: &Emulator) -> LoadResult {
    let (width, height) = emulator.frame_size();
    LoadResult {
        title: title_from_header(emulator.rom_header.as_ref()),
        region: region_name(emulator.region).to_string(),
        timing: timing_name(emulator.timing).to_string(),
        reset_pc: emulator.cpu.pc,
        width,
        height,
        state_path: emulator
            .rom_path
            .as_deref()
            .map(euther_oxide::savestate::argon_path_for_rom)
            .map(|path| path.display().to_string()),
    }
}

fn frame_result(emulator: &Emulator, run: Option<&FrameRun>) -> FrameResult {
    let (width, height) = emulator.frame_size();

    FrameResult {
        frame: emulator.frame_count,
        width,
        height,
        rgba: emulator.frame_rgba(),
        cpu_cycles: run.map_or(0, |run| run.cpu_cycles),
        cpu_steps: run.map_or(0, |run| run.cpu_steps),
        frame_ms: run.map_or(0.0, |run| run.elapsed.as_secs_f64() * 1000.0),
        stopped: run.is_some_and(|run| run.hit_unsupported_opcode),
        last_error: emulator.last_error.as_ref().map(|err| format!("{err:?}")),
    }
}

fn native_frame_result(emulator: &Emulator, run: &FrameRun) -> NativeFrameResult {
    let (width, height) = emulator.frame_size();

    NativeFrameResult {
        frame: emulator.frame_count,
        width,
        height,
        frame_rate: emulator.frame_rate(),
        cpu_cycles: run.cpu_cycles,
        cpu_steps: run.cpu_steps,
        frame_ms: run.elapsed.as_secs_f64() * 1000.0,
        stopped: run.hit_unsupported_opcode,
        last_error: emulator.last_error.as_ref().map(|err| format!("{err:?}")),
        audio_active: false,
        audio_lead_ms: 0.0,
    }
}

fn native_frame_image(emulator: &Emulator) -> NativeFrameImage {
    let (width, height) = emulator.frame_size();
    let mut bgra = Vec::with_capacity(width * height * 4);
    for &pixel in emulator.framebuffer().iter().take(width * height) {
        bgra.push((pixel & 0xff) as u8);
        bgra.push(((pixel >> 8) & 0xff) as u8);
        bgra.push(((pixel >> 16) & 0xff) as u8);
        bgra.push(0xff);
    }
    NativeFrameImage {
        width,
        height,
        bgra,
    }
}

fn frame_audio_packet(emulator: &mut Emulator, run: &FrameRun, sample_rate: usize) -> Vec<u8> {
    let (width, height) = emulator.frame_size();
    let rgba = emulator.frame_rgba();
    let channels = 2u32;
    let samples = emulator.render_audio_frame_i16_stereo(sample_rate);
    let sample_frames = samples.len() / channels as usize;
    let rgba_len = rgba.len();
    let pcm_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(52 + rgba_len + pcm_len);
    bytes.extend_from_slice(b"EOX2");
    bytes.extend_from_slice(&(emulator.frame_count.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(width as u32).to_le_bytes());
    bytes.extend_from_slice(&(height as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_cycles.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_steps.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&((run.elapsed.as_secs_f64() * 1_000_000.0) as u32).to_le_bytes());
    bytes.extend_from_slice(&u32::from(run.hit_unsupported_opcode).to_le_bytes());
    bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    bytes.extend_from_slice(&(sample_frames as u32).to_le_bytes());
    bytes.extend_from_slice(&(rgba_len as u32).to_le_bytes());
    bytes.extend_from_slice(&(pcm_len as u32).to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&rgba);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn frame_packet(emulator: &Emulator, run: &FrameRun) -> Vec<u8> {
    let (width, height) = emulator.frame_size();
    let rgba = emulator.frame_rgba();
    let mut bytes = Vec::with_capacity(32 + rgba.len());
    bytes.extend_from_slice(b"EOXF");
    bytes.extend_from_slice(&(emulator.frame_count.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(width as u32).to_le_bytes());
    bytes.extend_from_slice(&(height as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_cycles.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_steps.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&((run.elapsed.as_secs_f64() * 1_000_000.0) as u32).to_le_bytes());
    bytes.extend_from_slice(&u32::from(run.hit_unsupported_opcode).to_le_bytes());
    bytes.extend_from_slice(&rgba);
    bytes
}

fn start_native_bridge(state: AppState) -> Result<String, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|err| format!("bridge bind failed: {err}"))?;
    let url = format!(
        "http://{}",
        listener
            .local_addr()
            .map_err(|err| format!("bridge address failed: {err}"))?
    );
    let server_state = state.clone();
    thread::Builder::new()
        .name("euther-oxide-tauri-bridge".to_string())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let state = server_state.clone();
                let _ = thread::Builder::new()
                    .name("euther-oxide-tauri-bridge-client".to_string())
                    .spawn(move || handle_native_bridge_client(stream, state));
            }
        })
        .map_err(|err| format!("bridge thread failed: {err}"))?;
    Ok(url)
}

fn start_native_runner(state: AppState) {
    let _ = thread::Builder::new()
        .name("euther-oxide-native-runner".to_string())
        .spawn(move || {
            loop {
                if !state.native_running.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(8));
                    continue;
                }

                let started = Instant::now();
                match tick_native_frame(&state) {
                    Ok(result) => {
                        if result.stopped {
                            state.native_running.store(false, Ordering::Release);
                        }
                        let frame_time = Duration::from_secs_f64(1.0 / result.frame_rate);
                        let elapsed = started.elapsed();
                        if elapsed < frame_time {
                            thread::sleep(frame_time - elapsed);
                        } else {
                            thread::yield_now();
                        }
                    }
                    Err(_) => {
                        state.native_running.store(false, Ordering::Release);
                        thread::yield_now();
                    }
                }
            }
        });
}

fn handle_native_bridge_client(mut stream: TcpStream, state: AppState) {
    let _ = stream.set_nodelay(true);
    let mut request = [0u8; 2048];
    let read = match stream.read(&mut request) {
        Ok(read) => read,
        Err(_) => return,
    };
    if read == 0 {
        return;
    }
    let request = String::from_utf8_lossy(&request[..read]);
    let mut parts = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    match (method, path) {
        ("OPTIONS", _) => write_http_response(&mut stream, "204 No Content", "text/plain", &[]),
        ("GET" | "POST", "/frame.bin") => {
            let packet = {
                let mut guard = match state.emulator.lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        write_http_response(
                            &mut stream,
                            "500 Internal Server Error",
                            "text/plain",
                            b"emulator lock failed",
                        );
                        return;
                    }
                };
                let Some(emulator) = guard.as_mut() else {
                    write_http_response(
                        &mut stream,
                        "409 Conflict",
                        "text/plain",
                        b"No ROM loaded",
                    );
                    return;
                };
                let run = emulator.run_frame();
                frame_packet(emulator, &run)
            };
            write_http_response(&mut stream, "200 OK", "application/octet-stream", &packet);
        }
        ("GET" | "POST", "/frame-audio.bin") => {
            let packet = {
                let mut guard = match state.emulator.lock() {
                    Ok(guard) => guard,
                    Err(_) => {
                        write_http_response(
                            &mut stream,
                            "500 Internal Server Error",
                            "text/plain",
                            b"emulator lock failed",
                        );
                        return;
                    }
                };
                let Some(emulator) = guard.as_mut() else {
                    write_http_response(
                        &mut stream,
                        "409 Conflict",
                        "text/plain",
                        b"No ROM loaded",
                    );
                    return;
                };
                let run = emulator.run_frame();
                frame_audio_packet(emulator, &run, 44_100)
            };
            write_http_response(&mut stream, "200 OK", "application/octet-stream", &packet);
        }
        _ => write_http_response(&mut stream, "404 Not Found", "text/plain", b"Not found"),
    }
}

fn write_http_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\n\
Content-Type: {content_type}\r\n\
Content-Length: {}\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Headers: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Max-Age: 86400\r\n\
Connection: close\r\n\
\r\n",
        body.len()
    );
    let mut response = Vec::with_capacity(header.len() + body.len());
    response.extend_from_slice(header.as_bytes());
    response.extend_from_slice(body);
    let _ = stream.write_all(&response);
}

fn start_native_audio_thread(volume: Arc<AtomicU32>) -> mpsc::Sender<AudioCommand> {
    let (sender, receiver) = mpsc::channel::<AudioCommand>();
    let _ = thread::Builder::new()
        .name("euther-oxide-native-audio".to_string())
        .spawn(move || {
            let mut audio = None::<NativeAudio>;
            while let Ok(command) = receiver.recv() {
                match command {
                    AudioCommand::Push {
                        samples,
                        sample_rate,
                        response,
                    } => {
                        if audio.is_none() {
                            audio = NativeAudio::new(volume.clone());
                        }
                        let result = match audio.as_mut() {
                            Some(audio) => NativeAudioResult {
                                active: true,
                                queued_ms: audio.push_i16(&samples, sample_rate),
                            },
                            None => NativeAudioResult {
                                active: false,
                                queued_ms: 0.0,
                            },
                        };
                        let _ = response.send(result);
                    }
                    AudioCommand::PushAsync {
                        samples,
                        sample_rate,
                    } => {
                        if audio.is_none() {
                            audio = NativeAudio::new(volume.clone());
                        }
                        if let Some(audio) = audio.as_mut() {
                            audio.push_i16(&samples, sample_rate);
                        }
                    }
                }
            }
        });
    sender
}

impl NativeAudio {
    fn new(volume: Arc<AtomicU32>) -> Option<Self> {
        let host = cpal::default_host();
        let device = host.default_output_device()?;
        let config = device.default_output_config().ok()?;
        let sample_format = config.sample_format();
        let stream_config: cpal::StreamConfig = config.into();
        let sample_rate = stream_config.sample_rate.0;
        let channels = usize::from(stream_config.channels).max(1);
        let queue = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(
            sample_rate as usize,
        )));
        let err_fn = |err| eprintln!("native audio stream error: {err}");
        let stream = match sample_format {
            cpal::SampleFormat::F32 => build_native_audio_stream::<f32>(
                &device,
                &stream_config,
                queue.clone(),
                volume.clone(),
                channels,
                err_fn,
            ),
            cpal::SampleFormat::I16 => build_native_audio_stream::<i16>(
                &device,
                &stream_config,
                queue.clone(),
                volume.clone(),
                channels,
                err_fn,
            ),
            cpal::SampleFormat::U16 => build_native_audio_stream::<u16>(
                &device,
                &stream_config,
                queue.clone(),
                volume.clone(),
                channels,
                err_fn,
            ),
            _ => return None,
        }
        .ok()?;
        stream.play().ok()?;
        Some(Self {
            queue,
            _volume: volume,
            _stream: stream,
            sample_rate,
            primed: false,
        })
    }

    fn push_i16(&mut self, samples: &[i16], sample_rate: u32) -> f64 {
        let mut queue = match self.queue.lock() {
            Ok(queue) => queue,
            Err(_) => return 0.0,
        };
        let max_len = (self.sample_rate as usize).saturating_mul(2);
        if queue.len() > max_len {
            let overflow = queue.len() - max_len;
            queue.drain(..overflow);
        }
        let target_len = ((self.sample_rate as usize) * 45) / 1000;
        let low_water = ((self.sample_rate as usize) * 8) / 1000;
        if !self.primed || queue.len() < low_water {
            let pad = target_len.saturating_sub(queue.len());
            queue.extend(std::iter::repeat(0.0).take(pad));
            self.primed = true;
        }
        if sample_rate == self.sample_rate {
            queue.extend(samples.iter().map(|sample| f32::from(*sample) / 32768.0));
        } else {
            let ratio = f64::from(sample_rate) / f64::from(self.sample_rate);
            let out_len = ((samples.len() as f64) / ratio).ceil().max(0.0) as usize;
            for index in 0..out_len {
                let source_index = ((index as f64) * ratio).floor() as usize;
                let sample = samples.get(source_index).copied().unwrap_or(0);
                queue.push_back(f32::from(sample) / 32768.0);
            }
        }
        (queue.len() as f64 / f64::from(self.sample_rate)) * 1000.0
    }
}

fn build_native_audio_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    queue: Arc<Mutex<VecDeque<f32>>>,
    volume: Arc<AtomicU32>,
    channels: usize,
    err_fn: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::Sample + cpal::FromSample<f32> + cpal::SizedSample,
{
    device.build_output_stream(
        config,
        move |data: &mut [T], _| {
            let mut queue = queue.lock().ok();
            for frame in data.chunks_mut(channels) {
                let gain = volume.load(Ordering::Acquire) as f32 / 1000.0;
                let sample = queue
                    .as_mut()
                    .and_then(|queue| queue.pop_front())
                    .unwrap_or(0.0)
                    * gain;
                let output = T::from_sample(sample);
                for channel in frame {
                    *channel = output;
                }
            }
        },
        err_fn,
        None,
    )
}

#[cfg(target_os = "linux")]
fn install_embedded_native_surface(app: &tauri::AppHandle, state: AppState) -> Result<(), String> {
    let Some(webview) = app.get_webview_window("main") else {
        return Err("main webview missing".to_string());
    };

    webview
        .with_webview(move |platform_webview| {
            use gtk::prelude::*;
            use webkit2gtk::WebViewExt;

            let webview = platform_webview.inner();
            webview.set_background_color(&gdk::RGBA::new(0.0, 0.0, 0.0, 0.0));
            webview.set_app_paintable(true);

            let Some(original_parent) = webview.parent() else {
                eprintln!("embedded native surface skipped: webview has no GTK parent");
                return;
            };
            let Some(window_widget) = original_parent.parent() else {
                eprintln!("embedded native surface skipped: webview parent has no GTK window");
                return;
            };
            let Ok(original_parent_container) = original_parent.downcast::<gtk::Container>() else {
                eprintln!("embedded native surface skipped: webview parent is not a GTK container");
                return;
            };
            let Ok(window_container) = window_widget.downcast::<gtk::Container>() else {
                eprintln!("embedded native surface skipped: GTK window is not a container");
                return;
            };

            original_parent_container.remove(&webview);
            window_container.remove(&original_parent_container);

            let overlay = gtk::Overlay::new();
            overlay.set_hexpand(true);
            overlay.set_vexpand(true);

            let surface = gtk::DrawingArea::new();
            surface.set_halign(gtk::Align::Start);
            surface.set_valign(gtk::Align::Start);
            surface.set_hexpand(false);
            surface.set_vexpand(false);
            surface.set_app_paintable(true);
            let draw_state = state.clone();
            surface.connect_draw(move |area, cr| {
                let allocation = area.allocation();
                let width = f64::from(allocation.width());
                let height = f64::from(allocation.height());

                cr.set_operator(cairo::Operator::Clear);
                let _ = cr.paint();
                cr.set_operator(cairo::Operator::Over);

                let frame = draw_state
                    .native_frame
                    .lock()
                    .ok()
                    .and_then(|frame| frame.clone());

                if let Some(frame) = frame {
                    draw_native_frame(
                        cr,
                        0.0,
                        0.0,
                        width,
                        height,
                        frame.width,
                        frame.height,
                        frame.bgra,
                    );
                } else {
                    let gradient = cairo::LinearGradient::new(0.0, 0.0, width, height);
                    gradient.add_color_stop_rgb(0.0, 0.01, 0.06, 0.03);
                    gradient.add_color_stop_rgb(0.45, 0.02, 0.20, 0.14);
                    gradient.add_color_stop_rgb(0.72, 0.03, 0.10, 0.32);
                    gradient.add_color_stop_rgb(1.0, 0.01, 0.04, 0.03);
                    cr.rectangle(0.0, 0.0, width, height);
                    let _ = cr.set_source(&gradient);
                    let _ = cr.fill();
                    draw_native_standby_marker(cr, 0.0, 0.0, width, height);
                }

                cr.set_source_rgba(0.43, 1.0, 0.72, 0.24);
                cr.set_line_width(2.0);
                cr.rectangle(1.0, 1.0, width - 2.0, height - 2.0);
                let _ = cr.stroke();

                gtk::glib::Propagation::Proceed
            });

            let surface_layout = surface.clone();
            let layout_state = state.clone();
            overlay.connect_size_allocate(move |_overlay, allocation| {
                let (x, y, width, height) = layout_state
                    .native_surface_rect
                    .lock()
                    .ok()
                    .and_then(|rect| *rect)
                    .map(|rect| (rect.x, rect.y, rect.width, rect.height))
                    .unwrap_or_else(|| {
                        native_surface_rect(allocation.width(), allocation.height())
                    });
                surface_layout.set_margin_start(x);
                surface_layout.set_margin_top(y);
                surface_layout.set_size_request(width, height);
            });

            overlay.add(&webview);
            overlay.add_overlay(&surface);
            overlay.set_overlay_pass_through(&surface, true);

            window_container.add(&overlay);
            overlay.show_all();

            let rect_state = state.clone();
            let ticking_surface = surface.clone();
            gtk::glib::timeout_add_local(std::time::Duration::from_millis(16), move || {
                if let Some(rect) = rect_state
                    .native_surface_rect
                    .lock()
                    .ok()
                    .and_then(|rect| *rect)
                {
                    ticking_surface.set_margin_start(rect.x);
                    ticking_surface.set_margin_top(rect.y);
                    ticking_surface.set_size_request(rect.width, rect.height);
                }
                surface.queue_draw();
                gtk::glib::ControlFlow::Continue
            });
        })
        .map_err(|err| err.to_string())?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn native_surface_rect(window_width: i32, window_height: i32) -> (i32, i32, i32, i32) {
    let width = f64::from(window_width);
    let height = f64::from(window_height);
    let shell_padding = 18.0;
    let grid_gap = 18.0;
    let rail_w = 260.0;
    let telemetry_w = 300.0;
    let stage_x = shell_padding + rail_w + grid_gap;
    let stage_w = (width - shell_padding * 2.0 - rail_w - telemetry_w - grid_gap * 2.0).max(420.0);
    let stage_padding = 18.0;
    let header_h = 58.0;
    let stage_gap = 18.0;
    let strip_h = 42.0;
    let vessel_padding = 14.0;
    let vessel_x = stage_x + stage_padding;
    let vessel_y = shell_padding + stage_padding + header_h + stage_gap;
    let vessel_w = (stage_w - stage_padding * 2.0).max(320.0);
    let vessel_h =
        (height - shell_padding * 2.0 - stage_padding * 2.0 - header_h - strip_h - stage_gap * 2.0)
            .max(224.0);
    let max_screen_w = (vessel_w - vessel_padding * 2.0).max(320.0);
    let max_screen_h = (vessel_h - vessel_padding * 2.0).max(224.0);
    let screen_w = max_screen_w.min(max_screen_h * (10.0 / 7.0));
    let screen_h = screen_w * 0.7;
    let screen_x = vessel_x + (vessel_w - screen_w) * 0.5;
    let screen_y = vessel_y + (vessel_h - screen_h) * 0.5;
    (
        screen_x.round() as i32,
        screen_y.round() as i32,
        screen_w.round() as i32,
        screen_h.round() as i32,
    )
}

#[cfg(not(target_os = "linux"))]
fn install_embedded_native_surface(_: &tauri::AppHandle, _: AppState) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn draw_native_frame(
    cr: &cairo::Context,
    screen_x: f64,
    screen_y: f64,
    screen_w: f64,
    screen_h: f64,
    frame_width: usize,
    frame_height: usize,
    bgra: Vec<u8>,
) {
    if frame_width == 0 || frame_height == 0 || bgra.len() < frame_width * frame_height * 4 {
        return;
    }

    let Ok(surface) = cairo::ImageSurface::create_for_data(
        bgra,
        cairo::Format::ARgb32,
        frame_width as i32,
        frame_height as i32,
        (frame_width * 4) as i32,
    ) else {
        return;
    };

    let scale = (screen_w / frame_width as f64).min(screen_h / frame_height as f64);
    let draw_w = frame_width as f64 * scale;
    let draw_h = frame_height as f64 * scale;
    let draw_x = screen_x + (screen_w - draw_w) * 0.5;
    let draw_y = screen_y + (screen_h - draw_h) * 0.5;
    let pattern = cairo::SurfacePattern::create(&surface);
    pattern.set_filter(cairo::Filter::Nearest);

    let _ = cr.save();
    cr.rectangle(screen_x, screen_y, screen_w, screen_h);
    cr.clip();
    cr.translate(draw_x, draw_y);
    cr.scale(scale, scale);
    let _ = cr.set_source(&pattern);
    let _ = cr.paint();
    let _ = cr.restore();
}

#[cfg(target_os = "linux")]
fn draw_native_standby_marker(
    cr: &cairo::Context,
    screen_x: f64,
    screen_y: f64,
    screen_w: f64,
    screen_h: f64,
) {
    let marker_w = 88.0;
    let marker_h = 124.0;
    let marker_x = screen_x + (screen_w - marker_w) * 0.5;
    let marker_y = screen_y + (screen_h - marker_h) * 0.5;
    for lane in 0..5 {
        let x = marker_x + f64::from(lane) * 18.0;
        cr.set_source_rgba(0.0, 0.95, 1.0, 0.18 + f64::from(lane % 2) * 0.22);
        cr.rectangle(x, marker_y, 12.0, marker_h);
        let _ = cr.fill();
    }
    cr.set_source_rgba(0.84, 1.0, 0.68, 0.72);
    cr.set_line_width(3.0);
    cr.move_to(marker_x + 10.0, marker_y + marker_h - 20.0);
    cr.line_to(marker_x + marker_w * 0.55, marker_y + 18.0);
    cr.line_to(marker_x + marker_w - 8.0, marker_y + marker_h - 18.0);
    let _ = cr.stroke();
}

fn state_slots_result(summary: ArgonSummary) -> StateSlotsResult {
    StateSlotsResult {
        path: Some(summary.path),
        slots: summary.slots.into_iter().map(state_slot_result).collect(),
    }
}

fn state_slot_result(slot: SlotSummary) -> StateSlotResult {
    StateSlotResult {
        slot: slot.slot,
        occupied: slot.occupied,
        created_unix_ms: slot.created_unix_ms,
        frame_count: slot.frame_count,
        label: slot.label,
    }
}

fn title_from_header(header: Option<&RomHeader>) -> String {
    header
        .and_then(|header| {
            if !header.overseas_name.is_empty() {
                Some(header.overseas_name.clone())
            } else if !header.domestic_name.is_empty() {
                Some(header.domestic_name.clone())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "Loaded Mega Drive ROM".to_string())
}

fn region_name(region: SystemRegion) -> &'static str {
    match region {
        SystemRegion::Japan => "JP",
        SystemRegion::Usa => "US",
        SystemRegion::Europe => "EU",
        SystemRegion::JapanPal => "JP PAL",
        SystemRegion::Unknown => "AUTO",
    }
}

fn timing_name(timing: TimingMode) -> &'static str {
    match timing {
        TimingMode::Ntsc => "NTSC",
        TimingMode::Pal => "PAL",
    }
}

fn main() {
    configure_linux_webview_backend();
    let state = AppState::default();
    match start_native_bridge(state.clone()) {
        Ok(url) => {
            if let Ok(mut bridge_url) = state.bridge_url.lock() {
                *bridge_url = url;
            }
        }
        Err(err) => eprintln!("failed to start native bridge: {err}"),
    }
    start_native_runner(state.clone());

    let native_surface_state = state.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(move |app| {
            if let Err(err) =
                install_embedded_native_surface(app.handle(), native_surface_state.clone())
            {
                eprintln!("embedded native surface failed: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_rom_bytes,
            load_rom_path,
            get_rom_dir,
            set_rom_dir,
            list_rom_dir,
            load_rom_from_dir,
            run_frame,
            run_frame_audio_packet,
            native_bridge_url,
            render_audio_frame,
            run_native_frame,
            set_native_running,
            native_frame_status,
            set_native_surface_rect,
            play_native_audio,
            set_audio_volume,
            reset_emulator,
            set_input,
            start_eutherdogs,
            advance_eutherdogs_mission,
            reset_eutherdogs,
            run_eutherdogs_frame,
            purchase_eutherdogs_item,
            gamepad_snapshot,
            read_shader_config_toml,
            save_shader_config_toml,
            list_state_slots,
            save_state_slot,
            load_state_slot
        ])
        .run(tauri::generate_context!())
        .expect("failed to run EutherOxide");
}

#[cfg(target_os = "linux")]
fn configure_linux_webview_backend() {
    if env::var_os("GDK_BACKEND").is_none() {
        unsafe {
            env::set_var("GDK_BACKEND", "wayland");
        }
    }
    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        unsafe {
            env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webview_backend() {}
