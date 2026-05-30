use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{self, Command};
use std::sync::{
    Arc, Condvar, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use argon2::password_hash::SaltString;
use argon2::{
    Argon2, PasswordHasher,
    password_hash::{PasswordHash, PasswordVerifier},
};
use euther_oxide::savestate::{ArgonSummary, list_slots_for_emulator};
use euther_oxide::{Emulator, FrameRun, RomHeader, SystemRegion, TimingMode};
use gilrs::{Axis, Button, Gilrs};
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
    let mut web_bridge_addr = "127.0.0.1:32161".to_string();
    let mut host_server = false;
    let mut host_hash_password: Option<String> = None;
    let mut eutherdogs_demo = false;
    let mut eutherdogs_config: Option<PathBuf> = None;
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
            "--web-bridge-addr" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--web-bridge-addr needs a bind address",
                    ));
                };
                web_bridge_addr = value;
            }
            "--host-server" => {
                host_server = true;
            }
            "--eutherdogs-demo" => {
                eutherdogs_demo = true;
            }
            "--eutherdogs-config" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--eutherdogs-config needs a TOML path",
                    ));
                };
                eutherdogs_config = Some(PathBuf::from(value));
            }
            "--host-hash-password" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--host-hash-password needs a password value",
                    ));
                };
                host_hash_password = Some(value);
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

    if let Some(password) = host_hash_password {
        println!("{}", hash_host_password(&password)?);
        return Ok(());
    }

    if eutherdogs_demo {
        run_eutherdogs_demo(eutherdogs_config.as_deref())?;
        return Ok(());
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
    } else if web_bridge || host_server {
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
        serve_web_bridge(emulator, &web_bridge_addr)?;
        return Ok(());
    }

    if host_server {
        serve_host_server(emulator)?;
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
        "usage: euther-oxide [rom.md|rom.bin|rom.smd] [--frames N] [--perf] [--dump frame.ppm] [--save-state 1|2|3] [--load-state 1|2|3] [--list-states] [--vdp-summary] [--web-bridge] [--web-bridge-addr HOST:PORT] [--host-server] [--host-hash-password PASSWORD] [--eutherdogs-demo] [--eutherdogs-config config.toml]"
    );
}

fn run_eutherdogs_demo(config_path: Option<&std::path::Path>) -> io::Result<()> {
    let config = if let Some(path) = config_path {
        let contents = fs::read_to_string(path)?;
        euther_oxide::eutherdogs::EutherDogsConfig::from_toml_str(&contents)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err.to_string()))?
    } else {
        euther_oxide::eutherdogs::demo_config()
    };
    let mut game = euther_oxide::eutherdogs::Game::new_mission_from_config(&config)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidInput, err.to_string()))?;
    for _ in 0..12 {
        game.tick(
            &[euther_oxide::eutherdogs::PlayerInput {
                player_index: 0,
                command: euther_oxide::eutherdogs::PlayerCommand::from_bits(
                    euther_oxide::eutherdogs::PlayerCommand::RIGHT
                        | euther_oxide::eutherdogs::PlayerCommand::SHOOT,
                ),
                weapon_slot: None,
                inspection_answer: None,
            }],
            euther_oxide::eutherdogs::FixedStep { ticks: 1 },
        );
    }
    println!(
        "EutherDogs demo: world={}x{} characters={} bullets={} audio_events={} highscores={}",
        game.world().width(),
        game.world().height(),
        game.characters().len(),
        game.bullets().len(),
        game.drain_audio_events().len(),
        config.high_score_table().entries().len()
    );
    Ok(())
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
        "Audio: Z80 pc=${:04X} cycles={} halted={} | YM writes {} key {}/{} dac en/data {}/{} frame samples {} peak {:.5} | PSG writes {}",
        emulator.z80.pc,
        emulator.z80.total_cycles,
        emulator.z80.halted,
        emulator.bus.ym2612.writes,
        emulator.bus.ym2612.key_on_active_writes,
        emulator.bus.ym2612.key_on_writes,
        emulator.bus.ym2612.dac_enable_writes,
        emulator.bus.ym2612.dac_data_writes,
        emulator.bus.ym2612.frame_jg_samples,
        emulator.bus.ym2612.frame_jg_peak,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInput {
    player: Option<u8>,
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
    player_slots: Arc<Mutex<[Option<BridgePlayerLease>; 2]>>,
    driver_client: Arc<Mutex<Option<BridgePlayerLease>>>,
    latest_packet: Arc<(Mutex<Option<BridgePacketSnapshot>>, Condvar)>,
    subscriber_count: Arc<Mutex<usize>>,
    runner_active: Arc<Mutex<bool>>,
    shutdown: Arc<AtomicBool>,
    gamepads: Arc<Mutex<GamepadReader>>,
    eutherdogs: Arc<Mutex<euther_oxide::eutherdogs::EutherDogsRuntime>>,
    eutherdogs_latest: Arc<Mutex<[Option<euther_oxide::eutherdogs::EutherDogsFrame>; 2]>>,
    eutherdogs_input_seq: Arc<Mutex<[u64; 2]>>,
    eutherdogs_runner_active: Arc<Mutex<bool>>,
    eutherdogs_last_poll: Arc<Mutex<Instant>>,
}

struct BridgePlayerLease {
    client_id: String,
    user: String,
    updated: Instant,
}

struct BridgePacketSnapshot {
    frame: u32,
    bytes: Vec<u8>,
    stopped: bool,
}

struct GamepadReader {
    gilrs: Option<Gilrs>,
    error: Option<String>,
}

#[derive(Clone)]
struct HostState {
    instances: Arc<Mutex<Vec<HostInstance>>>,
    next_instance_id: Arc<Mutex<u64>>,
    config: HostConfig,
    users: Arc<Mutex<Vec<HostUser>>>,
    sessions: Arc<Mutex<Vec<HostSession>>>,
    login_attempts: Arc<Mutex<Vec<LoginAttempt>>>,
    chat_messages: Arc<Mutex<Vec<HostChatMessage>>>,
    next_chat_id: Arc<Mutex<u64>>,
}

#[derive(Clone)]
struct HostInstance {
    id: String,
    name: String,
    bridge: BridgeState,
    host_owner: Option<String>,
    created_unix_ms: u64,
}

#[derive(Clone)]
struct HostConfig {
    bind: String,
    rom_dir: Option<String>,
    session_timeout_minutes: u64,
    login_rate_limit_window_secs: u64,
    login_rate_limit_max_attempts: usize,
    secure_cookies: bool,
    allowed_origins: Vec<String>,
}

#[derive(Clone)]
struct HostUser {
    name: String,
    password_hash: String,
    banned: bool,
    admin: bool,
}

struct HostSession {
    token: String,
    csrf_token: String,
    user: String,
    updated_unix_ms: u64,
}

struct LoginAttempt {
    remote_addr: String,
    username: String,
    unix_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostAuditEvent<'a> {
    event: &'a str,
    user: Option<&'a str>,
    remote_addr: &'a str,
    ok: bool,
    detail: &'a str,
    created_unix_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostChatMessage {
    id: u64,
    user: String,
    message: String,
    created_unix_ms: u64,
}

fn serve_web_bridge(emulator: Emulator, addr: &str) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    let state = new_bridge_state(emulator);
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

fn new_bridge_state(emulator: Emulator) -> BridgeState {
    BridgeState {
        emulator: Arc::new(Mutex::new(emulator)),
        next_frame_due: Arc::new(Mutex::new(Instant::now())),
        player_slots: Arc::new(Mutex::new([None, None])),
        driver_client: Arc::new(Mutex::new(None)),
        latest_packet: Arc::new((Mutex::new(None), Condvar::new())),
        subscriber_count: Arc::new(Mutex::new(0)),
        runner_active: Arc::new(Mutex::new(false)),
        shutdown: Arc::new(AtomicBool::new(false)),
        gamepads: Arc::new(Mutex::new(GamepadReader::new())),
        eutherdogs: Arc::new(Mutex::new(
            euther_oxide::eutherdogs::EutherDogsRuntime::demo(),
        )),
        eutherdogs_latest: Arc::new(Mutex::new([None, None])),
        eutherdogs_input_seq: Arc::new(Mutex::new([0, 0])),
        eutherdogs_runner_active: Arc::new(Mutex::new(false)),
        eutherdogs_last_poll: Arc::new(Mutex::new(Instant::now())),
    }
}

fn serve_host_server(emulator: Emulator) -> io::Result<()> {
    let config = load_host_config()?;
    if let Some(rom_dir) = config.rom_dir.as_deref() {
        let canonical = validate_rom_root(rom_dir)?;
        write_rom_dir_setting(&canonical)?;
    }
    let users = Arc::new(Mutex::new(load_host_users()?));
    let chat_messages = load_host_chat_messages()?;
    let next_chat_id = chat_messages
        .iter()
        .map(|message| message.id)
        .max()
        .unwrap_or(0)
        + 1;
    let listener = TcpListener::bind(&config.bind)?;
    let bridge = new_bridge_state(emulator);
    let instances = Arc::new(Mutex::new(vec![HostInstance {
        id: "main".to_string(),
        name: "Main Reaction Vessel".to_string(),
        bridge: bridge.clone(),
        host_owner: None,
        created_unix_ms: unix_ms_now(),
    }]));
    let state = HostState {
        instances,
        next_instance_id: Arc::new(Mutex::new(2)),
        config,
        users,
        sessions: Arc::new(Mutex::new(Vec::new())),
        login_attempts: Arc::new(Mutex::new(Vec::new())),
        chat_messages: Arc::new(Mutex::new(chat_messages)),
        next_chat_id: Arc::new(Mutex::new(next_chat_id)),
    };
    println!(
        "EutherHost reaction chamber listening on http://{}",
        state.config.bind
    );
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let state = state.clone();
                thread::spawn(move || {
                    if let Err(err) = handle_host_request(&mut stream, &state) {
                        let _ = send_error(&mut stream, 500, &err.to_string());
                    }
                });
            }
            Err(err) => eprintln!("host accept error: {err}"),
        }
    }
    Ok(())
}

