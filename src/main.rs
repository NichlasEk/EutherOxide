use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::fs as unix_fs;
use std::path::{Component, Path, PathBuf};
use std::process::{self, Child, ChildStdin, Command, Stdio};
use std::sync::{
    Arc, Condvar, Mutex,
    atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering},
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

const BRIDGE_STREAM_VIDEO_DIVISOR: u64 = 2;
const WEBRTC_UDP_PORT_MIN: u16 = 49_152;
const WEBRTC_UDP_PORT_MAX: u16 = 49_200;
const WEBRTC_VIDEO_FPS: f64 = 60.0;
const WEBRTC_VIDEO_BITRATE: &str = "1200k";
const WEBRTC_VIDEO_MAXRATE: &str = "1400k";
const WEBRTC_VIDEO_BUFSIZE: &str = "350k";
const HOST_PLAYER_LEASE_TIMEOUT: Duration = Duration::from_secs(8);
const HOST_VIDEO_CHAT_PARTICIPANT_TIMEOUT_MS: u64 = 12_000;
const HOST_VIDEO_CHAT_SIGNAL_TIMEOUT_MS: u64 = 60_000;
const HOST_VIDEO_CHAT_MAX_SIGNALS: usize = 160;
const HOST_SOCIAL_ATTACHMENT_MAX_BYTES: usize = 4 * 1024 * 1024;
const HOST_SOCIAL_FILE_ATTACHMENT_MAX_BYTES: usize = 3 * 1024 * 1024 * 1024;
const HOST_EUTHERBOOKS_VOICE_SAMPLE_MAX_BYTES: usize = 24 * 1024 * 1024;
const HOST_MAX_ACTIVE_REQUESTS: usize = 128;
const HOST_CODEX_USER: &str = "codex";
const HOST_CODEX_DISPLAY_NAME: &str = "Codex Developer";
const EUTHERDOGS_SERVER_PUBLISH_HZ: f64 = 60.0;
const EUTHERDOGS_TICKS_PER_PUBLISH: u8 = 1;
const EUTHERDOGS_STATIC_REFRESH_FRAMES: u16 = 240;
const WEBRTC_VIDEO_MIN_FPS: u32 = 40;
const WEBRTC_VIDEO_STABLE_TICKS_FOR_RAISE: u32 = 8;
const DEFAULT_EUTHERLIST_APK_PATH: &str = "/home/nichlas/EutherList-release-signed.apk";
const DEFAULT_EUTHERLIST_REPO_APK_PATH: &str =
    "/home/nichlas/EutherOxide/apps/eutherlist/releases/EutherList-release-signed.apk";
const DEFAULT_EUTHERSYNC_APK_PATH: &str = "/home/nichlas/EutherSync-release-signed.apk";
const DEFAULT_EUTHERSYNC_REPO_APK_PATH: &str =
    "/home/nichlas/EutherOxide/apps/euthersync/releases/EutherSync-release-signed.apk";
const DEFAULT_EUTHERBOOKS_PLAYER_APK_PATH: &str =
    "/home/nichlas/EutherBooksPlayer-release-signed.apk";
