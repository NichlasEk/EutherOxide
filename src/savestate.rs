use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::emulator::{Emulator, EmulatorSnapshot};
use serde::{Deserialize, Serialize};

pub const ARGON_EXTENSION: &str = "argon";
pub const ARGON_SLOT_COUNT: usize = 3;
const ARGON_MAGIC: &str = "EUTHEROXIDE_ARGON";
const ARGON_VERSION: u32 = 1;
const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ArgonFile {
    magic: String,
    version: u32,
    rom_hash: u64,
    rom_len: usize,
    slots: Vec<Option<SaveSlot>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SaveSlot {
    created_unix_ms: u64,
    frame_count: u64,
    label: String,
    state: EmulatorSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArgonSummary {
    pub path: String,
    pub rom_hash: u64,
    pub rom_len: usize,
    pub slots: Vec<SlotSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlotSummary {
    pub slot: usize,
    pub occupied: bool,
    pub created_unix_ms: Option<u64>,
    pub frame_count: Option<u64>,
    pub label: Option<String>,
}

pub fn argon_path_for_rom<P: AsRef<Path>>(rom_path: P) -> PathBuf {
    let mut path = rom_path.as_ref().to_path_buf();
    path.set_extension(ARGON_EXTENSION);
    path
}

pub fn rom_fingerprint(data: &[u8]) -> u64 {
    let mut hash = FNV_OFFSET;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash ^= data.len() as u64;
    hash.wrapping_mul(FNV_PRIME)
}

pub fn list_slots_for_emulator(emulator: &Emulator) -> io::Result<ArgonSummary> {
    let path = argon_path_from_emulator(emulator)?;
    let rom_hash = rom_fingerprint(&emulator.bus.rom);
    let rom_len = emulator.bus.rom.len();
    if path.exists() {
        let file = read_argon(&path, rom_hash, rom_len)?;
        Ok(file.summary(&path))
    } else {
        Ok(ArgonFile::new(rom_hash, rom_len).summary(&path))
    }
}

pub fn save_slot_for_emulator(emulator: &Emulator, slot: usize) -> io::Result<ArgonSummary> {
    let path = argon_path_from_emulator(emulator)?;
    let rom_hash = rom_fingerprint(&emulator.bus.rom);
    let rom_len = emulator.bus.rom.len();
    let index = slot_index(slot)?;
    let mut file = if path.exists() {
        read_argon(&path, rom_hash, rom_len)?
    } else {
        ArgonFile::new(rom_hash, rom_len)
    };

    file.slots[index] = Some(SaveSlot {
        created_unix_ms: unix_ms_now(),
        frame_count: emulator.frame_count,
        label: format!("Frame {}", emulator.frame_count),
        state: emulator.snapshot(),
    });
    write_argon(&path, &file)?;
    Ok(file.summary(&path))
}

pub fn load_slot_for_emulator(emulator: &mut Emulator, slot: usize) -> io::Result<ArgonSummary> {
    let path = argon_path_from_emulator(emulator)?;
    let rom_hash = rom_fingerprint(&emulator.bus.rom);
    let rom_len = emulator.bus.rom.len();
    let index = slot_index(slot)?;
    let file = read_argon(&path, rom_hash, rom_len)?;
    let state = file
        .slots
        .get(index)
        .and_then(Option::as_ref)
        .ok_or_else(|| invalid_input(format!("slot {slot} is empty")))?
        .state
        .clone();
    emulator.restore_snapshot(state);
    Ok(file.summary(&path))
}

fn argon_path_from_emulator(emulator: &Emulator) -> io::Result<PathBuf> {
    emulator
        .rom_path
        .as_deref()
        .map(argon_path_for_rom)
        .ok_or_else(|| invalid_input("ROM path is not available for .argon savestates"))
}

fn read_argon(path: &Path, rom_hash: u64, rom_len: usize) -> io::Result<ArgonFile> {
    let bytes = fs::read(path)?;
    let mut file: ArgonFile =
        serde_json::from_slice(&bytes).map_err(|err| invalid_data(err.to_string()))?;
    if file.magic != ARGON_MAGIC {
        return Err(invalid_data("not an EutherOxide .argon file"));
    }
    if file.version != ARGON_VERSION {
        return Err(invalid_data(format!(
            "unsupported .argon version {}",
            file.version
        )));
    }
    if file.rom_hash != rom_hash || file.rom_len != rom_len {
        return Err(invalid_data("the .argon file belongs to a different ROM"));
    }
    normalize_slots(&mut file.slots);
    Ok(file)
}

fn write_argon(path: &Path, file: &ArgonFile) -> io::Result<()> {
    let data = serde_json::to_vec_pretty(file).map_err(|err| invalid_data(err.to_string()))?;
    fs::write(path, data)
}

fn normalize_slots(slots: &mut Vec<Option<SaveSlot>>) {
    slots.truncate(ARGON_SLOT_COUNT);
    slots.resize_with(ARGON_SLOT_COUNT, || None);
}

fn slot_index(slot: usize) -> io::Result<usize> {
    if (1..=ARGON_SLOT_COUNT).contains(&slot) {
        Ok(slot - 1)
    } else {
        Err(invalid_input(format!(
            "slot must be between 1 and {ARGON_SLOT_COUNT}"
        )))
    }
}

fn unix_ms_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn invalid_input(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

impl ArgonFile {
    fn new(rom_hash: u64, rom_len: usize) -> Self {
        Self {
            magic: ARGON_MAGIC.to_string(),
            version: ARGON_VERSION,
            rom_hash,
            rom_len,
            slots: vec![None; ARGON_SLOT_COUNT],
        }
    }

    fn summary(&self, path: &Path) -> ArgonSummary {
        ArgonSummary {
            path: path.display().to_string(),
            rom_hash: self.rom_hash,
            rom_len: self.rom_len,
            slots: self
                .slots
                .iter()
                .enumerate()
                .map(|(index, slot)| SlotSummary {
                    slot: index + 1,
                    occupied: slot.is_some(),
                    created_unix_ms: slot.as_ref().map(|slot| slot.created_unix_ms),
                    frame_count: slot.as_ref().map(|slot| slot.frame_count),
                    label: slot.as_ref().map(|slot| slot.label.clone()),
                })
                .collect(),
        }
    }
}
