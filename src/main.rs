use std::env;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{self, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use euther_oxide::savestate::{ArgonSummary, list_slots_for_emulator};
use euther_oxide::{Emulator, FrameRun, RomHeader, SystemRegion, TimingMode};
use serde::{Deserialize, Serialize};

fn main() {
    if let Err(err) = run() {
        eprintln!("euther-oxide: {err}");
        process::exit(1);
    }
}

fn run() -> io::Result<()> {
    let mut frames = 1u64;
    let mut dump_path: Option<PathBuf> = None;
    let mut save_state: Option<usize> = None;
    let mut load_state: Option<usize> = None;
    let mut list_states = false;
    let mut vdp_summary = false;
    let mut web_bridge = false;
    let mut perf = false;
    let mut frames_was_set = false;
    let mut rom_path: Option<String> = None;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--frames" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--frames needs a value",
                    ));
                };
                frames = value.parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, "--frames must be an integer")
                })?;
                frames_was_set = true;
            }
            "--dump" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--dump needs a path",
                    ));
                };
                dump_path = Some(PathBuf::from(value));
            }
            "--save-state" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--save-state needs a slot number",
                    ));
                };
                save_state = Some(parse_slot("--save-state", &value)?);
            }
            "--load-state" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--load-state needs a slot number",
                    ));
                };
                load_state = Some(parse_slot("--load-state", &value)?);
            }
            "--list-states" => {
                list_states = true;
            }
            "--vdp-summary" => {
                vdp_summary = true;
            }
            "--web-bridge" => {
                web_bridge = true;
            }
            "--perf" => {
                perf = true;
            }
            "--help" | "-h" => {
                print_usage();
                return Ok(());
            }
            other => {
                if other.starts_with('-') {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!("unknown argument {other}"),
                    ));
                }
                if rom_path.replace(other.to_string()).is_some() {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        format!("unexpected extra ROM path {other}"),
                    ));
                }
            }
        }
    }

    let mut emulator = Emulator::new();
    if let Some(rom_path) = rom_path.as_deref() {
        emulator.load_rom_file(rom_path)?;
        if let Some(header) = &emulator.rom_header {
            println!(
                "Loaded {} | region {:?} | timing {:?} | reset PC ${:06X}",
                if header.overseas_name.is_empty() {
                    "<unnamed>"
                } else {
                    &header.overseas_name
                },
                emulator.region,
                emulator.timing,
                emulator.cpu.pc
            );
        } else {
            println!("Loaded ROM | reset PC ${:06X}", emulator.cpu.pc);
        }
    } else if web_bridge {
        println!("No ROM loaded; bridge will accept browser uploads at /load");
    } else {
        print_usage();
        return Ok(());
    }

    if let Some(slot) = load_state {
        if emulator.bus.rom.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "--load-state needs a ROM path",
            ));
        }
        let summary = euther_oxide::savestate::load_slot_for_emulator(&mut emulator, slot)?;
        println!(
            "Loaded .argon slot {slot} from {} at frame {}",
            summary.path, emulator.frame_count
        );
    }

    if web_bridge {
        serve_web_bridge(emulator, "127.0.0.1:32161")?;
        return Ok(());
    }

    if list_states && !frames_was_set && dump_path.is_none() && save_state.is_none() {
        print_slots(&list_slots_for_emulator(&emulator)?);
        return Ok(());
    }

    let mut last = None;
    let perf_started = Instant::now();
    let mut core_total = Duration::ZERO;
    let mut audio_total = Duration::ZERO;
    let mut rgba_total = Duration::ZERO;
    for _ in 0..frames {
        let run = emulator.run_frame();
        core_total += run.elapsed;
        last = Some(run);
        if perf {
            let audio_started = Instant::now();
            let _audio = emulator.render_audio_frame_i16(44_100);
            audio_total += audio_started.elapsed();

            let rgba_started = Instant::now();
            let _rgba = emulator.frame_rgba();
            rgba_total += rgba_started.elapsed();
        }
    }
    let perf_total = perf_started.elapsed();

    if let Some(run) = last {
        println!(
            "Ran {} frame(s), last frame: {} cycles, {} steps, {:.3} ms{}",
            emulator.frame_count,
            run.cpu_cycles,
            run.cpu_steps,
            run.elapsed.as_secs_f64() * 1000.0,
            if run.hit_unsupported_opcode {
                " (stopped at unsupported opcode)"
            } else {
                ""
            }
        );
        if let Some(err) = &emulator.last_error {
            println!("Last CPU error: {err:?}");
        }
        if perf {
            let frame_count = frames.max(1) as f64;
            let core_avg = core_total.as_secs_f64() * 1000.0 / frame_count;
            let audio_avg = audio_total.as_secs_f64() * 1000.0 / frame_count;
            let rgba_avg = rgba_total.as_secs_f64() * 1000.0 / frame_count;
            let total_avg = perf_total.as_secs_f64() * 1000.0 / frame_count;
            println!(
                "Perf avg/frame: total {:.3} ms | core {:.3} ms | audio {:.3} ms | rgba {:.3} ms | {:.1} fps",
                total_avg,
                core_avg,
                audio_avg,
                rgba_avg,
                1000.0 / total_avg.max(0.001),
            );
        }
    }

    if let Some(path) = dump_path {
        write_ppm(&path, emulator.framebuffer(), emulator.frame_size())?;
        println!("Wrote {}", path.display());
    }

    if vdp_summary {
        print_vdp_summary(&emulator);
    }

    if let Some(slot) = save_state {
        let summary = euther_oxide::savestate::save_slot_for_emulator(&emulator, slot)?;
        println!(
            "Saved .argon slot {slot} to {} at frame {}",
            summary.path, emulator.frame_count
        );
        if list_states {
            print_slots(&summary);
        }
    } else if list_states {
        print_slots(&list_slots_for_emulator(&emulator)?);
    }

    Ok(())
}