const DEFAULT_EUTHERBOOKS_PLAYER_REPO_APK_PATH: &str = "/home/nichlas/EutherOxide/apps/eutherbooks-player/releases/EutherBooksPlayer-release-signed.apk";
const EUTHERDUKE_BROWSER_LOG_PATH: &str = ".euther-host/eutherduke-browser.log";
const EUTHERBOOKS_PLAYER_LOG_PATH: &str = ".euther-host/eutherbooks-player.log";
const CAMERA_ADMIN_PATH: &str = "/camera-admin";
const CAMERA_FRIGATE_PROXY_PREFIX: &str = "/api/camera/frigate";
static EUTHERDUKE_BROWSER_LOG_LOCK: Mutex<()> = Mutex::new(());
static EUTHERBOOKS_PLAYER_LOG_LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    static RESPONSE_CORS_ORIGIN: RefCell<Option<String>> = const { RefCell::new(None) };
}

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
    let mut host_verify_password: Option<String> = None;
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
            "--host-verify-password" => {
                let Some(value) = args.next() else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "--host-verify-password needs a password hash value",
                    ));
                };
                host_verify_password = Some(value);
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

    if let Some(hash) = host_verify_password {
        let mut password = String::new();
        io::stdin().read_to_string(&mut password)?;
        while password.ends_with(['\n', '\r']) {
            password.pop();
        }
        println!("{}", verify_password(&password, &hash));
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
        "usage: euther-oxide [rom.md|rom.bin|rom.smd] [--frames N] [--perf] [--dump frame.ppm] [--save-state 1|2|3] [--load-state 1|2|3] [--list-states] [--vdp-summary] [--web-bridge] [--web-bridge-addr HOST:PORT] [--host-server] [--host-hash-password PASSWORD] [--host-verify-password HASH] [--eutherdogs-demo] [--eutherdogs-config config.toml]"
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

#[derive(Clone, Copy, Deserialize)]
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
enum BridgeDataChannelMessage {
    #[serde(rename = "input")]
    Input { seq: u32, input: BridgeInput },
    #[serde(rename = "videoStats")]
    VideoStats { stats: BridgeVideoStats },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeVideoStats {
    dropped_delta: u32,
    fps: f64,
    jitter_ms: f64,
    queue: u32,
    decode_ms: f64,
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
    content_length: usize,
}

#[derive(Clone)]
struct BridgeState {
    emulator: Arc<Mutex<Emulator>>,
    next_frame_due: Arc<Mutex<Instant>>,
    latest_input: Arc<Mutex<[BridgeInput; 2]>>,
    player_slots: Arc<Mutex<[Option<BridgePlayerLease>; 2]>>,
    driver_client: Arc<Mutex<Option<BridgePlayerLease>>>,
    latest_packet: Arc<(Mutex<Option<BridgePacketSnapshot>>, Condvar)>,
    latest_audio: Arc<(Mutex<Option<BridgeAudioSnapshot>>, Condvar)>,
    latest_video: Arc<(Mutex<Option<BridgeVideoSnapshot>>, Condvar)>,
    subscriber_count: Arc<Mutex<usize>>,
    runner_active: Arc<Mutex<bool>>,
    shutdown: Arc<AtomicBool>,
    gamepads: Arc<Mutex<GamepadReader>>,
    eutherdogs: Arc<Mutex<euther_oxide::eutherdogs::EutherDogsRuntime>>,
    eutherdogs_latest: Arc<Mutex<[Option<euther_oxide::eutherdogs::EutherDogsFrame>; 2]>>,
    eutherdogs_input_seq: Arc<Mutex<[u64; 2]>>,
    eutherdogs_runner_active: Arc<Mutex<bool>>,
    eutherdogs_last_poll: Arc<Mutex<Instant>>,
    webrtc_runtime: Arc<tokio::runtime::Runtime>,
    webrtc_peers: Arc<Mutex<Vec<BridgeWebRtcPeer>>>,
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

struct BridgeAudioSnapshot {
    frame: u32,
    pcm: Vec<u8>,
    stopped: bool,
}

struct BridgeVideoSnapshot {
    frame: u32,
    rgb: Vec<u8>,
    width: usize,
    height: usize,
    published_unix_ms: u64,
    stopped: bool,
}

struct BridgeWebRtcPeer {
    _peer: Arc<webrtc::peer_connection::RTCPeerConnection>,
    stop: Arc<AtomicBool>,
    created: Instant,
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
    video_chat_rooms: Arc<Mutex<Vec<HostVideoChatRoom>>>,
    openra_server: Arc<Mutex<Option<HostOpenRaProcess>>>,
    openra_client: Arc<Mutex<Option<HostOpenRaClientProcess>>>,
    alert_touch_bridge: Arc<Mutex<Option<HostAlertTouchBridgeProcess>>>,
    alert_touch_events: Arc<Mutex<Vec<HostAlertTouchEvent>>>,
    next_alert_touch_id: Arc<Mutex<u64>>,
    active_requests: Arc<AtomicUsize>,
}

struct HostOpenRaProcess {
    child: Child,
    instance_id: String,
    port: u16,
    started_unix_ms: u64,
    runtime_path: PathBuf,
}

struct HostOpenRaClientProcess {
    child: Child,
    xvfb_child: Option<Child>,
    pipewire_node_id: Option<String>,
    audio_sink_name: Option<String>,
    audio_backend: String,
    instance_id: String,
    port: u16,
    started_unix_ms: u64,
    runtime_path: PathBuf,
    support_dir: PathBuf,
    touch_bridge_file: PathBuf,
    display: String,
    capture_width: u32,
    capture_height: u32,
    stdout_log: PathBuf,
    stderr_log: PathBuf,
}

struct HostAlertTouchBridgeProcess {
    child: Child,
    stdin: ChildStdin,
    command: String,
    started_unix_ms: u64,
}

#[derive(Clone, Serialize)]
struct HostAlertTouchEvent {
    id: u64,
    unix_ms: u64,
    instance: String,
    client: String,
    player: usize,
    kind: String,
    payload: serde_json::Value,
}

struct HostRequestGuard {
    active_requests: Arc<AtomicUsize>,
}

impl Drop for HostRequestGuard {
    fn drop(&mut self) {
        self.active_requests.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Clone)]
struct HostInstance {
    id: String,
    name: String,
    kind: HostInstanceKind,
    bridge: BridgeState,
    doom: Option<Arc<Mutex<eutherdoom_server::DoomSession>>>,
    alert_seed: u64,
    alert_events: Arc<Mutex<Vec<HostAlertEvent>>>,
    host_owner: Option<String>,
    created_unix_ms: u64,
}

#[derive(Clone, Serialize)]
struct HostAlertEvent {
    id: u64,
    unix_ms: u64,
    player: usize,
    kind: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
struct HostAlertCommandRequest {
    player: usize,
    kind: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
struct HostAlertTouchRequest {
    player: usize,
    kind: String,
    payload: serde_json::Value,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HostInstanceKind {
    MegaDrive,
    EutherAlert,
    EutherDoom,
}

impl HostInstanceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::MegaDrive => "megadrive",
            Self::EutherAlert => "eutheralert",
            Self::EutherDoom => "eutherdoom",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::MegaDrive => "MegaDrive",
            Self::EutherAlert => "EutherAlert",
            Self::EutherDoom => "EutherDoom",
        }
    }
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
    library_read_only: bool,
    app_public_server_url: Option<String>,
    app_lan_server_url: Option<String>,
    eutherbooks_server_urls: Vec<String>,
}

#[derive(Clone)]
struct HostUser {
    name: String,
    password_hash: String,
    app_token: Option<String>,
    app_lan_server_url: Option<String>,
    banned: bool,
    admin: bool,
    can_play: bool,
    can_launch_roms: bool,
    can_upload_roms: bool,
    can_manage_library: bool,
    can_award_eutherium: bool,
    can_camera_admin: bool,
    camera_rotation_degrees: u16,
    camera_refresh_ms: u16,
    euthersync_media_backup: Option<bool>,
    euthersync_feed_post: Option<bool>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostPermissions {
    can_play: bool,
    can_launch_roms: bool,
    can_upload_roms: bool,
    can_manage_library: bool,
    can_award_eutherium: bool,
    can_camera_admin: bool,
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialConversation {
    id: String,
    kind: HostSocialConversationKind,
    title: Option<String>,
    participants: Vec<String>,
    created_by: String,
    created_unix_ms: u64,
    updated_unix_ms: u64,
    last_message: Option<HostSocialMessagePreview>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum HostSocialConversationKind {
    Direct,
    Group,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialMessagePreview {
    user: String,
    text: String,
    created_unix_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialMessage {
    id: u64,
    conversation_id: String,
    user: String,
    text: String,
    #[serde(default)]
    attachments: Vec<HostSocialAttachment>,
    #[serde(default)]
    reactions: Vec<HostSocialReaction>,
    created_unix_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialAttachment {
    id: String,
    name: String,
    content_type: String,
    size_bytes: usize,
    url: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialReaction {
    key: String,
    users: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialConversationCreate {
    participants: Vec<String>,
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialMessageCreate {
    text: String,
    #[serde(default)]
    attachments: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialAttachmentUpload {
    name: String,
    content_type: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostSocialReactionUpdate {
    key: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostVideoChatParticipant {
    client_id: String,
    user: String,
    can_send: bool,
    updated_unix_ms: u64,
}

#[derive(Clone)]
struct HostVideoChatRoom {
    instance_id: String,
    participants: Vec<HostVideoChatParticipant>,
    signals: Vec<HostVideoChatSignal>,
    next_signal_id: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostVideoChatSignal {
    id: u64,
    from: String,
    to: String,
    #[serde(rename = "type")]
    signal_type: String,
    sdp: String,
    created_unix_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostVideoChatSignalRequest {
    to: String,
    #[serde(rename = "type")]
    signal_type: String,
    sdp: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostShoppingListUpdate {
    markdown: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostShoppingListShareUpdate {
    user: String,
    role: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostShoppingListRoleUpdate {
    user: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostAppLoginRequest {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostEutherBooksVoiceSampleUpload {
    voice_id: String,
    language: String,
    prompt_text: String,
    content_type: String,
    file_name: Option<String>,
    data_base64: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostShoppingListMemberEntry {
    user: String,
    role: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostShoppingListManifest {
    owner: String,
    members: Vec<HostShoppingListMemberEntry>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostEutheriumLedgerEntry {
    id: String,
    user_id: String,
    amount: i64,
    reason: String,
    source: String,
    #[serde(default)]
    created_by_user_id: String,
    created_unix_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostEutheriumItem {
    id: &'static str,
    name: &'static str,
    item_type: &'static str,
    price: i64,
    description: &'static str,
    image_path: String,
    rarity: &'static str,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInventoryEntry {
    id: String,
    user_id: String,
    item_id: String,
    acquired_unix_ms: u64,
    equipped_to_item_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostTrophyRoomLayout {
    background: String,
    items: Vec<HostTrophyRoomLayoutItem>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostTrophyRoomLayoutItem {
    inventory_id: String,
    x: f64,
    y: f64,
    scale: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostEutheriumAwardRequest {
    user_id: String,
    amount: i64,
    reason: String,
    source: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostShopBuyRequest {
    item_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostTrophyRoomLayoutRequest {
    layout: HostTrophyRoomLayout,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct HostUserPreferences {
    audio_volume: f64,
    mic_volume: f64,
    doom_mouse_sensitivity: f64,
    theme: String,
    skin: String,
    eutherbooks_voice: String,
    eutherbooks_custom_voice: String,
    eutherbooks_length_scale: f64,
    eutherbooks_noise_scale: f64,
    eutherbooks_noise_w: f64,
    eutherbooks_sentence_silence: f64,
    eutherbooks_cfg_value: f64,
    eutherbooks_inference_timesteps: f64,
    eutherbooks_max_chunk_chars: f64,
    eutherbooks_seed: f64,
    eutherbooks_last_book_id: String,
    eutherbooks_last_chapter_index: f64,
    eutherbooks_auto_generate_next: bool,
    eutherbooks_own_voice_sv_path: String,
    eutherbooks_own_voice_sv_prompt: String,
    eutherbooks_own_voice_sv_locked: bool,
    eutherbooks_own_voice_en_path: String,
    eutherbooks_own_voice_en_prompt: String,
    eutherbooks_own_voice_en_locked: bool,
}

impl Default for HostUserPreferences {
    fn default() -> Self {
        Self {
            audio_volume: 0.8,
            mic_volume: 1.0,
            doom_mouse_sensitivity: 2.2,
            theme: "dark".to_string(),
            skin: "classic".to_string(),
            eutherbooks_voice: "sv-female-warm".to_string(),
            eutherbooks_custom_voice:
                "A warm Swedish audiobook narrator with clear pronunciation and natural pacing."
                    .to_string(),
            eutherbooks_length_scale: 1.0,
            eutherbooks_noise_scale: 0.667,
            eutherbooks_noise_w: 0.8,
            eutherbooks_sentence_silence: 0.2,
            eutherbooks_cfg_value: 2.0,
            eutherbooks_inference_timesteps: 10.0,
            eutherbooks_max_chunk_chars: 700.0,
            eutherbooks_seed: 0.0,
            eutherbooks_last_book_id: String::new(),
            eutherbooks_last_chapter_index: 0.0,
            eutherbooks_auto_generate_next: true,
            eutherbooks_own_voice_sv_path: String::new(),
            eutherbooks_own_voice_sv_prompt: eutherbooks_own_voice_prompt("sv").to_string(),
            eutherbooks_own_voice_sv_locked: false,
            eutherbooks_own_voice_en_path: String::new(),
            eutherbooks_own_voice_en_prompt: eutherbooks_own_voice_prompt("en").to_string(),
            eutherbooks_own_voice_en_locked: false,
        }
    }
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
    let webrtc_runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("euther-webrtc")
        .build()
        .expect("failed to create WebRTC runtime");
    BridgeState {
        emulator: Arc::new(Mutex::new(emulator)),
        next_frame_due: Arc::new(Mutex::new(Instant::now())),
        latest_input: Arc::new(Mutex::new(empty_bridge_inputs())),
        player_slots: Arc::new(Mutex::new([None, None])),
        driver_client: Arc::new(Mutex::new(None)),
        latest_packet: Arc::new((Mutex::new(None), Condvar::new())),
        latest_audio: Arc::new((Mutex::new(None), Condvar::new())),
        latest_video: Arc::new((Mutex::new(None), Condvar::new())),
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
        webrtc_runtime: Arc::new(webrtc_runtime),
        webrtc_peers: Arc::new(Mutex::new(Vec::new())),
    }
}

fn serve_host_server(emulator: Emulator) -> io::Result<()> {
    let config = load_host_config()?;
    if let Some(rom_dir) = config.rom_dir.as_deref() {
        let canonical = validate_rom_root(rom_dir)?;
        write_rom_dir_setting(&canonical)?;
    }
    write_host_codex_inbox_readme()?;
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
        kind: HostInstanceKind::MegaDrive,
        bridge: bridge.clone(),
        doom: None,
        alert_seed: 0,
        alert_events: Arc::new(Mutex::new(Vec::new())),
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
        video_chat_rooms: Arc::new(Mutex::new(Vec::new())),
        openra_server: Arc::new(Mutex::new(None)),
        openra_client: Arc::new(Mutex::new(None)),
        alert_touch_bridge: Arc::new(Mutex::new(None)),
        alert_touch_events: Arc::new(Mutex::new(Vec::new())),
        next_alert_touch_id: Arc::new(Mutex::new(1)),
        active_requests: Arc::new(AtomicUsize::new(0)),
    };
    println!(
        "EutherHost reaction chamber listening on http://{}",
        state.config.bind
    );
    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                let Some(guard) = try_acquire_host_request(&state.active_requests) else {
                    let _ = send_error(&mut stream, 503, "server busy");
                    continue;
                };
                let state = state.clone();
                thread::spawn(move || {
                    let _guard = guard;
                    if let Err(err) = handle_host_request(&mut stream, &state) {
                        let status = if err.kind() == io::ErrorKind::InvalidInput {
                            400
                        } else {
                            500
                        };
                        let _ = send_error(&mut stream, status, &err.to_string());
                    }
                });
            }
            Err(err) => eprintln!("host accept error: {err}"),
        }
    }
    Ok(())
}

fn try_acquire_host_request(active_requests: &Arc<AtomicUsize>) -> Option<HostRequestGuard> {
    active_requests
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |active| {
            (active < HOST_MAX_ACTIVE_REQUESTS).then_some(active + 1)
        })
        .ok()?;
    Some(HostRequestGuard {
        active_requests: Arc::clone(active_requests),
    })
}

fn handle_host_request(stream: &mut TcpStream, state: &HostState) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let request = read_http_request(stream)?;
    set_response_cors_origin(cors_origin_for_request(state, &request));
    if request.method == "OPTIONS" {
        return send_empty(stream, 204);
    }
    let path = request.path.split('?').next().unwrap_or(&request.path);
    if !is_android_apk_download_path(path) {
        if let Some(location) = host_canonical_redirect(state, &request) {
            return send_redirect(stream, 308, &location);
        }
    }
    let app_token_request =
        host_app_token_path(path) && authenticated_app_user(state, &request)?.is_some();
    if request.method != "GET"
        && path != "/api/login"
        && path != "/api/app/login"
        && path != "/api/eutherduke/log"
        && path != "/api/eutherbooks-player/log"
        && !is_eutherbooks_proxy_path(path)
        && !is_camera_frigate_proxy_path(path)
        && !app_token_request
        && !valid_csrf_token(state, &request)?
    {
        return send_error(stream, 403, "csrf token required");
    }
    if request.method == "GET"
        && (path.starts_with("/euthercivet-game/assets/")
            || path.starts_with("/euthercivet-game/pkg/"))
    {
        return send_host_static(stream, path);
    }
    match (request.method.as_str(), path) {
        ("GET", "/login") => send_login_page(stream, None),
        ("POST", "/api/login") => host_login(stream, state, &request),
        ("POST", "/api/app/login") => host_app_login(stream, state, &request),
        ("GET", "/api/app/config") => send_json(stream, &host_app_config(state)),
        ("GET", "/api/app/status") => {
            let user = require_host_user_or_app(state, &request)?;
            let lan_server_url = host_app_lan_server_url(state, &user)?;
            send_json(
                stream,
                &serde_json::json!({
                    "authenticated": true,
                    "user": user,
                    "lanServerUrl": lan_server_url,
                    "config": host_app_config(state),
                }),
            )
        }
        ("POST", "/api/logout") => host_logout(stream, state, &request),
        ("POST", "/api/eutherduke/log") => host_eutherduke_log(stream, state, &request),
        ("POST", "/api/eutherbooks-player/log") => {
            host_eutherbooks_player_log(stream, state, &request)
        }
        ("GET", path) if is_eutherlist_apk_download_path(path) => send_eutherlist_apk(stream),
        ("GET", path) if is_euthersync_apk_download_path(path) => send_euthersync_apk(stream),
        ("GET", path) if is_eutherbooks_player_apk_download_path(path) => {
            send_eutherbooks_player_apk(stream)
        }
        ("GET", "/api/auth/status") => {
            if let Some(user) = authenticated_user(state, &request)? {
                let csrf_token = csrf_token_for_request(state, &request)?;
                send_json(
                    stream,
                    &serde_json::json!({
                        "authenticated": true,
                        "user": user,
                        "isAdmin": is_host_admin(state, &user)?,
                        "permissions": host_permissions(state, &user)?,
                        "csrfToken": csrf_token,
                    }),
                )
            } else {
                send_json(stream, &serde_json::json!({ "authenticated": false }))
            }
        }
        ("GET", "/api/user/preferences") => {
            let user = require_host_user(state, &request)?;
            send_json(stream, &read_host_user_preferences(&user)?)
        }
        ("POST", "/api/user/preferences") => {
            let user = require_host_user(state, &request)?;
            let preferences: HostUserPreferences = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            save_host_user_preferences(&user, preferences)?;
            send_json(stream, &read_host_user_preferences(&user)?)
        }
        ("GET", "/api/camera/settings") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::CameraAdmin) {
                return send_error(stream, 403, &err.to_string());
            }
            send_json(stream, &host_camera_settings(state, &user)?)
        }
        ("POST", "/api/camera/settings") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::CameraAdmin) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let rotation_degrees = optional_form_i32(
                &form,
                "rotation_degrees",
                form_value(&form, "rotationDegrees"),
            )?;
            let refresh_ms =
                optional_form_u16(&form, "refresh_ms", form_value(&form, "refreshMs"))?;
            send_json(
                stream,
                &set_host_camera_settings(state, &user, rotation_degrees, refresh_ms)?,
            )
        }
        ("POST", "/api/user/eutherbooks/voice-sample") => {
            let user = require_host_user(state, &request)?;
            let upload: HostEutherBooksVoiceSampleUpload = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(stream, &save_host_eutherbooks_voice_sample(&user, upload)?)
        }
        ("GET", "/api/user/eutherbooks/voice-sample.wav") => {
            let user = require_host_user(state, &request)?;
            send_host_eutherbooks_voice_sample_wav(stream, &user, &request.path)
        }
        ("GET", "/api/lobby") => {
            require_host_user(state, &request)?;
            send_json(stream, &host_lobby_status(state)?)
        }
        ("POST", "/api/lobby/start") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let kind = host_instance_kind(&request.path)?;
            let instance_id = create_host_instance(state, &user, kind)?;
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
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let instance_id = host_instance_id(&request.path)?;
            let role =
                join_host_lobby_instance(state, &instance_id, &client_id, &user, &requested)?;
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
            let instance_id = host_instance_id(&request.path)?;
            release_host_lobby_client(state, &instance_id, &client_id)?;
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
            release_host_lobby_player(state, &instance_id, player - 1)?;
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
        ("GET", "/api/doom/status") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            send_json(stream, &host_doom_status(state, &instance_id)?)
        }
        ("GET", "/api/doom/events") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let after_id = query_string_value(&request.path, "after")?
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            send_json(stream, &host_doom_events(state, &instance_id, after_id)?)
        }
        ("GET", "/api/doom/stream") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let after_id = query_string_value(&request.path, "after")?
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            stream_host_doom_events(stream, state, &instance_id, after_id)
        }
        ("GET", "/api/doom/replay") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let replay = host_doom_replay(state, &instance_id)?;
            send_response(stream, 200, "text/plain; charset=utf-8", replay.as_bytes())
        }
        ("POST", "/api/doom/ready") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let instance_id = host_instance_id(&request.path)?;
            let client_id = query_string_value(&request.path, "client")?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_request("missing client id"))?;
            let player = bridge_player_index(&request)?;
            let ready = query_string_value(&request.path, "ready")?
                .map(|value| !matches!(value.as_str(), "0" | "false" | "no" | "off"))
                .unwrap_or(true);
            set_host_doom_ready(state, &instance_id, &client_id, player, ready)?;
            send_json(stream, &host_doom_status(state, &instance_id)?)
        }
        ("POST", "/api/doom/cmd") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let instance_id = host_instance_id(&request.path)?;
            let client_id = query_string_value(&request.path, "client")?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_request("missing client id"))?;
            let player = bridge_player_index(&request)?;
            let command = host_doom_command(&request)?;
            submit_host_doom_command(state, &instance_id, &client_id, player, command)?;
            if query_string_value(&request.path, "compact")?.as_deref() == Some("1") {
                send_json(
                    stream,
                    &serde_json::json!({
                        "ok": true,
                        "currentTic": command.tic,
                    }),
                )
            } else {
                send_json(stream, &host_doom_status(state, &instance_id)?)
            }
        }
        ("POST", "/api/doom/reset") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            if let Err(err) = require_host_owner(state, &instance_id, &user) {
                return send_error(stream, 403, &err.to_string());
            }
            reset_host_doom(state, &instance_id)?;
            send_json(stream, &host_doom_status(state, &instance_id)?)
        }
        ("GET", "/api/eutheralert/snapshot") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            send_json(stream, &host_alert_snapshot(state, &instance_id)?)
        }
        ("GET", "/api/eutheralert/events") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let after_id = query_string_value(&request.path, "after")?
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            send_json(stream, &host_alert_events(state, &instance_id, after_id)?)
        }
        ("GET", "/api/eutheralert/openra/status") => {
            require_host_user(state, &request)?;
            send_json(stream, &host_alert_openra_status(state)?)
        }
        ("POST", "/api/eutheralert/openra/start") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let instance_id = host_instance_id(&request.path)?;
            if let Err(err) = require_host_owner(state, &instance_id, &user) {
                return send_error(stream, 403, &err.to_string());
            }
            send_json(stream, &host_alert_openra_start(state, &instance_id)?)
        }
        ("POST", "/api/eutheralert/openra/stop") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            if let Err(err) = require_host_owner(state, &instance_id, &user) {
                return send_error(stream, 403, &err.to_string());
            }
            send_json(stream, &host_alert_openra_stop(state, &instance_id)?)
        }
        ("GET", "/api/eutheralert/openra/client/status") => {
            require_host_user(state, &request)?;
            send_json(stream, &host_alert_openra_client_status(state)?)
        }
        ("POST", "/api/eutheralert/openra/client/debug") => {
            let user = require_host_user(state, &request)?;
            send_json(
                stream,
                &host_alert_openra_client_debug(state, &request.path, &user)?,
            )
        }
        ("GET", "/api/eutheralert/openra/client/stream.mp4") => {
            require_host_user(state, &request)?;
            host_alert_openra_client_stream_mp4(stream, state)
        }
        ("POST", "/api/eutheralert/openra/client/start") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let request_context = host_alert_openra_request_context(state, &request.path, &user)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                host_alert_write_debug_dump(&serde_json::json!({
                    "ok": false,
                    "kind": "client-start-denied",
                    "unixMs": unix_ms_now(),
                    "request": request_context,
                    "error": err.to_string(),
                }))?;
                return send_error(stream, 403, &err.to_string());
            }
            let result = host_alert_openra_client_start(state, &instance_id);
            match result {
                Ok(payload) => {
                    host_alert_write_debug_dump(&serde_json::json!({
                        "ok": true,
                        "kind": "client-start-ok",
                        "unixMs": unix_ms_now(),
                        "request": request_context,
                        "client": payload,
                    }))?;
                    send_json(stream, &payload)
                }
                Err(err) => {
                    host_alert_write_debug_dump(&serde_json::json!({
                        "ok": false,
                        "kind": "client-start-error",
                        "unixMs": unix_ms_now(),
                        "request": request_context,
                        "error": err.to_string(),
                    }))?;
                    Err(err)
                }
            }
        }
        ("POST", "/api/eutheralert/openra/client/stop") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            if let Err(err) = require_host_owner(state, &instance_id, &user) {
                return send_error(stream, 403, &err.to_string());
            }
            send_json(stream, &host_alert_openra_client_stop(state, &instance_id)?)
        }
        ("GET", "/api/eutheralert/touch/events") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let after_id = query_string_value(&request.path, "after")?
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            send_json(
                stream,
                &host_alert_touch_events(state, &instance_id, after_id)?,
            )
        }
        ("POST", "/api/eutheralert/touch") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let instance_id = host_instance_id(&request.path)?;
            let client_id = query_string_value(&request.path, "client")?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_request("missing client id"))?;
            let command: HostAlertTouchRequest = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(
                stream,
                &host_alert_touch_command(state, &instance_id, &client_id, command)?,
            )
        }
        ("POST", "/api/eutheralert/cmd") => {
            let user = require_host_user(state, &request)?;
            if let Err(err) = require_host_permission(state, &user, HostPermission::Play) {
                return send_error(stream, 403, &err.to_string());
            }
            let instance_id = host_instance_id(&request.path)?;
            let client_id = query_string_value(&request.path, "client")?
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| invalid_request("missing client id"))?;
            let command: HostAlertCommandRequest = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(
                stream,
                &host_alert_command(state, &instance_id, &client_id, command)?,
            )
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
        ("GET", "/api/social/users") => {
            let user = require_host_user(state, &request)?;
            let query = query_string_value(&request.path, "query")?.unwrap_or_default();
            send_json(stream, &host_social_user_search(state, &user, &query)?)
        }
        ("GET", "/api/social/conversations") => {
            let user = require_host_user(state, &request)?;
            send_json(stream, &host_social_conversation_list(&user)?)
        }
        ("POST", "/api/social/conversations") => {
            let user = require_host_user(state, &request)?;
            let create: HostSocialConversationCreate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(
                stream,
                &host_social_create_conversation(state, &user, create)?,
            )
        }
        ("POST", "/api/social/attachments/raw") => {
            let user = require_host_user(state, &request)?;
            let result = host_social_upload_raw_attachment(stream, &request, &user)?;
            send_json(stream, &result)
        }
        ("POST", "/api/social/attachments") => {
            let user = require_host_user(state, &request)?;
            let upload: HostSocialAttachmentUpload = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(stream, &host_social_upload_attachment(&user, upload)?)
        }
        ("GET", path) if path.starts_with("/api/social/attachments/") => {
            require_host_user(state, &request)?;
            let attachment_id = host_social_attachment_id_from_path(path)?;
            send_host_social_attachment(stream, &attachment_id)
        }
        ("GET", path)
            if path.starts_with("/api/social/conversations/") && path.ends_with("/messages") =>
        {
            let user = require_host_user(state, &request)?;
            let conversation_id = host_social_conversation_id_from_messages_path(path)?;
            let before_id = query_string_value(&request.path, "before")?
                .and_then(|value| value.parse::<u64>().ok());
            let limit = query_string_value(&request.path, "limit")?
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(80);
            send_json(
                stream,
                &host_social_message_list(&user, &conversation_id, before_id, limit)?,
            )
        }
        ("POST", path)
            if path.starts_with("/api/social/conversations/") && path.ends_with("/messages") =>
        {
            let user = require_host_user(state, &request)?;
            let conversation_id = host_social_conversation_id_from_messages_path(path)?;
            let create: HostSocialMessageCreate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(
                stream,
                &host_social_post_message(&user, &conversation_id, create)?,
            )
        }
        ("POST", path)
            if path.starts_with("/api/social/conversations/")
                && path.contains("/messages/")
                && path.ends_with("/reactions") =>
        {
            let user = require_host_user(state, &request)?;
            let (conversation_id, message_id) = host_social_reaction_path_parts(path)?;
            let update: HostSocialReactionUpdate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            send_json(
                stream,
                &host_social_toggle_reaction(&user, &conversation_id, message_id, update)?,
            )
        }
        ("GET", "/api/interaction/users") => {
            let user = require_host_user_or_app(state, &request)?;
            send_json(stream, &host_interaction_user_list(state, &user)?)
        }
        ("GET", "/api/interaction/shopping-list") => {
            let user = require_host_user_or_app(state, &request)?;
            send_json(stream, &host_shopping_list(state, &user)?)
        }
        ("POST", "/api/interaction/shopping-list") => {
            let user = require_host_user_or_app(state, &request)?;
            let update: HostShoppingListUpdate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            save_host_shopping_list(state, &user, &update.markdown)?;
            send_json(stream, &host_shopping_list(state, &user)?)
        }
        ("POST", "/api/interaction/shopping-list/share") => {
            let user = require_host_user_or_app(state, &request)?;
            let update: HostShoppingListShareUpdate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            share_host_shopping_list(state, &user, &update.user, update.role.as_deref())?;
            send_json(stream, &host_shopping_list(state, &user)?)
        }
        ("POST", "/api/interaction/shopping-list/unshare") => {
            let user = require_host_user_or_app(state, &request)?;
            let update: HostShoppingListShareUpdate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            unshare_host_shopping_list(state, &user, &update.user)?;
            send_json(stream, &host_shopping_list(state, &user)?)
        }
        ("POST", "/api/interaction/shopping-list/role") => {
            let user = require_host_user_or_app(state, &request)?;
            let update: HostShoppingListRoleUpdate = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            set_host_shopping_list_role(state, &user, &update.user, &update.role)?;
            send_json(stream, &host_shopping_list(state, &user)?)
        }
        ("GET", "/api/eutherium/me") => {
            let user = require_host_user(state, &request)?;
            send_json(stream, &host_eutherium_me(state, &user)?)
        }
        ("GET", "/api/eutherium/ledger") => {
            let user = require_host_user(state, &request)?;
            send_json(stream, &host_eutherium_ledger_result(&user)?)
        }
        ("GET", "/api/eutherium/activity") => {
            let user = require_host_user(state, &request)?;
            send_json(stream, &host_eutherium_activity_result(&user)?)
        }
        ("POST", "/api/eutherium/award") => {
            let awarder = match require_host_eutherium_awarder(state, &request) {
                Ok(awarder) => awarder,
                Err(err) => return send_error(stream, 403, &err.to_string()),
            };
            let award: HostEutheriumAwardRequest = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            award_host_eutherium(state, &awarder, award)?;
            if is_host_admin(state, &awarder)? {
                send_json(stream, &host_eutherium_admin_result(state)?)
            } else {
                send_json(stream, &serde_json::json!({ "ok": true }))
            }
        }
        ("GET", "/api/eutherium/admin") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            send_json(stream, &host_eutherium_admin_result(state)?)
        }
        ("GET", "/api/shop/items") => {
            require_host_user(state, &request)?;
            send_json(stream, &serde_json::json!({ "items": host_shop_items() }))
        }
        ("POST", "/api/shop/buy") => {
            let user = require_host_user(state, &request)?;
            let buy: HostShopBuyRequest = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            buy_host_shop_item(&user, &buy.item_id)?;
            send_json(stream, &host_eutherium_me(state, &user)?)
        }
        ("GET", "/api/inventory") => {
            let user = require_host_user(state, &request)?;
            send_json(stream, &host_inventory_result(&user)?)
        }
        ("POST", "/api/inventory/equip") => {
            require_host_user(state, &request)?;
            send_json(
                stream,
                &serde_json::json!({ "ok": true, "message": "equipment slots are reserved for item-to-item trophies" }),
            )
        }
        ("GET", path) if path.starts_with("/api/trophy-room/") => {
            require_host_user(state, &request)?;
            let room_user = host_trophy_room_user_from_path(path)?;
            send_json(stream, &host_trophy_room_result(&room_user)?)
        }
        ("POST", "/api/trophy-room/layout") => {
            let user = require_host_user(state, &request)?;
            let update: HostTrophyRoomLayoutRequest = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            save_host_trophy_room_layout(&user, update.layout)?;
            send_json(stream, &host_trophy_room_result(&user)?)
        }
        ("GET", "/api/video-chat") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let client_id = host_video_chat_client_id(&request)?;
            let after_id = query_string_value(&request.path, "after")?
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            send_json(
                stream,
                &host_video_chat_status(state, &instance_id, &client_id, &user, after_id)?,
            )
        }
        ("POST", "/api/video-chat/join") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let client_id = host_video_chat_client_id(&request)?;
            let can_send = query_string_value(&request.path, "canSend")?
                .or_else(|| query_string_value(&request.path, "can_send").ok().flatten())
                .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"));
            join_host_video_chat(state, &instance_id, &client_id, &user, can_send)?;
            send_json(
                stream,
                &host_video_chat_status(state, &instance_id, &client_id, &user, 0)?,
            )
        }
        ("POST", "/api/video-chat/leave") => {
            require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let client_id = host_video_chat_client_id(&request)?;
            leave_host_video_chat(state, &instance_id, &client_id)?;
            send_json(stream, &serde_json::json!({ "ok": true }))
        }
        ("POST", "/api/video-chat/signal") => {
            let user = require_host_user(state, &request)?;
            let instance_id = host_instance_id(&request.path)?;
            let client_id = host_video_chat_client_id(&request)?;
            let signal: HostVideoChatSignalRequest = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            post_host_video_chat_signal(state, &instance_id, &client_id, &user, signal)?;
            send_json(stream, &serde_json::json!({ "ok": true }))
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
        ("POST", "/api/admin/users/permissions") => {
            if let Err(err) = require_host_admin(state, &request) {
                return send_error(stream, 403, &err.to_string());
            }
            let form =
                parse_urlencoded_form(std::str::from_utf8(&request.body).unwrap_or_default())?;
            let username = form_value(&form, "username").unwrap_or_default();
            let permissions = HostPermissions {
                can_play: form_bool(&form, "can_play"),
                can_launch_roms: form_bool(&form, "can_launch_roms"),
                can_upload_roms: form_bool(&form, "can_upload_roms"),
                can_manage_library: form_bool(&form, "can_manage_library"),
                can_award_eutherium: form_bool(&form, "can_award_eutherium"),
                can_camera_admin: form_bool(&form, "can_camera_admin"),
            };
            set_host_user_permissions(state, &username, permissions)?;
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
        ("GET", path) if is_eutherbooks_audio_stream_path(path) => {
            proxy_eutherbooks_request(stream, &request)
        }
        ("GET", CAMERA_ADMIN_PATH) => {
            let Some(user) = authenticated_user(state, &request)? else {
                return send_login_page(stream, None);
            };
            if let Err(err) = require_host_permission(state, &user, HostPermission::CameraAdmin) {
                return send_error(stream, 403, &err.to_string());
            }
            send_camera_admin_page(stream)
        }
        _ => {
            if is_camera_frigate_proxy_path(path) {
                let user = require_host_user(state, &request)?;
                if let Err(err) = require_host_permission(state, &user, HostPermission::CameraAdmin)
                {
                    return send_error(stream, 403, &err.to_string());
                }
                return proxy_camera_frigate_request(stream, &request);
            }
            if is_eutherbooks_proxy_path(path) {
                let user = require_host_user_or_app(state, &request)?;
                if eutherbooks_route_requires_manage_library(path, &request.method) {
                    if let Err(err) =
                        require_host_permission(state, &user, HostPermission::ManageLibrary)
                    {
                        return send_error(stream, 403, &err.to_string());
                    }
                }
                return proxy_eutherbooks_request(stream, &request);
            }
            let Some(user) = authenticated_user(state, &request)? else {
                return if path.starts_with("/api/") {
                    send_error(stream, 401, "login required")
                } else {
                    send_login_page(stream, None)
                };
            };
            if request.method != "GET"
                && !is_eutherbooks_proxy_path(path)
                && !is_camera_frigate_proxy_path(path)
                && !valid_csrf_token(state, &request)?
            {
                return send_error(stream, 403, "csrf token required");
            }
            if path.starts_with("/eutherdoom-runtime/") {
                return send_external_runtime_static(
                    stream,
                    path,
                    "/eutherdoom-runtime/",
                    "EUTHERDOOM_RUNTIME_PATH",
                    "/home/nichlas/eutherdoom-runtime",
                );
            }
            if path.starts_with("/eutherduke-runtime/") {
                return send_external_runtime_static(
                    stream,
                    path,
                    "/eutherduke-runtime/",
                    "EUTHERDUKE_RUNTIME_PATH",
                    "/home/nichlas/eutherduke-runtime",
                );
            }
            if path.starts_with("/eutheralert-runtime/") {
                return send_external_runtime_static(
                    stream,
                    path,
                    "/eutheralert-runtime/",
                    "EUTHERALERT_RUNTIME_PATH",
                    "/home/nichlas/eutheralert-runtime",
                );
            }
            if path == "/"
                || path == "/index.html"
                || path.starts_with("/assets/")
                || path.starts_with("/eutheralert/")
                || path.starts_with("/euthercivet-game/")
            {
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
            if let Some(permission) = host_route_permission(path, &request.method) {
                if let Err(err) = require_host_permission(state, &user, permission) {
                    return send_error(stream, 403, &err.to_string());
                }
            }
            if host_route_requires_writable_library(path, &request.method)
                && state.config.library_read_only
                && !is_host_admin(state, &user)?
            {
                return send_error(stream, 403, "library is read-only");
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
    let cookie = host_session_cookie(state, request, &token, None);
    send_response_with_headers(
        stream,
        303,
        "text/plain; charset=utf-8",
        b"",
        &[("Location", "/#/play"), ("Set-Cookie", &cookie)],
    )
}

fn host_app_login(
    stream: &mut TcpStream,
    state: &HostState,
    request: &HttpRequest,
) -> io::Result<()> {
    let login: HostAppLoginRequest =
        serde_json::from_slice(&request.body).map_err(|err| invalid_request(err.to_string()))?;
    let remote_addr = stream
        .peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let username = login.username.trim();
    if login_rate_limited(state, &remote_addr, username)? {
        audit_host_event(
            state,
            "app_login",
            Some(username),
            &remote_addr,
            false,
            "rate_limited",
        )?;
        return send_error(stream, 429, "too many attempts");
    }
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(index) = users.iter().position(|user| user.name == username) else {
        record_login_failure(state, &remote_addr, username)?;
        audit_host_event(
            state,
            "app_login",
            Some(username),
            &remote_addr,
            false,
            "unknown_user",
        )?;
        return send_error(stream, 401, "login rejected");
    };
    if users[index].banned {
        record_login_failure(state, &remote_addr, username)?;
        audit_host_event(
            state,
            "app_login",
            Some(username),
            &remote_addr,
            false,
            "banned_user",
        )?;
        return send_error(stream, 401, "login rejected");
    }
    if !verify_password(&login.password, &users[index].password_hash) {
        record_login_failure(state, &remote_addr, username)?;
        audit_host_event(
            state,
            "app_login",
            Some(username),
            &remote_addr,
            false,
            "bad_password",
        )?;
        return send_error(stream, 401, "login rejected");
    }
    let token = match users[index].app_token.clone() {
        Some(token) if !token.trim().is_empty() => token,
        _ => {
            let token = random_token()?;
            users[index].app_token = Some(token.clone());
            save_host_users(&users)?;
            token
        }
    };
    clear_login_failures(state, &remote_addr, username)?;
    audit_host_event(state, "app_login", Some(username), &remote_addr, true, "ok")?;
    send_json(
        stream,
        &serde_json::json!({
            "authenticated": true,
            "user": users[index].name,
            "token": token,
            "lanServerUrl": users[index].app_lan_server_url.as_deref().unwrap_or(""),
            "config": host_app_config(state),
        }),
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
    let cookie = host_session_cookie(state, request, "", Some(0));
    send_response_with_headers(
        stream,
        303,
        "text/plain; charset=utf-8",
        b"",
        &[("Location", "/login"), ("Set-Cookie", &cookie)],
    )
}

fn host_eutherduke_log(
    stream: &mut TcpStream,
    state: &HostState,
    request: &HttpRequest,
) -> io::Result<()> {
    let Some(user) = authenticated_user(state, request)? else {
        append_eutherduke_browser_log(stream, "anonymous", "unauthenticated log request")?;
        return send_error(stream, 401, "login required");
    };
    let message = host_eutherduke_log_message(request);
    append_eutherduke_browser_log(stream, &user, &message)?;
    send_json(stream, &serde_json::json!({ "ok": true, "logged": true }))
}

fn host_eutherbooks_player_log(
    stream: &mut TcpStream,
    state: &HostState,
    request: &HttpRequest,
) -> io::Result<()> {
    let user = authenticated_user(state, request)?
        .or_else(|| authenticated_app_user(state, request).ok().flatten())
        .unwrap_or_else(|| "anonymous".to_string());
    append_eutherbooks_player_log(stream, &user, request)?;
    send_json(stream, &serde_json::json!({ "ok": true, "logged": true }))
}

fn host_eutherduke_log_message(request: &HttpRequest) -> String {
    let message = if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&request.body) {
        value
            .get("message")
            .and_then(|message| message.as_str())
            .or_else(|| value.get("line").and_then(|message| message.as_str()))
            .unwrap_or_default()
            .to_string()
    } else {
        String::from_utf8_lossy(&request.body).to_string()
    };
    message
        .chars()
        .map(|ch| match ch {
            '\r' | '\n' | '\t' => ' ',
            _ if ch.is_control() => ' ',
            _ => ch,
        })
        .collect::<String>()
}

fn append_eutherduke_browser_log(stream: &TcpStream, user: &str, message: &str) -> io::Result<()> {
    let remote_addr = stream
        .peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let message = message.trim();
    if message.is_empty() {
        return Ok(());
    }
    let message = message.chars().take(2_000).collect::<String>();
    let _log_guard = EUTHERDUKE_BROWSER_LOG_LOCK.lock().ok();
    if let Some(parent) = Path::new(EUTHERDUKE_BROWSER_LOG_PATH).parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(EUTHERDUKE_BROWSER_LOG_PATH)?;
    writeln!(
        file,
        "unix_ms={} user={} ip={} {}",
        unix_ms_now(),
        user,
        remote_addr,
        message
    )?;
    Ok(())
}

fn append_eutherbooks_player_log(
    stream: &TcpStream,
    user: &str,
    request: &HttpRequest,
) -> io::Result<()> {
    let remote_addr = stream
        .peer_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let user_agent = header_value(request, "user-agent").unwrap_or_default();
    let payload = serde_json::from_slice::<serde_json::Value>(&request.body)
        .unwrap_or_else(|_| serde_json::json!({ "raw": String::from_utf8_lossy(&request.body) }));
    let entry = serde_json::json!({
        "unix_ms": unix_ms_now(),
        "user": user,
        "ip": remote_addr,
        "user_agent": user_agent.chars().take(300).collect::<String>(),
        "payload": clamp_json_log_value(payload, 3000),
    });
    let _log_guard = EUTHERBOOKS_PLAYER_LOG_LOCK.lock().ok();
    if let Some(parent) = Path::new(EUTHERBOOKS_PLAYER_LOG_PATH).parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(EUTHERBOOKS_PLAYER_LOG_PATH)?;
    serde_json::to_writer(&mut file, &entry).map_err(|err| io::Error::other(err.to_string()))?;
    file.write_all(b"\n")
}

fn clamp_json_log_value(value: serde_json::Value, max_string_len: usize) -> serde_json::Value {
    match value {
        serde_json::Value::String(text) => {
            serde_json::Value::String(text.chars().take(max_string_len).collect())
        }
        serde_json::Value::Array(values) => serde_json::Value::Array(
            values
                .into_iter()
                .take(40)
                .map(|value| clamp_json_log_value(value, max_string_len))
                .collect(),
        ),
        serde_json::Value::Object(values) => serde_json::Value::Object(
            values
                .into_iter()
                .take(80)
                .map(|(key, value)| {
                    (
                        key.chars().take(80).collect(),
                        clamp_json_log_value(value, max_string_len),
                    )
                })
                .collect(),
        ),
        other => other,
    }
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

fn require_host_user_or_app(state: &HostState, request: &HttpRequest) -> io::Result<String> {
    if let Some(user) = authenticated_user(state, request)? {
        return Ok(user);
    }
    authenticated_app_user(state, request)?.ok_or_else(|| invalid_request("login required"))
}

fn authenticated_app_user(state: &HostState, request: &HttpRequest) -> io::Result<Option<String>> {
    let Some(token) = app_token(request) else {
        return Ok(None);
    };
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(users
        .iter()
        .find(|user| {
            !user.banned
                && user
                    .app_token
                    .as_deref()
                    .is_some_and(|known| known.as_bytes() == token.as_bytes())
        })
        .map(|user| user.name.clone()))
}

fn host_app_lan_server_url(state: &HostState, username: &str) -> io::Result<String> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(users
        .iter()
        .find(|user| user.name == username)
        .and_then(|user| user.app_lan_server_url.as_deref())
        .unwrap_or("")
        .to_string())
}

fn host_app_config(state: &HostState) -> serde_json::Value {
    let public_server_url = state.config.app_public_server_url.as_deref().unwrap_or("");
    let lan_server_url = state.config.app_lan_server_url.as_deref().unwrap_or("");
    let mut server_urls = Vec::new();
    push_unique_url(&mut server_urls, lan_server_url);
    push_unique_url(&mut server_urls, public_server_url);

    let mut eutherbooks_urls = Vec::new();
    for url in &state.config.eutherbooks_server_urls {
        push_unique_url(&mut eutherbooks_urls, url);
    }
    if eutherbooks_urls.is_empty() {
        if let Some(url) = eutherbooks_url_from_host(lan_server_url) {
            push_unique_url(&mut eutherbooks_urls, &url);
        }
        if let Some(url) = eutherbooks_url_from_host(public_server_url) {
            push_unique_url(&mut eutherbooks_urls, &url);
        }
    }

    serde_json::json!({
        "publicServerUrl": public_server_url,
        "lanServerUrl": lan_server_url,
        "serverUrls": server_urls,
        "eutherbooksUrls": eutherbooks_urls,
    })
}

fn eutherbooks_url_from_host(host_url: &str) -> Option<String> {
    let clean = host_url.trim().trim_end_matches('/');
    if clean.is_empty() {
        return None;
    }
    Some(format!("{clean}/eutherbooks"))
}

fn push_unique_url(urls: &mut Vec<String>, url: &str) {
    let clean = url.trim().trim_end_matches('/');
    if clean.is_empty() || urls.iter().any(|known| known == clean) {
        return;
    }
    urls.push(clean.to_string());
}

fn host_app_token_path(path: &str) -> bool {
    matches!(
        path,
        "/api/app/status"
            | "/api/interaction/users"
            | "/api/interaction/shopping-list"
            | "/api/interaction/shopping-list/share"
            | "/api/interaction/shopping-list/unshare"
            | "/api/interaction/shopping-list/role"
    )
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

fn require_host_eutherium_awarder(state: &HostState, request: &HttpRequest) -> io::Result<String> {
    let user = require_host_user(state, request)?;
    let permissions = host_permissions(state, &user)?;
    if permissions.can_award_eutherium {
        Ok(user)
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Eutherium award permission required",
        ))
    }
}

#[derive(Clone, Copy)]
enum HostPermission {
    Play,
    LaunchRoms,
    UploadRoms,
    ManageLibrary,
    CameraAdmin,
}

fn host_permissions(state: &HostState, username: &str) -> io::Result<HostPermissions> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(user) = users
        .iter()
        .find(|user| user.name == username && !user.banned)
    else {
        return Ok(HostPermissions {
            can_play: false,
            can_launch_roms: false,
            can_upload_roms: false,
            can_manage_library: false,
            can_award_eutherium: false,
            can_camera_admin: false,
        });
    };
    Ok(host_permissions_for_user(user))
}

fn host_permissions_for_user(user: &HostUser) -> HostPermissions {
    if user.admin {
        return HostPermissions {
            can_play: true,
            can_launch_roms: true,
            can_upload_roms: true,
            can_manage_library: true,
            can_award_eutherium: true,
            can_camera_admin: true,
        };
    }
    HostPermissions {
        can_play: user.can_play,
        can_launch_roms: user.can_launch_roms,
        can_upload_roms: user.can_upload_roms,
        can_manage_library: user.can_manage_library,
        can_award_eutherium: user.can_award_eutherium,
        can_camera_admin: user.can_camera_admin,
    }
}

fn require_host_permission(
    state: &HostState,
    username: &str,
    permission: HostPermission,
) -> io::Result<()> {
    let permissions = host_permissions(state, username)?;
    let allowed = match permission {
        HostPermission::Play => permissions.can_play,
        HostPermission::LaunchRoms => permissions.can_launch_roms,
        HostPermission::UploadRoms => permissions.can_upload_roms,
        HostPermission::ManageLibrary => permissions.can_manage_library,
        HostPermission::CameraAdmin => permissions.can_camera_admin,
    };
    if allowed {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "user permission required",
        ))
    }
}

fn host_instance_id(path: &str) -> io::Result<String> {
    Ok(query_string_value(path, "instance")?
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string()))
}

fn host_instance_kind(path: &str) -> io::Result<HostInstanceKind> {
    match query_string_value(path, "kind")?.as_deref() {
        None | Some("") | Some("megadrive") => Ok(HostInstanceKind::MegaDrive),
        Some("eutheralert") | Some("alert") | Some("redalert") | Some("ra") => {
            Ok(HostInstanceKind::EutherAlert)
        }
        Some("eutherdoom") | Some("doom") => Ok(HostInstanceKind::EutherDoom),
        Some(_) => Err(invalid_request("unknown instance kind")),
    }
}

fn create_host_instance(
    state: &HostState,
    user: &str,
    kind: HostInstanceKind,
) -> io::Result<String> {
    let mut next = state
        .next_instance_id
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let prefix = match kind {
        HostInstanceKind::MegaDrive => "vessel",
        HostInstanceKind::EutherAlert => "alert",
        HostInstanceKind::EutherDoom => "doom",
    };
    let id = format!("{prefix}-{}", *next);
    *next += 1;
    let ordinal = id
        .split_once('-')
        .map(|(_, value)| value)
        .unwrap_or(id.as_str());
    let name = match kind {
        HostInstanceKind::MegaDrive => format!("Reaction Vessel {ordinal}"),
        HostInstanceKind::EutherAlert => format!("EutherAlert Vessel {ordinal}"),
        HostInstanceKind::EutherDoom => format!("EutherDoom Server {ordinal}"),
    };
    let created_unix_ms = unix_ms_now();
    let alert_seed = if kind == HostInstanceKind::EutherAlert {
        host_alert_seed(&id, created_unix_ms)
    } else {
        0
    };
    let mut instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    instances.push(HostInstance {
        id: id.clone(),
        name,
        kind,
        bridge: new_bridge_state(Emulator::new()),
        doom: (kind == HostInstanceKind::EutherDoom).then(|| {
            Arc::new(Mutex::new(eutherdoom_server::DoomSession::new(
                Duration::from_millis(250),
            )))
        }),
        alert_seed,
        alert_events: Arc::new(Mutex::new(Vec::new())),
        host_owner: Some(user.to_string()),
        created_unix_ms,
    });
    Ok(id)
}

fn host_instance_bridge(state: &HostState, instance_id: &str) -> io::Result<BridgeState> {
    Ok(host_instance_snapshot(state, instance_id)?.bridge)
}

fn host_instance_snapshot(state: &HostState, instance_id: &str) -> io::Result<HostInstance> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    instances
        .iter()
        .find(|instance| instance.id == instance_id)
        .cloned()
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
    {
        let mut rooms = state
            .video_chat_rooms
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        rooms.retain(|room| room.instance_id != instance_id);
    }
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

fn host_route_permission(path: &str, method: &str) -> Option<HostPermission> {
    match (method, path) {
        ("POST", "/load") => Some(HostPermission::UploadRoms),
        ("POST", "/rom-dir/load")
        | ("POST", "/reset")
        | ("POST", "/state/save")
        | ("POST", "/state/load") => Some(HostPermission::LaunchRoms),
        ("POST", "/rom-dir") | ("POST", "/shader-config") => Some(HostPermission::ManageLibrary),
        ("POST", "/build/release") | ("POST", "/build/profile") => {
            Some(HostPermission::ManageLibrary)
        }
        ("POST", "/input")
        | ("GET", "/frame")
        | ("POST", "/frame")
        | ("GET", "/frame.bin")
        | ("POST", "/frame.bin")
        | ("GET", "/frame-audio.bin")
        | ("POST", "/frame-audio.bin")
        | ("GET", "/stream-frame-audio.bin")
        | ("GET", "/stream-video.mp4")
        | ("POST", "/webrtc/offer")
        | ("GET", "/audio.bin")
        | ("POST", "/audio.bin")
        | ("POST", "/eutherdogs/start")
        | ("POST", "/eutherdogs/next")
        | ("POST", "/eutherdogs/reset")
        | ("POST", "/eutherdogs/reset-money")
        | ("POST", "/eutherdogs/frame")
        | ("POST", "/eutherdogs/input")
        | ("GET", "/eutherdogs/snapshot")
        | ("GET", "/eutherdogs/stream")
        | ("POST", "/eutherdogs/purchase")
        | ("POST", "/eutherdogs-highscores") => Some(HostPermission::Play),
        _ => None,
    }
}

fn host_route_requires_writable_library(path: &str, method: &str) -> bool {
    matches!((method, path), ("POST", "/load") | ("POST", "/rom-dir"))
}

fn eutherbooks_route_requires_manage_library(path: &str, method: &str) -> bool {
    method == "POST" && path == "/eutherbooks/books/upload"
}

fn is_eutherbooks_proxy_path(path: &str) -> bool {
    path == "/eutherbooks" || path.starts_with("/eutherbooks/")
}

fn is_camera_frigate_proxy_path(path: &str) -> bool {
    path == CAMERA_FRIGATE_PROXY_PREFIX
        || path
            .strip_prefix(CAMERA_FRIGATE_PROXY_PREFIX)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn is_eutherbooks_audio_stream_path(path: &str) -> bool {
    if path.starts_with("/eutherbooks/audio/") {
        return true;
    }
    let Some(stripped) = path.strip_prefix("/eutherbooks/jobs/") else {
        return false;
    };
    stripped.ends_with("/audio") && !stripped.trim_matches('/').is_empty()
}

fn host_route_requires_origin_check(path: &str) -> bool {
    matches!(
        path,
        "/stream-frame-audio.bin"
            | "/stream-frame.bin"
            | "/stream-video.mp4"
            | "/webrtc/offer"
            | "/eutherdogs/stream"
    )
}

fn host_lobby_status(state: &HostState) -> io::Result<serde_json::Value> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let mut payload = Vec::with_capacity(instances.len());
    for instance in instances.iter() {
        if instance.kind == HostInstanceKind::EutherDoom {
            release_expired_doom_players(instance)?;
        }
        let slots = bridge_player_slots_json(&instance.bridge)?;
        let subscribers = bridge_subscriber_count(&instance.bridge)?;
        let (loaded, title, frame) = match instance.kind {
            HostInstanceKind::MegaDrive => {
                let emulator = lock_bridge_emulator(&instance.bridge)?;
                let status = bridge_status(&emulator);
                (status.loaded, status.title, status.frame)
            }
            HostInstanceKind::EutherAlert => (
                true,
                "Command and Conquer: Red Alert runtime".to_string(),
                0,
            ),
            HostInstanceKind::EutherDoom => {
                let doom = instance
                    .doom
                    .as_ref()
                    .ok_or_else(|| io::Error::other("doom instance missing state"))?
                    .lock()
                    .map_err(|err| io::Error::other(err.to_string()))?;
                (
                    true,
                    "Lockstep Relay".to_string(),
                    doom.current_tic() as u64,
                )
            }
        };
        payload.push(serde_json::json!({
            "id": instance.id,
            "name": instance.name,
            "kind": instance.kind.as_str(),
            "modeLabel": instance.kind.label(),
            "loaded": loaded,
            "title": title,
            "frame": frame,
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
            let active = slot.as_ref().is_some_and(|lease| {
                now.duration_since(lease.updated) <= HOST_PLAYER_LEASE_TIMEOUT
            });
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

fn host_social_user_search(
    state: &HostState,
    current_user: &str,
    query: &str,
) -> io::Result<serde_json::Value> {
    let needle = query.trim().to_lowercase();
    let online_users = active_host_session_users(state)?;
    let activity_labels = host_user_activity_labels(state)?;
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let mut payload = users
        .iter()
        .filter(|user| !user.banned && user.name != current_user)
        .filter(|user| needle.is_empty() || user.name.to_lowercase().contains(&needle))
        .map(|user| {
            let online = online_users.contains(&user.name);
            serde_json::json!({
                "name": user.name,
                "displayName": host_display_user_name(&user.name),
                "online": online,
                "status": if online { "Online" } else { "Offline" },
                "location": if online {
                    activity_labels
                        .get(&user.name)
                        .cloned()
                        .unwrap_or_else(|| "Online on host".to_string())
                } else {
                    "Offline".to_string()
                },
            })
        })
        .collect::<Vec<_>>();
    if current_user != HOST_CODEX_USER
        && (needle.is_empty()
            || HOST_CODEX_USER.contains(&needle)
            || HOST_CODEX_DISPLAY_NAME.to_lowercase().contains(&needle))
    {
        payload.push(serde_json::json!({
            "name": HOST_CODEX_USER,
            "displayName": HOST_CODEX_DISPLAY_NAME,
            "online": false,
            "status": "Offline",
            "location": "Developer inbox - files land in .euther-host/codex-inbox",
            "special": "codex",
        }));
    }
    payload.sort_by_key(|user| {
        user.get("displayName")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_lowercase()
    });
    payload.truncate(24);
    Ok(serde_json::json!({ "users": payload }))
}

fn host_social_conversation_list(user: &str) -> io::Result<serde_json::Value> {
    let mut conversations = read_host_social_conversations()?
        .into_iter()
        .filter(|conversation| conversation.participants.iter().any(|entry| entry == user))
        .collect::<Vec<_>>();
    conversations.sort_by(|a, b| b.updated_unix_ms.cmp(&a.updated_unix_ms));
    Ok(serde_json::json!({ "conversations": conversations }))
}

fn host_social_create_conversation(
    state: &HostState,
    current_user: &str,
    create: HostSocialConversationCreate,
) -> io::Result<serde_json::Value> {
    let mut participants = create.participants;
    participants.push(current_user.to_string());
    participants = normalized_host_social_participants(participants);
    if participants.len() < 2 {
        return Err(invalid_request("choose at least one other user"));
    }
    validate_host_social_participants(state, &participants)?;

    let now = unix_ms_now();
    let kind = if participants.len() == 2 {
        HostSocialConversationKind::Direct
    } else {
        HostSocialConversationKind::Group
    };
    let mut conversations = read_host_social_conversations()?;
    if kind == HostSocialConversationKind::Direct {
        if let Some(existing) = conversations
            .iter()
            .find(|conversation| {
                conversation.kind == HostSocialConversationKind::Direct
                    && conversation.participants == participants
            })
            .cloned()
        {
            return Ok(serde_json::json!({ "conversation": existing }));
        }
    }

    let id = match kind {
        HostSocialConversationKind::Direct => {
            format!(
                "dm-{}",
                participants
                    .iter()
                    .map(|user| host_social_slug(user))
                    .collect::<Vec<_>>()
                    .join("-")
            )
        }
        HostSocialConversationKind::Group => {
            format!(
                "group-{}-{:016x}",
                now,
                host_social_hash(&format!("{}:{:?}", current_user, participants))
            )
        }
    };
    let title = create
        .title
        .map(|title| title.trim().chars().take(80).collect::<String>())
        .filter(|title| !title.is_empty());
    let conversation = HostSocialConversation {
        id,
        kind,
        title,
        participants,
        created_by: current_user.to_string(),
        created_unix_ms: now,
        updated_unix_ms: now,
        last_message: None,
    };
    conversations.push(conversation.clone());
    write_host_social_conversations(&conversations)?;
    Ok(serde_json::json!({ "conversation": conversation }))
}

fn host_social_message_list(
    user: &str,
    conversation_id: &str,
    before_id: Option<u64>,
    limit: usize,
) -> io::Result<serde_json::Value> {
    let conversation = host_social_conversation_for_user(user, conversation_id)?;
    let mut messages = read_host_social_messages(conversation_id)?;
    if let Some(before_id) = before_id {
        messages.retain(|message| message.id < before_id);
    }
    let limit = limit.clamp(1, 160);
    if messages.len() > limit {
        let keep_from = messages.len() - limit;
        messages.drain(0..keep_from);
    }
    let has_older = messages.first().map(|first| first.id > 1).unwrap_or(false);
    Ok(serde_json::json!({
        "conversation": conversation,
        "messages": messages,
        "hasOlder": has_older,
    }))
}

fn host_social_post_message(
    user: &str,
    conversation_id: &str,
    create: HostSocialMessageCreate,
) -> io::Result<serde_json::Value> {
    let text = create.text.trim();
    let attachment_ids = create.attachments;
    if text.is_empty() && attachment_ids.is_empty() {
        return Err(invalid_request("message is empty"));
    }
    let text = text.chars().take(2000).collect::<String>();
    let attachments = host_social_attachments_from_ids(&attachment_ids)?;
    let mut conversations = read_host_social_conversations()?;
    let conversation = conversations
        .iter_mut()
        .find(|conversation| conversation.id == conversation_id)
        .ok_or_else(|| invalid_request("conversation not found"))?;
    if !conversation.participants.iter().any(|entry| entry == user) {
        return Err(invalid_request("conversation not found"));
    }

    let messages = read_host_social_messages(conversation_id)?;
    let next_id = messages.last().map(|message| message.id + 1).unwrap_or(1);
    let now = unix_ms_now();
    let message = HostSocialMessage {
        id: next_id,
        conversation_id: conversation_id.to_string(),
        user: user.to_string(),
        text,
        attachments,
        reactions: Vec::new(),
        created_unix_ms: now,
    };
    append_host_social_message(&message)?;
    conversation.updated_unix_ms = now;
    conversation.last_message = Some(HostSocialMessagePreview {
        user: user.to_string(),
        text: if message.text.is_empty() && !message.attachments.is_empty() {
            let images = message
                .attachments
                .iter()
                .filter(|attachment| attachment.content_type.starts_with("image/"))
                .count();
            if images == message.attachments.len() {
                format!("sent {} image", message.attachments.len())
            } else {
                format!("sent {} file", message.attachments.len())
            }
        } else {
            message.text.clone()
        },
        created_unix_ms: now,
    });
    let conversation = conversation.clone();
    write_host_social_conversations(&conversations)?;
    mirror_host_social_message_to_codex_inbox(&conversation, &message)?;
    Ok(serde_json::json!({
        "conversation": conversation,
        "message": message,
    }))
}

fn mirror_host_social_message_to_codex_inbox(
    conversation: &HostSocialConversation,
    message: &HostSocialMessage,
) -> io::Result<()> {
    if !conversation
        .participants
        .iter()
        .any(|participant| participant == HOST_CODEX_USER)
    {
        return Ok(());
    }
    ensure_host_codex_inbox_dir()?;
    write_host_codex_inbox_readme()?;

    let entry_name = format!(
        "{}-{}-m{:06}",
        message.created_unix_ms,
        host_social_slug(&conversation.id),
        message.id
    );
    let entry_dir = host_codex_inbox_dir().join(entry_name);
    fs::create_dir_all(&entry_dir)?;

    let mut copied_attachments = Vec::new();
    for (index, attachment) in message.attachments.iter().enumerate() {
        let (_, file_name) = read_host_social_attachment_record(&attachment.id)?;
        let source_path = host_social_attachment_file_path(&file_name)?;
        let inbox_file_name = format!(
            "{:02}-{}",
            index + 1,
            clean_host_codex_inbox_file_name(&attachment.name)
        );
        let destination_path = entry_dir.join(&inbox_file_name);
        fs::copy(&source_path, &destination_path)?;
        copied_attachments.push(serde_json::json!({
            "id": attachment.id,
            "name": attachment.name,
            "contentType": attachment.content_type,
            "sizeBytes": attachment.size_bytes,
            "chatUrl": attachment.url,
            "localFile": destination_path.to_string_lossy(),
        }));
    }

    let metadata = serde_json::json!({
        "conversationId": conversation.id,
        "conversationKind": conversation.kind,
        "participants": conversation.participants,
        "messageId": message.id,
        "sender": message.user,
        "text": message.text,
        "createdUnixMs": message.created_unix_ms,
        "attachments": copied_attachments,
    });
    let metadata_bytes =
        serde_json::to_vec_pretty(&metadata).map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(entry_dir.join("message.json"), metadata_bytes)?;
    fs::write(
        entry_dir.join("note.md"),
        host_codex_inbox_note_markdown(conversation, message, &metadata),
    )?;

    let mut index_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(host_codex_inbox_dir().join("index.jsonl"))?;
    serde_json::to_writer(&mut index_file, &metadata)
        .map_err(|err| io::Error::other(err.to_string()))?;
    index_file.write_all(b"\n")?;
    Ok(())
}

fn host_social_toggle_reaction(
    user: &str,
    conversation_id: &str,
    message_id: u64,
    update: HostSocialReactionUpdate,
) -> io::Result<serde_json::Value> {
    let conversation = host_social_conversation_for_user(user, conversation_id)?;
    let key = validate_host_social_reaction_key(&update.key)?;
    let mut messages = read_host_social_messages(conversation_id)?;
    let message = messages
        .iter_mut()
        .find(|message| message.id == message_id)
        .ok_or_else(|| invalid_request("message not found"))?;
    if let Some(reaction) = message
        .reactions
        .iter_mut()
        .find(|reaction| reaction.key == key)
    {
        if reaction.users.iter().any(|entry| entry == user) {
            reaction.users.retain(|entry| entry != user);
        } else {
            reaction.users.push(user.to_string());
            reaction.users.sort();
        }
    } else {
        message.reactions.push(HostSocialReaction {
            key,
            users: vec![user.to_string()],
        });
    }
    message
        .reactions
        .retain(|reaction| !reaction.users.is_empty());
    message.reactions.sort_by(|a, b| a.key.cmp(&b.key));
    let message = message.clone();
    write_host_social_messages(conversation_id, &messages)?;
    Ok(serde_json::json!({
        "conversation": conversation,
        "message": message,
    }))
}

fn host_social_upload_attachment(
    _user: &str,
    upload: HostSocialAttachmentUpload,
) -> io::Result<serde_json::Value> {
    let (content_type, is_image) =
        validate_host_social_attachment_content_type(&upload.content_type, &upload.name)?;
    let bytes = decode_base64(upload.data_base64.trim())?;
    let max_bytes = if is_image {
        HOST_SOCIAL_ATTACHMENT_MAX_BYTES
    } else {
        HOST_SOCIAL_FILE_ATTACHMENT_MAX_BYTES
    };
    if bytes.is_empty() || bytes.len() > max_bytes {
        return Err(invalid_request("file is too large"));
    }
    if is_image {
        validate_host_social_attachment_magic(&content_type, &bytes)?;
    }
    let now = unix_ms_now();
    let extension = host_social_attachment_extension(&content_type, &upload.name);
    let id = format!("att-{}-{:016x}", now, random_u64()?);
    let file_name = format!("{id}.{extension}");
    ensure_host_social_attachments_dir()?;
    fs::write(host_social_attachment_file_path(&file_name)?, &bytes)?;
    let attachment = HostSocialAttachment {
        id: id.clone(),
        name: clean_host_social_attachment_name(&upload.name),
        content_type,
        size_bytes: bytes.len(),
        url: format!("/api/social/attachments/{id}"),
    };
    write_host_social_attachment_manifest(&attachment, &file_name)?;
    Ok(serde_json::json!({ "attachment": attachment }))
}

fn host_social_upload_raw_attachment(
    stream: &mut TcpStream,
    request: &HttpRequest,
    _user: &str,
) -> io::Result<serde_json::Value> {
    let name = query_string_value(&request.path, "name")?.unwrap_or_else(|| "file".to_string());
    let requested_content_type = query_string_value(&request.path, "contentType")?
        .or_else(|| header_value(request, "content-type").map(str::to_string))
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let (content_type, is_image) =
        validate_host_social_attachment_content_type(&requested_content_type, &name)?;
    let max_bytes = if is_image {
        HOST_SOCIAL_ATTACHMENT_MAX_BYTES
    } else {
        HOST_SOCIAL_FILE_ATTACHMENT_MAX_BYTES
    };
    if request.content_length == 0 || request.content_length > max_bytes {
        return Err(invalid_request("file is too large"));
    }

    let now = unix_ms_now();
    let extension = host_social_attachment_extension(&content_type, &name);
    let id = format!("att-{}-{:016x}", now, random_u64()?);
    let file_name = format!("{id}.{extension}");
    let temp_file_name = format!("{file_name}.tmp");
    ensure_host_social_attachments_dir()?;
    let final_path = host_social_attachment_file_path(&file_name)?;
    let temp_path = host_social_attachment_file_path(&temp_file_name)?;

    stream.set_read_timeout(None)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)?;
    let mut remaining = request.content_length;
    let initial = &request.body[..request.body.len().min(remaining)];
    let mut head = initial.iter().copied().take(16).collect::<Vec<_>>();
    file.write_all(initial)?;
    remaining -= initial.len();
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 {
        let to_read = buffer.len().min(remaining);
        let read = stream.read(&mut buffer[..to_read])?;
        if read == 0 {
            let _ = fs::remove_file(&temp_path);
            return Err(invalid_request("incomplete file upload"));
        }
        if head.len() < 16 {
            let take = (16 - head.len()).min(read);
            head.extend_from_slice(&buffer[..take]);
        }
        file.write_all(&buffer[..read])?;
        remaining -= read;
    }
    file.flush()?;
    if is_image {
        validate_host_social_attachment_magic(&content_type, &head)?;
    }
    fs::rename(&temp_path, &final_path)?;
    let attachment = HostSocialAttachment {
        id: id.clone(),
        name: clean_host_social_attachment_name(&name),
        content_type,
        size_bytes: request.content_length,
        url: format!("/api/social/attachments/{id}"),
    };
    write_host_social_attachment_manifest(&attachment, &file_name)?;
    Ok(serde_json::json!({ "attachment": attachment }))
}

fn host_social_attachments_from_ids(ids: &[String]) -> io::Result<Vec<HostSocialAttachment>> {
    if ids.len() > 6 {
        return Err(invalid_request("too many images"));
    }
    ids.iter()
        .map(|id| read_host_social_attachment_manifest(id))
        .collect()
}

fn send_host_social_attachment(stream: &mut TcpStream, attachment_id: &str) -> io::Result<()> {
    let (attachment, file_name) = read_host_social_attachment_record(attachment_id)?;
    let path = host_social_attachment_file_path(&file_name)?;
    let bytes = fs::read(path)?;
    send_response(stream, 200, &attachment.content_type, &bytes)
}

fn validate_host_social_attachment_content_type(
    content_type: &str,
    name: &str,
) -> io::Result<(String, bool)> {
    let content_type = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_lowercase();
    let normalized = match content_type.as_str() {
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" => {
            return Ok((content_type, true));
        }
        "application/vnd.android.package-archive" => "application/vnd.android.package-archive",
        "application/zip" | "application/x-zip-compressed" => "application/zip",
        "application/x-iso9660-image" => "application/x-iso9660-image",
        "application/pdf" => "application/pdf",
        "text/plain" => "text/plain; charset=utf-8",
        "text/markdown" => "text/markdown; charset=utf-8",
        "application/json" => "application/json; charset=utf-8",
        "application/octet-stream" if extension == "apk" => {
            "application/vnd.android.package-archive"
        }
        "application/octet-stream" if extension == "zip" => "application/zip",
        "application/octet-stream" if extension == "iso" => "application/x-iso9660-image",
        "application/octet-stream" if extension == "pdf" => "application/pdf",
        "application/octet-stream" if matches!(extension.as_str(), "txt" | "md" | "json") => {
            "text/plain; charset=utf-8"
        }
        _ => match extension.as_str() {
            "apk" => "application/vnd.android.package-archive",
            "zip" => "application/zip",
            "iso" => "application/x-iso9660-image",
            "pdf" => "application/pdf",
            "txt" => "text/plain; charset=utf-8",
            "md" => "text/markdown; charset=utf-8",
            "json" => "application/json; charset=utf-8",
            "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" => "application/octet-stream",
            _ => return Err(invalid_request("unsupported file type")),
        },
    };
    Ok((normalized.to_string(), false))
}

fn validate_host_social_attachment_magic(content_type: &str, bytes: &[u8]) -> io::Result<()> {
    let valid = match content_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(invalid_request("image bytes do not match content type"))
    }
}

fn validate_host_social_reaction_key(key: &str) -> io::Result<String> {
    let key = key.trim();
    if key.is_empty()
        || key.len() > 40
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid_request("invalid reaction"));
    }
    Ok(key.to_string())
}

fn host_social_attachment_extension(content_type: &str, name: &str) -> String {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
        .filter(|extension| {
            extension.len() <= 12 && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        });
    match content_type {
        "image/png" => "png".to_string(),
        "image/jpeg" => "jpg".to_string(),
        "image/gif" => "gif".to_string(),
        "image/webp" => "webp".to_string(),
        "application/vnd.android.package-archive" => "apk".to_string(),
        "application/zip" => "zip".to_string(),
        "application/x-iso9660-image" => "iso".to_string(),
        "application/pdf" => "pdf".to_string(),
        _ => extension.unwrap_or_else(|| "bin".to_string()),
    }
}

fn clean_host_codex_inbox_file_name(name: &str) -> String {
    let mut output = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    while output.contains("..") {
        output = output.replace("..", ".");
    }
    output = output.trim_matches(&['.', '_', '-'][..]).to_string();
    if output.is_empty() {
        output = "attachment.bin".to_string();
    }
    output.chars().take(96).collect()
}

fn write_host_codex_inbox_readme() -> io::Result<()> {
    ensure_host_codex_inbox_dir()?;
    fs::write(
        host_codex_inbox_dir().join("README.md"),
        format!(
            r#"# Codex Inbox

This directory receives files and images sent to `{}` in the Euther social chat.

How to use it:

1. Read this file when starting work in `/home/nichlas/EutherOxide`.
2. Inspect newest entries first: `ls -lt .euther-host/codex-inbox`.
3. Each message has its own folder with:
   - `message.json` for structured metadata.
   - `note.md` for a readable summary.
   - copied attachment files named `01-*`, `02-*`, etc.
4. `index.jsonl` is an append-only log of received messages.

Notes:

- The normal social chat history remains in `.euther-host/social-chat`.
- Large files may be intentionally shared here, including APKs and ISOs.
- Treat received files as user-supplied input. Inspect names/types before running anything.
"#,
            HOST_CODEX_DISPLAY_NAME
        ),
    )
}

fn host_codex_inbox_note_markdown(
    conversation: &HostSocialConversation,
    message: &HostSocialMessage,
    metadata: &serde_json::Value,
) -> String {
    let attachments = metadata
        .get("attachments")
        .and_then(|value| value.as_array())
        .map(|attachments| {
            if attachments.is_empty() {
                "- No attachments".to_string()
            } else {
                attachments
                    .iter()
                    .map(|attachment| {
                        let name = attachment
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or("attachment");
                        let local_file = attachment
                            .get("localFile")
                            .and_then(|value| value.as_str())
                            .unwrap_or("");
                        let content_type = attachment
                            .get("contentType")
                            .and_then(|value| value.as_str())
                            .unwrap_or("application/octet-stream");
                        format!("- `{}` ({}) -> `{}`", name, content_type, local_file)
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        })
        .unwrap_or_else(|| "- No attachments".to_string());
    format!(
        "# Social Chat Message for Codex\n\n- Conversation: `{}`\n- Sender: `{}`\n- Participants: `{}`\n- Message id: `{}`\n- Created unix ms: `{}`\n\n## Text\n\n{}\n\n## Attachments\n\n{}\n",
        conversation.id,
        message.user,
        conversation.participants.join(", "),
        message.id,
        message.created_unix_ms,
        if message.text.trim().is_empty() {
            "_No text._".to_string()
        } else {
            message.text.clone()
        },
        attachments
    )
}

fn clean_host_social_attachment_name(name: &str) -> String {
    let mut output = name
        .chars()
        .filter(|ch| !ch.is_control())
        .take(120)
        .collect::<String>();
    if output.trim().is_empty() {
        output = "image".to_string();
    }
    output
}

fn host_social_conversation_for_user(
    user: &str,
    conversation_id: &str,
) -> io::Result<HostSocialConversation> {
    read_host_social_conversations()?
        .into_iter()
        .find(|conversation| {
            conversation.id == conversation_id
                && conversation.participants.iter().any(|entry| entry == user)
        })
        .ok_or_else(|| invalid_request("conversation not found"))
}

fn host_interaction_user_list(
    state: &HostState,
    current_user: &str,
) -> io::Result<serde_json::Value> {
    let online_users = active_host_session_users(state)?;
    let activity_labels = host_user_activity_labels(state)?;
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let payload = users
        .iter()
        .filter(|user| !user.banned)
        .map(|user| {
            let online = online_users.contains(&user.name);
            let location = if online {
                activity_labels
                    .get(&user.name)
                    .cloned()
                    .unwrap_or_else(|| "Online on host".to_string())
            } else {
                "Offline".to_string()
            };
            serde_json::json!({
                "name": user.name,
                "online": online,
                "status": if online { "Online" } else { "Offline" },
                "location": location,
                "isCurrentUser": user.name == current_user,
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "currentUser": current_user,
        "users": payload,
    }))
}

fn active_host_session_users(state: &HostState) -> io::Result<HashSet<String>> {
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
    Ok(sessions
        .iter()
        .map(|session| session.user.clone())
        .collect())
}

fn host_user_activity_labels(state: &HostState) -> io::Result<HashMap<String, String>> {
    let instances = state
        .instances
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let now = Instant::now();
    let mut labels = HashMap::new();
    for instance in instances.iter() {
        let label = format!("In {}", instance.name);
        if let Some(owner) = &instance.host_owner {
            labels.entry(owner.clone()).or_insert_with(|| label.clone());
        }
        let slots = instance
            .bridge
            .player_slots
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        for lease in slots.iter().flatten() {
            if now.duration_since(lease.updated) <= HOST_PLAYER_LEASE_TIMEOUT {
                labels.insert(lease.user.clone(), label.clone());
            }
        }
    }
    Ok(labels)
}

fn host_shopping_list(state: &HostState, user: &str) -> io::Result<serde_json::Value> {
    let shared_id = host_user_shopping_list_id(user)?;
    let role = host_shopping_list_role(state, user, &shared_id)?;
    let path = host_shared_shopping_list_path(&shared_id)?;
    let markdown = match fs::read_to_string(&path) {
        Ok(markdown) => markdown,
        Err(err) if err.kind() == io::ErrorKind::NotFound => default_shopping_list_markdown(),
        Err(err) => return Err(err),
    };
    let updated_unix_ms = fs::metadata(&path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);
    Ok(serde_json::json!({
        "name": "shopping-list.md",
        "sharedId": shared_id,
        "markdown": markdown,
        "members": host_shopping_list_members(state, &shared_id, user)?,
        "role": role,
        "canEdit": host_shopping_list_can_edit(&role),
        "canManage": host_shopping_list_can_manage(&role),
        "updatedUnixMs": updated_unix_ms,
    }))
}

fn save_host_shopping_list(state: &HostState, user: &str, markdown: &str) -> io::Result<()> {
    if markdown.len() > 64 * 1024 {
        return Err(invalid_request("shopping list is too large"));
    }
    let shared_id = host_user_shopping_list_id(user)?;
    let role = host_shopping_list_role(state, user, &shared_id)?;
    if !host_shopping_list_can_edit(&role) {
        return Err(invalid_request("shopping list is view only"));
    }
    let path = host_shared_shopping_list_path(&shared_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, normalize_markdown_document(markdown))
}

fn share_host_shopping_list(
    state: &HostState,
    user: &str,
    target_user: &str,
    role: Option<&str>,
) -> io::Result<()> {
    let target_user = require_existing_host_user(state, target_user)?;
    if target_user == user {
        return Err(invalid_request("cannot share a list with yourself"));
    }
    let shared_id = host_user_shopping_list_id(user)?;
    require_host_shopping_list_owner(state, user, &shared_id)?;
    let role = normalize_host_shopping_list_role(role.unwrap_or("edit"), false)?;
    let mut manifest = load_host_shopping_list_manifest(state, &shared_id, user)?;
    upsert_host_shopping_list_member(&mut manifest, &target_user, &role);
    save_host_shopping_list_manifest(&shared_id, &manifest)?;
    let dir = ensure_host_user_data_dir(&target_user)?.join("shopping-lists");
    fs::create_dir_all(&dir)?;
    fs::write(host_user_shopping_list_link_path(&target_user), shared_id)
}

fn unshare_host_shopping_list(state: &HostState, user: &str, target_user: &str) -> io::Result<()> {
    let target_user = require_existing_host_user(state, target_user)?;
    if target_user == user {
        return Err(invalid_request(
            "cannot remove yourself from the active shopping list",
        ));
    }
    let shared_id = host_user_shopping_list_id(user)?;
    require_host_shopping_list_owner(state, user, &shared_id)?;
    let mut manifest = load_host_shopping_list_manifest(state, &shared_id, user)?;
    if manifest.owner == target_user {
        return Err(invalid_request("cannot remove the owner"));
    }
    manifest.members.retain(|member| member.user != target_user);
    save_host_shopping_list_manifest(&shared_id, &manifest)?;
    let link_path = host_user_shopping_list_link_path(&target_user);
    let Ok(target_shared_id) = fs::read_to_string(&link_path) else {
        return Ok(());
    };
    if validate_host_shared_doc_id(target_shared_id.trim())
        .ok()
        .as_deref()
        == Some(shared_id.as_str())
    {
        fs::remove_file(link_path)?;
    }
    Ok(())
}

fn set_host_shopping_list_role(
    state: &HostState,
    user: &str,
    target_user: &str,
    role: &str,
) -> io::Result<()> {
    let target_user = require_existing_host_user(state, target_user)?;
    let shared_id = host_user_shopping_list_id(user)?;
    require_host_shopping_list_owner(state, user, &shared_id)?;
    let role = normalize_host_shopping_list_role(role, true)?;
    let mut manifest = load_host_shopping_list_manifest(state, &shared_id, user)?;
    if role == "owner" {
        manifest.owner = target_user.clone();
        upsert_host_shopping_list_member(&mut manifest, user, "edit");
        upsert_host_shopping_list_member(&mut manifest, &target_user, "owner");
        let dir = ensure_host_user_data_dir(&target_user)?.join("shopping-lists");
        fs::create_dir_all(&dir)?;
        fs::write(host_user_shopping_list_link_path(&target_user), &shared_id)?;
        save_host_shopping_list_manifest(&shared_id, &manifest)?;
        return Ok(());
    }
    if target_user == manifest.owner {
        return Err(invalid_request(
            "assign a new owner before changing this owner",
        ));
    }
    upsert_host_shopping_list_member(&mut manifest, &target_user, &role);
    save_host_shopping_list_manifest(&shared_id, &manifest)
}

fn host_shopping_list_members(
    state: &HostState,
    shared_id: &str,
    current_user: &str,
) -> io::Result<Vec<serde_json::Value>> {
    let manifest = load_host_shopping_list_manifest(state, shared_id, current_user)?;
    Ok(manifest
        .members
        .iter()
        .map(|member| {
            serde_json::json!({
                "name": member.user,
                "role": member.role,
                "isCurrentUser": member.user == current_user,
            })
        })
        .collect())
}

fn host_shopping_list_role(state: &HostState, user: &str, shared_id: &str) -> io::Result<String> {
    let manifest = load_host_shopping_list_manifest(state, shared_id, user)?;
    manifest
        .members
        .iter()
        .find(|member| member.user == user)
        .map(|member| member.role.clone())
        .ok_or_else(|| invalid_request("shopping list access denied"))
}

fn require_host_shopping_list_owner(
    state: &HostState,
    user: &str,
    shared_id: &str,
) -> io::Result<()> {
    let role = host_shopping_list_role(state, user, shared_id)?;
    if host_shopping_list_can_manage(&role) {
        Ok(())
    } else {
        Err(invalid_request(
            "only the owner can manage this shopping list",
        ))
    }
}

fn host_shopping_list_can_edit(role: &str) -> bool {
    matches!(role, "owner" | "edit")
}

fn host_shopping_list_can_manage(role: &str) -> bool {
    role == "owner"
}

fn load_host_shopping_list_manifest(
    state: &HostState,
    shared_id: &str,
    owner_hint: &str,
) -> io::Result<HostShoppingListManifest> {
    let path = host_shared_shopping_list_manifest_path(shared_id)?;
    let mut manifest = match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str::<HostShoppingListManifest>(&contents)
            .map_err(|err| invalid_request(err.to_string()))?,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            default_host_shopping_list_manifest(state, shared_id, owner_hint)?
        }
        Err(err) => return Err(err),
    };
    let mut changed = normalize_host_shopping_list_manifest(state, shared_id, &mut manifest)?;
    if manifest.owner.trim().is_empty() {
        manifest.owner = owner_hint.to_string();
        changed = true;
    }
    if !manifest
        .members
        .iter()
        .any(|member| member.user == manifest.owner)
    {
        let owner = manifest.owner.clone();
        upsert_host_shopping_list_member(&mut manifest, &owner, "owner");
        changed = true;
    }
    if changed {
        save_host_shopping_list_manifest(shared_id, &manifest)?;
    }
    Ok(manifest)
}

fn default_host_shopping_list_manifest(
    state: &HostState,
    shared_id: &str,
    owner_hint: &str,
) -> io::Result<HostShoppingListManifest> {
    let linked_users = host_linked_shopping_list_users(state, shared_id)?;
    let owner = linked_users
        .first()
        .cloned()
        .unwrap_or_else(|| owner_hint.to_string());
    let mut members = Vec::new();
    for linked_user in linked_users {
        members.push(HostShoppingListMemberEntry {
            role: if linked_user == owner {
                "owner"
            } else {
                "edit"
            }
            .to_string(),
            user: linked_user,
        });
    }
    if !members.iter().any(|member| member.user == owner) {
        members.insert(
            0,
            HostShoppingListMemberEntry {
                user: owner.clone(),
                role: "owner".to_string(),
            },
        );
    }
    Ok(HostShoppingListManifest { owner, members })
}

fn normalize_host_shopping_list_manifest(
    state: &HostState,
    shared_id: &str,
    manifest: &mut HostShoppingListManifest,
) -> io::Result<bool> {
    let linked_users = host_linked_shopping_list_users(state, shared_id)?;
    let mut changed = false;
    manifest.members.retain(|member| {
        let keep = validate_host_shared_doc_id(&member.role).is_ok()
            && matches!(member.role.as_str(), "owner" | "edit" | "view");
        changed |= !keep;
        keep
    });
    for linked_user in linked_users {
        if !manifest
            .members
            .iter()
            .any(|member| member.user == linked_user)
        {
            manifest.members.push(HostShoppingListMemberEntry {
                user: linked_user,
                role: "edit".to_string(),
            });
            changed = true;
        }
    }
    for member in &mut manifest.members {
        if member.user == manifest.owner && member.role != "owner" {
            member.role = "owner".to_string();
            changed = true;
        } else if member.user != manifest.owner && member.role == "owner" {
            member.role = "edit".to_string();
            changed = true;
        }
    }
    Ok(changed)
}

fn save_host_shopping_list_manifest(
    shared_id: &str,
    manifest: &HostShoppingListManifest,
) -> io::Result<()> {
    let path = host_shared_shopping_list_manifest_path(shared_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(manifest).map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(path, bytes)
}

fn host_linked_shopping_list_users(state: &HostState, shared_id: &str) -> io::Result<Vec<String>> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let mut members = Vec::new();
    for user in users.iter().filter(|user| !user.banned) {
        let Ok(user_shared_id) = fs::read_to_string(host_user_shopping_list_link_path(&user.name))
        else {
            continue;
        };
        let Ok(user_shared_id) = validate_host_shared_doc_id(user_shared_id.trim()) else {
            continue;
        };
        if user_shared_id == shared_id {
            members.push(user.name.clone());
        }
    }
    Ok(members)
}

fn upsert_host_shopping_list_member(
    manifest: &mut HostShoppingListManifest,
    user: &str,
    role: &str,
) {
    if let Some(member) = manifest
        .members
        .iter_mut()
        .find(|member| member.user == user)
    {
        member.role = role.to_string();
    } else {
        manifest.members.push(HostShoppingListMemberEntry {
            user: user.to_string(),
            role: role.to_string(),
        });
    }
}

fn normalize_host_shopping_list_role(role: &str, allow_owner: bool) -> io::Result<String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "view" => Ok("view".to_string()),
        "edit" => Ok("edit".to_string()),
        "owner" if allow_owner => Ok("owner".to_string()),
        _ => Err(invalid_request("invalid shopping list role")),
    }
}

fn require_existing_host_user(state: &HostState, username: &str) -> io::Result<String> {
    let username = username.trim();
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    users
        .iter()
        .find(|user| user.name == username && !user.banned)
        .map(|user| user.name.clone())
        .ok_or_else(|| invalid_request("user not found"))
}

fn host_eutherium_me(state: &HostState, user: &str) -> io::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "user": user,
        "isAdmin": is_host_admin(state, user)?,
        "balance": host_eutherium_balance(user)?,
        "ledger": host_eutherium_user_ledger(user, 12)?,
        "inventory": host_inventory_entries(user)?,
        "items": host_shop_items(),
        "trophyRoom": host_trophy_room_result(user)?,
    }))
}

