use crate::bus::M68kBus;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use z80_emu::BusInterface;
use z80_emu::traits::InterruptLine;

fn genesis_ym_io_port(address: u16) -> Option<u32> {
    let low = address & 0x00ff;
    if (0x40..=0x43).contains(&low) || low <= 0x03 {
        Some(u32::from(low & 0x03))
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum IndexReg {
    Ix,
    Iy,
}

#[derive(Clone, Debug)]
pub struct Z80 {
    pub a: u8,
    pub f: u8,
    pub b: u8,
    pub c: u8,
    pub d: u8,
    pub e: u8,
    pub h: u8,
    pub l: u8,
    a_alt: u8,
    f_alt: u8,
    b_alt: u8,
    c_alt: u8,
    d_alt: u8,
    e_alt: u8,
    h_alt: u8,
    l_alt: u8,
    pub pc: u16,
    pub sp: u16,
    pub ix: u16,
    pub iy: u16,
    pub i: u8,
    pub r: u8,
    pub halted: bool,
    pub iff1: bool,
    pub iff2: bool,
    ei_pending: bool,
    ei_pending_done: bool,
    pub im: u8,
    pub cycles: u32,
    pub total_cycles: u64,
    pub last_run_steps: u64,
    jg: z80_emu::Z80,
}

#[derive(Serialize, Deserialize)]
struct Z80Serde {
    a: u8,
    f: u8,
    b: u8,
    c: u8,
    d: u8,
    e: u8,
    h: u8,
    l: u8,
    a_alt: u8,
    f_alt: u8,
    b_alt: u8,
    c_alt: u8,
    d_alt: u8,
    e_alt: u8,
    h_alt: u8,
    l_alt: u8,
    pc: u16,
    sp: u16,
    ix: u16,
    iy: u16,
    i: u8,
    r: u8,
    halted: bool,
    iff1: bool,
    iff2: bool,
    ei_pending: bool,
    ei_pending_done: bool,
    im: u8,
    cycles: u32,
    total_cycles: u64,
    last_run_steps: u64,
    #[serde(default)]
    jg_bincode: Vec<u8>,
}

struct JgBus<'a> {
    bus: &'a mut M68kBus,
    int: InterruptLine,
}

impl Serialize for Z80 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let jg_bincode = bincode::encode_to_vec(&self.jg, bincode::config::standard())
            .map_err(serde::ser::Error::custom)?;
        Z80Serde {
            a: self.a,
            f: self.f,
            b: self.b,
            c: self.c,
            d: self.d,
            e: self.e,
            h: self.h,
            l: self.l,
            a_alt: self.a_alt,
            f_alt: self.f_alt,
            b_alt: self.b_alt,
            c_alt: self.c_alt,
            d_alt: self.d_alt,
            e_alt: self.e_alt,
            h_alt: self.h_alt,
            l_alt: self.l_alt,
            pc: self.pc,
            sp: self.sp,
            ix: self.ix,
            iy: self.iy,
            i: self.i,
            r: self.r,
            halted: self.halted,
            iff1: self.iff1,
            iff2: self.iff2,
            ei_pending: self.ei_pending,
            ei_pending_done: self.ei_pending_done,
            im: self.im,
            cycles: self.cycles,
            total_cycles: self.total_cycles,
            last_run_steps: self.last_run_steps,
            jg_bincode,
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Z80 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let snapshot = Z80Serde::deserialize(deserializer)?;
        let mut jg = if snapshot.jg_bincode.is_empty() {
            z80_emu::Z80::new()
        } else {
            bincode::decode_from_slice::<z80_emu::Z80, _>(
                &snapshot.jg_bincode,
                bincode::config::standard(),
            )
            .map(|(jg, _)| jg)
            .map_err(serde::de::Error::custom)?
        };
        if snapshot.jg_bincode.is_empty() {
            jg.set_pc(snapshot.pc);
            jg.set_sp(snapshot.sp);
            jg.set_interrupt_mode(match snapshot.im {
                1 => z80_emu::InterruptMode::Mode1,
                2 => z80_emu::InterruptMode::Mode2,
                _ => z80_emu::InterruptMode::Mode0,
            });
        }

        Ok(Self {
            a: snapshot.a,
            f: snapshot.f,
            b: snapshot.b,
            c: snapshot.c,
            d: snapshot.d,
            e: snapshot.e,
            h: snapshot.h,
            l: snapshot.l,
            a_alt: snapshot.a_alt,
            f_alt: snapshot.f_alt,
            b_alt: snapshot.b_alt,
            c_alt: snapshot.c_alt,
            d_alt: snapshot.d_alt,
            e_alt: snapshot.e_alt,
            h_alt: snapshot.h_alt,
            l_alt: snapshot.l_alt,
            pc: snapshot.pc,
            sp: snapshot.sp,
            ix: snapshot.ix,
            iy: snapshot.iy,
            i: snapshot.i,
            r: snapshot.r,
            halted: snapshot.halted,
            iff1: snapshot.iff1,
            iff2: snapshot.iff2,
            ei_pending: snapshot.ei_pending,
            ei_pending_done: snapshot.ei_pending_done,
            im: snapshot.im,
            cycles: snapshot.cycles,
            total_cycles: snapshot.total_cycles,
            last_run_steps: snapshot.last_run_steps,
            jg,
        })
    }
}

impl BusInterface for JgBus<'_> {
    fn read_memory(&mut self, address: u16) -> u8 {
        self.bus.z80_read_byte(address)
    }

    fn write_memory(&mut self, address: u16, value: u8) {
        self.bus.z80_write_byte(address, value);
    }

    fn read_io(&mut self, address: u16) -> u8 {
        if let Some(port) = genesis_ym_io_port(address) {
            self.bus.ym2612.sync_to_cycle(self.bus.ym_frame_cycle);
            return self.bus.ym2612.read_register(port);
        }
        0xff
    }

    fn write_io(&mut self, address: u16, value: u8) {
        if let Some(port) = genesis_ym_io_port(address) {
            self.bus.ym2612.sync_to_cycle(self.bus.ym_frame_cycle);
            self.bus
                .ym2612
                .write_port(port, value, Some(self.bus.ym_frame_cycle));
        }
    }

    fn nmi(&self) -> InterruptLine {
        InterruptLine::High
    }

    fn int(&self) -> InterruptLine {
        self.int
    }

    fn busreq(&self) -> bool {
        false
    }

    fn reset(&self) -> bool {
        false
    }
}

impl Default for Z80 {
    fn default() -> Self {
        Self::new()
    }
}

