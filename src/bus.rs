use crate::audio::{Psg, Ym2612, Ym2612Snapshot};
use crate::controller::Controller;
use crate::paprium::{PapriumBusOverride, PapriumSnapshot};
use crate::vdp::{Vdp, VdpDmaMode, VdpSnapshot};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
enum SramAccess {
    #[default]
    Word,
    ByteEven,
    ByteOdd,
}

#[derive(Clone, Copy, Debug)]
struct SramInfo {
    start: u32,
    end: u32,
    access: SramAccess,
    eeprom: bool,
}

#[derive(Clone, Debug)]
pub struct M68kBus {
    pub rom: Vec<u8>,
    low_memory: Vec<u8>,
    work_ram: Box<[u8; Self::WORK_RAM_SIZE]>,
    z80_ram: Box<[u8; Self::Z80_RAM_SIZE]>,
    rom_mask: Option<usize>,
    pub psg: Psg,
    pub ym2612: Ym2612,
    pub vdp: Vdp,
    pub controller_a: Controller,
    pub controller_b: Controller,
    pub frame_cycle: u64,
    pub ym_frame_cycle: u64,
    pub version_register: u8,
    z80_bus_requested: bool,
    z80_reset_asserted: bool,
    z80_bank_register: u16,
    sram: Option<Vec<u8>>,
    sram_start: u32,
    sram_end: u32,
    sram_access: SramAccess,
    sram_enabled: bool,
    sram_dirty: bool,
    sram_path: Option<PathBuf>,
    sram_rom_limit: Option<usize>,
    cartridge_override: Option<PapriumBusOverride>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct M68kBusSnapshot {
    low_memory_patches: Vec<(usize, u8)>,
    work_ram: Vec<u8>,
    z80_ram: Vec<u8>,
    pub psg: Psg,
    pub ym2612: Ym2612Snapshot,
    pub vdp: VdpSnapshot,
    pub controller_a: Controller,
    pub controller_b: Controller,
    pub frame_cycle: u64,
    pub ym_frame_cycle: u64,
    pub version_register: u8,
    z80_bus_requested: bool,
    z80_reset_asserted: bool,
    #[serde(default)]
    z80_bank_register: u16,
    #[serde(default)]
    sram: Option<Vec<u8>>,
    #[serde(default)]
    sram_start: u32,
    #[serde(default)]
    sram_end: u32,
    #[serde(default)]
    sram_access: SramAccess,
    #[serde(default)]
    sram_enabled: bool,
    #[serde(default)]
    sram_dirty: bool,
    #[serde(default)]
    sram_path: Option<PathBuf>,
    #[serde(default)]
    sram_rom_limit: Option<usize>,
    #[serde(default)]
    cartridge_override: Option<PapriumSnapshot>,
}

impl Default for M68kBus {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for M68kBus {
    fn drop(&mut self) {
        let _ = self.flush_sram();
        let _ = self.flush_cartridge_override();
    }
}

impl M68kBus {
    pub const ADDRESS_MASK: u32 = 0x00ff_ffff;
    pub const LOW_MEMORY_SIZE: usize = 0x00a0_0000;
    pub const WORK_RAM_SIZE: usize = 0x1_0000;
    pub const Z80_RAM_SIZE: usize = 0x2000;
    const YM2612_BASE: u32 = 0x00a0_4000;
    const YM2612_MASK: u32 = 0x00ff_fffc;
    const PSG_BASE: u32 = 0x00c0_0000;
    const PSG_MASK: u32 = 0x00ff_ffe0;
    const Z80_BUS_REQUEST: u32 = 0x00a1_1100;
    const Z80_RESET: u32 = 0x00a1_1200;
    const Z80_RAM_BASE: u32 = 0x00a0_0000;
    const YM2612_END: u32 = 0x00a0_4000;
    const Z80_BANK_REGISTER_BASE: u32 = 0x00a0_6000;
    const IO_VERSION_BASE: u32 = 0x00a1_0000;
    const IO_PORT_1_DATA_BASE: u32 = 0x00a1_0002;
    const IO_PORT_2_DATA_BASE: u32 = 0x00a1_0004;
    const IO_EXPANSION_DATA_BASE: u32 = 0x00a1_0006;
    const IO_PORT_1_CONTROL_BASE: u32 = 0x00a1_0008;
    const IO_PORT_2_CONTROL_BASE: u32 = 0x00a1_000a;
    const IO_EXPANSION_CONTROL_BASE: u32 = 0x00a1_000c;
    const SRAM_LOCK: u32 = 0x00a1_30f1;
    const VDP_HV_COUNTER: u32 = 0x00c0_0008;
    const WORK_RAM_BASE: u32 = 0x00e0_0000;
    const WORK_RAM_MASK: u32 = 0x0000_ffff;