fn host_eutherium_admin_result(state: &HostState) -> io::Result<serde_json::Value> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let mut rows = Vec::new();
    for user in users.iter().filter(|user| !user.banned) {
        rows.push(serde_json::json!({
            "user": user.name,
            "admin": user.admin,
            "balance": host_eutherium_balance(&user.name)?,
        }));
    }
    Ok(serde_json::json!({
        "users": rows,
        "ledger": host_eutherium_ledger_tail(28)?,
    }))
}

fn host_eutherium_ledger_result(user: &str) -> io::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "user": user,
        "balance": host_eutherium_balance(user)?,
        "ledger": host_eutherium_user_ledger(user, 80)?,
    }))
}

fn host_eutherium_activity_result(user: &str) -> io::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "user": user,
        "balance": host_eutherium_balance(user)?,
        "awards": host_eutherium_recent_awards(12)?,
    }))
}

fn award_host_eutherium(
    state: &HostState,
    awarder: &str,
    award: HostEutheriumAwardRequest,
) -> io::Result<()> {
    let user = require_existing_host_user(state, &award.user_id)?;
    if award.amount <= 0 || award.amount > 1_000_000 {
        return Err(invalid_request(
            "award amount must be between 1 and 1000000",
        ));
    }
    if !is_host_admin(state, awarder)? {
        if award.amount > 3_000 {
            return Err(invalid_request("subadmin award limit is 3000 per grant"));
        }
        let awarded_today = host_eutherium_awarded_today_by(awarder)?;
        if awarded_today + award.amount > 10_000 {
            return Err(invalid_request("subadmin daily award limit is 10000"));
        }
    }
    let reason = award.reason.trim();
    if reason.is_empty() || reason.len() > 160 {
        return Err(invalid_request("award reason must be 1-160 characters"));
    }
    append_host_eutherium_ledger(HostEutheriumLedgerEntry {
        id: host_eutherium_entry_id("award", &user),
        user_id: user,
        amount: award.amount,
        reason: reason.to_string(),
        source: award
            .source
            .map(|source| source.trim().to_string())
            .filter(|source| !source.is_empty())
            .unwrap_or_else(|| "manual_award".to_string()),
        created_by_user_id: awarder.to_string(),
        created_unix_ms: unix_ms_now(),
    })
}

fn buy_host_shop_item(user: &str, item_id: &str) -> io::Result<()> {
    let item_id = item_id.trim();
    let Some(item) = host_shop_items()
        .into_iter()
        .find(|item| item.id == item_id)
    else {
        return Err(invalid_request("shop item not found"));
    };
    if host_eutherium_balance(user)? < item.price {
        return Err(invalid_request("not enough Eutherium"));
    }
    append_host_eutherium_ledger(HostEutheriumLedgerEntry {
        id: host_eutherium_entry_id("buy", user),
        user_id: user.to_string(),
        amount: -item.price,
        reason: format!("Bought {}", item.name),
        source: "shop".to_string(),
        created_by_user_id: user.to_string(),
        created_unix_ms: unix_ms_now(),
    })?;
    let mut inventory = load_host_inventory()?;
    inventory.push(HostInventoryEntry {
        id: host_eutherium_entry_id("inv", user),
        user_id: user.to_string(),
        item_id: item.id.to_string(),
        acquired_unix_ms: unix_ms_now(),
        equipped_to_item_id: None,
    });
    save_host_inventory(&inventory)
}

fn host_inventory_result(user: &str) -> io::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "user": user,
        "inventory": host_inventory_entries(user)?,
        "items": host_shop_items(),
    }))
}

fn host_inventory_entries(user: &str) -> io::Result<Vec<serde_json::Value>> {
    let items = host_shop_items();
    Ok(load_host_inventory()?
        .into_iter()
        .filter(|entry| entry.user_id == user)
        .map(|entry| {
            let item = items.iter().find(|item| item.id == entry.item_id);
            serde_json::json!({
                "id": entry.id,
                "userId": entry.user_id,
                "itemId": entry.item_id,
                "acquiredUnixMs": entry.acquired_unix_ms,
                "equippedToItemId": entry.equipped_to_item_id,
                "item": item,
            })
        })
        .collect())
}

fn host_trophy_room_result(user: &str) -> io::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "user": user,
        "layout": load_host_trophy_room_layout(user)?,
        "inventory": host_inventory_entries(user)?,
    }))
}

fn save_host_trophy_room_layout(user: &str, mut layout: HostTrophyRoomLayout) -> io::Result<()> {
    if layout.background.trim().is_empty() {
        layout.background = "server_basement".to_string();
    }
    if layout.items.len() > 80 {
        return Err(invalid_request("trophy room is too large"));
    }
    let inventory_ids: HashSet<String> = load_host_inventory()?
        .into_iter()
        .filter(|entry| entry.user_id == user)
        .map(|entry| entry.id)
        .collect();
    layout
        .items
        .retain(|item| inventory_ids.contains(&item.inventory_id));
    for item in &mut layout.items {
        item.x = item.x.clamp(0.0, 100.0);
        item.y = item.y.clamp(0.0, 100.0);
        item.scale = item.scale.clamp(0.4, 2.2);
    }
    let path = host_trophy_room_layout_path(user);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(&layout).map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(path, bytes)
}

fn load_host_trophy_room_layout(user: &str) -> io::Result<HostTrophyRoomLayout> {
    let path = host_trophy_room_layout_path(user);
    match fs::read_to_string(path) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|err| invalid_request(err.to_string()))
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(HostTrophyRoomLayout {
            background: "server_basement".to_string(),
            items: Vec::new(),
        }),
        Err(err) => Err(err),
    }
}

fn host_trophy_room_user_from_path(path: &str) -> io::Result<String> {
    let raw = path
        .trim_start_matches("/api/trophy-room/")
        .split('/')
        .next()
        .unwrap_or_default();
    percent_decode(raw).and_then(|value| {
        if value.trim().is_empty() || value.len() > 80 {
            Err(invalid_request("invalid trophy room user"))
        } else {
            Ok(value)
        }
    })
}

fn host_eutherium_balance(user: &str) -> io::Result<i64> {
    Ok(load_host_eutherium_ledger()?
        .into_iter()
        .filter(|entry| entry.user_id == user)
        .map(|entry| entry.amount)
        .sum())
}

fn host_eutherium_awarded_today_by(awarder: &str) -> io::Result<i64> {
    let day_start = unix_ms_now().saturating_sub(unix_ms_now() % 86_400_000);
    Ok(load_host_eutherium_ledger()?
        .into_iter()
        .filter(|entry| {
            entry.created_by_user_id == awarder
                && entry.source == "manual_award"
                && entry.amount > 0
                && entry.created_unix_ms >= day_start
        })
        .map(|entry| entry.amount)
        .sum())
}

fn host_eutherium_user_ledger(
    user: &str,
    limit: usize,
) -> io::Result<Vec<HostEutheriumLedgerEntry>> {
    let mut entries: Vec<_> = load_host_eutherium_ledger()?
        .into_iter()
        .filter(|entry| entry.user_id == user)
        .collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_unix_ms));
    entries.truncate(limit);
    Ok(entries)
}

fn host_eutherium_ledger_tail(limit: usize) -> io::Result<Vec<HostEutheriumLedgerEntry>> {
    let mut entries = load_host_eutherium_ledger()?;
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_unix_ms));
    entries.truncate(limit);
    Ok(entries)
}

fn host_eutherium_recent_awards(limit: usize) -> io::Result<Vec<HostEutheriumLedgerEntry>> {
    let mut entries: Vec<_> = load_host_eutherium_ledger()?
        .into_iter()
        .filter(|entry| entry.amount > 0 && entry.source == "manual_award")
        .collect();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_unix_ms));
    entries.truncate(limit);
    Ok(entries)
}

fn append_host_eutherium_ledger(entry: HostEutheriumLedgerEntry) -> io::Result<()> {
    let mut ledger = load_host_eutherium_ledger()?;
    ledger.push(entry);
    save_host_eutherium_ledger(&ledger)
}

fn load_host_eutherium_ledger() -> io::Result<Vec<HostEutheriumLedgerEntry>> {
    match fs::read_to_string(host_eutherium_ledger_path()) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|err| invalid_request(err.to_string()))
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err),
    }
}

fn save_host_eutherium_ledger(ledger: &[HostEutheriumLedgerEntry]) -> io::Result<()> {
    let path = host_eutherium_ledger_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(ledger).map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(path, bytes)
}

fn load_host_inventory() -> io::Result<Vec<HostInventoryEntry>> {
    match fs::read_to_string(host_eutherium_inventory_path()) {
        Ok(contents) => {
            serde_json::from_str(&contents).map_err(|err| invalid_request(err.to_string()))
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err),
    }
}

fn save_host_inventory(inventory: &[HostInventoryEntry]) -> io::Result<()> {
    let path = host_eutherium_inventory_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes =
        serde_json::to_vec_pretty(inventory).map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(path, bytes)
}

fn host_shop_items() -> Vec<HostEutheriumItem> {
    vec![
        HostEutheriumItem {
            id: "goat",
            name: "Goat",
            item_type: "creature",
            price: 1000,
            description: "A proud trophy goat for serious family infrastructure.",
            image_path: host_trophy_icon("goat"),
            rarity: "rare",
        },
        HostEutheriumItem {
            id: "goat-fez",
            name: "Fez for Goat",
            item_type: "accessory",
            price: 500,
            description: "Small hat, major authority. Can later be equipped to a goat.",
            image_path: host_trophy_icon("goat-fez"),
            rarity: "deeply unnecessary",
        },
        HostEutheriumItem {
            id: "soft-cheese-monument",
            name: "Soft Cheese Monument",
            item_type: "monument",
            price: 1200,
            description: "A strange creamy landmark for the trophy shelf.",
            image_path: host_trophy_icon("soft-cheese-monument"),
            rarity: "rare",
        },
        HostEutheriumItem {
            id: "angry-duck",
            name: "Angry Duck",
            item_type: "creature",
            price: 800,
            description: "Judges the room silently and often correctly.",
            image_path: host_trophy_icon("angry-duck"),
            rarity: "common",
        },
        HostEutheriumItem {
            id: "mpa-inspector-cage",
            name: "MPA Inspector in Cage",
            item_type: "oddity",
            price: 2500,
            description: "A regulatory artifact with excellent shelf presence.",
            image_path: host_trophy_icon("mpa-inspector-cage"),
            rarity: "legendary",
        },
        HostEutheriumItem {
            id: "broken-stool",
            name: "Broken Stool",
            item_type: "furniture",
            price: 300,
            description: "It has seen things. It refuses to elaborate.",
            image_path: host_trophy_icon("broken-stool"),
            rarity: "common",
        },
        HostEutheriumItem {
            id: "purple-server-relic",
            name: "Purple Server Relic",
            item_type: "relic",
            price: 5000,
            description: "A humming relic from an older chamber.",
            image_path: host_trophy_icon("purple-server-relic"),
            rarity: "legendary",
        },
    ]
}

fn host_trophy_icon(kind: &str) -> String {
    let (bg, fg, mark) = match kind {
        "goat" => ("#d9f0bc", "#1e2a18", "G"),
        "goat-fez" => ("#c93838", "#fff4de", "F"),
        "soft-cheese-monument" => ("#f5d76e", "#3b2b0c", "M"),
        "angry-duck" => ("#f0c542", "#221d0d", "D"),
        "mpa-inspector-cage" => ("#9dd4ff", "#13212b", "I"),
        "broken-stool" => ("#a6784f", "#fff1d9", "S"),
        "purple-server-relic" => ("#8e6cf0", "#f4efff", "R"),
        _ => ("#d9f0bc", "#1e2a18", "?"),
    };
    let bg = bg.trim_start_matches('#');
    let fg = fg.trim_start_matches('#');
    format!(
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1' y1='0' y2='1'%3E%3Cstop stop-color='%23{bg}'/%3E%3Cstop offset='1' stop-color='%23061108'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='96' height='96' rx='16' fill='url(%23g)'/%3E%3Ccircle cx='48' cy='48' r='30' fill='none' stroke='%23{fg}' stroke-width='6'/%3E%3Ctext x='48' y='59' text-anchor='middle' font-family='Arial,sans-serif' font-size='34' font-weight='900' fill='%23{fg}'%3E{mark}%3C/text%3E%3C/svg%3E"
    )
}

fn host_eutherium_entry_id(prefix: &str, user: &str) -> String {
    format!(
        "{}-{}-{}",
        prefix,
        unix_ms_now(),
        host_shared_doc_user_slug(user)
    )
}

fn default_shopping_list_markdown() -> String {
    [
        "# Hemmet Shopping List",
        "",
        "## Torrvaror",
        "- [ ] Coffee",
        "",
        "## Hem & städ",
        "- [ ] Batteries",
        "",
        "## Djur",
        "- [ ] Dog snacks",
        "",
        "## Kyl",
        "- [ ] Milk",
        "",
    ]
    .join("\n")
}

fn normalize_markdown_document(markdown: &str) -> String {
    let mut normalized = markdown.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.ends_with('\n') {
        normalized.push('\n');
    }
    normalized
}

fn host_video_chat_client_id(request: &HttpRequest) -> io::Result<String> {
    query_string_value(&request.path, "client")?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid_request("missing video chat client id"))
}

fn host_video_chat_status(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    user: &str,
    after_id: u64,
) -> io::Result<serde_json::Value> {
    validate_host_video_chat_client_id(client_id)?;
    host_instance_snapshot(state, instance_id)?;
    let now = unix_ms_now();
    let mut rooms = state
        .video_chat_rooms
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    prune_host_video_chat_rooms(&mut rooms, now);
    let Some(room) = rooms
        .iter_mut()
        .find(|room| room.instance_id == instance_id)
    else {
        return Ok(serde_json::json!({
            "self": client_id,
            "participants": [],
            "signals": [],
        }));
    };
    if let Some(participant) = room
        .participants
        .iter_mut()
        .find(|participant| participant.client_id == client_id)
    {
        participant.user = user.to_string();
        participant.updated_unix_ms = now;
    }
    room.signals
        .retain(|signal| !(signal.to == client_id && signal.id <= after_id));
    let signals = room
        .signals
        .iter()
        .filter(|signal| signal.to == client_id && signal.id > after_id)
        .cloned()
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "self": client_id,
        "participants": &room.participants,
        "signals": signals,
    }))
}

fn join_host_video_chat(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    user: &str,
    can_send: bool,
) -> io::Result<()> {
    validate_host_video_chat_client_id(client_id)?;
    host_instance_snapshot(state, instance_id)?;
    let now = unix_ms_now();
    let mut rooms = state
        .video_chat_rooms
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    prune_host_video_chat_rooms(&mut rooms, now);
    let index = if let Some(index) = rooms
        .iter()
        .position(|room| room.instance_id == instance_id)
    {
        index
    } else {
        rooms.push(HostVideoChatRoom {
            instance_id: instance_id.to_string(),
            participants: Vec::new(),
            signals: Vec::new(),
            next_signal_id: 1,
        });
        rooms.len() - 1
    };
    let room = &mut rooms[index];
    room.signals
        .retain(|signal| signal.from != client_id && signal.to != client_id);
    if let Some(participant) = room
        .participants
        .iter_mut()
        .find(|participant| participant.client_id == client_id)
    {
        participant.user = user.to_string();
        participant.can_send = can_send;
        participant.updated_unix_ms = now;
    } else {
        room.participants.push(HostVideoChatParticipant {
            client_id: client_id.to_string(),
            user: user.to_string(),
            can_send,
            updated_unix_ms: now,
        });
    }
    Ok(())
}