fn handle_host_request(stream: &mut TcpStream, state: &HostState) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let request = read_http_request(stream)?;
    if request.method == "OPTIONS" {
        return send_empty(stream, 204);
    }
    let path = request.path.split('?').next().unwrap_or(&request.path);
    if request.method != "GET" && path != "/api/login" && !valid_csrf_token(state, &request)? {
        return send_error(stream, 403, "csrf token required");
    }
    match (request.method.as_str(), path) {
        ("GET", "/login") => send_login_page(stream, None),
        ("POST", "/api/login") => host_login(stream, state, &request),
        ("POST", "/api/logout") => host_logout(stream, state, &request),
        ("GET", "/api/auth/status") => {
            if let Some(user) = authenticated_user(state, &request)? {
                let csrf_token = csrf_token_for_request(state, &request)?;
                send_json(
                    stream,
                    &serde_json::json!({
                        "authenticated": true,
                        "user": user,
                        "isAdmin": is_host_admin(state, &user)?,
                        "csrfToken": csrf_token,
                    }),
                )
            } else {
                send_json(stream, &serde_json::json!({ "authenticated": false }))
            }
        }
        ("GET", "/api/lobby") => {
            require_host_user(state, &request)?;
            send_json(stream, &host_lobby_status(state)?)
        }
        ("POST", "/api/lobby/start") => {
            let user = require_host_user(state, &request)?;
            let instance_id = create_host_instance(state, &user)?;
            send_json(
                stream,
                &serde_json::json!({
                    "instance": host_lobby_status(state)?,
                    "id": instance_id,
                }),
            )
        }
        ("POST", "/api/lobby/join") => {
            let client_id = query_string_value(&request.path, "client")?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_request("missing client id"))?;
            let requested =
                query_string_value(&request.path, "player")?.unwrap_or_else(|| "auto".to_string());
            let user = require_host_user(state, &request)?;
            let bridge = host_instance_bridge(state, &host_instance_id(&request.path)?)?;
            let role = join_lobby_instance(&bridge, &client_id, &user, &requested)?;
            send_json(
                stream,
                &serde_json::json!({
                    "instance": host_lobby_status(state)?,
                    "role": role,
                }),
            )
        }
        ("POST", "/api/lobby/release") => {
            require_host_user(state, &request)?;
            let client_id = query_string_value(&request.path, "client")?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_request("missing client id"))?;
            let bridge = host_instance_bridge(state, &host_instance_id(&request.path)?)?;
            release_lobby_client(&bridge, &client_id)?;
            send_json(stream, &host_lobby_status(state)?)
        }
        ("POST", "/api/lobby/kick") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            if let Err(err) = require_host_owner(state, &instance_id, &user) {
                return send_error(stream, 403, &err.to_string());
            }
            let player = query_string_value(&request.path, "player")?
                .and_then(|value| value.parse::<usize>().ok())
                .filter(|player| *player == 1 || *player == 2)
                .ok_or_else(|| invalid_request("player must be 1 or 2"))?;
            let bridge = host_instance_bridge(state, &instance_id)?;
            release_lobby_player(&bridge, player - 1)?;
            clear_bridge_input(&bridge, player - 1)?;
            send_json(stream, &host_lobby_status(state)?)
        }
        ("POST", "/api/lobby/close") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            if let Err(err) = require_host_owner(state, &instance_id, &user) {
                return send_error(stream, 403, &err.to_string());
            }
            close_host_instance(state, &instance_id)?;
            send_json(stream, &host_lobby_status(state)?)
        }
        ("GET", "/api/chat") => {
            require_host_user(state, &request)?;
            send_json(stream, &host_chat_list(state)?)
        }
        ("POST", "/api/chat") => {
            let user = require_host_user(state, &request)?;
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let message = form_value(&form, "message").unwrap_or_default();
            post_host_chat_message(state, &user, &message)?;
            send_json(stream, &host_chat_list(state)?)
        }
        ("GET", "/api/admin/users") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            send_json(stream, &host_user_list(state)?)
        }
        ("POST", "/api/admin/users/create") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let username = form_value(&form, "username").unwrap_or_default();
            let password = form_value(&form, "password").unwrap_or_default();
            create_host_user(state, &username, &password)?;
            send_json(stream, &host_user_list(state)?)
        }
        ("POST", "/api/admin/users/password") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let username = form_value(&form, "username").unwrap_or_default();
            let password = form_value(&form, "password").unwrap_or_default();
            set_host_user_password(state, &username, &password)?;
            send_json(stream, &host_user_list(state)?)
        }
        ("POST", "/api/admin/users/ban") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let username = form_value(&form, "username").unwrap_or_default();
            let banned =
                form_value(&form, "banned").is_some_and(|value| value == "true" || value == "1");
            set_host_user_banned(state, &username, banned)?;
            send_json(stream, &host_user_list(state)?)
        }
        ("POST", "/api/admin/users/admin") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let username = form_value(&form, "username").unwrap_or_default();
            let admin =
                form_value(&form, "admin").is_some_and(|value| value == "true" || value == "1");
            set_host_user_admin(state, &username, admin)?;
            send_json(stream, &host_user_list(state)?)
        }
        ("POST", "/api/admin/invites/placeholder") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let email = form_value(&form, "email").unwrap_or_default();
            send_json(
                stream,
                &serde_json::json!({
                    "queued": false,
                    "email": email,
                    "message": "email invites are a placeholder"
                }),
            )
        }
        _ => {
            let Some(user) = authenticated_user(state, &request)? else {
                return if path.starts_with("/api/") {
                    send_error(stream, 401, "login required")
                } else {
                    send_login_page(stream, None)
                };
            };
            if request.method != "GET" && !valid_csrf_token(state, &request)? {
                return send_error(stream, 403, "csrf token required");
            }
            if path == "/" || path == "/index.html" || path.starts_with("/assets/") {
                return send_host_static(stream, path);
            }
            let instance_id = host_instance_id(&request.path)?;
            let bridge = host_instance_bridge(state, &instance_id)?;
            if host_route_requires_origin_check(path) && !valid_request_origin(state, &request)? {
                return send_error(stream, 403, "origin rejected");
            }
            if host_route_requires_owner(path, &request.method) {
                if let Err(err) = require_host_owner(state, &instance_id, &user) {
                    return send_error(stream, 403, &err.to_string());
                }
            }
            let audit_rom_launch =
                request.method == "POST" && matches!(path, "/load" | "/rom-dir/load");
            let audit_detail = if path == "/rom-dir/load" {
                query_string_value(&request.path, "path")?.unwrap_or_default()
            } else {
                upload_rom_name(&request).to_string_lossy().to_string()
            };
            let result = handle_bridge_route_with_user(stream, &bridge, request, Some(&user));
            if audit_rom_launch {
                let remote_addr = stream
                    .peer_addr()
                    .map(|addr| addr.ip().to_string())
                    .unwrap_or_else(|_| "unknown".to_string());
                audit_host_event(
                    state,
                    "rom_launch",
                    Some(&user),
                    &remote_addr,
                    result.is_ok(),
                    &audit_detail,
                )?;
            }
            result
        }
    }
}

fn host_login(stream: &mut TcpStream, state: &HostState, request: &HttpRequest) -> io::Result<()> {
    let form = parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
    let remote_addr = stream
        .peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let username = form
        .iter()
        .find_map(|(name, value)| (name == "username").then_some(value.as_str()))
        .unwrap_or_default();
    let password = form
        .iter()
        .find_map(|(name, value)| (name == "password").then_some(value.as_str()))
        .unwrap_or_default();
    if login_rate_limited(state, &remote_addr, username)? {
        audit_host_event(
            state,
            "login",
            Some(username),
            &remote_addr,
            false,
            "rate_limited",
        )?;
        return send_response_with_headers(
            stream,
            429,
            "text/html; charset=utf-8",
            login_page_html(Some("Too many attempts; wait before retrying")).as_bytes(),
            &[("Retry-After", "60")],
        );
    }
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(user) = users.iter().find(|user| user.name == username) else {
        record_login_failure(state, &remote_addr, username)?;
        audit_host_event(
            state,
            "login",
            Some(username),
            &remote_addr,
            false,
            "unknown_user",
        )?;
        return send_login_page(stream, Some("Login rejected"));
    };
    if user.banned {
        record_login_failure(state, &remote_addr, username)?;
        audit_host_event(
            state,
            "login",
            Some(username),
            &remote_addr,
            false,
            "banned_user",
        )?;
        return send_login_page(stream, Some("Login rejected"));
    }
    if !verify_password(password, &user.password_hash) {
        record_login_failure(state, &remote_addr, username)?;
        audit_host_event(
            state,
            "login",
            Some(username),
            &remote_addr,
            false,
            "bad_password",
        )?;
        return send_login_page(stream, Some("Login rejected"));
    }
    let token = random_token()?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    sessions.push(HostSession {
        token: token.clone(),
        csrf_token: random_token()?,
        user: user.name.clone(),
        updated_unix_ms: unix_ms_now(),
    });
    clear_login_failures(state, &remote_addr, username)?;
    audit_host_event(state, "login", Some(username), &remote_addr, true, "ok")?;
    let cookie = host_session_cookie(state, &token, None);
    send_response_with_headers(
        stream,
        303,
        "text/plain; charset=utf-8",
        b"",
        &[("Location", "/?eutherdogs=1"), ("Set-Cookie", &cookie)],
    )
}

