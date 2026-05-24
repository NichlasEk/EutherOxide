use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::audio::{Audio, GenesisAudioFilter};
use crate::bus::{M68kBus, M68kBusSnapshot};
use crate::m68k::{CpuError, M68k};
use crate::rom::{RomHeader, SystemRegion, TimingMode, normalize_rom_bytes, parse_header};
use crate::z80::Z80;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub struct Emulator {
    pub cpu: M68k,
    pub z80: Z80,
    pub bus: M68kBus,
    pub rom_path: Option<PathBuf>,
    pub frame_count: u64,
    pub rom_header: Option<RomHeader>,
    pub timing: TimingMode,
    pub region: SystemRegion,
    pub last_error: Option<CpuError>,
    pub z80_pending_cycles: f64,
    audio_filter: GenesisAudioFilter,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EmulatorSnapshot {
    pub cpu: M68k,
    #[serde(default)]
    pub z80: Z80,
    pub bus: M68kBusSnapshot,
    pub frame_count: u64,
    pub rom_header: Option<RomHeader>,
    pub timing: TimingMode,
    pub region: SystemRegion,
    pub last_error: Option<CpuError>,
    #[serde(default)]
    pub z80_pending_cycles: f64,
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
            z80: Z80::new(),
            bus: M68kBus::new(),
            rom_path: None,
            frame_count: 0,
            rom_header: None,
            timing: TimingMode::Ntsc,
            region: SystemRegion::Usa,
            last_error: None,
            z80_pending_cycles: 0.0,
            audio_filter: GenesisAudioFilter::new(),
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
        self.bus.load_rom_with_path(rom, path.clone());
        self.cpu = M68k::new();
        self.z80 = Z80::new();
        self.cpu.reset(&mut self.bus);
        self.rom_path = path;
        self.frame_count = 0;
        self.last_error = None;
        self.z80_pending_cycles = 0.0;
        self.audio_filter.reset();
    }

    pub fn reset(&mut self) {
        self.bus.reset();
        self.configure_region_register();
        self.cpu.reset(&mut self.bus);
        self.z80.reset();
        self.frame_count = 0;
        self.last_error = None;
        self.z80_pending_cycles = 0.0;
        self.audio_filter.reset();
    }

    pub fn run_frame(&mut self) -> FrameRun {
        let started = Instant::now();
        let cycles_per_frame = self.current_m68k_frame_cycles();
        let mut cycles = 0u64;
        let mut steps = 0u64;
        let mut next_line = 1u64;
        let mut vblank_requested = false;
        let mut frame_rendered = false;
        let mut hit_unsupported_opcode = false;
        let z80_ratio = Self::Z80_CLOCK / Self::M68K_CLOCK;
        let z80_frame_start = self.z80.total_cycles;

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
                    self.bus.ym_frame_cycle = cycles;
                    self.bus.ym2612.sync_to_cycle(cycles);
                    if self.bus.take_z80_reset_request() {
                        self.z80.reset();
                    }
                    let dma_wait_cycles = self.bus.take_dma_wait_cycles();
                    if dma_wait_cycles != 0 {
                        cycles += u64::from(dma_wait_cycles);
                        self.z80_pending_cycles += f64::from(dma_wait_cycles) * z80_ratio;
                    }
                    self.z80_pending_cycles += f64::from(step_cycles) * z80_ratio;
                    self.interrupt_z80_for_ym_timer();
                    self.run_z80_until_budget();
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
                    self.bus.vdp.render_frame();
                    frame_rendered = true;
                    self.bus.vdp.frame_cycle = crate::vdp::Vdp::VBLANK_START_CYCLE;
                    self.bus.vdp.request_vblank();
                    self.interrupt_z80_for_vblank();
                    vblank_requested = true;
                }
                next_line += 1;
            }
        }

        let target_z80_cycles = Self::Z80_CLOCK / self.frame_rate();
        let z80_frame_cycles = self.z80.total_cycles.saturating_sub(z80_frame_start) as f64;
        if z80_frame_cycles < target_z80_cycles {
            self.z80_pending_cycles += target_z80_cycles - z80_frame_cycles;
            self.run_z80_until_budget();
        }
        self.bus.ym_frame_cycle = cycles_per_frame;
        self.bus.ym2612.sync_to_cycle(cycles_per_frame);
        self.interrupt_z80_for_ym_timer();

        if !frame_rendered {
            self.bus.vdp.render_frame();
        }
        if !vblank_requested {
            self.bus.vdp.frame_cycle = crate::vdp::Vdp::VBLANK_START_CYCLE;
            self.bus.vdp.request_vblank();
            self.interrupt_z80_for_vblank();
        }
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

    pub fn render_audio_frame_i16(&mut self, sample_rate: usize) -> Vec<i16> {
        let sample_rate = sample_rate.max(1);
        let count = ((sample_rate as f64 / self.frame_rate()).round() as usize).max(1);
        let psg_cycles = Self::Z80_CLOCK / self.frame_rate();
        let ym_cycles = self.current_m68k_frame_cycles() as f64;
        let psg_samples = self
            .bus
            .psg
            .render_frame_samples(count, psg_cycles, sample_rate);
        let ym_samples = self
            .bus
            .ym2612
            .render_frame_mono_samples(count, ym_cycles, sample_rate);

        psg_samples
            .into_iter()
            .zip(ym_samples)
            .map(|(psg, ym)| {
                let psg = self.audio_filter.filter_psg(f64::from(psg), sample_rate);
                let ym = self.audio_filter.filter_ym(f64::from(ym), sample_rate);
                let mixed = (ym * Audio::YM_GAIN) + (psg * Audio::PSG_GAIN);
                (mixed.clamp(-1.0, 1.0) * f64::from(i16::MAX)) as i16
            })
            .collect()
    }

    pub fn frame_rgba(&self) -> Vec<u8> {
        let (width, height) = self.frame_size();
        let mut rgba = Vec::with_capacity(width * height * 4);
        for &pixel in self.framebuffer().iter().take(width * height) {
            rgba.push(((pixel >> 16) & 0xff) as u8);
            rgba.push(((pixel >> 8) & 0xff) as u8);
            rgba.push((pixel & 0xff) as u8);
            rgba.push(0xff);
        }
        rgba
    }

    pub fn snapshot(&self) -> EmulatorSnapshot {
        EmulatorSnapshot {
            cpu: self.cpu.clone(),
            z80: self.z80.clone(),
            bus: self.bus.snapshot(),
            frame_count: self.frame_count,
            rom_header: self.rom_header.clone(),
            timing: self.timing,
            region: self.region,
            last_error: self.last_error.clone(),
            z80_pending_cycles: self.z80_pending_cycles,
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: EmulatorSnapshot) {
        self.cpu = snapshot.cpu;
        self.z80 = snapshot.z80;
        self.bus.restore_snapshot(snapshot.bus);
        self.frame_count = snapshot.frame_count;
        self.rom_header = snapshot.rom_header;
        self.timing = snapshot.timing;
        self.region = snapshot.region;
        self.last_error = snapshot.last_error;
        self.z80_pending_cycles = snapshot.z80_pending_cycles;
        self.audio_filter.reset();
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

    fn run_z80_until_budget(&mut self) {
        const Z80_BATCH_CYCLES: f64 = 32.0;

        while self.z80_pending_cycles >= Z80_BATCH_CYCLES && self.bus.z80_running() {
            let before = self.z80.total_cycles;
            self.z80.run_cycles(&mut self.bus, Z80_BATCH_CYCLES);
            let ran = self.z80.total_cycles.saturating_sub(before);
            if ran == 0 {
                break;
            }
            self.z80_pending_cycles -= ran as f64;
        }

        if !self.bus.z80_running() {
            self.z80_pending_cycles = self.z80_pending_cycles.min(Z80_BATCH_CYCLES);
        }
    }

    fn interrupt_z80_for_vblank(&mut self) {
        if self.bus.z80_running() {
            let cycles = self.z80.interrupt(&mut self.bus, 0xff);
            self.z80_pending_cycles = (self.z80_pending_cycles - f64::from(cycles)).max(0.0);
        }
    }

    fn interrupt_z80_for_ym_timer(&mut self) {
        if self.bus.z80_running() && self.bus.ym2612.irq_asserted() {
            let cycles = self.z80.interrupt(&mut self.bus, 0xff);
            self.z80_pending_cycles = (self.z80_pending_cycles - f64::from(cycles)).max(0.0);
        }
    }
}