fn leave_host_video_chat(state: &HostState, instance_id: &str, client_id: &str) -> io::Result<()> {
    let mut rooms = state
        .video_chat_rooms
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(room) = rooms
        .iter_mut()
        .find(|room| room.instance_id == instance_id)
    {
        room.participants
            .retain(|participant| participant.client_id != client_id);
        room.signals
            .retain(|signal| signal.from != client_id && signal.to != client_id);
    }
    rooms.retain(|room| !room.participants.is_empty());
    Ok(())
}

fn post_host_video_chat_signal(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    user: &str,
    signal: HostVideoChatSignalRequest,
) -> io::Result<()> {
    validate_host_video_chat_client_id(client_id)?;
    validate_host_video_chat_client_id(&signal.to)?;
    if !matches!(signal.signal_type.as_str(), "offer" | "answer") {
        return Err(invalid_request(
            "video chat signal type must be offer or answer",
        ));
    }
    if signal.sdp.len() > 65_536 {
        return Err(invalid_request("video chat signal is too large"));
    }
    let now = unix_ms_now();
    let mut rooms = state
        .video_chat_rooms
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    prune_host_video_chat_rooms(&mut rooms, now);
    let Some(room) = rooms
        .iter_mut()
        .find(|room| room.instance_id == instance_id)
    else {
        return Err(invalid_request("video chat room not joined"));
    };
    let Some(participant) = room
        .participants
        .iter_mut()
        .find(|participant| participant.client_id == client_id)
    else {
        return Err(invalid_request("video chat room not joined"));
    };
    participant.user = user.to_string();
    participant.updated_unix_ms = now;
    if !room
        .participants
        .iter()
        .any(|participant| participant.client_id == signal.to)
    {
        return Err(invalid_request("video chat peer not joined"));
    }
    room.signals.retain(|existing| {
        !(existing.from == client_id
            && existing.to == signal.to
            && existing.signal_type == signal.signal_type)
    });
    let entry = HostVideoChatSignal {
        id: room.next_signal_id,
        from: client_id.to_string(),
        to: signal.to,
        signal_type: signal.signal_type,
        sdp: signal.sdp,
        created_unix_ms: now,
    };
    room.next_signal_id += 1;
    room.signals.push(entry);
    trim_host_video_chat_signals(room);
    Ok(())
}

fn validate_host_video_chat_client_id(client_id: &str) -> io::Result<()> {
    if client_id.is_empty() || client_id.len() > 128 {
        return Err(invalid_request("invalid video chat client id"));
    }
    if !client_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(invalid_request("invalid video chat client id"));
    }
    Ok(())
}

fn prune_host_video_chat_rooms(rooms: &mut Vec<HostVideoChatRoom>, now: u64) {
    for room in rooms.iter_mut() {
        room.participants.retain(|participant| {
            now.saturating_sub(participant.updated_unix_ms)
                <= HOST_VIDEO_CHAT_PARTICIPANT_TIMEOUT_MS
        });
        let active_clients = room
            .participants
            .iter()
            .map(|participant| participant.client_id.clone())
            .collect::<Vec<_>>();
        room.signals.retain(|signal| {
            now.saturating_sub(signal.created_unix_ms) <= HOST_VIDEO_CHAT_SIGNAL_TIMEOUT_MS
                && active_clients
                    .iter()
                    .any(|client_id| client_id == &signal.from)
                && active_clients
                    .iter()
                    .any(|client_id| client_id == &signal.to)
        });
        trim_host_video_chat_signals(room);
    }
    rooms.retain(|room| !room.participants.is_empty());
}

fn trim_host_video_chat_signals(room: &mut HostVideoChatRoom) {
    if room.signals.len() > HOST_VIDEO_CHAT_MAX_SIGNALS {
        let excess = room.signals.len() - HOST_VIDEO_CHAT_MAX_SIGNALS;
        room.signals.drain(0..excess);
    }
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

fn join_host_lobby_instance(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    user: &str,
    requested: &str,
) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    match instance.kind {
        HostInstanceKind::MegaDrive | HostInstanceKind::EutherAlert => {
            join_lobby_instance(&instance.bridge, client_id, user, requested)
        }
        HostInstanceKind::EutherDoom => {
            release_expired_doom_players(&instance)?;
            let choices: &[usize] = match requested {
                "1" | "p1" | "P1" => &[0],
                "2" | "p2" | "P2" => &[1],
                _ => &[0, 1],
            };
            for &player_index in choices {
                if claim_bridge_player(&instance.bridge, client_id, user, player_index).is_err() {
                    continue;
                }
                let Some(player_id) = eutherdoom_server::PlayerId::from_index(player_index) else {
                    release_bridge_player(&instance.bridge, client_id, player_index)?;
                    continue;
                };
                let doom_result = instance
                    .doom
                    .as_ref()
                    .ok_or_else(|| io::Error::other("doom instance missing state"))?
                    .lock()
                    .map_err(|err| io::Error::other(err.to_string()))?
                    .claim(player_id, user, Instant::now());
                match doom_result {
                    Ok(()) => {
                        return Ok(serde_json::json!({
                            "kind": "player",
                            "player": player_index + 1,
                            "user": user,
                        }));
                    }
                    Err(_) => {
                        release_bridge_player(&instance.bridge, client_id, player_index)?;
                    }
                }
            }
            Ok(serde_json::json!({
                "kind": "spectator",
                "player": null,
            }))
        }
    }
}

fn release_expired_doom_players(instance: &HostInstance) -> io::Result<()> {
    let expired = {
        let mut slots = instance
            .bridge
            .player_slots
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        let now = Instant::now();
        let mut expired = Vec::new();
        for (index, slot) in slots.iter_mut().enumerate() {
            if slot
                .as_ref()
                .is_some_and(|lease| now.duration_since(lease.updated) > HOST_PLAYER_LEASE_TIMEOUT)
            {
                *slot = None;
                expired.push(index);
            }
        }
        expired
    };
    if expired.is_empty() {
        return Ok(());
    }
    let Some(doom) = &instance.doom else {
        return Ok(());
    };
    let mut doom = doom
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    for player_index in expired {
        if let Some(player_id) = eutherdoom_server::PlayerId::from_index(player_index) {
            let _ = doom.leave(player_id);
        }
    }
    Ok(())
}

fn release_host_lobby_client(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
) -> io::Result<()> {
    let instance = host_instance_snapshot(state, instance_id)?;
    let released = release_lobby_client_with_indices(&instance.bridge, client_id)?;
    if instance.kind == HostInstanceKind::EutherDoom {
        let doom = instance
            .doom
            .as_ref()
            .ok_or_else(|| io::Error::other("doom instance missing state"))?;
        let mut doom = doom
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        for player_index in released {
            if let Some(player_id) = eutherdoom_server::PlayerId::from_index(player_index) {
                let _ = doom.leave(player_id);
            }
        }
    }
    Ok(())
}

fn release_lobby_client_with_indices(
    state: &BridgeState,
    client_id: &str,
) -> io::Result<Vec<usize>> {
    let mut released = Vec::new();
    let mut slots = state
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    for (index, slot) in slots.iter_mut().enumerate() {
        if slot
            .as_ref()
            .is_some_and(|lease| lease.client_id == client_id)
        {
            *slot = None;
            released.push(index);
        }
    }
    Ok(released)
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

fn release_host_lobby_player(
    state: &HostState,
    instance_id: &str,
    player_index: usize,
) -> io::Result<()> {
    let instance = host_instance_snapshot(state, instance_id)?;
    release_lobby_player(&instance.bridge, player_index)?;
    if matches!(
        instance.kind,
        HostInstanceKind::MegaDrive | HostInstanceKind::EutherAlert
    ) {
        clear_bridge_input(&instance.bridge, player_index)?;
    } else if let Some(doom) = &instance.doom {
        if let Some(player_id) = eutherdoom_server::PlayerId::from_index(player_index) {
            let _ = doom
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?
                .leave(player_id);
        }
    }
    Ok(())
}

fn host_alert_seed(instance_id: &str, created_unix_ms: u64) -> u64 {
    let mut hash = 14_695_981_039_346_656_037u64;
    for byte in instance_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    (hash ^ created_unix_ms.rotate_left(17)) & 0xffff_ffff
}

fn host_alert_server_tick(instance: &HostInstance) -> u64 {
    unix_ms_now()
        .saturating_sub(instance.created_unix_ms)
        .saturating_mul(30)
        / 1000
}

fn host_alert_snapshot(state: &HostState, instance_id: &str) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherAlert {
        return Err(invalid_request("selected instance is not EutherAlert"));
    }
    let events = instance
        .alert_events
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let last_event_id = events.last().map(|event| event.id).unwrap_or(0);
    Ok(serde_json::json!({
        "instance": instance.id,
        "seed": instance.alert_seed,
        "createdUnixMs": instance.created_unix_ms,
        "serverTick": host_alert_server_tick(&instance),
        "lastEventId": last_event_id,
        "events": events.clone(),
    }))
}

fn host_alert_events(
    state: &HostState,
    instance_id: &str,
    after_id: u64,
) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherAlert {
        return Err(invalid_request("selected instance is not EutherAlert"));
    }
    let events = instance
        .alert_events
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let last_event_id = events.last().map(|event| event.id).unwrap_or(0);
    let visible: Vec<_> = events
        .iter()
        .filter(|event| event.id > after_id)
        .cloned()
        .collect();
    Ok(serde_json::json!({
        "instance": instance.id,
        "lastEventId": last_event_id,
        "serverTick": host_alert_server_tick(&instance),
        "events": visible,
    }))
}

fn host_alert_openra_runtime_path() -> PathBuf {
    host_alert_absolute_path(
        env::var("EUTHERALERT_OPENRA_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(".euther-openra/OpenRA")),
    )
}

fn host_alert_dotnet_root() -> PathBuf {
    host_alert_absolute_path(
        env::var("EUTHERALERT_DOTNET_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(".euther-openra/dotnet")),
    )
}

fn host_alert_absolute_path(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(path)
}

fn host_alert_openra_support_dir(instance_id: &str) -> PathBuf {
    host_alert_absolute_path(PathBuf::from(".euther-host/openra-alert").join(instance_id))
}

fn host_alert_openra_client_support_dir(instance_id: &str) -> PathBuf {
    host_alert_openra_support_dir(instance_id).join("client")
}

fn host_alert_openra_shared_content_dir() -> PathBuf {
    host_alert_absolute_path(PathBuf::from(
        ".euther-host/openra-alert/shared/Content/ra/v2",
    ))
}

fn host_alert_openra_client_content_dir(support_dir: &Path) -> PathBuf {
    support_dir.join("Content").join("ra").join("v2")
}

fn host_alert_ensure_openra_client_content(support_dir: &Path) -> io::Result<()> {
    let client_content_dir = host_alert_openra_client_content_dir(support_dir);
    let shared_content_dir = host_alert_openra_shared_content_dir();
    if client_content_dir.join("allies.mix").is_file()
        && client_content_dir
            .join("expand")
            .join("expand2.mix")
            .is_file()
        && client_content_dir.join("cnc").join("desert.mix").is_file()
    {
        let shared_scores = shared_content_dir.join("scores.mix");
        let client_scores = client_content_dir.join("scores.mix");
        if shared_scores.is_file() && !client_scores.is_file() {
            fs::copy(shared_scores, client_scores)?;
        }
        return Ok(());
    }

    if !shared_content_dir.join("allies.mix").is_file() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        let ra_dir = support_dir.join("Content").join("ra");
        fs::create_dir_all(&ra_dir)?;
        if !client_content_dir.exists() {
            unix_fs::symlink(&shared_content_dir, &client_content_dir)?;
        }
    }

    Ok(())
}

fn host_alert_touch_bridge_file(instance_id: &str) -> PathBuf {
    host_alert_absolute_path(
        env::var("EUTHERALERT_TOUCH_BRIDGE_FILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(".euther-host/openra-alert")
                    .join(instance_id)
                    .join("touch-events.jsonl")
            }),
    )
}

fn host_alert_touch_bridge_apply_log(instance_id: &str) -> PathBuf {
    host_alert_absolute_path(
        env::var("EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(".euther-host/openra-alert")
                    .join(instance_id)
                    .join("touch-applied.jsonl")
            }),
    )
}

fn host_alert_openra_capture_width() -> u32 {
    env::var("EUTHERALERT_OPENRA_CAPTURE_WIDTH")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| (640..=3840).contains(value))
        .unwrap_or(1280)
}

fn host_alert_openra_capture_height() -> u32 {
    env::var("EUTHERALERT_OPENRA_CAPTURE_HEIGHT")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| (360..=2160).contains(value))
        .unwrap_or(720)
}

fn host_alert_openra_port() -> u16 {
    env::var("EUTHERALERT_OPENRA_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(32_170)
}

fn host_alert_touch_bridge_command(instance_id: &str) -> String {
    env::var("EUTHERALERT_TOUCH_BRIDGE_CMD").unwrap_or_else(|_| {
        format!(
            "tools/eutheralert-openra-adapter/jsonl_probe.py {}",
            shell_quote_path(&host_alert_touch_bridge_file(instance_id))
        )
    })
}

fn shell_quote_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    format!("'{}'", text.replace('\'', "'\\''"))
}

fn host_alert_xvfb_path() -> Option<PathBuf> {
    env::var("EUTHERALERT_XVFB_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            ["/usr/bin/Xvfb", "/usr/local/bin/Xvfb"]
                .iter()
                .map(PathBuf::from)
                .find(|path| path.is_file())
        })
}

fn host_alert_display_number(instance_id: &str) -> u16 {
    let mut hash = 0u16;
    for byte in instance_id.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as u16);
    }
    90 + (hash % 40)
}

fn host_alert_openra_display(
    instance_id: &str,
    width: u32,
    height: u32,
) -> io::Result<(String, Option<Child>)> {
    if let Ok(display) = env::var("EUTHERALERT_OPENRA_DISPLAY") {
        if !display.trim().is_empty() {
            return Ok((display, None));
        }
    }
    if let Ok(display) = env::var("DISPLAY") {
        if !display.trim().is_empty() {
            return Ok((display, None));
        }
    }
    let xvfb = host_alert_xvfb_path().ok_or_else(|| {
        invalid_request("OpenRA renderer needs DISPLAY or Xvfb installed on the host")
    })?;
    let display = format!(":{}", host_alert_display_number(instance_id));
    let child = Command::new(xvfb)
        .arg(&display)
        .args([
            "-screen",
            "0",
            &format!("{width}x{height}x24"),
            "-nolisten",
            "tcp",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| io::Error::other(format!("failed to start Xvfb: {err}")))?;
    thread::sleep(Duration::from_millis(350));
    Ok((display, Some(child)))
}

fn host_alert_openra_status(state: &HostState) -> io::Result<serde_json::Value> {
    let touch_bridge = host_alert_touch_bridge_status(state)?;
    let client = host_alert_openra_client_status(state)?;
    let mut server = state
        .openra_server
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(process) = server.as_mut() {
        if let Some(status) = process.child.try_wait()? {
            let payload = serde_json::json!({
                "running": false,
                "exited": true,
                "code": status.code(),
                "instance": process.instance_id,
                "port": process.port,
                "runtimePath": process.runtime_path,
                "touchBridge": touch_bridge,
                "client": client,
            });
            *server = None;
            return Ok(payload);
        }
        return Ok(serde_json::json!({
            "running": true,
            "instance": process.instance_id,
            "port": process.port,
            "startedUnixMs": process.started_unix_ms,
            "runtimePath": process.runtime_path,
            "touchBridge": touch_bridge,
            "client": client,
        }));
    }
    Ok(serde_json::json!({
        "running": false,
        "runtimePath": host_alert_openra_runtime_path(),
        "port": host_alert_openra_port(),
        "touchBridge": touch_bridge,
        "client": client,
    }))
}

fn host_alert_openra_client_status(state: &HostState) -> io::Result<serde_json::Value> {
    let mut client = state
        .openra_client
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(process) = client.as_mut() {
        if let Some(status) = process.child.try_wait()? {
            if let Some(mut xvfb_child) = process.xvfb_child.take() {
                let _ = xvfb_child.kill();
                let _ = xvfb_child.wait();
            }
            host_alert_destroy_pipewire_sink(process.pipewire_node_id.as_deref());
            let payload = serde_json::json!({
                "running": false,
                "exited": true,
                "code": status.code(),
                "instance": process.instance_id,
                "port": process.port,
                "runtimePath": process.runtime_path,
                "supportDir": process.support_dir,
                "touchBridgeFile": process.touch_bridge_file,
                "display": process.display,
                "captureWidth": process.capture_width,
                "captureHeight": process.capture_height,
                "audioBackend": process.audio_backend,
                "audioSink": process.audio_sink_name,
                "audioStream": process.audio_sink_name.is_some(),
                "streamPath": "/api/eutheralert/openra/client/stream.mp4",
                "stdoutLog": process.stdout_log,
                "stderrLog": process.stderr_log,
            });
            *client = None;
            return Ok(payload);
        }
        return Ok(serde_json::json!({
            "running": true,
            "instance": process.instance_id,
            "port": process.port,
            "startedUnixMs": process.started_unix_ms,
            "runtimePath": process.runtime_path,
            "supportDir": process.support_dir,
            "touchBridgeFile": process.touch_bridge_file,
            "display": process.display,
            "captureWidth": process.capture_width,
            "captureHeight": process.capture_height,
            "audioBackend": process.audio_backend,
            "audioSink": process.audio_sink_name,
            "audioStream": process.audio_sink_name.is_some(),
            "streamPath": "/api/eutheralert/openra/client/stream.mp4",
            "stdoutLog": process.stdout_log,
            "stderrLog": process.stderr_log,
        }));
    }
    Ok(serde_json::json!({
        "running": false,
        "runtimePath": host_alert_openra_runtime_path(),
        "port": host_alert_openra_port(),
    }))
}

fn host_alert_touch_bridge_status(state: &HostState) -> io::Result<serde_json::Value> {
    let mut bridge = state
        .alert_touch_bridge
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(process) = bridge.as_mut() {
        if let Some(status) = process.child.try_wait()? {
            let payload = serde_json::json!({
                "running": false,
                "exited": true,
                "code": status.code(),
                "command": process.command,
            });
            *bridge = None;
            return Ok(payload);
        }
        return Ok(serde_json::json!({
            "running": true,
            "command": process.command,
            "startedUnixMs": process.started_unix_ms,
        }));
    }
    Ok(serde_json::json!({
        "running": false,
        "configured": true,
    }))
}

fn host_alert_openra_start(state: &HostState, instance_id: &str) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherAlert {
        return Err(invalid_request("selected instance is not EutherAlert"));
    }
    let runtime_path = host_alert_openra_runtime_path();
    let launcher = runtime_path.join("launch-dedicated.sh");
    if !launcher.is_file() {
        return Err(invalid_request(format!(
            "OpenRA runtime missing: expected {}",
            launcher.display()
        )));
    }

    let mut server = state
        .openra_server
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(process) = server.as_mut() {
        if process.child.try_wait()?.is_none() {
            if process.instance_id == instance_id {
                return Ok(serde_json::json!({
                    "running": true,
                    "instance": process.instance_id,
                    "port": process.port,
                    "startedUnixMs": process.started_unix_ms,
                    "runtimePath": process.runtime_path,
                }));
            }
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
        *server = None;
    }

    let port = host_alert_openra_port();
    let support_dir = host_alert_openra_support_dir(instance_id);
    let touch_bridge_file = host_alert_touch_bridge_file(instance_id);
    let touch_bridge_apply_log = host_alert_touch_bridge_apply_log(instance_id);
    let dotnet_root = host_alert_dotnet_root();
    let process_path = env::var("PATH").unwrap_or_default();
    let process_path = if dotnet_root.join("dotnet").is_file() {
        format!("{}:{process_path}", dotnet_root.display())
    } else {
        process_path
    };
    fs::create_dir_all(&support_dir)?;
    if let Some(parent) = touch_bridge_file.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = touch_bridge_apply_log.parent() {
        fs::create_dir_all(parent)?;
    }
    let child = Command::new("sh")
        .arg("./launch-dedicated.sh")
        .current_dir(&runtime_path)
        .env("DOTNET_ROOT", &dotnet_root)
        .env("PATH", process_path)
        .env("EUTHERALERT_TOUCH_BRIDGE_FILE", &touch_bridge_file)
        .env(
            "EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG",
            &touch_bridge_apply_log,
        )
        .env("Name", format!("{} OpenRA", instance.name))
        .env("Mod", "ra")
        .env("ListenPort", port.to_string())
        .env("AdvertiseOnline", "False")
        .env("AdvertiseOnLocalNetwork", "True")
        .env("RecordReplays", "True")
        .env("RequireAuthentication", "False")
        .env("SupportDir", support_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    let started_unix_ms = unix_ms_now();
    *server = Some(HostOpenRaProcess {
        child,
        instance_id: instance_id.to_string(),
        port,
        started_unix_ms,
        runtime_path: runtime_path.clone(),
    });
    Ok(serde_json::json!({
        "running": true,
        "instance": instance_id,
        "port": port,
        "startedUnixMs": started_unix_ms,
        "runtimePath": runtime_path,
    }))
}

fn host_alert_openra_stop(state: &HostState, instance_id: &str) -> io::Result<serde_json::Value> {
    let mut server = state
        .openra_server
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(mut process) = server.take() else {
        return Ok(serde_json::json!({ "running": false }));
    };
    if process.instance_id != instance_id {
        let running_instance = process.instance_id.clone();
        *server = Some(process);
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("OpenRA server belongs to {running_instance}"),
        ));
    }
    let _ = process.child.kill();
    let _ = process.child.wait();
    Ok(serde_json::json!({ "running": false }))
}

fn host_alert_openra_client_start(
    state: &HostState,
    instance_id: &str,
) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherAlert {
        return Err(invalid_request("selected instance is not EutherAlert"));
    }
    let runtime_path = host_alert_openra_runtime_path();
    let launcher = runtime_path.join("launch-game.sh");
    if !launcher.is_file() {
        return Err(invalid_request(format!(
            "OpenRA runtime missing: expected {}",
            launcher.display()
        )));
    }

    let mut client = state
        .openra_client
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(process) = client.as_mut() {
        if process.child.try_wait()?.is_none() {
            if process.instance_id == instance_id {
                return Ok(serde_json::json!({
                    "running": true,
                    "instance": process.instance_id,
                    "port": process.port,
                    "startedUnixMs": process.started_unix_ms,
                    "runtimePath": process.runtime_path,
                    "supportDir": process.support_dir,
                    "touchBridgeFile": process.touch_bridge_file,
                    "display": process.display,
                    "captureWidth": process.capture_width,
                    "captureHeight": process.capture_height,
                    "audioBackend": process.audio_backend,
                    "audioSink": process.audio_sink_name,
                    "audioStream": process.audio_sink_name.is_some(),
                    "streamPath": "/api/eutheralert/openra/client/stream.mp4",
                }));
            }
            let _ = process.child.kill();
            let _ = process.child.wait();
            host_alert_destroy_pipewire_sink(process.pipewire_node_id.as_deref());
        }
        if let Some(mut xvfb_child) = process.xvfb_child.take() {
            let _ = xvfb_child.kill();
            let _ = xvfb_child.wait();
        }
        *client = None;
    }

    let port = host_alert_openra_port();
    let capture_width = host_alert_openra_capture_width();
    let capture_height = host_alert_openra_capture_height();
    let (display, xvfb_child) =
        host_alert_openra_display(instance_id, capture_width, capture_height)?;
    let support_dir = host_alert_openra_client_support_dir(instance_id);
    let touch_bridge_file = host_alert_touch_bridge_file(instance_id);
    let touch_bridge_apply_log = host_alert_touch_bridge_apply_log(instance_id);
    let audio_backend = host_alert_openra_audio_backend();
    let audio_sink_name = host_alert_openra_pipewire_sink_name(instance_id);
    let pipewire_node_id = host_alert_create_pipewire_sink(&audio_sink_name)?;
    let audio_sink_name = pipewire_node_id.as_ref().map(|_| audio_sink_name);
    let dotnet_root = host_alert_dotnet_root();
    let process_path = env::var("PATH").unwrap_or_default();
    let process_path = if dotnet_root.join("dotnet").is_file() {
        format!("{}:{process_path}", dotnet_root.display())
    } else {
        process_path
    };
    fs::create_dir_all(&support_dir)?;
    host_alert_ensure_openra_client_content(&support_dir)?;
    if let Some(parent) = touch_bridge_file.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Some(parent) = touch_bridge_apply_log.parent() {
        fs::create_dir_all(parent)?;
    }
    let stdout_log = support_dir.join("openra-client.stdout.log");
    let stderr_log = support_dir.join("openra-client.stderr.log");
    let stdout_file = append_log_file(&stdout_log)?;
    let stderr_file = append_log_file(&stderr_log)?;

    let child = Command::new("sh")
        .arg("./launch-game.sh")
        .arg("Game.Mod=ra")
        .arg(format!("Launch.URI=tcp://127.0.0.1:{port}"))
        .arg(format!("Engine.SupportDir={}", support_dir.display()))
        .arg(format!("Windowed.Size={capture_width}x{capture_height}"))
        .current_dir(&runtime_path)
        .env("DOTNET_ROOT", &dotnet_root)
        .env("PATH", process_path)
        .env("DISPLAY", &display)
        .env("SDL_VIDEODRIVER", "x11")
        .env("SDL_AUDIODRIVER", &audio_backend)
        .envs(
            audio_sink_name
                .as_ref()
                .into_iter()
                .map(|sink| ("PIPEWIRE_NODE", sink.as_str())),
        )
        .env("LIBGL_ALWAYS_SOFTWARE", "1")
        .env("EUTHERALERT_TOUCH_BRIDGE_FILE", &touch_bridge_file)
        .env(
            "EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG",
            &touch_bridge_apply_log,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()?;

    let started_unix_ms = unix_ms_now();
    *client = Some(HostOpenRaClientProcess {
        child,
        xvfb_child,
        pipewire_node_id,
        audio_sink_name: audio_sink_name.clone(),
        audio_backend: audio_backend.clone(),
        instance_id: instance_id.to_string(),
        port,
        started_unix_ms,
        runtime_path: runtime_path.clone(),
        support_dir: support_dir.clone(),
        touch_bridge_file: touch_bridge_file.clone(),
        display: display.clone(),
        capture_width,
        capture_height,
        stdout_log: stdout_log.clone(),
        stderr_log: stderr_log.clone(),
    });
    Ok(serde_json::json!({
        "running": true,
        "instance": instance_id,
        "port": port,
        "startedUnixMs": started_unix_ms,
        "runtimePath": runtime_path,
        "supportDir": support_dir,
        "touchBridgeFile": touch_bridge_file,
        "display": display,
        "captureWidth": capture_width,
        "captureHeight": capture_height,
        "audioBackend": audio_backend,
        "audioSink": audio_sink_name,
        "audioStream": audio_sink_name.is_some(),
        "streamPath": "/api/eutheralert/openra/client/stream.mp4",
        "stdoutLog": stdout_log,
        "stderrLog": stderr_log,
    }))
}

fn host_alert_openra_client_stop(
    state: &HostState,
    instance_id: &str,
) -> io::Result<serde_json::Value> {
    let mut client = state
        .openra_client
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(mut process) = client.take() else {
        return Ok(serde_json::json!({ "running": false }));
    };
    if process.instance_id != instance_id {
        let running_instance = process.instance_id.clone();
        *client = Some(process);
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("OpenRA client belongs to {running_instance}"),
        ));
    }
    let _ = process.child.kill();
    let _ = process.child.wait();
    host_alert_destroy_pipewire_sink(process.pipewire_node_id.as_deref());
    if let Some(mut xvfb_child) = process.xvfb_child.take() {
        let _ = xvfb_child.kill();
        let _ = xvfb_child.wait();
    }
    Ok(serde_json::json!({ "running": false }))
}

fn host_alert_openra_request_context(
    state: &HostState,
    path: &str,
    user: &str,
) -> io::Result<serde_json::Value> {
    let requested_instance = host_instance_id(path)?;
    let permissions = host_permissions(state, user)?;
    let instance = match host_instance_snapshot(state, &requested_instance) {
        Ok(instance) => {
            let host_owner = instance.host_owner.clone();
            serde_json::json!({
                "id": instance.id,
                "name": instance.name,
                "kind": instance.kind.as_str(),
                "hostOwner": host_owner,
                "userIsOwner": instance.host_owner.as_deref() == Some(user),
                "createdUnixMs": instance.created_unix_ms,
            })
        }
        Err(err) => serde_json::json!({
            "error": err.to_string(),
        }),
    };
    Ok(serde_json::json!({
        "user": user,
        "requestedInstance": requested_instance,
        "requestedClient": query_string_value(path, "client")?,
        "requestedPlayer": query_string_value(path, "player")?,
        "permissions": permissions,
        "instance": instance,
    }))
}

fn host_alert_openra_client_debug(
    state: &HostState,
    path: &str,
    user: &str,
) -> io::Result<serde_json::Value> {
    let ffmpeg_available = Command::new("ffmpeg")
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    let xvfb_path = host_alert_xvfb_path();
    let mut client = state
        .openra_client
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let client_payload = if let Some(process) = client.as_mut() {
        let exited = process.child.try_wait()?;
        let display_socket = host_alert_display_socket(&process.display);
        let payload = serde_json::json!({
            "running": exited.is_none(),
            "exited": exited.is_some(),
            "code": exited.and_then(|status| status.code()),
            "instance": process.instance_id,
            "port": process.port,
            "startedUnixMs": process.started_unix_ms,
            "runtimePath": process.runtime_path,
            "supportDir": process.support_dir,
            "touchBridgeFile": process.touch_bridge_file,
            "display": process.display,
            "displaySocket": display_socket,
            "displaySocketExists": display_socket.as_ref().is_some_and(|path| path.is_file()),
            "captureWidth": process.capture_width,
            "captureHeight": process.capture_height,
            "audioBackend": process.audio_backend,
            "audioSink": process.audio_sink_name,
            "audioStream": process.audio_sink_name.is_some(),
            "streamPath": "/api/eutheralert/openra/client/stream.mp4",
            "xvfbManaged": process.xvfb_child.is_some(),
            "stdoutLog": process.stdout_log,
            "stderrLog": process.stderr_log,
            "stdoutTail": tail_text_file(&process.stdout_log, 4096),
            "stderrTail": tail_text_file(&process.stderr_log, 4096),
        });
        if exited.is_some() {
            if let Some(mut xvfb_child) = process.xvfb_child.take() {
                let _ = xvfb_child.kill();
                let _ = xvfb_child.wait();
            }
            host_alert_destroy_pipewire_sink(process.pipewire_node_id.as_deref());
            *client = None;
        }
        payload
    } else {
        serde_json::json!({
            "running": false,
            "runtimePath": host_alert_openra_runtime_path(),
            "port": host_alert_openra_port(),
            "captureWidth": host_alert_openra_capture_width(),
            "captureHeight": host_alert_openra_capture_height(),
        })
    };
    let payload = serde_json::json!({
        "ok": true,
        "unixMs": unix_ms_now(),
        "request": host_alert_openra_request_context(state, path, user)?,
        "client": client_payload,
        "ffmpegAvailable": ffmpeg_available,
        "xvfbAvailable": xvfb_path.is_some(),
        "xvfbPath": xvfb_path,
        "configuredDisplay": env::var("EUTHERALERT_OPENRA_DISPLAY").ok(),
        "hostDisplay": env::var("DISPLAY").ok(),
    });
    eprintln!("EutherAlert OpenRA debug dump: {payload}");
    host_alert_write_debug_dump(&payload)?;
    Ok(payload)
}

fn host_alert_write_debug_dump(payload: &serde_json::Value) -> io::Result<()> {
    let path = PathBuf::from(".euther-host")
        .join("openra-alert")
        .join("debug-dumps.jsonl");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    serde_json::to_writer(&mut file, payload).map_err(|err| io::Error::other(err.to_string()))?;
    file.write_all(b"\n")?;
    file.flush()
}

fn append_log_file(path: &Path) -> io::Result<fs::File> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::OpenOptions::new().create(true).append(true).open(path)
}

fn tail_text_file(path: &Path, max_bytes: usize) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let start = bytes.len().saturating_sub(max_bytes);
    Some(String::from_utf8_lossy(&bytes[start..]).to_string())
}

fn host_alert_display_socket(display: &str) -> Option<PathBuf> {
    let number = display
        .strip_prefix(':')
        .unwrap_or(display)
        .split('.')
        .next()
        .filter(|value| !value.is_empty())?;
    Some(PathBuf::from(format!("/tmp/.X11-unix/X{number}")))
}

fn host_alert_openra_audio_backend() -> String {
    env::var("EUTHERALERT_SDL_AUDIODRIVER")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "pipewire".to_string())
}

fn host_alert_openra_pipewire_sink_name(instance_id: &str) -> String {
    let sanitized: String = instance_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect();
    format!("eutheralert_openra_{sanitized}")
}

fn host_alert_create_pipewire_sink(sink_name: &str) -> io::Result<Option<String>> {
    let props = format!(
        "{{ factory.name=support.null-audio-sink node.name={sink_name} node.description=\"EutherAlert {sink_name}\" media.class=Audio/Sink object.linger=true audio.position=[ FL FR ] }}"
    );
    let output = Command::new("pw-cli")
        .args(["create-node", "adapter", &props])
        .stdin(Stdio::null())
        .output();
    match output {
        Ok(output) if output.status.success() => host_alert_pipewire_node_id_by_name(sink_name),
        Ok(output) => {
            eprintln!(
                "EutherAlert OpenRA PipeWire sink unavailable: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            Ok(None)
        }
        Err(err) => {
            eprintln!("EutherAlert OpenRA PipeWire sink unavailable: {err}");
            Ok(None)
        }
    }
}

fn host_alert_pipewire_node_id_by_name(sink_name: &str) -> io::Result<Option<String>> {
    let output = Command::new("pw-cli")
        .args(["list-objects", "Node"])
        .stdin(Stdio::null())
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(parse_pipewire_node_id_by_name(&stdout, sink_name))
        }
        Ok(output) => {
            eprintln!(
                "EutherAlert OpenRA PipeWire sink lookup failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
            Ok(None)
        }
        Err(err) => {
            eprintln!("EutherAlert OpenRA PipeWire sink lookup failed: {err}");
            Ok(None)
        }
    }
}

fn host_alert_destroy_pipewire_sink(node_id: Option<&str>) {
    let Some(node_id) = node_id else {
        return;
    };
    let _ = Command::new("pw-cli")
        .args(["destroy", node_id])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn parse_pipewire_node_id_by_name(value: &str, node_name: &str) -> Option<String> {
    let mut current_id = None::<String>;
    for line in value.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("id ") {
            current_id = rest
                .split(',')
                .next()
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string);
            continue;
        }
        if trimmed == format!("node.name = \"{node_name}\"") {
            return current_id;
        }
    }
    None
}

