use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

#[cfg(target_os = "linux")]
use std::env;

use euther_oxide::savestate::{ArgonSummary, SlotSummary};
use euther_oxide::{Emulator, FrameRun, RomHeader, SystemRegion, TimingMode};
use serde::Serialize;
use tauri::{Manager, State, ipc::Response};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

#[derive(Clone, Default)]
struct AppState {
    emulator: Arc<Mutex<Option<Emulator>>>,
    bridge_url: Arc<Mutex<String>>,
    native_surface_rect: Arc<Mutex<Option<NativeSurfaceRect>>>,
    native_audio: Arc<Mutex<Option<mpsc::Sender<AudioCommand>>>>,
}

#[derive(Clone, Copy, Default)]
struct NativeSurfaceRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

struct NativeAudio {
    queue: Arc<Mutex<VecDeque<f32>>>,
    _stream: cpal::Stream,
    sample_rate: u32,
}

enum AudioCommand {
    Push {
        samples: Vec<i16>,
        sample_rate: u32,
        response: mpsc::Sender<NativeAudioResult>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeAudioResult {
    active: bool,
    queued_ms: f64,
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

    *state.emulator.lock().map_err(|err| err.to_string())? = Some(emulator);
    Ok(result)
}

#[tauri::command]
fn load_rom_path(state: State<'_, AppState>, path: String) -> Result<LoadResult, String> {
    let mut emulator = Emulator::new();
    emulator
        .load_rom_file(&path)
        .map_err(|err| format!("Could not load ROM: {err}"))?;
    let result = load_result(&emulator);

    *state.emulator.lock().map_err(|err| err.to_string())? = Some(emulator);
    Ok(result)
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
    let sender = {
        let mut guard = state.native_audio.lock().map_err(|err| err.to_string())?;
        match guard.as_ref() {
            Some(sender) => sender.clone(),
            None => {
                let sender = start_native_audio_thread();
                *guard = Some(sender.clone());
                sender
            }
        }
    };

    let (response, receiver) = mpsc::channel();
    let command = AudioCommand::Push {
        samples,
        sample_rate: sample_rate.max(1) as u32,
        response,
    };

    if let Err(err) = sender.send(command) {
        let sender = start_native_audio_thread();
        *state.native_audio.lock().map_err(|err| err.to_string())? = Some(sender.clone());
        let (response, receiver) = mpsc::channel();
        let AudioCommand::Push {
            samples,
            sample_rate,
            ..
        } = err.0;
        sender
            .send(AudioCommand::Push {
                samples,
                sample_rate,
                response,
            })
            .map_err(|err| err.to_string())?;
        return receiver
            .recv_timeout(Duration::from_millis(20))
            .map_err(|err| err.to_string());
    }

    receiver
        .recv_timeout(Duration::from_millis(20))
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn reset_emulator(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.emulator.lock().map_err(|err| err.to_string())?;
    let emulator = guard.as_mut().ok_or_else(|| "No ROM loaded".to_string())?;
    emulator.reset();
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

fn frame_audio_packet(emulator: &mut Emulator, run: &FrameRun, sample_rate: usize) -> Vec<u8> {
    let (width, height) = emulator.frame_size();
    let rgba = emulator.frame_rgba();
    let samples = emulator.render_audio_frame_i16(sample_rate);
    let rgba_len = rgba.len();
    let pcm_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(48 + rgba_len + pcm_len);
    bytes.extend_from_slice(b"EOXB");
    bytes.extend_from_slice(&(emulator.frame_count.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(width as u32).to_le_bytes());
    bytes.extend_from_slice(&(height as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_cycles.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_steps.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&((run.elapsed.as_secs_f64() * 1_000_000.0) as u32).to_le_bytes());
    bytes.extend_from_slice(&u32::from(run.hit_unsupported_opcode).to_le_bytes());
    bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(rgba_len as u32).to_le_bytes());
    bytes.extend_from_slice(&(pcm_len as u32).to_le_bytes());
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

fn start_native_audio_thread() -> mpsc::Sender<AudioCommand> {
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
                            audio = NativeAudio::new();
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
                }
            }
        });
    sender
}

impl NativeAudio {
    fn new() -> Option<Self> {
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
                channels,
                err_fn,
            ),
            cpal::SampleFormat::I16 => build_native_audio_stream::<i16>(
                &device,
                &stream_config,
                queue.clone(),
                channels,
                err_fn,
            ),
            cpal::SampleFormat::U16 => build_native_audio_stream::<u16>(
                &device,
                &stream_config,
                queue.clone(),
                channels,
                err_fn,
            ),
            _ => return None,
        }
        .ok()?;
        stream.play().ok()?;
        Some(Self {
            queue,
            _stream: stream,
            sample_rate,
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
                let sample = queue
                    .as_mut()
                    .and_then(|queue| queue.pop_front())
                    .unwrap_or(0.0);
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

                let frame = draw_state.emulator.lock().ok().and_then(|guard| {
                    let emulator = guard.as_ref()?;
                    let (frame_width, frame_height) = emulator.frame_size();
                    Some((frame_width, frame_height, emulator.frame_rgba()))
                });

                if let Some((frame_width, frame_height, rgba)) = frame {
                    draw_native_frame(
                        cr,
                        0.0,
                        0.0,
                        width,
                        height,
                        frame_width,
                        frame_height,
                        &rgba,
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
    rgba: &[u8],
) {
    if frame_width == 0 || frame_height == 0 || rgba.len() < frame_width * frame_height * 4 {
        return;
    }

    let mut pixels = vec![0u8; frame_width * frame_height * 4];
    for (source, target) in rgba
        .chunks_exact(4)
        .zip(pixels.chunks_exact_mut(4))
        .take(frame_width * frame_height)
    {
        target[0] = source[2];
        target[1] = source[1];
        target[2] = source[0];
        target[3] = source[3];
    }

    let Ok(surface) = cairo::ImageSurface::create_for_data(
        pixels,
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
            run_frame,
            run_frame_audio_packet,
            native_bridge_url,
            render_audio_frame,
            set_native_surface_rect,
            play_native_audio,
            reset_emulator,
            set_input,
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
