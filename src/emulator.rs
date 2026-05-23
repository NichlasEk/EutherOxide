use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::bus::{M68kBus, M68kBusSnapshot};
use crate::m68k::{CpuError, M68k};
use crate::rom::{RomHeader, SystemRegion, TimingMode, normalize_rom_bytes, parse_header};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct Emulator {
    pub cpu: M68k,
    pub bus: M68kBus,
    pub rom_path: Option<PathBuf>,
    pub frame_count: u64,
    pub rom_header: Option<RomHeader>,
    pub timing: TimingMode,
    pub region: SystemRegion,
    pub last_error: Option<CpuError>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmulatorSnapshot {
    pub cpu: M68k,
    pub bus: M68kBusSnapshot,
    pub frame_count: u64,
    pub rom_header: Option<RomHeader>,
    pub timing: TimingMode,
    pub region: SystemRegion,
    pub last_error: Option<CpuError>,
}

#[derive(Clone, Debug)]
pub struct FrameRun {
    pub cpu_cycles: u64,
    pub cpu_steps: u64,
    pub elapsed: Duration,
    pub hit_unsupported_opcode: bool,
}

impl Default for Emulator {
    fn default() -> Self {
        Self::new()
    }
}

impl Emulator {
    pub const NTSC_LINES_PER_FRAME: u64 = 262;
    pub const PAL_LINES_PER_FRAME: u64 = 313;
    pub const VBLANK_LINE: u64 = 224;
    pub const LINE_M68K_CYCLES: u64 = 488;
    pub const M68K_CLOCK: f64 = 7_670_454.0;
    pub const Z80_CLOCK: f64 = 3_579_545.0;

    pub fn new() -> Self {
        Self {
            cpu: M68k::new(),
            bus: M68kBus::new(),
            rom_path: None,
            frame_count: 0,
            rom_header: None,
            timing: TimingMode::Ntsc,
            region: SystemRegion::Usa,
            last_error: None,
        }
    }

    pub fn load_rom_file<P: AsRef<Path>>(&mut self, path: P) -> io::Result<()> {
        let path = path.as_ref();
        let bytes = fs::read(path)?;
        self.load_rom_bytes_with_path(&bytes, Some(path.to_path_buf()));
        Ok(())
    }

    pub fn load_rom_bytes(&mut self, data: &[u8]) {
        self.load_rom_bytes_with_path(data, None);
    }

    pub fn load_rom_bytes_with_path_hint<P: AsRef<Path>>(&mut self, data: &[u8], path: P) {
        self.load_rom_bytes_with_path(data, Some(path.as_ref().to_path_buf()));
    }

    fn load_rom_bytes_with_path(&mut self, data: &[u8], path: Option<PathBuf>) {
        let rom = normalize_rom_bytes(data);
        self.rom_header = parse_header(&rom);
        if let Some(header) = &self.rom_header {
            self.timing = header.timing;
            self.region = header.region;
        }
        self.bus = M68kBus::new();
        self.configure_region_register();
        self.bus.load_rom(rom);
        self.cpu = M68k::new();
        self.cpu.reset(&mut self.bus);
        self.rom_path = path;
        self.frame_count = 0;
        self.last_error = None;
    }

    pub fn reset(&mut self) {
        let rom = self.bus.rom.clone();
        self.bus.reset();
        self.bus.load_rom(rom);
        self.configure_region_register();
        self.cpu.reset(&mut self.bus);
        self.frame_count = 0;
        self.last_error = None;
    }

    pub fn run_frame(&mut self) -> FrameRun {
        let started = Instant::now();
        let cycles_per_frame = self.current_m68k_frame_cycles();
        let mut cycles = 0u64;
        let mut steps = 0u64;
        let mut next_line = 1u64;
        let mut vblank_requested = false;
        let mut hit_unsupported_opcode = false;

        self.bus.begin_frame();
        while cycles < cycles_per_frame {
            self.bus.frame_cycle = cycles;
            self.bus.ym_frame_cycle = cycles;
            self.bus.vdp.frame_cycle =
                cycles * crate::vdp::Vdp::LINE_CYCLES / Self::LINE_M68K_CYCLES;
            match self.cpu.step(&mut self.bus) {
                Ok(step_cycles) => {
                    cycles += step_cycles as u64;
                    steps += 1;
                }
                Err(err) => {
                    self.last_error = Some(err);
                    hit_unsupported_opcode = true;
                    break;
                }
            }

            while next_line <= self.current_lines_per_frame()
                && cycles >= next_line * Self::LINE_M68K_CYCLES
            {
                self.bus.vdp.tick_line_interrupt(next_line - 1);
                if !vblank_requested && next_line >= Self::VBLANK_LINE {
                    self.bus.vdp.frame_cycle = crate::vdp::Vdp::VBLANK_START_CYCLE;
                    self.bus.vdp.request_vblank();
                    vblank_requested = true;
                }
                next_line += 1;
            }
        }

        if !vblank_requested {
            self.bus.vdp.frame_cycle = crate::vdp::Vdp::VBLANK_START_CYCLE;
            self.bus.vdp.request_vblank();
        }
        self.bus.vdp.render_frame();
        self.bus.vdp.end_vblank();
        self.frame_count += 1;

        FrameRun {
            cpu_cycles: cycles,
            cpu_steps: steps,
            elapsed: started.elapsed(),
            hit_unsupported_opcode,
        }
    }

    pub fn framebuffer(&self) -> &[u32] {
        &self.bus.vdp.framebuffer
    }

    pub fn frame_size(&self) -> (usize, usize) {
        (self.bus.vdp.screen_width, self.bus.vdp.screen_height)
    }

    pub fn frame_rate(&self) -> f64 {
        if self.timing == TimingMode::Pal {
            50.0
        } else {
            60.0
        }
    }

    pub fn snapshot(&self) -> EmulatorSnapshot {
        EmulatorSnapshot {
            cpu: self.cpu.clone(),
            bus: self.bus.snapshot(),
            frame_count: self.frame_count,
            rom_header: self.rom_header.clone(),
            timing: self.timing,
            region: self.region,
            last_error: self.last_error.clone(),
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: EmulatorSnapshot) {
        self.cpu = snapshot.cpu;
        self.bus.restore_snapshot(snapshot.bus);
        self.frame_count = snapshot.frame_count;
        self.rom_header = snapshot.rom_header;
        self.timing = snapshot.timing;
        self.region = snapshot.region;
        self.last_error = snapshot.last_error;
    }

    fn configure_region_register(&mut self) {
        let overseas = !matches!(self.region, SystemRegion::Japan | SystemRegion::JapanPal);
        let pal = self.timing == TimingMode::Pal;
        self.bus.version_register =
            0x80 | if pal { 0x40 } else { 0 } | if overseas { 0x20 } else { 0 };
        self.bus.psg.begin_frame();
        self.bus.ym2612.begin_frame();
    }

    fn current_lines_per_frame(&self) -> u64 {
        if self.timing == TimingMode::Pal {
            Self::PAL_LINES_PER_FRAME
        } else {
            Self::NTSC_LINES_PER_FRAME
        }
    }

    fn current_m68k_frame_cycles(&self) -> u64 {
        Self::LINE_M68K_CYCLES * self.current_lines_per_frame()
    }
}