fn host_alert_openra_client_stream_mp4(
    stream: &mut TcpStream,
    state: &HostState,
) -> io::Result<()> {
    let (display, width, height, audio_sink_name) = {
        let mut client = state
            .openra_client
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        let Some(process) = client.as_mut() else {
            return send_error(stream, 409, "OpenRA client not running");
        };
        if process.child.try_wait()?.is_some() {
            if let Some(mut xvfb_child) = process.xvfb_child.take() {
                let _ = xvfb_child.kill();
                let _ = xvfb_child.wait();
            }
            host_alert_destroy_pipewire_sink(process.pipewire_node_id.as_deref());
            *client = None;
            return send_error(stream, 409, "OpenRA client exited");
        }
        (
            process.display.clone(),
            process.capture_width,
            process.capture_height,
            process.audio_sink_name.clone(),
        )
    };

    let input = format!("{display}.0+0,0");
    let video_size = format!("{width}x{height}");
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-f".to_string(),
        "x11grab".to_string(),
        "-draw_mouse".to_string(),
        "0".to_string(),
        "-framerate".to_string(),
        "30".to_string(),
        "-video_size".to_string(),
        video_size,
        "-i".to_string(),
        input,
    ];
    let mut pwcat_child = audio_sink_name
        .as_ref()
        .and_then(|sink| host_alert_spawn_pipewire_capture(sink).ok());
    eprintln!(
        "EutherAlert OpenRA stream capture: display={display} size={width}x{height} audio_sink={} audio_capture={}",
        audio_sink_name.as_deref().unwrap_or("none"),
        pwcat_child.is_some()
    );
    if pwcat_child.is_some() {
        args.extend([
            "-f".to_string(),
            "s16le".to_string(),
            "-ar".to_string(),
            "44100".to_string(),
            "-ac".to_string(),
            "2".to_string(),
            "-i".to_string(),
            "pipe:0".to_string(),
        ]);
    } else {
        args.push("-an".to_string());
    }
    args.extend([
        "-vf".to_string(),
        "format=yuv420p".to_string(),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "ultrafast".to_string(),
        "-tune".to_string(),
        "zerolatency".to_string(),
        "-profile:v".to_string(),
        "baseline".to_string(),
        "-level".to_string(),
        "3.1".to_string(),
        "-g".to_string(),
        "30".to_string(),
        "-keyint_min".to_string(),
        "30".to_string(),
        "-sc_threshold".to_string(),
        "0".to_string(),
        "-bf".to_string(),
        "0".to_string(),
        "-b:v".to_string(),
        "1800k".to_string(),
        "-maxrate".to_string(),
        "2200k".to_string(),
        "-bufsize".to_string(),
        "600k".to_string(),
    ]);
    if pwcat_child.is_some() {
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "128k".to_string(),
            "-ar".to_string(),
            "44100".to_string(),
            "-ac".to_string(),
            "2".to_string(),
        ]);
    }
    args.extend([
        "-f".to_string(),
        "mp4".to_string(),
        "-movflags".to_string(),
        "frag_keyframe+empty_moov+default_base_moof".to_string(),
        "pipe:1".to_string(),
    ]);
    let ffmpeg_stdin = pwcat_child
        .as_mut()
        .and_then(|child| child.stdout.take())
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null);
    let mut child = Command::new("ffmpeg")
        .args(args)
        .stdin(ffmpeg_stdin)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| io::Error::other(format!("ffmpeg x11grab unavailable: {err}")))?;

    stream.set_nodelay(true)?;
    send_stream_header(stream, "video/mp4")?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg stdout unavailable"))?;
    let copy_result = io::copy(&mut stdout, stream);
    let _ = child.kill();
    let _ = child.wait();
    if let Some(mut pwcat_child) = pwcat_child {
        let _ = pwcat_child.kill();
        let _ = pwcat_child.wait();
    }
    copy_result.map(|_| ())
}

fn host_alert_spawn_pipewire_capture(sink_name: &str) -> io::Result<Child> {
    Command::new("pw-cat")
        .args([
            "--record",
            "--raw",
            "--target",
            sink_name,
            "--rate",
            "44100",
            "--channels",
            "2",
            "--format",
            "s16",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
}

fn host_alert_touch_events(
    state: &HostState,
    instance_id: &str,
    after_id: u64,
) -> io::Result<serde_json::Value> {
    let events = state
        .alert_touch_events
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let last_event_id = events
        .iter()
        .filter(|event| event.instance == instance_id)
        .map(|event| event.id)
        .max()
        .unwrap_or(0);
    let visible: Vec<_> = events
        .iter()
        .filter(|event| event.instance == instance_id && event.id > after_id)
        .cloned()
        .collect();
    Ok(serde_json::json!({
        "instance": instance_id,
        "lastEventId": last_event_id,
        "events": visible,
    }))
}

fn host_alert_touch_command(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    command: HostAlertTouchRequest,
) -> io::Result<serde_json::Value> {
    if command.player != 1 && command.player != 2 {
        return Err(invalid_request("player must be 1 or 2"));
    }
    let instance = host_alert_claimed_instance(state, instance_id, client_id, command.player - 1)?;
    let kind = command.kind.trim();
    if !matches!(
        kind,
        "tap" | "doubleTap" | "dragStart" | "dragMove" | "dragEnd" | "pinch" | "key" | "cancel"
    ) {
        return Err(invalid_request("invalid EutherAlert touch command kind"));
    }
    validate_alert_touch_payload(&command.payload)?;

    let id = {
        let mut next = state
            .next_alert_touch_id
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        let id = *next;
        *next += 1;
        id
    };
    let event = HostAlertTouchEvent {
        id,
        unix_ms: unix_ms_now(),
        instance: instance.id,
        client: client_id.to_string(),
        player: command.player,
        kind: kind.to_string(),
        payload: command.payload,
    };
    let injected = match host_alert_touch_inject(state, &event) {
        Ok(injected) => injected,
        Err(err) => {
            eprintln!("EutherAlert touch injector failed: {err}");
            false
        }
    };
    let mut events = state
        .alert_touch_events
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    events.push(event.clone());
    if events.len() > 4096 {
        let excess = events.len() - 4096;
        events.drain(0..excess);
    }
    Ok(serde_json::json!({
        "ok": true,
        "lastEventId": id,
        "event": event,
        "injected": injected,
    }))
}

fn validate_alert_touch_payload(payload: &serde_json::Value) -> io::Result<()> {
    let Some(object) = payload.as_object() else {
        return Err(invalid_request("touch payload must be an object"));
    };
    for key in ["x", "y", "x2", "y2", "dx", "dy", "scale"] {
        if let Some(value) = object.get(key) {
            let Some(number) = value.as_f64() else {
                return Err(invalid_request(format!(
                    "touch payload {key} must be numeric"
                )));
            };
            if !number.is_finite() || number.abs() > 10_000.0 {
                return Err(invalid_request(format!("touch payload {key} out of range")));
            }
        }
    }
    if let Some(value) = object.get("button").or_else(|| object.get("key")) {
        let Some(text) = value.as_str() else {
            return Err(invalid_request("touch payload button/key must be text"));
        };
        if text.len() > 32 {
            return Err(invalid_request("touch payload button/key too long"));
        }
    }
    Ok(())
}

fn host_alert_touch_inject(state: &HostState, event: &HostAlertTouchEvent) -> io::Result<bool> {
    let command = host_alert_touch_bridge_command(&event.instance);
    if command.trim().is_empty() {
        return Ok(false);
    }

    let payload = serde_json::to_vec(event).map_err(|err| io::Error::other(err.to_string()))?;
    let mut bridge = state
        .alert_touch_bridge
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    if let Some(process) = bridge.as_mut() {
        if process.command != command || process.child.try_wait()?.is_some() {
            *bridge = None;
        }
    }
    if bridge.is_none() {
        *bridge = Some(host_alert_touch_bridge_start(&command)?);
    }
    let process = bridge
        .as_mut()
        .ok_or_else(|| io::Error::other("touch bridge failed to start"))?;
    if let Err(err) = process
        .stdin
        .write_all(&payload)
        .and_then(|_| process.stdin.write_all(b"\n"))
        .and_then(|_| process.stdin.flush())
    {
        *bridge = None;
        return Err(err);
    }
    Ok(true)
}

fn host_alert_touch_bridge_start(command: &str) -> io::Result<HostAlertTouchBridgeProcess> {
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("touch bridge stdin unavailable"))?;
    Ok(HostAlertTouchBridgeProcess {
        child,
        stdin,
        command: command.to_string(),
        started_unix_ms: unix_ms_now(),
    })
}

fn host_alert_command(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    mut command: HostAlertCommandRequest,
) -> io::Result<serde_json::Value> {
    if command.player != 1 && command.player != 2 {
        return Err(invalid_request("player must be 1 or 2"));
    }
    let instance = host_alert_claimed_instance(state, instance_id, client_id, command.player - 1)?;
    let trimmed_kind = command.kind.trim();
    if !matches!(trimmed_kind, "build" | "train" | "order") {
        return Err(invalid_request("invalid EutherAlert command kind"));
    }
    let server_tick = host_alert_server_tick(&instance);
    let apply_tick = server_tick + 12;
    if let serde_json::Value::Object(payload) = &mut command.payload {
        payload.insert("tick".to_string(), serde_json::json!(apply_tick));
    } else {
        let value = std::mem::take(&mut command.payload);
        command.payload = serde_json::json!({
            "value": value,
            "tick": apply_tick,
        });
    }
    let mut events = instance
        .alert_events
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let next_id = events.last().map(|event| event.id + 1).unwrap_or(1);
    let event = HostAlertEvent {
        id: next_id,
        unix_ms: unix_ms_now(),
        player: command.player,
        kind: trimmed_kind.to_string(),
        payload: command.payload,
    };
    events.push(event.clone());
    if events.len() > 4096 {
        let excess = events.len() - 4096;
        events.drain(0..excess);
    }
    Ok(serde_json::json!({
        "ok": true,
        "lastEventId": next_id,
        "event": event,
    }))
}

fn host_alert_claimed_instance(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    player_index: usize,
) -> io::Result<HostInstance> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherAlert {
        return Err(invalid_request("selected instance is not EutherAlert"));
    }
    let mut slots = instance
        .bridge
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(slot) = slots.get_mut(player_index) else {
        return Err(invalid_request("player must be 1 or 2"));
    };
    match slot.as_mut() {
        Some(lease)
            if lease.client_id == client_id
                && Instant::now().duration_since(lease.updated) <= HOST_PLAYER_LEASE_TIMEOUT =>
        {
            lease.updated = Instant::now();
            Ok(instance.clone())
        }
        _ => Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "claim an EutherAlert player slot first",
        )),
    }
}

fn host_doom_status(state: &HostState, instance_id: &str) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherDoom {
        return Err(invalid_request("selected instance is not EutherDoom"));
    }
    release_expired_doom_players(&instance)?;
    let doom = instance
        .doom
        .as_ref()
        .ok_or_else(|| io::Error::other("doom instance missing state"))?
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let snapshot = doom.snapshot(8);
    let players = snapshot
        .players
        .iter()
        .map(|player| {
            serde_json::json!({
                "player": player.player,
                "user": player.name,
                "ready": player.ready,
            })
        })
        .collect::<Vec<_>>();
    let frames = snapshot
        .recent_frames
        .iter()
        .map(|frame| {
            serde_json::json!({
                "tic": frame.tic,
                "commands": frame.commands.iter().map(doom_command_json).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "instance": instance.id,
        "name": instance.name,
        "currentTic": snapshot.current_tic,
        "replayEvents": snapshot.replay_events,
        "lastEventId": snapshot.last_event_id,
        "players": players,
        "frames": frames,
    }))
}

fn host_doom_events(
    state: &HostState,
    instance_id: &str,
    after_id: u64,
) -> io::Result<serde_json::Value> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherDoom {
        return Err(invalid_request("selected instance is not EutherDoom"));
    }
    release_expired_doom_players(&instance)?;
    let doom = instance
        .doom
        .as_ref()
        .ok_or_else(|| io::Error::other("doom instance missing state"))?
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let events = doom
        .queued_events_after(after_id)
        .iter()
        .map(doom_queued_event_json)
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "instance": instance.id,
        "lastEventId": doom.last_event_id(),
        "events": events,
    }))
}

fn stream_host_doom_events(
    stream: &mut TcpStream,
    state: &HostState,
    instance_id: &str,
    after_id: u64,
) -> io::Result<()> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherDoom {
        return Err(invalid_request("selected instance is not EutherDoom"));
    }
    stream.set_nodelay(true)?;
    send_event_stream_header(stream)?;
    let mut last_event_id = after_id;
    let mut last_ping = Instant::now();
    loop {
        let instance = match host_instance_snapshot(state, instance_id) {
            Ok(instance) if instance.kind == HostInstanceKind::EutherDoom => instance,
            _ => break Ok(()),
        };
        release_expired_doom_players(&instance)?;
        let (events, current_last_event_id) = {
            let mut doom = instance
                .doom
                .as_ref()
                .ok_or_else(|| io::Error::other("doom instance missing state"))?
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            doom.tick(Instant::now());
            let events = doom
                .queued_events_after(last_event_id)
                .iter()
                .map(doom_queued_event_json)
                .collect::<Vec<_>>();
            (events, doom.last_event_id())
        };
        if !events.is_empty() {
            for event in events {
                let payload = serde_json::to_string(&event)
                    .map_err(|err| io::Error::other(err.to_string()))?;
                if write!(stream, "data: {payload}\n\n").is_err() {
                    return Ok(());
                }
            }
            if stream.flush().is_err() {
                return Ok(());
            }
            last_event_id = current_last_event_id;
            last_ping = Instant::now();
        } else if last_ping.elapsed() >= Duration::from_secs(5) {
            if write!(stream, ": doom ping\n\n").is_err() {
                break Ok(());
            }
            if stream.flush().is_err() {
                break Ok(());
            }
            last_ping = Instant::now();
        }
        thread::sleep(Duration::from_millis(33));
    }
}

fn host_doom_replay(state: &HostState, instance_id: &str) -> io::Result<String> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherDoom {
        return Err(invalid_request("selected instance is not EutherDoom"));
    }
    instance
        .doom
        .as_ref()
        .ok_or_else(|| io::Error::other("doom instance missing state"))?
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))
        .map(|doom| doom.replay_text())
}

fn set_host_doom_ready(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    player_index: usize,
    ready: bool,
) -> io::Result<()> {
    let instance = host_doom_claimed_instance(state, instance_id, client_id, player_index)?;
    let player_id = eutherdoom_server::PlayerId::from_index(player_index)
        .ok_or_else(|| invalid_request("player must be 1 or 2"))?;
    instance
        .doom
        .as_ref()
        .ok_or_else(|| io::Error::other("doom instance missing state"))?
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?
        .handle_command(
            player_id,
            eutherdoom_server::DoomClientCommand::Ready(ready),
            Instant::now(),
        )
        .map(|_| ())
        .map_err(host_doom_error)
}

fn submit_host_doom_command(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    player_index: usize,
    command: eutherdoom_server::TicCommand,
) -> io::Result<()> {
    let instance = host_doom_claimed_instance(state, instance_id, client_id, player_index)?;
    let player_id = eutherdoom_server::PlayerId::from_index(player_index)
        .ok_or_else(|| invalid_request("player must be 1 or 2"))?;
    instance
        .doom
        .as_ref()
        .ok_or_else(|| io::Error::other("doom instance missing state"))?
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?
        .handle_command(
            player_id,
            eutherdoom_server::DoomClientCommand::Input(command),
            Instant::now(),
        )
        .map(|_| ())
        .map_err(host_doom_error)
}

fn reset_host_doom(state: &HostState, instance_id: &str) -> io::Result<()> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherDoom {
        return Err(invalid_request("selected instance is not EutherDoom"));
    }
    instance
        .doom
        .as_ref()
        .ok_or_else(|| io::Error::other("doom instance missing state"))?
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?
        .reset(Instant::now());
    Ok(())
}

fn host_doom_claimed_instance(
    state: &HostState,
    instance_id: &str,
    client_id: &str,
    player_index: usize,
) -> io::Result<HostInstance> {
    let instance = host_instance_snapshot(state, instance_id)?;
    if instance.kind != HostInstanceKind::EutherDoom {
        return Err(invalid_request("selected instance is not EutherDoom"));
    }
    let mut slots = instance
        .bridge
        .player_slots
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(slot) = slots.get_mut(player_index) else {
        return Err(invalid_request("player must be 1 or 2"));
    };
    match slot.as_mut() {
        Some(lease) if lease.client_id == client_id => {
            lease.updated = Instant::now();
            Ok(instance.clone())
        }
        _ => Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "claim a Doom player slot first",
        )),
    }
}

fn host_doom_command(request: &HttpRequest) -> io::Result<eutherdoom_server::TicCommand> {
    Ok(eutherdoom_server::TicCommand {
        tic: required_query_value(&request.path, "tic")?,
        forward: required_query_value(&request.path, "forward")?,
        strafe: required_query_value(&request.path, "strafe")?,
        turn: required_query_value(&request.path, "turn")?,
        buttons: required_query_value(&request.path, "buttons")?,
        weapon: required_query_value(&request.path, "weapon")?,
    })
}

fn required_query_value<T: std::str::FromStr>(path: &str, key: &str) -> io::Result<T> {
    let value = query_string_value(path, key)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid_request(format!("missing {key}")))?;
    value
        .parse()
        .map_err(|_| invalid_request(format!("invalid {key}")))
}

fn doom_command_json(command: &eutherdoom_server::TicCommand) -> serde_json::Value {
    serde_json::json!({
        "tic": command.tic,
        "forward": command.forward,
        "strafe": command.strafe,
        "turn": command.turn,
        "buttons": command.buttons,
        "weapon": command.weapon,
    })
}

fn doom_queued_event_json(event: &eutherdoom_server::QueuedDoomEvent) -> serde_json::Value {
    let mut value = doom_server_event_json(&event.event);
    value["id"] = serde_json::json!(event.id);
    value
}

fn doom_server_event_json(event: &eutherdoom_server::DoomServerEvent) -> serde_json::Value {
    match event {
        eutherdoom_server::DoomServerEvent::PlayerJoined { player, name } => serde_json::json!({
            "type": "playerJoined",
            "player": player.index() + 1,
            "user": name,
        }),
        eutherdoom_server::DoomServerEvent::PlayerClaimed { player, name } => serde_json::json!({
            "type": "playerClaimed",
            "player": player.index() + 1,
            "user": name,
        }),
        eutherdoom_server::DoomServerEvent::PlayerReady { player, ready } => serde_json::json!({
            "type": "playerReady",
            "player": player.index() + 1,
            "ready": ready,
        }),
        eutherdoom_server::DoomServerEvent::PlayerHeartbeat { player } => serde_json::json!({
            "type": "playerHeartbeat",
            "player": player.index() + 1,
        }),
        eutherdoom_server::DoomServerEvent::PlayerLeft { player } => serde_json::json!({
            "type": "playerLeft",
            "player": player.index() + 1,
        }),
        eutherdoom_server::DoomServerEvent::TicFrame(frame) => serde_json::json!({
            "type": "ticFrame",
            "tic": frame.tic,
            "commands": frame.commands.iter().map(doom_command_json).collect::<Vec<_>>(),
        }),
        eutherdoom_server::DoomServerEvent::Reset => serde_json::json!({
            "type": "reset",
        }),
    }
}

fn host_doom_error(err: eutherdoom_server::MatchError) -> io::Error {
    invalid_request(match err {
        eutherdoom_server::MatchError::Full => "match full".to_string(),
        eutherdoom_server::MatchError::InvalidPlayer => "invalid player".to_string(),
        eutherdoom_server::MatchError::PlayerNameEmpty => "player name is empty".to_string(),
        eutherdoom_server::MatchError::SlotOccupied => "player slot occupied".to_string(),
        eutherdoom_server::MatchError::PlayerNotReady => "player not ready".to_string(),
        eutherdoom_server::MatchError::CommandTicMismatch { expected, actual } => {
            format!("tic mismatch expected={expected} actual={actual}")
        }
        eutherdoom_server::MatchError::CommandAlreadySubmitted { player, tic } => {
            format!("player {} already submitted tic {tic}", player.index() + 1)
        }
    })
}

fn clear_bridge_input(state: &BridgeState, player_index: usize) -> io::Result<()> {
    store_bridge_input(state, empty_bridge_input(player_index))
}

fn host_user_list(state: &HostState) -> io::Result<serde_json::Value> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    Ok(serde_json::json!({
        "users": users
            .iter()
            .map(|user| {
                Ok(serde_json::json!({
                    "name": user.name,
                    "banned": user.banned,
                    "admin": user.admin,
                    "permissions": host_permissions_for_user(user),
                }))
            })
            .collect::<io::Result<Vec<_>>>()?
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
        app_token: None,
        app_lan_server_url: None,
        banned: false,
        admin: username == "nichlas",
        can_play: true,
        can_launch_roms: false,
        can_upload_roms: false,
        can_manage_library: false,
        can_award_eutherium: false,
        can_camera_admin: false,
        camera_rotation_degrees: 0,
        camera_refresh_ms: 500,
        euthersync_media_backup: Some(false),
        euthersync_feed_post: Some(true),
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

fn set_host_user_permissions(
    state: &HostState,
    username: &str,
    permissions: HostPermissions,
) -> io::Result<()> {
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let Some(user) = users.iter_mut().find(|user| user.name == username) else {
        return Err(invalid_request("user not found"));
    };
    user.can_play = permissions.can_play;
    user.can_launch_roms = permissions.can_launch_roms;
    user.can_upload_roms = permissions.can_upload_roms;
    user.can_manage_library = permissions.can_manage_library;
    user.can_award_eutherium = permissions.can_award_eutherium;
    user.can_camera_admin = permissions.can_camera_admin;
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

fn app_token(request: &HttpRequest) -> Option<String> {
    header_value(request, "x-euther-app-token")
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .or_else(|| {
            header_value(request, "authorization").and_then(|value| {
                value
                    .trim()
                    .strip_prefix("Bearer ")
                    .map(str::trim)
                    .filter(|token| !token.is_empty())
                    .map(str::to_string)
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

fn host_session_cookie(
    state: &HostState,
    request: &HttpRequest,
    token: &str,
    max_age: Option<u64>,
) -> String {
    let mut cookie = format!("euther_session={token}; HttpOnly; SameSite=Lax; Path=/");
    if host_request_uses_https(state, request) {
        cookie.push_str("; Secure");
    }
    if let Some(max_age) = max_age {
        cookie.push_str(&format!("; Max-Age={max_age}"));
    }
    cookie
}

fn host_request_uses_https(state: &HostState, request: &HttpRequest) -> bool {
    if !state.config.secure_cookies {
        return false;
    }
    if header_value(request, "x-forwarded-proto") == Some("https") {
        return true;
    }
    let Some(host) = header_value(request, "host") else {
        return false;
    };
    state
        .config
        .allowed_origins
        .iter()
        .filter(|origin| origin.starts_with("https://"))
        .filter_map(|origin| origin_host(origin))
        .any(|origin_host| origin_host == host)
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

fn set_response_cors_origin(origin: Option<String>) {
    RESPONSE_CORS_ORIGIN.with(|slot| *slot.borrow_mut() = origin);
}

fn response_cors_origin() -> String {
    RESPONSE_CORS_ORIGIN
        .with(|slot| slot.borrow().clone())
        .unwrap_or_else(|| "http://127.0.0.1:5173".to_string())
}

fn cors_origin_for_request(state: &HostState, request: &HttpRequest) -> Option<String> {
    let origin = header_value(request, "origin")?;
    if origin == "null" {
        return None;
    }
    if is_tauri_app_origin(origin)
        || state
            .config
            .allowed_origins
            .iter()
            .any(|allowed| allowed == origin)
        || header_value(request, "host")
            .is_some_and(|host| origin_host(origin).as_deref() == Some(host))
    {
        return Some(origin.to_string());
    }
    None
}

fn is_tauri_app_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://tauri.localhost"
            | "https://tauri.localhost"
            | "tauri://localhost"
            | "http://localhost:5181"
            | "http://127.0.0.1:5181"
    )
}

fn host_canonical_redirect(state: &HostState, request: &HttpRequest) -> Option<String> {
    if !state.config.secure_cookies {
        return None;
    }
    let public_origin = state
        .config
        .allowed_origins
        .iter()
        .find(|origin| origin.starts_with("https://"))?;
    let request_host = header_value(request, "host")?;
    if origin_host(public_origin).as_deref() == Some(request_host) {
        return None;
    }
    let allowed_host = state
        .config
        .allowed_origins
        .iter()
        .filter_map(|origin| origin_host(origin))
        .any(|host| host == request_host);
    if allowed_host {
        return None;
    }
    let path = if request.path.starts_with('/') {
        request.path.as_str()
    } else {
        "/"
    };
    Some(format!("{public_origin}{path}"))
}

fn origin_host(origin: &str) -> Option<String> {
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))?;
    Some(rest.split('/').next()?.to_string())
}

fn send_host_static(stream: &mut TcpStream, path: &str) -> io::Result<()> {
    let file_path = match resolve_host_static_path(path) {
        Ok(file_path) => file_path,
        Err(err) if err.kind() == io::ErrorKind::InvalidInput => {
            return send_error(stream, 404, "not found");
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return send_error(stream, 404, "not found");
        }
        Err(err) => return Err(err),
    };
    let bytes = fs::read(&file_path)?;
    let content_type = match file_path
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("wasm") => "application/wasm",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    };
    send_response(stream, 200, content_type, &bytes)
}

fn send_external_runtime_static(
    stream: &mut TcpStream,
    path: &str,
    mount: &str,
    env_key: &str,
    default_root: &str,
) -> io::Result<()> {
    let root = env::var(env_key)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(default_root))
        .canonicalize()?;
    let relative = path.trim_start_matches(mount);
    let canonical = root.join(safe_relative_path(relative)?).canonicalize()?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return send_error(stream, 404, "not found");
    }
    let bytes = fs::read(&canonical)?;
    let content_type = match canonical
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("wasm") => "application/wasm",
        Some("jsdos") => "application/octet-stream",
        Some("zip") => "application/zip",
        Some("data") => "application/octet-stream",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };
    send_response(stream, 200, content_type, &bytes)
}

fn send_eutherlist_apk(stream: &mut TcpStream) -> io::Result<()> {
    let apk_path = env::var("EUTHERLIST_APK_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home_apk = PathBuf::from(DEFAULT_EUTHERLIST_APK_PATH);
            if home_apk.is_file() {
                home_apk
            } else {
                PathBuf::from(DEFAULT_EUTHERLIST_REPO_APK_PATH)
            }
        });
    send_android_apk(
        stream,
        &apk_path,
        "EutherList-release-signed.apk",
        "EutherList APK is not available",
    )
}

fn is_eutherlist_apk_download_path(path: &str) -> bool {
    matches!(
        path,
        "/downloads/eutherlist.apk"
            | "/downloads/EutherList.apk"
            | "/downloads/EutherList-release-signed.apk"
            | "/downloads/eutherlist-release-signed.apk"
    )
}

fn send_euthersync_apk(stream: &mut TcpStream) -> io::Result<()> {
    let apk_path = env::var("EUTHERSYNC_APK_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home_apk = PathBuf::from(DEFAULT_EUTHERSYNC_APK_PATH);
            if home_apk.is_file() {
                home_apk
            } else {
                PathBuf::from(DEFAULT_EUTHERSYNC_REPO_APK_PATH)
            }
        });
    send_android_apk(
        stream,
        &apk_path,
        "EutherSync-release-signed.apk",
        "EutherSync APK is not available",
    )
}

fn is_euthersync_apk_download_path(path: &str) -> bool {
    matches!(
        path,
        "/downloads/euthersync.apk"
            | "/downloads/EutherSync.apk"
            | "/downloads/EutherSync-release-signed.apk"
            | "/downloads/euthersync-release-signed.apk"
    )
}

fn send_eutherbooks_player_apk(stream: &mut TcpStream) -> io::Result<()> {
    let apk_path = env::var("EUTHERBOOKS_PLAYER_APK_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home_apk = PathBuf::from(DEFAULT_EUTHERBOOKS_PLAYER_APK_PATH);
            if home_apk.is_file() {
                home_apk
            } else {
                PathBuf::from(DEFAULT_EUTHERBOOKS_PLAYER_REPO_APK_PATH)
            }
        });
    send_android_apk(
        stream,
        &apk_path,
        "EutherBooksPlayer-release-signed.apk",
        "EutherBooks Player APK is not available",
    )
}

fn is_eutherbooks_player_apk_download_path(path: &str) -> bool {
    matches!(
        path,
        "/downloads/eutherbooksplayer.apk"
            | "/downloads/EutherBooksPlayer.apk"
            | "/downloads/EutherBooksPlayer-release-signed.apk"
            | "/downloads/eutherbooksplayer-release-signed.apk"
    )
}

fn is_android_apk_download_path(path: &str) -> bool {
    is_eutherlist_apk_download_path(path)
        || is_euthersync_apk_download_path(path)
        || is_eutherbooks_player_apk_download_path(path)
}

fn send_android_apk(
    stream: &mut TcpStream,
    apk_path: &Path,
    download_filename: &str,
    missing_message: &str,
) -> io::Result<()> {
    let bytes = match fs::read(&apk_path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            return send_error(stream, 404, missing_message);
        }
        Err(err) => return Err(err),
    };
    let disposition = format!("attachment; filename=\"{download_filename}\"");
    send_response_with_headers(
        stream,
        200,
        "application/vnd.android.package-archive",
        &bytes,
        &[
            ("Content-Disposition", disposition.as_str()),
            ("Cache-Control", "no-store, max-age=0"),
            ("Pragma", "no-cache"),
        ],
    )
}

fn proxy_eutherbooks_request(stream: &mut TcpStream, request: &HttpRequest) -> io::Result<()> {
    if request.method != "GET" && request.method != "POST" {
        return send_error(stream, 405, "method not allowed");
    }
    let upstream_base =
        env::var("EUTHERBOOKS_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:8088".to_string());
    let mut upstream = match TcpStream::connect(&upstream_base) {
        Ok(upstream) => upstream,
        Err(_) => return send_error(stream, 502, "EutherBooks upstream unavailable"),
    };
    upstream.set_read_timeout(Some(Duration::from_secs(30)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let upstream_path = eutherbooks_upstream_path(&request.path);
    write!(
        upstream,
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
        request.method, upstream_path, upstream_base
    )?;
    if !request.body.is_empty() {
        write!(upstream, "Content-Length: {}\r\n", request.body.len())?;
    }
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("x-csrf-token")
            || name.eq_ignore_ascii_case("cookie")
        {
            continue;
        }
        write!(upstream, "{name}: {value}\r\n")?;
    }
    write!(upstream, "\r\n")?;
    if !request.body.is_empty() {
        upstream.write_all(&request.body)?;
    }
    io::copy(&mut upstream, stream)?;
    Ok(())
}

fn eutherbooks_upstream_path(path: &str) -> String {
    let stripped = path
        .strip_prefix("/eutherbooks")
        .filter(|value| !value.is_empty())
        .unwrap_or("/");
    stripped.to_string()
}

fn proxy_camera_frigate_request(stream: &mut TcpStream, request: &HttpRequest) -> io::Result<()> {
    if !matches!(
        request.method.as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
    ) {
        return send_error(stream, 405, "method not allowed");
    }
    if is_websocket_upgrade(request) {
        return proxy_camera_frigate_websocket_request(stream, request);
    }
    let upstream_base =
        env::var("EUTHERSIGHT_FRIGATE_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:15000".to_string());
    let mut upstream = match TcpStream::connect(&upstream_base) {
        Ok(upstream) => upstream,
        Err(_) => return send_error(stream, 502, "EutherSight camera upstream unavailable"),
    };
    upstream.set_read_timeout(Some(Duration::from_secs(60)))?;
    upstream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let upstream_path = camera_frigate_upstream_path(&request.path);
    write!(
        upstream,
        "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
        request.method, upstream_path, upstream_base
    )?;
    if !request.body.is_empty() {
        write!(upstream, "Content-Length: {}\r\n", request.body.len())?;
    }
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("x-csrf-token")
            || name.eq_ignore_ascii_case("cookie")
        {
            continue;
        }
        write!(upstream, "{name}: {value}\r\n")?;
    }
    write!(upstream, "\r\n")?;
    if !request.body.is_empty() {
        upstream.write_all(&request.body)?;
    }
    io::copy(&mut upstream, stream)?;
    Ok(())
}

fn proxy_camera_frigate_websocket_request(
    stream: &mut TcpStream,
    request: &HttpRequest,
) -> io::Result<()> {
    if request.method != "GET" {
        return send_error(stream, 405, "method not allowed");
    }
    let upstream_base =
        env::var("EUTHERSIGHT_FRIGATE_UPSTREAM").unwrap_or_else(|_| "127.0.0.1:15000".to_string());
    let mut upstream = match TcpStream::connect(&upstream_base) {
        Ok(upstream) => upstream,
        Err(_) => return send_error(stream, 502, "EutherSight camera upstream unavailable"),
    };
    let upstream_path = camera_frigate_upstream_path(&request.path);
    write!(
        upstream,
        "{} {} HTTP/1.1\r\nHost: {}\r\n",
        request.method, upstream_path, upstream_base
    )?;
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("x-csrf-token")
            || name.eq_ignore_ascii_case("cookie")
        {
            continue;
        }
        write!(upstream, "{name}: {value}\r\n")?;
    }
    write!(upstream, "\r\n")?;

    let mut upstream_to_client = upstream.try_clone()?;
    let mut client_writer = stream.try_clone()?;
    let to_client = thread::spawn(move || io::copy(&mut upstream_to_client, &mut client_writer));
    let to_upstream = io::copy(stream, &mut upstream);
    let _ = to_client.join();
    to_upstream.map(|_| ())
}

fn is_websocket_upgrade(request: &HttpRequest) -> bool {
    header_value(request, "upgrade").is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
        && header_value(request, "connection")
            .is_some_and(|value| value.to_ascii_lowercase().contains("upgrade"))
}

fn camera_frigate_upstream_path(path: &str) -> String {
    let stripped = path
        .strip_prefix(CAMERA_FRIGATE_PROXY_PREFIX)
        .filter(|value| !value.is_empty())
        .unwrap_or("/");
    stripped.to_string()
}

fn host_camera_settings(state: &HostState, username: &str) -> io::Result<serde_json::Value> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let rotation_degrees = users
        .iter()
        .find(|user| user.name == username)
        .map(|user| {
            (
                normalize_camera_rotation(user.camera_rotation_degrees as i32),
                normalize_camera_refresh_ms(user.camera_refresh_ms),
            )
        })
        .unwrap_or((0, 500));
    Ok(serde_json::json!({
        "rotationDegrees": rotation_degrees.0,
        "refreshMs": rotation_degrees.1,
    }))
}

fn set_host_camera_settings(
    state: &HostState,
    username: &str,
    rotation_degrees: Option<i32>,
    refresh_ms: Option<u16>,
) -> io::Result<serde_json::Value> {
    let mut users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    let user = users
        .iter_mut()
        .find(|user| user.name == username)
        .ok_or_else(|| invalid_request("unknown user"))?;
    if let Some(rotation_degrees) = rotation_degrees {
        user.camera_rotation_degrees = normalize_camera_rotation(rotation_degrees);
    }
    if let Some(refresh_ms) = refresh_ms {
        user.camera_refresh_ms = normalize_camera_refresh_ms(refresh_ms);
    }
    let rotation_degrees = user.camera_rotation_degrees;
    let refresh_ms = user.camera_refresh_ms;
    save_host_users(&users)?;
    Ok(serde_json::json!({
        "rotationDegrees": rotation_degrees,
        "refreshMs": refresh_ms,
    }))
}

fn normalize_camera_rotation(rotation_degrees: i32) -> u16 {
    match rotation_degrees.rem_euclid(360) {
        0 => 0,
        90 => 90,
        180 => 180,
        270 => 270,
        other => ((other + 45) / 90 * 90).rem_euclid(360) as u16,
    }
}

fn normalize_camera_refresh_ms(refresh_ms: u16) -> u16 {
    match refresh_ms {
        0..=124 => 125,
        125..=249 => 125,
        250..=499 => 250,
        500..=999 => 500,
        1000..=1999 => 1000,
        2000..=4999 => 2000,
        _ => 5000,
    }
}