fn print_usage() {
    println!(
        "usage: euther-oxide [rom.md|rom.bin|rom.smd] [--frames N] [--perf] [--dump frame.ppm] [--save-state 1|2|3] [--load-state 1|2|3] [--list-states] [--vdp-summary] [--web-bridge]"
    );
}

fn parse_slot(flag: &str, value: &str) -> io::Result<usize> {
    value.parse::<usize>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{flag} must be a slot number"),
        )
    })
}

fn print_slots(summary: &ArgonSummary) {
    println!("Argon {}", summary.path);
    for slot in &summary.slots {
        if slot.occupied {
            println!(
                "  slot {}: {}",
                slot.slot,
                slot.label.as_deref().unwrap_or("<unnamed>")
            );
        } else {
            println!("  slot {}: empty", slot.slot);
        }
    }
}

fn print_vdp_summary(emulator: &Emulator) {
    let vdp = &emulator.bus.vdp;
    let vram_nonzero = vdp.vram.iter().filter(|&&byte| byte != 0).count();
    let first_vram = vdp.vram.iter().position(|&byte| byte != 0).unwrap_or(0);
    let last_vram = vdp.vram.iter().rposition(|&byte| byte != 0).unwrap_or(0);
    let cram_nonzero = vdp.cram.iter().filter(|&&word| word != 0).count();
    let vsram_nonzero = vdp.vsram.iter().filter(|&&word| word != 0).count();
    println!(
        "CPU: pc=${:06X} sr=${:04X} d0=${:08X} a0=${:08X}",
        emulator.cpu.pc,
        emulator.cpu.sr(),
        emulator.cpu.d[0],
        emulator.cpu.a()[0]
    );
    println!(
        "CPU D: {:08X} {:08X} {:08X} {:08X} {:08X} {:08X} {:08X} {:08X}",
        emulator.cpu.d[0],
        emulator.cpu.d[1],
        emulator.cpu.d[2],
        emulator.cpu.d[3],
        emulator.cpu.d[4],
        emulator.cpu.d[5],
        emulator.cpu.d[6],
        emulator.cpu.d[7]
    );
    println!(
        "CPU A: {:08X} {:08X} {:08X} {:08X} {:08X} {:08X} {:08X} {:08X}",
        emulator.cpu.a()[0],
        emulator.cpu.a()[1],
        emulator.cpu.a()[2],
        emulator.cpu.a()[3],
        emulator.cpu.a()[4],
        emulator.cpu.a()[5],
        emulator.cpu.a()[6],
        emulator.cpu.a()[7]
    );
    println!(
        "VDP regs: r0=${:02X} r1=${:02X} r2=${:02X} r4=${:02X} r5=${:02X} r7=${:02X} r12=${:02X} r13=${:02X} r16=${:02X}",
        vdp.registers[0],
        vdp.registers[1],
        vdp.registers[2],
        vdp.registers[4],
        vdp.registers[5],
        vdp.registers[7],
        vdp.registers[12],
        vdp.registers[13],
        vdp.registers[16]
    );
    println!(
        "VDP memory: VRAM nonzero {}/{} | CRAM nonzero {}/{} | VSRAM nonzero {}/{}",
        vram_nonzero,
        vdp.vram.len(),
        cram_nonzero,
        vdp.cram.len(),
        vsram_nonzero,
        vdp.vsram.len()
    );
    println!("VDP VRAM nonzero range: ${first_vram:04X}-${last_vram:04X}");
    print!("VDP VRAM buckets:");
    for chunk in 0..16 {
        let start = chunk * 0x1000;
        let count = vdp.vram[start..start + 0x1000]
            .iter()
            .filter(|&&byte| byte != 0)
            .count();
        if count != 0 {
            print!(" ${start:04X}:{count}");
        }
    }
    println!();
    print!("VDP CRAM first 16:");
    for value in vdp.cram.iter().take(16) {
        print!(" ${value:03X}");
    }
    println!();
    println!(
        "VDP writes: VRAM {} (nonzero {}, pattern {} / nonzero {}) | CRAM {} (nonzero {}) | VSRAM {}",
        vdp.vram_writes,
        vdp.vram_nonzero_writes,
        vdp.vram_pattern_writes,
        vdp.vram_pattern_nonzero_writes,
        vdp.cram_writes,
        vdp.cram_nonzero_writes,
        vdp.vsram_writes
    );
    println!(
        "VDP DMA: transfers {} | target range ${:05X}-${:05X} | last source ${:06X} target ${:05X} length {} words",
        vdp.dma_transfers,
        if vdp.dma_min_target == u32::MAX {
            0
        } else {
            vdp.dma_min_target
        },
        vdp.dma_max_target,
        vdp.dma_last_source,
        vdp.dma_last_target,
        vdp.dma_last_length
    );
    println!(
        "VDP DMA pattern: transfers {} | nonzero words {} | last source ${:06X}",
        vdp.dma_pattern_transfers, vdp.dma_pattern_nonzero_words, vdp.dma_pattern_last_source
    );
    println!(
        "Audio: Z80 pc=${:04X} cycles={} halted={} | YM writes {} | PSG writes {}",
        emulator.z80.pc,
        emulator.z80.total_cycles,
        emulator.z80.halted,
        emulator.bus.ym2612.writes,
        emulator.bus.psg.writes
    );
    print!("YM recent:");
    for write in emulator.bus.ym2612.write_log.iter().rev().take(8).rev() {
        print!(
            " p{}:${:02X}=${:02X}@{}",
            write.port,
            write.reg,
            write.value,
            write.cycle.unwrap_or(0)
        );
    }
    println!();
    print!("PSG recent:");
    for write in emulator.bus.psg.write_log.iter().rev().take(8).rev() {
        print!(" ${:02X}@{}", write.value, write.cycle.unwrap_or(0));
    }
    println!();
    println!(
        "Sonic RAM: f600=${:02X} f62a=${:02X} f644=${:02X}{:02X} f64e=${:02X} fe10=${:02X}",
        emulator.bus.peek_byte(0xffff_f600),
        emulator.bus.peek_byte(0xffff_f62a),
        emulator.bus.peek_byte(0xffff_f644),
        emulator.bus.peek_byte(0xffff_f645),
        emulator.bus.peek_byte(0xffff_f64e),
        emulator.bus.peek_byte(0xffff_fe10)
    );
    let sonic_obj = 0xffff_d000;
    let sonic_word = |offset| {
        (u16::from(emulator.bus.peek_byte(sonic_obj + offset)) << 8)
            | u16::from(emulator.bus.peek_byte(sonic_obj + offset + 1))
    };
    let signed = |value: u16| value as i16;
    println!(
        "Sonic object: id=${:02X} routine=${:02X} x={}.{:04X} y={}.{:04X} xvel={} yvel={} inertia={} status=${:02X} anim=${:02X} angle=${:02X}",
        emulator.bus.peek_byte(sonic_obj),
        emulator.bus.peek_byte(sonic_obj + 1),
        sonic_word(0x08),
        sonic_word(0x0a),
        sonic_word(0x0c),
        sonic_word(0x0e),
        signed(sonic_word(0x10)),
        signed(sonic_word(0x12)),
        signed(sonic_word(0x14)),
        emulator.bus.peek_byte(sonic_obj + 0x22),
        emulator.bus.peek_byte(sonic_obj + 0x1c),
        emulator.bus.peek_byte(sonic_obj + 0x26)
    );
    let aa00_nonzero = (0..0x400)
        .filter(|offset| emulator.bus.peek_byte(0xffff_aa00 + offset) != 0)
        .count();
    print!("Sonic RAM aa00 nonzero {aa00_nonzero}/1024 first:");
    for offset in 0..16 {
        print!(" {:02X}", emulator.bus.peek_byte(0xffff_aa00 + offset));
    }
    println!();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStatus {
    loaded: bool,
    title: String,
    region: String,
    timing: String,
    reset_pc: u32,
    width: usize,
    height: usize,
    state_path: Option<String>,
    frame: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeFrame {
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
struct BridgeSlots {
    path: Option<String>,
    slots: Vec<BridgeSlot>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeSlot {
    slot: usize,
    occupied: bool,
    created_unix_ms: Option<u64>,
    frame_count: Option<u64>,
    label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInput {
    up: bool,
    down: bool,
    left: bool,
    right: bool,
    a: bool,
    b: bool,
    c: bool,
    start: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeBuildStatus {
    active_profile: String,
    requested_profile: String,
    building: bool,
    release_ready: bool,
    armed: bool,
    last_status: String,
    last_message: String,
    release_path: String,
    updated_unix_ms: u64,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[derive(Clone)]
struct BridgeState {
    emulator: Arc<Mutex<Emulator>>,
    next_frame_due: Arc<Mutex<Instant>>,
}

fn serve_web_bridge(emulator: Emulator, addr: &str) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    let state = BridgeState {
        emulator: Arc::new(Mutex::new(emulator)),
        next_frame_due: Arc::new(Mutex::new(Instant::now())),
    };
    println!("EutherOxide web bridge listening on http://{addr}");
    println!("Open http://127.0.0.1:5173/?bridge=http://{addr}");
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let state = state.clone();
                thread::spawn(move || {
                    if let Err(err) = handle_bridge_request(&mut stream, &state) {
                        let _ = send_error(&mut stream, 500, &err.to_string());
                    }
                });
            }
            Err(err) => eprintln!("bridge accept error: {err}"),
        }
    }
    Ok(())
}

fn handle_bridge_request(stream: &mut TcpStream, state: &BridgeState) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let request = read_http_request(stream)?;
    if request.method == "OPTIONS" {
        return send_empty(stream, 204);
    }

    let path = request.path.split('?').next().unwrap_or(&request.path);
    match (request.method.as_str(), path) {
        ("GET", "/status") => {
            let emulator = lock_bridge_emulator(state)?;
            send_json(stream, &bridge_status(&emulator))
        }
        ("GET", "/build/status") => send_json(stream, &bridge_build_status()),
        ("POST", "/build/release") => {
            start_release_build()?;
            send_json(stream, &bridge_build_status())
        }
        ("POST", "/build/profile") => {
            let profile = query_profile(&request.path)?;
            if profile == "release" && !release_binary_ready() {
                return send_error(stream, 409, "release binary is not ready");
            }
            set_requested_bridge_profile(profile)?;
            let status = bridge_build_status();
            let should_restart = status.active_profile != status.requested_profile;
            send_json(stream, &status)?;
            if should_restart {
                thread::spawn(|| {
                    thread::sleep(Duration::from_millis(120));
                    process::exit(0);
                });
            }
            Ok(())
        }
        ("POST", "/load") => {
            if request.body.is_empty() {
                return send_error(stream, 400, "empty ROM upload");
            }
            let mut emulator = lock_bridge_emulator(state)?;
            emulator.load_rom_bytes_with_path_hint(&request.body, upload_rom_name(&request));
            reset_bridge_pacer(state)?;
            send_json(stream, &bridge_status(&emulator))
        }
        ("GET", "/frame") | ("POST", "/frame") => {
            pace_bridge_frame(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                return send_error(stream, 409, "no ROM loaded");
            }
            let run = emulator.run_frame();
            send_json(stream, &bridge_frame(&emulator, &run))
        }
        ("GET", "/frame.bin") | ("POST", "/frame.bin") => {
            pace_bridge_frame(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                return send_error(stream, 409, "no ROM loaded");
            }
            let run = emulator.run_frame();
            send_response(
                stream,
                200,
                "application/octet-stream",
                &bridge_frame_bytes(&emulator, &run),
            )
        }
        ("GET", "/frame-audio.bin") | ("POST", "/frame-audio.bin") => {
            pace_bridge_frame(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                return send_error(stream, 409, "no ROM loaded");
            }
            let run = emulator.run_frame();
            send_response(
                stream,
                200,
                "application/octet-stream",
                &bridge_frame_audio_bytes(&mut emulator, &run, 44_100),
            )
        }
        ("GET", "/stream-frame-audio.bin") => bridge_stream_frame_audio(stream, state),
        ("GET", "/audio.bin") | ("POST", "/audio.bin") => {
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                return send_error(stream, 409, "no ROM loaded");
            }
            send_response(
                stream,
                200,
                "application/octet-stream",
                &bridge_audio_bytes(&mut emulator, 44_100),
            )
        }
        ("POST", "/reset") => {
            let mut emulator = lock_bridge_emulator(state)?;
            emulator.reset();
            reset_bridge_pacer(state)?;
            send_json(stream, &bridge_status(&emulator))
        }
        ("POST", "/input") => {
            let input: BridgeInput = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            let mut emulator = lock_bridge_emulator(state)?;
            apply_bridge_input(&mut emulator, input);
            send_empty(stream, 204)
        }
        ("GET", "/states") => {
            let emulator = lock_bridge_emulator(state)?;
            if emulator.rom_path.is_none() {
                return send_json(stream, &empty_bridge_slots());
            }
            let summary = euther_oxide::savestate::list_slots_for_emulator(&emulator)?;
            send_json(stream, &bridge_slots(summary))
        }
        ("POST", "/state/save") => {
            let emulator = lock_bridge_emulator(state)?;
            if emulator.rom_path.is_none() {
                return send_error(stream, 409, ".argon path unavailable for uploaded ROM");
            }
            let slot = query_slot(&request.path)?;
            let summary = euther_oxide::savestate::save_slot_for_emulator(&emulator, slot)?;
            send_json(stream, &bridge_slots(summary))
        }
        ("POST", "/state/load") => {
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.rom_path.is_none() {
                return send_error(stream, 409, ".argon path unavailable for uploaded ROM");
            }
            let slot = query_slot(&request.path)?;
            let summary = euther_oxide::savestate::load_slot_for_emulator(&mut emulator, slot)?;
            reset_bridge_pacer(state)?;
            send_json(
                stream,
                &serde_json::json!({
                    "frame": bridge_frame_without_run(&emulator),
                    "states": bridge_slots(summary),
                }),
            )
        }
        _ => send_error(stream, 404, "not found"),
    }
}

fn lock_bridge_emulator(state: &BridgeState) -> io::Result<std::sync::MutexGuard<'_, Emulator>> {
    state
        .emulator
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))
}

