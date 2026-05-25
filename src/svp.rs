use serde::{Deserialize, Serialize};

const SVP_ENTRY_POINT: u16 = 0x0400;
const DRAM_WORDS: usize = 128 * 1024 / 2;
const IRAM_WORDS: usize = 1024;
const INTERNAL_RAM_WORDS: usize = 256;
const STACK_WORDS: usize = 6;
const EXTERNAL_MEMORY_MASK: u32 = (1 << 21) - 1;
const INSTRUCTIONS_PER_M68K_CYCLE: u32 = 3;

#[derive(Clone, Debug)]
pub struct SvpBusOverride {
    core: SvpCore,
    rom: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SvpSnapshot {
    core: SvpCoreSnapshot,
}

impl SvpBusOverride {
    pub fn svp_rom(bytes: &[u8]) -> bool {
        if bytes.len() < 0x18e {
            return false;
        }
        let serial = &bytes[0x180..0x18e];
        serial.windows(b"MK-1229".len()).any(|w| w == b"MK-1229")
            || serial.windows(b"G-7001".len()).any(|w| w == b"G-7001")
    }

    pub fn new(rom: &[u8]) -> Self {
        Self {
            core: SvpCore::new(),
            rom: rom.to_vec(),
        }
    }

    pub fn reset(&mut self) {
        self.core = SvpCore::new();
    }

    pub fn tick(&mut self, m68k_cycles: u32) {
        self.core.tick(&self.rom, m68k_cycles);
    }

    pub fn handles(address: u32) -> bool {
        let address = address & 0x00ff_ffff;
        (0x0030_0000..=0x0037_ffff).contains(&address)
            || (0x00a1_5000..=0x00a1_5007).contains(&address)
    }

    pub fn read_byte(&mut self, address: u32) -> u8 {
        let word = self.core.m68k_read_word(address & !1, &self.rom);
        if (address & 1) == 0 {
            (word >> 8) as u8
        } else {
            word as u8
        }
    }

    pub fn read_word(&mut self, address: u32) -> u16 {
        self.core.m68k_read_word(address & !1, &self.rom)
    }

    pub fn write_byte(&mut self, address: u32, value: u8) {
        self.core.m68k_write_byte(address, value);
    }

    pub fn write_word(&mut self, address: u32, value: u16) {
        self.core.m68k_write_word(address & !1, value);
    }