fn send_camera_admin_page(stream: &mut TcpStream) -> io::Result<()> {
    let body = r#"<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EutherSight Camera Admin</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #090b0f; color: #eef3f5; }
    body { margin: 0; min-height: 100vh; background: #090b0f; }
    body.camera-fullscreen { overflow: hidden; }
    main { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 32px; display: grid; gap: 16px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    h1 { margin: 0; font-size: clamp(1.4rem, 3vw, 2.1rem); }
    p { margin: 0; color: #a9b8c2; }
    a { color: #96d7ff; font-weight: 800; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .panel { border: 1px solid rgba(180,205,218,.22); border-radius: 8px; background: #111820; overflow: hidden; }
    .panel > div { padding: 12px 14px; display: flex; justify-content: space-between; gap: 12px; align-items: center; border-bottom: 1px solid rgba(180,205,218,.16); }
    .panel-head { flex-wrap: wrap; }
    .camera-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    button, select, .launch-card a { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(150,215,255,.4); background: #101722; color: #bfe8ff; font: inherit; font-weight: 800; text-decoration: none; }
    button:active { transform: translateY(1px); }
    .mode-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
    .mode-tabs button.is-active { background: #1d3346; color: #fff; }
    .snapshot-frame, .live-frame { --camera-zoom: 1; --camera-pan-x: 0px; --camera-pan-y: 0px; box-sizing: border-box; position: relative; width: 100%; height: min(70vh, 720px); min-height: 360px; margin: 0; overflow: hidden; background: #05070a; cursor: zoom-in; touch-action: none; user-select: none; }
    .snapshot-frame[hidden], .live-panel[hidden] { display: none; }
    .snapshot-frame.is-fullscreen, .live-frame.is-fullscreen { position: fixed; inset: 0; z-index: 1000; width: 100vw; height: 100dvh; min-height: 100dvh; border: 0; border-radius: 0; cursor: zoom-out; }
    img, video { position: absolute; left: 50%; top: 50%; display: block; width: auto; height: auto; max-width: none; max-height: none; object-fit: contain; transform: translate(-50%, -50%) translate(var(--camera-pan-x), var(--camera-pan-y)) rotate(var(--camera-rotation, 0deg)) scale(var(--camera-zoom)); transform-origin: center center; transition: transform .08s ease; will-change: transform; }
    .live-tools { position: sticky; top: 0; z-index: 2; padding: 12px 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid rgba(180,205,218,.16); background: #111820; }
    .live-tools label { display: inline-flex; align-items: center; gap: 8px; color: #a9b8c2; font-weight: 700; }
    input[type="range"] { width: 140px; accent-color: #96d7ff; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .actions a { min-height: 40px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(150,215,255,.4); text-decoration: none; }
    .launch-card { padding: 18px; display: grid; gap: 10px; }
    .launch-card p { max-width: 68ch; }
    @media (max-width: 640px) {
      main { width: min(100vw - 24px, 1180px); padding-top: 18px; }
      header { align-items: flex-start; }
      .panel > div { align-items: flex-start; }
      .camera-toolbar { width: 100%; justify-content: space-between; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>EutherSight Camera Admin</h1>
        <p>Skyddad via EutherHost-behörigheten camera_admin.</p>
      </div>
      <nav class="actions">
        <a href="/">EutherHost</a>
        <a href="/api/camera/frigate/" target="_blank" rel="noreferrer">Frigate</a>
      </nav>
    </header>
    <section class="panel">
      <div class="panel-head">
        <strong>yard</strong>
        <span class="mode-tabs">
          <button id="snapshot-mode" type="button" class="is-active">Snapshot</button>
          <button id="live-mode" type="button">Live MSE</button>
        </span>
        <span class="camera-toolbar">
          <span id="rotation-status">Rotation 0 grader</span>
          <label>
            <span class="sr-only">Refresh</span>
            <select id="refresh-rate">
              <option value="125">8 fps</option>
              <option value="250">4 fps</option>
              <option value="500">2 fps</option>
              <option value="1000">1 fps</option>
              <option value="2000">0.5 fps</option>
              <option value="5000">0.2 fps</option>
            </select>
          </label>
          <button id="rotate-camera" type="button">Rotera 90 grader</button>
        </span>
      </div>
      <figure id="snapshot-frame" class="snapshot-frame" data-rotation="0">
        <img id="yard-live" alt="yard camera snapshot" src="/api/camera/frigate/api/yard/latest.jpg" />
      </figure>
      <section id="live-panel" class="live-panel" hidden>
        <div class="live-tools">
          <button id="live-connect" type="button">Starta live</button>
          <button id="live-audio" type="button">Ljud av</button>
          <label>
            Volym
            <input id="live-volume" type="range" min="0" max="100" value="60" />
          </label>
          <span id="live-status">MSE redo</span>
        </div>
        <figure id="live-frame" class="live-frame" data-rotation="0">
          <video id="yard-video" playsinline autoplay muted></video>
        </figure>
      </section>
    </section>
    <section class="panel">
      <div><strong>Frigate admin</strong><span>Proxy via serverns lokala tunnel</span></div>
      <section class="launch-card">
        <p>Frigate-webben öppnas separat. Kamerabilden ovan är EutherHost-vyn som fungerar direkt i mobilen.</p>
        <a href="/api/camera/frigate/" target="_blank" rel="noreferrer">Öppna Frigate</a>
      </section>
    </section>
  </main>
  <script>
    const live = document.getElementById("yard-live");
    const frame = document.getElementById("snapshot-frame");
    const livePanel = document.getElementById("live-panel");
    const video = document.getElementById("yard-video");
    const liveFrame = document.getElementById("live-frame");
    const snapshotMode = document.getElementById("snapshot-mode");
    const liveMode = document.getElementById("live-mode");
    const liveConnect = document.getElementById("live-connect");
    const liveAudio = document.getElementById("live-audio");
    const liveVolume = document.getElementById("live-volume");
    const liveStatus = document.getElementById("live-status");
    const rotate = document.getElementById("rotate-camera");
    const refreshRate = document.getElementById("refresh-rate");
    const rotationStatus = document.getElementById("rotation-status");
    let csrfToken = "";
    let rotationDegrees = 0;
    let refreshMs = 500;
    let refreshTimer = 0;
    let fallbackFullscreen = false;
    let liveFullscreen = false;
    let liveSocket = null;
    let mediaSource = null;
    let sourceBuffer = null;
    let sourceObjectUrl = "";
    let pendingSegments = [];
    let liveEnabled = false;
    let audioEnabled = false;
    let cameraMode = "snapshot";
    let cameraZoom = 1;
    let cameraPanX = 0;
    let cameraPanY = 0;
    let suppressFullscreenUntil = 0;
    let liveBytes = 0;

    function applyRotation(value) {
      rotationDegrees = ((Number(value) || 0) % 360 + 360) % 360;
      frame.dataset.rotation = String(rotationDegrees);
      liveFrame.dataset.rotation = String(rotationDegrees);
      frame.style.setProperty("--camera-rotation", `${rotationDegrees}deg`);
      liveFrame.style.setProperty("--camera-rotation", `${rotationDegrees}deg`);
      rotationStatus.textContent = `Rotation ${rotationDegrees} grader`;
      layoutCameraMedia();
    }

    function applyCameraZoom() {
      const zoom = String(cameraZoom);
      const panX = `${cameraPanX}px`;
      const panY = `${cameraPanY}px`;
      for (const target of [frame, liveFrame]) {
        target.style.setProperty("--camera-zoom", zoom);
        target.style.setProperty("--camera-pan-x", panX);
        target.style.setProperty("--camera-pan-y", panY);
      }
    }

    function mediaAspect(element) {
      if (element instanceof HTMLVideoElement && element.videoWidth > 0 && element.videoHeight > 0) {
        return element.videoWidth / element.videoHeight;
      }
      if (element instanceof HTMLImageElement && element.naturalWidth > 0 && element.naturalHeight > 0) {
        return element.naturalWidth / element.naturalHeight;
      }
      return 16 / 9;
    }

    function fitMediaIntoFrame(frameElement, mediaElement) {
      const bounds = frameElement.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const aspect = mediaAspect(mediaElement);
      const rotated = rotationDegrees === 90 || rotationDegrees === 270;
      const maxWidth = rotated ? bounds.height : bounds.width;
      const maxHeight = rotated ? bounds.width : bounds.height;
      let width = maxWidth;
      let height = width / aspect;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspect;
      }
      mediaElement.style.width = `${Math.max(1, width)}px`;
      mediaElement.style.height = `${Math.max(1, height)}px`;
    }

    function layoutCameraMedia() {
      fitMediaIntoFrame(frame, live);
      fitMediaIntoFrame(liveFrame, video);
    }

    function updateLiveStatus(text) {
      const dimensions = video.videoWidth && video.videoHeight ? ` ${video.videoWidth}x${video.videoHeight}` : "";
      const kb = liveBytes ? ` ${Math.round(liveBytes / 1024)} KB` : "";
      liveStatus.textContent = `${text}${dimensions}${kb}`;
    }

    function normalizeRefresh(value) {
      const requested = Number(value) || 500;
      if (requested <= 125) return 125;
      if (requested <= 250) return 250;
      if (requested <= 500) return 500;
      if (requested <= 1000) return 1000;
      if (requested <= 2000) return 2000;
      return 5000;
    }

    function refreshSnapshot() {
      live.src = `/api/camera/frigate/api/yard/latest.jpg?ts=${Date.now()}`;
    }

    function scheduleSnapshotRefresh() {
      window.clearInterval(refreshTimer);
      refreshTimer = 0;
      if (cameraMode === "snapshot") {
        refreshTimer = window.setInterval(refreshSnapshot, refreshMs);
      }
    }

    function applyRefresh(value) {
      refreshMs = normalizeRefresh(value);
      refreshRate.value = String(refreshMs);
      scheduleSnapshotRefresh();
    }

    async function loadCameraSettings() {
      const auth = await fetch("/api/auth/status", { credentials: "same-origin" });
      if (auth.ok) {
        const authPayload = await auth.json();
        csrfToken = authPayload.csrfToken || "";
      }
      const response = await fetch("/api/camera/settings", { credentials: "same-origin" });
      if (!response.ok) return;
      const settings = await response.json();
      applyRotation(settings.rotationDegrees);
      applyRefresh(settings.refreshMs);
    }

    rotate.addEventListener("click", async () => {
      const nextRotation = (rotationDegrees + 90) % 360;
      applyRotation(nextRotation);
      const body = new URLSearchParams({ rotation_degrees: String(nextRotation) });
      const response = await fetch("/api/camera/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body,
      });
      if (response.ok) {
        const settings = await response.json();
        applyRotation(settings.rotationDegrees);
      }
    });

    refreshRate.addEventListener("change", async () => {
      const nextRefresh = normalizeRefresh(refreshRate.value);
      applyRefresh(nextRefresh);
      const body = new URLSearchParams({ refresh_ms: String(nextRefresh) });
      const response = await fetch("/api/camera/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-CSRF-Token": csrfToken,
        },
        body,
      });
      if (response.ok) {
        const settings = await response.json();
        applyRefresh(settings.refreshMs);
      }
    });

    const activePointers = new Map();
    let gestureStart = null;

    function pointerDistance(points) {
      const dx = points[0].clientX - points[1].clientX;
      const dy = points[0].clientY - points[1].clientY;
      return Math.max(1, Math.hypot(dx, dy));
    }

    function pointerMidpoint(points) {
      return {
        x: (points[0].clientX + points[1].clientX) / 2,
        y: (points[0].clientY + points[1].clientY) / 2,
      };
    }

    function beginGesture() {
      const points = [...activePointers.values()];
      if (points.length === 0) return;
      const midpoint = points.length >= 2 ? pointerMidpoint(points) : { x: points[0].clientX, y: points[0].clientY };
      gestureStart = {
        points: points.length,
        zoom: cameraZoom,
        panX: cameraPanX,
        panY: cameraPanY,
        distance: points.length >= 2 ? pointerDistance(points) : 1,
        midpoint,
      };
    }

    function clampPan() {
      const limit = 900 * cameraZoom;
      cameraPanX = Math.max(-limit, Math.min(limit, cameraPanX));
      cameraPanY = Math.max(-limit, Math.min(limit, cameraPanY));
      if (cameraZoom <= 1.01) {
        cameraZoom = 1;
        cameraPanX = 0;
        cameraPanY = 0;
      }
    }

    function updateGesture() {
      const points = [...activePointers.values()];
      if (!gestureStart || points.length === 0) return;
      suppressFullscreenUntil = Date.now() + 350;
      if (points.length >= 2) {
        const distance = pointerDistance(points);
        const midpoint = pointerMidpoint(points);
        cameraZoom = Math.max(1, Math.min(5, gestureStart.zoom * (distance / gestureStart.distance)));
        cameraPanX = gestureStart.panX + midpoint.x - gestureStart.midpoint.x;
        cameraPanY = gestureStart.panY + midpoint.y - gestureStart.midpoint.y;
      } else if (cameraZoom > 1) {
        const point = points[0];
        cameraPanX = gestureStart.panX + point.clientX - gestureStart.midpoint.x;
        cameraPanY = gestureStart.panY + point.clientY - gestureStart.midpoint.y;
      }
      clampPan();
      applyCameraZoom();
    }

    function installFrameGestures(frameElement) {
      frameElement.addEventListener("pointerdown", (event) => {
        activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
        frameElement.setPointerCapture(event.pointerId);
        beginGesture();
      });
      frameElement.addEventListener("pointermove", (event) => {
        if (!activePointers.has(event.pointerId)) return;
        activePointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
        updateGesture();
      });
      for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
        frameElement.addEventListener(eventName, (event) => {
          activePointers.delete(event.pointerId);
          beginGesture();
        });
      }
    }

    function fullscreenActive() {
      return document.fullscreenElement === frame || fallbackFullscreen;
    }

    async function exitCameraFullscreen() {
      fallbackFullscreen = false;
      liveFullscreen = false;
      frame.classList.remove("is-fullscreen");
      liveFrame.classList.remove("is-fullscreen");
      document.body.classList.remove("camera-fullscreen");
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
    }

    async function enterCameraFullscreen() {
      frame.classList.add("is-fullscreen");
      document.body.classList.add("camera-fullscreen");
      if (frame.requestFullscreen) {
        await frame.requestFullscreen().catch(() => {
          fallbackFullscreen = true;
        });
      } else {
        fallbackFullscreen = true;
      }
    }

    frame.addEventListener("click", async () => {
      if (Date.now() < suppressFullscreenUntil) return;
      if (fullscreenActive()) {
        await exitCameraFullscreen();
      } else {
        await enterCameraFullscreen();
      }
    });

    liveFrame.addEventListener("click", async () => {
      if (Date.now() < suppressFullscreenUntil) return;
      if (document.fullscreenElement === liveFrame || liveFullscreen) {
        await exitCameraFullscreen();
      } else {
        liveFullscreen = true;
        liveFrame.classList.add("is-fullscreen");
        document.body.classList.add("camera-fullscreen");
        if (liveFrame.requestFullscreen) {
          await liveFrame.requestFullscreen().catch(() => {});
        }
      }
    });

    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        fallbackFullscreen = false;
        liveFullscreen = false;
      }
      const active = document.fullscreenElement === frame || fallbackFullscreen;
      frame.classList.toggle("is-fullscreen", active);
      const liveActive = document.fullscreenElement === liveFrame || liveFullscreen;
      liveFrame.classList.toggle("is-fullscreen", liveActive);
      document.body.classList.toggle("camera-fullscreen", active || liveActive);
      requestAnimationFrame(layoutCameraMedia);
    });

    function setMode(mode) {
      const isLive = mode === "live";
      cameraMode = isLive ? "live" : "snapshot";
      frame.hidden = isLive;
      livePanel.hidden = !isLive;
      snapshotMode.classList.toggle("is-active", !isLive);
      liveMode.classList.toggle("is-active", isLive);
      scheduleSnapshotRefresh();
      if (isLive && !liveEnabled) startLive();
      if (!isLive) refreshSnapshot();
      requestAnimationFrame(layoutCameraMedia);
    }

    function stopLive() {
      liveEnabled = false;
      liveBytes = 0;
      if (liveSocket) liveSocket.close();
      liveSocket = null;
      sourceBuffer = null;
      pendingSegments = [];
      if (video.srcObject) {
        video.srcObject.getTracks().forEach((track) => track.stop());
      }
      video.srcObject = null;
      video.removeAttribute("src");
      if (mediaSource && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {}
      }
      mediaSource = null;
      if (sourceObjectUrl) {
        URL.revokeObjectURL(sourceObjectUrl);
        sourceObjectUrl = "";
      }
      liveConnect.textContent = "Starta live";
      updateLiveStatus("MSE stoppad");
    }

    async function startLive() {
      stopLive();
      liveEnabled = true;
      liveConnect.textContent = "Stoppa live";
      updateLiveStatus("Ansluter MSE...");
      video.muted = !audioEnabled;
      video.volume = Number(liveVolume.value) / 100;
      const MediaSourceCtor = window.ManagedMediaSource || window.MediaSource;
      if (!MediaSourceCtor) {
        updateLiveStatus("MSE saknas i browsern");
        return;
      }
      const supportedCodecs = ["avc1.640029", "avc1.64002A", "avc1.640033", "hvc1.1.6.L153.B0", "mp4a.40.2", "mp4a.40.5", "flac", "opus"]
        .filter((codec) => MediaSourceCtor.isTypeSupported(`video/mp4; codecs="${codec}"`))
        .join();
      if (!supportedCodecs) {
        updateLiveStatus("Inga MSE-codecs stöds");
        return;
      }
      mediaSource = new MediaSourceCtor();
      if (window.ManagedMediaSource && mediaSource instanceof window.ManagedMediaSource) {
        video.disableRemotePlayback = true;
        video.srcObject = mediaSource;
      } else {
        sourceObjectUrl = URL.createObjectURL(mediaSource);
        video.src = sourceObjectUrl;
      }
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      liveSocket = new WebSocket(`${proto}://${window.location.host}/api/camera/frigate/live/mse/api/ws?src=yard_main`);
      liveSocket.binaryType = "arraybuffer";
      let mseCodecsSent = false;
      const requestMseStream = () => {
        if (mseCodecsSent || !liveSocket || liveSocket.readyState !== WebSocket.OPEN || !mediaSource || mediaSource.readyState !== "open") return;
        mseCodecsSent = true;
        liveSocket.send(JSON.stringify({ type: "mse", value: supportedCodecs }));
        updateLiveStatus("MSE codecs skickade");
      };
      const appendNextSegment = () => {
        if (!sourceBuffer || sourceBuffer.updating || pendingSegments.length === 0) return;
        try {
          sourceBuffer.appendBuffer(pendingSegments.shift());
        } catch {
          updateLiveStatus("MSE append fel");
        }
      };
      liveSocket.addEventListener("open", () => {
        updateLiveStatus("MSE WS öppen");
        requestMseStream();
      });
      mediaSource.addEventListener("sourceopen", () => {
        requestMseStream();
      }, { once: true });
      liveSocket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);
          if (message.type !== "mse") return;
          try {
            sourceBuffer = mediaSource.addSourceBuffer(message.value);
            if (sourceBuffer.mode) sourceBuffer.mode = "segments";
            sourceBuffer.addEventListener("updateend", appendNextSegment);
            updateLiveStatus("MSE buffer klar");
            video.play().catch(() => {});
          } catch {
            updateLiveStatus("MSE codec fel");
          }
          return;
        }
        liveBytes += event.data.byteLength || 0;
        pendingSegments.push(event.data);
        appendNextSegment();
        if (liveBytes < 1024 * 1024 || liveBytes % (1024 * 1024) < 65536) {
          updateLiveStatus("MSE data");
        }
        video.play().catch(() => {});
      });
      liveSocket.addEventListener("close", () => {
        if (liveEnabled) updateLiveStatus("MSE stängd");
      });
      liveSocket.addEventListener("error", () => {
        updateLiveStatus("MSE fel");
      });
    }

    snapshotMode.addEventListener("click", () => setMode("snapshot"));
    liveMode.addEventListener("click", () => setMode("live"));
    liveConnect.addEventListener("click", () => {
      if (liveEnabled) stopLive();
      else startLive();
    });
    liveAudio.addEventListener("click", () => {
      audioEnabled = !audioEnabled;
      video.muted = !audioEnabled;
      liveAudio.textContent = audioEnabled ? "Ljud på" : "Ljud av";
      video.play().catch(() => {});
    });
    liveVolume.addEventListener("input", () => {
      video.volume = Number(liveVolume.value) / 100;
    });
    live.addEventListener("load", layoutCameraMedia);
    video.addEventListener("loadedmetadata", () => {
      layoutCameraMedia();
      updateLiveStatus("Video metadata");
    });
    video.addEventListener("playing", () => updateLiveStatus("Video spelar"));
    video.addEventListener("resize", () => {
      layoutCameraMedia();
      updateLiveStatus("Video storlek");
    });
    window.addEventListener("resize", layoutCameraMedia);
    installFrameGestures(frame);
    installFrameGestures(liveFrame);

    applyCameraZoom();
    applyRefresh(refreshMs);
    loadCameraSettings().catch(() => {});
  </script>
</body>
</html>"#;
    send_response(stream, 200, "text/html; charset=utf-8", body.as_bytes())
}

fn resolve_host_static_path(path: &str) -> io::Result<PathBuf> {
    let root = PathBuf::from("dist").canonicalize()?;
    let relative = if path == "/" || path == "/index.html" {
        safe_relative_path("index.html")?
    } else {
        safe_relative_path(path.trim_start_matches('/'))?
    };
    let canonical = root.join(relative).canonicalize()?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Err(invalid_request("static file is outside dist root"));
    }
    Ok(canonical)
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
            if bridge_subscriber_count(state)? > 0 {
                if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                    return send_error(stream, 409, &err.to_string());
                }
                let emulator = lock_bridge_emulator(state)?;
                if emulator.bus.rom.is_empty() {
                    return send_error(stream, 409, "no ROM loaded");
                }
                return send_json(stream, &bridge_frame_without_run(&emulator));
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
            if bridge_subscriber_count(state)? > 0 {
                if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                    return send_error(stream, 409, &err.to_string());
                }
                let emulator = lock_bridge_emulator(state)?;
                if emulator.bus.rom.is_empty() {
                    return send_error(stream, 409, "no ROM loaded");
                }
                return send_response(
                    stream,
                    200,
                    "application/octet-stream",
                    &bridge_frame_snapshot_bytes(&emulator),
                );
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
            if bridge_subscriber_count(state)? > 0 {
                if let Err(err) = touch_bridge_player(state, &client_id, player_index) {
                    return send_error(stream, 409, &err.to_string());
                }
                if let Some(bytes) = latest_bridge_packet(state)? {
                    return send_response(stream, 200, "application/octet-stream", &bytes);
                }
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
            let audio_only = query_string_value(&request.path, "video")?.as_deref() == Some("0");
            let player_index = if spectator {
                None
            } else {
                let player_index = bridge_player_index(&request)?;
                if let Err(err) = claim_bridge_player(state, &client_id, route_user, player_index) {
                    return send_error(stream, 409, &err.to_string());
                }
                Some(player_index)
            };
            bridge_stream_frame_audio(stream, state, client_id, player_index, audio_only)
        }
        ("GET", "/stream-video.mp4") => bridge_stream_video_mp4(stream, state),
        ("POST", "/webrtc/offer") => bridge_webrtc_offer(stream, state, request, route_user),
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
            let mut input: BridgeInput = serde_json::from_slice(&request.body)
                .map_err(|err| invalid_request(err.to_string()))?;
            input.player = Some((player_index + 1) as u8);
            store_bridge_input(state, input)?;
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
        ("POST", "/eutherdogs/reset-money") => {
            let mut dogs = state
                .eutherdogs
                .lock()
                .map_err(|err| io::Error::other(err.to_string()))?;
            let frame = dogs.reset_money();
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

fn empty_bridge_inputs() -> [BridgeInput; 2] {
    [empty_bridge_input(0), empty_bridge_input(1)]
}

fn empty_bridge_input(player_index: usize) -> BridgeInput {
    BridgeInput {
        player: Some((player_index + 1) as u8),
        up: false,
        down: false,
        left: false,
        right: false,
        a: false,
        b: false,
        c: false,
        start: false,
    }
}

fn store_bridge_input(state: &BridgeState, input: BridgeInput) -> io::Result<()> {
    let player_index = if input.player == Some(2) { 1 } else { 0 };
    let mut latest = state
        .latest_input
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    latest[player_index] = input;
    Ok(())
}

fn latest_bridge_inputs(state: &BridgeState) -> io::Result<[BridgeInput; 2]> {
    state
        .latest_input
        .lock()
        .map(|inputs| *inputs)
        .map_err(|err| io::Error::other(err.to_string()))
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
            .is_some_and(|lease| now.duration_since(lease.updated) > HOST_PLAYER_LEASE_TIMEOUT)
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
            drop(slots);
            clear_bridge_input(state, player_index)?;
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
        drop(slots);
        clear_bridge_input(state, player_index)?;
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
    let mut latest_input = state
        .latest_input
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *latest_input = empty_bridge_inputs();
    let (packet, condvar) = &*state.latest_packet;
    let mut packet = packet
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *packet = None;
    condvar.notify_all();
    let (audio, condvar) = &*state.latest_audio;
    let mut audio = audio
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *audio = None;
    condvar.notify_all();
    let (video, condvar) = &*state.latest_video;
    let mut video = video
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *video = None;
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
    let (audio, condvar) = &*state.latest_audio;
    let mut audio = audio
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *audio = None;
    condvar.notify_all();
    let (video, condvar) = &*state.latest_video;
    let mut video = video
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *video = None;
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
        .is_some_and(|lease| now.duration_since(lease.updated) > HOST_PLAYER_LEASE_TIMEOUT)
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

fn publish_bridge_audio(
    state: &BridgeState,
    pcm: Vec<u8>,
    frame: u32,
    stopped: bool,
) -> io::Result<()> {
    let (audio, condvar) = &*state.latest_audio;
    let mut audio = audio
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *audio = Some(BridgeAudioSnapshot {
        frame,
        pcm,
        stopped,
    });
    condvar.notify_all();
    Ok(())
}

fn publish_bridge_video(
    state: &BridgeState,
    rgb: Vec<u8>,
    width: usize,
    height: usize,
    frame: u32,
    stopped: bool,
) -> io::Result<()> {
    let (video, condvar) = &*state.latest_video;
    let mut video = video
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    *video = Some(BridgeVideoSnapshot {
        frame,
        rgb,
        width,
        height,
        published_unix_ms: unix_ms_now(),
        stopped,
    });
    condvar.notify_all();
    Ok(())
}

fn next_bridge_video_snapshot(
    state: &BridgeState,
    last_frame: u32,
    stop: &AtomicBool,
) -> io::Result<Option<BridgeVideoSnapshot>> {
    let (video_lock, condvar) = &*state.latest_video;
    let mut video = video_lock
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    while video
        .as_ref()
        .is_none_or(|snapshot| snapshot.frame == last_frame)
    {
        if stop.load(Ordering::SeqCst) || state.shutdown.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let wait = condvar
            .wait_timeout(video, Duration::from_millis(250))
            .map_err(|err| io::Error::other(err.to_string()))?;
        video = wait.0;
        if wait.1.timed_out()
            && (stop.load(Ordering::SeqCst) || state.shutdown.load(Ordering::SeqCst))
        {
            return Ok(None);
        }
    }
    Ok(video.as_ref().map(|snapshot| BridgeVideoSnapshot {
        frame: snapshot.frame,
        rgb: snapshot.rgb.clone(),
        width: snapshot.width,
        height: snapshot.height,
        published_unix_ms: snapshot.published_unix_ms,
        stopped: snapshot.stopped,
    }))
}

fn next_bridge_video_start_frame(state: &BridgeState) -> io::Result<u32> {
    let emulator_frame = {
        let emulator = lock_bridge_emulator(state)?;
        emulator.frame_count.min(u32::MAX as u64) as u32
    };
    let (video_lock, _) = &*state.latest_video;
    let latest_frame = video_lock
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?
        .as_ref()
        .map(|snapshot| snapshot.frame);
    Ok(latest_frame
        .filter(|frame| *frame >= emulator_frame)
        .unwrap_or(emulator_frame))
}

fn latest_bridge_packet(state: &BridgeState) -> io::Result<Option<Vec<u8>>> {
    let (packet, _) = &*state.latest_packet;
    packet
        .lock()
        .map(|packet| packet.as_ref().map(|snapshot| snapshot.bytes.clone()))
        .map_err(|err| io::Error::other(err.to_string()))
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
    let mut pending_audio = Vec::new();
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
        let (packet, audio, video, video_width, video_height, frame, stopped) = {
            let mut emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                break Ok(());
            }
            let inputs = latest_bridge_inputs(state)?;
            for input in inputs {
                apply_bridge_input(&mut emulator, input);
            }
            let run = emulator.run_frame();
            let frame_audio = emulator.render_audio_frame_i16_stereo(44_100);
            pending_audio.extend_from_slice(&frame_audio);
            let stopped = run.hit_unsupported_opcode;
            let frame = emulator.frame_count.min(u32::MAX as u64) as u32;
            let (video_width, video_height) = {
                let (width, height) = emulator.frame_size();
                bridge_video_output_size(width, height)
            };
            let mut video = Vec::with_capacity(video_width * video_height * 3);
            push_frame_rgb24_visible(&mut video, &emulator);
            let should_publish = stopped || emulator.frame_count % BRIDGE_STREAM_VIDEO_DIVISOR == 0;
            let packet = should_publish
                .then(|| bridge_frame_audio_samples_bytes(&emulator, &run, 44_100, &pending_audio));
            let mut audio = Vec::with_capacity(frame_audio.len() * 2);
            for sample in frame_audio {
                audio.extend_from_slice(&sample.to_le_bytes());
            }
            (
                packet,
                audio,
                video,
                video_width,
                video_height,
                frame,
                stopped,
            )
        };
        publish_bridge_video(state, video, video_width, video_height, frame, stopped)?;
        publish_bridge_audio(state, audio, frame, stopped)?;
        if let Some(packet) = packet {
            pending_audio.clear();
            publish_bridge_packet(state, packet, frame, stopped)?;
        }
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
    let frame_time = Duration::from_secs_f64(1.0 / EUTHERDOGS_SERVER_PUBLISH_HZ);
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
            dogs.tick_held_steps(EUTHERDOGS_TICKS_PER_PUBLISH)
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

    let raw_social_attachment_upload =
        method == "POST" && path.split('?').next() == Some("/api/social/attachments/raw");
    if !raw_social_attachment_upload {
        while data.len() < header_end + content_length {
            let read = stream.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            data.extend_from_slice(&buffer[..read]);
        }
    }

    Ok(HttpRequest {
        method,
        path,
        headers: request_headers,
        body: data[header_end..header_end + content_length.min(data.len() - header_end)].to_vec(),
        content_length,
    })
}

fn send_json(stream: &mut TcpStream, value: &impl Serialize) -> io::Result<()> {
    let body = serde_json::to_vec(value).map_err(|err| invalid_request(err.to_string()))?;
    send_response(stream, 200, "application/json", &body)
}

fn send_empty(stream: &mut TcpStream, status: u16) -> io::Result<()> {
    send_response(stream, status, "text/plain", &[])
}

fn send_redirect(stream: &mut TcpStream, status: u16, location: &str) -> io::Result<()> {
    send_response_with_headers(
        stream,
        status,
        "text/plain; charset=utf-8",
        b"",
        &[("Location", location)],
    )
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
    let cors_origin = response_cors_origin();
    let reason = match status {
        200 => "OK",
        303 => "See Other",
        308 => "Permanent Redirect",
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
        Access-Control-Allow-Origin: {cors_origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name, X-CSRF-Token, X-Euther-App-Token, Authorization\r\n\
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
    let cors_origin = response_cors_origin();
    write!(
        stream,
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: {cors_origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name, X-CSRF-Token, X-Euther-App-Token, Authorization\r\n\
         Access-Control-Allow-Credentials: true\r\n\
         Access-Control-Expose-Headers: Content-Type\r\n\
         Cache-Control: no-store\r\n\
         Content-Type: {content_type}\r\n\
         Connection: close\r\n\r\n",
    )
}

fn send_event_stream_header(stream: &mut TcpStream) -> io::Result<()> {
    let cors_origin = response_cors_origin();
    write!(
        stream,
        "HTTP/1.1 200 OK\r\n\
         Access-Control-Allow-Origin: {cors_origin}\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, X-Rom-Name, X-CSRF-Token, X-Euther-App-Token, Authorization\r\n\
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
    let mut full_refresh_countdown = 0u16;
    let mut last_tiles_signature = None;
    let mut last_visibility_signature = None;
    let mut last_store_signature = None;
    let mut last_actor_signatures = HashMap::<String, u64>::new();
    let mut last_bullet_signatures = HashMap::<u32, u64>::new();
    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        touch_eutherdogs_poll(state)?;
        let frame = latest_eutherdogs_frame(state, player_index)?;
        if Some(frame.frame) != last_frame {
            let tiles_signature = eutherdogs_tiles_signature(&frame.tiles);
            let visibility_signature = eutherdogs_visibility_signature(&frame.visibility);
            let store_signature = eutherdogs_store_signature(&frame.store);
            let include_all = last_frame.is_none() || full_refresh_countdown == 0;
            let include_tiles = include_all || last_tiles_signature != Some(tiles_signature);
            let include_visibility =
                include_all || last_visibility_signature != Some(visibility_signature);
            let include_store = include_all || last_store_signature != Some(store_signature);
            let actor_delta = eutherdogs_actor_delta(&frame.characters, &last_actor_signatures);
            let bullet_delta = eutherdogs_bullet_delta(&frame.bullets, &last_bullet_signatures);
            let payload = eutherdogs_stream_payload(
                state,
                &frame,
                player_index,
                include_all,
                include_tiles,
                include_visibility,
                include_store,
                &actor_delta,
                &bullet_delta,
            )?;
            if write!(stream, "data: {payload}\n\n").is_err() {
                break Ok(());
            }
            if stream.flush().is_err() {
                break Ok(());
            }
            last_frame = Some(frame.frame);
            if include_tiles {
                last_tiles_signature = Some(tiles_signature);
            }
            if include_visibility {
                last_visibility_signature = Some(visibility_signature);
            }
            if include_store {
                last_store_signature = Some(store_signature);
            }
            last_actor_signatures = actor_delta.next_signatures;
            last_bullet_signatures = bullet_delta.next_signatures;
            full_refresh_countdown = if include_all {
                EUTHERDOGS_STATIC_REFRESH_FRAMES
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
    include_dimensions: bool,
    include_tiles: bool,
    include_visibility: bool,
    include_store: bool,
    actor_delta: &EutherDogsActorDelta,
    bullet_delta: &EutherDogsBulletDelta,
) -> io::Result<String> {
    let acked_input_seq = state
        .eutherdogs_input_seq
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?[player_index];
    let mut value = serde_json::json!({
        "frame": frame.frame,
        "compact": 1,
        "d": frame.inspection_dialogues.iter().map(|dialogue| serde_json::json!([
            dialogue.player,
            dialogue.inspector_id,
            dialogue.question,
            dialogue.complete,
        ])).collect::<Vec<_>>(),
        "s": [
            frame.summary.mission,
            frame.summary.max_mission,
            serde_json::json!(frame.summary.status),
            serde_json::json!(frame.summary.elapsed_ticks),
            serde_json::json!(frame.summary.score),
            serde_json::json!(frame.summary.cash),
            serde_json::json!(frame.summary.kills),
            serde_json::json!(frame.summary.targets_destroyed),
            serde_json::json!(frame.summary.objects_collected),
            serde_json::json!(frame.summary.shots_fired),
            serde_json::json!(frame.summary.hits),
            serde_json::json!(frame.summary.damage_taken),
            serde_json::json!(frame.summary.targets_left),
            serde_json::json!(frame.summary.objects_left),
            serde_json::json!(frame.summary.minimum_kills),
            serde_json::json!(frame.summary.time_remaining_ticks),
            serde_json::json!(frame.summary.boss_active),
            serde_json::json!(frame.summary.boss_name),
            serde_json::json!(frame.summary.boss_armor),
            serde_json::json!(frame.summary.boss_max_armor),
            serde_json::json!(frame.summary.routine_read),
            serde_json::json!(frame.summary.routine_total),
            serde_json::json!(frame.summary.inspection_answers),
            serde_json::json!(frame.summary.inspection_protocol),
        ],
        "a": frame.audio_events,
        "h": frame.highscore_count,
        "q": acked_input_seq,
    });
    if include_dimensions {
        value["c"] = serde_json::json!(
            frame
                .characters
                .iter()
                .map(eutherdogs_actor_row)
                .collect::<Vec<_>>()
        );
        value["b"] = serde_json::json!(
            frame
                .bullets
                .iter()
                .map(eutherdogs_bullet_row)
                .collect::<Vec<_>>()
        );
    } else {
        if !actor_delta.changed_rows.is_empty() {
            value["ac"] = serde_json::json!(actor_delta.changed_rows);
        }
        if !actor_delta.removed_keys.is_empty() {
            value["ar"] = serde_json::json!(actor_delta.removed_keys);
        }
        if !bullet_delta.changed_rows.is_empty() {
            value["bc"] = serde_json::json!(bullet_delta.changed_rows);
        }
        if !bullet_delta.removed_ids.is_empty() {
            value["br"] = serde_json::json!(bullet_delta.removed_ids);
        }
    }
    if include_dimensions {
        value["width"] = serde_json::json!(frame.width);
        value["height"] = serde_json::json!(frame.height);
        value["tileWidth"] = serde_json::json!(frame.tile_width);
        value["tileHeight"] = serde_json::json!(frame.tile_height);
        value["characterWidth"] = serde_json::json!(frame.character_width);
        value["characterHeight"] = serde_json::json!(frame.character_height);
    }
    if include_tiles {
        value["tiles"] = serde_json::json!(frame.tiles);
    }
    if include_visibility {
        value["visibility"] = serde_json::json!(frame.visibility);
    }
    if include_store {
        value["store"] = serde_json::json!(frame.store);
    }
    serde_json::to_string(&value).map_err(|err| io::Error::other(err.to_string()))
}

struct EutherDogsActorDelta {
    changed_rows: Vec<serde_json::Value>,
    removed_keys: Vec<String>,
    next_signatures: HashMap<String, u64>,
}

struct EutherDogsBulletDelta {
    changed_rows: Vec<serde_json::Value>,
    removed_ids: Vec<u32>,
    next_signatures: HashMap<u32, u64>,
}

fn eutherdogs_actor_delta(
    actors: &[euther_oxide::eutherdogs::EutherDogsActor],
    previous: &HashMap<String, u64>,
) -> EutherDogsActorDelta {
    let mut changed_rows = Vec::new();
    let mut next_signatures = HashMap::new();
    for actor in actors {
        let key = eutherdogs_actor_key(actor);
        let signature = eutherdogs_actor_signature(actor);
        if previous.get(&key) != Some(&signature) {
            changed_rows.push(eutherdogs_actor_row(actor));
        }
        next_signatures.insert(key, signature);
    }
    let removed_keys = previous
        .keys()
        .filter(|key| !next_signatures.contains_key(*key))
        .cloned()
        .collect();
    EutherDogsActorDelta {
        changed_rows,
        removed_keys,
        next_signatures,
    }
}

fn eutherdogs_bullet_delta(
    bullets: &[euther_oxide::eutherdogs::EutherDogsBullet],
    previous: &HashMap<u32, u64>,
) -> EutherDogsBulletDelta {
    let mut changed_rows = Vec::new();
    let mut next_signatures = HashMap::new();
    for bullet in bullets {
        let signature = eutherdogs_bullet_signature(bullet);
        if previous.get(&bullet.id) != Some(&signature) {
            changed_rows.push(eutherdogs_bullet_row(bullet));
        }
        next_signatures.insert(bullet.id, signature);
    }
    let removed_ids = previous
        .keys()
        .filter(|id| !next_signatures.contains_key(*id))
        .copied()
        .collect();
    EutherDogsBulletDelta {
        changed_rows,
        removed_ids,
        next_signatures,
    }
}

fn eutherdogs_actor_key(actor: &euther_oxide::eutherdogs::EutherDogsActor) -> String {
    format!("{}:{}", actor.faction, actor.id)
}

fn eutherdogs_actor_row(actor: &euther_oxide::eutherdogs::EutherDogsActor) -> serde_json::Value {
    serde_json::json!([
        actor.id,
        actor.faction,
        actor.x,
        actor.y,
        actor.direction,
        actor.sprite,
        actor.armor,
        actor.lives,
        actor.alive,
        actor.active_weapon,
        actor.ammo,
    ])
}

fn eutherdogs_bullet_row(bullet: &euther_oxide::eutherdogs::EutherDogsBullet) -> serde_json::Value {
    serde_json::json!([
        bullet.id,
        bullet.x,
        bullet.y,
        bullet.dx,
        bullet.dy,
        bullet.owner_faction,
        bullet.weapon,
    ])
}

fn eutherdogs_actor_signature(actor: &euther_oxide::eutherdogs::EutherDogsActor) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    actor.id.hash(&mut hasher);
    actor.faction.hash(&mut hasher);
    actor.x.hash(&mut hasher);
    actor.y.hash(&mut hasher);
    actor.direction.hash(&mut hasher);
    actor.sprite.hash(&mut hasher);
    actor.armor.hash(&mut hasher);
    actor.lives.hash(&mut hasher);
    actor.alive.hash(&mut hasher);
    actor.active_weapon.hash(&mut hasher);
    actor.ammo.hash(&mut hasher);
    hasher.finish()
}

fn eutherdogs_bullet_signature(bullet: &euther_oxide::eutherdogs::EutherDogsBullet) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bullet.id.hash(&mut hasher);
    bullet.x.hash(&mut hasher);
    bullet.y.hash(&mut hasher);
    bullet.dx.hash(&mut hasher);
    bullet.dy.hash(&mut hasher);
    bullet.owner_faction.hash(&mut hasher);
    bullet.weapon.hash(&mut hasher);
    hasher.finish()
}

fn eutherdogs_tiles_signature(tiles: &[&'static str]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    tiles.hash(&mut hasher);
    hasher.finish()
}

fn eutherdogs_visibility_signature(visibility: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    visibility.hash(&mut hasher);
    hasher.finish()
}

fn eutherdogs_store_signature(store: &[euther_oxide::eutherdogs::EutherDogsStoreItem]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for item in store {
        item.id.hash(&mut hasher);
        item.label.hash(&mut hasher);
        item.price.hash(&mut hasher);
        item.detail.hash(&mut hasher);
        item.weapon.hash(&mut hasher);
        item.ammo.hash(&mut hasher);
        item.armor.hash(&mut hasher);
        item.owned.hash(&mut hasher);
        item.current_ammo.hash(&mut hasher);
        item.active.hash(&mut hasher);
        item.affordable.hash(&mut hasher);
    }
    hasher.finish()
}

fn bridge_stream_frame_audio(
    stream: &mut TcpStream,
    state: &BridgeState,
    client_id: String,
    player_index: Option<usize>,
    audio_only: bool,
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
    let result = bridge_stream_subscriber(stream, state, &client_id, player_index, audio_only);
    remove_bridge_subscriber(state)?;
    if let Some(player_index) = player_index {
        release_bridge_player(state, &client_id, player_index)?;
    }
    result
}

fn bridge_stream_video_mp4(stream: &mut TcpStream, state: &BridgeState) -> io::Result<()> {
    let (width, height, frame_rate) = {
        let emulator = lock_bridge_emulator(state)?;
        if emulator.bus.rom.is_empty() {
            return send_error(stream, 409, "no ROM loaded");
        }
        let (width, height) = emulator.frame_size();
        let (_, output_height) = bridge_video_output_size(width, height);
        (width, output_height, emulator.frame_rate().min(30.0))
    };

    let mut child = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            &format!("{width}x{height}"),
            "-r",
            &format!("{frame_rate:.3}"),
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "baseline",
            "-pix_fmt",
            "yuv420p",
            "-g",
            "30",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
            "-bf",
            "0",
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| io::Error::other(format!("ffmpeg unavailable: {err}")))?;

    stream.set_nodelay(true)?;
    send_stream_header(stream, "video/mp4")?;
    add_bridge_subscriber(state)?;
    if let Err(err) = ensure_bridge_runner(state) {
        remove_bridge_subscriber(state)?;
        let _ = child.kill();
        let _ = child.wait();
        return Err(err);
    }

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg stdout unavailable"))?;
    let mut output = stream.try_clone()?;
    let output_thread = thread::spawn(move || io::copy(&mut stdout, &mut output));
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg stdin unavailable"))?;
    let frame_time = Duration::from_secs_f64(1.0 / frame_rate.max(1.0));
    let mut rgb = Vec::with_capacity(width * height * 3);

    let result = loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        rgb.clear();
        {
            let emulator = lock_bridge_emulator(state)?;
            if emulator.bus.rom.is_empty() {
                break Ok(());
            }
            push_frame_rgb24_visible(&mut rgb, &emulator);
        }
        if let Err(err) = stdin.write_all(&rgb) {
            if err.kind() == io::ErrorKind::BrokenPipe {
                break Ok(());
            }
            break Err(err);
        }
        thread::sleep(frame_time);
    };

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let _ = output_thread.join();
    remove_bridge_subscriber(state)?;
    result
}

fn bridge_webrtc_offer(
    stream: &mut TcpStream,
    state: &BridgeState,
    request: HttpRequest,
    user: &str,
) -> io::Result<()> {
    let spectator = query_string_value(&request.path, "role")?.as_deref() == Some("spectator");
    let heartbeat = if spectator {
        None
    } else {
        let client_id = bridge_client_id(&request)?;
        let player_index = bridge_player_index(&request)?;
        claim_bridge_player(state, &client_id, user, player_index)?;
        Some((state.clone(), client_id, player_index))
    };
    let offer: webrtc::peer_connection::sdp::session_description::RTCSessionDescription =
        serde_json::from_slice(&request.body).map_err(|err| invalid_request(err.to_string()))?;
    let video_target_fps = Arc::new(AtomicU32::new(WEBRTC_VIDEO_FPS as u32));
    let video_stable_ticks = Arc::new(AtomicU32::new(0));
    let video_target_for_channel = Arc::clone(&video_target_fps);
    let video_stable_for_channel = Arc::clone(&video_stable_ticks);

    let (peer, answer, video_track, audio_track, stop) =
        state.webrtc_runtime.block_on(async move {
        let mut media_engine = webrtc::api::media_engine::MediaEngine::default();
        media_engine
            .register_default_codecs()
            .map_err(|err| io::Error::other(err.to_string()))?;
        let udp = ice::udp_network::EphemeralUDP::new(WEBRTC_UDP_PORT_MIN, WEBRTC_UDP_PORT_MAX)
            .map_err(|err| io::Error::other(err.to_string()))?;
        let mut settings = webrtc::api::setting_engine::SettingEngine::default();
        settings.set_udp_network(ice::udp_network::UDPNetwork::Ephemeral(udp));
        settings.set_network_types(vec![ice::network_type::NetworkType::Udp4]);
        let api = webrtc::api::APIBuilder::new()
            .with_media_engine(media_engine)
            .with_setting_engine(settings)
            .build();
        let config = webrtc::peer_connection::configuration::RTCConfiguration {
            ice_servers: vec![webrtc::ice_transport::ice_server::RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_string()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let peer = Arc::new(
            api.new_peer_connection(config)
                .await
                .map_err(|err| io::Error::other(err.to_string()))?,
        );
        let video_track = Arc::new(
            webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample::new(
                webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                    mime_type: webrtc::api::media_engine::MIME_TYPE_H264.to_owned(),
                    clock_rate: 90_000,
                    sdp_fmtp_line:
                        "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                            .to_string(),
                    ..Default::default()
                },
                "megadrive-video".to_string(),
                "eutheroxide".to_string(),
            ),
        );
        let video_sender = peer
            .add_track(
                Arc::clone(&video_track)
                    as Arc<dyn webrtc::track::track_local::TrackLocal + Send + Sync>,
            )
            .await
            .map_err(|err| io::Error::other(err.to_string()))?;
        tokio::spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while video_sender.read(&mut rtcp_buf).await.is_ok() {}
        });
        let audio_track = Arc::new(
            webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample::new(
                webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
                    mime_type: webrtc::api::media_engine::MIME_TYPE_OPUS.to_owned(),
                    clock_rate: 48_000,
                    channels: 2,
                    ..Default::default()
                },
                "megadrive-audio".to_string(),
                "eutheroxide".to_string(),
            ),
        );
        let audio_sender = peer
            .add_track(
                Arc::clone(&audio_track)
                    as Arc<dyn webrtc::track::track_local::TrackLocal + Send + Sync>,
            )
            .await
            .map_err(|err| io::Error::other(err.to_string()))?;
        tokio::spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while audio_sender.read(&mut rtcp_buf).await.is_ok() {}
        });

        peer.on_data_channel(Box::new(
            move |channel: Arc<webrtc::data_channel::RTCDataChannel>| {
                let heartbeat = heartbeat.clone();
                let video_target_fps = Arc::clone(&video_target_for_channel);
                let video_stable_ticks = Arc::clone(&video_stable_for_channel);
                Box::pin(async move {
                    let reply_channel = Arc::clone(&channel);
                    let last_input_seq = Arc::new(AtomicU32::new(0));
                    channel.on_message(Box::new(
                        move |message: webrtc::data_channel::data_channel_message::DataChannelMessage| {
                            let reply_channel = Arc::clone(&reply_channel);
                            let heartbeat = heartbeat.clone();
                            let last_input_seq = Arc::clone(&last_input_seq);
                            let video_target_fps = Arc::clone(&video_target_fps);
                            let video_stable_ticks = Arc::clone(&video_stable_ticks);
                            Box::pin(async move {
                                if message.is_string {
                                    let text = String::from_utf8_lossy(&message.data);
                                    if text.trim() == "ping" {
                                        if let Some((state, client_id, player_index)) = &heartbeat {
                                            let _ = touch_bridge_player(state, client_id, *player_index);
                                        }
                                        let _ = reply_channel.send_text("pong").await;
                                        return;
                                    }
                                    match serde_json::from_str::<BridgeDataChannelMessage>(&text) {
                                        Ok(BridgeDataChannelMessage::Input { seq, mut input }) => {
                                            if seq > last_input_seq.load(Ordering::SeqCst) {
                                                last_input_seq.store(seq, Ordering::SeqCst);
                                                if let Some((state, client_id, player_index)) =
                                                    &heartbeat
                                                {
                                                    input.player =
                                                        Some((*player_index + 1) as u8);
                                                    let result =
                                                        touch_bridge_player(
                                                            state,
                                                            client_id,
                                                            *player_index,
                                                        )
                                                        .and_then(|_| {
                                                            store_bridge_input(state, input)
                                                        });
                                                    if let Err(err) = result {
                                                        let _ = reply_channel
                                                            .send_text(format!("input-error:{err}"))
                                                            .await;
                                                    }
                                                }
                                            }
                                        }
                                        Ok(BridgeDataChannelMessage::VideoStats { stats }) => {
                                            if let Some(next_fps) =
                                                adapt_webrtc_video_fps(&video_target_fps, &video_stable_ticks, stats)
                                            {
                                                let _ = reply_channel
                                                    .send_text(format!("video-fps:{next_fps}"))
                                                    .await;
                                            }
                                        }
                                        Err(_) => {
                                            let _ = reply_channel.send_text("ack").await;
                                        }
                                    }
                                }
                            })
                        },
                    ));
                })
            },
        ));
        let video_stop = Arc::new(AtomicBool::new(false));
        let video_stop_for_state = Arc::clone(&video_stop);
        peer.on_peer_connection_state_change(Box::new(move |state| {
            let video_stop = Arc::clone(&video_stop_for_state);
            Box::pin(async move {
                use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
                if matches!(
                    state,
                    RTCPeerConnectionState::Disconnected
                        | RTCPeerConnectionState::Failed
                        | RTCPeerConnectionState::Closed
                ) {
                    video_stop.store(true, Ordering::SeqCst);
                }
            })
        }));

        peer.set_remote_description(offer)
            .await
            .map_err(|err| io::Error::other(err.to_string()))?;
        let answer = peer
            .create_answer(None)
            .await
            .map_err(|err| io::Error::other(err.to_string()))?;
        let mut gathering_complete = peer.gathering_complete_promise().await;
        peer.set_local_description(answer)
            .await
            .map_err(|err| io::Error::other(err.to_string()))?;
        let _ = tokio::time::timeout(Duration::from_secs(2), gathering_complete.recv()).await;
        let answer = peer
            .local_description()
            .await
            .ok_or_else(|| io::Error::other("missing WebRTC answer"))?;
        Ok::<_, io::Error>((peer, answer, video_track, audio_track, video_stop))
    })?;
    spawn_bridge_webrtc_h264(
        state.clone(),
        video_track,
        Arc::clone(&stop),
        video_target_fps,
    );
    spawn_bridge_webrtc_opus(state.clone(), audio_track, Arc::clone(&stop));

    let mut peers = state
        .webrtc_peers
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    peers.retain(|peer| {
        let keep = peer.created.elapsed() < Duration::from_secs(180);
        if !keep {
            peer.stop.store(true, Ordering::SeqCst);
        }
        keep
    });
    peers.push(BridgeWebRtcPeer {
        _peer: peer,
        stop,
        created: Instant::now(),
    });
    send_json(stream, &answer)
}