fn reset_bridge_pacer(state: &BridgeState) -> io::Result<()> {
    let mut next_frame_due = state
        .next_frame_due
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *next_frame_due = Instant::now();
    Ok(())
}

fn pace_bridge_frame(state: &BridgeState) -> io::Result<()> {
    let frame_rate = {
        let emulator = lock_bridge_emulator(state)?;
        emulator.frame_rate()
    };
    let frame_time = Duration::from_secs_f64(1.0 / frame_rate);
    let mut next_frame_due = state
        .next_frame_due
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let now = Instant::now();
    if *next_frame_due > now {
        thread::sleep(*next_frame_due - now);
    }
    let after_sleep = Instant::now();
    let base = if *next_frame_due > after_sleep {
        *next_frame_due
    } else {
        after_sleep
    };
    *next_frame_due = base + frame_time;
    Ok(())
}

fn read_http_request(stream: &mut TcpStream) -> io::Result<HttpRequest> {
    let mut data = Vec::new();
    let mut buffer = [0; 4096];
    let header_end = loop {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            return Err(invalid_request("empty request"));
        }
        data.extend_from_slice(&buffer[..read]);
        if let Some(index) = find_subslice(&data, b"\r\n\r\n") {
            break index + 4;
        }
        if data.len() > 64 * 1024 {
            return Err(invalid_request("request headers too large"));
        }
    };

    let headers = String::from_utf8_lossy(&data[..header_end]);
    let mut lines = headers.lines();
    let first = lines
        .next()
        .ok_or_else(|| invalid_request("missing request line"))?;
    let mut parts = first.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| invalid_request("missing method"))?
        .to_string();
    let path = parts
        .next()
        .ok_or_else(|| invalid_request("missing path"))?
        .to_string();
    let mut request_headers = Vec::new();
    let mut content_length = 0;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_string();
            let value = value.trim().to_string();
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse::<usize>().unwrap_or(0);
            }
            request_headers.push((name, value));
        }
    }

    while data.len() < header_end + content_length {
        let read = stream.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&buffer[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        headers: request_headers,
        body: data[header_end..header_end + content_length.min(data.len() - header_end)].to_vec(),
    })
}