fn host_logout(stream: &mut TcpStream, state: &HostState, request: &HttpRequest) -> io::Result<()> {
    if let Some(token) = session_token(request) {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        sessions.retain(|session| session.token != token);
    }
    let cookie = host_session_cookie(state, "", Some(0));
    send_response_with_headers(
        stream,
        303,
        "text/plain; charset=utf-8",
        b"",
        &[("Location", "/login"), ("Set-Cookie", &cookie)],
    )
}

fn authenticated_user(state: &HostState, request: &HttpRequest) -> io::Result<Option<String>> {
    let Some(token) = session_token(request) else {
        return Ok(None);
    };
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let now = unix_ms_now();
    let timeout_ms = state
        .config
        .session_timeout_minutes
        .saturating_mul(60 * 1000);
    sessions.retain(|session| now.saturating_sub(session.updated_unix_ms) < timeout_ms);
    if let Some(session) = sessions.iter_mut().find(|session| session.token == token) {
        let users = state
            .users
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        if users
            .iter()
            .any(|user| user.name == session.user && user.banned)
        {
            return Ok(None);
        }
        session.updated_unix_ms = now;
        return Ok(Some(session.user.clone()));
    }
    Ok(None)
}

fn require_host_user(state: &HostState, request: &HttpRequest) -> io::Result<String> {
    authenticated_user(state, request)?.ok_or_else(|| invalid_request("login required"))
}

fn is_host_admin(state: &HostState, username: &str) -> io::Result<bool> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(users
        .iter()
        .any(|user| user.name == username && user.admin && !user.banned))
}

fn require_host_admin(state: &HostState, request: &HttpRequest) -> io::Result<String> {
    let user = require_host_user(state, request)?;
    if is_host_admin(state, &user)? {
        Ok(user)
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "admin user required",
        ))
    }
}

fn host_instance_id(path: &str) -> io::Result<String> {
    Ok(query_string_value(path, "instance")?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string()))
}

fn create_host_instance(state: &HostState, user: &str) -> io::Result<String> {
    let mut next = state
        .next_instance_id
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let id = format!("vessel-{}", *next);
    *next += 1;
    let name = format!("Reaction Vessel {}", id.trim_start_matches("vessel-"));
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    instances.push(HostInstance {
        id: id.clone(),
        name,
        bridge: new_bridge_state(Emulator::new()),
        host_owner: Some(user.to_string()),
        created_unix_ms: unix_ms_now(),
    });
    Ok(id)
}

fn host_instance_bridge(state: &HostState, instance_id: &str) -> io::Result<BridgeState> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    instances
        .iter()
        .find(|instance| instance.id == instance_id)
        .map(|instance| instance.bridge.clone())
        .ok_or_else(|| invalid_request("instance not found"))
}

fn close_host_instance(state: &HostState, instance_id: &str) -> io::Result<()> {
    if instance_id == "main" {
        return Err(invalid_request("main instance cannot close"));
    }
    let bridge = {
        let mut instances = state
            .instances
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        let Some(index) = instances
            .iter()
            .position(|instance| instance.id == instance_id)
        else {
            return Err(invalid_request("instance not found"));
        };
        instances.remove(index).bridge
    };
    stop_bridge_state(&bridge)
}

fn require_host_owner(state: &HostState, instance_id: &str, user: &str) -> io::Result<()> {
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(instance) = instances
        .iter_mut()
        .find(|instance| instance.id == instance_id)
    else {
        return Err(invalid_request("instance not found"));
    };
    if instance.host_owner.is_none() {
        instance.host_owner = Some(user.to_string());
    }
    if instance.host_owner.as_deref() == Some(user) {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "host owner required",
        ))
    }
}

fn host_route_requires_owner(path: &str, method: &str) -> bool {
    matches!(
        (method, path),
        ("POST", "/load")
            | ("POST", "/reset")
            | ("POST", "/rom-dir/load")
            | ("POST", "/state/save")
            | ("POST", "/state/load")
    )
}

fn host_route_requires_origin_check(path: &str) -> bool {
    matches!(
        path,
        "/stream-frame-audio.bin" | "/stream-frame.bin" | "/eutherdogs/stream"
    )
}

fn host_lobby_status(state: &HostState) -> io::Result<serde_json::Value> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let mut payload = Vec::with_capacity(instances.len());
    for instance in instances.iter() {
        let emulator = lock_bridge_emulator(&instance.bridge)?;
        let status = bridge_status(&emulator);
        let slots = bridge_player_slots_json(&instance.bridge)?;
        let subscribers = bridge_subscriber_count(&instance.bridge)?;
        payload.push(serde_json::json!({
            "id": instance.id,
            "name": instance.name,
            "loaded": status.loaded,
            "title": status.title,
            "frame": status.frame,
            "players": slots,
            "subscribers": subscribers,
            "spectators": subscribers.saturating_sub(2),
            "host": instance.host_owner,
            "createdUnixMs": instance.created_unix_ms,
        }));
    }
    Ok(serde_json::json!({
        "instances": payload
    }))
}

fn bridge_player_slots_json(state: &BridgeState) -> io::Result<Vec<serde_json::Value>> {
    let slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let now = Instant::now();
    Ok(slots
        .iter()
        .enumerate()
        .map(|(index, slot)| {
            let active = slot
                .as_ref()
                .is_some_and(|lease| now.duration_since(lease.updated) <= Duration::from_secs(8));
            serde_json::json!({
                "player": index + 1,
                "occupied": active,
                "user": slot.as_ref().filter(|_| active).map(|lease| lease.user.clone()),
            })
        })
        .collect())
}

fn host_chat_list(state: &HostState) -> io::Result<serde_json::Value> {
    let messages = state
        .chat_messages
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(serde_json::json!({ "messages": &*messages }))
}

fn post_host_chat_message(state: &HostState, user: &str, message: &str) -> io::Result<()> {
    let message = message.trim();
    if message.is_empty() {
        return Err(invalid_request("message is empty"));
    }
    let message: String = message.chars().take(320).collect();
    let mut next_id = state
        .next_chat_id
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let mut messages = state
        .chat_messages
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let entry = HostChatMessage {
        id: *next_id,
        user: user.to_string(),
        message,
        created_unix_ms: unix_ms_now(),
    };
    append_host_chat_message(&entry)?;
    messages.push(entry);
    *next_id += 1;
    if messages.len() > 80 {
        let excess = messages.len() - 80;
        messages.drain(0..excess);
    }
    Ok(())
}

fn join_lobby_instance(
    state: &BridgeState,
    client_id: &str,
    user: &str,
    requested: &str,
) -> io::Result<serde_json::Value> {
    let choices: &[usize] = match requested {
        "1" | "p1" | "P1" => &[0],
        "2" | "p2" | "P2" => &[1],
        _ => &[0, 1],
    };
    for &player_index in choices {
        if claim_bridge_player(state, client_id, user, player_index).is_ok() {
            return Ok(serde_json::json!({
                "kind": "player",
                "player": player_index + 1,
                "user": user,
            }));
        }
    }
    Ok(serde_json::json!({
        "kind": "spectator",
        "player": null,
    }))
}

fn release_lobby_client(state: &BridgeState, client_id: &str) -> io::Result<()> {
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    for slot in slots.iter_mut() {
        if slot
            .as_ref()
            .is_some_and(|lease| lease.client_id == client_id)
        {
            *slot = None;
        }
    }
    Ok(())
}

fn release_lobby_player(state: &BridgeState, player_index: usize) -> io::Result<()> {
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if player_index < slots.len() {
        slots[player_index] = None;
    }
    Ok(())
}

fn clear_bridge_input(state: &BridgeState, player_index: usize) -> io::Result<()> {
    let mut emulator = lock_bridge_emulator(state)?;
    let input = BridgeInput {
        player: Some((player_index + 1) as u8),
        up: false,
        down: false,
        left: false,
        right: false,
        a: false,
        b: false,
        c: false,
        start: false,
    };
    apply_bridge_input(&mut emulator, input);
    Ok(())
}