fn spawn_bridge_webrtc_h264(
    state: BridgeState,
    track: Arc<webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample>,
    stop: Arc<AtomicBool>,
    target_fps: Arc<AtomicU32>,
) {
    let runtime = Arc::clone(&state.webrtc_runtime);
    thread::spawn(move || {
        if let Err(err) = bridge_webrtc_h264_loop(state, track, runtime, stop, target_fps) {
            eprintln!("webrtc h264 stream ended: {err}");
        }
    });
}

fn adapt_webrtc_video_fps(
    target_fps: &AtomicU32,
    stable_ticks: &AtomicU32,
    stats: BridgeVideoStats,
) -> Option<u32> {
    let current = target_fps.load(Ordering::SeqCst);
    let stressed = stats.dropped_delta > 0
        || stats.queue > 0
        || stats.jitter_ms > 42.0
        || stats.decode_ms > 12.0
        || stats.fps < current.saturating_sub(8) as f64;
    if stressed {
        stable_ticks.store(0, Ordering::SeqCst);
        let next = match current {
            56..=u32::MAX => 50,
            46..=55 => 45,
            41..=45 => 40,
            _ => WEBRTC_VIDEO_MIN_FPS,
        };
        if next != current {
            target_fps.store(next, Ordering::SeqCst);
            return Some(next);
        }
        return None;
    }

    let stable = stable_ticks.fetch_add(1, Ordering::SeqCst) + 1;
    if stable < WEBRTC_VIDEO_STABLE_TICKS_FOR_RAISE {
        return None;
    }
    stable_ticks.store(0, Ordering::SeqCst);
    let next = match current {
        0..=40 => 45,
        41..=45 => 50,
        46..=50 => WEBRTC_VIDEO_FPS as u32,
        _ => current,
    };
    if next != current {
        target_fps.store(next, Ordering::SeqCst);
        Some(next)
    } else {
        None
    }
}

fn spawn_bridge_webrtc_opus(
    state: BridgeState,
    track: Arc<webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample>,
    stop: Arc<AtomicBool>,
) {
    let runtime = Arc::clone(&state.webrtc_runtime);
    thread::spawn(move || {
        if let Err(err) = bridge_webrtc_opus_loop(state, track, runtime, stop) {
            eprintln!("webrtc opus stream ended: {err}");
        }
    });
}

fn bridge_webrtc_opus_loop(
    state: BridgeState,
    track: Arc<webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample>,
    runtime: Arc<tokio::runtime::Runtime>,
    stop: Arc<AtomicBool>,
) -> io::Result<()> {
    add_bridge_subscriber(&state)?;
    if let Err(err) = ensure_bridge_runner(&state) {
        remove_bridge_subscriber(&state)?;
        return Err(err);
    }

    let mut child = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-fflags",
            "nobuffer",
            "-f",
            "s16le",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-i",
            "pipe:0",
            "-vn",
            "-c:a",
            "libopus",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-application",
            "lowdelay",
            "-frame_duration",
            "20",
            "-vbr",
            "off",
            "-b:a",
            "96k",
            "-flush_packets",
            "1",
            "-f",
            "opus",
            "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| io::Error::other(format!("ffmpeg opus unavailable: {err}")))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg opus stdin unavailable"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg opus stdout unavailable"))?;

    let reader_stop = Arc::clone(&stop);
    let reader = thread::spawn(move || -> io::Result<()> {
        let sample_duration = Duration::from_millis(20);
        let mut read_buf = [0u8; 8 * 1024];
        let mut ogg_buf = Vec::new();
        let mut opus_packet = Vec::new();
        loop {
            if reader_stop.load(Ordering::SeqCst) {
                break Ok(());
            }
            let read = match stdout.read(&mut read_buf) {
                Ok(0) => break Ok(()),
                Ok(read) => read,
                Err(err) => break Err(err),
            };
            ogg_buf.extend_from_slice(&read_buf[..read]);
            for packet in drain_ogg_opus_packets(&mut ogg_buf, &mut opus_packet)? {
                if packet.starts_with(b"OpusHead") || packet.starts_with(b"OpusTags") {
                    continue;
                }
                let sample = media::Sample {
                    data: bytes::Bytes::from(packet),
                    duration: sample_duration,
                    ..Default::default()
                };
                if runtime.block_on(track.write_sample(&sample)).is_err() {
                    reader_stop.store(true, Ordering::SeqCst);
                    break;
                }
            }
        }
    });

    let result = bridge_webrtc_pcm_writer(&state, &mut stdin, Arc::clone(&stop));
    stop.store(true, Ordering::SeqCst);
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let reader_result = match reader.join() {
        Ok(result) => result,
        Err(_) => Err(io::Error::other("opus reader panicked")),
    };
    remove_bridge_subscriber(&state)?;
    result.and(reader_result)
}

fn bridge_webrtc_pcm_writer(
    state: &BridgeState,
    stdin: &mut impl Write,
    stop: Arc<AtomicBool>,
) -> io::Result<()> {
    let (audio_lock, condvar) = &*state.latest_audio;
    let mut last_frame = 0u32;
    loop {
        if stop.load(Ordering::SeqCst) || state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        let mut audio = audio_lock
            .lock()
            .map_err(|err| io::Error::other(err.to_string()))?;
        while audio
            .as_ref()
            .is_none_or(|snapshot| snapshot.frame == last_frame)
        {
            if stop.load(Ordering::SeqCst) || state.shutdown.load(Ordering::SeqCst) {
                return Ok(());
            }
            let wait = condvar
                .wait_timeout(audio, Duration::from_secs(2))
                .map_err(|err| io::Error::other(err.to_string()))?;
            audio = wait.0;
        }
        let Some(snapshot) = audio.as_ref() else {
            continue;
        };
        last_frame = snapshot.frame;
        let stopped = snapshot.stopped;
        let pcm = snapshot.pcm.clone();
        drop(audio);
        stdin.write_all(&pcm)?;
        if stopped {
            break Ok(());
        }
    }
}

fn drain_ogg_opus_packets(buffer: &mut Vec<u8>, current: &mut Vec<u8>) -> io::Result<Vec<Vec<u8>>> {
    let mut emitted = Vec::new();
    let mut offset = 0usize;
    while buffer.len().saturating_sub(offset) >= 27 {
        if &buffer[offset..offset + 4] != b"OggS" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bad ogg opus page",
            ));
        }
        let segments = buffer[offset + 26] as usize;
        let table_start = offset + 27;
        let body_start = table_start + segments;
        if buffer.len() < body_start {
            break;
        }
        let body_len: usize = buffer[table_start..body_start]
            .iter()
            .map(|&segment| segment as usize)
            .sum();
        let page_end = body_start + body_len;
        if buffer.len() < page_end {
            break;
        }
        let mut body_offset = body_start;
        for &segment in &buffer[table_start..body_start] {
            let next_offset = body_offset + segment as usize;
            current.extend_from_slice(&buffer[body_offset..next_offset]);
            body_offset = next_offset;
            if segment < 255 {
                emitted.push(std::mem::take(current));
            }
        }
        offset = page_end;
    }
    if offset > 0 {
        buffer.drain(..offset);
    }
    Ok(emitted)
}

fn bridge_webrtc_h264_loop(
    state: BridgeState,
    track: Arc<webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample>,
    runtime: Arc<tokio::runtime::Runtime>,
    stop: Arc<AtomicBool>,
    target_fps: Arc<AtomicU32>,
) -> io::Result<()> {
    {
        let emulator = lock_bridge_emulator(&state)?;
        if emulator.bus.rom.is_empty() {
            return Ok(());
        }
    }
    add_bridge_subscriber(&state)?;
    if let Err(err) = ensure_bridge_runner(&state) {
        remove_bridge_subscriber(&state)?;
        return Err(err);
    }
    let first_frame = next_bridge_video_start_frame(&state)?;
    let first_snapshot = match next_bridge_video_snapshot(&state, first_frame, &stop)? {
        Some(snapshot) => snapshot,
        None => {
            remove_bridge_subscriber(&state)?;
            return Ok(());
        }
    };
    let (width, height) = (first_snapshot.width, first_snapshot.height);

    let mut child = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            &format!("{width}x{height}"),
            "-r",
            &format!("{WEBRTC_VIDEO_FPS:.3}"),
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "superfast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "baseline",
            "-pix_fmt",
            "yuv420p",
            "-b:v",
            WEBRTC_VIDEO_BITRATE,
            "-maxrate",
            WEBRTC_VIDEO_MAXRATE,
            "-bufsize",
            WEBRTC_VIDEO_BUFSIZE,
            "-g",
            "60",
            "-keyint_min",
            "60",
            "-sc_threshold",
            "0",
            "-bf",
            "0",
            "-x264-params",
            "repeat-headers=1:aud=1:sliced-threads=1:slice-max-size=1100",
            "-f",
            "h264",
            "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|err| io::Error::other(format!("ffmpeg unavailable: {err}")))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg stdin unavailable"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("ffmpeg stdout unavailable"))?;
    let writer_state = state.clone();
    let writer_stop = Arc::clone(&stop);
    let writer_target_fps = Arc::clone(&target_fps);
    let pending_durations = Arc::new(Mutex::new(VecDeque::new()));
    let writer_durations = Arc::clone(&pending_durations);
    let writer = thread::spawn(move || {
        let mut pending_snapshot = Some(first_snapshot);
        let mut last_frame = 0u32;
        let mut last_encoded_frame = 0u32;
        let mut frame_budget = WEBRTC_VIDEO_FPS as u32;
        while !writer_stop.load(Ordering::SeqCst) {
            let snapshot = if let Some(snapshot) = pending_snapshot.take() {
                snapshot
            } else {
                match next_bridge_video_snapshot(&writer_state, last_frame, &writer_stop) {
                    Ok(Some(snapshot)) => snapshot,
                    Ok(None) => break,
                    Err(_) => break,
                }
            };
            last_frame = snapshot.frame;
            if snapshot.width != width || snapshot.height != height {
                break;
            }
            let target_fps = writer_target_fps
                .load(Ordering::SeqCst)
                .clamp(WEBRTC_VIDEO_MIN_FPS, WEBRTC_VIDEO_FPS as u32);
            frame_budget = frame_budget.saturating_add(target_fps);
            if frame_budget < WEBRTC_VIDEO_FPS as u32 {
                if snapshot.stopped {
                    break;
                }
                continue;
            }
            frame_budget -= WEBRTC_VIDEO_FPS as u32;
            let frame_delta = if last_encoded_frame == 0 {
                1
            } else {
                snapshot.frame.saturating_sub(last_encoded_frame).max(1)
            };
            last_encoded_frame = snapshot.frame;
            if let Ok(mut durations) = writer_durations.lock() {
                durations.push_back(Duration::from_secs_f64(
                    frame_delta as f64 / WEBRTC_VIDEO_FPS,
                ));
            }
            if stdin.write_all(&snapshot.rgb).is_err() {
                break;
            }
            if snapshot.stopped {
                break;
            }
        }
    });

    let sample_duration = Duration::from_secs_f64(1.0 / WEBRTC_VIDEO_FPS);
    let mut read_buf = [0u8; 16 * 1024];
    let mut h264_buf = Vec::new();
    let mut access_unit = Vec::new();
    let result = loop {
        if stop.load(Ordering::SeqCst) || state.shutdown.load(Ordering::SeqCst) {
            break Ok(());
        }
        let read = match stdout.read(&mut read_buf) {
            Ok(0) => break Ok(()),
            Ok(read) => read,
            Err(err) => break Err(err),
        };
        h264_buf.extend_from_slice(&read_buf[..read]);
        for sample in drain_h264_access_units(&mut h264_buf, &mut access_unit) {
            let duration = pending_durations
                .lock()
                .ok()
                .and_then(|mut durations| durations.pop_front())
                .unwrap_or(sample_duration);
            let sample = media::Sample {
                data: bytes::Bytes::from(sample),
                duration,
                ..Default::default()
            };
            if runtime.block_on(track.write_sample(&sample)).is_err() {
                stop.store(true, Ordering::SeqCst);
                break;
            }
        }
    };

    stop.store(true, Ordering::SeqCst);
    let _ = child.kill();
    let _ = child.wait();
    let _ = writer.join();
    remove_bridge_subscriber(&state)?;
    result
}

fn drain_h264_access_units(buffer: &mut Vec<u8>, current: &mut Vec<u8>) -> Vec<Vec<u8>> {
    let mut emitted = Vec::new();
    let starts = h264_start_codes(buffer);
    if starts.len() < 2 {
        return emitted;
    }
    for pair in starts.windows(2) {
        let (start, code_len) = pair[0];
        let (next_start, _) = pair[1];
        let nalu_start = start + code_len;
        if nalu_start >= next_start {
            continue;
        }
        let nalu = &buffer[nalu_start..next_start];
        let nalu_type = nalu[0] & 0x1f;
        if nalu_type == 9 && !current.is_empty() {
            emitted.push(std::mem::take(current));
        }
        current.extend_from_slice(&[0, 0, 0, 1]);
        current.extend_from_slice(nalu);
    }
    if let Some((last_start, _)) = starts.last().copied() {
        buffer.drain(..last_start);
    }
    emitted
}

fn h264_start_codes(buffer: &[u8]) -> Vec<(usize, usize)> {
    let mut starts = Vec::new();
    let mut index = 0;
    while index + 3 <= buffer.len() {
        if index + 4 <= buffer.len() && buffer[index..index + 4] == [0, 0, 0, 1] {
            starts.push((index, 4));
            index += 4;
        } else if buffer[index..index + 3] == [0, 0, 1] {
            starts.push((index, 3));
            index += 3;
        } else {
            index += 1;
        }
    }
    starts
}

fn bridge_stream_subscriber(
    stream: &mut TcpStream,
    state: &BridgeState,
    client_id: &str,
    player_index: Option<usize>,
    audio_only: bool,
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
        let bytes = if audio_only {
            bridge_audio_only_frame_packet(&snapshot.bytes)?
        } else {
            snapshot.bytes.clone()
        };
        drop(packet);
        last_frame = frame;
        write_stream_packet(stream, &bytes)?;
        if stopped {
            break Ok(());
        }
    }
}

fn bridge_audio_only_frame_packet(packet: &[u8]) -> io::Result<Vec<u8>> {
    if packet.len() < 52 || &packet[..4] != b"EOX4" {
        return Ok(packet.to_vec());
    }
    let video_len = u32::from_le_bytes(packet[40..44].try_into().unwrap()) as usize;
    let pcm_len = u32::from_le_bytes(packet[44..48].try_into().unwrap()) as usize;
    let pcm_offset = 52;
    let video_offset = pcm_offset + pcm_len;
    if packet.len() != video_offset + video_len {
        return Err(invalid_request("bad bridge frame/audio packet"));
    }
    let mut stripped = Vec::with_capacity(52 + pcm_len);
    stripped.extend_from_slice(&packet[..40]);
    stripped.extend_from_slice(&0u32.to_le_bytes());
    stripped.extend_from_slice(&(pcm_len as u32).to_le_bytes());
    stripped.extend_from_slice(&packet[48..52]);
    stripped.extend_from_slice(&packet[pcm_offset..video_offset]);
    Ok(stripped)
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
    bridge_frame_to_bytes(&frame)
}

fn bridge_frame_snapshot_bytes(emulator: &Emulator) -> Vec<u8> {
    let frame = bridge_frame_without_run(emulator);
    bridge_frame_to_bytes(&frame)
}

fn bridge_frame_to_bytes(frame: &BridgeFrame) -> Vec<u8> {
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
    let samples = emulator.render_audio_frame_i16_stereo(sample_rate);
    bridge_frame_audio_samples_bytes(emulator, run, sample_rate, &samples)
}

