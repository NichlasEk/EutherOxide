use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const DUAL_PORT_BYTES: usize = 0x2000;
const SDRAM_BYTES: usize = 0x20_0000;
const SCALE_STAMP_BYTES: usize = 64 * 32;
const NVRAM_WORDS: usize = 0x800 / 2;

const COMMAND_ARGS_OFFSET: usize = 0x1e10;
const NETWORK_DATA_OFFSET: usize = 0x1c00;
const REG_STATUS1_OFFSET: usize = 0x1fe4;
const REG_STATUS2_OFFSET: usize = 0x1fe6;
const REG_COMMAND_OFFSET: usize = 0x1fea;

const STATUS2_BUSY: u16 = 0x4000;
const STATUS2_EEPROM_ERROR1: u16 = 0x0100;
const STATUS2_EEPROM_ERROR2: u16 = 0x0200;
const STATUS2_MW_DATA_IN: u16 = 0x0020;

#[derive(Clone, Debug)]
pub struct PapriumBusOverride {
    rom_words: Vec<u16>,
    dual_port: Vec<u16>,
    sdram: Vec<u16>,
    scale_stamp: Vec<u8>,
    nvram: Vec<u16>,
    save_path: Option<PathBuf>,
    sdram_pointer_word: usize,
    sdram_window_enabled: bool,
    decoded: bool,
    nvram_dirty: bool,
    bgm_tracks_base_addr: u32,
    bgm_unpack_addr: u32,
    sfx_base_addr: u32,
    gfx_blocks_base_addr: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PapriumSnapshot {
    dual_port: Vec<u16>,
    sdram: Vec<u16>,
    scale_stamp: Vec<u8>,
    nvram: Vec<u16>,
    pub(crate) save_path: Option<PathBuf>,
    sdram_pointer_word: usize,
    sdram_window_enabled: bool,
    nvram_dirty: bool,
    bgm_tracks_base_addr: u32,
    bgm_unpack_addr: u32,
    sfx_base_addr: u32,
    gfx_blocks_base_addr: u32,
}

impl PapriumBusOverride {
    pub fn paprium_rom(bytes: &[u8]) -> bool {
        bytes.len() >= 0x190
            && bytes[0x183..0x191]
                .windows(b"T-574120-00".len())
                .any(|window| window == b"T-574120-00")
    }

    pub fn new(rom_bytes: &[u8], source_path: Option<&Path>) -> Self {
        let mut cartridge = Self {
            rom_words: to_words(rom_bytes),
            dual_port: vec![0; DUAL_PORT_BYTES / 2],
            sdram: vec![0; SDRAM_BYTES / 2],
            scale_stamp: vec![0; SCALE_STAMP_BYTES],
            nvram: vec![0; NVRAM_WORDS],
            save_path: source_path.map(build_save_path),
            sdram_pointer_word: 0,
            sdram_window_enabled: false,
            decoded: false,
            nvram_dirty: false,
            bgm_tracks_base_addr: 0,
            bgm_unpack_addr: 0,
            sfx_base_addr: 0,
            gfx_blocks_base_addr: 0,
        };
        cartridge.load_nvram();
        cartridge.reset();
        cartridge
    }

    pub fn handles(address: u32) -> bool {
        (address & 0x00ff_ffff) <= 0x003f_ffff
    }

    pub fn save_path(&self) -> Option<&Path> {
        self.save_path.as_deref()
    }

    pub fn reset(&mut self) {
        self.decode_and_patch_once();
        self.restore_boot_dual_port();
        self.apply_version_patches();
        self.sdram.fill(0);
        self.scale_stamp.fill(0);
        self.sdram_pointer_word = 0;
        self.sdram_window_enabled = false;
        self.bgm_tracks_base_addr = 0;
        self.bgm_unpack_addr = 0;
        self.sfx_base_addr = 0;
        self.gfx_blocks_base_addr = 0;
        self.set_word(REG_COMMAND_OFFSET, 0);
        self.set_word(REG_STATUS1_OFFSET, 0);
        self.set_word(REG_STATUS2_OFFSET, 7);
    }