fn host_user_list(state: &HostState) -> io::Result<serde_json::Value> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(serde_json::json!({
        "users": users
            .iter()
            .map(|user| serde_json::json!({
                "name": user.name,
                "banned": user.banned,
                "admin": user.admin,
            }))
            .collect::<Vec<_>>()
    }))
}

fn create_host_user(state: &HostState, username: &str, password: &str) -> io::Result<()> {
    validate_host_username(username)?;
    if password.len() < 6 {
        return Err(invalid_request("password must be at least 6 characters"));
    }
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if users.iter().any(|user| user.name == username) {
        return Err(invalid_request("user already exists"));
    }
    users.push(HostUser {
        name: username.to_string(),
        password_hash: hash_host_password(password)?,
        banned: false,
        admin: username == "nichlas",
    });
    save_host_users(&users)
}

fn set_host_user_password(state: &HostState, username: &str, password: &str) -> io::Result<()> {
    if password.len() < 6 {
        return Err(invalid_request("password must be at least 6 characters"));
    }
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(user) = users.iter_mut().find(|user| user.name == username) else {
        return Err(invalid_request("user not found"));
    };
    user.password_hash = hash_host_password(password)?;
    save_host_users(&users)
}

fn set_host_user_banned(state: &HostState, username: &str, banned: bool) -> io::Result<()> {
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let admin_count = users
        .iter()
        .filter(|user| user.admin && !user.banned)
        .count();
    let Some(user) = users.iter_mut().find(|user| user.name == username) else {
        return Err(invalid_request("user not found"));
    };
    if banned && user.admin && !user.banned && admin_count <= 1 {
        return Err(invalid_request("at least one active admin is required"));
    }
    user.banned = banned;
    save_host_users(&users)
}

fn set_host_user_admin(state: &HostState, username: &str, admin: bool) -> io::Result<()> {
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let admin_count = users
        .iter()
        .filter(|user| user.admin && !user.banned)
        .count();
    let Some(user) = users.iter_mut().find(|user| user.name == username) else {
        return Err(invalid_request("user not found"));
    };
    if !admin && user.admin && admin_count <= 1 {
        return Err(invalid_request("at least one active admin is required"));
    }
    user.admin = admin;
    save_host_users(&users)
}

fn validate_host_username(username: &str) -> io::Result<()> {
    if username.is_empty()
        || username.len() > 32
        || !username
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(invalid_request(
            "username must be 1-32 ascii letters, numbers, - or _",
        ));
    }
    Ok(())
}

fn session_token(request: &HttpRequest) -> Option<String> {
    header_value(request, "cookie").and_then(|cookies| {
        cookies.split(';').find_map(|cookie| {
            let (name, value) = cookie.trim().split_once('=')?;
            (name == "euther_session").then(|| value.to_string())
        })
    })
}

fn csrf_token_for_request(state: &HostState, request: &HttpRequest) -> io::Result<Option<String>> {
    let Some(token) = session_token(request) else {
        return Ok(None);
    };
    let sessions = state
        .sessions
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(sessions
        .iter()
        .find(|session| session.token == token)
        .map(|session| session.csrf_token.clone()))
}

fn valid_csrf_token(state: &HostState, request: &HttpRequest) -> io::Result<bool> {
    let Some(expected) = csrf_token_for_request(state, request)? else {
        return Ok(false);
    };
    let Some(provided) = header_value(request, "x-csrf-token") else {
        return Ok(false);
    };
    Ok(provided.as_bytes() == expected.as_bytes())
}

fn host_session_cookie(state: &HostState, token: &str, max_age: Option<u64>) -> String {
    let mut cookie = format!("euther_session={token}; HttpOnly; SameSite=Lax; Path=/");
    if state.config.secure_cookies {
        cookie.push_str("; Secure");
    }
    if let Some(max_age) = max_age {
        cookie.push_str(&format!("; Max-Age={max_age}"));
    }
    cookie
}

fn login_rate_limited(state: &HostState, remote_addr: &str, username: &str) -> io::Result<bool> {
    let now = unix_ms_now();
    let window_ms = state
        .config
        .login_rate_limit_window_secs
        .saturating_mul(1000);
    let username = username.trim().to_ascii_lowercase();
    let mut attempts = state
        .login_attempts
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    attempts.retain(|attempt| now.saturating_sub(attempt.unix_ms) < window_ms);
    let ip_count = attempts
        .iter()
        .filter(|attempt| attempt.remote_addr == remote_addr)
        .count();
    let username_count = attempts
        .iter()
        .filter(|attempt| attempt.username == username)
        .count();
    Ok(ip_count >= state.config.login_rate_limit_max_attempts
        || username_count >= state.config.login_rate_limit_max_attempts)
}

fn record_login_failure(state: &HostState, remote_addr: &str, username: &str) -> io::Result<()> {
    let mut attempts = state
        .login_attempts
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    attempts.push(LoginAttempt {
        remote_addr: remote_addr.to_string(),
        username: username.trim().to_ascii_lowercase(),
        unix_ms: unix_ms_now(),
    });
    Ok(())
}

fn clear_login_failures(state: &HostState, remote_addr: &str, username: &str) -> io::Result<()> {
    let username = username.trim().to_ascii_lowercase();
    let mut attempts = state
        .login_attempts
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    attempts
        .retain(|attempt| !(attempt.remote_addr == remote_addr && attempt.username == username));
    Ok(())
}

fn audit_host_event(
    _state: &HostState,
    event: &str,
    user: Option<&str>,
    remote_addr: &str,
    ok: bool,
    detail: &str,
) -> io::Result<()> {
    let audit = HostAuditEvent {
        event,
        user,
        remote_addr,
        ok,
        detail,
        created_unix_ms: unix_ms_now(),
    };
    append_host_audit_event(&audit)
}

fn valid_request_origin(state: &HostState, request: &HttpRequest) -> io::Result<bool> {
    let Some(origin) = header_value(request, "origin") else {
        return Ok(true);
    };
    if origin == "null" {
        return Ok(false);
    }
    if state
        .config
        .allowed_origins
        .iter()
        .any(|allowed| allowed == origin)
    {
        return Ok(true);
    }
    let Some(host) = header_value(request, "host") else {
        return Ok(false);
    };
    Ok(origin_host(origin).as_deref() == Some(host))
}

fn origin_host(origin: &str) -> Option<String> {
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))?;
    Some(rest.split('/').next()?.to_string())
}

fn send_host_static(stream: &mut TcpStream, path: &str) -> io::Result<()> {
    let relative = if path == "/" || path == "/index.html" {
        PathBuf::from("index.html")
    } else {
        PathBuf::from(path.trim_start_matches('/'))
    };
    if relative
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return send_error(stream, 404, "not found");
    }
    let file_path = PathBuf::from("dist").join(relative);
    let bytes = fs::read(&file_path)?;
    let content_type = match file_path
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    };
    send_response(stream, 200, content_type, &bytes)
}

fn send_login_page(stream: &mut TcpStream, error: Option<&str>) -> io::Result<()> {
    let body = login_page_html(error);
    send_response(stream, 200, "text/html; charset=utf-8", body.as_bytes())
}

