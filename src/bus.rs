use crate::audio::{Psg, Ym2612, Ym2612Snapshot};
use crate::controller::Controller;
use crate::vdp::{Vdp, VdpDmaMode, VdpSnapshot};
use serde::{Deserialize, Serialize};

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
}

impl Default for M68kBus {
    fn default() -> Self {
        Self::new()
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
    }

    pub fn load_rom(&mut self, rom: Vec<u8>) {
        self.rom = rom;
        self.rom_mask = if self.rom.len().is_power_of_two() {
            Some(self.rom.len() - 1)
        } else {
            None
        };
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
        if self.z80_ram_mirror_address(address) {
            return if self.z80_bus_requested {
                let value = self.z80_ram[(address as usize) & 0x1fff] as u16;
                (value << 8) | value
            } else {
                0xffff
            };
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
        ((self.read_word(address) as u32) << 16) | self.read_word(address + 2) as u32
    }

    pub fn read_word_fast(&mut self, address: u32) -> u16 {
        self.read_word(address)
    }

    pub fn read_long_fast(&mut self, address: u32) -> u32 {
        self.read_long(address)
    }

    pub fn peek_byte(&self, address: u32) -> u8 {
        let address = address & Self::ADDRESS_MASK;
        if self.work_ram_address(address) {
            return self.work_ram[(address & Self::WORK_RAM_MASK) as usize];
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
        } else if self.z80_bus_request_address(address) {
            self.z80_bus_requested = (value & 0x01) != 0;
        } else if self.z80_reset_address(address) {
            self.z80_reset_asserted = (value & 0x01) == 0;
        } else if self.z80_ram_mirror_address(address) {
            if self.z80_bus_requested {
                self.z80_ram[(address as usize) & 0x1fff] = value;
            }
        } else if self.z80_bank_register_address(address) {
            // Bank register is accepted; full Z80 bus banking is outside this first Rust core.
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
        if self.z80_ram_mirror_address(address) {
            if self.z80_bus_requested {
                self.z80_ram[(address as usize) & 0x1fff] = (value >> 8) as u8;
            }
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
        self.write_word(address, (value >> 16) as u16);
        self.write_word(address + 2, value as u16);
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

    fn finish_vdp_dma(&mut self) {
        let Some(mode) = self.vdp.take_dma_request() else {
            return;
        };
        match mode {
            VdpDmaMode::MemoryToVdp => {
                let mut source = self.vdp.dma_source_address();
                let length = self.vdp.dma_length_words();
                let target = self.vdp.dma_target_address();
                self.vdp.record_dma_transfer(source, target, length);
                for _ in 0..length {
                    let value = self.read_word(source);
                    self.vdp.write_dma_word(value);
                    source = source.wrapping_add(2) & Self::ADDRESS_MASK;
                }
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