    pub fn read_byte(&mut self, address: u32) -> u8 {
        let offset = (address & 0x003f_ffff) as usize;
        if offset < DUAL_PORT_BYTES {
            return raw_read_byte(&self.dual_port, offset ^ 1);
        }
        if (0xc000..0x10000).contains(&offset) && self.sdram_window_enabled {
            let word = self.read_sdram_window_word(false);
            return if (offset & 1) == 0 {
                (word >> 8) as u8
            } else {
                word as u8
            };
        }
        if offset < 0x400000 {
            return raw_read_byte(&self.rom_words, offset ^ 1);
        }
        0xff
    }

    pub fn read_word(&mut self, address: u32) -> u16 {
        let offset = ((address & 0x003f_ffff) as usize) & !1;
        if offset < DUAL_PORT_BYTES {
            return self.read_paprium_register_word(offset);
        }
        if (0xc000..0x10000).contains(&offset) && self.sdram_window_enabled {
            return self.read_sdram_window_word(true);
        }
        if offset < 0x400000 {
            return read_word_from(&self.rom_words, offset);
        }
        0xffff
    }

    pub fn write_byte(&mut self, address: u32, value: u8) {
        let offset = (address & 0x003f_ffff) as usize;
        if offset < DUAL_PORT_BYTES {
            raw_write_byte(&mut self.dual_port, offset ^ 1, value);
            if (offset & 0xfffe) == REG_COMMAND_OFFSET {
                self.process_command();
            }
        }
    }

    pub fn write_word(&mut self, address: u32, value: u16) {
        let offset = ((address & 0x003f_ffff) as usize) & !1;
        if offset < DUAL_PORT_BYTES {
            self.set_word(offset, value);
            if offset == REG_COMMAND_OFFSET {
                self.process_command();
            }
        }
    }

    pub fn flush_nvram(&mut self) -> std::io::Result<()> {
        if !self.nvram_dirty {
            return Ok(());
        }
        let Some(path) = &self.save_path else {
            return Ok(());
        };
        let mut bytes = Vec::with_capacity(self.nvram.len() * 2);
        for word in &self.nvram {
            bytes.push((word >> 8) as u8);
            bytes.push(*word as u8);
        }
        fs::write(path, bytes)?;
        self.nvram_dirty = false;
        Ok(())
    }