fn send_json(stream: &mut TcpStream, value: &impl Serialize) -> io::Result<()> {
    let body = serde_json::to_vec(value).map_err(|err| invalid_request(err.to_string()))?;
    send_response(stream, 200, "application/json", &body)
}

fn send_empty(stream: &mut TcpStream, status: u16) -> io::Result<()> {
    send_response(stream, status, "text/plain", &[])
}

fn send_error(stream: &mut TcpStream, status: u16, message: &str) -> io::Result<()> {
    send_response(
        stream,
        status,
        "text/plain; charset=utf-8",
        message.as_bytes(),
    )
}

fn send_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name\r\n\
         Access-Control-Expose-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

fn send_stream_header(stream: &mut TcpStream, content_type: &str) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name\r\n\
         Access-Control-Expose-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Type: {content_type}\r\n\
         Connection: close\r\n\r\n",
    )
}

fn bridge_stream_frame_audio(stream: &mut TcpStream, state: &BridgeState) -> io::Result<()> {
    {
        let emulator = lock_bridge_emulator(state)?;
        if emulator.bus.rom.is_empty() {
            return send_error(stream, 409, "no ROM loaded");
        }
    }

    stream.set_nodelay(true)?;
    send_stream_header(stream, "application/octet-stream")?;
    loop {
        pace_bridge_frame(state)?;
        let (packet, stopped) = {
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                return Ok(());
            }
            let run = emulator.run_frame();
            let stopped = run.hit_unsupported_opcode;
            let packet = bridge_frame_audio_bytes(&mut emulator, &run, 44_100);
            (packet, stopped)
        };
        stream.write_all(&(packet.len() as u32).to_le_bytes())?;
        stream.write_all(&packet)?;
        stream.flush()?;
        if stopped {
            return Ok(());
        }
    }
}

