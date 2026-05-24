use crate::bus::M68kBus;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct M68k {
    pub d: [u32; 8],
    a: [u32; 7],
    pub usp: u32,
    pub ssp: u32,
    pub pc: u32,
    ccr: u8,
    interrupt_priority_mask: u8,
    supervisor: bool,
    trace: bool,
    pub stopped: bool,
    pub cycles: u64,
    pub total_cycles: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CpuError {
    UnsupportedOpcode { opcode: u16, pc: u32 },
    IllegalAddressingMode { mode: u8, reg: u8, pc: u32 },
    DivideByZero { pc: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Size {
    Byte,
    Word,
    Long,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EaTarget {
    Data(usize),
    Address(usize),
    Memory(u32),
    Immediate(u32),
}

impl Default for M68k {
    fn default() -> Self {
        Self::new()
    }
}

impl M68k {
    pub const ADDRESS_MASK: u32 = 0x00ff_ffff;
    pub const RESET_CYCLES: u32 = 132;
    pub const BUSY_WAIT_BRANCH_CYCLES: u32 = 976;
    pub const FLAG_C: u8 = 0x01;
    pub const FLAG_V: u8 = 0x02;
    pub const FLAG_Z: u8 = 0x04;
    pub const FLAG_N: u8 = 0x08;
    pub const FLAG_X: u8 = 0x10;

    pub fn new() -> Self {
        Self {
            d: [0; 8],
            a: [0; 7],
            usp: 0,
            ssp: 0,
            pc: 0,
            ccr: 0,
            interrupt_priority_mask: 7,
            supervisor: true,
            trace: false,
            stopped: false,
            cycles: 0,
            total_cycles: 0,
        }
    }

    pub fn power_on(&mut self) {
        *self = Self::new();
    }

    pub fn reset(&mut self, bus: &mut M68kBus) -> u32 {
        self.supervisor = true;
        self.trace = false;
        self.interrupt_priority_mask = 7;
        self.stopped = false;
        self.ssp = bus.read_long(0);
        self.pc = bus.read_long(4) & Self::ADDRESS_MASK;
        self.finish(Self::RESET_CYCLES)
    }

    pub fn step(&mut self, bus: &mut M68kBus) -> Result<u32, CpuError> {
        let level = bus.interrupt_level();
        if level > 0 && level > self.interrupt_priority_mask {
            return Ok(self.service_interrupt(bus, level));
        }
        if self.stopped {
            return Ok(self.finish(4));
        }

        let pc = self.pc;
        let opcode = self.fetch_word(bus);
        self.execute_opcode(bus, opcode).map_err(|err| match err {
            CpuError::UnsupportedOpcode { opcode, .. } => {
                CpuError::UnsupportedOpcode { opcode, pc }
            }
            other => other,
        })
    }

    pub fn a(&self) -> [u32; 8] {
        let mut out = [0; 8];
        out[..7].copy_from_slice(&self.a);
        out[7] = self.sp();
        out
    }

    pub fn set_address_register(&mut self, reg: usize, value: u32) {
        self.write_address_register(reg, value);
    }

    pub fn sr(&self) -> u16 {
        (if self.trace { 0x8000 } else { 0 })
            | (if self.supervisor { 0x2000 } else { 0 })
            | (((self.interrupt_priority_mask & 0x07) as u16) << 8)
            | self.ccr as u16
    }

    pub fn set_sr(&mut self, value: u16) {
        let old_sp = self.sp();
        self.trace = (value & 0x8000) != 0;
        let new_supervisor = (value & 0x2000) != 0;
        self.interrupt_priority_mask = ((value >> 8) & 0x07) as u8;
        self.ccr = (value & 0x1f) as u8;
        if new_supervisor != self.supervisor {
            if self.supervisor {
                self.ssp = old_sp;
            } else {
                self.usp = old_sp;
            }
            self.supervisor = new_supervisor;
            self.set_sp(if self.supervisor { self.ssp } else { self.usp });
        }
    }

    pub fn supervisor(&self) -> bool {
        self.supervisor
    }

    pub fn flag_c(&self) -> bool {
        (self.ccr & Self::FLAG_C) != 0
    }

    pub fn flag_v(&self) -> bool {
        (self.ccr & Self::FLAG_V) != 0
    }

    pub fn flag_z(&self) -> bool {
        (self.ccr & Self::FLAG_Z) != 0
    }

    pub fn flag_n(&self) -> bool {
        (self.ccr & Self::FLAG_N) != 0
    }

    pub fn flag_x(&self) -> bool {
        (self.ccr & Self::FLAG_X) != 0
    }

    fn execute_opcode(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        match opcode {
            0x4e71 => return Ok(self.coalesce_nop_run(bus)),
            0x4e70 => return Ok(self.finish(132)),
            0x4e72 => {
                let sr = self.fetch_word(bus);
                self.set_sr(sr);
                self.stopped = true;
                return Ok(self.finish(4));
            }
            0x4e73 => {
                let sr = self.pop_word(bus);
                self.set_sr(sr);
                self.pc = self.pop_long(bus) & Self::ADDRESS_MASK;
                return Ok(self.finish(20));
            }
            0x4e75 => {
                self.pc = self.pop_long(bus) & Self::ADDRESS_MASK;
                return Ok(self.finish(16));
            }
            0x4840..=0x4847 => return Ok(self.swap(opcode)),
            _ => {}
        }

        if (opcode & 0xfff0) == 0x4e40 {
            return Ok(self.trap(bus, (opcode & 0x0f) as u8));
        }
        if (opcode & 0xfff8) == 0x4e50 {
            return Ok(self.link(bus, opcode));
        }
        if (opcode & 0xfff8) == 0x4e58 {
            return Ok(self.unlink(bus, opcode));
        }
        if (opcode & 0xfff0) == 0x4e60 {
            return Ok(self.move_usp(opcode));
        }
        if (opcode & 0xffc0) == 0x4840 {
            return self.pea(bus, opcode);
        }
        if (opcode & 0xffc0) == 0x4e80 || (opcode & 0xffc0) == 0x4ec0 {
            return self.jump_or_jsr(bus, opcode);
        }
        if (opcode & 0xf000) == 0x7000 {
            return Ok(self.moveq(opcode));
        }
        if (opcode & 0xf000) == 0x6000 {
            return Ok(self.branch(bus, opcode));
        }
        if (opcode & 0xf0f8) == 0x50c8 {
            return Ok(self.dbcc(bus, opcode));
        }
        if (opcode & 0xf0c0) == 0x50c0 {
            return self.scc(bus, opcode);
        }
        if (opcode & 0xf000) == 0x5000 && ((opcode >> 6) & 0x03) != 0x03 {
            return self.addq_subq(bus, opcode);
        }
        if (opcode & 0xffb8) == 0x4880 {
            return Ok(self.ext(opcode));
        }
        if (opcode & 0xfb80) == 0x4880 {
            return self.movem(bus, opcode);
        }
        if (opcode & 0xf138) == 0x0108 {
            return self.movep(bus, opcode);
        }
        if (opcode & 0xf100) == 0xc100 && [0x08, 0x09, 0x11].contains(&((opcode >> 3) & 0x1f)) {
            return Ok(self.exg(opcode));
        }
        if (opcode & 0xf1c0) == 0x80c0 {
            return self.divide(bus, opcode, false);
        }
        if (opcode & 0xf1c0) == 0x81c0 {
            return self.divide(bus, opcode, true);
        }
        if (opcode & 0xf1c0) == 0xc0c0 {
            return self.multiply(bus, opcode, false);
        }
        if (opcode & 0xf1c0) == 0xc1c0 {
            return self.multiply(bus, opcode, true);
        }
        if (opcode & 0xf100) == 0x0100 || (opcode & 0xff00) == 0x0800 {
            return self.bit_operation(bus, opcode);
        }
        if (opcode & 0xffc0) == 0x40c0 {
            return self.move_from_sr(bus, opcode);
        }
        if (opcode & 0xffc0) == 0x46c0 || (opcode & 0xffc0) == 0x44c0 {
            return self.move_to_status(bus, opcode);
        }
        if (opcode & 0xff00) == 0x4200 {
            return self.clr(bus, opcode);
        }
        if (opcode & 0xff00) == 0x4400 {
            return self.neg(bus, opcode);
        }
        if (opcode & 0xff00) == 0x4600 && ((opcode >> 6) & 0x03) != 0x03 {
            return self.not_op(bus, opcode);
        }
        if (opcode & 0xffc0) == 0x4ac0 {
            return self.tas(bus, opcode);
        }
        if (opcode & 0xff00) == 0x4a00 {
            return self.tst(bus, opcode);
        }
        if (opcode & 0xf1c0) == 0x41c0 {
            return self.lea(bus, opcode);
        }
        if (opcode & 0xf000) == 0x0000
            && matches!(
                opcode & 0x0f00,
                0x0000 | 0x0200 | 0x0400 | 0x0600 | 0x0a00 | 0x0c00
            )
        {
            return self.immediate_operation(bus, opcode);
        }
        if (opcode & 0xf100) == 0xd100
            && ((opcode >> 6) & 0x03) != 0x03
            && ((opcode >> 3) & 0x07) <= 1
        {
            return self.addx_subx(bus, opcode, false);
        }
        if (opcode & 0xf100) == 0x9100
            && ((opcode >> 6) & 0x03) != 0x03
            && ((opcode >> 3) & 0x07) <= 1
        {
            return self.addx_subx(bus, opcode, true);
        }
        if (opcode & 0xf000) == 0xd000 {
            return self.add_sub(bus, opcode, false);
        }
        if (opcode & 0xf000) == 0x9000 {
            return self.add_sub(bus, opcode, true);
        }
        if (opcode & 0xf100) == 0xb100 && ((opcode >> 6) & 0x03) != 0x03 {
            return self.eor_register(bus, opcode);
        }
        if (opcode & 0xf000) == 0xb000 {
            return self.cmp(bus, opcode);
        }
        if (opcode & 0xf000) == 0x8000 {
            return self.logical_operation(bus, opcode, Logical::Or);
        }
        if (opcode & 0xf000) == 0xc000 {
            return self.logical_operation(bus, opcode, Logical::And);
        }
        if (opcode & 0xf000) == 0xe000 {
            return self.shift_rotate(bus, opcode);
        }
        if matches!((opcode >> 12) & 0x0f, 0x1..=0x3) {
            return self.move_op(bus, opcode);
        }

        Err(CpuError::UnsupportedOpcode {
            opcode,
            pc: self.pc.wrapping_sub(2) & Self::ADDRESS_MASK,
        })
    }

    fn move_op(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let size = match (opcode >> 12) & 0x0f {
            0x1 => Size::Byte,
            0x2 => Size::Long,
            _ => Size::Word,
        };
        let dest_reg = ((opcode >> 9) & 0x07) as u8;
        let dest_mode = ((opcode >> 6) & 0x07) as u8;
        let source_mode = ((opcode >> 3) & 0x07) as u8;
        let source_reg = (opcode & 0x07) as u8;

        let source = self.resolve_ea(bus, source_mode, source_reg, size, false)?;
        let value = self.read_target(bus, source, size);
        let dest = self.resolve_ea(bus, dest_mode, dest_reg, size, true)?;
        if let EaTarget::Address(reg) = dest {
            let value = if size == Size::Word {
                sign_extend(value as u16 as u32, 16)
            } else {
                value
            };
            self.write_address_register(reg, value);
        } else {
            self.write_target(bus, dest, size, value);
            self.set_nz_flags(value, size, true);
        }
        Ok(self.finish(if size == Size::Long { 8 } else { 4 }))
    }

    fn moveq(&mut self, opcode: u16) -> u32 {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let value = sign_extend((opcode & 0xff) as u32, 8);
        self.d[reg] = value;
        self.set_nz_flags(value, Size::Long, true);
        self.finish(4)
    }

    fn branch(&mut self, bus: &mut M68kBus, opcode: u16) -> u32 {
        let cond = ((opcode >> 8) & 0x0f) as u8;
        let low = (opcode & 0xff) as u8;
        let base;
        let displacement = if low == 0 {
            base = self.pc;
            sign_extend(self.fetch_word(bus) as u32, 16) as i32
        } else if low == 0xff {
            base = self.pc;
            self.fetch_long(bus) as i32
        } else {
            base = self.pc;
            (low as i8) as i32
        };
        let target = base.wrapping_add(displacement as u32) & Self::ADDRESS_MASK;

        if cond == 1 {
            self.push_long(bus, self.pc);
            self.pc = target;
            self.finish(18)
        } else if cond == 0 || self.condition_true(cond) {
            self.pc = target;
            self.finish(10)
        } else {
            self.finish(8)
        }
    }

    fn dbcc(&mut self, bus: &mut M68kBus, opcode: u16) -> u32 {
        let cond = ((opcode >> 8) & 0x0f) as u8;
        let reg = (opcode & 0x07) as usize;
        let extension_address = self.pc;
        let displacement = sign_extend(self.fetch_word(bus) as u32, 16);
        if self.condition_true(cond) {
            return self.finish(12);
        }

        let next = (self.d[reg] as u16).wrapping_sub(1);
        self.d[reg] = (self.d[reg] & 0xffff_0000) | next as u32;
        if next != 0xffff {
            let target = extension_address.wrapping_add(displacement) & Self::ADDRESS_MASK;
            if target == extension_address.wrapping_sub(2) & Self::ADDRESS_MASK {
                let iterations = Self::BUSY_WAIT_BRANCH_CYCLES / 10;
                let value = (next as u32).wrapping_sub(iterations.saturating_sub(1)) as u16;
                self.d[reg] = (self.d[reg] & 0xffff_0000) | value as u32;
                self.pc = target;
                self.finish(iterations * 10)
            } else {
                self.pc = target;
                self.finish(10)
            }
        } else {
            self.finish(14)
        }
    }

    fn scc(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let cond = ((opcode >> 8) & 0x0f) as u8;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let target = self.resolve_ea(bus, mode, reg, Size::Byte, true)?;
        let value = if self.condition_true(cond) {
            0xff
        } else {
            0x00
        };
        self.write_target(bus, target, Size::Byte, value);
        Ok(self.finish(if matches!(target, EaTarget::Data(_)) {
            4
        } else {
            8
        }))
    }

    fn addq_subq(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let mut quick = ((opcode >> 9) & 0x07) as u32;
        if quick == 0 {
            quick = 8;
        }
        let subtract = (opcode & 0x0100) != 0;
        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let target = self.resolve_ea(bus, mode, reg, size, true)?;

        if let EaTarget::Address(index) = target {
            let value = self.read_address_register(index);
            let result = if subtract {
                value.wrapping_sub(quick)
            } else {
                value.wrapping_add(quick)
            };
            self.write_address_register(index, result);
            return Ok(self.finish(8));
        }

        let left = self.read_target(bus, target, size);
        let result = if subtract {
            left.wrapping_sub(quick)
        } else {
            left.wrapping_add(quick)
        };
        self.write_target(bus, target, size, result);
        self.set_add_sub_flags(left, quick, result, size, subtract, false);
        Ok(self.finish(8))
    }

    fn lea(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let dest = ((opcode >> 9) & 0x07) as usize;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let address = self.resolve_address(bus, mode, reg, Size::Long)?;
        self.write_address_register(dest, address);
        Ok(self.finish(8))
    }

    fn pea(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let address = self.resolve_address(bus, mode, reg, Size::Long)?;
        self.push_long(bus, address);
        Ok(self.finish(12))
    }

    fn jump_or_jsr(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let jsr = (opcode & 0xffc0) == 0x4e80;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let address = self.resolve_address(bus, mode, reg, Size::Long)?;
        if jsr {
            self.push_long(bus, self.pc);
        }
        self.pc = address & Self::ADDRESS_MASK;
        Ok(self.finish(if jsr { 18 } else { 10 }))
    }

    fn immediate_operation(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        if opcode == 0x023c {
            let value = self.fetch_word(bus) as u8;
            self.ccr &= value & 0x1f;
            return Ok(self.finish(20));
        }
        if opcode == 0x027c {
            let value = self.fetch_word(bus);
            self.set_sr(self.sr() & value);
            return Ok(self.finish(20));
        }
        if opcode == 0x003c {
            let value = self.fetch_word(bus) as u8;
            self.ccr |= value & 0x1f;
            return Ok(self.finish(20));
        }
        if opcode == 0x007c {
            let value = self.fetch_word(bus);
            self.set_sr(self.sr() | value);
            return Ok(self.finish(20));
        }

        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Byte);
        let immediate = self.fetch_immediate(bus, size);
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let opclass = opcode & 0x0f00;
        let target = self.resolve_ea(bus, mode, reg, size, opclass != 0x0c00)?;
        let left = self.read_target(bus, target, size);

        match opclass {
            0x0000 => {
                let result = left | immediate;
                self.write_target(bus, target, size, result);
                self.set_nz_flags(result, size, true);
            }
            0x0200 => {
                let result = left & immediate;
                self.write_target(bus, target, size, result);
                self.set_nz_flags(result, size, true);
            }
            0x0400 => {
                let result = left.wrapping_sub(immediate);
                self.write_target(bus, target, size, result);
                self.set_add_sub_flags(left, immediate, result, size, true, false);
            }
            0x0600 => {
                let result = left.wrapping_add(immediate);
                self.write_target(bus, target, size, result);
                self.set_add_sub_flags(left, immediate, result, size, false, false);
            }
            0x0a00 => {
                let result = left ^ immediate;
                self.write_target(bus, target, size, result);
                self.set_nz_flags(result, size, true);
            }
            0x0c00 => {
                let result = left.wrapping_sub(immediate);
                self.set_add_sub_flags(left, immediate, result, size, true, true);
            }
            _ => unreachable!(),
        }
        Ok(self.finish(8))
    }

    fn addx_subx(
        &mut self,
        bus: &mut M68kBus,
        opcode: u16,
        subtract: bool,
    ) -> Result<u32, CpuError> {
        let dest = ((opcode >> 9) & 0x07) as usize;
        let source = (opcode & 0x07) as usize;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let size = size_from_bits((opcode >> 6) & 0x03).ok_or(CpuError::UnsupportedOpcode {
            opcode,
            pc: self.pc.wrapping_sub(2) & Self::ADDRESS_MASK,
        })?;

        let (left, right, write_address) = if mode == 0 {
            (
                self.d[dest] & size.mask(),
                self.d[source] & size.mask(),
                None,
            )
        } else {
            let source_address = self
                .read_address_register(source)
                .wrapping_sub(size.address_increment(source == 7))
                & Self::ADDRESS_MASK;
            let dest_address = self
                .read_address_register(dest)
                .wrapping_sub(size.address_increment(dest == 7))
                & Self::ADDRESS_MASK;
            self.write_address_register(source, source_address);
            self.write_address_register(dest, dest_address);
            (
                self.read_memory(bus, dest_address, size),
                self.read_memory(bus, source_address, size),
                Some(dest_address),
            )
        };

        let extend = u32::from((self.ccr & Self::FLAG_X) != 0);
        let result = if subtract {
            left.wrapping_sub(right).wrapping_sub(extend)
        } else {
            left.wrapping_add(right).wrapping_add(extend)
        };
        if let Some(address) = write_address {
            self.write_memory(bus, address, size, result);
        } else {
            self.write_data_register(dest, size, result);
        }
        self.set_addx_subx_flags(left, right, result, size, subtract, extend);
        Ok(self.finish(if mode == 0 {
            if size == Size::Long { 8 } else { 4 }
        } else if size == Size::Long {
            30
        } else {
            18
        }))
    }

    fn add_sub(&mut self, bus: &mut M68kBus, opcode: u16, subtract: bool) -> Result<u32, CpuError> {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let ea_reg = (opcode & 0x07) as u8;
        let opmode = (opcode >> 6) & 0x07;

        if opmode == 0x03 || opmode == 0x07 {
            let size = if opmode == 0x07 {
                Size::Long
            } else {
                Size::Word
            };
            let source = self.resolve_ea(bus, mode, ea_reg, size, false)?;
            let value = self.read_target(bus, source, size);
            let left = self.read_address_register(reg);
            let operand = if size == Size::Word {
                sign_extend(value, 16)
            } else {
                value
            };
            let result = if subtract {
                left.wrapping_sub(operand)
            } else {
                left.wrapping_add(operand)
            };
            self.write_address_register(reg, result);
            return Ok(self.finish(8));
        }

        let size = size_from_bits(opmode & 0x03).unwrap_or(Size::Word);
        let direction_to_ea = (opmode & 0x04) != 0;
        if direction_to_ea {
            let target = self.resolve_ea(bus, mode, ea_reg, size, true)?;
            let left = self.read_target(bus, target, size);
            let right = self.d[reg] & size.mask();
            let result = if subtract {
                left.wrapping_sub(right)
            } else {
                left.wrapping_add(right)
            };
            self.write_target(bus, target, size, result);
            self.set_add_sub_flags(left, right, result, size, subtract, false);
        } else {
            let source = self.resolve_ea(bus, mode, ea_reg, size, false)?;
            let right = self.read_target(bus, source, size);
            let left = self.d[reg] & size.mask();
            let result = if subtract {
                left.wrapping_sub(right)
            } else {
                left.wrapping_add(right)
            };
            self.write_data_register(reg, size, result);
            self.set_add_sub_flags(left, right, result, size, subtract, false);
        }
        Ok(self.finish(8))
    }

    fn cmp(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let ea_reg = (opcode & 0x07) as u8;
        let opmode = (opcode >> 6) & 0x07;

        if (opcode & 0xf138) == 0xb108 && ((opcode >> 6) & 0x03) != 0x03 {
            let size = match (opcode >> 6) & 0x03 {
                0 => Size::Byte,
                1 => Size::Word,
                _ => Size::Long,
            };
            let ax = (opcode & 0x07) as usize;
            let ay = ((opcode >> 9) & 0x07) as usize;
            let source_addr = self.read_address_register(ax);
            let dest_addr = self.read_address_register(ay);
            let source = self.read_memory(bus, source_addr, size);
            let dest = self.read_memory(bus, dest_addr, size);
            self.write_address_register(
                ax,
                source_addr.wrapping_add(size.address_increment(ax == 7)),
            );
            self.write_address_register(
                ay,
                dest_addr.wrapping_add(size.address_increment(ay == 7)),
            );
            let result = dest.wrapping_sub(source);
            self.set_add_sub_flags(dest, source, result, size, true, true);
            return Ok(self.finish(12));
        }

        let size = if opmode == 0x03 || opmode == 0x07 {
            if opmode == 0x07 {
                Size::Long
            } else {
                Size::Word
            }
        } else {
            size_from_bits(opmode & 0x03).unwrap_or(Size::Word)
        };
        let source = self.resolve_ea(bus, mode, ea_reg, size, false)?;
        let right = self.read_target(bus, source, size);
        let left = if opmode == 0x03 || opmode == 0x07 {
            self.read_address_register(reg)
        } else {
            self.d[reg] & size.mask()
        };
        let operand = if opmode == 0x03 && size == Size::Word {
            sign_extend(right, 16)
        } else {
            right
        };
        let result = left.wrapping_sub(operand);
        let flag_size = if opmode == 0x03 || opmode == 0x07 {
            Size::Long
        } else {
            size
        };
        self.set_add_sub_flags(left, operand, result, flag_size, true, true);
        Ok(self.finish(6))
    }

    fn logical_operation(
        &mut self,
        bus: &mut M68kBus,
        opcode: u16,
        op: Logical,
    ) -> Result<u32, CpuError> {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let direction_to_ea = (opcode & 0x0100) != 0;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let ea_reg = (opcode & 0x07) as u8;

        if direction_to_ea {
            let target = self.resolve_ea(bus, mode, ea_reg, size, true)?;
            let left = self.read_target(bus, target, size);
            let right = self.d[reg] & size.mask();
            let result = op.apply(left, right);
            self.write_target(bus, target, size, result);
            self.set_nz_flags(result, size, true);
        } else {
            let source = self.resolve_ea(bus, mode, ea_reg, size, false)?;
            let right = self.read_target(bus, source, size);
            let left = self.d[reg] & size.mask();
            let result = op.apply(left, right);
            self.write_data_register(reg, size, result);
            self.set_nz_flags(result, size, true);
        }
        Ok(self.finish(4))
    }

    fn eor_register(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let size = size_from_bits((opcode >> 6) & 0x03).ok_or(CpuError::UnsupportedOpcode {
            opcode,
            pc: self.pc.wrapping_sub(2) & Self::ADDRESS_MASK,
        })?;
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            size,
            true,
        )?;
        let result = self.read_target(bus, target, size) ^ (self.d[reg] & size.mask());
        self.write_target(bus, target, size, result);
        self.set_nz_flags(result, size, true);
        Ok(self.finish(8))
    }

    fn multiply(&mut self, bus: &mut M68kBus, opcode: u16, signed: bool) -> Result<u32, CpuError> {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let source = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            Size::Word,
            false,
        )?;
        let operand = self.read_target(bus, source, Size::Word) as u16;
        let result = if signed {
            ((self.d[reg] as i16 as i32).wrapping_mul(operand as i16 as i32)) as u32
        } else {
            (self.d[reg] & 0xffff).wrapping_mul(operand as u32)
        };
        self.d[reg] = result;
        self.set_nz_flags(result, Size::Long, true);
        Ok(self.finish(70))
    }

    fn divide(&mut self, bus: &mut M68kBus, opcode: u16, signed: bool) -> Result<u32, CpuError> {
        let reg = ((opcode >> 9) & 0x07) as usize;
        let pc = self.pc.wrapping_sub(2) & Self::ADDRESS_MASK;
        let source = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            Size::Word,
            false,
        )?;
        let divisor = self.read_target(bus, source, Size::Word) as u16;
        if divisor == 0 {
            return Err(CpuError::DivideByZero { pc });
        }
        if signed {
            let dividend = self.d[reg] as i32;
            let divisor = divisor as i16 as i32;
            let quotient = dividend / divisor;
            let remainder = dividend % divisor;
            if !(-32768..=32767).contains(&quotient) {
                self.ccr |= Self::FLAG_V;
            } else {
                self.d[reg] = ((remainder as u16 as u32) << 16) | (quotient as u16 as u32);
                self.set_nz_flags(quotient as u16 as u32, Size::Word, true);
            }
        } else {
            let dividend = self.d[reg];
            let quotient = dividend / divisor as u32;
            let remainder = dividend % divisor as u32;
            if quotient > 0xffff {
                self.ccr |= Self::FLAG_V;
            } else {
                self.d[reg] = ((remainder & 0xffff) << 16) | (quotient & 0xffff);
                self.set_nz_flags(quotient, Size::Word, true);
            }
        }
        Ok(self.finish(120))
    }

    fn bit_operation(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let dynamic = (opcode & 0x0100) != 0;
        let op = (opcode >> 6) & 0x03;
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let bit = if dynamic {
            self.d[((opcode >> 9) & 0x07) as usize] as u8
        } else {
            (self.fetch_word(bus) & 0xff) as u8
        };
        let target = self.resolve_ea(bus, mode, reg, Size::Byte, op != 0)?;
        let data_register = matches!(target, EaTarget::Data(_));
        let width = if data_register { 32 } else { 8 };
        let mask = 1u32 << (bit as u32 % width);
        let value_size = if data_register {
            Size::Long
        } else {
            Size::Byte
        };
        let value = self.read_target(bus, target, value_size);
        self.set_flag(Self::FLAG_Z, (value & mask) == 0);
        let result = match op {
            0 => value,
            1 => value ^ mask,
            2 => value & !mask,
            _ => value | mask,
        };
        if op != 0 {
            self.write_target(bus, target, value_size, result);
        }
        Ok(self.finish(8))
    }

    fn move_from_sr(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            Size::Word,
            true,
        )?;
        self.write_target(bus, target, Size::Word, self.sr() as u32);
        Ok(self.finish(6))
    }

    fn move_to_status(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let source = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            Size::Word,
            false,
        )?;
        let value = self.read_target(bus, source, Size::Word) as u16;
        if (opcode & 0xffc0) == 0x44c0 {
            self.ccr = value as u8 & 0x1f;
        } else {
            self.set_sr(value);
        }
        Ok(self.finish(12))
    }

    fn clr(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            size,
            true,
        )?;
        self.write_target(bus, target, size, 0);
        let x = self.ccr & Self::FLAG_X;
        self.ccr = x | Self::FLAG_Z;
        Ok(self.finish(6))
    }

    fn neg(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            size,
            true,
        )?;
        let value = self.read_target(bus, target, size);
        let result = 0u32.wrapping_sub(value);
        self.write_target(bus, target, size, result);
        self.set_add_sub_flags(0, value, result, size, true, false);
        Ok(self.finish(6))
    }

    fn not_op(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            size,
            true,
        )?;
        let result = !self.read_target(bus, target, size);
        self.write_target(bus, target, size, result);
        self.set_nz_flags(result, size, true);
        Ok(self.finish(6))
    }

    fn tst(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            size,
            false,
        )?;
        let value = self.read_target(bus, target, size);
        self.set_nz_flags(value, size, true);
        Ok(self.finish(4))
    }

    fn tas(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let target = self.resolve_ea(
            bus,
            ((opcode >> 3) & 0x07) as u8,
            (opcode & 0x07) as u8,
            Size::Byte,
            true,
        )?;
        let value = self.read_target(bus, target, Size::Byte);
        self.set_nz_flags(value, Size::Byte, true);
        if matches!(target, EaTarget::Data(_)) {
            self.write_target(bus, target, Size::Byte, value | 0x80);
        }
        Ok(self.finish(10))
    }

    fn ext(&mut self, opcode: u16) -> u32 {
        let reg = (opcode & 0x07) as usize;
        if (opcode & 0x0040) == 0 {
            let value = sign_extend(self.d[reg] & 0xff, 8);
            self.d[reg] = (self.d[reg] & 0xffff_0000) | (value & 0xffff);
            self.set_nz_flags(value, Size::Word, true);
        } else {
            let value = sign_extend(self.d[reg] & 0xffff, 16);
            self.d[reg] = value;
            self.set_nz_flags(value, Size::Long, true);
        }
        self.finish(4)
    }

    fn swap(&mut self, opcode: u16) -> u32 {
        let reg = (opcode & 0x07) as usize;
        let value = self.d[reg].rotate_left(16);
        self.d[reg] = value;
        self.set_nz_flags(value, Size::Long, true);
        self.finish(4)
    }

    fn link(&mut self, bus: &mut M68kBus, opcode: u16) -> u32 {
        let reg = (opcode & 0x07) as usize;
        let displacement = sign_extend(self.fetch_word(bus) as u32, 16);
        let old = self.read_address_register(reg);
        self.push_long(bus, old);
        let frame = self.sp();
        self.write_address_register(reg, frame);
        self.set_sp(frame.wrapping_add(displacement));
        self.finish(16)
    }

    fn unlink(&mut self, bus: &mut M68kBus, opcode: u16) -> u32 {
        let reg = (opcode & 0x07) as usize;
        let frame = self.read_address_register(reg);
        self.set_sp(frame);
        let old = self.pop_long(bus);
        self.write_address_register(reg, old);
        self.finish(12)
    }

    fn move_usp(&mut self, opcode: u16) -> u32 {
        let reg = (opcode & 0x07) as usize;
        if (opcode & 0x0008) != 0 {
            self.write_address_register(reg, self.usp);
        } else {
            self.usp = self.read_address_register(reg);
        }
        self.finish(4)
    }

    fn exg(&mut self, opcode: u16) -> u32 {
        let rx = ((opcode >> 9) & 0x07) as usize;
        let ry = (opcode & 0x07) as usize;
        match (opcode >> 3) & 0x1f {
            0x08 => self.d.swap(rx, ry),
            0x09 => {
                let x = self.read_address_register(rx);
                let y = self.read_address_register(ry);
                self.write_address_register(rx, y);
                self.write_address_register(ry, x);
            }
            0x11 => {
                let x = self.d[rx];
                let y = self.read_address_register(ry);
                self.d[rx] = y;
                self.write_address_register(ry, x);
            }
            _ => {}
        }
        self.finish(6)
    }

    fn trap(&mut self, bus: &mut M68kBus, vector: u8) -> u32 {
        self.push_long(bus, self.pc);
        self.push_word(bus, self.sr());
        self.supervisor = true;
        self.pc = bus.read_long(0x80 + vector as u32 * 4) & Self::ADDRESS_MASK;
        self.finish(34)
    }

    fn movem(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let direction_memory_to_reg = (opcode & 0x0400) != 0;
        let size = if (opcode & 0x0040) != 0 {
            Size::Long
        } else {
            Size::Word
        };
        let mode = ((opcode >> 3) & 0x07) as u8;
        let reg = (opcode & 0x07) as u8;
        let mask = self.fetch_word(bus);

        if direction_memory_to_reg {
            let mut address = self.resolve_address(bus, mode, reg, size)?;
            for index in 0..16 {
                if (mask & (1 << index)) == 0 {
                    continue;
                }
                let value = self.read_memory(bus, address, size);
                if index < 8 {
                    self.d[index] = if size == Size::Word {
                        sign_extend(value, 16)
                    } else {
                        value
                    };
                } else {
                    self.write_address_register(
                        index - 8,
                        if size == Size::Word {
                            sign_extend(value, 16)
                        } else {
                            value
                        },
                    );
                }
                address = address.wrapping_add(size.bytes() as u32) & Self::ADDRESS_MASK;
            }
            if mode == 3 {
                self.write_address_register(reg as usize, address);
            }
        } else if mode == 4 {
            let mut address = self.read_address_register(reg as usize);
            for index in 0..16 {
                if (mask & (1 << index)) == 0 {
                    continue;
                }
                let target = 15 - index;
                address = address.wrapping_sub(size.bytes() as u32) & Self::ADDRESS_MASK;
                let value = if target < 8 {
                    self.d[target]
                } else {
                    self.read_address_register(target - 8)
                };
                self.write_memory(bus, address, size, value);
            }
            self.write_address_register(reg as usize, address);
        } else {
            let mut address = self.resolve_address(bus, mode, reg, size)?;
            for index in 0..16 {
                if (mask & (1 << index)) == 0 {
                    continue;
                }
                let value = if index < 8 {
                    self.d[index]
                } else {
                    self.read_address_register(index - 8)
                };
                self.write_memory(bus, address, size, value);
                address = address.wrapping_add(size.bytes() as u32) & Self::ADDRESS_MASK;
            }
        }
        Ok(self.finish(12))
    }

    fn movep(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        let data_reg = ((opcode >> 9) & 0x07) as usize;
        let addr_reg = (opcode & 0x07) as usize;
        let displacement = sign_extend(self.fetch_word(bus) as u32, 16);
        let address = self
            .read_address_register(addr_reg)
            .wrapping_add(displacement)
            & Self::ADDRESS_MASK;
        let memory_to_reg = (opcode & 0x0080) != 0;
        let long = (opcode & 0x0040) != 0;
        if memory_to_reg {
            let mut value = 0;
            let count = if long { 4 } else { 2 };
            for i in 0..count {
                value = (value << 8) | bus.read_byte(address + (i * 2) as u32) as u32;
            }
            self.write_data_register(data_reg, if long { Size::Long } else { Size::Word }, value);
        } else {
            let value = self.d[data_reg];
            let count = if long { 4 } else { 2 };
            for i in 0..count {
                let shift = (count - 1 - i) * 8;
                bus.write_byte(address + (i * 2) as u32, (value >> shift) as u8);
            }
        }
        Ok(self.finish(if long { 24 } else { 16 }))
    }

    fn shift_rotate(&mut self, bus: &mut M68kBus, opcode: u16) -> Result<u32, CpuError> {
        if ((opcode >> 6) & 0x03) == 0x03 {
            let target = self.resolve_ea(
                bus,
                ((opcode >> 3) & 0x07) as u8,
                (opcode & 0x07) as u8,
                Size::Word,
                true,
            )?;
            let value = self.read_target(bus, target, Size::Word);
            let result = self.shift_rotate_value(value, Size::Word, 1, (opcode >> 8) & 0x07, true);
            self.write_target(bus, target, Size::Word, result);
            return Ok(self.finish(8));
        }

        let size = size_from_bits((opcode >> 6) & 0x03).unwrap_or(Size::Word);
        let reg = (opcode & 0x07) as usize;
        let count = if (opcode & 0x0020) != 0 {
            (self.d[((opcode >> 9) & 0x07) as usize] & 0x3f) as u16
        } else {
            let count = (opcode >> 9) & 0x07;
            if count == 0 { 8 } else { count }
        };
        let kind = (opcode >> 3) & 0x03;
        let direction_left = (opcode & 0x0100) != 0;
        let mode = (kind << 1) | u16::from(direction_left);
        let value = self.d[reg] & size.mask();
        let result = self.shift_rotate_value(value, size, count, mode, false);
        self.write_data_register(reg, size, result);
        Ok(self.finish(6 + count as u32 * 2))
    }

    fn shift_rotate_value(
        &mut self,
        value: u32,
        size: Size,
        count: u16,
        mode: u16,
        _memory: bool,
    ) -> u32 {
        let bits = size.bits();
        let mask = size.mask();
        let sign_bit = size.sign_bit();
        let mut result = value & mask;
        let mut carry = false;
        let mut overflow = false;
        let mut extend = (self.ccr & Self::FLAG_X) != 0;
        if count == 0 {
            return result;
        }

        for _ in 0..count {
            match mode & 0x07 {
                0 => {
                    carry = (result & 1) != 0;
                    result = (result >> 1) | (result & sign_bit);
                    extend = carry;
                }
                1 => {
                    let before = result & sign_bit;
                    carry = (result & sign_bit) != 0;
                    result = (result << 1) & mask;
                    overflow |= before != (result & sign_bit);
                    extend = carry;
                }
                2 => {
                    carry = (result & 1) != 0;
                    result >>= 1;
                    extend = carry;
                }
                3 => {
                    carry = (result & sign_bit) != 0;
                    result = (result << 1) & mask;
                    extend = carry;
                }
                4 => {
                    carry = (result & 1) != 0;
                    result = (result >> 1) | (u32::from(extend) << (bits - 1));
                    extend = carry;
                }
                5 => {
                    carry = (result & sign_bit) != 0;
                    result = ((result << 1) | u32::from(extend)) & mask;
                    extend = carry;
                }
                6 => {
                    carry = (result & 1) != 0;
                    result = (result >> 1) | (u32::from(carry) << (bits - 1));
                }
                _ => {
                    carry = (result & sign_bit) != 0;
                    result = ((result << 1) | u32::from(carry)) & mask;
                }
            }
        }

        let old_x = self.ccr & Self::FLAG_X;
        self.ccr = if matches!(mode & 0x07, 0..=5) {
            if extend { Self::FLAG_X } else { 0 }
        } else {
            old_x
        };
        self.set_flag(Self::FLAG_C, count != 0 && carry);
        self.set_flag(Self::FLAG_V, overflow);
        self.set_flag(Self::FLAG_N, (result & size.sign_bit()) != 0);
        self.set_flag(Self::FLAG_Z, (result & mask) == 0);
        result
    }

    fn service_interrupt(&mut self, bus: &mut M68kBus, level: u8) -> u32 {
        self.stopped = false;
        self.push_long(bus, self.pc);
        self.push_word(bus, self.sr());
        self.supervisor = true;
        self.interrupt_priority_mask = level & 0x07;
        bus.acknowledge_interrupt(level);
        self.pc = bus.read_long(0x60 + (level as u32 * 4)) & Self::ADDRESS_MASK;
        self.finish(44)
    }

    fn resolve_ea(
        &mut self,
        bus: &mut M68kBus,
        mode: u8,
        reg: u8,
        size: Size,
        for_write: bool,
    ) -> Result<EaTarget, CpuError> {
        match mode {
            0 => Ok(EaTarget::Data(reg as usize)),
            1 => Ok(EaTarget::Address(reg as usize)),
            2 => Ok(EaTarget::Memory(self.read_address_register(reg as usize))),
            3 => {
                let address = self.read_address_register(reg as usize);
                self.write_address_register(
                    reg as usize,
                    address.wrapping_add(size.address_increment(reg == 7)) & Self::ADDRESS_MASK,
                );
                Ok(EaTarget::Memory(address))
            }
            4 => {
                let address = self
                    .read_address_register(reg as usize)
                    .wrapping_sub(size.address_increment(reg == 7))
                    & Self::ADDRESS_MASK;
                self.write_address_register(reg as usize, address);
                Ok(EaTarget::Memory(address))
            }
            5 | 6 => Ok(EaTarget::Memory(
                self.resolve_address(bus, mode, reg, size)?,
            )),
            7 => match reg {
                0..=3 => Ok(EaTarget::Memory(
                    self.resolve_address(bus, mode, reg, size)?,
                )),
                4 if !for_write => Ok(EaTarget::Immediate(self.fetch_immediate(bus, size))),
                _ => Err(CpuError::IllegalAddressingMode {
                    mode,
                    reg,
                    pc: self.pc,
                }),
            },
            _ => Err(CpuError::IllegalAddressingMode {
                mode,
                reg,
                pc: self.pc,
            }),
        }
    }

    fn resolve_address(
        &mut self,
        bus: &mut M68kBus,
        mode: u8,
        reg: u8,
        _size: Size,
    ) -> Result<u32, CpuError> {
        match mode {
            2 => Ok(self.read_address_register(reg as usize)),
            3 => Ok(self.read_address_register(reg as usize)),
            4 => Ok(self.read_address_register(reg as usize)),
            5 => {
                let displacement = sign_extend(self.fetch_word(bus) as u32, 16);
                Ok(self
                    .read_address_register(reg as usize)
                    .wrapping_add(displacement)
                    & Self::ADDRESS_MASK)
            }
            6 => {
                let extension = self.fetch_word(bus);
                Ok(self.indexed_address(self.read_address_register(reg as usize), extension))
            }
            7 => match reg {
                0 => Ok(sign_extend(self.fetch_word(bus) as u32, 16) & Self::ADDRESS_MASK),
                1 => Ok(self.fetch_long(bus) & Self::ADDRESS_MASK),
                2 => {
                    let base = self.pc;
                    let displacement = sign_extend(self.fetch_word(bus) as u32, 16);
                    Ok(base.wrapping_add(displacement) & Self::ADDRESS_MASK)
                }
                3 => {
                    let base = self.pc;
                    let extension = self.fetch_word(bus);
                    Ok(self.indexed_address(base, extension))
                }
                _ => Err(CpuError::IllegalAddressingMode {
                    mode,
                    reg,
                    pc: self.pc,
                }),
            },
            _ => Err(CpuError::IllegalAddressingMode {
                mode,
                reg,
                pc: self.pc,
            }),
        }
    }

    fn indexed_address(&self, base: u32, extension: u16) -> u32 {
        let displacement = (extension as u8 as i8) as i32 as u32;
        let index_reg = ((extension >> 12) & 0x07) as usize;
        let index_is_address = (extension & 0x8000) != 0;
        let index_long = (extension & 0x0800) != 0;
        let raw = if index_is_address {
            self.read_address_register(index_reg)
        } else {
            self.d[index_reg]
        };
        let index = if index_long {
            raw
        } else {
            sign_extend(raw & 0xffff, 16)
        };
        base.wrapping_add(index).wrapping_add(displacement) & Self::ADDRESS_MASK
    }

    fn read_target(&mut self, bus: &mut M68kBus, target: EaTarget, size: Size) -> u32 {
        match target {
            EaTarget::Data(reg) => self.d[reg] & size.mask(),
            EaTarget::Address(reg) => {
                let value = self.read_address_register(reg);
                if size == Size::Word {
                    value & 0xffff
                } else {
                    value
                }
            }
            EaTarget::Memory(address) => self.read_memory(bus, address, size),
            EaTarget::Immediate(value) => value & size.mask(),
        }
    }

    fn write_target(&mut self, bus: &mut M68kBus, target: EaTarget, size: Size, value: u32) {
        match target {
            EaTarget::Data(reg) => self.write_data_register(reg, size, value),
            EaTarget::Address(reg) => self.write_address_register(reg, value),
            EaTarget::Memory(address) => self.write_memory(bus, address, size, value),
            EaTarget::Immediate(_) => {}
        }
    }

    fn read_memory(&mut self, bus: &mut M68kBus, address: u32, size: Size) -> u32 {
        match size {
            Size::Byte => bus.read_byte_fast(address) as u32,
            Size::Word => bus.read_word_fast(address) as u32,
            Size::Long => bus.read_long_fast(address),
        }
    }

    fn write_memory(&mut self, bus: &mut M68kBus, address: u32, size: Size, value: u32) {
        match size {
            Size::Byte => bus.write_byte(address, value as u8),
            Size::Word => bus.write_word(address, value as u16),
            Size::Long => bus.write_long(address, value),
        }
    }

    fn fetch_immediate(&mut self, bus: &mut M68kBus, size: Size) -> u32 {
        match size {
            Size::Byte => (self.fetch_word(bus) & 0xff) as u32,
            Size::Word => self.fetch_word(bus) as u32,
            Size::Long => self.fetch_long(bus),
        }
    }

    fn fetch_word(&mut self, bus: &mut M68kBus) -> u16 {
        let value = bus.read_word_fast(self.pc);
        self.pc = self.pc.wrapping_add(2) & Self::ADDRESS_MASK;
        value
    }

    fn fetch_long(&mut self, bus: &mut M68kBus) -> u32 {
        let high = self.fetch_word(bus) as u32;
        let low = self.fetch_word(bus) as u32;
        (high << 16) | low
    }

    fn coalesce_nop_run(&mut self, bus: &mut M68kBus) -> u32 {
        let mut count = 1;
        while count < 64 && bus.read_word(self.pc) == 0x4e71 {
            self.pc = self.pc.wrapping_add(2) & Self::ADDRESS_MASK;
            count += 1;
        }
        self.finish(count * 4)
    }

    fn sp(&self) -> u32 {
        if self.supervisor { self.ssp } else { self.usp }
    }

    fn set_sp(&mut self, value: u32) {
        if self.supervisor {
            self.ssp = value;
        } else {
            self.usp = value;
        }
    }

    fn push_word(&mut self, bus: &mut M68kBus, value: u16) {
        let sp = self.sp().wrapping_sub(2) & Self::ADDRESS_MASK;
        self.set_sp(sp);
        bus.write_word(sp, value);
    }

    fn push_long(&mut self, bus: &mut M68kBus, value: u32) {
        let sp = self.sp().wrapping_sub(4) & Self::ADDRESS_MASK;
        self.set_sp(sp);
        bus.write_long(sp, value);
    }

    fn pop_word(&mut self, bus: &mut M68kBus) -> u16 {
        let sp = self.sp();
        let value = bus.read_word(sp);
        self.set_sp(sp.wrapping_add(2) & Self::ADDRESS_MASK);
        value
    }

    fn pop_long(&mut self, bus: &mut M68kBus) -> u32 {
        let sp = self.sp();
        let value = bus.read_long(sp);
        self.set_sp(sp.wrapping_add(4) & Self::ADDRESS_MASK);
        value
    }

    fn read_address_register(&self, reg: usize) -> u32 {
        if reg == 7 { self.sp() } else { self.a[reg] }
    }

    fn write_address_register(&mut self, reg: usize, value: u32) {
        let value = value & Self::ADDRESS_MASK;
        if reg == 7 {
            self.set_sp(value);
        } else {
            self.a[reg] = value;
        }
    }

    fn write_data_register(&mut self, reg: usize, size: Size, value: u32) {
        match size {
            Size::Byte => self.d[reg] = (self.d[reg] & 0xffff_ff00) | (value & 0xff),
            Size::Word => self.d[reg] = (self.d[reg] & 0xffff_0000) | (value & 0xffff),
            Size::Long => self.d[reg] = value,
        }
    }

    fn set_nz_flags(&mut self, value: u32, size: Size, keep_x: bool) {
        let x = if keep_x { self.ccr & Self::FLAG_X } else { 0 };
        let masked = value & size.mask();
        self.ccr = x;
        self.set_flag(Self::FLAG_N, (masked & size.sign_bit()) != 0);
        self.set_flag(Self::FLAG_Z, masked == 0);
    }

    fn set_add_sub_flags(
        &mut self,
        left: u32,
        right: u32,
        result: u32,
        size: Size,
        subtract: bool,
        compare: bool,
    ) {
        let mask = size.mask();
        let sign = size.sign_bit();
        let left = left & mask;
        let right = right & mask;
        let result = result & mask;
        let carry = if subtract {
            right > left
        } else {
            (left as u64 + right as u64) > mask as u64
        };
        let overflow = if subtract {
            ((left ^ right) & (left ^ result) & sign) != 0
        } else {
            (!(left ^ right) & (left ^ result) & sign) != 0
        };
        let old_x = self.ccr & Self::FLAG_X;
        self.ccr = if compare { old_x } else { 0 };
        self.set_flag(Self::FLAG_N, (result & sign) != 0);
        self.set_flag(Self::FLAG_Z, result == 0);
        self.set_flag(Self::FLAG_V, overflow);
        self.set_flag(Self::FLAG_C, carry);
        if !compare {
            self.set_flag(Self::FLAG_X, carry);
        }
    }

    fn set_addx_subx_flags(
        &mut self,
        left: u32,
        right: u32,
        result: u32,
        size: Size,
        subtract: bool,
        extend: u32,
    ) {
        let mask = size.mask();
        let sign = size.sign_bit();
        let left = left & mask;
        let right = right & mask;
        let operand = right.wrapping_add(extend) & mask;
        let result = result & mask;
        let carry = if subtract {
            (right as u64 + extend as u64) > left as u64
        } else {
            (left as u64 + right as u64 + extend as u64) > mask as u64
        };
        let overflow = if subtract {
            ((left ^ operand) & (left ^ result) & sign) != 0
        } else {
            (!(left ^ operand) & (left ^ result) & sign) != 0
        };
        let keep_zero = (self.ccr & Self::FLAG_Z) != 0 && result == 0;
        self.ccr = 0;
        self.set_flag(Self::FLAG_N, (result & sign) != 0);
        self.set_flag(Self::FLAG_Z, keep_zero);
        self.set_flag(Self::FLAG_V, overflow);
        self.set_flag(Self::FLAG_C, carry);
        self.set_flag(Self::FLAG_X, carry);
    }

    fn set_flag(&mut self, flag: u8, enabled: bool) {
        if enabled {
            self.ccr |= flag;
        } else {
            self.ccr &= !flag;
        }
    }

    fn condition_true(&self, cond: u8) -> bool {
        match cond {
            0x0 => true,
            0x1 => false,
            0x2 => !self.flag_c() && !self.flag_z(),
            0x3 => self.flag_c() || self.flag_z(),
            0x4 => !self.flag_c(),
            0x5 => self.flag_c(),
            0x6 => !self.flag_z(),
            0x7 => self.flag_z(),
            0x8 => !self.flag_v(),
            0x9 => self.flag_v(),
            0xa => !self.flag_n(),
            0xb => self.flag_n(),
            0xc => self.flag_n() == self.flag_v(),
            0xd => self.flag_n() != self.flag_v(),
            0xe => !self.flag_z() && self.flag_n() == self.flag_v(),
            0xf => self.flag_z() || self.flag_n() != self.flag_v(),
            _ => false,
        }
    }

    fn finish(&mut self, cycles: u32) -> u32 {
        self.cycles = cycles as u64;
        self.total_cycles = self.total_cycles.wrapping_add(cycles as u64);
        cycles
    }
}