    pub fn snapshot(&self) -> PapriumSnapshot {
        PapriumSnapshot {
            dual_port: self.dual_port.clone(),
            sdram: self.sdram.clone(),
            scale_stamp: self.scale_stamp.clone(),
            nvram: self.nvram.clone(),
            save_path: self.save_path.clone(),
            sdram_pointer_word: self.sdram_pointer_word,
            sdram_window_enabled: self.sdram_window_enabled,
            nvram_dirty: self.nvram_dirty,
            bgm_tracks_base_addr: self.bgm_tracks_base_addr,
            bgm_unpack_addr: self.bgm_unpack_addr,
            sfx_base_addr: self.sfx_base_addr,
            gfx_blocks_base_addr: self.gfx_blocks_base_addr,
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: PapriumSnapshot) {
        self.dual_port = fit_words(snapshot.dual_port, DUAL_PORT_BYTES / 2);
        self.sdram = fit_words(snapshot.sdram, SDRAM_BYTES / 2);
        self.scale_stamp = fit_bytes(snapshot.scale_stamp, SCALE_STAMP_BYTES);
        self.nvram = fit_words(snapshot.nvram, NVRAM_WORDS);
        self.save_path = snapshot.save_path;
        self.sdram_pointer_word = snapshot
            .sdram_pointer_word
            .min(self.sdram.len().saturating_sub(1));
        self.sdram_window_enabled = snapshot.sdram_window_enabled;
        self.nvram_dirty = snapshot.nvram_dirty;
        self.bgm_tracks_base_addr = snapshot.bgm_tracks_base_addr;
        self.bgm_unpack_addr = snapshot.bgm_unpack_addr;
        self.sfx_base_addr = snapshot.sfx_base_addr;
        self.gfx_blocks_base_addr = snapshot.gfx_blocks_base_addr;
    }

    fn read_paprium_register_word(&self, offset: usize) -> u16 {
        match offset {
            REG_STATUS1_OFFSET => 0xffbb,
            REG_STATUS2_OFFSET => {
                0xffff & !STATUS2_BUSY & !STATUS2_EEPROM_ERROR1 & !STATUS2_EEPROM_ERROR2
            }
            REG_COMMAND_OFFSET => 0x7fff,
            _ => self.get_word(offset),
        }
    }

    fn read_sdram_window_word(&mut self, side_effects: bool) -> u16 {
        let index = self
            .sdram_pointer_word
            .min(self.sdram.len().saturating_sub(1));
        let value = self.sdram.get(index).copied().unwrap_or(0);
        if side_effects && self.sdram_pointer_word < self.sdram.len().saturating_sub(1) {
            self.sdram_pointer_word += 1;
        }
        value
    }

    fn process_command(&mut self) {
        let command = self.get_word(REG_COMMAND_OFFSET);
        let id = command >> 8;
        let arg = command as u8;

        match id {
            0x00 if arg == 0xaa => {
                self.set_word(REG_COMMAND_OFFSET, 0x00ff);
                return;
            }
            0x00 if arg == 0x55 => {
                self.set_word(REG_COMMAND_OFFSET, 0);
                return;
            }
            0x81 => self.sdram_window_enabled = true,
            0x83 | 0x88 | 0x8c | 0x95 | 0x96 | 0xa4 | 0xad | 0xae | 0xaf | 0xb0 | 0xb1 | 0xb6
            | 0xc9 | 0xca | 0xd1 | 0xd2 | 0xd3 | 0xd6 | 0xec => {}
            0x84 => self.sdram_window_enabled = false,
            0xc6 => {
                self.bgm_tracks_base_addr = swap_shorts(self.get_command_arg_long(0));
                self.sfx_base_addr = swap_shorts(self.get_command_arg_long(4));
                self.gfx_blocks_base_addr = swap_shorts(self.get_command_arg_long(6));
                self.bgm_unpack_addr = 0x10000;
            }
            0xda => {
                let source = ((u32::from(self.get_command_arg(1)) << 16)
                    | u32::from(self.get_command_arg(2)))
                    & 0xffff_ffff;
                let dest = self.get_command_arg(0);
                self.unpack(source, u32::from(dest), false);
                self.sdram_pointer_word = usize::from(dest >> 1);
                self.set_word(
                    REG_STATUS1_OFFSET,
                    self.get_word(REG_STATUS1_OFFSET) & !0x0004,
                );
                self.set_word(
                    REG_STATUS2_OFFSET,
                    self.get_word(REG_STATUS2_OFFSET) & !STATUS2_BUSY,
                );
            }
            0xdb => {
                self.sdram_pointer_word = (swap_shorts(self.get_command_arg_long(0)) >> 1) as usize
            }
            0xdf => self.load_eeprom_block(arg),
            0xe0 => self.save_eeprom_block(arg),
            0xe7 => {
                self.set_word(
                    REG_STATUS2_OFFSET,
                    self.get_word(REG_STATUS2_OFFSET) | STATUS2_MW_DATA_IN,
                );
                self.set_word(
                    NETWORK_DATA_OFFSET + 0x10,
                    self.get_command_arg(0).wrapping_add(16),
                );
            }
            0xf2 => {
                let block = self.get_command_arg(0);
                let source = self.block_addr(block);
                self.unpack(source, 0x9000, false);
                self.unpack(source, 0x9200, false);
                self.sdram_pointer_word = 0x9000 >> 1;
            }
            0xf4 => {
                let source = swap_shorts(self.get_command_arg_long(0));
                self.unpack(source, 0, true);
            }
            _ => {}
        }

        self.set_word(REG_COMMAND_OFFSET, 0);
    }

    fn unpack(&mut self, mut source_addr: u32, mut dest_addr: u32, scale_stamp: bool) -> u32 {
        let initial_dest = dest_addr;
        let first = self.rom_packed_byte(source_addr);
        source_addr = source_addr.wrapping_add(1);

        match first {
            0x80 => loop {
                let code = self.rom_packed_byte(source_addr);
                source_addr = source_addr.wrapping_add(1);
                if code == 0 {
                    break;
                }
                let count = u32::from(code & 0x3f);
                match code >> 6 {
                    0 => {
                        for _ in 0..count {
                            let data = self.rom_packed_byte(source_addr);
                            self.packed_write_byte(dest_addr, data, scale_stamp);
                            dest_addr = dest_addr.wrapping_add(1);
                            source_addr = source_addr.wrapping_add(1);
                        }
                    }
                    1 => {
                        let data = self.rom_packed_byte(source_addr);
                        source_addr = source_addr.wrapping_add(1);
                        for _ in 0..count {
                            self.packed_write_byte(dest_addr, data, scale_stamp);
                            dest_addr = dest_addr.wrapping_add(1);
                        }
                    }
                    2 => {
                        let mut copy_addr =
                            dest_addr.wrapping_sub(u32::from(self.rom_packed_byte(source_addr)));
                        source_addr = source_addr.wrapping_add(1);
                        for _ in 0..count {
                            let data = self.packed_read_byte(copy_addr, scale_stamp);
                            self.packed_write_byte(dest_addr, data, scale_stamp);
                            dest_addr = dest_addr.wrapping_add(1);
                            copy_addr = copy_addr.wrapping_add(1);
                        }
                    }
                    _ => {
                        for _ in 0..count {
                            self.packed_write_byte(dest_addr, 0, scale_stamp);
                            dest_addr = dest_addr.wrapping_add(1);
                        }
                    }
                }
            },
            0x81 => loop {
                let code = self.rom_packed_byte(source_addr);
                source_addr = source_addr.wrapping_add(1);
                if code == 0x11 {
                    break;
                }

                let (copy_size, literal_size, copy_addr) = match code >> 4 {
                    0 => {
                        let literal_size = if code != 0 {
                            3 + u32::from(code & 0x1f)
                        } else {
                            let size = 0x12 + u32::from(self.rom_packed_byte(source_addr));
                            source_addr = source_addr.wrapping_add(1);
                            size
                        };
                        (0, literal_size, 0)
                    }
                    1 => {
                        let mut copy_size = 2 + u32::from(code & 0x7);
                        if copy_size == 2 {
                            copy_size = 9 + u32::from(self.rom_packed_byte(source_addr));
                            source_addr = source_addr.wrapping_add(1);
                        }
                        let literal_size = u32::from(self.rom_packed_byte(source_addr) & 0x3);
                        let packed = ((u32::from(self.rom_packed_byte(source_addr + 1)) << 8)
                            + u32::from(self.rom_packed_byte(source_addr)))
                            >> 2;
                        source_addr = source_addr.wrapping_add(2);
                        (
                            copy_size,
                            literal_size,
                            dest_addr.wrapping_sub(0x4000 + packed),
                        )
                    }
                    2 | 3 => {
                        let mut copy_size = u32::from(code & 0x1f);
                        if copy_size != 0 {
                            copy_size += 2;
                        } else {
                            copy_size = 0x21;
                            while self.rom_packed_byte(source_addr) == 0 {
                                source_addr = source_addr.wrapping_add(1);
                                copy_size += 0xff;
                            }
                            copy_size += u32::from(self.rom_packed_byte(source_addr));
                            source_addr = source_addr.wrapping_add(1);
                        }
                        let literal_size = u32::from(self.rom_packed_byte(source_addr) & 0x3);
                        let packed = ((u32::from(self.rom_packed_byte(source_addr + 1)) << 8)
                            + u32::from(self.rom_packed_byte(source_addr)))
                            >> 2;
                        source_addr = source_addr.wrapping_add(2);
                        (copy_size, literal_size, dest_addr.wrapping_sub(1 + packed))
                    }
                    _ => {
                        let copy_size = u32::from(code >> 5) + 1;
                        let literal_size = u32::from(code & 0x3);
                        let packed = u32::from((code >> 2) & 0x7)
                            + (u32::from(self.rom_packed_byte(source_addr)) << 3);
                        source_addr = source_addr.wrapping_add(1);
                        (copy_size, literal_size, dest_addr.wrapping_sub(1 + packed))
                    }
                };

                let mut copy_addr = copy_addr;
                for _ in 0..copy_size {
                    let data = self.packed_read_byte(copy_addr, scale_stamp);
                    self.packed_write_byte(dest_addr, data, scale_stamp);
                    dest_addr = dest_addr.wrapping_add(1);
                    copy_addr = copy_addr.wrapping_add(1);
                }
                for _ in 0..literal_size {
                    let data = self.rom_packed_byte(source_addr);
                    self.packed_write_byte(dest_addr, data, scale_stamp);
                    dest_addr = dest_addr.wrapping_add(1);
                    source_addr = source_addr.wrapping_add(1);
                }
            },
            _ => {}
        }

        dest_addr.wrapping_sub(initial_dest)
    }

    fn load_eeprom_block(&mut self, block: u8) {
        let dest = usize::from(self.get_command_arg(0) >> 1);
        match block {
            1..=3 => copy_words(
                &self.nvram,
                (0x200 + usize::from(block) * 0x200) / 2,
                &mut self.dual_port,
                dest,
                0x100 / 2,
            ),
            4 => copy_words(&self.nvram, 0, &mut self.dual_port, dest, 0x200 / 2),
            _ => {}
        }
    }

    fn save_eeprom_block(&mut self, block: u8) {
        let src = usize::from(self.get_command_arg(1) >> 1);
        match block {
            1..=3 => copy_words(
                &self.dual_port,
                src,
                &mut self.nvram,
                (0x200 + usize::from(block) * 0x200) / 2,
                0x100 / 2,
            ),
            4 => copy_words(&self.dual_port, src, &mut self.nvram, 0, 0x200 / 2),
            _ => {}
        }
        self.set_word(
            REG_STATUS2_OFFSET,
            self.get_word(REG_STATUS2_OFFSET) & !STATUS2_EEPROM_ERROR1 & !STATUS2_EEPROM_ERROR2,
        );
        self.nvram_dirty = true;
        let _ = self.flush_nvram();
    }

    fn block_addr(&self, num: u16) -> u32 {
        self.gfx_blocks_base_addr.wrapping_add(swap_shorts(
            self.read_rom_u32_raw_struct(
                self.gfx_blocks_base_addr.wrapping_add(u32::from(num) * 4),
            ),
        ))
    }

    fn get_command_arg(&self, index: usize) -> u16 {
        self.get_word(COMMAND_ARGS_OFFSET + index * 2)
    }

    fn get_command_arg_long(&self, index: usize) -> u32 {
        let offset = COMMAND_ARGS_OFFSET + index * 4;
        u32::from(self.get_word(offset)) | (u32::from(self.get_word(offset + 2)) << 16)
    }

    fn get_word(&self, byte_offset: usize) -> u16 {
        self.dual_port.get(byte_offset >> 1).copied().unwrap_or(0)
    }

    fn set_word(&mut self, byte_offset: usize, value: u16) {
        if let Some(slot) = self.dual_port.get_mut(byte_offset >> 1) {
            *slot = value;
        }
    }

    fn decode_and_patch_once(&mut self) {
        if self.decoded || self.rom_words.len() < 0x800000 / 2 {
            return;
        }

        if self.rom_words[0x8000 / 2] != 0 {
            let key1 = self.rom_words[0x8000 / 2];
            let key2 = self.rom_words[0xbd000 / 2];
            for addr in (0x2000 / 2)..(0x10000 / 2) {
                self.rom_words[addr] ^= key1 | bitswap_paprium((addr & 0xff) as u16);
            }
            for addr in (0x10000 / 2)..(0x800000 / 2) {
                self.rom_words[addr] ^= key2 | bitswap_paprium((addr & 0xff) as u16);
            }
        }
        self.decoded = true;
    }

    fn restore_boot_dual_port(&mut self) {
        for (slot, word) in self.dual_port.iter_mut().zip(&self.rom_words) {
            *slot = *word;
        }
    }

    fn apply_version_patches(&mut self) {
        if self.rom_words.len() <= 0x81104 / 2 || self.rom_words.get(0x1000a / 2) != Some(&0x2e7f) {
            return;
        }
        self.set_word(0x1d1c, 0x0004);
        self.set_word(0x1d2c, self.get_word(0x1d2c) | 0x0100);
        self.set_word(0x1560, 0x4ef9);
        self.set_word(0x1562, 0x0001);
        self.set_word(0x1564, 0x0100);
        self.rom_words[0x81104 / 2] = 0x4e71;
    }

    fn rom_packed_byte(&self, logical_byte_addr: u32) -> u8 {
        self.rom_raw_byte(logical_byte_addr ^ 1)
    }

    fn rom_raw_byte(&self, raw_byte_addr: u32) -> u8 {
        raw_read_byte(&self.rom_words, raw_byte_addr as usize)
    }

    fn read_rom_u32_raw_struct(&self, byte_addr: u32) -> u32 {
        u32::from(self.rom_raw_byte(byte_addr))
            | (u32::from(self.rom_raw_byte(byte_addr + 1)) << 8)
            | (u32::from(self.rom_raw_byte(byte_addr + 2)) << 16)
            | (u32::from(self.rom_raw_byte(byte_addr + 3)) << 24)
    }

    fn packed_read_byte(&self, logical_byte_addr: u32, scale_stamp: bool) -> u8 {
        let raw = (logical_byte_addr ^ 1) as usize;
        if scale_stamp {
            return self.scale_stamp.get(raw).copied().unwrap_or(0);
        }
        raw_read_byte(&self.sdram, raw)
    }

    fn packed_write_byte(&mut self, logical_byte_addr: u32, value: u8, scale_stamp: bool) {
        let raw = (logical_byte_addr ^ 1) as usize;
        if scale_stamp {
            if let Some(slot) = self.scale_stamp.get_mut(raw) {
                *slot = value;
            }
        } else {
            raw_write_byte(&mut self.sdram, raw, value);
        }
    }

    fn load_nvram(&mut self) {
        let Some(path) = &self.save_path else {
            return;
        };
        let Ok(bytes) = fs::read(path) else {
            return;
        };
        for (slot, chunk) in self.nvram.iter_mut().zip(bytes.chunks_exact(2)) {
            *slot = (u16::from(chunk[0]) << 8) | u16::from(chunk[1]);
        }
        self.nvram_dirty = false;
    }
}

fn to_words(rom_bytes: &[u8]) -> Vec<u16> {
    let word_count = (0x800000 / 2).max(rom_bytes.len().div_ceil(2));
    let mut words = vec![0xffff; word_count];
    for (index, chunk) in rom_bytes.chunks(2).enumerate() {
        let hi = u16::from(chunk[0]);
        let lo = u16::from(*chunk.get(1).unwrap_or(&0xff));
        words[index] = (hi << 8) | lo;
    }
    words
}

fn raw_read_byte(words: &[u16], raw_byte_address: usize) -> u8 {
    let Some(value) = words.get(raw_byte_address >> 1).copied() else {
        return 0xff;
    };
    if (raw_byte_address & 1) == 0 {
        value as u8
    } else {
        (value >> 8) as u8
    }
}

fn raw_write_byte(words: &mut [u16], raw_byte_address: usize, value: u8) {
    let Some(slot) = words.get_mut(raw_byte_address >> 1) else {
        return;
    };
    if (raw_byte_address & 1) == 0 {
        *slot = (*slot & 0xff00) | u16::from(value);
    } else {
        *slot = (*slot & 0x00ff) | (u16::from(value) << 8);
    }
}

fn read_word_from(words: &[u16], byte_offset: usize) -> u16 {
    words.get(byte_offset >> 1).copied().unwrap_or(0xffff)
}

fn bitswap_paprium(value: u16) -> u16 {
    const BITS: [u8; 16] = [15, 1, 14, 6, 13, 2, 12, 0, 11, 3, 10, 4, 9, 7, 8, 5];
    let mut result = 0u16;
    for (index, bit) in BITS.iter().enumerate() {
        result |= ((value >> bit) & 1) << (15 - index);
    }
    result
}

fn swap_shorts(value: u32) -> u32 {
    value.rotate_left(16)
}

fn copy_words(
    source: &[u16],
    source_index: usize,
    dest: &mut [u16],
    dest_index: usize,
    count: usize,
) {
    let copy = count
        .min(source.len().saturating_sub(source_index))
        .min(dest.len().saturating_sub(dest_index));
    for index in 0..copy {
        dest[dest_index + index] = source[source_index + index];
    }
}

fn fit_words(mut words: Vec<u16>, len: usize) -> Vec<u16> {
    words.resize(len, 0);
    words
}

fn fit_bytes(mut bytes: Vec<u8>, len: usize) -> Vec<u8> {
    bytes.resize(len, 0);
    bytes
}

fn build_save_path(source_path: &Path) -> PathBuf {
    let file_name = source_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("paprium");
    source_path.with_file_name(format!("{file_name}.paprium.srm"))
}