fn login_page_html(error: Option<&str>) -> String {
    let error_html = error
        .map(|error| format!("<p class=\"error\">{}</p>", html_escape(error)))
        .unwrap_or_default();
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EutherHost Login</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #050806; color: #edf6dd; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; background: radial-gradient(circle at 20% 10%, rgba(90,134,69,.28), transparent 28%), linear-gradient(135deg,#060706,#15120d 55%,#08120e); }}
    main {{ width: min(420px, calc(100vw - 32px)); display: grid; gap: 18px; padding: 24px; border: 1px solid rgba(210,238,177,.18); border-radius: 8px; background: rgba(10,17,12,.84); box-shadow: 0 24px 90px rgba(0,0,0,.42); }}
    h1 {{ margin: 0; font-size: 1.5rem; }}
    p {{ margin: 0; color: #9fbe91; font-weight: 800; text-transform: uppercase; font-size: .76rem; letter-spacing: .08em; }}
    form {{ display: grid; gap: 12px; }}
    input, button {{ min-height: 44px; border-radius: 8px; font: inherit; }}
    input {{ border: 1px solid rgba(207,240,178,.18); background: rgba(5,11,8,.86); color: #edf6dd; padding: 0 12px; }}
    button {{ border: 1px solid rgba(247,101,82,.58); background: linear-gradient(135deg, rgba(128,43,33,.82), rgba(80,88,35,.72)); color: #fff4c6; font-weight: 900; cursor: pointer; }}
    .error {{ color: #ff9a8f; text-transform: none; letter-spacing: 0; }}
  </style>
</head>
<body>
  <main>
    <p>EutherHost Reaction Gate</p>
    <h1>Private Alkene Chamber</h1>
    {error_html}
    <form method="post" action="/api/login">
      <input name="username" autocomplete="username" placeholder="User" required />
      <input name="password" type="password" autocomplete="current-password" placeholder="Password" required />
      <button type="submit">Bond Session</button>
    </form>
  </main>
</body>
</html>"#
    )
}

fn handle_bridge_request(stream: &mut TcpStream, state: &BridgeState) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let request = read_http_request(stream)?;
    handle_bridge_route(stream, state, request)
}

fn handle_bridge_route(
    stream: &mut TcpStream,
    state: &BridgeState,
    request: HttpRequest,
) -> io::Result<()> {
    handle_bridge_route_with_user(stream, state, request, None)
}

fn handle_bridge_route_with_user(
    stream: &mut TcpStream,
    state: &BridgeState,
    request: HttpRequest,
    user: Option<&str>,
) -> io::Result<()> {
    if request.method == "OPTIONS" {
        return send_empty(stream, 204);
    }

    let route_user = user.unwrap_or("dev");
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
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            clear_bridge_player(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            emulator.load_rom_bytes_with_path_hint(&request.body, upload_rom_name(&request));
            reset_bridge_pacer(state)?;
            send_json(stream, &bridge_status(&emulator))
        }
        ("GET", "/frame") | ("POST", "/frame") => {
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            match claim_bridge_driver(state, &client_id) {
                Ok(true) => {}
                Ok(false) => return send_error(stream, 409, "bridge driver busy"),
                Err(err) => return send_error(stream, 409, &err.to_string()),
            }
            if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            pace_bridge_frame(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                return send_error(stream, 409, "no ROM loaded");
            }
            let run = emulator.run_frame();
            send_json(stream, &bridge_frame(&emulator, &run))
        }
        ("GET", "/frame.bin") | ("POST", "/frame.bin") => {
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            match claim_bridge_driver(state, &client_id) {
                Ok(true) => {}
                Ok(false) => return send_error(stream, 409, "bridge driver busy"),
                Err(err) => return send_error(stream, 409, &err.to_string()),
            }
            if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
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
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            match claim_bridge_driver(state, &client_id) {
                Ok(true) => {}
                Ok(false) => return send_error(stream, 409, "bridge driver busy"),
                Err(err) => return send_error(stream, 409, &err.to_string()),
            }
            if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
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
        ("GET", "/stream-frame-audio.bin") => {
            let client_id = bridge_client_id(&request)?;
            let spectator =
                query_string_value(&request.path, "role")?.as_deref() == Some("spectator");
            let player_index = if spectator {
                None
            } else {
                let player_index = bridge_player_index(&request)?;
                if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                    return send_error(stream, 409, &err.to_string());
                }
                Some(player_index)
            };
            bridge_stream_frame_audio(stream, state, client_id, player_index)
        }
        ("GET", "/audio.bin") | ("POST", "/audio.bin") => {
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            match claim_bridge_driver(state, &client_id) {
                Ok(true) => {}
                Ok(false) => return send_error(stream, 409, "bridge driver busy"),
                Err(err) => return send_error(stream, 409, &err.to_string()),
            }
            if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
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
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            clear_bridge_player(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            emulator.reset();
            reset_bridge_pacer(state)?;
            send_json(stream, &bridge_status(&emulator))
        }
        ("POST", "/input") => {
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            let input: BridgeInput = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            let mut emulator = lock_bridge_emulator(state)?;
            apply_bridge_input(&mut emulator, input);
            send_empty(stream, 204)
        }
        ("POST", "/eutherdogs/start") => {
            let start = if request.body.is_empty() {
                euther_oxide::eutherdogs::EutherDogsStart {
                    staff: None,
                    mission: None,
                    players: Some(2),
                    characters: None,
                }
            } else {
                serde_json::from_slice(&request.body)
                    .map_err(|err| invalid_request(err.to_string()))?
            };
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            let frame = dogs
                .start(start)
                .map_err(|err| invalid_request(err.to_string()))?;
            drop(dogs);
            publish_eutherdogs_initial_frame(state, frame.clone())?;
            send_json(stream, &frame)
        }
        ("POST", "/eutherdogs/next") => {
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            let frame = dogs
                .advance_mission()
                .map_err(|err| invalid_request(err.to_string()))?;
            drop(dogs);
            publish_eutherdogs_initial_frame(state, frame.clone())?;
            send_json(stream, &frame)
        }
        ("POST", "/eutherdogs/reset") => {
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            dogs.reset()
                .map_err(|err| invalid_request(err.to_string()))?;
            let frame = dogs.snapshot();
            drop(dogs);
            publish_eutherdogs_initial_frame(state, frame.clone())?;
            send_json(stream, &frame)
        }
        ("POST", "/eutherdogs/frame") => {
            let input = if request.body.is_empty() {
                euther_oxide::eutherdogs::EutherDogsInput::default()
            } else {
                serde_json::from_slice(&request.body)
                    .map_err(|err| invalid_request(err.to_string()))?
            };
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            send_json(stream, &dogs.tick(input))
        }
        ("POST", "/eutherdogs/input") => {
            let input = if request.body.is_empty() {
                euther_oxide::eutherdogs::EutherDogsInput::default()
            } else {
                serde_json::from_slice(&request.body)
                    .map_err(|err| invalid_request(err.to_string()))?
            };
            touch_eutherdogs_poll(state)?;
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            let player_index = dogs.set_input(input);
            if let Some(seq) = input.seq {
                let mut seqs = state
                    .eutherdogs_input_seq
                    .lock()
                    .map_err(|err| io::Error::other(err.to_string()))?;
                seqs[player_index] = seq;
            }
            send_empty(stream, 204)
        }
        ("GET", "/eutherdogs/snapshot") => {
            let player_index = bridge_player_index(&request).unwrap_or(0).min(1);
            touch_eutherdogs_poll(state)?;
            ensure_eutherdogs_runner(state)?;
            let frame = latest_eutherdogs_frame(state, player_index)?;
            send_json(stream, &frame)
        }
        ("GET", "/eutherdogs/stream") => {
            let player_index = bridge_player_index(&request).unwrap_or(0).min(1);
            bridge_eutherdogs_stream(stream, state, player_index)
        }
        ("POST", "/eutherdogs/purchase") => {
            let purchase: euther_oxide::eutherdogs::EutherDogsPurchase =
                serde_json::from_slice(&request.body)
                    .map_err(|err| invalid_request(err.to_string()))?;
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            let frame = dogs
                .purchase(purchase)
                .map_err(|err| invalid_request(format!("{err:?}")))?;
            drop(dogs);
            publish_eutherdogs_initial_frame(state, frame.clone())?;
            send_json(stream, &frame)
        }
        ("GET", "/gamepads") => {
            let mut gamepads = state
                .gamepads
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            send_json(stream, &gamepads.snapshot())
        }
        ("GET", "/shader-config") => match fs::read_to_string(shader_config_path()) {
            Ok(contents) => send_response(
                stream,
                200,
                "text/plain; charset=utf-8",
                contents.as_bytes(),
            ),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                send_response(stream, 204, "text/plain; charset=utf-8", &[])
            }
            Err(err) => Err(err),
        },
        ("POST", "/shader-config") => {
            ensure_bridge_control_dir()?;
            fs::write(shader_config_path(), &request.body)?;
            send_empty(stream, 204)
        }
        ("GET", "/eutherdogs-highscores") => match fs::read_to_string(eutherdogs_highscores_path())
        {
            Ok(contents) => send_response(
                stream,
                200,
                "text/plain; charset=utf-8",
                contents.as_bytes(),
            ),
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                send_response(stream, 204, "text/plain; charset=utf-8", &[])
            }
            Err(err) => Err(err),
        },
        ("POST", "/eutherdogs-highscores") => {
            ensure_bridge_control_dir()?;
            fs::write(eutherdogs_highscores_path(), &request.body)?;
            send_empty(stream, 204)
        }
        ("GET", "/rom-dir") => send_json(
            stream,
            &RomDirSetting {
                rom_dir: read_rom_dir_setting()?,
            },
        ),
        ("POST", "/rom-dir") => {
            let path = String::from_utf8(request.body)
                .map_err(|_| invalid_request("ROM directory path must be UTF-8"))?;
            let canonical = validate_rom_root(path.trim())?;
            write_rom_dir_setting(&canonical)?;
            send_json(
                stream,
                &RomDirSetting {
                    rom_dir: Some(canonical.to_string_lossy().to_string()),
                },
            )
        }
        ("GET", "/rom-dir/list") => {
            let relative = query_string_value(&request.path, "path")?.unwrap_or_default();
            send_json(stream, &list_rom_dir(&relative)?)
        }
        ("POST", "/rom-dir/load") => {
            let relative = query_string_value(&request.path, "path")?
                .ok_or_else(|| invalid_request("missing path query"))?;
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            let rom_path = resolve_rom_file_path(&relative)?;
            clear_bridge_player(state)?;
            let mut emulator = lock_bridge_emulator(state)?;
            emulator.load_rom_file(rom_path)?;
            reset_bridge_pacer(state)?;
            send_json(stream, &bridge_status(&emulator))
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
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
            let emulator = lock_bridge_emulator(state)?;
            if emulator.rom_path.is_none() {
                return send_error(stream, 409, ".argon path unavailable for uploaded ROM");
            }
            let slot = query_slot(&request.path)?;
            let summary = euther_oxide::savestate::save_slot_for_emulator(&emulator, slot)?;
            send_json(stream, &bridge_slots(summary))
        }
        ("POST", "/state/load") => {
            let client_id = bridge_client_id(&request)?;
            let player_index = bridge_player_index(&request)?;
            if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                return send_error(stream, 409, &err.to_string());
            }
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

fn bridge_client_id(request: &HttpRequest) -> io::Result<String> {
    query_string_value(&request.path, "client")?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid_request("missing bridge client id"))
}

fn bridge_player_index(request: &HttpRequest) -> io::Result<usize> {
    let player = query_string_value(&request.path, "player")?
        .and_then(|value| value.parse::<u8>().ok())
        .unwrap_or(1);
    match player {
        1 | 2 => Ok((player - 1) as usize),
        _ => Err(invalid_request("player must be 1 or 2")),
    }
}

fn claim_bridge_player(
    state: &BridgeState,
    client_id: &str,
    user: &str,
    player_index: usize,
) -> io::Result<()> {
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let now = Instant::now();
    for slot in slots.iter_mut() {
        if slot
            .as_ref()
            .is_some_and(|lease| now.duration_since(lease.updated) > Duration::from_secs(8))
        {
            *slot = None;
        }
    }
    for (index, slot) in slots.iter_mut().enumerate() {
        if index != player_index
            && slot
                .as_ref()
                .is_some_and(|lease| lease.client_id == client_id)
        {
            *slot = None;
        }
    }
    match slots[player_index].as_mut() {
        Some(lease) if lease.client_id == client_id => {
            lease.updated = now;
            lease.user = user.to_string();
            Ok(())
        }
        Some(_) => Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            format!("bridge player {} busy", player_index + 1),
        )),
        None => {
            slots[player_index] = Some(BridgePlayerLease {
                client_id: client_id.to_string(),
                user: user.to_string(),
                updated: now,
            });
            Ok(())
        }
    }
}

fn touch_bridge_player(
    state: &BridgeState,
    client_id: &str,
    player_index: usize,
) -> io::Result<()> {
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(lease) = slots[player_index]
        .as_mut()
        .filter(|lease| lease.client_id == client_id)
    {
        lease.updated = Instant::now();
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "bridge player lease lost",
        ))
    }
}

fn release_bridge_player(
    state: &BridgeState,
    client_id: &str,
    player_index: usize,
) -> io::Result<()> {
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if slots[player_index]
        .as_ref()
        .is_some_and(|lease| lease.client_id == client_id)
    {
        slots[player_index] = None;
    }
    Ok(())
}

fn clear_bridge_player(state: &BridgeState) -> io::Result<()> {
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *slots = [None, None];
    let mut driver = state
        .driver_client
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *driver = None;
    let (packet, condvar) = &*state.latest_packet;
    let mut packet = packet
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *packet = None;
    condvar.notify_all();
    Ok(())
}

fn stop_bridge_state(state: &BridgeState) -> io::Result<()> {
    state.shutdown.store(true, Ordering::SeqCst);
    clear_bridge_player(state)?;
    let (packet, condvar) = &*state.latest_packet;
    let mut packet = packet
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *packet = None;
    condvar.notify_all();
    Ok(())
}

fn claim_bridge_driver(state: &BridgeState, client_id: &str) -> io::Result<bool> {
    let mut driver = state
        .driver_client
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let now = Instant::now();
    if driver
        .as_ref()
        .is_some_and(|lease| now.duration_since(lease.updated) > Duration::from_secs(8))
    {
        *driver = None;
    }
    match driver.as_mut() {
        Some(lease) if lease.client_id == client_id => {
            lease.updated = now;
            Ok(true)
        }
        Some(_) => Ok(false),
        None => {
            *driver = Some(BridgePlayerLease {
                client_id: client_id.to_string(),
                user: "driver".to_string(),
                updated: now,
            });
            Ok(true)
        }
    }
}

fn publish_bridge_packet(
    state: &BridgeState,
    bytes: Vec<u8>,
    frame: u32,
    stopped: bool,
) -> io::Result<()> {
    let (packet, condvar) = &*state.latest_packet;
    let mut packet = packet
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *packet = Some(BridgePacketSnapshot {
        frame,
        bytes,
        stopped,
    });
    condvar.notify_all();
    Ok(())
}

fn add_bridge_subscriber(state: &BridgeState) -> io::Result<()> {
    let mut count = state
        .subscriber_count
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *count += 1;
    Ok(())
}

fn remove_bridge_subscriber(state: &BridgeState) -> io::Result<()> {
    let mut count = state
        .subscriber_count
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *count = count.saturating_sub(1);
    Ok(())
}

fn bridge_subscriber_count(state: &BridgeState) -> io::Result<usize> {
    state
        .subscriber_count
        .lock()
        .map(|count| *count)
        .map_err(|err| io::Error::other(err.to_string()))
}

fn ensure_bridge_runner(state: &BridgeState) -> io::Result<()> {
    if state.shutdown.load(Ordering::SeqCst) {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "bridge instance closed",
        ));
    }
    let mut active = state
        .runner_active
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if *active {
        return Ok(());
    }
    *active = true;
    let state = state.clone();
    thread::spawn(move || {
        if let Err(err) = bridge_runner_loop(&state) {
            eprintln!("bridge runner error: {err}");
        }
        if let Ok(mut active) = state.runner_active.lock() {
            *active = false;
        }
    });
    Ok(())
}