fn bridge_status(emulator: &Emulator) -> BridgeStatus {
    let (width, height) = emulator.frame_size();
    let loaded = !emulator.bus.rom.is_empty();
    BridgeStatus {
        loaded,
        title: if loaded {
            title_from_header(emulator.rom_header.as_ref())
        } else {
            "No ROM".to_string()
        },
        region: region_name(emulator.region).to_string(),
        timing: timing_name(emulator.timing).to_string(),
        reset_pc: if loaded {
            reset_pc_from_rom(&emulator.bus.rom)
        } else {
            0
        },
        width,
        height,
        state_path: loaded
            .then(|| {
                emulator
                    .rom_path
                    .as_deref()
                    .map(euther_oxide::savestate::argon_path_for_rom)
                    .map(|path| path.display().to_string())
            })
            .flatten(),
        frame: emulator.frame_count,
    }
}

fn reset_pc_from_rom(rom: &[u8]) -> u32 {
    if rom.len() < 8 {
        return 0;
    }
    u32::from_be_bytes([rom[4], rom[5], rom[6], rom[7]])
}

fn upload_rom_name(request: &HttpRequest) -> PathBuf {
    let raw = header_value(request, "x-rom-name").unwrap_or("uploaded.md");
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let mut clean = String::new();
    for ch in leaf.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
            clean.push(ch);
        } else {
            clean.push('_');
        }
    }
    if clean.is_empty() || clean == "." || clean == ".." {
        clean = "uploaded.md".to_string();
    }
    PathBuf::from(clean)
}