impl Z80 {
    const FLAG_C: u8 = 0x01;
    const FLAG_N: u8 = 0x02;
    const FLAG_P: u8 = 0x04;
    const FLAG_3: u8 = 0x08;
    const FLAG_H: u8 = 0x10;
    const FLAG_5: u8 = 0x20;
    const FLAG_Z: u8 = 0x40;
    const FLAG_S: u8 = 0x80;
    const FLAG_YX: u8 = Self::FLAG_3 | Self::FLAG_5;

    pub fn new() -> Self {
        let mut z80 = Self {
            a: 0,
            f: 0,
            b: 0,
            c: 0,
            d: 0,
            e: 0,
            h: 0,
            l: 0,
            a_alt: 0,
            f_alt: 0,
            b_alt: 0,
            c_alt: 0,
            d_alt: 0,
            e_alt: 0,
            h_alt: 0,
            l_alt: 0,
            pc: 0,
            sp: 0,
            ix: 0,
            iy: 0,
            i: 0,
            r: 0,
            halted: false,
            iff1: false,
            iff2: false,
            ei_pending: false,
            ei_pending_done: false,
            im: 0,
            cycles: 0,
            total_cycles: 0,
            last_run_steps: 0,
            jg: z80_emu::Z80::new(),
        };
        z80.reset();
        z80
    }

    pub fn reset(&mut self) {
        self.a = 0;
        self.f = 0;
        self.b = 0;
        self.c = 0;
        self.d = 0;
        self.e = 0;
        self.h = 0;
        self.l = 0;
        self.a_alt = 0;
        self.f_alt = 0;
        self.b_alt = 0;
        self.c_alt = 0;
        self.d_alt = 0;
        self.e_alt = 0;
        self.h_alt = 0;
        self.l_alt = 0;
        self.pc = 0;
        self.sp = 0;
        self.ix = 0;
        self.iy = 0;
        self.i = 0;
        self.r = 0;
        self.halted = false;
        self.iff1 = false;
        self.iff2 = false;
        self.ei_pending = false;
        self.ei_pending_done = false;
        self.im = 0;
        self.cycles = 0;
        self.total_cycles = 0;
        self.last_run_steps = 0;
        self.jg = z80_emu::Z80::new();
        self.jg.set_sp(self.sp);
    }

    pub fn run_cycles(&mut self, bus: &mut M68kBus, max_cycles: f64) -> f64 {
        if max_cycles <= 0.0 || !bus.z80_running() {
            return 0.0;
        }
        if self.halted {
            let cycles = max_cycles.floor().max(0.0) as u32;
            self.cycles = cycles;
            self.total_cycles = self.total_cycles.wrapping_add(u64::from(cycles));
            self.last_run_steps = u64::from(cycles.div_ceil(4));
            return f64::from(cycles);
        }

        let mut ran = 0u32;
        let target = max_cycles.floor().max(0.0) as u32;
        let mut steps = 0u64;
        while ran < target && bus.z80_running() {
            ran = ran.saturating_add(self.step(bus));
            steps += 1;
        }
        self.last_run_steps = steps;
        f64::from(ran)
    }

    pub fn run_cycles_jg(
        &mut self,
        bus: &mut M68kBus,
        max_cycles: f64,
        int_low: bool,
        ym_cycle_cursor: &mut f64,
        ym_cycle_limit: f64,
        m68k_cycles_per_z80_cycle: f64,
    ) -> (f64, bool) {
        if max_cycles <= 0.0 || !bus.z80_running() {
            return (0.0, false);
        }

        let target = max_cycles.floor().max(0.0) as u32;
        let mut ran = 0u32;
        let mut steps = 0u64;
        let mut serviced_interrupt = false;
        while ran < target && bus.z80_running() {
            let int = if int_low {
                InterruptLine::Low
            } else {
                InterruptLine::High
            };
            bus.ym_frame_cycle = ym_cycle_cursor.min(ym_cycle_limit).max(0.0).round() as u64;
            let mut adapter = JgBus { bus, int };
            let before_pc = self.jg.pc();
            let cycles = self.jg.execute_instruction(&mut adapter);
            ran = ran.saturating_add(cycles);
            *ym_cycle_cursor = (*ym_cycle_cursor + f64::from(cycles) * m68k_cycles_per_z80_cycle)
                .min(ym_cycle_limit);
            steps += 1;
            if int_low && cycles == 13 && self.jg.pc() == 0x0038 && before_pc != 0x0038 {
                serviced_interrupt = true;
            }
            if cycles == 0 {
                break;
            }
        }
        self.pc = self.jg.pc();
        self.cycles = ran;
        self.total_cycles = self.total_cycles.wrapping_add(u64::from(ran));
        self.last_run_steps = steps;
        (f64::from(ran), serviced_interrupt)
    }

    pub fn step(&mut self, bus: &mut M68kBus) -> u32 {
        if self.halted {
            self.finish(4);
            return self.cycles;
        }
        self.cycles = 0;
        let opcode = self.fetch_opcode(bus);
        self.execute_opcode(bus, opcode);
        if self.ei_pending_done {
            self.iff1 = true;
            self.iff2 = true;
        }
        self.ei_pending_done = self.ei_pending;
        self.ei_pending = false;
        self.total_cycles = self.total_cycles.wrapping_add(u64::from(self.cycles));
        self.cycles
    }

    pub fn interrupt(&mut self, bus: &mut M68kBus, vector: u8) -> u32 {
        if !self.iff1 {
            return 0;
        }
        self.iff1 = false;
        self.iff2 = false;
        self.halted = false;
        self.push_word(bus, self.pc);
        self.pc = if self.im == 2 {
            self.read_word(bus, (u16::from(self.i) << 8) | u16::from(vector))
        } else {
            0x0038
        };
        self.cycles = if self.im == 2 { 19 } else { 13 };
        self.total_cycles = self.total_cycles.wrapping_add(u64::from(self.cycles));
        self.cycles
    }

    fn execute_opcode(&mut self, bus: &mut M68kBus, opcode: u8) {
        match opcode {
            0xcb => {
                let op = self.fetch_opcode(bus);
                self.execute_cb(bus, op, None, None);
            }
            0xed => {
                let op = self.fetch_opcode(bus);
                self.execute_ed(bus, op);
            }
            0xdd => self.execute_index(bus, IndexReg::Ix),
            0xfd => self.execute_index(bus, IndexReg::Iy),
            _ => self.execute_base(bus, opcode, None),
        }
    }

    fn execute_index(&mut self, bus: &mut M68kBus, index: IndexReg) {
        let opcode = self.fetch_opcode(bus);
        match opcode {
            0xdd | 0xfd => self.execute_index(bus, index),
            0xcb => self.execute_ddfd_cb(bus, index),
            0xed => self.execute_opcode(bus, opcode),
            _ => self.execute_base(bus, opcode, Some(index)),
        }
    }