fn bridge_runner_loop(state: &BridgeState) -> io::Result<()> {
    let mut idle_since: Option<Instant> = None;
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        if bridge_subscriber_count(state)? == 0 {
            let now = Instant::now();
            if idle_since.is_none() {
                idle_since = Some(now);
            }
            if idle_since
                .is_some_and(|started| now.duration_since(started) > Duration::from_secs(1))
            {
                break Ok(());
            }
            thread::sleep(Duration::from_millis(20));
            continue;
        }
        idle_since = None;
        pace_bridge_frame(state)?;
        let (packet, frame, stopped) = {
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                break Ok(());
            }
            let run = emulator.run_frame();
            let stopped = run.hit_unsupported_opcode;
            let packet = bridge_frame_audio_bytes(&mut emulator, &run, 44_100);
            let frame = emulator.frame_count.min(u32::MAX as u64) as u32;
            (packet, frame, stopped)
        };
        publish_bridge_packet(state, packet, frame, stopped)?;
        if stopped {
            break Ok(());
        }
    }
}

fn publish_eutherdogs_initial_frame(
    state: &BridgeState,
    frame: euther_oxide::eutherdogs::EutherDogsFrame,
) -> io::Result<()> {
    let mut latest = state
        .eutherdogs_latest
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    latest[0] = Some(frame.clone());
    latest[1] = Some(frame);
    Ok(())
}

fn touch_eutherdogs_poll(state: &BridgeState) -> io::Result<()> {
    let mut last_poll = state
        .eutherdogs_last_poll
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *last_poll = Instant::now();
    Ok(())
}

fn latest_eutherdogs_frame(
    state: &BridgeState,
    player_index: usize,
) -> io::Result<euther_oxide::eutherdogs::EutherDogsFrame> {
    if let Some(frame) = state
        .eutherdogs_latest
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?[player_index]
        .clone()
    {
        return Ok(frame);
    }
    let mut dogs = state
        .eutherdogs
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(dogs.snapshot_for_player(player_index))
}

fn ensure_eutherdogs_runner(state: &BridgeState) -> io::Result<()> {
    if state.shutdown.load(Ordering::SeqCst) {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "bridge instance closed",
        ));
    }
    let mut active = state
        .eutherdogs_runner_active
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if *active {
        return Ok(());
    }
    *active = true;
    let state = state.clone();
    thread::spawn(move || {
        if let Err(err) = eutherdogs_runner_loop(&state) {
            eprintln!("eutherdogs runner error: {err}");
        }
        if let Ok(mut active) = state.eutherdogs_runner_active.lock() {
            *active = false;
        }
    });
    Ok(())
}

fn eutherdogs_runner_loop(state: &BridgeState) -> io::Result<()> {
    let frame_time = Duration::from_secs_f64(1.0 / 60.0);
    let mut next_frame_due = Instant::now();
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        let last_poll = *state
            .eutherdogs_last_poll
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        if Instant::now().duration_since(last_poll) > Duration::from_secs(2) {
            break Ok(());
        }
        let now = Instant::now();
        if next_frame_due > now {
            thread::sleep(next_frame_due - now);
        }
        next_frame_due = Instant::now() + frame_time;
        let frames = {
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            dogs.tick_held()
        };
        let mut latest = state
            .eutherdogs_latest
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        latest[0] = Some(frames[0].clone());
        latest[1] = Some(frames[1].clone());
    }
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
    send_response_with_headers(stream, status, content_type, body, &[])
}

fn send_response_with_headers(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    headers: &[(&str, &str)],
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        303 => "See Other",
        204 => "No Content",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        429 => "Too Many Requests",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\n\
         Access-Control-Allow-Origin: http://127.0.0.1:5173\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name, X-CSRF-Token\r\n\
         Access-Control-Allow-Credentials: true\r\n\
         Access-Control-Expose-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n",
        body.len()
    )?;
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(stream, "\r\n")?;
    stream.write_all(body)
}

fn send_stream_header(stream: &mut TcpStream, content_type: &str) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: http://127.0.0.1:5173\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name, X-CSRF-Token\r\n\
         Access-Control-Allow-Credentials: true\r\n\
         Access-Control-Expose-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Type: {content_type}\r\n\
         Connection: close\r\n\r\n",
    )
}

