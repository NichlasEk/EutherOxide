use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MemoryTarget {
    Vram,
    Cram,
    Vsram,
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VdpDmaMode {
    MemoryToVdp,
    Fill,
    Copy,
}

#[derive(Clone, Copy)]
struct PlaneParams {
    name_base: usize,
    width_cells: usize,
    map_width: usize,
    map_height: usize,
    hscroll: usize,
    vscroll: usize,
}

#[derive(Clone, Debug)]
pub struct Vdp {
    pub registers: [u8; Self::NUM_REGISTERS],
    pub vram: Vec<u8>,
    pub cram: [u16; Self::CRAM_SIZE],
    pub vsram: [u16; Self::VSRAM_SIZE],
    pub framebuffer: Vec<u32>,
    pub screen_width: usize,
    pub screen_height: usize,
    pub irq_level: u8,
    pub frame_cycle: u64,
    control_pending: bool,
    control_latch: u16,
    address: u32,
    mode_write: bool,
    location_bits: u8,
    dma_active: bool,
    status: u16,
    h_interrupt_pending: bool,
    v_interrupt_pending: bool,
    h_interrupt_counter: i16,
    render_version: u64,
    video_dirty: bool,
    vblank_counter_pending: bool,
    interlace_field: u8,
    dma_pending: Option<VdpDmaMode>,
    dma_fill_pending: bool,
    pub vram_writes: u64,
    pub vram_nonzero_writes: u64,
    pub vram_pattern_writes: u64,
    pub vram_pattern_nonzero_writes: u64,
    pub cram_writes: u64,
    pub cram_nonzero_writes: u64,
    pub vsram_writes: u64,
    pub dma_transfers: u64,
    pub dma_last_source: u32,
    pub dma_last_target: u32,
    pub dma_last_length: usize,
    pub dma_min_target: u32,
    pub dma_max_target: u32,
    pub dma_pattern_transfers: u64,
    pub dma_pattern_nonzero_words: u64,
    pub dma_pattern_last_source: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VdpSnapshot {
    registers: Vec<u8>,
    vram: Vec<u8>,
    cram: Vec<u16>,
    vsram: Vec<u16>,
    framebuffer: Vec<u32>,
    screen_width: usize,
    screen_height: usize,
    irq_level: u8,
    frame_cycle: u64,
    control_pending: bool,
    control_latch: u16,
    address: u32,
    mode_write: bool,
    location_bits: u8,
    dma_active: bool,
    status: u16,
    h_interrupt_pending: bool,
    v_interrupt_pending: bool,
    h_interrupt_counter: i16,
    render_version: u64,
    video_dirty: bool,
    vblank_counter_pending: bool,
    interlace_field: u8,
    dma_pending: Option<VdpDmaMode>,
    dma_fill_pending: bool,
    vram_writes: u64,
    #[serde(default)]
    vram_nonzero_writes: u64,
    #[serde(default)]
    vram_pattern_writes: u64,
    #[serde(default)]
    vram_pattern_nonzero_writes: u64,
    cram_writes: u64,
    cram_nonzero_writes: u64,
    vsram_writes: u64,
    dma_transfers: u64,
    dma_last_source: u32,
    dma_last_target: u32,
    dma_last_length: usize,
    dma_min_target: u32,
    dma_max_target: u32,
    #[serde(default)]
    dma_pattern_transfers: u64,
    #[serde(default)]
    dma_pattern_nonzero_words: u64,
    #[serde(default)]
    dma_pattern_last_source: u32,
}

impl Default for Vdp {
    fn default() -> Self {
        Self::new()
    }
}

impl Vdp {
    pub const DEFAULT_WIDTH: usize = 256;
    pub const H40_WIDTH: usize = 320;
    pub const DEFAULT_HEIGHT: usize = 224;
    pub const VRAM_SIZE: usize = 0x1_0000;
    pub const CRAM_SIZE: usize = 0x40;
    pub const VSRAM_SIZE: usize = 0x40;
    pub const NUM_REGISTERS: usize = 0x20;
    pub const LINE_CYCLES: u64 = 228;
    pub const VISIBLE_LINES: u64 = 224;
    pub const TOTAL_LINES: u64 = 262;
    pub const FRAME_CYCLES: u64 = Self::LINE_CYCLES * Self::TOTAL_LINES;
    pub const VBLANK_START_CYCLE: u64 = Self::LINE_CYCLES * Self::VISIBLE_LINES;

    pub fn new() -> Self {
        let mut vdp = Self {
            registers: [0; Self::NUM_REGISTERS],
            vram: vec![0; Self::VRAM_SIZE],
            cram: [0; Self::CRAM_SIZE],
            vsram: [0; Self::VSRAM_SIZE],
            framebuffer: vec![0; Self::DEFAULT_WIDTH * Self::DEFAULT_HEIGHT],
            screen_width: Self::DEFAULT_WIDTH,
            screen_height: Self::DEFAULT_HEIGHT,
            irq_level: 0,
            frame_cycle: 0,
            control_pending: false,
            control_latch: 0,
            address: 0,
            mode_write: false,
            location_bits: 0,
            dma_active: false,
            status: 0x3400,
            h_interrupt_pending: false,
            v_interrupt_pending: false,
            h_interrupt_counter: -1,
            render_version: 0,
            video_dirty: true,
            vblank_counter_pending: false,
            interlace_field: 0,
            dma_pending: None,
            dma_fill_pending: false,
            vram_writes: 0,
            vram_nonzero_writes: 0,
            vram_pattern_writes: 0,
            vram_pattern_nonzero_writes: 0,
            cram_writes: 0,
            cram_nonzero_writes: 0,
            vsram_writes: 0,
            dma_transfers: 0,
            dma_last_source: 0,
            dma_last_target: 0,
            dma_last_length: 0,
            dma_min_target: u32::MAX,
            dma_max_target: 0,
            dma_pattern_transfers: 0,
            dma_pattern_nonzero_words: 0,
            dma_pattern_last_source: 0,
        };
        vdp.reset();
        vdp
    }

    pub fn reset(&mut self) {
        self.registers = [0; Self::NUM_REGISTERS];
        self.vram.fill(0);
        self.cram = [0; Self::CRAM_SIZE];
        self.vsram = [0; Self::VSRAM_SIZE];
        self.screen_width = Self::DEFAULT_WIDTH;
        self.screen_height = Self::DEFAULT_HEIGHT;
        self.framebuffer
            .resize(self.screen_width * self.screen_height, 0);
        self.framebuffer.fill(0);
        self.frame_cycle = 0;
        self.control_pending = false;
        self.control_latch = 0;
        self.address = 0;
        self.mode_write = false;
        self.location_bits = 0;
        self.dma_active = false;
        self.status = 0x3400;
        self.h_interrupt_pending = false;
        self.v_interrupt_pending = false;
        self.h_interrupt_counter = -1;
        self.irq_level = 0;
        self.render_version = 0;
        self.video_dirty = true;
        self.vblank_counter_pending = false;
        self.interlace_field = 0;
        self.dma_pending = None;
        self.dma_fill_pending = false;
        self.vram_writes = 0;
        self.vram_nonzero_writes = 0;
        self.vram_pattern_writes = 0;
        self.vram_pattern_nonzero_writes = 0;
        self.cram_writes = 0;
        self.cram_nonzero_writes = 0;
        self.vsram_writes = 0;
        self.dma_transfers = 0;
        self.dma_last_source = 0;
        self.dma_last_target = 0;
        self.dma_last_length = 0;
        self.dma_min_target = u32::MAX;
        self.dma_max_target = 0;
        self.dma_pattern_transfers = 0;
        self.dma_pattern_nonzero_words = 0;
        self.dma_pattern_last_source = 0;
    }

    pub fn snapshot(&self) -> VdpSnapshot {
        VdpSnapshot {
            registers: self.registers.to_vec(),
            vram: self.vram.clone(),
            cram: self.cram.to_vec(),
            vsram: self.vsram.to_vec(),
            framebuffer: self.framebuffer.clone(),
            screen_width: self.screen_width,
            screen_height: self.screen_height,
            irq_level: self.irq_level,
            frame_cycle: self.frame_cycle,
            control_pending: self.control_pending,
            control_latch: self.control_latch,
            address: self.address,
            mode_write: self.mode_write,
            location_bits: self.location_bits,
            dma_active: self.dma_active,
            status: self.status,
            h_interrupt_pending: self.h_interrupt_pending,
            v_interrupt_pending: self.v_interrupt_pending,
            h_interrupt_counter: self.h_interrupt_counter,
            render_version: self.render_version,
            video_dirty: self.video_dirty,
            vblank_counter_pending: self.vblank_counter_pending,
            interlace_field: self.interlace_field,
            dma_pending: self.dma_pending,
            dma_fill_pending: self.dma_fill_pending,
            vram_writes: self.vram_writes,
            vram_nonzero_writes: self.vram_nonzero_writes,
            vram_pattern_writes: self.vram_pattern_writes,
            vram_pattern_nonzero_writes: self.vram_pattern_nonzero_writes,
            cram_writes: self.cram_writes,
            cram_nonzero_writes: self.cram_nonzero_writes,
            vsram_writes: self.vsram_writes,
            dma_transfers: self.dma_transfers,
            dma_last_source: self.dma_last_source,
            dma_last_target: self.dma_last_target,
            dma_last_length: self.dma_last_length,
            dma_min_target: self.dma_min_target,
            dma_max_target: self.dma_max_target,
            dma_pattern_transfers: self.dma_pattern_transfers,
            dma_pattern_nonzero_words: self.dma_pattern_nonzero_words,
            dma_pattern_last_source: self.dma_pattern_last_source,
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: VdpSnapshot) {
        self.registers = [0; Self::NUM_REGISTERS];
        for (slot, value) in self.registers.iter_mut().zip(snapshot.registers) {
            *slot = value;
        }
        self.vram = snapshot.vram;
        if self.vram.len() != Self::VRAM_SIZE {
            self.vram.resize(Self::VRAM_SIZE, 0);
        }
        self.cram = [0; Self::CRAM_SIZE];
        for (slot, value) in self.cram.iter_mut().zip(snapshot.cram) {
            *slot = value;
        }
        self.vsram = [0; Self::VSRAM_SIZE];
        for (slot, value) in self.vsram.iter_mut().zip(snapshot.vsram) {
            *slot = value;
        }
        self.framebuffer = snapshot.framebuffer;
        self.screen_width = snapshot.screen_width;
        self.screen_height = snapshot.screen_height;
        self.irq_level = snapshot.irq_level;
        self.frame_cycle = snapshot.frame_cycle;
        self.control_pending = snapshot.control_pending;
        self.control_latch = snapshot.control_latch;
        self.address = snapshot.address;
        self.mode_write = snapshot.mode_write;
        self.location_bits = snapshot.location_bits;
        self.dma_active = snapshot.dma_active;
        self.status = snapshot.status;
        self.h_interrupt_pending = snapshot.h_interrupt_pending;
        self.v_interrupt_pending = snapshot.v_interrupt_pending;
        self.h_interrupt_counter = snapshot.h_interrupt_counter;
        self.render_version = snapshot.render_version;
        self.video_dirty = snapshot.video_dirty;
        self.vblank_counter_pending = snapshot.vblank_counter_pending;
        self.interlace_field = snapshot.interlace_field;
        self.dma_pending = snapshot.dma_pending;
        self.dma_fill_pending = snapshot.dma_fill_pending;
        self.vram_writes = snapshot.vram_writes;
        self.vram_nonzero_writes = snapshot.vram_nonzero_writes;
        self.vram_pattern_writes = snapshot.vram_pattern_writes;
        self.vram_pattern_nonzero_writes = snapshot.vram_pattern_nonzero_writes;
        self.cram_writes = snapshot.cram_writes;
        self.cram_nonzero_writes = snapshot.cram_nonzero_writes;
        self.vsram_writes = snapshot.vsram_writes;
        self.dma_transfers = snapshot.dma_transfers;
        self.dma_last_source = snapshot.dma_last_source;
        self.dma_last_target = snapshot.dma_last_target;
        self.dma_last_length = snapshot.dma_last_length;
        self.dma_min_target = snapshot.dma_min_target;
        self.dma_max_target = snapshot.dma_max_target;
        self.dma_pattern_transfers = snapshot.dma_pattern_transfers;
        self.dma_pattern_nonzero_words = snapshot.dma_pattern_nonzero_words;
        self.dma_pattern_last_source = snapshot.dma_pattern_last_source;
        self.ensure_framebuffer_size();
    }

    pub fn begin_frame(&mut self) {
        self.frame_cycle = 0;
        self.h_interrupt_counter = self.registers[10] as i16;
        self.h_interrupt_pending = false;
        self.update_irq_level();
    }

    pub fn tick_line_interrupt(&mut self, line: u64) {
        if line >= Self::VISIBLE_LINES {
            return;
        }
        if line == 0 || self.h_interrupt_counter < 0 {
            self.h_interrupt_counter = self.registers[10] as i16;
        }
        self.h_interrupt_counter -= 1;
        if self.h_interrupt_counter < 0 {
            if (self.registers[0] & 0x10) != 0 {
                self.h_interrupt_pending = true;
            }
            self.h_interrupt_counter = self.registers[10] as i16;
            self.update_irq_level();
        }
    }

    pub fn read_data(&mut self) -> u16 {
        self.control_pending = false;
        let word = match self.memory_target() {
            MemoryTarget::Cram => self.cram[((self.address >> 1) as usize) & (Self::CRAM_SIZE - 1)],
            MemoryTarget::Vsram => {
                self.vsram[((self.address >> 1) as usize) & (Self::VSRAM_SIZE - 1)]
            }
            _ => self.read_vram_word(self.address),
        };
        self.increment_address();
        word
    }

    pub fn read_control(&mut self) -> u16 {
        self.control_pending = false;
        let mut status = self.status;
        if self.interlace_mode_2() {
            if self.interlace_field == 0 {
                status &= !0x0010;
            } else {
                status |= 0x0010;
            }
        }
        if self.vblank() {
            status |= 0x0008;
        } else {
            status &= !0x0008;
        }
        if self.hblank() || self.vblank() {
            status |= 0x0004;
        } else {
            status &= !0x0004;
        }
        status
    }

    pub fn read_hv_counter(&mut self) -> u16 {
        let mut v = self.v_counter();
        if self.vblank_counter_pending {
            v = 0xe0;
            self.vblank_counter_pending = false;
        }
        ((v as u16) << 8) | self.h_counter() as u16
    }

    pub fn write_data(&mut self, value: u16) {
        if self.dma_fill_pending {
            self.perform_dma_fill(value);
            return;
        }
        self.control_pending = false;
        self.write_data_direct(value);
    }

    pub fn write_data_byte(&mut self, _address: u32, value: u8) {
        self.write_data((value as u16) * 0x0101);
    }

    pub fn write_control(&mut self, value: u16) {
        if self.control_pending {
            self.address = (self.control_latch as u32 & 0x3fff) | (((value & 0x0007) as u32) << 14);
            self.location_bits = (self.location_bits & 0x01) | (((value >> 3) as u8) & 0x06);
            self.dma_active = self.dma_enabled() && (value & 0x0080) != 0;
            self.control_pending = false;
            if self.dma_active {
                self.dma_pending = Some(self.dma_mode());
                self.dma_active = false;
            }
        } else {
            self.control_latch = value;
            self.address = (self.address & 0x1c000) | (value as u32 & 0x3fff);

            if (value & 0xc000) == 0x8000 {
                let register = ((value >> 8) & 0x1f) as usize;
                let data = (value & 0xff) as u8;
                if self.registers[register] != data {
                    self.video_dirty = true;
                }
                self.registers[register] = data;
                self.update_screen_size();
                if register == 0 || register == 1 {
                    self.update_irq_level();
                }
                self.control_pending = false;
            } else {
                self.mode_write = (value & 0x4000) != 0;
                self.location_bits = (self.location_bits & 0x06) | (((value >> 15) as u8) & 0x01);
                self.control_pending = true;
            }
        }
    }

    pub fn write_control_byte(&mut self, _address: u32, value: u8) {
        self.write_control((value as u16) * 0x0101);
    }

    pub fn request_vblank(&mut self) {
        self.status |= 0x0080;
        self.vblank_counter_pending = true;
        self.v_interrupt_pending = true;
        self.update_irq_level();
    }

    pub fn end_vblank(&mut self) {
        self.status &= !0x0080;
        self.vblank_counter_pending = false;
        self.v_interrupt_pending = false;
        self.update_irq_level();
    }

    pub fn acknowledge_interrupt(&mut self, level: u8) {
        if level >= 6 {
            self.v_interrupt_pending = false;
        }
        if level >= 4 {
            self.h_interrupt_pending = false;
        }
        self.update_irq_level();
    }

    pub fn take_dma_request(&mut self) -> Option<VdpDmaMode> {
        self.dma_pending.take()
    }

    pub fn dma_length_words(&self) -> usize {
        let length = u16::from(self.registers[19]) | (u16::from(self.registers[20]) << 8);
        if length == 0 {
            0x1_0000
        } else {
            length as usize
        }
    }

    pub fn dma_source_address(&self) -> u32 {
        ((u32::from(self.registers[23] & 0x7f)) << 17)
            | (u32::from(self.registers[22]) << 9)
            | (u32::from(self.registers[21]) << 1)
    }

    pub fn dma_target_address(&self) -> u32 {
        self.address
    }

    pub fn record_dma_transfer(
        &mut self,
        source: u32,
        target: u32,
        length: usize,
        nonzero_words: usize,
    ) {
        self.dma_transfers += 1;
        self.dma_last_source = source;
        self.dma_last_target = target;
        self.dma_last_length = length;
        self.dma_min_target = self.dma_min_target.min(target);
        self.dma_max_target = self
            .dma_max_target
            .max(target.wrapping_add(length as u32 * 2));
        if target < 0xc000 {
            self.dma_pattern_transfers += 1;
            self.dma_pattern_nonzero_words += nonzero_words as u64;
            self.dma_pattern_last_source = source;
        }
    }

    pub fn write_dma_word(&mut self, value: u16) {
        self.control_pending = false;
        self.write_data_direct(value);
    }

    pub fn arm_dma_fill(&mut self) {
        self.dma_fill_pending = true;
    }

    pub fn perform_vram_copy_dma(&mut self) {
        let mut source = (u32::from(self.registers[22]) << 8) | u32::from(self.registers[21]);
        let length = self.dma_length_words();
        for _ in 0..length {
            let value = self.read_vram_word(source);
            self.write_data_direct(value);
            source = source.wrapping_add(2) & 0xffff;
        }
    }

    pub fn render_frame(&mut self) {
        self.interlace_field ^= 1;
        self.update_screen_size();
        self.ensure_framebuffer_size();

        let backdrop = self.palette_color((self.registers[7] & 0x3f) as usize);
        self.framebuffer.fill(backdrop);
        if !self.display_enabled() {
            self.render_version += 1;
            self.video_dirty = false;
            return;
        }

        self.draw_scroll_planes();
        self.draw_sprites();
        self.render_version += 1;
        self.video_dirty = false;
    }

    pub fn palette_color(&self, index: usize) -> u32 {
        let raw = self.cram[index & (Self::CRAM_SIZE - 1)];
        let levels = [0u32, 52, 87, 116, 144, 172, 206, 255];
        let r = levels[((raw >> 1) & 0x07) as usize];
        let g = levels[((raw >> 5) & 0x07) as usize];
        let b = levels[((raw >> 9) & 0x07) as usize];
        (r << 16) | (g << 8) | b
    }

    fn write_data_direct(&mut self, value: u16) {
        match self.memory_target() {
            MemoryTarget::Cram => {
                let index = ((self.address >> 1) as usize) & (Self::CRAM_SIZE - 1);
                self.cram[index] = value & 0x0fff;
                self.video_dirty = true;
                self.cram_writes += 1;
                if (value & 0x0fff) != 0 {
                    self.cram_nonzero_writes += 1;
                }
            }
            MemoryTarget::Vsram => {
                let index = ((self.address >> 1) as usize) & (Self::VSRAM_SIZE - 1);
                self.vsram[index] = value & 0x07ff;
                self.video_dirty = true;
                self.vsram_writes += 1;
            }
            MemoryTarget::Vram | MemoryTarget::Invalid => self.write_vram_word(self.address, value),
        }
        self.increment_address();
    }

    fn read_vram_word(&self, address: u32) -> u16 {
        let address = address as usize & 0xffff;
        let high = self.vram[address] as u16;
        let low = self.vram[(address ^ 1) & 0xffff] as u16;
        (high << 8) | low
    }

    fn write_vram_word(&mut self, address: u32, value: u16) {
        let address = address as usize & 0xffff;
        self.vram[address] = (value >> 8) as u8;
        self.vram[(address ^ 1) & 0xffff] = value as u8;
        self.video_dirty = true;
        self.vram_writes += 1;
        if value != 0 {
            self.vram_nonzero_writes += 1;
        }
        if address < 0xc000 {
            self.vram_pattern_writes += 1;
            if value != 0 {
                self.vram_pattern_nonzero_writes += 1;
            }
        }
    }

    fn increment_address(&mut self) {
        let increment = if self.registers[15] == 0 {
            2
        } else {
            self.registers[15] as u32
        };
        self.address = (self.address + increment) & 0xffff;
    }

    fn memory_target(&self) -> MemoryTarget {
        match (self.location_bits & 0x07, self.mode_write) {
            (0x00, _) | (0x06, false) => MemoryTarget::Vram,
            (0x01, true) | (0x04, false) => MemoryTarget::Cram,
            (0x02, _) => MemoryTarget::Vsram,
            _ => MemoryTarget::Invalid,
        }
    }

    fn update_irq_level(&mut self) {
        self.irq_level = if self.v_interrupt_pending && (self.registers[1] & 0x20) != 0 {
            6
        } else if self.h_interrupt_pending && (self.registers[0] & 0x10) != 0 {
            4
        } else {
            0
        };
    }

    fn update_screen_size(&mut self) {
        self.screen_width = if (self.registers[12] & 0x01) != 0 {
            Self::H40_WIDTH
        } else {
            Self::DEFAULT_WIDTH
        };
        self.screen_height = Self::DEFAULT_HEIGHT;
    }

    fn ensure_framebuffer_size(&mut self) {
        let required = self.screen_width * self.screen_height;
        if self.framebuffer.len() != required {
            self.framebuffer.resize(required, 0);
        }
    }

    fn display_enabled(&self) -> bool {
        (self.registers[1] & 0x40) != 0
    }

    fn hblank(&self) -> bool {
        (self.frame_cycle % Self::LINE_CYCLES) >= 170
    }

    fn vblank(&self) -> bool {
        self.frame_cycle >= Self::VBLANK_START_CYCLE
    }

    fn v_counter(&self) -> u8 {
        ((self.frame_cycle / Self::LINE_CYCLES).min(Self::TOTAL_LINES - 1) & 0xff) as u8
    }

    fn h_counter(&self) -> u8 {
        (((self.frame_cycle % Self::LINE_CYCLES) * 342 / Self::LINE_CYCLES).min(0xff)) as u8
    }

    fn dma_enabled(&self) -> bool {
        (self.registers[1] & 0x10) != 0
    }

    fn dma_mode(&self) -> VdpDmaMode {
        match self.registers[23] & 0xc0 {
            0x80 => VdpDmaMode::Fill,
            0xc0 => VdpDmaMode::Copy,
            _ => VdpDmaMode::MemoryToVdp,
        }
    }

    fn perform_dma_fill(&mut self, value: u16) {
        self.control_pending = false;
        self.dma_fill_pending = false;
        let fill = (value & 0x00ff) * 0x0101;
        let length = self.dma_length_words();
        for _ in 0..length {
            self.write_data_direct(fill);
        }
    }

    fn interlace_mode_2(&self) -> bool {
        (self.registers[12] & 0x06) == 0x06
    }

    fn draw_scroll_planes(&mut self) {
        let width = self.screen_width;
        let height = self.screen_height;
        let (plane_width_cells, plane_height_cells) = self.plane_dimensions();
        let map_width = plane_width_cells * 8;
        let map_height = plane_height_cells * 8;
        let plane_a = self.plane_a_base();
        let plane_b = self.plane_b_base();
        let hscroll_base = self.hscroll_base();
        let backdrop = self.palette_color((self.registers[7] & 0x3f) as usize);

        for y in 0..height {
            let hscroll_a = self.read_vram_word((hscroll_base + (y * 4)) as u32) as usize & 0x03ff;
            let hscroll_b =
                self.read_vram_word((hscroll_base + (y * 4) + 2) as u32) as usize & 0x03ff;
            let vscroll_a = self.vsram[0] as usize & 0x03ff;
            let vscroll_b = self.vsram[1] as usize & 0x03ff;

            for x in 0..width {
                let b = self.plane_pixel(
                    PlaneParams {
                        name_base: plane_b,
                        width_cells: plane_width_cells,
                        map_width,
                        map_height,
                        hscroll: hscroll_b,
                        vscroll: vscroll_b,
                    },
                    x,
                    y,
                );
                let a = self.plane_pixel(
                    PlaneParams {
                        name_base: plane_a,
                        width_cells: plane_width_cells,
                        map_width,
                        map_height,
                        hscroll: hscroll_a,
                        vscroll: vscroll_a,
                    },
                    x,
                    y,
                );
                let color_index = match (a, b) {
                    (Some(pa), Some(pb)) if (pa & 0x100) == 0 && (pb & 0x100) != 0 => pb & 0x3f,
                    (Some(pa), _) => pa & 0x3f,
                    (None, Some(pb)) => pb & 0x3f,
                    _ => {
                        self.framebuffer[y * width + x] = backdrop;
                        continue;
                    }
                };
                self.framebuffer[y * width + x] = self.palette_color(color_index);
            }
        }
    }

    fn draw_sprites(&mut self) {
        let sprite_base = self.sprite_table_base();
        let mut sprite_index = 0usize;
        let max_sprites = if self.screen_width == Self::H40_WIDTH {
            80
        } else {
            64
        };

        for _ in 0..max_sprites {
            let entry = (sprite_base + sprite_index * 8) & 0xffff;
            let y_raw = self.read_vram_word(entry as u32) & 0x03ff;
            let size_link = self.read_vram_word((entry + 2) as u32);
            let attr = self.read_vram_word((entry + 4) as u32);
            let x_raw = self.read_vram_word((entry + 6) as u32) & 0x01ff;
            let link = (size_link & 0x7f) as usize;
            let width_cells = (((size_link >> 8) & 0x03) + 1) as usize;
            let height_cells = (((size_link >> 10) & 0x03) + 1) as usize;
            let x = x_raw as i32 - 128;
            let y = y_raw as i32 - 128;
            let h_flip = (attr & 0x0800) != 0;
            let v_flip = (attr & 0x1000) != 0;
            let palette = ((attr >> 9) as usize) & 0x30;
            let pattern = attr as usize & 0x07ff;

            if x > -(width_cells as i32 * 8)
                && y > -(height_cells as i32 * 8)
                && x < self.screen_width as i32
                && y < self.screen_height as i32
            {
                self.draw_sprite_tiles(
                    x,
                    y,
                    width_cells,
                    height_cells,
                    pattern,
                    palette,
                    h_flip,
                    v_flip,
                );
            }

            if link == 0 || link == sprite_index {
                break;
            }
            sprite_index = link;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_sprite_tiles(
        &mut self,
        x: i32,
        y: i32,
        width_cells: usize,
        height_cells: usize,
        pattern: usize,
        palette: usize,
        h_flip: bool,
        v_flip: bool,
    ) {
        let sprite_width = width_cells * 8;
        let sprite_height = height_cells * 8;
        for local_y in 0..sprite_height {
            let source_y = if v_flip {
                sprite_height - 1 - local_y
            } else {
                local_y
            };
            let tile_y = source_y / 8;
            let row = source_y & 7;
            let screen_y = y + local_y as i32;
            if !(0..self.screen_height as i32).contains(&screen_y) {
                continue;
            }

            for local_x in 0..sprite_width {
                let source_x = if h_flip {
                    sprite_width - 1 - local_x
                } else {
                    local_x
                };
                let tile_x = source_x / 8;
                let col = source_x & 7;
                let screen_x = x + local_x as i32;
                if !(0..self.screen_width as i32).contains(&screen_x) {
                    continue;
                }

                let tile = pattern + tile_y * width_cells + tile_x;
                let color = self.pattern_color(tile, row, col);
                if color == 0 {
                    continue;
                }
                let index = screen_y as usize * self.screen_width + screen_x as usize;
                self.framebuffer[index] = self.palette_color(palette | color);
            }
        }
    }

    fn plane_pixel(&self, plane: PlaneParams, screen_x: usize, screen_y: usize) -> Option<usize> {
        let source_x = (screen_x + plane.map_width - (plane.hscroll & (plane.map_width - 1)))
            & (plane.map_width - 1);
        let source_y = (screen_y + plane.vscroll) & (plane.map_height - 1);
        let cell_x = source_x >> 3;
        let cell_y = source_y >> 3;
        let entry_address = (plane.name_base + 2 * (cell_y * plane.width_cells + cell_x)) & 0xffff;
        let entry = self.read_vram_word(entry_address as u32);
        let mut row = source_y & 7;
        let mut col = source_x & 7;
        if (entry & 0x1000) != 0 {
            row = 7 - row;
        }
        if (entry & 0x0800) != 0 {
            col = 7 - col;
        }
        let pattern = entry as usize & 0x07ff;
        let color = self.pattern_color(pattern, row, col);
        if color == 0 {
            None
        } else {
            let palette = ((entry >> 9) as usize) & 0x30;
            let priority = if (entry & 0x8000) != 0 { 0x100 } else { 0 };
            Some(priority | palette | color)
        }
    }

    fn plane_dimensions(&self) -> (usize, usize) {
        match self.registers[16] & 0x03 {
            0 => (32, 32),
            1 => (64, 32),
            2 => (32, 64),
            _ => (128, 32),
        }
    }

    fn plane_a_base(&self) -> usize {
        ((self.registers[2] as usize & 0x38) << 10) & 0xffff
    }

    fn plane_b_base(&self) -> usize {
        ((self.registers[4] as usize & 0x07) << 13) & 0xffff
    }

    fn hscroll_base(&self) -> usize {
        ((self.registers[13] as usize & 0x3f) << 10) & 0xffff
    }

    fn sprite_table_base(&self) -> usize {
        if self.screen_width == Self::H40_WIDTH {
            ((self.registers[5] as usize & 0x7e) << 9) & 0xffff
        } else {
            ((self.registers[5] as usize & 0x7f) << 9) & 0xffff
        }
    }

    fn pattern_color(&self, pattern: usize, row: usize, col: usize) -> usize {
        let tile_address = (pattern * 32 + row * 4) & 0xffff;
        let packed = ((self.vram[tile_address] as u32) << 24)
            | ((self.vram[(tile_address + 1) & 0xffff] as u32) << 16)
            | ((self.vram[(tile_address + 2) & 0xffff] as u32) << 8)
            | self.vram[(tile_address + 3) & 0xffff] as u32;
        ((packed >> ((7 - col) * 4)) & 0x0f) as usize
    }
}