    fn execute_base(&mut self, bus: &mut M68kBus, opcode: u8, index: Option<IndexReg>) {
        if (0x40..=0x7f).contains(&opcode) {
            if opcode == 0x76 {
                self.halted = true;
                self.finish(4);
                return;
            }
            let dst = (opcode >> 3) & 7;
            let src = opcode & 7;
            let value = self.read_reg8(bus, src, index);
            self.write_reg8(bus, dst, value, index);
            self.finish(Self::ld_r_r_cycles(dst, src, index));
            return;
        }

        if (0x80..=0xbf).contains(&opcode) {
            let op = (opcode >> 3) & 7;
            let src = opcode & 7;
            let value = self.read_reg8(bus, src, index);
            self.alu(op, value);
            self.finish(if src == 6 {
                if index.is_some() { 19 } else { 7 }
            } else if index.is_some() && Self::uses_index_reg(src) {
                8
            } else {
                4
            });
            return;
        }

        match opcode {
            0x00 => self.finish(4),
            0x01 | 0x11 | 0x21 | 0x31 => {
                let value = self.fetch_word(bus);
                self.set_rp((opcode >> 4) & 3, value, index);
                self.finish(if index.is_some() && opcode == 0x21 {
                    14
                } else {
                    10
                });
            }
            0x02 => {
                bus.z80_write_byte(self.bc(), self.a);
                self.finish(7);
            }
            0x12 => {
                bus.z80_write_byte(self.de(), self.a);
                self.finish(7);
            }
            0x0a => {
                self.a = bus.z80_read_byte(self.bc());
                self.finish(7);
            }
            0x1a => {
                self.a = bus.z80_read_byte(self.de());
                self.finish(7);
            }
            0x03 | 0x13 | 0x23 | 0x33 => {
                let rp = (opcode >> 4) & 3;
                let value = self.get_rp(rp, index).wrapping_add(1);
                self.set_rp(rp, value, index);
                self.finish(if index.is_some() && opcode == 0x23 {
                    10
                } else {
                    6
                });
            }
            0x0b | 0x1b | 0x2b | 0x3b => {
                let rp = (opcode >> 4) & 3;
                let value = self.get_rp(rp, index).wrapping_sub(1);
                self.set_rp(rp, value, index);
                self.finish(if index.is_some() && opcode == 0x2b {
                    10
                } else {
                    6
                });
            }
            0x04 | 0x0c | 0x14 | 0x1c | 0x24 | 0x2c | 0x34 | 0x3c => {
                let reg = (opcode >> 3) & 7;
                if let (Some(index), 6) = (index, reg) {
                    let addr = self.indexed_addr(bus, index);
                    let value = self.inc8(bus.z80_read_byte(addr));
                    bus.z80_write_byte(addr, value);
                } else {
                    let old = self.read_reg8(bus, reg, index);
                    let value = self.inc8(old);
                    self.write_reg8(bus, reg, value, index);
                }
                self.finish(if reg == 6 {
                    if index.is_some() { 23 } else { 11 }
                } else if index.is_some() && Self::uses_index_reg(reg) {
                    8
                } else {
                    4
                });
            }
            0x05 | 0x0d | 0x15 | 0x1d | 0x25 | 0x2d | 0x35 | 0x3d => {
                let reg = (opcode >> 3) & 7;
                if let (Some(index), 6) = (index, reg) {
                    let addr = self.indexed_addr(bus, index);
                    let value = self.dec8(bus.z80_read_byte(addr));
                    bus.z80_write_byte(addr, value);
                } else {
                    let old = self.read_reg8(bus, reg, index);
                    let value = self.dec8(old);
                    self.write_reg8(bus, reg, value, index);
                }
                self.finish(if reg == 6 {
                    if index.is_some() { 23 } else { 11 }
                } else if index.is_some() && Self::uses_index_reg(reg) {
                    8
                } else {
                    4
                });
            }
            0x06 | 0x0e | 0x16 | 0x1e | 0x26 | 0x2e | 0x36 | 0x3e => {
                let reg = (opcode >> 3) & 7;
                if let (Some(index), 6) = (index, reg) {
                    let addr = self.indexed_addr(bus, index);
                    let value = self.fetch_byte(bus);
                    bus.z80_write_byte(addr, value);
                } else {
                    let value = self.fetch_byte(bus);
                    self.write_reg8(bus, reg, value, index);
                }
                self.finish(if reg == 6 {
                    if index.is_some() { 19 } else { 10 }
                } else if index.is_some() && Self::uses_index_reg(reg) {
                    11
                } else {
                    7
                });
            }
            0x07 => {
                self.a = self.rlc_a(self.a);
                self.finish(4);
            }
            0x0f => {
                self.a = self.rrc_a(self.a);
                self.finish(4);
            }
            0x17 => {
                self.a = self.rl_a(self.a);
                self.finish(4);
            }
            0x1f => {
                self.a = self.rr_a(self.a);
                self.finish(4);
            }
            0x08 => {
                self.ex_af();
                self.finish(4);
            }
            0x09 | 0x19 | 0x29 | 0x39 => {
                let target = index
                    .map(|idx| self.get_index(idx))
                    .unwrap_or_else(|| self.hl());
                let result = self.add16(target, self.get_rp((opcode >> 4) & 3, index));
                if let Some(idx) = index {
                    self.set_index(idx, result);
                } else {
                    self.set_hl(result);
                }
                self.finish(if index.is_some() { 15 } else { 11 });
            }
            0x10 => {
                self.b = self.b.wrapping_sub(1);
                let disp = self.fetch_byte(bus);
                if self.b != 0 {
                    self.jr(disp);
                    self.finish(13);
                } else {
                    self.finish(8);
                }
            }
            0x18 => {
                let disp = self.fetch_byte(bus);
                self.jr(disp);
                self.finish(12);
            }
            0x20 | 0x28 | 0x30 | 0x38 => {
                let cond = match opcode {
                    0x20 => self.f & Self::FLAG_Z == 0,
                    0x28 => self.f & Self::FLAG_Z != 0,
                    0x30 => self.f & Self::FLAG_C == 0,
                    _ => self.f & Self::FLAG_C != 0,
                };
                let disp = self.fetch_byte(bus);
                if cond {
                    self.jr(disp);
                }
                self.finish(if cond { 12 } else { 7 });
            }
            0x22 => {
                let addr = self.fetch_word(bus);
                let value = index
                    .map(|idx| self.get_index(idx))
                    .unwrap_or_else(|| self.hl());
                self.write_word(bus, addr, value);
                self.finish(if index.is_some() { 20 } else { 16 });
            }
            0x2a => {
                let addr = self.fetch_word(bus);
                let value = self.read_word(bus, addr);
                if let Some(idx) = index {
                    self.set_index(idx, value);
                } else {
                    self.set_hl(value);
                }
                self.finish(if index.is_some() { 20 } else { 16 });
            }
            0x27 => {
                self.daa();
                self.finish(4);
            }
            0x2f => {
                self.a ^= 0xff;
                self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P | Self::FLAG_C))
                    | (self.a & Self::FLAG_YX)
                    | Self::FLAG_H
                    | Self::FLAG_N;
                self.finish(4);
            }
            0x32 => {
                let addr = self.fetch_word(bus);
                bus.z80_write_byte(addr, self.a);
                self.finish(13);
            }
            0x3a => {
                let addr = self.fetch_word(bus);
                self.a = bus.z80_read_byte(addr);
                self.finish(13);
            }
            0x37 => {
                self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
                    | (self.a & Self::FLAG_YX)
                    | Self::FLAG_C;
                self.finish(4);
            }
            0x3f => {
                let old_c = self.f & Self::FLAG_C;
                self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
                    | (self.a & Self::FLAG_YX)
                    | if old_c != 0 {
                        Self::FLAG_H
                    } else {
                        Self::FLAG_C
                    };
                self.finish(4);
            }
            0xc0 | 0xc8 | 0xd0 | 0xd8 | 0xe0 | 0xe8 | 0xf0 | 0xf8 => {
                self.ret_cond(bus, self.condition_met((opcode >> 3) & 7));
            }
            0xc1 | 0xd1 | 0xe1 | 0xf1 => {
                let value = self.pop_word(bus);
                self.set_rp2((opcode >> 4) & 3, value, index);
                self.finish(if index.is_some() && opcode == 0xe1 {
                    14
                } else {
                    10
                });
            }
            0xc2 | 0xca | 0xd2 | 0xda | 0xe2 | 0xea | 0xf2 | 0xfa => {
                self.jp_cond(bus, self.condition_met((opcode >> 3) & 7));
            }
            0xc3 => {
                self.pc = self.fetch_word(bus);
                self.finish(10);
            }
            0xc4 | 0xcc | 0xd4 | 0xdc | 0xe4 | 0xec | 0xf4 | 0xfc => {
                self.call_cond(bus, self.condition_met((opcode >> 3) & 7));
            }
            0xc5 | 0xd5 | 0xe5 | 0xf5 => {
                self.push_word(bus, self.get_rp2((opcode >> 4) & 3, index));
                self.finish(if index.is_some() && opcode == 0xe5 {
                    15
                } else {
                    11
                });
            }
            0xc6 | 0xce | 0xd6 | 0xde | 0xe6 | 0xee | 0xf6 | 0xfe => {
                let value = self.fetch_byte(bus);
                self.alu((opcode >> 3) & 7, value);
                self.finish(7);
            }
            0xc7 | 0xcf | 0xd7 | 0xdf | 0xe7 | 0xef | 0xf7 | 0xff => {
                self.push_word(bus, self.pc);
                self.pc = u16::from(opcode & 0x38);
                self.finish(11);
            }
            0xc9 => {
                self.pc = self.pop_word(bus);
                self.finish(10);
            }
            0xcd => {
                let addr = self.fetch_word(bus);
                self.push_word(bus, self.pc);
                self.pc = addr;
                self.finish(17);
            }
            0xd3 => {
                let port = (u16::from(self.a) << 8) | u16::from(self.fetch_byte(bus));
                self.write_io(bus, port, self.a);
                self.finish(11);
            }
            0xdb => {
                let port = (u16::from(self.a) << 8) | u16::from(self.fetch_byte(bus));
                self.a = self.read_io(bus, port);
                self.finish(11);
            }
            0xd9 => {
                self.exx();
                self.finish(4);
            }
            0xe3 => {
                let value = self.pop_word(bus);
                self.push_word(
                    bus,
                    index
                        .map(|idx| self.get_index(idx))
                        .unwrap_or_else(|| self.hl()),
                );
                if let Some(idx) = index {
                    self.set_index(idx, value);
                } else {
                    self.set_hl(value);
                }
                self.finish(if index.is_some() { 23 } else { 19 });
            }
            0xe9 => {
                self.pc = index
                    .map(|idx| self.get_index(idx))
                    .unwrap_or_else(|| self.hl());
                self.finish(if index.is_some() { 8 } else { 4 });
            }
            0xeb => {
                let old = self.de();
                self.set_de(self.hl());
                self.set_hl(old);
                self.finish(4);
            }
            0xf3 => {
                self.iff1 = false;
                self.iff2 = false;
                self.ei_pending = false;
                self.ei_pending_done = false;
                self.finish(4);
            }
            0xf9 => {
                self.sp = index
                    .map(|idx| self.get_index(idx))
                    .unwrap_or_else(|| self.hl());
                self.finish(if index.is_some() { 10 } else { 6 });
            }
            0xfb => {
                self.ei_pending = true;
                self.finish(4);
            }
            _ => self.finish(4),
        }
    }

    fn execute_cb(
        &mut self,
        bus: &mut M68kBus,
        opcode: u8,
        index: Option<IndexReg>,
        addr: Option<u16>,
    ) {
        let x = opcode >> 6;
        let y = (opcode >> 3) & 7;
        let z = opcode & 7;
        let value = addr
            .map(|a| bus.z80_read_byte(a))
            .unwrap_or_else(|| self.read_reg8(bus, z, index));
        let mut result = value;
        match x {
            0 => {
                result = self.rotate_shift(y, value);
                if let Some(a) = addr {
                    bus.z80_write_byte(a, result);
                } else {
                    self.write_reg8(bus, z, result, index);
                }
            }
            1 => self.bit_test(y, value, addr),
            2 => {
                result = value & !(1 << y);
                if let Some(a) = addr {
                    bus.z80_write_byte(a, result);
                } else {
                    self.write_reg8(bus, z, result, index);
                }
            }
            3 => {
                result = value | (1 << y);
                if let Some(a) = addr {
                    bus.z80_write_byte(a, result);
                } else {
                    self.write_reg8(bus, z, result, index);
                }
            }
            _ => {}
        }
        if addr.is_some() && x != 1 && z != 6 {
            self.write_reg8(bus, z, result, None);
        }
        self.finish(if addr.is_some() {
            23
        } else if z == 6 {
            15
        } else {
            8
        });
    }

    fn execute_ddfd_cb(&mut self, bus: &mut M68kBus, index: IndexReg) {
        let disp = self.fetch_byte(bus);
        let opcode = self.fetch_opcode(bus);
        let addr = self
            .get_index(index)
            .wrapping_add(Self::signed8(disp) as u16);
        self.execute_cb(bus, opcode, None, Some(addr));
    }

    fn execute_ed(&mut self, bus: &mut M68kBus, opcode: u8) {
        match opcode {
            0x40 | 0x48 | 0x50 | 0x58 | 0x60 | 0x68 | 0x78 => {
                let value = self.read_io(bus, self.bc());
                self.write_reg8(bus, (opcode >> 3) & 7, value, None);
                self.set_szp_flags(value, self.f & Self::FLAG_C);
                self.finish(12);
            }
            0x70 => {
                let value = self.read_io(bus, self.bc());
                self.set_szp_flags(value, self.f & Self::FLAG_C);
                self.finish(12);
            }
            0x41 | 0x49 | 0x51 | 0x59 | 0x61 | 0x69 | 0x79 => {
                let value = self.read_reg8(bus, (opcode >> 3) & 7, None);
                self.write_io(bus, self.bc(), value);
                self.finish(12);
            }
            0x71 => {
                self.write_io(bus, self.bc(), 0);
                self.finish(12);
            }
            0x42 | 0x52 | 0x62 | 0x72 => {
                self.sbc_hl(self.get_rp((opcode >> 4) & 3, None));
                self.finish(15);
            }
            0x4a | 0x5a | 0x6a | 0x7a => {
                self.adc_hl(self.get_rp((opcode >> 4) & 3, None));
                self.finish(15);
            }
            0x43 | 0x53 | 0x63 | 0x73 => {
                let addr = self.fetch_word(bus);
                self.write_word(bus, addr, self.get_rp((opcode >> 4) & 3, None));
                self.finish(20);
            }
            0x4b | 0x5b | 0x6b | 0x7b => {
                let addr = self.fetch_word(bus);
                let value = self.read_word(bus, addr);
                self.set_rp((opcode >> 4) & 3, value, None);
                self.finish(20);
            }
            0x44 | 0x4c | 0x54 | 0x5c | 0x64 | 0x6c | 0x74 | 0x7c => {
                self.neg();
                self.finish(8);
            }
            0x45 | 0x55 | 0x65 | 0x75 | 0x4d | 0x5d | 0x6d | 0x7d => {
                self.pc = self.pop_word(bus);
                self.iff1 = self.iff2;
                self.finish(14);
            }
            0x46 | 0x4e | 0x66 | 0x6e => {
                self.im = 0;
                self.finish(8);
            }
            0x56 | 0x76 => {
                self.im = 1;
                self.finish(8);
            }
            0x5e | 0x7e => {
                self.im = 2;
                self.finish(8);
            }
            0x47 => {
                self.i = self.a;
                self.finish(9);
            }
            0x4f => {
                self.r = self.a;
                self.finish(9);
            }
            0x57 => {
                self.a = self.i;
                self.set_ldair_flags();
                self.finish(9);
            }
            0x5f => {
                self.a = self.r;
                self.set_ldair_flags();
                self.finish(9);
            }
            0x67 => {
                self.rrd(bus);
                self.finish(18);
            }
            0x6f => {
                self.rld(bus);
                self.finish(18);
            }
            0xa0 => {
                self.ldi(bus, 1);
                self.finish(16);
            }
            0xa8 => {
                self.ldi(bus, -1);
                self.finish(16);
            }
            0xb0 => {
                self.block_ldi(bus, 1);
                self.finish(if self.bc() == 0 { 16 } else { 21 });
            }
            0xb8 => {
                self.block_ldi(bus, -1);
                self.finish(if self.bc() == 0 { 16 } else { 21 });
            }
            0xa3 => {
                self.outi(bus, 1);
                self.finish(16);
            }
            0xab => {
                self.outi(bus, -1);
                self.finish(16);
            }
            0xb3 => {
                self.block_outi(bus, 1);
                self.finish(if self.b == 0 { 16 } else { 21 });
            }
            0xbb => {
                self.block_outi(bus, -1);
                self.finish(if self.b == 0 { 16 } else { 21 });
            }
            _ => self.finish(8),
        }
    }

    fn fetch_byte(&mut self, bus: &mut M68kBus) -> u8 {
        let byte = bus.z80_read_byte(self.pc);
        self.pc = self.pc.wrapping_add(1);
        byte
    }

    fn fetch_opcode(&mut self, bus: &mut M68kBus) -> u8 {
        let byte = self.fetch_byte(bus);
        self.r = self.r.wrapping_add(1) & 0x7f | (self.r & 0x80);
        byte
    }

    fn fetch_word(&mut self, bus: &mut M68kBus) -> u16 {
        u16::from(self.fetch_byte(bus)) | (u16::from(self.fetch_byte(bus)) << 8)
    }

    fn read_word(&mut self, bus: &mut M68kBus, address: u16) -> u16 {
        u16::from(bus.z80_read_byte(address))
            | (u16::from(bus.z80_read_byte(address.wrapping_add(1))) << 8)
    }

    fn write_word(&mut self, bus: &mut M68kBus, address: u16, value: u16) {
        bus.z80_write_byte(address, value as u8);
        bus.z80_write_byte(address.wrapping_add(1), (value >> 8) as u8);
    }

    fn read_io(&mut self, bus: &mut M68kBus, port: u16) -> u8 {
        if let Some(port) = genesis_ym_io_port(port) {
            bus.ym2612.sync_to_cycle(bus.ym_frame_cycle);
            return bus.ym2612.read_register(port);
        }
        0xff
    }

    fn write_io(&mut self, bus: &mut M68kBus, port: u16, value: u8) {
        if let Some(port) = genesis_ym_io_port(port) {
            bus.ym2612.sync_to_cycle(bus.ym_frame_cycle);
            bus.ym2612.write_port(port, value, Some(bus.ym_frame_cycle));
        }
    }

    fn push_word(&mut self, bus: &mut M68kBus, value: u16) {
        self.sp = self.sp.wrapping_sub(1);
        bus.z80_write_byte(self.sp, (value >> 8) as u8);
        self.sp = self.sp.wrapping_sub(1);
        bus.z80_write_byte(self.sp, value as u8);
    }

    fn pop_word(&mut self, bus: &mut M68kBus) -> u16 {
        let lo = bus.z80_read_byte(self.sp);
        self.sp = self.sp.wrapping_add(1);
        let hi = bus.z80_read_byte(self.sp);
        self.sp = self.sp.wrapping_add(1);
        (u16::from(hi) << 8) | u16::from(lo)
    }

    fn read_reg8(&mut self, bus: &mut M68kBus, reg: u8, index: Option<IndexReg>) -> u8 {
        match reg {
            0 => self.b,
            1 => self.c,
            2 => self.d,
            3 => self.e,
            4 => index
                .map(|idx| (self.get_index(idx) >> 8) as u8)
                .unwrap_or(self.h),
            5 => index.map(|idx| self.get_index(idx) as u8).unwrap_or(self.l),
            6 => {
                let addr = index
                    .map(|idx| self.indexed_addr(bus, idx))
                    .unwrap_or_else(|| self.hl());
                bus.z80_read_byte(addr)
            }
            7 => self.a,
            _ => 0xff,
        }
    }

    fn write_reg8(&mut self, bus: &mut M68kBus, reg: u8, value: u8, index: Option<IndexReg>) {
        match reg {
            0 => self.b = value,
            1 => self.c = value,
            2 => self.d = value,
            3 => self.e = value,
            4 => {
                if let Some(idx) = index {
                    self.set_index(
                        idx,
                        (self.get_index(idx) & 0x00ff) | (u16::from(value) << 8),
                    );
                } else {
                    self.h = value;
                }
            }
            5 => {
                if let Some(idx) = index {
                    self.set_index(idx, (self.get_index(idx) & 0xff00) | u16::from(value));
                } else {
                    self.l = value;
                }
            }
            6 => {
                let addr = index
                    .map(|idx| self.indexed_addr(bus, idx))
                    .unwrap_or_else(|| self.hl());
                bus.z80_write_byte(addr, value);
            }
            7 => self.a = value,
            _ => {}
        }
    }

    fn af(&self) -> u16 {
        (u16::from(self.a) << 8) | u16::from(self.f)
    }
    fn set_af(&mut self, value: u16) {
        self.a = (value >> 8) as u8;
        self.f = value as u8;
    }
    fn bc(&self) -> u16 {
        (u16::from(self.b) << 8) | u16::from(self.c)
    }
    fn set_bc(&mut self, value: u16) {
        self.b = (value >> 8) as u8;
        self.c = value as u8;
    }
    fn de(&self) -> u16 {
        (u16::from(self.d) << 8) | u16::from(self.e)
    }
    fn set_de(&mut self, value: u16) {
        self.d = (value >> 8) as u8;
        self.e = value as u8;
    }
    fn hl(&self) -> u16 {
        (u16::from(self.h) << 8) | u16::from(self.l)
    }
    fn set_hl(&mut self, value: u16) {
        self.h = (value >> 8) as u8;
        self.l = value as u8;
    }

    fn get_rp(&self, rp: u8, index: Option<IndexReg>) -> u16 {
        match rp {
            0 => self.bc(),
            1 => self.de(),
            2 => index
                .map(|idx| self.get_index(idx))
                .unwrap_or_else(|| self.hl()),
            _ => self.sp,
        }
    }
    fn set_rp(&mut self, rp: u8, value: u16, index: Option<IndexReg>) {
        match rp {
            0 => self.set_bc(value),
            1 => self.set_de(value),
            2 => {
                if let Some(idx) = index {
                    self.set_index(idx, value);
                } else {
                    self.set_hl(value);
                }
            }
            _ => self.sp = value,
        }
    }
    fn get_rp2(&self, rp: u8, index: Option<IndexReg>) -> u16 {
        match rp {
            0 => self.bc(),
            1 => self.de(),
            2 => index
                .map(|idx| self.get_index(idx))
                .unwrap_or_else(|| self.hl()),
            _ => self.af(),
        }
    }
    fn set_rp2(&mut self, rp: u8, value: u16, index: Option<IndexReg>) {
        match rp {
            0 => self.set_bc(value),
            1 => self.set_de(value),
            2 => {
                if let Some(idx) = index {
                    self.set_index(idx, value);
                } else {
                    self.set_hl(value);
                }
            }
            _ => self.set_af(value),
        }
    }

    fn get_index(&self, index: IndexReg) -> u16 {
        match index {
            IndexReg::Ix => self.ix,
            IndexReg::Iy => self.iy,
        }
    }
    fn set_index(&mut self, index: IndexReg, value: u16) {
        match index {
            IndexReg::Ix => self.ix = value,
            IndexReg::Iy => self.iy = value,
        }
    }
    fn indexed_addr(&mut self, bus: &mut M68kBus, index: IndexReg) -> u16 {
        self.get_index(index)
            .wrapping_add(Self::signed8(self.fetch_byte(bus)) as u16)
    }
    fn uses_index_reg(reg: u8) -> bool {
        reg == 4 || reg == 5
    }

    fn alu(&mut self, op: u8, value: u8) {
        match op {
            0 => self.add_a(value),
            1 => self.adc_a(value),
            2 => self.sub_a(value),
            3 => self.sbc_a(value),
            4 => self.and_a(value),
            5 => self.xor_a(value),
            6 => self.or_a(value),
            _ => self.cp_a(value),
        }
    }
    fn add_a(&mut self, value: u8) {
        let res = u16::from(self.a) + u16::from(value);
        self.f = self.flags_add(self.a, value, res, 0);
        self.a = res as u8;
    }
    fn adc_a(&mut self, value: u8) {
        let c = u16::from(self.f & Self::FLAG_C != 0);
        let res = u16::from(self.a) + u16::from(value) + c;
        self.f = self.flags_add(self.a, value, res, c as u8);
        self.a = res as u8;
    }
    fn sub_a(&mut self, value: u8) {
        let res = i16::from(self.a) - i16::from(value);
        self.f = self.flags_sub(self.a, value, res, 0);
        self.a = res as u8;
    }
    fn sbc_a(&mut self, value: u8) {
        let c = i16::from(self.f & Self::FLAG_C != 0);
        let res = i16::from(self.a) - i16::from(value) - c;
        self.f = self.flags_sub(self.a, value, res, c as u8);
        self.a = res as u8;
    }
    fn and_a(&mut self, value: u8) {
        self.a &= value;
        self.f = self.szp(self.a) | (self.a & Self::FLAG_YX) | Self::FLAG_H;
    }
    fn xor_a(&mut self, value: u8) {
        self.a ^= value;
        self.f = self.szp(self.a) | (self.a & Self::FLAG_YX);
    }
    fn or_a(&mut self, value: u8) {
        self.a |= value;
        self.f = self.szp(self.a) | (self.a & Self::FLAG_YX);
    }
    fn cp_a(&mut self, value: u8) {
        let res = i16::from(self.a) - i16::from(value);
        self.f = (self.flags_sub(self.a, value, res, 0) & !Self::FLAG_YX) | (value & Self::FLAG_YX);
    }

    fn flags_add(&self, left: u8, right: u8, res: u16, carry: u8) -> u8 {
        let value = res as u8;
        self.sz_flags(value)
            | (value & Self::FLAG_YX)
            | if (((left & 0x0f) + (right & 0x0f) + carry) & 0x10) != 0 {
                Self::FLAG_H
            } else {
                0
            }
            | if res > 0xff { Self::FLAG_C } else { 0 }
            | if ((left ^ !right) & (left ^ value) & 0x80) != 0 {
                Self::FLAG_P
            } else {
                0
            }
    }
    fn flags_sub(&self, left: u8, right: u8, res: i16, _carry: u8) -> u8 {
        let value = res as u8;
        self.sz_flags(value)
            | (value & Self::FLAG_YX)
            | if ((left ^ right ^ value) & 0x10) != 0 {
                Self::FLAG_H
            } else {
                0
            }
            | if res < 0 { Self::FLAG_C } else { 0 }
            | if ((left ^ right) & (left ^ value) & 0x80) != 0 {
                Self::FLAG_P
            } else {
                0
            }
            | Self::FLAG_N
    }
    fn inc8(&mut self, value: u8) -> u8 {
        let res = value.wrapping_add(1);
        let carry = self.f & Self::FLAG_C;
        self.f = self.sz_flags(res)
            | (res & Self::FLAG_YX)
            | if value == 0x7f { Self::FLAG_P } else { 0 }
            | if (value & 0x0f) == 0x0f {
                Self::FLAG_H
            } else {
                0
            }
            | carry;
        res
    }
    fn dec8(&mut self, value: u8) -> u8 {
        let res = value.wrapping_sub(1);
        let carry = self.f & Self::FLAG_C;
        self.f = self.sz_flags(res)
            | (res & Self::FLAG_YX)
            | if value == 0x80 { Self::FLAG_P } else { 0 }
            | if (value & 0x0f) == 0 { Self::FLAG_H } else { 0 }
            | Self::FLAG_N
            | carry;
        res
    }
    fn add16(&mut self, left: u16, right: u16) -> u16 {
        let res = u32::from(left) + u32::from(right);
        self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
            | (((res >> 8) as u8) & Self::FLAG_YX)
            | if (((left & 0x0fff) + (right & 0x0fff)) & 0x1000) != 0 {
                Self::FLAG_H
            } else {
                0
            }
            | if res > 0xffff { Self::FLAG_C } else { 0 };
        res as u16
    }
    fn adc_hl(&mut self, value: u16) {
        let old = self.hl();
        let c = u32::from(self.f & Self::FLAG_C != 0);
        let res = u32::from(old) + u32::from(value) + c;
        self.set_hl(res as u16);
        let hl = self.hl();
        self.f = if (hl & 0x8000) != 0 { Self::FLAG_S } else { 0 }
            | if hl == 0 { Self::FLAG_Z } else { 0 }
            | ((hl >> 8) as u8 & Self::FLAG_YX)
            | if (((old & 0x0fff) + (value & 0x0fff) + c as u16) & 0x1000) != 0 {
                Self::FLAG_H
            } else {
                0
            }
            | if ((old ^ !value) & (old ^ hl) & 0x8000) != 0 {
                Self::FLAG_P
            } else {
                0
            }
            | if res > 0xffff { Self::FLAG_C } else { 0 };
    }
    fn sbc_hl(&mut self, value: u16) {
        let old = self.hl();
        let c = i32::from(self.f & Self::FLAG_C != 0);
        let res = i32::from(old) - i32::from(value) - c;
        self.set_hl(res as u16);
        let hl = self.hl();
        self.f = if (hl & 0x8000) != 0 { Self::FLAG_S } else { 0 }
            | if hl == 0 { Self::FLAG_Z } else { 0 }
            | ((hl >> 8) as u8 & Self::FLAG_YX)
            | if ((old ^ value ^ hl) & 0x1000) != 0 {
                Self::FLAG_H
            } else {
                0
            }
            | if ((old ^ value) & (old ^ hl) & 0x8000) != 0 {
                Self::FLAG_P
            } else {
                0
            }
            | Self::FLAG_N
            | if res < 0 { Self::FLAG_C } else { 0 };
    }

    fn rotate_shift(&mut self, op: u8, value: u8) -> u8 {
        let (result, carry) = match op {
            0 => (value.rotate_left(1), value >> 7),
            1 => (((value >> 1) | ((value & 1) << 7)), value & 1),
            2 => (
                ((value << 1) | u8::from(self.f & Self::FLAG_C != 0)),
                value >> 7,
            ),
            3 => (
                ((value >> 1) | if self.f & Self::FLAG_C != 0 { 0x80 } else { 0 }),
                value & 1,
            ),
            4 => ((value << 1), value >> 7),
            5 => (((value >> 1) | (value & 0x80)), value & 1),
            6 => (((value << 1) | 1), value >> 7),
            _ => ((value >> 1), value & 1),
        };
        self.f =
            self.szp(result) | (result & Self::FLAG_YX) | if carry != 0 { Self::FLAG_C } else { 0 };
        result
    }
    fn rlc_a(&mut self, value: u8) -> u8 {
        let result = value.rotate_left(1);
        self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
            | (result & Self::FLAG_YX)
            | (value >> 7);
        result
    }
    fn rrc_a(&mut self, value: u8) -> u8 {
        let result = (value >> 1) | ((value & 1) << 7);
        self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
            | (result & Self::FLAG_YX)
            | (value & Self::FLAG_C);
        result
    }
    fn rl_a(&mut self, value: u8) -> u8 {
        let result = (value << 1) | u8::from(self.f & Self::FLAG_C != 0);
        self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
            | (result & Self::FLAG_YX)
            | if (value & 0x80) != 0 { Self::FLAG_C } else { 0 };
        result
    }
    fn rr_a(&mut self, value: u8) -> u8 {
        let result = (value >> 1) | if self.f & Self::FLAG_C != 0 { 0x80 } else { 0 };
        self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_P))
            | (result & Self::FLAG_YX)
            | (value & Self::FLAG_C);
        result
    }
    fn bit_test(&mut self, bit: u8, value: u8, addr: Option<u16>) {
        let mask = 1 << bit;
        let yx = addr
            .map(|a| (a >> 8) as u8 & Self::FLAG_YX)
            .unwrap_or(value & Self::FLAG_YX);
        self.f = (self.f & Self::FLAG_C) | Self::FLAG_H | yx;
        if (value & mask) == 0 {
            self.f |= Self::FLAG_Z | Self::FLAG_P;
        }
        if bit == 7 && (value & mask) != 0 {
            self.f |= Self::FLAG_S;
        }
    }
    fn daa(&mut self) {
        let old_a = self.a;
        let mut adjust = 0u8;
        if self.f & Self::FLAG_H != 0 || (self.f & Self::FLAG_N == 0 && (self.a & 0x0f) > 9) {
            adjust |= 0x06;
        }
        if self.f & Self::FLAG_C != 0 || (self.f & Self::FLAG_N == 0 && self.a > 0x99) {
            adjust |= 0x60;
        }
        let carry = self.f & Self::FLAG_C != 0 || (self.f & Self::FLAG_N == 0 && old_a > 0x99);
        self.a = if self.f & Self::FLAG_N != 0 {
            self.a.wrapping_sub(adjust)
        } else {
            self.a.wrapping_add(adjust)
        };
        self.f = (self.f & Self::FLAG_N)
            | self.szp(self.a)
            | (self.a & Self::FLAG_YX)
            | if carry { Self::FLAG_C } else { 0 }
            | if ((old_a ^ self.a) & 0x10) != 0 {
                Self::FLAG_H
            } else {
                0
            };
    }
    fn neg(&mut self) {
        let value = self.a;
        self.a = 0u8.wrapping_sub(self.a);
        self.f = self.flags_sub(0, value, -(i16::from(value)), 0);
    }
    fn rrd(&mut self, bus: &mut M68kBus) {
        let mem = bus.z80_read_byte(self.hl());
        bus.z80_write_byte(self.hl(), ((self.a & 0x0f) << 4) | (mem >> 4));
        self.a = (self.a & 0xf0) | (mem & 0x0f);
        self.f = (self.f & Self::FLAG_C) | self.szp(self.a) | (self.a & Self::FLAG_YX);
    }
    fn rld(&mut self, bus: &mut M68kBus) {
        let mem = bus.z80_read_byte(self.hl());
        bus.z80_write_byte(self.hl(), ((mem << 4) & 0xf0) | (self.a & 0x0f));
        self.a = (self.a & 0xf0) | (mem >> 4);
        self.f = (self.f & Self::FLAG_C) | self.szp(self.a) | (self.a & Self::FLAG_YX);
    }
    fn ldi(&mut self, bus: &mut M68kBus, delta: i16) {
        let value = bus.z80_read_byte(self.hl());
        bus.z80_write_byte(self.de(), value);
        self.set_hl(self.hl().wrapping_add(delta as u16));
        self.set_de(self.de().wrapping_add(delta as u16));
        self.set_bc(self.bc().wrapping_sub(1));
        let n = self.a.wrapping_add(value);
        self.f = (self.f & (Self::FLAG_S | Self::FLAG_Z | Self::FLAG_C))
            | if self.bc() != 0 { Self::FLAG_P } else { 0 }
            | (n & Self::FLAG_3)
            | ((n << 4) & Self::FLAG_5);
    }
    fn block_ldi(&mut self, bus: &mut M68kBus, delta: i16) {
        self.ldi(bus, delta);
        if self.bc() != 0 {
            self.pc = self.pc.wrapping_sub(2);
        }
    }
    fn outi(&mut self, bus: &mut M68kBus, delta: i16) {
        let value = bus.z80_read_byte(self.hl());
        self.b = self.b.wrapping_sub(1);
        self.write_io(bus, self.bc(), value);
        self.set_hl(self.hl().wrapping_add(delta as u16));
        self.f = if self.b == 0 { Self::FLAG_Z } else { 0 }
            | (self.b & Self::FLAG_S)
            | Self::FLAG_N
            | (self.b & Self::FLAG_YX);
    }
    fn block_outi(&mut self, bus: &mut M68kBus, delta: i16) {
        self.outi(bus, delta);
        if self.b != 0 {
            self.pc = self.pc.wrapping_sub(2);
        }
    }
    fn ret_cond(&mut self, bus: &mut M68kBus, cond: bool) {
        if cond {
            self.pc = self.pop_word(bus);
            self.finish(11);
        } else {
            self.finish(5);
        }
    }
    fn jp_cond(&mut self, bus: &mut M68kBus, cond: bool) {
        let addr = self.fetch_word(bus);
        if cond {
            self.pc = addr;
        }
        self.finish(10);
    }
    fn call_cond(&mut self, bus: &mut M68kBus, cond: bool) {
        let addr = self.fetch_word(bus);
        if cond {
            self.push_word(bus, self.pc);
            self.pc = addr;
            self.finish(17);
        } else {
            self.finish(10);
        }
    }
    fn jr(&mut self, disp: u8) {
        self.pc = self.pc.wrapping_add(Self::signed8(disp) as u16);
    }
    fn ex_af(&mut self) {
        core::mem::swap(&mut self.a, &mut self.a_alt);
        core::mem::swap(&mut self.f, &mut self.f_alt);
    }
    fn exx(&mut self) {
        core::mem::swap(&mut self.b, &mut self.b_alt);
        core::mem::swap(&mut self.c, &mut self.c_alt);
        core::mem::swap(&mut self.d, &mut self.d_alt);
        core::mem::swap(&mut self.e, &mut self.e_alt);
        core::mem::swap(&mut self.h, &mut self.h_alt);
        core::mem::swap(&mut self.l, &mut self.l_alt);
    }
    fn set_ldair_flags(&mut self) {
        self.f = (self.f & Self::FLAG_C)
            | self.sz_flags(self.a)
            | (self.a & Self::FLAG_YX)
            | if self.iff2 { Self::FLAG_P } else { 0 };
    }
    fn set_szp_flags(&mut self, value: u8, carry: u8) {
        self.f = self.szp(value) | (value & Self::FLAG_YX) | carry;
    }
    fn sz_flags(&self, value: u8) -> u8 {
        (if value & 0x80 != 0 { Self::FLAG_S } else { 0 })
            | if value == 0 { Self::FLAG_Z } else { 0 }
    }
    fn szp(&self, value: u8) -> u8 {
        self.sz_flags(value)
            | if value.count_ones() % 2 == 0 {
                Self::FLAG_P
            } else {
                0
            }
    }
    fn condition_met(&self, condition: u8) -> bool {
        match condition {
            0 => self.f & Self::FLAG_Z == 0,
            1 => self.f & Self::FLAG_Z != 0,
            2 => self.f & Self::FLAG_C == 0,
            3 => self.f & Self::FLAG_C != 0,
            4 => self.f & Self::FLAG_P == 0,
            5 => self.f & Self::FLAG_P != 0,
            6 => self.f & Self::FLAG_S == 0,
            _ => self.f & Self::FLAG_S != 0,
        }
    }
    fn signed8(value: u8) -> i16 {
        if value >= 0x80 {
            i16::from(value) - 0x100
        } else {
            i16::from(value)
        }
    }
    fn finish(&mut self, cycles: u32) {
        self.cycles = cycles;
    }
    fn ld_r_r_cycles(dst: u8, src: u8, index: Option<IndexReg>) -> u32 {
        if index.is_some() && (dst == 6 || src == 6) {
            19
        } else if dst == 6 || src == 6 {
            7
        } else if index.is_some() && (Self::uses_index_reg(dst) || Self::uses_index_reg(src)) {
            8
        } else {
            4
        }
    }
}