fn bridge_frame_audio_samples_bytes(
    emulator: &Emulator,
    run: &FrameRun,
    sample_rate: usize,
    samples: &[i16],
) -> Vec<u8> {
    let (width, height) = emulator.frame_size();
    let channels = 2u32;
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
    for &sample in samples {
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

fn push_frame_rgb24_visible(bytes: &mut Vec<u8>, emulator: &Emulator) {
    let (width, height) = emulator.frame_size();
    let (_, output_height) = bridge_video_output_size(width, height);
    let framebuffer = emulator.framebuffer();
    let field = (emulator.frame_count as usize) & 1;
    for y in 0..output_height {
        let source_y = if height > output_height {
            (y * 2 + field).min(height - 1)
        } else {
            y
        };
        let row_start = source_y * width;
        for &pixel in framebuffer[row_start..row_start + width].iter() {
            bytes.push(((pixel >> 16) & 0xff) as u8);
            bytes.push(((pixel >> 8) & 0xff) as u8);
            bytes.push((pixel & 0xff) as u8);
        }
    }
}

fn bridge_video_output_size(width: usize, height: usize) -> (usize, usize) {
    let output_height = if height > 240 { height / 2 } else { height };
    (width, output_height)
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
             allowed_origins = \"\"\n\
             library_read_only = true\n\
             app_public_server_url = \"https://apothictech.se\"\n\
             app_lan_server_url = \"http://192.168.32.186:8080\"\n\
             eutherbooks_server_urls = \"http://192.168.32.186:8088,http://192.168.32.186:8080/eutherbooks,https://apothictech.se/eutherbooks\"\n",
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
    let library_read_only = parse_toml_bool(&contents, "library_read_only").unwrap_or(true);
    let app_public_server_url =
        parse_toml_string(&contents, "app_public_server_url").filter(|value| !value.is_empty());
    let app_lan_server_url =
        parse_toml_string(&contents, "app_lan_server_url").filter(|value| !value.is_empty());
    let eutherbooks_server_urls = parse_toml_string(&contents, "eutherbooks_server_urls")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(|url| url.trim_end_matches('/').to_string())
        .collect();
    Ok(HostConfig {
        bind,
        rom_dir,
        session_timeout_minutes,
        login_rate_limit_window_secs,
        login_rate_limit_max_attempts,
        secure_cookies,
        allowed_origins,
        library_read_only,
        app_public_server_url,
        app_lan_server_url,
        eutherbooks_server_urls,
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
    let mut app_token = None;
    let mut app_lan_server_url = None;
    let mut banned = false;
    let mut admin = false;
    let mut can_play = true;
    let mut can_launch_roms = false;
    let mut can_upload_roms = false;
    let mut can_manage_library = false;
    let mut can_award_eutherium = false;
    let mut can_camera_admin = false;
    let mut camera_rotation_degrees = 0;
    let mut camera_refresh_ms = 500;
    let mut euthersync_media_backup = None;
    let mut euthersync_feed_post = None;
    for line in contents.lines().map(str::trim) {
        if line.starts_with("[[user]]") {
            if let (Some(name), Some(password_hash)) = (name.take(), password_hash.take()) {
                let admin = admin || name == "nichlas";
                users.push(HostUser {
                    name,
                    password_hash,
                    app_token: app_token
                        .take()
                        .filter(|token: &String| !token.trim().is_empty()),
                    app_lan_server_url: app_lan_server_url
                        .take()
                        .filter(|url: &String| !url.trim().is_empty()),
                    banned,
                    admin,
                    can_play,
                    can_launch_roms,
                    can_upload_roms,
                    can_manage_library,
                    can_award_eutherium,
                    can_camera_admin,
                    camera_rotation_degrees,
                    camera_refresh_ms,
                    euthersync_media_backup,
                    euthersync_feed_post,
                });
            }
            app_token = None;
            app_lan_server_url = None;
            banned = false;
            admin = false;
            can_play = true;
            can_launch_roms = false;
            can_upload_roms = false;
            can_manage_library = false;
            can_award_eutherium = false;
            can_camera_admin = false;
            camera_rotation_degrees = 0;
            camera_refresh_ms = 500;
            euthersync_media_backup = None;
            euthersync_feed_post = None;
            continue;
        }
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(value) = parse_toml_assignment(line, "name") {
            name = Some(value);
        } else if let Some(value) = parse_toml_assignment(line, "password_hash") {
            password_hash = Some(value);
        } else if let Some(value) = parse_toml_assignment(line, "app_token") {
            app_token = Some(value);
        } else if let Some(value) = parse_toml_assignment(line, "app_lan_server_url") {
            app_lan_server_url = Some(value);
        } else if let Some(value) = parse_toml_bool_assignment(line, "banned") {
            banned = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "admin") {
            admin = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "can_play") {
            can_play = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "can_launch_roms") {
            can_launch_roms = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "can_upload_roms") {
            can_upload_roms = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "can_manage_library") {
            can_manage_library = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "can_award_eutherium") {
            can_award_eutherium = value;
        } else if let Some(value) = parse_toml_bool_assignment(line, "can_camera_admin") {
            can_camera_admin = value;
        } else if let Some(value) = parse_toml_u16_assignment(line, "camera_rotation_degrees") {
            camera_rotation_degrees = normalize_camera_rotation(value as i32);
        } else if let Some(value) = parse_toml_u16_assignment(line, "camera_refresh_ms") {
            camera_refresh_ms = normalize_camera_refresh_ms(value);
        } else if let Some(value) = parse_toml_bool_assignment(line, "euthersync_media_backup") {
            euthersync_media_backup = Some(value);
        } else if let Some(value) = parse_toml_bool_assignment(line, "euthersync_feed_post") {
            euthersync_feed_post = Some(value);
        }
    }
    if let (Some(name), Some(password_hash)) = (name.take(), password_hash.take()) {
        let admin = admin || name == "nichlas";
        users.push(HostUser {
            name,
            password_hash,
            app_token: app_token.filter(|token| !token.trim().is_empty()),
            app_lan_server_url: app_lan_server_url.filter(|url| !url.trim().is_empty()),
            banned,
            admin,
            can_play,
            can_launch_roms,
            can_upload_roms,
            can_manage_library,
            can_award_eutherium,
            can_camera_admin,
            camera_rotation_degrees,
            camera_refresh_ms,
            euthersync_media_backup,
            euthersync_feed_post,
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
        if let Some(app_token) = &user.app_token {
            contents.push_str(&format!("app_token = \"{}\"\n", toml_escape(app_token)));
        }
        if let Some(app_lan_server_url) = &user.app_lan_server_url {
            contents.push_str(&format!(
                "app_lan_server_url = \"{}\"\n",
                toml_escape(app_lan_server_url)
            ));
        }
        contents.push_str(&format!("banned = {}\n", user.banned));
        contents.push_str(&format!("admin = {}\n", user.admin));
        contents.push_str(&format!("can_play = {}\n", user.can_play));
        contents.push_str(&format!("can_launch_roms = {}\n", user.can_launch_roms));
        contents.push_str(&format!("can_upload_roms = {}\n", user.can_upload_roms));
        contents.push_str(&format!(
            "can_manage_library = {}\n",
            user.can_manage_library
        ));
        contents.push_str(&format!(
            "can_award_eutherium = {}\n",
            user.can_award_eutherium
        ));
        contents.push_str(&format!("can_camera_admin = {}\n", user.can_camera_admin));
        contents.push_str(&format!(
            "camera_rotation_degrees = {}\n",
            user.camera_rotation_degrees
        ));
        contents.push_str(&format!("camera_refresh_ms = {}\n", user.camera_refresh_ms));
        if let Some(euthersync_media_backup) = user.euthersync_media_backup {
            contents.push_str(&format!(
                "euthersync_media_backup = {}\n",
                euthersync_media_backup
            ));
        }
        if let Some(euthersync_feed_post) = user.euthersync_feed_post {
            contents.push_str(&format!(
                "euthersync_feed_post = {}\n",
                euthersync_feed_post
            ));
        }
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

fn read_host_social_conversations() -> io::Result<Vec<HostSocialConversation>> {
    ensure_host_social_dir()?;
    let path = host_social_conversations_path();
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    serde_json::from_str(&contents).map_err(|err| io::Error::other(err.to_string()))
}

fn write_host_social_conversations(conversations: &[HostSocialConversation]) -> io::Result<()> {
    ensure_host_social_dir()?;
    let contents = serde_json::to_string_pretty(conversations)
        .map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(host_social_conversations_path(), contents)
}

fn read_host_social_attachment_manifest(id: &str) -> io::Result<HostSocialAttachment> {
    let (attachment, _) = read_host_social_attachment_record(id)?;
    Ok(attachment)
}

fn read_host_social_attachment_record(id: &str) -> io::Result<(HostSocialAttachment, String)> {
    validate_host_social_attachment_id(id)?;
    let contents = fs::read_to_string(host_social_attachment_manifest_path(id)?)?;
    let value: serde_json::Value =
        serde_json::from_str(&contents).map_err(|err| io::Error::other(err.to_string()))?;
    let attachment: HostSocialAttachment = serde_json::from_value(
        value
            .get("attachment")
            .cloned()
            .ok_or_else(|| invalid_request("invalid attachment manifest"))?,
    )
    .map_err(|err| io::Error::other(err.to_string()))?;
    let file_name = value
        .get("fileName")
        .and_then(|value| value.as_str())
        .ok_or_else(|| invalid_request("invalid attachment manifest"))?
        .to_string();
    validate_host_social_attachment_file_name(&file_name)?;
    Ok((attachment, file_name))
}

fn write_host_social_attachment_manifest(
    attachment: &HostSocialAttachment,
    file_name: &str,
) -> io::Result<()> {
    validate_host_social_attachment_id(&attachment.id)?;
    validate_host_social_attachment_file_name(file_name)?;
    ensure_host_social_attachments_dir()?;
    let contents = serde_json::to_string_pretty(&serde_json::json!({
        "attachment": attachment,
        "fileName": file_name,
    }))
    .map_err(|err| io::Error::other(err.to_string()))?;
    fs::write(
        host_social_attachment_manifest_path(&attachment.id)?,
        contents,
    )
}

fn read_host_social_messages(conversation_id: &str) -> io::Result<Vec<HostSocialMessage>> {
    validate_host_social_conversation_id(conversation_id)?;
    ensure_host_social_messages_dir()?;
    let path = host_social_messages_path(conversation_id)?;
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    Ok(contents
        .lines()
        .filter_map(|line| serde_json::from_str::<HostSocialMessage>(line).ok())
        .collect())
}

fn append_host_social_message(message: &HostSocialMessage) -> io::Result<()> {
    validate_host_social_conversation_id(&message.conversation_id)?;
    ensure_host_social_messages_dir()?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(host_social_messages_path(&message.conversation_id)?)?;
    serde_json::to_writer(&mut file, message).map_err(|err| io::Error::other(err.to_string()))?;
    file.write_all(b"\n")
}

fn write_host_social_messages(
    conversation_id: &str,
    messages: &[HostSocialMessage],
) -> io::Result<()> {
    validate_host_social_conversation_id(conversation_id)?;
    ensure_host_social_messages_dir()?;
    let mut contents = Vec::new();
    for message in messages {
        serde_json::to_writer(&mut contents, message)
            .map_err(|err| io::Error::other(err.to_string()))?;
        contents.push(b'\n');
    }
    fs::write(host_social_messages_path(conversation_id)?, contents)
}

fn normalized_host_social_participants(participants: Vec<String>) -> Vec<String> {
    let mut participants = participants
        .into_iter()
        .map(|participant| participant.trim().to_string())
        .filter(|participant| !participant.is_empty())
        .collect::<Vec<_>>();
    participants.sort_by_key(|participant| participant.to_lowercase());
    participants.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    participants
}

fn validate_host_social_participants(state: &HostState, participants: &[String]) -> io::Result<()> {
    let users = state
        .users
        .lock()
        .map_err(|err| io::Error::other(err.to_string()))?;
    for participant in participants {
        if participant == HOST_CODEX_USER {
            continue;
        }
        if !users
            .iter()
            .any(|user| user.name == *participant && !user.banned)
        {
            return Err(invalid_request(format!("unknown user: {participant}")));
        }
    }
    Ok(())
}

fn host_social_conversation_id_from_messages_path(path: &str) -> io::Result<String> {
    let id = path
        .strip_prefix("/api/social/conversations/")
        .and_then(|value| value.strip_suffix("/messages"))
        .ok_or_else(|| invalid_request("invalid social chat path"))?;
    let id = percent_decode(id)?;
    validate_host_social_conversation_id(&id)?;
    Ok(id)
}

fn host_social_reaction_path_parts(path: &str) -> io::Result<(String, u64)> {
    let rest = path
        .strip_prefix("/api/social/conversations/")
        .ok_or_else(|| invalid_request("invalid reaction path"))?;
    let (conversation_id, rest) = rest
        .split_once("/messages/")
        .ok_or_else(|| invalid_request("invalid reaction path"))?;
    let message_id = rest
        .strip_suffix("/reactions")
        .ok_or_else(|| invalid_request("invalid reaction path"))?
        .parse::<u64>()
        .map_err(|_| invalid_request("invalid message id"))?;
    let conversation_id = percent_decode(conversation_id)?;
    validate_host_social_conversation_id(&conversation_id)?;
    Ok((conversation_id, message_id))
}

fn host_social_attachment_id_from_path(path: &str) -> io::Result<String> {
    let id = path
        .strip_prefix("/api/social/attachments/")
        .ok_or_else(|| invalid_request("invalid attachment path"))?;
    let id = percent_decode(id)?;
    validate_host_social_attachment_id(&id)?;
    Ok(id)
}

fn validate_host_social_conversation_id(conversation_id: &str) -> io::Result<()> {
    if conversation_id.is_empty()
        || conversation_id.len() > 160
        || !conversation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid_request("invalid conversation id"));
    }
    Ok(())
}

fn validate_host_social_attachment_id(id: &str) -> io::Result<()> {
    if id.is_empty()
        || id.len() > 120
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(invalid_request("invalid attachment id"));
    }
    Ok(())
}

fn validate_host_social_attachment_file_name(file_name: &str) -> io::Result<()> {
    if file_name.is_empty()
        || file_name.len() > 160
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return Err(invalid_request("invalid attachment file"));
    }
    Ok(())
}

fn host_social_slug(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() {
            output.push((byte as char).to_ascii_lowercase());
        } else if !output.ends_with('-') {
            output.push('-');
        }
    }
    let output = output.trim_matches('-').to_string();
    if output.is_empty() {
        "user".to_string()
    } else {
        output
    }
}

fn host_social_hash(value: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn random_u64() -> io::Result<u64> {
    let mut bytes = [0u8; 8];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn host_display_user_name(username: &str) -> String {
    let mut chars = username.chars();
    let Some(first) = chars.next() else {
        return "User".to_string();
    };
    format!("{}{}", first.to_uppercase(), chars.collect::<String>())
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

fn host_social_dir() -> PathBuf {
    host_dir().join("social-chat")
}

fn host_social_messages_dir() -> PathBuf {
    host_social_dir().join("messages")
}

fn host_social_attachments_dir() -> PathBuf {
    host_social_dir().join("attachments")
}

fn host_codex_inbox_dir() -> PathBuf {
    host_dir().join("codex-inbox")
}

fn ensure_host_social_dir() -> io::Result<()> {
    fs::create_dir_all(host_social_dir())
}

fn ensure_host_social_messages_dir() -> io::Result<()> {
    fs::create_dir_all(host_social_messages_dir())
}

fn ensure_host_social_attachments_dir() -> io::Result<()> {
    fs::create_dir_all(host_social_attachments_dir())
}

fn ensure_host_codex_inbox_dir() -> io::Result<()> {
    fs::create_dir_all(host_codex_inbox_dir())
}

fn host_social_conversations_path() -> PathBuf {
    host_social_dir().join("conversations.json")
}

fn host_social_messages_path(conversation_id: &str) -> io::Result<PathBuf> {
    validate_host_social_conversation_id(conversation_id)?;
    Ok(host_social_messages_dir().join(format!("{conversation_id}.jsonl")))
}

fn host_social_attachment_manifest_path(id: &str) -> io::Result<PathBuf> {
    validate_host_social_attachment_id(id)?;
    Ok(host_social_attachments_dir().join(format!("{id}.json")))
}

fn host_social_attachment_file_path(file_name: &str) -> io::Result<PathBuf> {
    validate_host_social_attachment_file_name(file_name)?;
    Ok(host_social_attachments_dir().join(file_name))
}

fn host_audit_path() -> PathBuf {
    host_dir().join("audit.log")
}

fn host_eutherium_dir() -> PathBuf {
    host_dir().join("eutherium")
}

fn host_eutherium_ledger_path() -> PathBuf {
    host_eutherium_dir().join("ledger.json")
}

fn host_eutherium_inventory_path() -> PathBuf {
    host_eutherium_dir().join("inventory.json")
}

fn host_trophy_room_layout_path(user: &str) -> PathBuf {
    host_user_data_dir(user)
        .join("eutherium")
        .join("trophy-room.json")
}

fn host_user_settings_path(user: &str) -> PathBuf {
    host_user_data_dir(user).join("settings.toml")
}

fn ensure_host_user_data_dir(user: &str) -> io::Result<PathBuf> {
    let dir = host_user_data_dir(user);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn host_user_data_dir(user: &str) -> PathBuf {
    host_dir()
        .join("user-data")
        .join(host_user_storage_name(user))
}

fn host_user_shopping_list_id(user: &str) -> io::Result<String> {
    let link_path = host_user_shopping_list_link_path(user);
    if let Ok(shared_id) = fs::read_to_string(&link_path) {
        return validate_host_shared_doc_id(shared_id.trim());
    }
    let dir = ensure_host_user_data_dir(user)?.join("shopping-lists");
    fs::create_dir_all(&dir)?;
    let shared_id = private_host_shopping_list_id(user);
    fs::write(dir.join("hemmet.link"), &shared_id)?;
    Ok(shared_id)
}

fn host_user_shopping_list_link_path(user: &str) -> PathBuf {
    host_user_data_dir(user)
        .join("shopping-lists")
        .join("hemmet.link")
}

fn host_shared_shopping_list_path(shared_id: &str) -> io::Result<PathBuf> {
    Ok(host_dir()
        .join("shared-shopping-lists")
        .join(format!("{}.md", validate_host_shared_doc_id(shared_id)?)))
}

fn host_shared_shopping_list_manifest_path(shared_id: &str) -> io::Result<PathBuf> {
    Ok(host_dir().join("shared-shopping-lists").join(format!(
        "{}.members.json",
        validate_host_shared_doc_id(shared_id)?
    )))
}

fn private_host_shopping_list_id(user: &str) -> String {
    format!("shopping-{}", host_shared_doc_user_slug(user))
}

fn host_shared_doc_user_slug(user: &str) -> String {
    let mut output = String::new();
    for byte in user.bytes() {
        if byte.is_ascii_alphanumeric() {
            output.push((byte as char).to_ascii_lowercase());
        } else {
            output.push_str(&format!("_{byte:02x}"));
        }
    }
    if output.is_empty() {
        "user".to_string()
    } else {
        output
    }
}

fn validate_host_shared_doc_id(shared_id: &str) -> io::Result<String> {
    if shared_id.is_empty() || shared_id.len() > 80 {
        return Err(invalid_request("invalid shared document id"));
    }
    if !shared_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err(invalid_request("invalid shared document id"));
    }
    Ok(shared_id.to_string())
}

fn host_user_storage_name(user: &str) -> String {
    let mut output = String::new();
    for byte in user.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_') {
            output.push(byte as char);
        } else {
            output.push_str(&format!("%{byte:02x}"));
        }
    }
    if output.is_empty() {
        "user".to_string()
    } else {
        output
    }
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

fn form_bool(form: &[(String, String)], name: &str) -> bool {
    form_value(form, name).is_some_and(|value| value == "true" || value == "1")
}

fn optional_form_i32(
    form: &[(String, String)],
    snake_name: &str,
    camel_value: Option<&str>,
) -> io::Result<Option<i32>> {
    form_value(form, snake_name)
        .or(camel_value)
        .map(|value| {
            value
                .parse::<i32>()
                .map_err(|_| invalid_request(format!("invalid {snake_name}")))
        })
        .transpose()
}

fn optional_form_u16(
    form: &[(String, String)],
    snake_name: &str,
    camel_value: Option<&str>,
) -> io::Result<Option<u16>> {
    form_value(form, snake_name)
        .or(camel_value)
        .map(|value| {
            value
                .parse::<u16>()
                .map_err(|_| invalid_request(format!("invalid {snake_name}")))
        })
        .transpose()
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

fn parse_toml_u16_assignment(line: &str, key: &str) -> Option<u16> {
    let (name, value) = line.split_once('=')?;
    (name.trim() == key).then(|| value.trim().parse::<u16>().ok())?
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

fn parse_toml_f64(contents: &str, key: &str) -> Option<f64> {
    contents.lines().find_map(|line| {
        let line = line.trim();
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().parse::<f64>().ok())?
    })
}

fn toml_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn read_host_user_preferences(user: &str) -> io::Result<HostUserPreferences> {
    let mut preferences = HostUserPreferences::default();
    let contents = match fs::read_to_string(host_user_settings_path(user)) {
        Ok(contents) => contents,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(preferences),
        Err(err) => return Err(err),
    };
    if let Some(value) = parse_toml_f64(&contents, "audio_volume") {
        preferences.audio_volume = clamp_unit_f64(value, preferences.audio_volume);
    }
    if let Some(value) = parse_toml_f64(&contents, "mic_volume") {
        preferences.mic_volume = clamp_f64(value, 0.0, 1.6, preferences.mic_volume);
    }
    if let Some(value) = parse_toml_f64(&contents, "doom_mouse_sensitivity") {
        preferences.doom_mouse_sensitivity =
            clamp_f64(value, 0.6, 4.0, preferences.doom_mouse_sensitivity);
    }
    if let Some(value) = parse_toml_string(&contents, "theme") {
        preferences.theme = clean_host_user_theme(&value);
    }
    if let Some(value) = parse_toml_string(&contents, "skin") {
        preferences.skin = clean_host_user_skin(&value);
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_voice") {
        preferences.eutherbooks_voice = clean_eutherbooks_voice(&value);
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_custom_voice") {
        preferences.eutherbooks_custom_voice =
            clean_eutherbooks_text(&value, &preferences.eutherbooks_custom_voice, 500);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_length_scale") {
        preferences.eutherbooks_length_scale =
            clamp_f64(value, 0.75, 1.35, preferences.eutherbooks_length_scale);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_noise_scale") {
        preferences.eutherbooks_noise_scale =
            clamp_f64(value, 0.2, 1.0, preferences.eutherbooks_noise_scale);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_noise_w") {
        preferences.eutherbooks_noise_w =
            clamp_f64(value, 0.2, 1.2, preferences.eutherbooks_noise_w);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_sentence_silence") {
        preferences.eutherbooks_sentence_silence =
            clamp_f64(value, 0.0, 0.8, preferences.eutherbooks_sentence_silence);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_cfg_value") {
        preferences.eutherbooks_cfg_value =
            clamp_f64(value, 1.0, 3.0, preferences.eutherbooks_cfg_value);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_inference_timesteps") {
        preferences.eutherbooks_inference_timesteps = clamp_f64(
            value.round(),
            10.0,
            50.0,
            preferences.eutherbooks_inference_timesteps,
        );
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_max_chunk_chars") {
        preferences.eutherbooks_max_chunk_chars = clamp_f64(
            value.round(),
            120.0,
            1500.0,
            preferences.eutherbooks_max_chunk_chars,
        );
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_seed") {
        preferences.eutherbooks_seed = clamp_f64(
            value.round(),
            0.0,
            2147483647.0,
            preferences.eutherbooks_seed,
        );
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_last_book_id") {
        preferences.eutherbooks_last_book_id = clean_eutherbooks_book_id(&value);
    }
    if let Some(value) = parse_toml_f64(&contents, "eutherbooks_last_chapter_index") {
        preferences.eutherbooks_last_chapter_index = clamp_f64(
            value.round(),
            0.0,
            100000.0,
            preferences.eutherbooks_last_chapter_index,
        );
    }
    if let Some(value) = parse_toml_bool(&contents, "eutherbooks_auto_generate_next") {
        preferences.eutherbooks_auto_generate_next = value;
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_own_voice_sv_path") {
        preferences.eutherbooks_own_voice_sv_path = clean_eutherbooks_sample_path(&value);
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_own_voice_sv_prompt") {
        preferences.eutherbooks_own_voice_sv_prompt =
            clean_eutherbooks_text(&value, eutherbooks_own_voice_prompt("sv"), 500);
    }
    if let Some(value) = parse_toml_bool(&contents, "eutherbooks_own_voice_sv_locked") {
        preferences.eutherbooks_own_voice_sv_locked = value;
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_own_voice_en_path") {
        preferences.eutherbooks_own_voice_en_path = clean_eutherbooks_sample_path(&value);
    }
    if let Some(value) = parse_toml_string(&contents, "eutherbooks_own_voice_en_prompt") {
        preferences.eutherbooks_own_voice_en_prompt =
            clean_eutherbooks_text(&value, eutherbooks_own_voice_prompt("en"), 500);
    }
    if let Some(value) = parse_toml_bool(&contents, "eutherbooks_own_voice_en_locked") {
        preferences.eutherbooks_own_voice_en_locked = value;
    }
    Ok(preferences)
}

fn save_host_user_preferences(user: &str, preferences: HostUserPreferences) -> io::Result<()> {
    let dir = ensure_host_user_data_dir(user)?;
    let preferences = HostUserPreferences {
        audio_volume: clamp_unit_f64(preferences.audio_volume, 0.8),
        mic_volume: clamp_f64(preferences.mic_volume, 0.0, 1.6, 1.0),
        doom_mouse_sensitivity: clamp_f64(preferences.doom_mouse_sensitivity, 0.6, 4.0, 2.2),
        theme: clean_host_user_theme(&preferences.theme),
        skin: clean_host_user_skin(&preferences.skin),
        eutherbooks_voice: clean_eutherbooks_voice(&preferences.eutherbooks_voice),
        eutherbooks_custom_voice: clean_eutherbooks_text(
            &preferences.eutherbooks_custom_voice,
            "A warm Swedish audiobook narrator with clear pronunciation and natural pacing.",
            500,
        ),
        eutherbooks_length_scale: clamp_f64(preferences.eutherbooks_length_scale, 0.75, 1.35, 1.0),
        eutherbooks_noise_scale: clamp_f64(preferences.eutherbooks_noise_scale, 0.2, 1.0, 0.667),
        eutherbooks_noise_w: clamp_f64(preferences.eutherbooks_noise_w, 0.2, 1.2, 0.8),
        eutherbooks_sentence_silence: clamp_f64(
            preferences.eutherbooks_sentence_silence,
            0.0,
            0.8,
            0.2,
        ),
        eutherbooks_cfg_value: clamp_f64(preferences.eutherbooks_cfg_value, 1.0, 3.0, 2.0),
        eutherbooks_inference_timesteps: clamp_f64(
            preferences.eutherbooks_inference_timesteps.round(),
            10.0,
            50.0,
            10.0,
        ),
        eutherbooks_max_chunk_chars: clamp_f64(
            preferences.eutherbooks_max_chunk_chars.round(),
            120.0,
            1500.0,
            700.0,
        ),
        eutherbooks_seed: clamp_f64(preferences.eutherbooks_seed.round(), 0.0, 2147483647.0, 0.0),
        eutherbooks_last_book_id: clean_eutherbooks_book_id(&preferences.eutherbooks_last_book_id),
        eutherbooks_last_chapter_index: clamp_f64(
            preferences.eutherbooks_last_chapter_index.round(),
            0.0,
            100000.0,
            0.0,
        ),
        eutherbooks_auto_generate_next: preferences.eutherbooks_auto_generate_next,
        eutherbooks_own_voice_sv_path: clean_eutherbooks_sample_path(
            &preferences.eutherbooks_own_voice_sv_path,
        ),
        eutherbooks_own_voice_sv_prompt: clean_eutherbooks_text(
            &preferences.eutherbooks_own_voice_sv_prompt,
            eutherbooks_own_voice_prompt("sv"),
            500,
        ),
        eutherbooks_own_voice_sv_locked: preferences.eutherbooks_own_voice_sv_locked,
        eutherbooks_own_voice_en_path: clean_eutherbooks_sample_path(
            &preferences.eutherbooks_own_voice_en_path,
        ),
        eutherbooks_own_voice_en_prompt: clean_eutherbooks_text(
            &preferences.eutherbooks_own_voice_en_prompt,
            eutherbooks_own_voice_prompt("en"),
            500,
        ),
        eutherbooks_own_voice_en_locked: preferences.eutherbooks_own_voice_en_locked,
    };
    fs::write(
        dir.join("settings.toml"),
        format!(
            "audio_volume = {:.3}\nmic_volume = {:.3}\ndoom_mouse_sensitivity = {:.3}\ntheme = \"{}\"\nskin = \"{}\"\neutherbooks_voice = \"{}\"\neutherbooks_custom_voice = \"{}\"\neutherbooks_length_scale = {:.3}\neutherbooks_noise_scale = {:.3}\neutherbooks_noise_w = {:.3}\neutherbooks_sentence_silence = {:.3}\neutherbooks_cfg_value = {:.3}\neutherbooks_inference_timesteps = {:.0}\neutherbooks_max_chunk_chars = {:.0}\neutherbooks_seed = {:.0}\neutherbooks_last_book_id = \"{}\"\neutherbooks_last_chapter_index = {:.0}\neutherbooks_auto_generate_next = {}\neutherbooks_own_voice_sv_path = \"{}\"\neutherbooks_own_voice_sv_prompt = \"{}\"\neutherbooks_own_voice_sv_locked = {}\neutherbooks_own_voice_en_path = \"{}\"\neutherbooks_own_voice_en_prompt = \"{}\"\neutherbooks_own_voice_en_locked = {}\n",
            preferences.audio_volume,
            preferences.mic_volume,
            preferences.doom_mouse_sensitivity,
            toml_escape(&preferences.theme),
            toml_escape(&preferences.skin),
            toml_escape(&preferences.eutherbooks_voice),
            toml_escape(&preferences.eutherbooks_custom_voice),
            preferences.eutherbooks_length_scale,
            preferences.eutherbooks_noise_scale,
            preferences.eutherbooks_noise_w,
            preferences.eutherbooks_sentence_silence,
            preferences.eutherbooks_cfg_value,
            preferences.eutherbooks_inference_timesteps,
            preferences.eutherbooks_max_chunk_chars,
            preferences.eutherbooks_seed,
            toml_escape(&preferences.eutherbooks_last_book_id),
            preferences.eutherbooks_last_chapter_index,
            preferences.eutherbooks_auto_generate_next,
            toml_escape(&preferences.eutherbooks_own_voice_sv_path),
            toml_escape(&preferences.eutherbooks_own_voice_sv_prompt),
            preferences.eutherbooks_own_voice_sv_locked,
            toml_escape(&preferences.eutherbooks_own_voice_en_path),
            toml_escape(&preferences.eutherbooks_own_voice_en_prompt),
            preferences.eutherbooks_own_voice_en_locked
        ),
    )
}

fn save_host_eutherbooks_voice_sample(
    user: &str,
    upload: HostEutherBooksVoiceSampleUpload,
) -> io::Result<HostUserPreferences> {
    let total_started = Instant::now();
    let voice_id = eutherbooks_own_voice_slot(&upload.voice_id)
        .ok_or_else(|| invalid_request("invalid voice sample slot"))?;
    let language = if voice_id == "own-en" { "en" } else { "sv" };
    if !upload.language.trim().is_empty() && upload.language.trim() != language {
        return Err(invalid_request("voice sample language mismatch"));
    }
    let prompt_text = clean_eutherbooks_text(
        &upload.prompt_text,
        eutherbooks_own_voice_prompt(language),
        500,
    );
    let decode_started = Instant::now();
    let bytes = decode_base64(upload.data_base64.trim())?;
    let decode_ms = decode_started.elapsed().as_millis();
    if bytes.is_empty() || bytes.len() > HOST_EUTHERBOOKS_VOICE_SAMPLE_MAX_BYTES {
        return Err(invalid_request("voice sample is too large"));
    }
    let content_type = upload.content_type.trim().to_ascii_lowercase();
    let file_name = upload
        .file_name
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !is_supported_eutherbooks_voice_sample_content_type(&content_type, &file_name) {
        return Err(invalid_request("unsupported voice sample type"));
    }

    let voice_dir = ensure_host_user_data_dir(user)?
        .join("eutherbooks")
        .join("voices");
    fs::create_dir_all(&voice_dir)?;
    let raw_extension = eutherbooks_voice_sample_extension(&content_type, &file_name);
    let raw_path = voice_dir.join(format!("{voice_id}.source.{raw_extension}"));
    let wav_path = voice_dir.join(format!("{voice_id}.wav"));
    let write_started = Instant::now();
    fs::write(&raw_path, &bytes)?;
    let write_ms = write_started.elapsed().as_millis();
    let convert_started = Instant::now();
    convert_eutherbooks_voice_sample_to_wav(&raw_path, &wav_path)?;
    let convert_ms = convert_started.elapsed().as_millis();
    let wav_bytes = wav_path.metadata().map(|meta| meta.len()).unwrap_or(0);
    eprintln!(
        "TTS_TRACE eutheroxide_voice_sample_saved user={} voice={} language={} content_type={} file_name={} source_bytes={} wav_bytes={} raw_path={} wav_path={} decode_ms={} write_ms={} convert_ms={} total_ms={}",
        user,
        voice_id,
        language,
        content_type,
        file_name,
        bytes.len(),
        wav_bytes,
        raw_path.display(),
        wav_path.display(),
        decode_ms,
        write_ms,
        convert_ms,
        total_started.elapsed().as_millis(),
    );

    let mut preferences = read_host_user_preferences(user)?;
    let wav_path_text = wav_path.to_string_lossy().to_string();
    if voice_id == "own-en" {
        preferences.eutherbooks_own_voice_en_path = wav_path_text;
        preferences.eutherbooks_own_voice_en_prompt = prompt_text;
        preferences.eutherbooks_own_voice_en_locked = true;
    } else {
        preferences.eutherbooks_own_voice_sv_path = wav_path_text;
        preferences.eutherbooks_own_voice_sv_prompt = prompt_text;
        preferences.eutherbooks_own_voice_sv_locked = true;
    }
    save_host_user_preferences(user, preferences)?;
    read_host_user_preferences(user)
}

fn send_host_eutherbooks_voice_sample_wav(
    stream: &mut TcpStream,
    user: &str,
    request_path: &str,
) -> io::Result<()> {
    let voice = query_string_value(request_path, "voice")?.unwrap_or_else(|| "own-sv".to_string());
    let Some(voice_id) = eutherbooks_own_voice_slot(&voice) else {
        return send_error(stream, 400, "invalid voice sample slot");
    };
    let preferences = read_host_user_preferences(user)?;
    let (locked, path_text) = if voice_id == "own-en" {
        (
            preferences.eutherbooks_own_voice_en_locked,
            preferences.eutherbooks_own_voice_en_path,
        )
    } else {
        (
            preferences.eutherbooks_own_voice_sv_locked,
            preferences.eutherbooks_own_voice_sv_path,
        )
    };
    if !locked || path_text.trim().is_empty() {
        return send_error(stream, 404, "voice sample not locked");
    }
    let root = host_user_data_dir(user).canonicalize()?;
    let path = PathBuf::from(path_text).canonicalize()?;
    if !path.starts_with(&root) || path.extension().and_then(|ext| ext.to_str()) != Some("wav") {
        return send_error(stream, 404, "voice sample not found");
    }
    let bytes = fs::read(&path)?;
    eprintln!(
        "TTS_TRACE eutheroxide_voice_sample_replay user={} voice={} path={} bytes={}",
        user,
        voice_id,
        path.display(),
        bytes.len(),
    );
    send_response(stream, 200, "audio/wav", &bytes)
}

fn is_supported_eutherbooks_voice_sample_content_type(content_type: &str, file_name: &str) -> bool {
    content_type.starts_with("audio/webm")
        || content_type.starts_with("audio/ogg")
        || content_type.starts_with("audio/wav")
        || content_type.starts_with("audio/x-wav")
        || content_type.starts_with("audio/mpeg")
        || content_type.starts_with("audio/mp3")
        || content_type.starts_with("audio/mp4")
        || content_type.starts_with("audio/m4a")
        || content_type.starts_with("audio/x-m4a")
        || content_type.starts_with("audio/aac")
        || content_type == "application/octet-stream"
        || matches!(
            Path::new(file_name)
                .extension()
                .and_then(|ext| ext.to_str()),
            Some("webm" | "ogg" | "wav" | "mp3" | "m4a" | "mp4" | "aac")
        )
}

fn eutherbooks_voice_sample_extension(content_type: &str, file_name: &str) -> &'static str {
    if content_type.starts_with("audio/ogg") || file_name.ends_with(".ogg") {
        "ogg"
    } else if content_type.starts_with("audio/wav")
        || content_type.starts_with("audio/x-wav")
        || file_name.ends_with(".wav")
    {
        "wav"
    } else if content_type.starts_with("audio/mpeg")
        || content_type.starts_with("audio/mp3")
        || file_name.ends_with(".mp3")
    {
        "mp3"
    } else if content_type.starts_with("audio/mp4")
        || content_type.starts_with("audio/m4a")
        || content_type.starts_with("audio/x-m4a")
        || file_name.ends_with(".m4a")
        || file_name.ends_with(".mp4")
    {
        "m4a"
    } else if content_type.starts_with("audio/aac") || file_name.ends_with(".aac") {
        "aac"
    } else {
        "webm"
    }
}

fn convert_eutherbooks_voice_sample_to_wav(
    input_path: &Path,
    output_path: &Path,
) -> io::Result<()> {
    if input_path == output_path {
        return Ok(());
    }
    let output = Command::new("timeout")
        .arg("--kill-after=5s")
        .arg("30s")
        .arg("ffmpeg")
        .arg("-nostdin")
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(input_path)
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg(output_path)
        .output()
        .map_err(|err| {
            invalid_request(format!(
                "ffmpeg unavailable for voice sample conversion: {err}"
            ))
        })?;
    if output.status.success() {
        Ok(())
    } else if output.status.code() == Some(124) || output.status.code() == Some(137) {
        Err(invalid_request("voice sample conversion timed out"))
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if detail.is_empty() {
            Err(invalid_request("voice sample conversion failed"))
        } else {
            Err(invalid_request(format!(
                "voice sample conversion failed: {detail}"
            )))
        }
    }
}

fn eutherbooks_own_voice_prompt(language: &str) -> &'static str {
    if language == "en" {
        "This is my own audiobook narrator voice. I speak clearly and calmly so the system can learn my tone."
    } else {
        "Det här är min egen berättarröst för ljudböcker. Jag talar tydligt och lugnt så systemet kan lära sig min röst."
    }
}

fn eutherbooks_own_voice_slot(value: &str) -> Option<String> {
    match clean_eutherbooks_voice(value).as_str() {
        "own-en" | "dots-mf-own-en" | "dots-soar-own-en" => Some("own-en".to_string()),
        "own-sv" | "dots-mf-own-sv" | "dots-soar-own-sv" => Some("own-sv".to_string()),
        _ => None,
    }
}

fn clean_eutherbooks_voice(value: &str) -> String {
    let cleaned = clean_eutherbooks_identifier(value, 160);
    if cleaned.is_empty() {
        "sv-female-warm".to_string()
    } else {
        cleaned
    }
}

fn clean_eutherbooks_book_id(value: &str) -> String {
    clean_eutherbooks_identifier(value, 220)
}

fn clean_eutherbooks_identifier(value: &str, max_len: usize) -> String {
    let value = value.trim();
    if value.is_empty() {
        return String::new();
    }
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':'))
        .take(max_len)
        .collect::<String>()
}

fn clean_eutherbooks_sample_path(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() || value.len() > 600 {
        return String::new();
    }
    value
        .chars()
        .filter(|ch| !ch.is_control() && *ch != '\"')
        .collect::<String>()
}

fn clean_eutherbooks_text(value: &str, fallback: &str, max_len: usize) -> String {
    let cleaned = value
        .trim()
        .chars()
        .filter(|ch| !ch.is_control() || *ch == ' ' || *ch == '\t')
        .take(max_len)
        .collect::<String>();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn clean_host_user_theme(value: &str) -> String {
    match value {
        "light" | "dark" | "royal-apothic" => value.to_string(),
        _ => "dark".to_string(),
    }
}

fn clean_host_user_skin(value: &str) -> String {
    match value {
        "classic" | "glass" | "arcade" | "custom" => value.to_string(),
        _ => "classic".to_string(),
    }
}

fn clamp_unit_f64(value: f64, fallback: f64) -> f64 {
    clamp_f64(value, 0.0, 1.0, fallback)
}

fn clamp_f64(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
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
    let joined = root.join(safe_relative_path(relative)?);
    let canonical = joined.canonicalize()?;
    if !canonical.starts_with(root) || !canonical.is_dir() {
        return Err(invalid_request("directory is outside ROM root"));
    }
    Ok(canonical)
}

fn resolve_rom_file_path(relative: &str) -> io::Result<PathBuf> {
    let root = rom_root_path()?;
    let canonical = root.join(safe_relative_path(relative)?).canonicalize()?;
    if !canonical.starts_with(&root) || !canonical.is_file() || !is_rom_path(&canonical) {
        return Err(invalid_request(
            "ROM path is outside root or not a supported ROM",
        ));
    }
    Ok(canonical)
}

fn safe_relative_path(relative: &str) -> io::Result<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(invalid_request("absolute paths are not allowed"));
    }
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            Component::CurDir => {}
            _ => return Err(invalid_request("unsafe relative path")),
        }
    }
    Ok(safe)
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

fn decode_base64(value: &str) -> io::Result<Vec<u8>> {
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut quartet = [0u8; 4];
    let mut quartet_len = 0;
    let mut padding = 0;
    for byte in value.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        let decoded = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                padding += 1;
                0
            }
            _ => return Err(invalid_request("invalid base64 data")),
        };
        quartet[quartet_len] = decoded;
        quartet_len += 1;
        if quartet_len == 4 {
            output.push((quartet[0] << 2) | (quartet[1] >> 4));
            if padding < 2 {
                output.push((quartet[1] << 4) | (quartet[2] >> 2));
            }
            if padding < 1 {
                output.push((quartet[2] << 6) | quartet[3]);
            }
            quartet_len = 0;
            padding = 0;
        }
    }
    if quartet_len != 0 {
        return Err(invalid_request("invalid base64 length"));
    }
    Ok(output)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_relative_path_accepts_normal_paths() {
        assert_eq!(
            safe_relative_path("Games/Sonic.md").unwrap(),
            PathBuf::from("Games/Sonic.md")
        );
        assert_eq!(
            safe_relative_path("./Games/./Sonic.md").unwrap(),
            PathBuf::from("Games/Sonic.md")
        );
    }

    #[test]
    fn safe_relative_path_rejects_escape_paths() {
        assert!(safe_relative_path("../secret.md").is_err());
        assert!(safe_relative_path("Games/../../secret.md").is_err());
        assert!(safe_relative_path("/tmp/secret.md").is_err());
    }
}