fn send_event_stream_header(stream: &mut TcpStream) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: http://127.0.0.1:5173\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name, X-CSRF-Token\r\n\
         Access-Control-Allow-Credentials: true\r\n\
         Access-Control-Expose-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Type: text/event-stream; charset=utf-8\r\n\
         Connection: close\r\n\r\n",
    )
}

fn bridge_eutherdogs_stream(
    stream: &mut TcpStream,
    state: &BridgeState,
    player_index: usize,
) -> io::Result<()> {
    stream.set_nodelay(true)?;
    send_event_stream_header(stream)?;
    touch_eutherdogs_poll(state)?;
    ensure_eutherdogs_runner(state)?;
    let mut last_frame = None;
    let mut full_refresh_countdown = 0u8;
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        touch_eutherdogs_poll(state)?;
        let frame = latest_eutherdogs_frame(state, player_index)?;
        if Some(frame.frame) != last_frame {
            let include_static = last_frame.is_none() || full_refresh_countdown == 0;
            let payload = eutherdogs_stream_payload(state, &frame, player_index, include_static)?;
            if write!(stream, "data: {payload}\n\n").is_err() {
                break Ok(());
            }
            if stream.flush().is_err() {
                break Ok(());
            }
            last_frame = Some(frame.frame);
            full_refresh_countdown = if include_static {
                30
            } else {
                full_refresh_countdown.saturating_sub(1)
            };
        }
        thread::sleep(Duration::from_millis(8));
    }
}

fn eutherdogs_stream_payload(
    state: &BridgeState,
    frame: &euther_oxide::eutherdogs::EutherDogsFrame,
    player_index: usize,
    include_static: bool,
) -> io::Result<String> {
    let acked_input_seq = state
        .eutherdogs_input_seq
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?[player_index];
    let mut value = serde_json::json!({
        "frame": frame.frame,
        "characters": frame.characters,
        "bullets": frame.bullets,
        "inspectionDialogues": frame.inspection_dialogues,
        "summary": frame.summary,
        "audioEvents": frame.audio_events,
        "highscoreCount": frame.highscore_count,
        "ackedInputSeq": acked_input_seq,
    });
    if include_static {
        value["width"] = serde_json::json!(frame.width);
        value["height"] = serde_json::json!(frame.height);
        value["tileWidth"] = serde_json::json!(frame.tile_width);
        value["tileHeight"] = serde_json::json!(frame.tile_height);
        value["characterWidth"] = serde_json::json!(frame.character_width);
        value["characterHeight"] = serde_json::json!(frame.character_height);
        value["tiles"] = serde_json::json!(frame.tiles);
        value["visibility"] = serde_json::json!(frame.visibility);
        value["store"] = serde_json::json!(frame.store);
    }
    serde_json::to_string(&value).map_err(|err| io::Error::other(err.to_string()))
}

fn bridge_stream_frame_audio(
    stream: &mut TcpStream,
    state: &BridgeState,
    client_id: String,
    player_index: Option<usize>,
) -> io::Result<()> {
    {
        let emulator = lock_bridge_emulator(state)?;
        if emulator.bus.rom.is_empty() {
            if let Some(player_index) = player_index {
                release_bridge_player(state, &client_id, player_index)?;
            }
            return send_error(stream, 409, "no ROM loaded");
        }
    }

    stream.set_nodelay(true)?;
    send_stream_header(stream, "application/octet-stream")?;
    add_bridge_subscriber(state)?;
    if let Err(err) = ensure_bridge_runner(state) {
        remove_bridge_subscriber(state)?;
        return Err(err);
    }
    let result = bridge_stream_subscriber(stream, state, &client_id, player_index);
    remove_bridge_subscriber(state)?;
    if let Some(player_index) = player_index {
        release_bridge_player(state, &client_id, player_index)?;
    }
    result
}

fn bridge_stream_subscriber(
    stream: &mut TcpStream,
    state: &BridgeState,
    client_id: &str,
    player_index: Option<usize>,
) -> io::Result<()> {
    let (packet_lock, condvar) = &*state.latest_packet;
    let mut last_frame = 0u32;
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        if let Some(player_index) = player_index {
            touch_bridge_player(state, client_id, player_index)?;
        }
        let mut packet = packet_lock
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        while packet
            .as_ref()
            .is_none_or(|snapshot| snapshot.frame == last_frame)
        {
            if state.shutdown.load(Ordering::SeqCst) {
                return Ok(());
            }
            let wait = condvar
                .wait_timeout(packet, Duration::from_secs(2))
                .map_err(|err| io::Error::other(err.to_string()))?;
            packet = wait.0;
            if state.shutdown.load(Ordering::SeqCst) {
                return Ok(());
            }
            if wait.1.timed_out() {
                if let Some(player_index) = player_index {
                    touch_bridge_player(state, client_id, player_index)?;
                }
            }
        }
        let Some(snapshot) = packet.as_ref() else {
            continue;
        };
        let frame = snapshot.frame;
        let stopped = snapshot.stopped;
        let bytes = snapshot.bytes.clone();
        drop(packet);
        last_frame = frame;
        write_stream_packet(stream, &bytes)?;
        if stopped {
            break Ok(());
        }
    }
}

fn write_stream_packet(stream: &mut TcpStream, packet: &[u8]) -> io::Result<()> {
    stream.write_all(&(packet.len() as u32).to_le_bytes())?;
    stream.write_all(packet)?;
    stream.flush()
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
    let channels = 2u32;
    let samples = emulator.render_audio_frame_i16_stereo(sample_rate);
    let sample_frames = samples.len() / channels as usize;
    let mut bytes = Vec::with_capacity(20 + samples.len() * 2);
    bytes.extend_from_slice(b"EOA2");
    bytes.extend_from_slice(&(emulator.frame_count.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    bytes.extend_from_slice(&(sample_frames as u32).to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
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
    let (width, height) = emulator.frame_size();
    let channels = 2u32;
    let samples = emulator.render_audio_frame_i16_stereo(sample_rate);
    let sample_frames = samples.len() / channels as usize;
    let video_len = width * height * 2;
    let pcm_len = samples.len() * 2;
    let mut bytes = Vec::with_capacity(52 + video_len + pcm_len);
    bytes.extend_from_slice(b"EOX4");
    bytes.extend_from_slice(&(emulator.frame_count.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(width as u32).to_le_bytes());
    bytes.extend_from_slice(&(height as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_cycles.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&(run.cpu_steps.min(u32::MAX as u64) as u32).to_le_bytes());
    bytes.extend_from_slice(&((run.elapsed.as_secs_f64() * 1_000_000.0) as u32).to_le_bytes());
    bytes.extend_from_slice(&u32::from(run.hit_unsupported_opcode).to_le_bytes());
    bytes.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    bytes.extend_from_slice(&(sample_frames as u32).to_le_bytes());
    bytes.extend_from_slice(&(video_len as u32).to_le_bytes());
    bytes.extend_from_slice(&(pcm_len as u32).to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    push_frame_rgb565(&mut bytes, emulator);
    bytes
}

fn push_frame_rgb565(bytes: &mut Vec<u8>, emulator: &Emulator) {
    let (width, height) = emulator.frame_size();
    for &pixel in emulator.framebuffer().iter().take(width * height) {
        let r = ((pixel >> 16) & 0xff) as u16;
        let g = ((pixel >> 8) & 0xff) as u16;
        let b = (pixel & 0xff) as u16;
        let rgb565 = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
        bytes.extend_from_slice(&rgb565.to_le_bytes());
    }
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

fn shader_config_path() -> PathBuf {
    bridge_control_dir().join("shaders.toml")
}

fn eutherdogs_highscores_path() -> PathBuf {
    bridge_control_dir().join("eutherdogs-highscores.toml")
}

fn settings_path() -> PathBuf {
    bridge_control_dir().join("settings.toml")
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
    let pad = if input.player == Some(2) {
        &mut emulator.bus.controller_b
    } else {
        &mut emulator.bus.controller_a
    };
    pad.set_pressed(euther_oxide::controller::Controller::UP, input.up);
    pad.set_pressed(euther_oxide::controller::Controller::DOWN, input.down);
    pad.set_pressed(euther_oxide::controller::Controller::LEFT, input.left);
    pad.set_pressed(euther_oxide::controller::Controller::RIGHT, input.right);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_A, input.a);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_B, input.b);
    pad.set_pressed(euther_oxide::controller::Controller::BUTTON_C, input.c);
    pad.set_pressed(euther_oxide::controller::Controller::START, input.start);
}

fn load_host_config() -> io::Result<HostConfig> {
    ensure_host_dir()?;
    let path = host_config_path();
    if !path.exists() {
        fs::write(
            &path,
            "bind = \"127.0.0.1:32162\"\n\
             rom_dir = \"\"\n\
             session_timeout_minutes = 1440\n\
             login_rate_limit_window_secs = 900\n\
             login_rate_limit_max_attempts = 8\n\
             secure_cookies = false\n\
             allowed_origins = \"\"\n",
        )?;
    }
    let contents = fs::read_to_string(&path)?;
    let bind = parse_toml_string(&contents, "bind")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "127.0.0.1:32162".to_string());
    let rom_dir = parse_toml_string(&contents, "rom_dir").filter(|value| !value.is_empty());
    let session_timeout_minutes = parse_toml_u64(&contents, "session_timeout_minutes")
        .filter(|value| *value > 0)
        .unwrap_or(1440);
    let login_rate_limit_window_secs = parse_toml_u64(&contents, "login_rate_limit_window_secs")
        .filter(|value| *value > 0)
        .unwrap_or(900);
    let login_rate_limit_max_attempts = parse_toml_u64(&contents, "login_rate_limit_max_attempts")
        .filter(|value| *value > 0)
        .unwrap_or(8)
        .min(usize::MAX as u64) as usize;
    let secure_cookies = parse_toml_bool(&contents, "secure_cookies").unwrap_or(false);
    let allowed_origins = parse_toml_string(&contents, "allowed_origins")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_string)
        .collect();
    Ok(HostConfig {
        bind,
        rom_dir,
        session_timeout_minutes,
        login_rate_limit_window_secs,
        login_rate_limit_max_attempts,
        secure_cookies,
        allowed_origins,
    })
}

fn load_host_users() -> io::Result<Vec<HostUser>> {
    ensure_host_dir()?;
    let path = host_users_path();
    if !path.exists() {
        fs::write(
            &path,
            "# Add users as TOML tables. Generate an Argon2 hash with a password tool.\n\
             # [[user]]\n\
             # name = \"nichlas\"\n\
             # password_hash = \"$argon2id$v=19$...\"\n",
        )?;
    }
    let contents = fs::read_to_string(&path)?;
    let mut users = Vec::new();
    let mut name = None;
    let mut password_hash = None;
    let mut banned = false;
    let mut admin = false;
    for line in contents.lines().map(str::trim) {
        if line.starts_with("[[user]]") {
            if let (Some(name), Some(password_hash)) = (name.take(), password_hash.take()) {
                let admin = admin || name == "nichlas";
                users.push(HostUser {
                    name,
                    password_hash,
                    banned,
                    admin,
                });
            }
            banned = false;
            admin = false;
            continue;
        }
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(value) = parse_toml_assignment(line, "name") {
            name = Some(value);
        } else if let Some(value) = parse_toml_assignment(line, "password_hash") {
            password_hash = Some(value);
        } else if let Some(value) = parse_toml_bool_assignment(line, "banned") {
            banned = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "admin") {
            admin = value;
        }
    }
    if let (Some(name), Some(password_hash)) = (name.take(), password_hash.take()) {
        let admin = admin || name == "nichlas";
        users.push(HostUser {
            name,
            password_hash,
            banned,
            admin,
        });
    }
    if users.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "no EutherHost users configured in .euther-host/users.toml",
        ));
    }
    if !users.iter().any(|user| user.admin && !user.banned) {
        if let Some(user) = users.iter_mut().find(|user| user.name == "nichlas") {
            user.admin = true;
        }
    }
    Ok(users)
}