    pub fn new() -> Self {
        Self {
            rom: Vec::new(),
            low_memory: vec![0; Self::LOW_MEMORY_SIZE],
            work_ram: Box::new([0; Self::WORK_RAM_SIZE]),
            z80_ram: Box::new([0; Self::Z80_RAM_SIZE]),
            rom_mask: None,
            psg: Psg::new(),
            ym2612: Ym2612::new(),
            vdp: Vdp::new(),
            controller_a: Controller::new(),
            controller_b: Controller::new(),
            frame_cycle: 0,
            ym_frame_cycle: 0,
            version_register: 0xa0,
            z80_bus_requested: false,
            z80_reset_asserted: true,
            z80_bank_register: 0,
            sram: None,
            sram_start: 0,
            sram_end: 0,
            sram_access: SramAccess::Word,
            sram_enabled: false,
            sram_dirty: false,
            sram_path: None,
            sram_rom_limit: None,
            cartridge_override: None,
        }
    }

    pub fn reset(&mut self) {
        self.work_ram.fill(0);
        self.z80_ram.fill(0);
        self.psg.reset();
        self.ym2612.reset();
        self.vdp.reset();
        self.controller_a.reset();
        self.controller_b.reset();
        self.frame_cycle = 0;
        self.ym_frame_cycle = 0;
        self.z80_bus_requested = false;
        self.z80_reset_asserted = true;
        self.z80_bank_register = 0;
        if let Some(cartridge) = &mut self.cartridge_override {
            cartridge.reset();
        }
    }

    pub fn load_rom(&mut self, rom: Vec<u8>) {
        self.load_rom_with_path(rom, None);
    }

    pub fn load_rom_with_path(&mut self, rom: Vec<u8>, path: Option<PathBuf>) {
        let _ = self.flush_sram();
        let _ = self.flush_cartridge_override();
        self.rom = rom;
        self.rom_mask = if self.rom.len().is_power_of_two() {
            Some(self.rom.len() - 1)
        } else {
            None
        };
        self.configure_cartridge_override(path.as_deref());
        self.configure_sram(path);
    }

    pub fn sram_path(&self) -> Option<&std::path::Path> {
        self.sram_path.as_deref()
    }

    pub fn paprium_save_path(&self) -> Option<&std::path::Path> {
        self.cartridge_override
            .as_ref()
            .and_then(PapriumBusOverride::save_path)
    }

    pub fn flush_sram(&mut self) -> std::io::Result<()> {
        if !self.sram_dirty {
            return Ok(());
        }
        let Some(path) = &self.sram_path else {
            return Ok(());
        };
        let Some(sram) = &self.sram else {
            return Ok(());
        };
        fs::write(path, sram)?;
        self.sram_dirty = false;
        Ok(())
    }

    pub fn flush_cartridge_override(&mut self) -> std::io::Result<()> {
        if let Some(cartridge) = &mut self.cartridge_override {
            cartridge.flush_nvram()?;
        }
        Ok(())
    }