fn header_value<'a>(request: &'a HttpRequest, name: &str) -> Option<&'a str> {
    request.headers.iter().find_map(|(header_name, value)| {
        header_name
            .eq_ignore_ascii_case(name)
            .then_some(value.as_str())
    })
}

fn bridge_frame(emulator: &Emulator, run: &FrameRun) -> BridgeFrame {
    let mut frame = bridge_frame_without_run(emulator);
    frame.cpu_cycles = run.cpu_cycles;
    frame.cpu_steps = run.cpu_steps;
    frame.frame_ms = run.elapsed.as_secs_f64() * 1000.0;
    frame.stopped = run.hit_unsupported_opcode;
    frame
}

fn bridge_frame_bytes(emulator: &Emulator, run: &FrameRun) -> Vec<u8> {
    let frame = bridge_frame(emulator, run);
    let mut bytes = Vec::with_capacity(32 + frame.rgba.len());
    bytes.extend_from_slice(b"EOXF");
    bytes.extend_from_slice(&(frame.frame.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.width as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.height as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.cpu_cycles.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.cpu_steps.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&((frame.frame_ms * 1000.0).max(0.0) as u32).to_le_bytes());
    bytes.extend_from_slice(&u32::from(frame.stopped).to_le_bytes());
    bytes.extend_from_slice(&frame.rgba);
    bytes
}

fn bridge_audio_bytes(emulator: &mut Emulator, sample_rate: usize) -> Vec<u8> {
    let samples = emulator.render_audio_frame_i16(sample_rate);
    let mut bytes = Vec::with_capacity(16 + samples.len() * 2);
    bytes.extend_from_slice(b"EOXA");
    bytes.extend_from_slice(&(emulator.frame_count.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn bridge_frame_audio_bytes(
    emulator: &mut Emulator,
    run: &FrameRun,
    sample_rate: usize,
) -> Vec<u8> {
    let frame = bridge_frame(emulator, run);
    let samples = emulator.render_audio_frame_i16(sample_rate);
    let rgba_len = frame.rgba.len();
    let pcm_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(48 + rgba_len + pcm_len);
    bytes.extend_from_slice(b"EOXB");
    bytes.extend_from_slice(&(frame.frame.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.width as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.height as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.cpu_cycles.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(frame.cpu_steps.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&((frame.frame_ms * 1000.0).max(0.0) as u32).to_le_bytes());
    bytes.extend_from_slice(&u32::from(frame.stopped).to_le_bytes());
    bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(rgba_len as u32).to_le_bytes());
    bytes.extend_from_slice(&(pcm_len as u32).to_le_bytes());
    bytes.extend_from_slice(&frame.rgba);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn bridge_frame_without_run(emulator: &Emulator) -> BridgeFrame {
    let (width, height) = emulator.frame_size();
    let mut rgba = Vec::with_capacity(width * height * 4);
    for &pixel in emulator.framebuffer().iter().take(width * height) {
        rgba.push(((pixel >> 16) & 0xff) as u8);
        rgba.push(((pixel >> 8) & 0xff) as u8);
        rgba.push((pixel & 0xff) as u8);
        rgba.push(0xff);
    }

    BridgeFrame {
        frame: emulator.frame_count,
        width,
        height,
        rgba,
        cpu_cycles: 0,
        cpu_steps: 0,
        frame_ms: 0.0,
        stopped: false,
        last_error: emulator.last_error.as_ref().map(|err| format!("{err:?}")),
    }
}

fn bridge_slots(summary: ArgonSummary) -> BridgeSlots {
    BridgeSlots {
        path: Some(summary.path),
        slots: summary
            .slots
            .into_iter()
            .map(|slot| BridgeSlot {
                slot: slot.slot,
                occupied: slot.occupied,
                created_unix_ms: slot.created_unix_ms,
                frame_count: slot.frame_count,
                label: slot.label,
            })
            .collect(),
    }
}

fn empty_bridge_slots() -> BridgeSlots {
    BridgeSlots {
        path: None,
        slots: (1..=euther_oxide::savestate::ARGON_SLOT_COUNT)
            .map(|slot| BridgeSlot {
                slot,
                occupied: false,
                created_unix_ms: None,
                frame_count: None,
                label: None,
            })
            .collect(),
    }
}

fn bridge_build_status() -> BridgeBuildStatus {
    let active_profile = active_bridge_profile();
    let requested_profile = requested_bridge_profile();
    let (last_status, last_message, updated_unix_ms) = read_build_status_file();
    let release_path = release_binary_path();
    let release_ready = release_binary_ready();
    let building = last_status == "building";
    let armed = active_profile == "release" && requested_profile == "release" && release_ready;

    BridgeBuildStatus {
        active_profile,
        requested_profile,
        building,
        release_ready,
        armed,
        last_status,
        last_message,
        release_path: release_path.display().to_string(),
        updated_unix_ms,
    }
}

fn start_release_build() -> io::Result<()> {
    if bridge_build_status().building {
        return Ok(());
    }
    ensure_bridge_control_dir()?;
    let status_path = build_status_path();
    fs::write(
        &status_path,
        format!(
            "state=building\nmessage=Building release binary\nupdated_unix_ms={}\nrelease_path={}\n",
            unix_ms_now(),
            release_binary_path().display()
        ),
    )?;
    Command::new("bash")
        .arg("scripts/build-release.sh")
        .spawn()
        .map(|_| ())
}

fn active_bridge_profile() -> String {
    env::var("EUTHER_BRIDGE_PROFILE").unwrap_or_else(|_| {
        env::current_exe()
            .ok()
            .and_then(|path| {
                path.components()
                    .any(|component| component.as_os_str() == "release")
                    .then_some("release".to_string())
            })
            .unwrap_or_else(|| "debug".to_string())
    })
}

fn requested_bridge_profile() -> String {
    fs::read_to_string(profile_path())
        .ok()
        .map(|profile| normalize_bridge_profile(profile.trim()))
        .unwrap_or_else(active_bridge_profile)
}

fn set_requested_bridge_profile(profile: &str) -> io::Result<()> {
    ensure_bridge_control_dir()?;
    fs::write(profile_path(), normalize_bridge_profile(profile))
}

fn normalize_bridge_profile(profile: &str) -> String {
    if profile == "release" {
        "release".to_string()
    } else {
        "debug".to_string()
    }
}

fn read_build_status_file() -> (String, String, u64) {
    let Some(content) = fs::read_to_string(build_status_path()).ok() else {
        return (
            if release_binary_ready() {
                "ready"
            } else {
                "missing"
            }
            .to_string(),
            if release_binary_ready() {
                "Release binary ready"
            } else {
                "No release binary built yet"
            }
            .to_string(),
            0,
        );
    };
    let mut state = "missing".to_string();
    let mut message = String::new();
    let mut updated_unix_ms = 0;
    for line in content.lines() {
        if let Some((key, value)) = line.split_once('=') {
            match key {
                "state" => state = value.trim().to_string(),
                "message" => message = value.trim().to_string(),
                "updated_unix_ms" => updated_unix_ms = value.trim().parse().unwrap_or(0),
                _ => {}
            }
        }
    }
    if message.is_empty() {
        message = state.clone();
    }
    (state, message, updated_unix_ms)
}

fn release_binary_ready() -> bool {
    release_binary_path()
        .metadata()
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

fn ensure_bridge_control_dir() -> io::Result<()> {
    fs::create_dir_all(bridge_control_dir())
}

fn bridge_control_dir() -> PathBuf {
    PathBuf::from(".euther-bridge")
}

fn profile_path() -> PathBuf {
    bridge_control_dir().join("profile")
}

fn build_status_path() -> PathBuf {
    bridge_control_dir().join("build-status")
}

fn release_binary_path() -> PathBuf {
    PathBuf::from("target/release/euther-oxide")
}

fn unix_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn apply_bridge_input(emulator: &mut Emulator, input: BridgeInput) {
    let pad = &mut emulator.bus.controller_a;
    pad.set_pressed(euther_oxide::controller::Controller::UP, input.up);
    pad.set_pressed(euther_oxide::controller::Controller::DOWN, input.down);
    pad.set_pressed(euther_oxide::controller::Controller::LEFT, input.left);
    pad.set_pressed(euther_oxide::controller::Controller::RIGHT, input.right);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_A, input.a);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_B, input.b);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_C, input.c);
    pad.set_pressed(euther_oxide::controller::Controller::START, input.start);
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

fn query_slot(path: &str) -> io::Result<usize> {
    path.split_once('?')
        .and_then(|(_, query)| {
            query.split('&').find_map(|pair| {
                let (name, value) = pair.split_once('=')?;
                (name == "slot")
                    .then(|| value.parse::<usize>().ok())
                    .flatten()
            })
        })
        .ok_or_else(|| invalid_request("missing slot query"))
}

fn query_profile(path: &str) -> io::Result<&'static str> {
    let profile = path
        .split_once('?')
        .and_then(|(_, query)| {
            query.split('&').find_map(|pair| {
                let (name, value) = pair.split_once('=')?;
                (name == "profile").then_some(value)
            })
        })
        .ok_or_else(|| invalid_request("missing profile query"))?;
    match profile {
        "debug" => Ok("debug"),
        "release" => Ok("release"),
        _ => Err(invalid_request("profile must be debug or release")),
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn invalid_request(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

fn write_ppm(
    path: &PathBuf,
    framebuffer: &[u32],
    (width, height): (usize, usize),
) -> io::Result<()> {
    let mut file = File::create(path)?;
    write!(file, "P6\n{} {}\n255\n", width, height)?;
    for &pixel in framebuffer.iter().take(width * height) {
        file.write_all(&[
            ((pixel >> 16) & 0xff) as u8,
            ((pixel >> 8) & 0xff) as u8,
            (pixel & 0xff) as u8,
        ])?;
    }
    Ok(())
}