#[derive(Clone, Copy)]
enum Logical {
    Or,
    And,
}

impl Logical {
    fn apply(self, left: u32, right: u32) -> u32 {
        match self {
            Self::Or => left | right,
            Self::And => left & right,
        }
    }
}

impl Size {
    fn bytes(self) -> usize {
        match self {
            Size::Byte => 1,
            Size::Word => 2,
            Size::Long => 4,
        }
    }

    fn bits(self) -> u32 {
        match self {
            Size::Byte => 8,
            Size::Word => 16,
            Size::Long => 32,
        }
    }

    fn mask(self) -> u32 {
        match self {
            Size::Byte => 0xff,
            Size::Word => 0xffff,
            Size::Long => 0xffff_ffff,
        }
    }

    fn sign_bit(self) -> u32 {
        match self {
            Size::Byte => 0x80,
            Size::Word => 0x8000,
            Size::Long => 0x8000_0000,
        }
    }

    fn address_increment(self, a7: bool) -> u32 {
        match (self, a7) {
            (Size::Byte, true) => 2,
            (Size::Byte, false) => 1,
            (Size::Word, _) => 2,
            (Size::Long, _) => 4,
        }
    }
}

fn size_from_bits(bits: u16) -> Option<Size> {
    match bits & 0x03 {
        0 => Some(Size::Byte),
        1 => Some(Size::Word),
        2 => Some(Size::Long),
        _ => None,
    }
}

fn sign_extend(value: u32, bits: u32) -> u32 {
    let shift = 32 - bits;
    (((value << shift) as i32) >> shift) as u32
}