    pub fn snapshot(&self) -> M68kBusSnapshot {
        let low_memory_patches = self
            .low_memory
            .iter()
            .enumerate()
            .filter_map(|(index, &value)| (value != 0).then_some((index, value)))
            .collect();

        M68kBusSnapshot {
            low_memory_patches,
            work_ram: self.work_ram.as_ref().to_vec(),
            z80_ram: self.z80_ram.as_ref().to_vec(),
            psg: self.psg.clone(),
            ym2612: self.ym2612.snapshot(),
            vdp: self.vdp.snapshot(),
            controller_a: self.controller_a.clone(),
            controller_b: self.controller_b.clone(),
            frame_cycle: self.frame_cycle,
            ym_frame_cycle: self.ym_frame_cycle,
            version_register: self.version_register,
            z80_bus_requested: self.z80_bus_requested,
            z80_reset_asserted: self.z80_reset_asserted,
            z80_bank_register: self.z80_bank_register,
            sram: self.sram.clone(),
            sram_start: self.sram_start,
            sram_end: self.sram_end,
            sram_access: self.sram_access,
            sram_enabled: self.sram_enabled,
            sram_dirty: self.sram_dirty,
            sram_path: self.sram_path.clone(),
            sram_rom_limit: self.sram_rom_limit,
            cartridge_override: self
                .cartridge_override
                .as_ref()
                .map(PapriumBusOverride::snapshot),
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: M68kBusSnapshot) {
        self.low_memory.fill(0);
        for (index, value) in snapshot.low_memory_patches {
            if let Some(slot) = self.low_memory.get_mut(index) {
                *slot = value;
            }
        }
        self.work_ram.fill(0);
        for (slot, value) in self.work_ram.iter_mut().zip(snapshot.work_ram) {
            *slot = value;
        }
        self.z80_ram.fill(0);
        for (slot, value) in self.z80_ram.iter_mut().zip(snapshot.z80_ram) {
            *slot = value;
        }
        self.psg = snapshot.psg;
        self.ym2612.restore_snapshot(snapshot.ym2612);
        self.vdp.restore_snapshot(snapshot.vdp);
        self.controller_a = snapshot.controller_a;
        self.controller_b = snapshot.controller_b;
        self.frame_cycle = snapshot.frame_cycle;
        self.ym_frame_cycle = snapshot.ym_frame_cycle;
        self.version_register = snapshot.version_register;
        self.z80_bus_requested = snapshot.z80_bus_requested;
        self.z80_reset_asserted = snapshot.z80_reset_asserted;
        self.z80_bank_register = snapshot.z80_bank_register & 0x01ff;
        self.sram = snapshot.sram;
        self.sram_start = snapshot.sram_start;
        self.sram_end = snapshot.sram_end;
        self.sram_access = snapshot.sram_access;
        self.sram_enabled = snapshot.sram_enabled;
        self.sram_dirty = snapshot.sram_dirty;
        self.sram_path = snapshot.sram_path;
        self.sram_rom_limit = snapshot.sram_rom_limit;
        self.cartridge_override = snapshot.cartridge_override.map(|cartridge_snapshot| {
            let mut cartridge =
                PapriumBusOverride::new(&self.rom, cartridge_snapshot.save_path.as_deref());
            cartridge.restore_snapshot(cartridge_snapshot);
            cartridge
        });
    }

    pub fn load(&mut self, address: u32, bytes: &[u8]) {
        for (index, byte) in bytes.iter().enumerate() {
            let address = (address.wrapping_add(index as u32) & Self::ADDRESS_MASK) as usize;
            if address < self.low_memory.len() {
                self.low_memory[address] = *byte;
            } else if address >= Self::WORK_RAM_BASE as usize {
                self.work_ram[address & Self::WORK_RAM_MASK as usize] = *byte;
            }
        }
    }

    pub fn begin_frame(&mut self) {
        self.frame_cycle = 0;
        self.ym_frame_cycle = 0;
        self.vdp.begin_frame();
        self.psg.begin_frame();
        self.ym2612.begin_frame();
    }

    pub fn interrupt_level(&self) -> u8 {
        self.vdp.irq_level
    }

    pub fn acknowledge_interrupt(&mut self, level: u8) {
        self.vdp.acknowledge_interrupt(level);
    }

    pub fn read_byte(&mut self, address: u32) -> u8 {
        let address = address & Self::ADDRESS_MASK;
        if self.ym2612_address(address) {
            self.ym2612.sync_to_cycle(self.ym_frame_cycle);
            return self.ym2612.read_register(address);
        }
        if self.vdp_data_address(address) {
            return split_word(self.vdp.read_data(), address);
        }
        if self.vdp_control_address(address) {
            return split_word(self.vdp.read_control(), address);
        }
        if self.vdp_hv_counter_address(address) {
            return split_word(self.vdp.read_hv_counter(), address);
        }
        if Self::io_pair(address, Self::IO_VERSION_BASE) {
            return self.version_register;
        }
        if Self::io_pair(address, Self::IO_PORT_1_DATA_BASE) {
            return self.controller_a.read_data();
        }
        if Self::io_pair(address, Self::IO_PORT_2_DATA_BASE) {
            return self.controller_b.read_data();
        }
        if Self::io_pair(address, Self::IO_EXPANSION_DATA_BASE) {
            return 0xff;
        }
        if Self::io_pair(address, Self::IO_PORT_1_CONTROL_BASE) {
            return self.controller_a.read_control();
        }
        if Self::io_pair(address, Self::IO_PORT_2_CONTROL_BASE) {
            return self.controller_b.read_control();
        }
        if Self::io_pair(address, Self::IO_EXPANSION_CONTROL_BASE) {
            return 0x00;
        }
        if self.sram_lock_address(address) {
            return if self.sram_enabled { 0x01 } else { 0x00 };
        }
        if self.z80_bus_request_address(address) {
            return if self.z80_bus_requested { 0 } else { 1 };
        }
        if self.z80_reset_address(address) {
            return if self.z80_reset_asserted { 0 } else { 1 };
        }
        if self.z80_ram_mirror_address(address) {
            return if self.z80_bus_requested {
                self.z80_ram[(address as usize) & 0x1fff]
            } else {
                0xff
            };
        }
        if let Some(cartridge) = self.cartridge_override_read_byte(address) {
            return cartridge;
        }
        if self.sram_address(address) {
            return self.read_sram_byte(address);
        }
        if self.work_ram_address(address) {
            return self.work_ram[(address & Self::WORK_RAM_MASK) as usize];
        }
        if self.cartridge_rom_address(address) {
            return self.read_rom_byte(address);
        }
        self.low_memory
            .get(address as usize)
            .copied()
            .unwrap_or(0xff)
    }

    pub fn read_word(&mut self, address: u32) -> u16 {
        let address = address & Self::ADDRESS_MASK;
        if self.vdp_data_address(address) {
            return self.vdp.read_data();
        }
        if self.vdp_control_address(address) {
            return self.vdp.read_control();
        }
        if self.vdp_hv_counter_address(address) {
            return self.vdp.read_hv_counter();
        }
        if self.sram_lock_span_address(address, 2) {
            return if self.sram_enabled { 0x0101 } else { 0x0000 };
        }
        if self.z80_ram_mirror_address(address) {
            return if self.z80_bus_requested {
                let mirrored = if (address & 1) == 0 {
                    address
                } else {
                    address + 1
                };
                let value = self.z80_ram[(mirrored as usize) & 0x1fff] as u16;
                (value << 8) | value
            } else {
                0xffff
            };
        }
        if let Some(cartridge) = self.cartridge_override_read_word(address) {
            return cartridge;
        }
        if self.sram_address(address) {
            return ((self.read_byte(address) as u16) << 8) | self.read_byte(address + 1) as u16;
        }
        if self.work_ram_address(address) {
            let offset = (address & Self::WORK_RAM_MASK) as usize;
            return ((self.work_ram[offset] as u16) << 8)
                | self.work_ram[(offset + 1) & 0xffff] as u16;
        }
        if self.cartridge_rom_address(address) {
            return ((self.read_rom_byte(address) as u16) << 8)
                | self.read_rom_byte(address + 1) as u16;
        }
        ((self.read_byte(address) as u16) << 8) | self.read_byte(address + 1) as u16
    }

    pub fn read_long(&mut self, address: u32) -> u32 {
        let address = address & Self::ADDRESS_MASK;
        if self.sram_lock_span_address(address, 4) {
            return if self.sram_enabled {
                0x0101_0101
            } else {
                0x0000_0000
            };
        }
        ((self.read_word(address) as u32) << 16) | self.read_word(address + 2) as u32
    }

    pub fn read_word_fast(&mut self, address: u32) -> u16 {
        let address = address & Self::ADDRESS_MASK;
        if self.work_ram_address(address) {
            let offset = (address & Self::WORK_RAM_MASK) as usize;
            return ((self.work_ram[offset] as u16) << 8)
                | self.work_ram[(offset + 1) & 0xffff] as u16;
        }
        if let Some(cartridge) = self.cartridge_override_read_word(address) {
            return cartridge;
        }
        if self.sram_address(address) && address < self.sram_end {
            return ((self.read_sram_byte(address) as u16) << 8)
                | self.read_sram_byte(address + 1) as u16;
        }
        if self.cartridge_rom_address(address) {
            return ((self.read_rom_byte(address) as u16) << 8)
                | self.read_rom_byte(address + 1) as u16;
        }
        self.read_word(address)
    }

    pub fn read_long_fast(&mut self, address: u32) -> u32 {
        let address = address & Self::ADDRESS_MASK;
        ((self.read_word_fast(address) as u32) << 16) | self.read_word_fast(address + 2) as u32
    }

    pub fn read_byte_fast(&mut self, address: u32) -> u8 {
        let address = address & Self::ADDRESS_MASK;
        if self.work_ram_address(address) {
            return self.work_ram[(address & Self::WORK_RAM_MASK) as usize];
        }
        if let Some(cartridge) = self.cartridge_override_read_byte(address) {
            return cartridge;
        }
        if self.sram_address(address) {
            return self.read_sram_byte(address);
        }
        if self.cartridge_rom_address(address) {
            return self.read_rom_byte(address);
        }
        self.read_byte(address)
    }

    pub fn peek_byte(&self, address: u32) -> u8 {
        let address = address & Self::ADDRESS_MASK;
        if self.work_ram_address(address) {
            return self.work_ram[(address & Self::WORK_RAM_MASK) as usize];
        }
        if self.sram_address(address) {
            return self.peek_sram_byte(address);
        }
        if self.cartridge_rom_address(address) {
            return self.read_rom_byte(address);
        }
        if self.z80_ram_mirror_address(address) {
            return self.z80_ram[(address as usize) & 0x1fff];
        }
        self.low_memory
            .get(address as usize)
            .copied()
            .unwrap_or(0xff)
    }

    pub fn write_byte(&mut self, address: u32, value: u8) {
        let address = address & Self::ADDRESS_MASK;
        if self.ym2612_address(address) {
            self.ym2612.sync_to_cycle(self.ym_frame_cycle);
            self.ym2612
                .write_port(address & 0x03, value, Some(self.ym_frame_cycle));
        } else if self.vdp_data_address(address) {
            self.vdp.write_data_byte(address, value);
        } else if self.vdp_control_address(address) {
            self.vdp.write_control_byte(address, value);
            self.finish_vdp_dma();
        } else if address == (Self::IO_PORT_1_DATA_BASE | 1) {
            self.controller_a.write_data(value);
        } else if address == (Self::IO_PORT_2_DATA_BASE | 1) {
            self.controller_b.write_data(value);
        } else if Self::io_pair(address, Self::IO_PORT_1_CONTROL_BASE) {
            self.controller_a.write_control(value);
        } else if Self::io_pair(address, Self::IO_PORT_2_CONTROL_BASE) {
            self.controller_b.write_control(value);
        } else if self.sram_lock_address(address) {
            self.set_sram_enabled((value & 0x01) != 0);
        } else if self.sram_control_range(address) {
        } else if self.z80_bus_request_address(address) {
            self.z80_bus_requested = (value & 0x01) != 0;
        } else if self.z80_reset_address(address) {
            self.z80_reset_asserted = (value & 0x01) == 0;
        } else if self.z80_ram_mirror_address(address) {
            if self.z80_bus_requested {
                self.z80_ram[(address as usize) & 0x1fff] = value;
            }
        } else if self.z80_bank_register_address(address) {
            self.write_z80_bank_register(value);
        } else if self.cartridge_override_write_byte(address, value) {
        } else if self.sram_address(address) {
            self.write_sram_byte(address, value);
        } else if self.psg_address(address) {
            self.psg
                .write(value, Some((address & 0x1f) as u8), Some(self.frame_cycle));
        } else if self.work_ram_address(address) {
            self.work_ram[(address & Self::WORK_RAM_MASK) as usize] = value;
        } else if (!self.cartridge_rom_address(address) || self.rom.is_empty())
            && let Some(slot) = self.low_memory.get_mut(address as usize)
        {
            *slot = value;
        }
    }

    pub fn write_word(&mut self, address: u32, value: u16) {
        let address = address & Self::ADDRESS_MASK;
        if self.vdp_data_address(address) {
            self.vdp.write_data(value);
            return;
        }
        if self.vdp_control_address(address) {
            self.vdp.write_control(value);
            self.finish_vdp_dma();
            return;
        }
        if self.sram_lock_span_address(address, 2) {
            self.set_sram_enabled((value & 0x01) != 0);
            return;
        }
        if self.sram_control_range(address) {
            return;
        }
        if self.z80_ram_mirror_address(address) {
            if self.z80_bus_requested {
                self.z80_ram[((address & !1) as usize) & 0x1fff] = (value >> 8) as u8;
            }
            return;
        }
        if self.cartridge_override_write_word(address, value) {
            return;
        }
        if self.work_ram_address(address) {
            let offset = (address & Self::WORK_RAM_MASK) as usize;
            self.work_ram[offset] = (value >> 8) as u8;
            self.work_ram[(offset + 1) & 0xffff] = value as u8;
            return;
        }

        self.write_byte(address, (value >> 8) as u8);
        self.write_byte(address + 1, value as u8);
    }

    pub fn write_long(&mut self, address: u32, value: u32) {
        let address = address & Self::ADDRESS_MASK;
        if self.sram_lock_span_address(address, 4) {
            self.set_sram_enabled((value & 0x01) != 0);
            return;
        }
        if self.sram_control_range(address) {
            return;
        }
        self.write_word(address, (value >> 16) as u16);
        self.write_word(address + 2, value as u16);
    }

    pub fn z80_running(&self) -> bool {
        !self.z80_reset_asserted && !self.z80_bus_requested
    }

    pub fn z80_read_byte(&mut self, address: u16) -> u8 {
        match address {
            0x0000..=0x3fff => self.z80_ram[address as usize & 0x1fff],
            0x4000..=0x5fff => {
                self.ym2612.sync_to_cycle(self.ym_frame_cycle);
                self.ym2612.read_register(address as u32)
            }
            0x6000..=0x7fff => 0xff,
            0x8000..=0xffff => {
                let m68k_address = self.z80_banked_m68k_address(address);
                self.read_byte(m68k_address)
            }
        }
    }

    pub fn z80_write_byte(&mut self, address: u16, value: u8) {
        match address {
            0x0000..=0x3fff => self.z80_ram[address as usize & 0x1fff] = value,
            0x4000..=0x5fff => {
                self.ym2612.sync_to_cycle(self.ym_frame_cycle);
                self.ym2612
                    .write_port(address as u32 & 0x03, value, Some(self.ym_frame_cycle));
            }
            0x6000..=0x60ff => self.write_z80_bank_register(value),
            0x6100..=0x7eff => {}
            0x7f00..=0x7f1f => {
                self.psg
                    .write(value, Some((address & 0xff) as u8), Some(self.frame_cycle));
            }
            0x7f20..=0x7fff => {}
            0x8000..=0xffff => {
                let m68k_address = self.z80_banked_m68k_address(address);
                self.write_byte(m68k_address, value);
            }
        }
    }

    fn read_rom_byte(&self, address: u32) -> u8 {
        if self.rom.is_empty() {
            return self
                .low_memory
                .get(address as usize)
                .copied()
                .unwrap_or(0xff);
        }
        let index = if let Some(mask) = self.rom_mask {
            address as usize & mask
        } else {
            address as usize % self.rom.len()
        };
        self.rom[index]
    }

    fn configure_cartridge_override(&mut self, rom_path: Option<&std::path::Path>) {
        self.cartridge_override = if PapriumBusOverride::paprium_rom(&self.rom) {
            Some(PapriumBusOverride::new(&self.rom, rom_path))
        } else {
            None
        };
    }

    fn cartridge_override_read_byte(&mut self, address: u32) -> Option<u8> {
        let cartridge = self.cartridge_override.as_mut()?;
        PapriumBusOverride::handles(address).then(|| cartridge.read_byte(address))
    }

    fn cartridge_override_read_word(&mut self, address: u32) -> Option<u16> {
        let cartridge = self.cartridge_override.as_mut()?;
        PapriumBusOverride::handles(address).then(|| cartridge.read_word(address))
    }

    fn cartridge_override_write_byte(&mut self, address: u32, value: u8) -> bool {
        let Some(cartridge) = self.cartridge_override.as_mut() else {
            return false;
        };
        if PapriumBusOverride::handles(address) {
            cartridge.write_byte(address, value);
            true
        } else {
            false
        }
    }

    fn cartridge_override_write_word(&mut self, address: u32, value: u16) -> bool {
        let Some(cartridge) = self.cartridge_override.as_mut() else {
            return false;
        };
        if PapriumBusOverride::handles(address) {
            cartridge.write_word(address, value);
            true
        } else {
            false
        }
    }

    fn write_z80_bank_register(&mut self, value: u8) {
        self.z80_bank_register =
            ((self.z80_bank_register >> 1) | (u16::from(value & 1) << 8)) & 0x01ff;
    }

    fn configure_sram(&mut self, rom_path: Option<PathBuf>) {
        self.reset_sram();
        self.sram_rom_limit = Self::declared_rom_limit(&self.rom).or(Some(self.rom.len()));
        let info = Self::parse_sram_header(&self.rom).unwrap_or(SramInfo {
            start: 0x0020_0001,
            end: 0x0020_ffff,
            access: SramAccess::Word,
            eeprom: false,
        });
        self.allocate_sram(info, rom_path);
        self.sram_enabled = self.initial_sram_enabled(info);
    }

    fn reset_sram(&mut self) {
        self.sram = None;
        self.sram_start = 0;
        self.sram_end = 0;
        self.sram_access = SramAccess::Word;
        self.sram_enabled = false;
        self.sram_dirty = false;
        self.sram_path = None;
        self.sram_rom_limit = None;
    }

    fn allocate_sram(&mut self, info: SramInfo, rom_path: Option<PathBuf>) {
        let shift = if info.access == SramAccess::Word {
            0
        } else {
            1
        };
        let Some(span) = info.end.checked_sub(info.start) else {
            return;
        };
        let size = ((span >> shift) + 1) as usize;
        if size == 0 || size > 0x20_0000 {
            return;
        }

        self.sram_start = info.start;
        self.sram_end = info.end;
        self.sram_access = info.access;
        self.sram = Some(vec![0xff; size]);
        self.sram_path = rom_path.map(|path| path.with_extension("srm"));
        self.load_sram_file();
    }

    fn initial_sram_enabled(&self, info: SramInfo) -> bool {
        if info.eeprom {
            return true;
        }
        self.sram_rom_limit
            .is_some_and(|limit| info.start as usize >= limit)
    }

    fn load_sram_file(&mut self) {
        let Some(path) = &self.sram_path else {
            return;
        };
        let Ok(bytes) = fs::read(path) else {
            return;
        };
        if let Some(sram) = &mut self.sram {
            for (slot, byte) in sram.iter_mut().zip(bytes) {
                *slot = byte;
            }
        }
        self.sram_dirty = false;
    }

    fn set_sram_enabled(&mut self, enabled: bool) {
        let was_enabled = self.sram_enabled;
        self.sram_enabled = enabled;
        if was_enabled && !enabled {
            let _ = self.flush_sram();
        }
    }

    fn read_sram_byte(&self, address: u32) -> u8 {
        self.sram
            .as_ref()
            .and_then(|sram| self.sram_index(address).and_then(|index| sram.get(index)))
            .copied()
            .unwrap_or(0xff)
    }

    fn peek_sram_byte(&self, address: u32) -> u8 {
        self.read_sram_byte(address)
    }

    fn write_sram_byte(&mut self, address: u32, value: u8) {
        let Some(index) = self.sram_index(address) else {
            return;
        };
        let Some(sram) = &mut self.sram else {
            return;
        };
        let Some(slot) = sram.get_mut(index) else {
            return;
        };
        if *slot != value {
            *slot = value;
            self.sram_dirty = true;
        }
    }

    fn sram_index(&self, address: u32) -> Option<usize> {
        match self.sram_access {
            SramAccess::Word => Some(address.wrapping_sub(self.sram_start) as usize),
            SramAccess::ByteEven if (address & 1) == 0 => {
                Some((address.wrapping_sub(self.sram_start) >> 1) as usize)
            }
            SramAccess::ByteOdd if (address & 1) != 0 => {
                Some((address.wrapping_sub(self.sram_start) >> 1) as usize)
            }
            _ => None,
        }
    }

    fn parse_sram_header(bytes: &[u8]) -> Option<SramInfo> {
        if bytes.len() < 0x1bc || &bytes[0x1b0..0x1b2] != b"RA" {
            return None;
        }
        let kind = bytes[0x1b2];
        let flags = bytes[0x1b3];
        let eeprom = kind == 0xe8 && flags == 0x40;
        let access = match kind {
            0xa0 | 0xe0 | 0xe8 => SramAccess::Word,
            0xb0 | 0xf0 => SramAccess::ByteEven,
            0xb8 | 0xf8 => SramAccess::ByteOdd,
            _ => return None,
        };
        let battery = matches!(kind, 0xe0 | 0xf0 | 0xf8);
        if !battery && !eeprom {
            return None;
        }

        let mut start = Self::read_header_long(bytes, 0x1b4)?;
        let mut end = Self::read_header_long(bytes, 0x1b8)?;
        if eeprom && (end < start || start < 0x0020_0000 || end > 0x003f_ffff) {
            start = 0x0020_0001;
            end = 0x0020_ffff;
        }
        if end < start || start < 0x0020_0000 || end > 0x003f_ffff {
            return None;
        }

        Some(SramInfo {
            start,
            end,
            access,
            eeprom,
        })
    }

    fn declared_rom_limit(bytes: &[u8]) -> Option<usize> {
        if bytes.len() < 0x1a8 {
            return None;
        }
        let start = Self::read_header_long(bytes, 0x1a0)?;
        let end = Self::read_header_long(bytes, 0x1a4)?;
        (start == 0 && end > 0 && end < Self::Z80_RAM_BASE).then_some(end as usize + 1)
    }

    fn read_header_long(bytes: &[u8], offset: usize) -> Option<u32> {
        Some(
            ((u32::from(*bytes.get(offset)?)) << 24)
                | ((u32::from(*bytes.get(offset + 1)?)) << 16)
                | ((u32::from(*bytes.get(offset + 2)?)) << 8)
                | u32::from(*bytes.get(offset + 3)?),
        )
    }

    fn sram_lock_address(&self, address: u32) -> bool {
        address == Self::SRAM_LOCK
    }

    fn sram_lock_span_address(&self, address: u32, bytes: u32) -> bool {
        address <= Self::SRAM_LOCK && address.wrapping_add(bytes).wrapping_sub(1) >= Self::SRAM_LOCK
    }

    fn sram_control_range(&self, address: u32) -> bool {
        (address & 0x00ff_ff00) == 0x00a1_3000
    }

    fn sram_address(&self, address: u32) -> bool {
        self.sram.is_some()
            && self.sram_enabled
            && address >= self.sram_start
            && address <= self.sram_end
    }

    fn z80_banked_m68k_address(&self, address: u16) -> u32 {
        ((u32::from(self.z80_bank_register) << 15) | u32::from(address & 0x7fff)) & 0x003f_ffff
    }

    fn finish_vdp_dma(&mut self) {
        let Some(mode) = self.vdp.take_dma_request() else {
            return;
        };
        match mode {
            VdpDmaMode::MemoryToVdp => {
                let mut source = self.vdp.dma_source_address();
                let length = self.vdp.dma_length_words();
                let target = self.vdp.dma_target_address();
                let start_source = source;
                let mut nonzero_words = 0;
                for _ in 0..length {
                    let value = self.read_word(source);
                    if target < 0xc000 && value != 0 {
                        nonzero_words += 1;
                    }
                    self.vdp.write_dma_word(value);
                    self.vdp.advance_memory_dma_word();
                    source = source.wrapping_add(2) & Self::ADDRESS_MASK;
                }
                self.vdp
                    .record_dma_transfer(start_source, target, length, nonzero_words);
            }
            VdpDmaMode::Fill => self.vdp.arm_dma_fill(),
            VdpDmaMode::Copy => self.vdp.perform_vram_copy_dma(),
        }
    }

    fn cartridge_rom_address(&self, address: u32) -> bool {
        !self.rom.is_empty() && address < Self::Z80_RAM_BASE
    }

    fn work_ram_address(&self, address: u32) -> bool {
        address >= Self::WORK_RAM_BASE
    }

    fn ym2612_address(&self, address: u32) -> bool {
        (address & Self::YM2612_MASK) == Self::YM2612_BASE
    }

    fn psg_address(&self, address: u32) -> bool {
        (address & Self::PSG_MASK) == Self::PSG_BASE
            && matches!(address & 0x1f, 0x11 | 0x13 | 0x15 | 0x17)
    }

    fn z80_bus_request_address(&self, address: u32) -> bool {
        (address & 0x00ff_ff00) == Self::Z80_BUS_REQUEST && (address & 1) == 0
    }

    fn z80_reset_address(&self, address: u32) -> bool {
        (address & 0x00ff_ff00) == Self::Z80_RESET && (address & 1) == 0
    }

    fn z80_ram_mirror_address(&self, address: u32) -> bool {
        (Self::Z80_RAM_BASE..Self::YM2612_END).contains(&address)
    }

    fn z80_bank_register_address(&self, address: u32) -> bool {
        (address & 0x00ff_ff00) == Self::Z80_BANK_REGISTER_BASE
    }

    fn vdp_data_address(&self, address: u32) -> bool {
        (address & 0x00ff_fffc) == 0x00c0_0000
    }

    fn vdp_control_address(&self, address: u32) -> bool {
        (address & 0x00ff_fffc) == 0x00c0_0004
    }

    fn vdp_hv_counter_address(&self, address: u32) -> bool {
        (address & 0x00ff_fffe) == Self::VDP_HV_COUNTER
    }

    fn io_pair(address: u32, base: u32) -> bool {
        address == base || address == (base | 1)
    }
}

fn split_word(word: u16, address: u32) -> u8 {
    if (address & 1) == 0 {
        (word >> 8) as u8
    } else {
        word as u8
    }
}