fn save_host_users(users: &[HostUser]) -> io::Result<()> {
    ensure_host_dir()?;
    let mut contents = String::from("# Managed by EutherHost admin UI.\n");
    for user in users {
        contents.push_str("\n[[user]]\n");
        contents.push_str(&format!("name = \"{}\"\n", toml_escape(&user.name)));
        contents.push_str(&format!(
            "password_hash = \"{}\"\n",
            toml_escape(&user.password_hash)
        ));
        contents.push_str(&format!("banned = {}\n", user.banned));
        contents.push_str(&format!("admin = {}\n", user.admin));
    }
    fs::write(host_users_path(), contents)
}

fn load_host_chat_messages() -> io::Result<Vec<HostChatMessage>> {
    ensure_host_dir()?;
    let path = host_chat_path();
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut messages = contents
        .lines()
        .filter_map(|line| serde_json::from_str::<HostChatMessage>(line).ok())
        .collect::<Vec<_>>();
    if messages.len() > 80 {
        let keep_from = messages.len() - 80;
        messages.drain(0..keep_from);
    }
    Ok(messages)
}

fn append_host_chat_message(message: &HostChatMessage) -> io::Result<()> {
    ensure_host_dir()?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(host_chat_path())?;
    serde_json::to_writer(&mut file, message).map_err(|err| io::Error::other(err.to_string()))?;
    file.write_all(b"\n")
}

fn append_host_audit_event(event: &HostAuditEvent<'_>) -> io::Result<()> {
    ensure_host_dir()?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(host_audit_path())?;
    serde_json::to_writer(&mut file, event).map_err(|err| io::Error::other(err.to_string()))?;
    file.write_all(b"\n")
}

fn ensure_host_dir() -> io::Result<()> {
    fs::create_dir_all(host_dir())
}

fn host_dir() -> PathBuf {
    PathBuf::from(".euther-host")
}

fn host_config_path() -> PathBuf {
    host_dir().join("config.toml")
}

fn host_users_path() -> PathBuf {
    host_dir().join("users.toml")
}

fn host_chat_path() -> PathBuf {
    host_dir().join("chat.log")
}

fn host_audit_path() -> PathBuf {
    host_dir().join("audit.log")
}

fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn hash_host_password(password: &str) -> io::Result<String> {
    let mut salt_bytes = [0u8; 16];
    File::open("/dev/urandom")?.read_exact(&mut salt_bytes)?;
    let salt =
        SaltString::encode_b64(&salt_bytes).map_err(|err| io::Error::other(err.to_string()))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| io::Error::other(err.to_string()))
}

fn random_token() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn parse_urlencoded_form(value: &str) -> io::Result<Vec<(String, String)>> {
    value
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            Ok((percent_decode(name)?, percent_decode(value)?))
        })
        .collect()
}

fn form_value<'a>(form: &'a [(String, String)], name: &str) -> Option<&'a str> {
    form.iter()
        .find_map(|(key, value)| (key == name).then_some(value.as_str()))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn parse_toml_assignment(line: &str, key: &str) -> Option<String> {
    let (name, value) = line.split_once('=')?;
    if name.trim() != key {
        return None;
    }
    let value = value.trim().trim_matches('"');
    Some(value.replace("\\\"", "\"").replace("\\\\", "\\"))
}

fn parse_toml_bool_assignment(line: &str, key: &str) -> Option<bool> {
    let (name, value) = line.split_once('=')?;
    (name.trim() == key).then(|| matches!(value.trim(), "true" | "1"))
}

fn parse_toml_u64(contents: &str, key: &str) -> Option<u64> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().parse::<u64>().ok())?
    })
}

fn parse_toml_bool(contents: &str, key: &str) -> Option<bool> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| matches!(value.trim(), "true" | "1"))
    })
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn read_rom_dir_setting() -> io::Result<Option<String>> {
    let contents = match fs::read_to_string(settings_path()) {
        Ok(contents) => contents,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err),
    };
    Ok(parse_toml_string(&contents, "rom_dir"))
}

fn write_rom_dir_setting(path: &std::path::Path) -> io::Result<()> {
    ensure_bridge_control_dir()?;
    fs::write(
        settings_path(),
        format!(
            "rom_dir = \"{}\"\n",
            escape_toml_string(&path.to_string_lossy())
        ),
    )
}

fn validate_rom_root(path: &str) -> io::Result<PathBuf> {
    let canonical = PathBuf::from(path).canonicalize()?;
    if !canonical.is_dir() {
        return Err(invalid_request("ROM directory must be a directory"));
    }
    Ok(canonical)
}

fn rom_root_path() -> io::Result<PathBuf> {
    let root =
        read_rom_dir_setting()?.ok_or_else(|| invalid_request("ROM directory is not set"))?;
    validate_rom_root(&root)
}

fn list_rom_dir(relative: &str) -> io::Result<RomDirListing> {
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

fn resolve_rom_dir_path(root: &std::path::Path, relative: &str) -> io::Result<PathBuf> {
    let joined = root.join(relative);
    let canonical = joined.canonicalize()?;
    if !canonical.starts_with(root) || !canonical.is_dir() {
        return Err(invalid_request("directory is outside ROM root"));
    }
    Ok(canonical)
}

fn resolve_rom_file_path(relative: &str) -> io::Result<PathBuf> {
    let root = rom_root_path()?;
    let canonical = root.join(relative).canonicalize()?;
    if !canonical.starts_with(&root) || !canonical.is_file() || !is_rom_path(&canonical) {
        return Err(invalid_request(
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

fn query_string_value(path: &str, key: &str) -> io::Result<Option<String>> {
    Ok(path.split_once('?').and_then(|(_, query)| {
        query.split('&').find_map(|pair| {
            let (name, value) = pair.split_once('=')?;
            (name == key).then(|| percent_decode(value).ok()).flatten()
        })
    }))
}

fn percent_decode(value: &str) -> io::Result<String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3])
                    .map_err(|_| invalid_request("invalid percent encoding"))?;
                let byte = u8::from_str_radix(hex, 16)
                    .map_err(|_| invalid_request("invalid percent encoding"))?;
                output.push(byte);
                index += 3;
            }
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8(output).map_err(|_| invalid_request("query value must be UTF-8"))
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