    pub fn snapshot(&self) -> SvpSnapshot {
        SvpSnapshot {
            core: self.core.snapshot(),
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: SvpSnapshot) {
        self.core.restore_snapshot(snapshot.core);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
enum PmcWaitingFor {
    Address,
    Mode,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
struct StatusRegister {
    loop_size: u8,
    st5: bool,
    st6: bool,
    zero: bool,
    negative: bool,
}

impl StatusRegister {
    fn loop_modulo(self) -> u8 {
        if self.loop_size != 0 {
            1u8 << self.loop_size
        } else {
            0
        }
    }

    fn st_bits_set(self) -> bool {
        self.st5 || self.st6
    }

    fn write(&mut self, value: u16) {
        self.loop_size = (value & 0x07) as u8;
        self.st5 = bit16(value, 5);
        self.st6 = bit16(value, 6);
        self.zero = bit16(value, 13);
        self.negative = bit16(value, 15);
    }

    fn to_word(self) -> u16 {
        ((self.negative as u16) << 15)
            | ((self.zero as u16) << 13)
            | ((self.st6 as u16) << 6)
            | ((self.st5 as u16) << 5)
            | u16::from(self.loop_size)
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct StackRegister {
    stack: [u16; STACK_WORDS],
    pointer: u8,
}

impl Default for StackRegister {
    fn default() -> Self {
        Self {
            stack: [0; STACK_WORDS],
            pointer: 0,
        }
    }
}

impl StackRegister {
    fn push(&mut self, value: u16) {
        self.stack[self.pointer as usize] = value;
        self.pointer = (self.pointer + 1) % STACK_WORDS as u8;
    }

    fn pop(&mut self) -> u16 {
        self.pointer = if self.pointer == 0 {
            (STACK_WORDS - 1) as u8
        } else {
            self.pointer - 1
        };
        self.stack[self.pointer as usize]
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
struct ProgrammableMemoryRegister {
    address: u32,
    auto_increment: u32,
    auto_increment_negative: bool,
    auto_increment_bits: u16,
    special_increment_mode: bool,
    overwrite_mode: bool,
}

impl ProgrammableMemoryRegister {
    fn initialize(&mut self, address: u16, mode: u16) {
        self.address = u32::from(address) | (u32::from(mode & 0x001f) << 16);
        self.overwrite_mode = bit16(mode, 10);
        self.auto_increment_bits = (mode >> 11) & 0x07;
        self.auto_increment = match self.auto_increment_bits {
            0 => 0,
            7 => 128,
            bits => 1 << (bits - 1),
        };
        self.special_increment_mode = bit16(mode, 14);
        self.auto_increment_negative = bit16(mode, 15);
    }

    fn get_and_increment_address(&mut self) -> u32 {
        let address = self.address;
        if self.special_increment_mode {
            self.address = if !bit32(address, 0) {
                self.address.wrapping_add(1) & EXTERNAL_MEMORY_MASK
            } else {
                self.address.wrapping_add(31) & EXTERNAL_MEMORY_MASK
            };
        } else if self.auto_increment != 0 {
            self.address = if self.auto_increment_negative {
                self.address.wrapping_sub(self.auto_increment) & EXTERNAL_MEMORY_MASK
            } else {
                self.address.wrapping_add(self.auto_increment) & EXTERNAL_MEMORY_MASK
            };
        }
        address
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct ProgrammableMemoryControlRegister {
    waiting_for: PmcWaitingFor,
    address: u16,
    mode: u16,
}

impl Default for ProgrammableMemoryControlRegister {
    fn default() -> Self {
        Self {
            waiting_for: PmcWaitingFor::Address,
            address: 0,
            mode: 0,
        }
    }
}

impl ProgrammableMemoryControlRegister {
    fn read(&mut self) -> u16 {
        let value = if self.waiting_for == PmcWaitingFor::Address {
            self.address
        } else {
            (self.address << 4) | (self.address >> 12)
        };
        self.waiting_for = toggle_pmc(self.waiting_for);
        value
    }

    fn write(&mut self, value: u16) {
        if self.waiting_for == PmcWaitingFor::Address {
            self.address = value;
        } else {
            self.mode = value;
        }
        self.waiting_for = toggle_pmc(self.waiting_for);
    }

    fn update_from(&mut self, pm: ProgrammableMemoryRegister) {
        self.address = pm.address as u16;
        self.mode = ((pm.auto_increment_negative as u16) << 15)
            | ((pm.special_increment_mode as u16) << 14)
            | (pm.auto_increment_bits << 11)
            | ((pm.overwrite_mode as u16) << 10)
            | ((pm.address >> 16) as u16);
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
struct ExternalStatusRegister {
    value: u16,
    m68k_written: bool,
    ssp_written: bool,
}

impl ExternalStatusRegister {
    fn m68k_write(&mut self, value: u16) {
        self.value = value;
        self.m68k_written = true;
    }

    fn ssp_write(&mut self, value: u16) {
        self.value = value;
        self.ssp_written = true;
    }

    fn status(self) -> u16 {
        ((self.m68k_written as u16) << 1) | self.ssp_written as u16
    }

    fn m68k_read_status(&mut self) -> u16 {
        let status = self.status();
        self.ssp_written = false;
        status
    }

    fn ssp_read_status(&mut self) -> u16 {
        let status = self.status();
        self.m68k_written = false;
        status
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Registers {
    x: u16,
    y: u16,
    accumulator: u32,
    status: StatusRegister,
    stack: StackRegister,
    pc: u16,
    pm_read: [ProgrammableMemoryRegister; 5],
    pm_write: [ProgrammableMemoryRegister; 5],
    pmc: ProgrammableMemoryControlRegister,
    xst: ExternalStatusRegister,
    ram0_pointers: [u8; 3],
    ram1_pointers: [u8; 3],
}

impl Default for Registers {
    fn default() -> Self {
        Self {
            x: 0,
            y: 0,
            accumulator: 0,
            status: StatusRegister::default(),
            stack: StackRegister::default(),
            pc: SVP_ENTRY_POINT,
            pm_read: [ProgrammableMemoryRegister::default(); 5],
            pm_write: [ProgrammableMemoryRegister::default(); 5],
            pmc: ProgrammableMemoryControlRegister::default(),
            xst: ExternalStatusRegister::default(),
            ram0_pointers: [0; 3],
            ram1_pointers: [0; 3],
        }
    }
}

impl Registers {
    fn product(&self) -> u32 {
        let x = self.x as i16 as i32 as u32;
        let y = self.y as i16 as i32 as u32;
        2u32.wrapping_mul(x).wrapping_mul(y)
    }
}

#[derive(Clone, Debug)]
struct SvpCore {
    registers: Registers,
    dram: Vec<u16>,
    iram: Vec<u16>,
    ram0: [u16; INTERNAL_RAM_WORDS],
    ram1: [u16; INTERNAL_RAM_WORDS],
    halted: bool,
    dram_dirty: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SvpCoreSnapshot {
    registers: Registers,
    dram: Vec<u16>,
    iram: Vec<u16>,
    ram0: Vec<u16>,
    ram1: Vec<u16>,
    halted: bool,
    dram_dirty: bool,
}

impl SvpCore {
    fn new() -> Self {
        Self {
            registers: Registers::default(),
            dram: vec![0; DRAM_WORDS],
            iram: vec![0; IRAM_WORDS],
            ram0: [0; INTERNAL_RAM_WORDS],
            ram1: [0; INTERNAL_RAM_WORDS],
            halted: false,
            dram_dirty: false,
        }
    }

    fn snapshot(&self) -> SvpCoreSnapshot {
        SvpCoreSnapshot {
            registers: self.registers.clone(),
            dram: self.dram.clone(),
            iram: self.iram.clone(),
            ram0: self.ram0.to_vec(),
            ram1: self.ram1.to_vec(),
            halted: self.halted,
            dram_dirty: self.dram_dirty,
        }
    }

    fn restore_snapshot(&mut self, snapshot: SvpCoreSnapshot) {
        self.registers = snapshot.registers;
        self.dram = fit_words(snapshot.dram, DRAM_WORDS);
        self.iram = fit_words(snapshot.iram, IRAM_WORDS);
        self.ram0
            .copy_from_slice(&fit_words(snapshot.ram0, INTERNAL_RAM_WORDS));
        self.ram1
            .copy_from_slice(&fit_words(snapshot.ram1, INTERNAL_RAM_WORDS));
        self.halted = snapshot.halted;
        self.dram_dirty = snapshot.dram_dirty;
    }

    fn tick(&mut self, rom: &[u8], m68k_cycles: u32) {
        if self.halted {
            return;
        }
        let instruction_count = INSTRUCTIONS_PER_M68K_CYCLE.saturating_mul(m68k_cycles);
        for _ in 0..instruction_count {
            if matches!(self.registers.pc, 0x0425 | 0x2789) {
                if !self.dram_dirty {
                    return;
                }
                self.dram_dirty = false;
            }
            if self.registers.pc == SVP_ENTRY_POINT && !self.registers.xst.m68k_written {
                return;
            }
            self.execute_instruction(rom);
        }
    }

    fn m68k_read_word(&mut self, address: u32, rom: &[u8]) -> u16 {
        let masked = address & 0x00ff_ffff;
        match masked {
            0x0000_0000..=0x001f_ffff => read_rom_word_by_byte_address(rom, masked),
            0x0030_0000..=0x0037_ffff => self.dram[((masked & 0x1_ffff) >> 1) as usize],
            0x00a1_5000 | 0x00a1_5002 => self.registers.xst.value,
            0x00a1_5004 => self.registers.xst.m68k_read_status(),
            _ => 0xffff,
        }
    }

    fn m68k_write_byte(&mut self, address: u32, value: u8) {
        let masked = address & 0x00ff_ffff;
        if (0x0030_0000..=0x0037_ffff).contains(&masked) {
            let word_address = ((masked & 0x1_ffff) >> 1) as usize;
            let word = self.dram[word_address];
            self.dram[word_address] = if bit32(masked, 0) {
                (word & 0xff00) | u16::from(value)
            } else {
                (word & 0x00ff) | (u16::from(value) << 8)
            };
            if matches!(word_address, 0x7f03 | 0x7f04) {
                self.dram_dirty = true;
            }
            return;
        }

        if bit32(masked, 0) {
            self.m68k_write_word(masked & !1, u16::from(value));
        } else {
            self.m68k_write_word(masked, u16::from(value) << 8);
        }
    }

    fn m68k_write_word(&mut self, address: u32, value: u16) {
        let masked = address & 0x00ff_ffff;
        if (0x0030_0000..=0x0037_ffff).contains(&masked) {
            let word_address = ((masked & 0x1_ffff) >> 1) as usize;
            self.dram[word_address] = value;
            if matches!(word_address, 0x7f03 | 0x7f04) {
                self.dram_dirty = true;
            }
            return;
        }

        match masked {
            0x00a1_5000 | 0x00a1_5002 => self.registers.xst.m68k_write(value),
            0x00a1_5006 => self.halted = value == 0x000a,
            _ => {}
        }
    }

    fn read_program_memory(&self, address: u16, rom: &[u8]) -> u16 {
        if address <= 0x03ff {
            self.iram[address as usize]
        } else {
            read_rom_word_by_word_address(rom, u32::from(address))
        }
    }

    fn read_external_memory(&self, address: u32, rom: &[u8]) -> u16 {
        let masked = address & EXTERNAL_MEMORY_MASK;
        if masked <= 0x0f_ffff {
            return read_rom_word_by_word_address(rom, masked);
        }
        if (0x18_0000..=0x18_ffff).contains(&masked) {
            return self.dram[(masked & 0xffff) as usize];
        }
        if (0x1c_8000..=0x1c_83ff).contains(&masked) {
            return self.iram[(masked & 0x03ff) as usize];
        }
        0xffff
    }

    fn write_external_memory(&mut self, address: u32, value: u16) {
        let masked = address & EXTERNAL_MEMORY_MASK;
        if (0x18_0000..=0x18_ffff).contains(&masked) {
            self.dram[(masked & 0xffff) as usize] = value;
            return;
        }
        if (0x1c_8000..=0x1c_83ff).contains(&masked) {
            self.iram[(masked & 0x03ff) as usize] = value;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AluOp {
    Add,
    Subtract,
    Compare,
    And,
    Or,
    ExclusiveOr,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AccumulateOp {
    Zero,
    Add,
    Subtract,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Condition {
    True,
    Zero,
    NotZero,
    Negative,
    NotNegative,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RamBank {
    Zero,
    One,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AddressingModeKind {
    GeneralRegister,
    PointerRegister,
    Indirect,
    DoubleIndirect,
    Direct,
    Immediate,
    ShortImmediate,
    AccumulatorIndirect,
}

#[derive(Clone, Copy, Debug)]
struct AddressingMode {
    kind: AddressingModeKind,
    register: u16,
    bank: RamBank,
    pointer: u16,
    modifier: u16,
    address: u8,
    short_immediate: u8,
}

impl AddressingMode {
    fn general_register(register: u16) -> Self {
        Self {
            kind: AddressingModeKind::GeneralRegister,
            register,
            bank: RamBank::Zero,
            pointer: 0,
            modifier: 0,
            address: 0,
            short_immediate: 0,
        }
    }

    fn pointer_register(bank: RamBank, pointer: u16) -> Self {
        Self {
            kind: AddressingModeKind::PointerRegister,
            bank,
            pointer,
            ..Self::general_register(0)
        }
    }

    fn indirect(bank: RamBank, pointer: u16, modifier: u16) -> Self {
        Self {
            kind: AddressingModeKind::Indirect,
            bank,
            pointer,
            modifier,
            ..Self::general_register(0)
        }
    }

    fn double_indirect(bank: RamBank, pointer: u16, modifier: u16) -> Self {
        Self {
            kind: AddressingModeKind::DoubleIndirect,
            bank,
            pointer,
            modifier,
            ..Self::general_register(0)
        }
    }

    fn direct(bank: RamBank, address: u8) -> Self {
        Self {
            kind: AddressingModeKind::Direct,
            bank,
            address,
            ..Self::general_register(0)
        }
    }

    fn immediate() -> Self {
        Self {
            kind: AddressingModeKind::Immediate,
            ..Self::general_register(0)
        }
    }

    fn short_immediate(value: u8) -> Self {
        Self {
            kind: AddressingModeKind::ShortImmediate,
            short_immediate: value,
            ..Self::general_register(0)
        }
    }

    fn accumulator_indirect() -> Self {
        Self {
            kind: AddressingModeKind::AccumulatorIndirect,
            ..Self::general_register(0)
        }
    }
}

impl SvpCore {
    fn execute_instruction(&mut self, rom: &[u8]) {
        let opcode = self.fetch_operand(rom);
        match opcode & 0xff00 {
            0x0000 => self.ld_d_s(rom, opcode),
            0x0200 | 0x0300 => self.ld_d_ri_indirect(rom, opcode),
            0x0400 | 0x0500 => self.ld_ri_s_indirect(rom, opcode),
            0x0600 | 0x0700 => self.ld_a_addr(rom, opcode),
            0x0800 => self.ldi_d_imm(rom, opcode),
            0x0a00 | 0x0b00 => self.ld_d_ri_double_indirect(rom, opcode),
            0x0c00 | 0x0d00 => self.ldi_ri_imm(rom, opcode),
            0x0e00 | 0x0f00 => self.ld_addr_a(rom, opcode),
            0x1200 | 0x1300 => self.ld_d_ri(rom, opcode),
            0x1400 | 0x1500 => self.ld_ri_s(rom, opcode),
            0x1800..=0x1f00 => self.ldi_ri_simm(rom, opcode),
            0x3700 => self.execute_multiply_accumulate(opcode, AccumulateOp::Subtract),
            0x4800 | 0x4900 => self.execute_call(rom, opcode),
            0x4a00 => self.ld_d_a_indirect(rom, opcode),
            0x4c00 | 0x4d00 => self.execute_bra(rom, opcode),
            0x9000 | 0x9100 => self.execute_mod(opcode),
            0x9700 => self.execute_multiply_accumulate(opcode, AccumulateOp::Add),
            0xb700 => self.execute_multiply_accumulate(opcode, AccumulateOp::Zero),
            0xff00 => {}
            _ => self.execute_alu(rom, opcode),
        }
    }

    fn fetch_operand(&mut self, rom: &[u8]) -> u16 {
        let pc = self.registers.pc;
        let operand = self.read_program_memory(pc, rom);
        self.registers.pc = pc.wrapping_add(1);
        operand
    }

    fn execute_load(&mut self, rom: &[u8], source: AddressingMode, dest: AddressingMode) {
        if source.kind == AddressingModeKind::GeneralRegister
            && source.register == 7
            && dest.kind == AddressingModeKind::GeneralRegister
            && dest.register == 3
        {
            self.registers.accumulator = self.registers.product();
            return;
        }

        if source.kind == AddressingModeKind::GeneralRegister
            && source.register == 0
            && dest.kind == AddressingModeKind::GeneralRegister
            && (8..=15).contains(&dest.register)
        {
            if dest.register <= 12 {
                let idx = (dest.register - 8) as usize;
                self.registers.pm_write[idx]
                    .initialize(self.registers.pmc.address, self.registers.pmc.mode);
            }
            self.registers.pmc.waiting_for = if dest.register != 14 {
                PmcWaitingFor::Address
            } else {
                toggle_pmc(self.registers.pmc.waiting_for)
            };
            return;
        }

        if source.kind == AddressingModeKind::GeneralRegister
            && (8..=15).contains(&source.register)
            && dest.kind == AddressingModeKind::GeneralRegister
            && dest.register == 0
        {
            if source.register <= 12 {
                let idx = (source.register - 8) as usize;
                self.registers.pm_read[idx]
                    .initialize(self.registers.pmc.address, self.registers.pmc.mode);
            }
            self.registers.pmc.waiting_for = if source.register != 14 {
                PmcWaitingFor::Address
            } else {
                toggle_pmc(self.registers.pmc.waiting_for)
            };
            return;
        }

        let value = self.read_addressing_mode(rom, source);
        self.write_addressing_mode(dest, value);
    }

    fn execute_alu(&mut self, rom: &[u8], opcode: u16) {
        let Some(op) = alu_op_from_opcode(opcode) else {
            return;
        };
        let source = parse_alu_addressing_mode(opcode);
        let operand = if source.kind == AddressingModeKind::GeneralRegister && source.register == 3
        {
            self.registers.accumulator
        } else if source.kind == AddressingModeKind::GeneralRegister && source.register == 7 {
            self.registers.product()
        } else {
            u32::from(self.read_addressing_mode(rom, source)) << 16
        };
        let accumulator = self.registers.accumulator;
        let result = match op {
            AluOp::Add => accumulator.wrapping_add(operand),
            AluOp::Subtract | AluOp::Compare => accumulator.wrapping_sub(operand),
            AluOp::And => accumulator & operand,
            AluOp::Or => accumulator | operand,
            AluOp::ExclusiveOr => accumulator ^ operand,
        };
        self.update_flags(result);
        if op != AluOp::Compare {
            self.registers.accumulator = result;
        }
    }

    fn update_flags(&mut self, accumulator: u32) {
        self.registers.status.zero = accumulator == 0;
        self.registers.status.negative = bit32(accumulator, 31);
    }

    fn execute_mod(&mut self, opcode: u16) {
        let condition = condition_from_opcode(opcode);
        if !check_condition(condition, self.registers.status) {
            return;
        }
        match opcode & 0x0007 {
            0x0002 => {
                self.registers.accumulator = ((self.registers.accumulator as i32) >> 1) as u32
            }
            0x0003 => self.registers.accumulator = self.registers.accumulator.wrapping_shl(1),
            0x0006 => self.registers.accumulator = (!self.registers.accumulator).wrapping_add(1),
            0x0007 => {
                if bit32(self.registers.accumulator, 31) {
                    self.registers.accumulator = (!self.registers.accumulator).wrapping_add(1);
                }
            }
            _ => return,
        }
        self.update_flags(self.registers.accumulator);
    }

    fn execute_call(&mut self, rom: &[u8], opcode: u16) {
        let address = self.fetch_operand(rom);
        if check_condition(condition_from_opcode(opcode), self.registers.status) {
            self.registers.stack.push(self.registers.pc);
            self.registers.pc = address;
        }
    }

    fn execute_bra(&mut self, rom: &[u8], opcode: u16) {
        let address = self.fetch_operand(rom);
        if check_condition(condition_from_opcode(opcode), self.registers.status) {
            self.registers.pc = address;
        }
    }

    fn execute_multiply_accumulate(&mut self, opcode: u16, op: AccumulateOp) {
        self.registers.accumulator = match op {
            AccumulateOp::Zero => 0,
            AccumulateOp::Add => self
                .registers
                .accumulator
                .wrapping_add(self.registers.product()),
            AccumulateOp::Subtract => self
                .registers
                .accumulator
                .wrapping_sub(self.registers.product()),
        };
        self.update_flags(self.registers.accumulator);

        let x_pointer = opcode & 0x03;
        let x_modifier = (opcode >> 2) & 0x03;
        let ram0_addr = self.read_pointer(RamBank::Zero, x_pointer, x_modifier);
        self.registers.x = self.ram0[ram0_addr as usize];

        let y_pointer = (opcode >> 4) & 0x03;
        let y_modifier = (opcode >> 6) & 0x03;
        let ram1_addr = self.read_pointer(RamBank::One, y_pointer, y_modifier);
        self.registers.y = self.ram1[ram1_addr as usize];
    }

    fn ld_d_s(&mut self, rom: &[u8], opcode: u16) {
        self.execute_load(
            rom,
            AddressingMode::general_register(opcode & 0x0f),
            AddressingMode::general_register((opcode >> 4) & 0x0f),
        );
    }

    fn ld_d_ri(&mut self, rom: &[u8], opcode: u16) {
        let bank = ram_bank_from_opcode(opcode);
        self.execute_load(
            rom,
            AddressingMode::pointer_register(bank, opcode & 0x03),
            AddressingMode::general_register((opcode >> 4) & 0x0f),
        );
    }

    fn ld_ri_s(&mut self, rom: &[u8], opcode: u16) {
        let bank = ram_bank_from_opcode(opcode);
        self.execute_load(
            rom,
            AddressingMode::general_register((opcode >> 4) & 0x0f),
            AddressingMode::pointer_register(bank, opcode & 0x03),
        );
    }

    fn ld_d_ri_indirect(&mut self, rom: &[u8], opcode: u16) {
        let bank = ram_bank_from_opcode(opcode);
        self.execute_load(
            rom,
            AddressingMode::indirect(bank, opcode & 0x03, (opcode >> 2) & 0x03),
            AddressingMode::general_register((opcode >> 4) & 0x0f),
        );
    }

    fn ld_ri_s_indirect(&mut self, rom: &[u8], opcode: u16) {
        let bank = ram_bank_from_opcode(opcode);
        self.execute_load(
            rom,
            AddressingMode::general_register((opcode >> 4) & 0x0f),
            AddressingMode::indirect(bank, opcode & 0x03, (opcode >> 2) & 0x03),
        );
    }

    fn ld_d_ri_double_indirect(&mut self, rom: &[u8], opcode: u16) {
        let bank = ram_bank_from_opcode(opcode);
        self.execute_load(
            rom,
            AddressingMode::double_indirect(bank, opcode & 0x03, (opcode >> 2) & 0x03),
            AddressingMode::general_register((opcode >> 4) & 0x0f),
        );
    }

    fn ld_a_addr(&mut self, rom: &[u8], opcode: u16) {
        self.execute_load(
            rom,
            AddressingMode::direct(ram_bank_from_opcode(opcode), opcode as u8),
            AddressingMode::general_register(3),
        );
    }

    fn ld_addr_a(&mut self, rom: &[u8], opcode: u16) {
        self.execute_load(
            rom,
            AddressingMode::general_register(3),
            AddressingMode::direct(ram_bank_from_opcode(opcode), opcode as u8),
        );
    }

    fn ldi_d_imm(&mut self, rom: &[u8], opcode: u16) {
        self.execute_load(
            rom,
            AddressingMode::immediate(),
            AddressingMode::general_register((opcode >> 4) & 0x0f),
        );
    }

    fn ldi_ri_imm(&mut self, rom: &[u8], opcode: u16) {
        let bank = ram_bank_from_opcode(opcode);
        self.execute_load(
            rom,
            AddressingMode::immediate(),
            AddressingMode::indirect(bank, opcode & 0x03, (opcode >> 2) & 0x03),
        );
    }

    fn ldi_ri_simm(&mut self, rom: &[u8], opcode: u16) {
        let bank = if bit16(opcode, 10) {
            RamBank::One
        } else {
            RamBank::Zero
        };
        self.execute_load(
            rom,
            AddressingMode::short_immediate(opcode as u8),
            AddressingMode::pointer_register(bank, (opcode >> 8) & 0x03),
        );
    }

    fn ld_d_a_indirect(&mut self, rom: &[u8], opcode: u16) {
        self.execute_load(
            rom,
            AddressingMode::accumulator_indirect(),
            AddressingMode::general_register((opcode >> 4) & 0x0f),
        );
    }

    fn read_addressing_mode(&mut self, rom: &[u8], source: AddressingMode) -> u16 {
        match source.kind {
            AddressingModeKind::GeneralRegister => self.read_register(rom, source.register),
            AddressingModeKind::PointerRegister => match (source.bank, source.pointer) {
                (RamBank::Zero, 0..=2) => {
                    self.registers.ram0_pointers[source.pointer as usize].into()
                }
                (RamBank::One, 0..=2) => {
                    self.registers.ram1_pointers[source.pointer as usize].into()
                }
                (_, 3) => 0,
                _ => 0xffff,
            },
            AddressingModeKind::Indirect => {
                let addr = self.read_pointer(source.bank, source.pointer, source.modifier);
                if source.bank == RamBank::Zero {
                    self.ram0[addr as usize]
                } else {
                    self.ram1[addr as usize]
                }
            }
            AddressingModeKind::DoubleIndirect => {
                let addr = self.read_pointer(source.bank, source.pointer, source.modifier);
                let indirect = if source.bank == RamBank::Zero {
                    let value = self.ram0[addr as usize];
                    self.ram0[addr as usize] = value.wrapping_add(1);
                    value
                } else {
                    let value = self.ram1[addr as usize];
                    self.ram1[addr as usize] = value.wrapping_add(1);
                    value
                };
                self.read_program_memory(indirect, rom)
            }
            AddressingModeKind::Direct => {
                if source.bank == RamBank::Zero {
                    self.ram0[source.address as usize]
                } else {
                    self.ram1[source.address as usize]
                }
            }
            AddressingModeKind::Immediate => self.fetch_operand(rom),
            AddressingModeKind::ShortImmediate => u16::from(source.short_immediate),
            AddressingModeKind::AccumulatorIndirect => {
                self.read_program_memory((self.registers.accumulator >> 16) as u16, rom)
            }
        }
    }

    fn write_addressing_mode(&mut self, dest: AddressingMode, value: u16) {
        match dest.kind {
            AddressingModeKind::GeneralRegister => self.write_register(dest.register, value),
            AddressingModeKind::PointerRegister => {
                if dest.pointer < 3 {
                    if dest.bank == RamBank::Zero {
                        self.registers.ram0_pointers[dest.pointer as usize] = value as u8;
                    } else {
                        self.registers.ram1_pointers[dest.pointer as usize] = value as u8;
                    }
                }
            }
            AddressingModeKind::Indirect => {
                let addr = self.read_pointer(dest.bank, dest.pointer, dest.modifier);
                if dest.bank == RamBank::Zero {
                    self.ram0[addr as usize] = value;
                } else {
                    self.ram1[addr as usize] = value;
                }
            }
            AddressingModeKind::Direct => {
                if dest.bank == RamBank::Zero {
                    self.ram0[dest.address as usize] = value;
                } else {
                    self.ram1[dest.address as usize] = value;
                }
            }
            _ => {}
        }
    }

    fn read_register(&mut self, rom: &[u8], register: u16) -> u16 {
        match register {
            0 => 0xffff,
            1 => self.registers.x,
            2 => self.registers.y,
            3 => (self.registers.accumulator >> 16) as u16,
            4 => self.registers.status.to_word(),
            5 => self.registers.stack.pop(),
            6 => self.registers.pc,
            7 => (self.registers.product() >> 16) as u16,
            8 => {
                if self.registers.status.st_bits_set() {
                    self.pm_read(rom, 0)
                } else {
                    self.registers.xst.ssp_read_status()
                }
            }
            9 => self.pm_read(rom, 1),
            10 => self.pm_read(rom, 2),
            11 => {
                if self.registers.status.st_bits_set() {
                    self.pm_read(rom, 3)
                } else {
                    self.registers.xst.value
                }
            }
            12 => self.pm_read(rom, 4),
            13 => 0xffff,
            14 => self.registers.pmc.read(),
            15 => self.registers.accumulator as u16,
            _ => 0xffff,
        }
    }

    fn write_register(&mut self, register: u16, value: u16) {
        match register {
            0 => {}
            1 => self.registers.x = value,
            2 => self.registers.y = value,
            3 => {
                self.registers.accumulator =
                    (self.registers.accumulator & 0x0000_ffff) | (u32::from(value) << 16)
            }
            4 => self.registers.status.write(value),
            5 => self.registers.stack.push(value),
            6 => self.registers.pc = value,
            7 => {}
            8 => {
                if self.registers.status.st_bits_set() {
                    self.pm_write(0, value);
                } else {
                    self.registers.xst.m68k_written = bit16(value, 1);
                    self.registers.xst.ssp_written = bit16(value, 0);
                }
            }
            9 => self.pm_write(1, value),
            10 => self.pm_write(2, value),
            11 => {
                if self.registers.status.st_bits_set() {
                    self.pm_write(3, value);
                } else {
                    self.registers.xst.ssp_write(value);
                }
            }
            12 => self.pm_write(4, value),
            13 => {}
            14 => self.registers.pmc.write(value),
            15 => {
                self.registers.accumulator =
                    (self.registers.accumulator & 0xffff_0000) | u32::from(value)
            }
            _ => {}
        }
    }

    fn pm_read(&mut self, rom: &[u8], pm_index: usize) -> u16 {
        let address = self.registers.pm_read[pm_index].get_and_increment_address();
        let pm = self.registers.pm_read[pm_index];
        self.registers.pmc.update_from(pm);
        self.read_external_memory(address, rom)
    }

    fn pm_write(&mut self, pm_index: usize, value: u16) {
        let address = self.registers.pm_write[pm_index].get_and_increment_address();
        let overwrite_mode = self.registers.pm_write[pm_index].overwrite_mode;
        let pm = self.registers.pm_write[pm_index];
        self.registers.pmc.update_from(pm);

        if overwrite_mode {
            if address > 0x0f_ffff && address <= 0x1f_ffff {
                let existing = self.read_external_memory(address, &[]);
                let mut new_value = 0u16;
                for mask in [0x000f, 0x00f0, 0x0f00, 0xf000] {
                    new_value |= if (value & mask) != 0 {
                        value & mask
                    } else {
                        existing & mask
                    };
                }
                self.write_external_memory(address, new_value);
            }
            return;
        }

        self.write_external_memory(address, value);
    }

    fn read_pointer(&mut self, bank: RamBank, pointer: u16, modifier: u16) -> u8 {
        if pointer < 3 {
            let loop_modulo = self.registers.status.loop_modulo();
            let registers = if bank == RamBank::Zero {
                &mut self.registers.ram0_pointers
            } else {
                &mut self.registers.ram1_pointers
            };
            let address = registers[pointer as usize];
            increment_pointer_register(&mut registers[pointer as usize], modifier, loop_modulo);
            return address;
        }
        modifier as u8
    }
}

fn parse_alu_addressing_mode(opcode: u16) -> AddressingMode {
    match opcode & 0x1f00 {
        0x0000 => AddressingMode::general_register(opcode & 0x0f),
        0x0200 | 0x0300 => AddressingMode::indirect(
            ram_bank_from_opcode(opcode),
            opcode & 0x03,
            (opcode >> 2) & 0x03,
        ),
        0x0600 | 0x0700 => AddressingMode::direct(ram_bank_from_opcode(opcode), opcode as u8),
        0x0800 => AddressingMode::immediate(),
        0x0a00 | 0x0b00 => AddressingMode::double_indirect(
            ram_bank_from_opcode(opcode),
            opcode & 0x03,
            (opcode >> 2) & 0x03,
        ),
        0x1200 | 0x1300 => {
            AddressingMode::pointer_register(ram_bank_from_opcode(opcode), opcode & 0x03)
        }
        0x1800 => AddressingMode::short_immediate(opcode as u8),
        _ => AddressingMode::general_register(0),
    }
}

fn increment_pointer_register(register: &mut u8, modifier: u16, loop_modulo: u8) {
    match modifier {
        0 => {}
        1 => *register = register.wrapping_add(1),
        2 => *register = modulo_decrement(*register, loop_modulo),
        3 => *register = modulo_increment(*register, loop_modulo),
        _ => {}
    }
}

fn modulo_increment(value: u8, modulo: u8) -> u8 {
    let mask = modulo.wrapping_sub(1);
    (value & !mask) | (value.wrapping_add(1) & mask)
}

fn modulo_decrement(value: u8, modulo: u8) -> u8 {
    let mask = modulo.wrapping_sub(1);
    (value & !mask) | (value.wrapping_sub(1) & mask)
}

fn alu_op_from_opcode(opcode: u16) -> Option<AluOp> {
    match opcode & 0xe000 {
        0x2000 => Some(AluOp::Subtract),
        0x6000 => Some(AluOp::Compare),
        0x8000 => Some(AluOp::Add),
        0xa000 => Some(AluOp::And),
        0xc000 => Some(AluOp::Or),
        0xe000 => Some(AluOp::ExclusiveOr),
        _ => None,
    }
}

fn condition_from_opcode(opcode: u16) -> Condition {
    match opcode & 0x01f0 {
        0x0000 => Condition::True,
        0x0050 => Condition::NotZero,
        0x0150 => Condition::Zero,
        0x0070 => Condition::NotNegative,
        0x0170 => Condition::Negative,
        _ => Condition::True,
    }
}

fn check_condition(condition: Condition, status: StatusRegister) -> bool {
    match condition {
        Condition::True => true,
        Condition::Zero => status.zero,
        Condition::NotZero => !status.zero,
        Condition::Negative => status.negative,
        Condition::NotNegative => !status.negative,
    }
}

fn ram_bank_from_opcode(opcode: u16) -> RamBank {
    if bit16(opcode, 8) {
        RamBank::One
    } else {
        RamBank::Zero
    }
}

fn toggle_pmc(value: PmcWaitingFor) -> PmcWaitingFor {
    if value == PmcWaitingFor::Address {
        PmcWaitingFor::Mode
    } else {
        PmcWaitingFor::Address
    }
}

fn bit32(value: u32, bit: u32) -> bool {
    ((value >> bit) & 1) != 0
}

fn bit16(value: u16, bit: u16) -> bool {
    ((value >> bit) & 1) != 0
}

fn read_rom_word_by_word_address(rom: &[u8], word_address: u32) -> u16 {
    read_rom_word_by_byte_address(rom, word_address << 1)
}

fn read_rom_word_by_byte_address(rom: &[u8], byte_address: u32) -> u16 {
    let index = byte_address as usize;
    if index + 1 >= rom.len() {
        return 0xffff;
    }
    let hi = rom[index];
    let lo = rom[index + 1];
    (u16::from(hi) << 8) | u16::from(lo)
}

fn fit_words(mut words: Vec<u16>, len: usize) -> Vec<u16> {
    words.resize(len, 0);
    words
}
