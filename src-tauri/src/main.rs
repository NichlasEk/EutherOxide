use std::sync::Mutex;

use euther_oxide::savestate::{ArgonSummary, SlotSummary};
use euther_oxide::{Emulator, FrameRun, RomHeader, SystemRegion, TimingMode};
use serde::Serialize;
use tauri::State;

#[derive(Default)]
struct AppState {
    emulator: Mutex<Option<Emulator>>,
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

#[derive(serde::Deserialize)]
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
    let mut rgba = Vec::with_capacity(width * height * 4);
    for &pixel in emulator.framebuffer().iter().take(width * height) {
        rgba.push(((pixel >> 16) & 0xff) as u8);
        rgba.push(((pixel >> 8) & 0xff) as u8);
        rgba.push((pixel & 0xff) as u8);
        rgba.push(0xff);
    }

    FrameResult {
        frame: emulator.frame_count,
        width,
        height,
        rgba,
        cpu_cycles: run.map_or(0, |run| run.cpu_cycles),
        cpu_steps: run.map_or(0, |run| run.cpu_steps),
        frame_ms: run.map_or(0.0, |run| run.elapsed.as_secs_f64() * 1000.0),
        stopped: run.is_some_and(|run| run.hit_unsupported_opcode),
        last_error: emulator.last_error.as_ref().map(|err| format!("{err:?}")),
    }
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_rom_bytes,
            load_rom_path,
            run_frame,
            reset_emulator,
            set_input,
            list_state_slots,
            save_state_slot,
            load_state_slot
        ])
        .run(tauri::generate_context!())
        .expect("failed to run EutherOxide");
}
