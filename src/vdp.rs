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
struct VdpLineSnapshot {
    registers: [u8; Vdp::NUM_REGISTERS],
    vsram: [u16; Vdp::VSRAM_SIZE],
    sprite_table: Option<Vec<u8>>,
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
    line_snapshots: Vec<Option<VdpLineSnapshot>>,
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
    const VSRAM_VALID_WORDS: usize = 40;
    const VSRAM_COLUMN_PAIRS: usize = Self::VSRAM_VALID_WORDS / 2;
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
            line_snapshots: Vec::new(),
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
        self.line_snapshots.clear();
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
        self.line_snapshots = vec![None; Self::VISIBLE_LINES as usize];
        self.capture_line(0);
        self.update_irq_level();
    }

    pub fn capture_line(&mut self, line: u64) {
        if line >= Self::VISIBLE_LINES {
            return;
        }
        let sprite_table = self
            .interlace_mode_2()
            .then(|| self.capture_sprite_table(&self.registers));
        self.line_snapshots[line as usize] = Some(VdpLineSnapshot {
            registers: self.registers,
            vsram: self.vsram,
            sprite_table,
        });
    }

    fn capture_current_line_snapshot(&mut self) {
        if self.line_snapshots.is_empty() {
            return;
        }
        self.capture_line(u64::from(self.v_counter()));
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
                self.vsram[((self.address >> 1) as usize) % Self::VSRAM_VALID_WORDS]
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
        if self.hblank() || (self.status & 0x0080) != 0 {
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
                let previous = self.registers[register];
                if previous != data {
                    self.video_dirty = true;
                }
                self.registers[register] = data;
                self.update_screen_size();
                if register == 0 || register == 1 {
                    self.update_irq_level();
                }
                if previous != data {
                    self.capture_current_line_snapshot();
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

    pub fn advance_memory_dma_word(&mut self) {
        self.increment_dma_source_address();
        self.decrement_dma_length();
    }

    pub fn arm_dma_fill(&mut self) {
        self.dma_fill_pending = true;
    }

    pub fn perform_vram_copy_dma(&mut self) {
        let mut source = self.dma_vram_copy_source_address();
        let length = self.dma_length_words();
        for _ in 0..length {
            let address = source as usize & 0xffff;
            let value =
                ((self.vram[address] as u16) << 8) | self.vram[(address + 1) & 0xffff] as u16;
            self.write_data_direct(value);
            self.decrement_dma_length();
            source = source.wrapping_add(2) & 0xffff;
        }
        self.write_dma_vram_copy_source_address(source);
    }

    fn dma_vram_copy_source_address(&self) -> u32 {
        (u32::from(self.registers[21])
            | (u32::from(self.registers[22]) << 8)
            | (u32::from(self.registers[23] & 0x3f) << 16))
            & 0xffff
    }

    fn write_dma_vram_copy_source_address(&mut self, source: u32) {
        let source = source & 0xffff;
        self.registers[21] = source as u8;
        self.registers[22] = (source >> 8) as u8;
        self.registers[23] = (self.registers[23] & 0xc0) | ((source >> 16) as u8 & 0x3f);
    }

    pub fn render_frame(&mut self) {
        if self.interlace_mode_2() {
            self.interlace_field ^= 1;
        } else {
            self.interlace_field = 0;
        }
        self.update_screen_size();
        let framebuffer_len = self.framebuffer.len();
        self.ensure_framebuffer_size();
        if self.framebuffer.len() != framebuffer_len {
            self.video_dirty = true;
        }
        if !self.video_dirty {
            return;
        }

        let backdrop = (self.registers[7] & 0x3f) as usize;
        if !self.display_enabled() {
            let backdrop_color = self.palette_color(backdrop);
            self.framebuffer.fill(backdrop_color);
            self.render_version += 1;
            self.video_dirty = false;
            return;
        }

        let pixel_count = self.screen_width * self.screen_height;
        let mut scroll_pixels = vec![0; pixel_count];
        let mut sprite_pixels = vec![0; pixel_count];
        self.draw_scroll_planes(&mut scroll_pixels);
        self.draw_sprites(&mut sprite_pixels);
        for index in 0..pixel_count {
            let pixel =
                Self::resolve_sprite_scroll_pixel(sprite_pixels[index], scroll_pixels[index])
                    .unwrap_or(backdrop);
            let color = self.palette_color(pixel & 0x3f);
            self.framebuffer[index] = color;
        }
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
                let index = (self.address >> 1) as usize;
                self.write_vsram_word(index, value);
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

    fn write_memory_byte(&mut self, address: u32, value: u8) {
        let address = address as usize & 0xffff;
        match self.memory_target() {
            MemoryTarget::Cram => {
                let index = (address >> 1) & (Self::CRAM_SIZE - 1);
                let old = self.cram[index];
                let next = if (address & 1) == 0 {
                    (u16::from(value) << 8) | (old & 0x00ff)
                } else {
                    (old & 0xff00) | u16::from(value)
                } & 0x0fff;
                self.cram[index] = next;
                self.video_dirty = true;
                self.cram_writes += 1;
                if next != 0 {
                    self.cram_nonzero_writes += 1;
                }
            }
            MemoryTarget::Vsram => {
                let index = address >> 1;
                if index < Self::VSRAM_VALID_WORDS {
                    let old = self.vsram[index];
                    let next = if (address & 1) == 0 {
                        (u16::from(value) << 8) | (old & 0x00ff)
                    } else {
                        (old & 0xff00) | u16::from(value)
                    };
                    self.write_vsram_word(index, next);
                }
            }
            MemoryTarget::Vram | MemoryTarget::Invalid => {
                self.vram[address] = value;
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
        }
    }

    fn write_vsram_word(&mut self, index: usize, value: u16) {
        if index >= Self::VSRAM_VALID_WORDS {
            return;
        }
        self.vsram[index] = value & 0x07ff;
        self.video_dirty = true;
        self.vsram_writes += 1;
        self.capture_current_line_snapshot();
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
        self.screen_width = if (self.registers[12] & 0x81) != 0 {
            Self::H40_WIDTH
        } else {
            Self::DEFAULT_WIDTH
        };
        self.screen_height = if self.interlace_mode_2() {
            Self::DEFAULT_HEIGHT * 2
        } else {
            Self::DEFAULT_HEIGHT
        };
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
        let fill = (value >> 8) as u8;
        let length = self.dma_length_words();
        for _ in 0..length {
            self.write_memory_byte(self.address ^ 1, fill);
            self.increment_dma_source_address();
            self.decrement_dma_length();
            self.increment_address();
        }
    }

    fn interlace_mode_2(&self) -> bool {
        (self.registers[12] & 0x06) == 0x06
    }

    fn draw_scroll_planes(&self, pixels: &mut [usize]) {
        if self.interlace_mode_2() {
            self.draw_scroll_planes_interlace_mode_2(pixels);
            return;
        }

        let width = self.screen_width;
        let height = self.screen_height;
        let (plane_width_cells, plane_height_cells) = self.plane_dimensions();
        let cell_height = self.tile_cell_height();
        let map_width = plane_width_cells * 8;
        let map_height = plane_height_cells * cell_height;
        let plane_a = self.plane_a_base();
        let plane_b = self.plane_b_base();

        for y in 0..height {
            let hscroll_a = self.h_scroll_value(true, y);
            let hscroll_b = self.h_scroll_value(false, y);

            for x in 0..width {
                let column = x / 16;
                let vscroll_a = self.v_scroll_value_for_column(true, column);
                let vscroll_b = self.v_scroll_value_for_column(false, column);
                let index = y * width + x;
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
                let a = if self.window_active(x, y) {
                    self.window_pixel(x, y)
                } else {
                    self.plane_pixel(
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
                    )
                };
                pixels[index] =
                    Self::resolve_scroll_pixel(a.unwrap_or(0), b.unwrap_or(0)).unwrap_or(0);
            }
        }
    }

    fn draw_scroll_planes_interlace_mode_2(&self, pixels: &mut [usize]) {
        let width = self.screen_width;
        let height = self.screen_height;
        for y in 0..height {
            let scanline = y >> 1;
            let snapshot = self.line_snapshot(scanline);
            for x in 0..width {
                let index = y * width + x;
                let b = self.plane_pixel_interlace_mode_2(false, x, y, snapshot);
                let a = if self.window_active(x, y) {
                    self.window_pixel(x, y)
                } else {
                    self.plane_pixel_interlace_mode_2(true, x, y, snapshot)
                };
                pixels[index] =
                    Self::resolve_scroll_pixel(a.unwrap_or(0), b.unwrap_or(0)).unwrap_or(0);
            }
        }
    }

    fn draw_sprites(&self, pixels: &mut [usize]) {
        if self.interlace_mode_2() {
            self.draw_sprites_interlace_mode_2(pixels);
            return;
        }

        let sprite_base = self.sprite_table_base();
        let mut sprite_index = 0usize;
        let max_sprites = if self.screen_width == Self::H40_WIDTH {
            80
        } else {
            64
        };
        let max_line_sprites = if self.screen_width == Self::H40_WIDTH {
            20
        } else {
            16
        };
        let max_line_sprite_cells = if self.screen_width == Self::H40_WIDTH {
            40
        } else {
            32
        };
        let mut occupied = vec![false; self.screen_width * self.screen_height];
        let mut line_sprite_counts = vec![0usize; self.screen_height];
        let mut line_sprite_cells = vec![0usize; self.screen_height];
        let mut line_sprite_mask_allowed = vec![false; self.screen_height];
        let mut line_sprite_masked = vec![false; self.screen_height];

        for _ in 0..max_sprites {
            let entry = (sprite_base + sprite_index * 8) & 0xffff;
            let y_mask = if self.interlace_mode_2() {
                0x03ff
            } else {
                0x01ff
            };
            let y_raw = self.read_vram_word(entry as u32) & y_mask;
            let size_link = self.read_vram_word((entry + 2) as u32);
            let attr = self.read_vram_word((entry + 4) as u32);
            let x_raw = self.read_vram_word((entry + 6) as u32) & 0x01ff;
            let link = (size_link & 0x7f) as usize;
            let width_cells = (((size_link >> 10) & 0x03) + 1) as usize;
            let height_cells = (((size_link >> 8) & 0x03) + 1) as usize;
            let x = x_raw as i32 - 128;
            let sprite_y_base = if self.interlace_mode_2() { 0x100 } else { 0x80 };
            let y = y_raw as i32 - sprite_y_base;
            let h_flip = (attr & 0x0800) != 0;
            let v_flip = (attr & 0x1000) != 0;
            let palette = ((attr >> 9) as usize) & 0x30;
            let pattern = attr as usize & 0x07ff;
            let priority = (attr & 0x8000) != 0;
            let sprite_height = height_cells * self.tile_cell_height();

            if y > -(sprite_height as i32) && y < self.screen_height as i32 {
                self.draw_sprite_tiles(
                    pixels,
                    &mut occupied,
                    &mut line_sprite_counts,
                    &mut line_sprite_cells,
                    &mut line_sprite_mask_allowed,
                    &mut line_sprite_masked,
                    x,
                    y,
                    x_raw,
                    width_cells,
                    height_cells,
                    max_line_sprites,
                    max_line_sprite_cells,
                    pattern,
                    palette,
                    priority,
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

    fn draw_sprites_interlace_mode_2(&self, pixels: &mut [usize]) {
        let max_sprites = if self.screen_width == Self::H40_WIDTH {
            80
        } else {
            64
        };
        for scanline in 0..Self::VISIBLE_LINES as usize {
            let snapshot = self.line_snapshot(scanline);
            for field in 0..2 {
                let output_y = (scanline << 1) | field;
                if output_y >= self.screen_height {
                    continue;
                }
                let mut occupied = vec![false; self.screen_width];
                self.draw_sprite_line_interlace_mode_2(
                    pixels,
                    snapshot.and_then(|snapshot| snapshot.sprite_table.as_deref()),
                    output_y,
                    max_sprites,
                    &mut occupied,
                );
            }
        }
    }

    fn draw_sprite_line_interlace_mode_2(
        &self,
        pixels: &mut [usize],
        sprite_table: Option<&[u8]>,
        output_y: usize,
        max_sprites: usize,
        occupied: &mut [bool],
    ) {
        let sprite_table_base = self.sprite_table_base();
        let mut sprite_index = 0usize;
        for _ in 0..max_sprites {
            let entry = sprite_index * 8;
            let y_raw = self.sprite_table_word(sprite_table, sprite_table_base, entry) & 0x03ff;
            let size_link = self.sprite_table_word(sprite_table, sprite_table_base, entry + 2);
            let attr = self.sprite_table_word(sprite_table, sprite_table_base, entry + 4);
            let x_raw = self.sprite_table_word(sprite_table, sprite_table_base, entry + 6) & 0x01ff;
            let link = (size_link & 0x7f) as usize;
            let width_cells = (((size_link >> 10) & 0x03) + 1) as usize;
            let height_cells = (((size_link >> 8) & 0x03) + 1) as usize;
            let screen_x = x_raw as i32 - 0x80;
            let screen_y = y_raw as i32 - 0x100;
            let sprite_height = height_cells * 16;

            if output_y as i32 >= screen_y && (output_y as i32) < screen_y + sprite_height as i32 {
                self.draw_sprite_line_pixels_interlace_mode_2(
                    pixels,
                    output_y,
                    screen_x,
                    (output_y as i32 - screen_y) as usize,
                    width_cells,
                    height_cells,
                    attr as usize,
                    occupied,
                );
            }

            if link == 0 || link == sprite_index {
                break;
            }
            sprite_index = link;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_sprite_line_pixels_interlace_mode_2(
        &self,
        pixels: &mut [usize],
        output_y: usize,
        screen_x: i32,
        sprite_y: usize,
        width_cells: usize,
        height_cells: usize,
        attr: usize,
        occupied: &mut [bool],
    ) {
        let pattern = attr & 0x07ff;
        let h_flip = (attr & 0x0800) != 0;
        let v_flip = (attr & 0x1000) != 0;
        let palette = (attr >> 9) & 0x30;
        let priority = (attr & 0x8000) != 0;
        let tile_y = if v_flip {
            height_cells - 1 - (sprite_y >> 4)
        } else {
            sprite_y >> 4
        };
        let row = if v_flip {
            15 - (sprite_y & 0x0f)
        } else {
            sprite_y & 0x0f
        };
        let sprite_width = width_cells * 8;
        for sx in 0..sprite_width {
            let x = screen_x + sx as i32;
            if !(0..self.screen_width as i32).contains(&x) {
                continue;
            }
            let x = x as usize;
            if occupied[x] {
                continue;
            }

            let mut tile_x = sx >> 3;
            let mut col = sx & 7;
            if h_flip {
                tile_x = width_cells - 1 - tile_x;
                col = 7 - col;
            }
            let tile = (pattern + tile_x * height_cells + tile_y) & 0x07ff;
            let color = self.pattern_color(tile, row, col);
            if color == 0 {
                continue;
            }
            let index = output_y * self.screen_width + x;
            let current = pixels[index];
            if priority || (current & 0x100) == 0 {
                pixels[index] = (if priority { 0x100 } else { 0 }) | palette | color;
            }
            occupied[x] = true;
        }
    }

    fn sprite_table_word(
        &self,
        sprite_table: Option<&[u8]>,
        sprite_table_base: usize,
        offset: usize,
    ) -> u16 {
        if let Some(sprite_table) = sprite_table {
            let high = sprite_table.get(offset).copied().unwrap_or(0) as u16;
            let low = sprite_table.get(offset + 1).copied().unwrap_or(0) as u16;
            (high << 8) | low
        } else {
            self.read_vram_word((sprite_table_base + offset) as u32)
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn draw_sprite_tiles(
        &self,
        pixels: &mut [usize],
        occupied: &mut [bool],
        line_sprite_counts: &mut [usize],
        line_sprite_cells: &mut [usize],
        line_sprite_mask_allowed: &mut [bool],
        line_sprite_masked: &mut [bool],
        x: i32,
        y: i32,
        x_raw: u16,
        width_cells: usize,
        height_cells: usize,
        max_line_sprites: usize,
        max_line_sprite_cells: usize,
        pattern: usize,
        palette: usize,
        priority: bool,
        h_flip: bool,
        v_flip: bool,
    ) {
        let sprite_width = width_cells * 8;
        let cell_height = self.tile_cell_height();
        let row_mask = cell_height - 1;
        let sprite_height = height_cells * cell_height;
        for local_y in 0..sprite_height {
            let source_y = if v_flip {
                sprite_height - 1 - local_y
            } else {
                local_y
            };
            let tile_y = source_y / cell_height;
            let row = source_y & row_mask;
            let screen_y = y + local_y as i32;
            if !(0..self.screen_height as i32).contains(&screen_y) {
                continue;
            }
            let line = screen_y as usize;
            if line_sprite_masked[line] {
                continue;
            }
            if line_sprite_counts[line] >= max_line_sprites
                || line_sprite_cells[line] >= max_line_sprite_cells
            {
                continue;
            }
            line_sprite_counts[line] += 1;
            line_sprite_cells[line] = line_sprite_cells[line].saturating_add(width_cells);
            if x_raw == 0 {
                if line_sprite_mask_allowed[line] {
                    line_sprite_masked[line] = true;
                }
                continue;
            }
            line_sprite_mask_allowed[line] = true;

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

                let tile = (pattern + tile_x * height_cells + tile_y) & 0x07ff;
                let color = self.pattern_color(tile, row, col);
                if color == 0 {
                    continue;
                }
                let index = screen_y as usize * self.screen_width + screen_x as usize;
                if occupied[index] {
                    continue;
                }
                pixels[index] = (if priority { 0x100 } else { 0 }) | palette | color;
                occupied[index] = true;
            }
        }
    }

    fn plane_pixel_interlace_mode_2(
        &self,
        plane_a: bool,
        screen_x: usize,
        output_y: usize,
        snapshot: Option<&VdpLineSnapshot>,
    ) -> Option<usize> {
        let registers = snapshot.map_or(&self.registers, |snapshot| &snapshot.registers);
        let (plane_width_cells, plane_height_cells) = Self::plane_dimensions_from(registers);
        let map_height_mask = plane_height_cells * 16 - 1;
        let name_base = if plane_a {
            Self::plane_a_base_from(registers)
        } else {
            Self::plane_b_base_from(registers)
        };
        let hscroll = self.h_scroll_value_from(registers, plane_a, output_y >> 1) & 0x03ff;
        let scroll_offset = 16isize - (hscroll as isize & 0x0f);
        let screen_pair = (screen_x as isize + scroll_offset) >> 4;
        let vscroll_column = screen_pair - 1;
        let map_column = vscroll_column.max(0);
        let pair_offset = -((hscroll >> 4) as isize);
        let plane_width_mask = plane_width_cells - 1;
        let output_x = (screen_pair << 4) - scroll_offset;
        let local_x = screen_x as isize - output_x;
        let tile_x = (((pair_offset + map_column) << 1) as usize) & plane_width_mask;
        let cell = ((local_x >> 3) as usize) & 1;
        let scanline = output_y >> 1;
        let field = output_y & 1;
        let view_y = self.interlace_mode_2_view_y(
            plane_a,
            scanline,
            field,
            vscroll_column,
            map_height_mask,
            snapshot,
        );
        let row_word = (view_y >> 4) * plane_width_cells;
        let entry_address = (name_base
            + ((2 * (row_word + ((tile_x + cell) & plane_width_mask))) & 0x1fff))
            & 0xffff;
        let entry = self.read_vram_word(entry_address as u32);
        let mut row = view_y & 0x0f;
        let mut col = (local_x as usize) & 7;
        if (entry & 0x1000) != 0 {
            row = 15 - row;
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

    fn interlace_mode_2_view_y(
        &self,
        plane_a: bool,
        scanline: usize,
        field: usize,
        column: isize,
        map_height_mask: usize,
        snapshot: Option<&VdpLineSnapshot>,
    ) -> usize {
        let line_y = ((scanline << 1) | field) & 0x07ff;
        let registers = snapshot.map_or(&self.registers, |snapshot| &snapshot.registers);
        let vsram = snapshot.map_or(&self.vsram, |snapshot| &snapshot.vsram);
        let vscroll = if (registers[11] & 0x04) == 0 {
            vsram[if plane_a { 0 } else { 1 }] as usize
        } else if column < 0 {
            Self::interlace_mode_2_negative_column_vscroll(registers, vsram)
        } else {
            let index = Self::vscroll_pair_index_for_width(
                column as usize,
                Self::active_width_from(registers),
            );
            let vsram_index = index * 2 + usize::from(!plane_a);
            vsram[vsram_index] as usize
        };
        (line_y + (vscroll & 0x07ff)) & map_height_mask
    }

    fn interlace_mode_2_negative_column_vscroll(
        registers: &[u8; Self::NUM_REGISTERS],
        vsram: &[u16; Self::VSRAM_SIZE],
    ) -> usize {
        if Self::active_width_from(registers) != Self::H40_WIDTH {
            return 0;
        }
        let word_26 = vsram[0x26];
        let word_27 = vsram[0x27];
        let high = ((word_26 >> 8) & 0xff) & ((word_27 >> 8) & 0xff);
        let low = (word_26 & 0xff) & (word_27 & 0xff);
        ((high << 8) | low) as usize & 0x07ff
    }

    fn resolve_scroll_pixel(scroll_a: usize, scroll_b: usize) -> Option<usize> {
        let a_visible = Self::raw_pixel_visible(scroll_a);
        let b_visible = Self::raw_pixel_visible(scroll_b);
        let b_priority = b_visible && (scroll_b & 0x100) != 0;

        if a_visible && ((scroll_a & 0x100) != 0 || !b_priority) {
            return Some(scroll_a);
        }
        if b_visible {
            return Some(scroll_b);
        }
        a_visible.then_some(scroll_a)
    }

    fn resolve_sprite_scroll_pixel(sprite: usize, scroll: usize) -> Option<usize> {
        let sprite_visible = Self::raw_pixel_visible(sprite);
        let scroll_visible = Self::raw_pixel_visible(scroll);
        let scroll_priority = scroll_visible && (scroll & 0x100) != 0;

        if sprite_visible && ((sprite & 0x100) != 0 || !scroll_priority) {
            return Some(sprite);
        }
        if scroll_visible {
            return Some(scroll);
        }
        sprite_visible.then_some(sprite)
    }

    fn raw_pixel_visible(pixel: usize) -> bool {
        (pixel & 0x0f) != 0
    }

    fn plane_pixel(&self, plane: PlaneParams, screen_x: usize, screen_y: usize) -> Option<usize> {
        let source_x = (screen_x + plane.map_width - (plane.hscroll & (plane.map_width - 1)))
            & (plane.map_width - 1);
        let source_y = (screen_y + plane.vscroll) & (plane.map_height - 1);
        let cell_x = source_x >> 3;
        let cell_height = self.tile_cell_height();
        let row_mask = cell_height - 1;
        let cell_y = source_y / cell_height;
        let entry_address =
            (plane.name_base + ((2 * (cell_y * plane.width_cells + cell_x)) & 0x1fff)) & 0xffff;
        let entry = self.read_vram_word(entry_address as u32);
        let mut row = source_y & row_mask;
        let mut col = source_x & 7;
        if (entry & 0x1000) != 0 {
            row = row_mask - row;
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

    fn window_pixel(&self, screen_x: usize, screen_y: usize) -> Option<usize> {
        let cell_x = screen_x >> 3;
        let cell_height = self.tile_cell_height();
        let row_mask = cell_height - 1;
        let cell_y = screen_y / cell_height;
        let entry_address = (self.window_base()
            + ((2 * (cell_y * self.window_width_cells() + cell_x)) & 0x1fff))
            & 0xffff;
        let entry = self.read_vram_word(entry_address as u32);
        let mut row = screen_y & row_mask;
        let mut col = screen_x & 7;
        if (entry & 0x1000) != 0 {
            row = row_mask - row;
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

    fn window_active(&self, screen_x: usize, screen_y: usize) -> bool {
        let (start, end) = self.window_range(screen_y);
        screen_x >= start && screen_x < end
    }

    fn window_range(&self, screen_y: usize) -> (usize, usize) {
        let width = self.screen_width;
        let x = ((self.registers[17] & 0x1f) as usize * 16).min(width);
        let y = (self.registers[18] & 0x1f) as usize;
        let cell_height = self.tile_cell_height();
        let in_vertical = if (self.registers[18] & 0x80) != 0 {
            (screen_y / cell_height) >= y
        } else {
            (screen_y / cell_height) < y
        };
        if in_vertical {
            return (0, width);
        }
        if (self.registers[17] & 0x80) != 0 {
            (x, width)
        } else {
            (0, x)
        }
    }

    fn h_scroll_value(&self, plane_a: bool, screen_y: usize) -> usize {
        self.h_scroll_value_from(&self.registers, plane_a, screen_y)
    }

    fn h_scroll_value_from(
        &self,
        registers: &[u8; Self::NUM_REGISTERS],
        plane_a: bool,
        screen_y: usize,
    ) -> usize {
        let line = screen_y & 0xff;
        let offset = match registers[11] & 0x03 {
            0 => 0,
            1 => 4 * (line & 0x07),
            2 => 32 * (line / 8),
            _ => 4 * line,
        };
        let plane_offset = if plane_a { 0 } else { 2 };
        let hscroll_base = ((registers[13] as usize & 0x3f) << 10) & 0xffff;
        self.read_vram_word((hscroll_base + offset + plane_offset) as u32) as usize & 0x03ff
    }

    fn v_scroll_value_for_column(&self, plane_a: bool, column: usize) -> usize {
        if (self.registers[11] & 0x04) == 0 {
            return self.vsram[if plane_a { 0 } else { 1 }] as usize & self.vscroll_mask();
        }
        let index = Self::vscroll_pair_index_for_width(column, self.screen_width) * 2
            + usize::from(!plane_a);
        self.vsram[index] as usize & self.vscroll_mask()
    }

    fn vscroll_pair_index_for_width(column: usize, width: usize) -> usize {
        if width == Self::H40_WIDTH {
            column % Self::VSRAM_COLUMN_PAIRS
        } else {
            column & 0x0f
        }
    }

    fn vscroll_mask(&self) -> usize {
        match (self.registers[12] >> 1) & 0x03 {
            1 | 3 => 0x07ff,
            _ => 0x03ff,
        }
    }

    fn plane_dimensions(&self) -> (usize, usize) {
        Self::plane_dimensions_from(&self.registers)
    }

    fn plane_dimensions_from(registers: &[u8; Self::NUM_REGISTERS]) -> (usize, usize) {
        match registers[16] & 0x33 {
            0x00 => (32, 32),
            0x01 => (64, 32),
            0x02 => (64, 1),
            0x03 => (128, 32),
            0x10 => (32, 64),
            0x11 => (64, 64),
            0x12 => (64, 1),
            0x13 => (128, 32),
            0x20 => (32, 64),
            0x21 => (64, 64),
            0x22 => (64, 1),
            0x23 => (128, 64),
            0x30 => (32, 128),
            0x31 => (64, 64),
            0x32 => (64, 1),
            0x33 => (128, 128),
            _ => (32, 32),
        }
    }

    fn plane_a_base(&self) -> usize {
        Self::plane_a_base_from(&self.registers)
    }

    fn plane_a_base_from(registers: &[u8; Self::NUM_REGISTERS]) -> usize {
        ((registers[2] as usize & 0x38) << 10) & 0xffff
    }

    fn window_base(&self) -> usize {
        let base = ((self.registers[3] as usize & 0x3e) << 10) & 0xffff;
        if self.screen_width == Self::H40_WIDTH {
            base & 0xf000
        } else {
            base & 0xf800
        }
    }

    fn window_width_cells(&self) -> usize {
        if self.screen_width == Self::H40_WIDTH {
            64
        } else {
            32
        }
    }

    fn plane_b_base(&self) -> usize {
        Self::plane_b_base_from(&self.registers)
    }

    fn plane_b_base_from(registers: &[u8; Self::NUM_REGISTERS]) -> usize {
        ((registers[4] as usize & 0x07) << 13) & 0xffff
    }

    fn sprite_table_base(&self) -> usize {
        if self.screen_width == Self::H40_WIDTH {
            ((self.registers[5] as usize & 0x7e) << 9) & 0xffff
        } else {
            ((self.registers[5] as usize & 0x7f) << 9) & 0xffff
        }
    }

    fn sprite_table_base_from(registers: &[u8; Self::NUM_REGISTERS]) -> usize {
        let base = ((registers[5] as usize & 0x7f) << 9) & 0xffff;
        if Self::active_width_from(registers) == Self::H40_WIDTH {
            base & 0xfc00
        } else {
            base
        }
    }

    fn capture_sprite_table(&self, registers: &[u8; Self::NUM_REGISTERS]) -> Vec<u8> {
        let base = Self::sprite_table_base_from(registers);
        let mut table = vec![0; 80 * 8];
        for (index, byte) in table.iter_mut().enumerate() {
            *byte = self.vram[(base + index) & 0xffff];
        }
        table
    }

    fn line_snapshot(&self, line: usize) -> Option<&VdpLineSnapshot> {
        self.line_snapshots
            .get(line)
            .and_then(Option::as_ref)
            .or_else(|| {
                self.line_snapshots
                    .iter()
                    .take(line.saturating_add(1))
                    .rev()
                    .find_map(Option::as_ref)
            })
    }

    fn pattern_color(&self, pattern: usize, row: usize, col: usize) -> usize {
        let tile_address = ((pattern & self.pattern_address_mask()) * self.pattern_byte_size()
            + (row & self.tile_row_mask()) * 4)
            & 0xffff;
        let packed = ((self.vram[tile_address] as u32) << 24)
            | ((self.vram[(tile_address + 1) & 0xffff] as u32) << 16)
            | ((self.vram[(tile_address + 2) & 0xffff] as u32) << 8)
            | self.vram[(tile_address + 3) & 0xffff] as u32;
        ((packed >> ((7 - col) * 4)) & 0x0f) as usize
    }

    fn tile_cell_height(&self) -> usize {
        if self.interlace_mode_2() { 16 } else { 8 }
    }

    fn tile_row_mask(&self) -> usize {
        self.tile_cell_height() - 1
    }

    fn pattern_address_mask(&self) -> usize {
        if self.interlace_mode_2() {
            0x03ff
        } else {
            0x07ff
        }
    }

    fn pattern_byte_size(&self) -> usize {
        if self.interlace_mode_2() { 64 } else { 32 }
    }

    fn active_width_from(registers: &[u8; Self::NUM_REGISTERS]) -> usize {
        if (registers[12] & 0x81) != 0 {
            Self::H40_WIDTH
        } else {
            Self::DEFAULT_WIDTH
        }
    }

    fn increment_dma_source_address(&mut self) {
        let source = self.dma_source_address();
        let source = (source & !0x1ffff) | ((source + 2) & 0x1ffff);
        self.registers[21] = ((source >> 1) & 0xff) as u8;
        self.registers[22] = ((source >> 9) & 0xff) as u8;
        self.registers[23] = (self.registers[23] & 0xc0) | (((source >> 17) & 0x3f) as u8);
    }

    fn decrement_dma_length(&mut self) {
        let length =
            (u16::from(self.registers[19]) | (u16::from(self.registers[20]) << 8)).wrapping_sub(1);
        self.registers[19] = length as u8;
        self.registers[20] = (length >> 8) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::Vdp;

    fn enable_interlace_mode_2(vdp: &mut Vdp) {
        vdp.registers[1] = 0x40;
        vdp.registers[12] = 0x06;
        vdp.update_screen_size();
        vdp.video_dirty = true;
    }

    fn write_mode_2_pattern_pixel(
        vdp: &mut Vdp,
        pattern: usize,
        row: usize,
        col: usize,
        color: u8,
    ) {
        let address = pattern * 64 + row * 4 + col / 2;
        let shift = if (col & 1) == 0 { 4 } else { 0 };
        vdp.vram[address & 0xffff] |= (color & 0x0f) << shift;
    }

    fn set_vram_write_address(vdp: &mut Vdp, address: u32) {
        vdp.write_control(0x4000 | (address as u16 & 0x3fff));
        vdp.write_control(((address >> 14) & 0x0003) as u16);
    }

    fn set_cram_write_address(vdp: &mut Vdp, address: u32) {
        vdp.write_control(0xc000 | (address as u16 & 0x3fff));
        vdp.write_control(((address >> 14) & 0x0003) as u16);
    }

    #[test]
    fn interlace_mode_2_sprites_use_0x100_y_origin() {
        let mut vdp = Vdp::new();
        enable_interlace_mode_2(&mut vdp);
        vdp.registers[5] = 0x70;
        vdp.cram[1] = 0x0eee;
        write_mode_2_pattern_pixel(&mut vdp, 1, 0, 0, 1);

        let sprite_base = vdp.sprite_table_base();
        vdp.write_vram_word(sprite_base as u32, 0x0100);
        vdp.write_vram_word((sprite_base + 2) as u32, 0x0000);
        vdp.write_vram_word((sprite_base + 4) as u32, 0x0001);
        vdp.write_vram_word((sprite_base + 6) as u32, 0x0080);

        vdp.render_frame();

        assert_eq!(vdp.screen_height, 448);
        assert_eq!(vdp.framebuffer[0], vdp.palette_color(1));
    }

    #[test]
    fn interlace_mode_2_renders_pattern_written_through_control_port() {
        let mut vdp = Vdp::new();
        vdp.write_control(0x8174);
        vdp.write_control(0x8c87);
        vdp.write_control(0x8f02);
        vdp.write_control(0x8230);

        set_vram_write_address(&mut vdp, 0xc000);
        vdp.write_data(0x0001);

        set_vram_write_address(&mut vdp, 1 << 6);
        for _ in 0..32 {
            vdp.write_data(0x1111);
        }

        set_cram_write_address(&mut vdp, 0x02);
        vdp.write_data(0x0eee);

        vdp.render_frame();

        assert_eq!(vdp.screen_width, 320);
        assert_eq!(vdp.screen_height, 448);
        assert_eq!(vdp.framebuffer[0], vdp.palette_color(1));
    }

    #[test]
    fn interlace_mode_2_uses_reference_hscroll_pair_mapping() {
        let mut vdp = Vdp::new();
        enable_interlace_mode_2(&mut vdp);
        vdp.registers[2] = 0x30;
        vdp.registers[13] = 0x0f;
        vdp.cram[2] = 0x00e0;
        vdp.cram[3] = 0x0e00;

        let plane_a = vdp.plane_a_base();
        vdp.write_vram_word(plane_a as u32, 10);
        vdp.write_vram_word((plane_a + 2) as u32, 11);
        vdp.write_vram_word((plane_a + 31 * 2) as u32, 12);
        let hscroll_base = ((vdp.registers[13] as usize & 0x3f) << 10) & 0xffff;
        vdp.write_vram_word(hscroll_base as u32, 1);
        write_mode_2_pattern_pixel(&mut vdp, 11, 0, 7, 2);
        write_mode_2_pattern_pixel(&mut vdp, 12, 0, 7, 3);

        vdp.render_frame();

        assert_eq!(vdp.framebuffer[0], vdp.palette_color(2));
    }

    #[test]
    fn h40_per_cell_vscroll_wraps_after_twenty_pairs() {
        let mut vdp = Vdp::new();
        vdp.registers[11] = 0x04;
        vdp.registers[12] = 0x81;
        vdp.update_screen_size();
        vdp.vsram[0] = 0x0012;
        vdp.vsram[38] = 0x0034;

        assert_eq!(vdp.v_scroll_value_for_column(true, 0), 0x0012);
        assert_eq!(vdp.v_scroll_value_for_column(true, 19), 0x0034);
        assert_eq!(vdp.v_scroll_value_for_column(true, 20), 0x0012);
    }

    #[test]
    fn vsram_writes_ignore_words_outside_valid_md_range() {
        let mut vdp = Vdp::new();
        vdp.write_vsram_word(39, 0x0555);
        vdp.write_vsram_word(40, 0x0666);

        assert_eq!(vdp.vsram[39], 0x0555);
        assert_eq!(vdp.vsram[40], 0);
    }

    #[test]
    fn plane_size_0x13_matches_reference_table() {
        let mut vdp = Vdp::new();
        vdp.registers[16] = 0x13;

        assert_eq!(vdp.plane_dimensions(), (128, 32));
    }
}
