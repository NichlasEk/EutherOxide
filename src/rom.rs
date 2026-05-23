#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimingMode {
    Ntsc,
    Pal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SystemRegion {
    Japan,
    Usa,
    Europe,
    JapanPal,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RomHeader {
    pub header_offset: usize,
    pub domestic_name: String,
    pub overseas_name: String,
    pub product_code: String,
    pub checksum: u16,
    pub rom_start: u32,
    pub rom_end: u32,
    pub ram_start: u32,
    pub ram_end: u32,
    pub region_text: String,
    pub region: SystemRegion,
    pub timing: TimingMode,
}

pub fn normalize_rom_bytes(data: &[u8]) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }

    if let Some(stripped) = strip_copier_header(data) {
        return stripped.to_vec();
    }

    if let Some(deinterleaved) = try_deinterleave_smd(data) {
        return deinterleaved;
    }

    data.to_vec()
}

pub fn parse_header(data: &[u8]) -> Option<RomHeader> {
    let offset = mega_drive_header_offset(data)?;
    let domestic_name = ascii_field(data, offset + 0x20, 48);
    let overseas_name = ascii_field(data, offset + 0x50, 48);
    let product_code = ascii_field(data, offset + 0x82, 14);
    let checksum = read_be_u16(data, offset + 0x8e);
    let rom_start = read_be_u32(data, offset + 0xa0);
    let rom_end = read_be_u32(data, offset + 0xa4);
    let ram_start = read_be_u32(data, offset + 0xb4);
    let ram_end = read_be_u32(data, offset + 0xb8);
    let region_text = ascii_field(data, offset + 0xf0, 16);
    let (region, timing) = detect_region(&region_text);

    Some(RomHeader {
        header_offset: offset,
        domestic_name,
        overseas_name,
        product_code,
        checksum,
        rom_start,
        rom_end,
        ram_start,
        ram_end,
        region_text,
        region,
        timing,
    })
}

pub fn mega_drive_header_offset(data: &[u8]) -> Option<usize> {
    if data.len() >= 0x104 && &data[0x100..0x104] == b"SEGA" {
        return Some(0x100);
    }
    if data.len() >= 0x304 && &data[0x300..0x304] == b"SEGA" {
        return Some(0x300);
    }
    None
}

fn strip_copier_header(data: &[u8]) -> Option<&[u8]> {
    if data.len() <= 512 || mega_drive_header_offset(data).is_some() {
        return None;
    }
    let stripped = &data[512..];
    mega_drive_header_offset(stripped).map(|_| stripped)
}

fn try_deinterleave_smd(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() <= 512 || !(data.len() - 512).is_multiple_of(0x4000) {
        return None;
    }

    let body = &data[512..];
    let mut out = Vec::with_capacity(body.len());
    for block in body.chunks(0x4000) {
        let half = block.len() / 2;
        for index in 0..half {
            out.push(block[half + index]);
            out.push(block[index]);
        }
    }

    if mega_drive_header_offset(&out).is_some() {
        Some(out)
    } else {
        None
    }
}

fn detect_region(region_text: &str) -> (SystemRegion, TimingMode) {
    let upper = region_text.to_ascii_uppercase();
    let chars: Vec<char> = upper.chars().collect();
    let old_jp = chars.contains(&'J');
    let old_us = chars.contains(&'U');
    let old_eu = chars.contains(&'E');

    if old_us {
        return (SystemRegion::Usa, TimingMode::Ntsc);
    }
    if old_jp {
        return (SystemRegion::Japan, TimingMode::Ntsc);
    }
    if old_eu {
        return (SystemRegion::Europe, TimingMode::Pal);
    }

    let Some(first) = chars.first().copied() else {
        return (SystemRegion::Unknown, TimingMode::Ntsc);
    };
    let Some(value) = first.to_digit(16) else {
        return (SystemRegion::Unknown, TimingMode::Ntsc);
    };

    if (value & 0x04) != 0 {
        (SystemRegion::Usa, TimingMode::Ntsc)
    } else if (value & 0x01) != 0 {
        (SystemRegion::Japan, TimingMode::Ntsc)
    } else if (value & 0x08) != 0 {
        (SystemRegion::Europe, TimingMode::Pal)
    } else if (value & 0x02) != 0 {
        (SystemRegion::JapanPal, TimingMode::Pal)
    } else {
        (SystemRegion::Unknown, TimingMode::Ntsc)
    }
}

fn ascii_field(data: &[u8], offset: usize, len: usize) -> String {
    data.get(offset..offset + len)
        .unwrap_or(&[])
        .iter()
        .map(|&byte| {
            if byte.is_ascii_graphic() || byte == b' ' {
                byte as char
            } else {
                ' '
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn read_be_u16(data: &[u8], offset: usize) -> u16 {
    let hi = data.get(offset).copied().unwrap_or(0) as u16;
    let lo = data.get(offset + 1).copied().unwrap_or(0) as u16;
    (hi << 8) | lo
}

fn read_be_u32(data: &[u8], offset: usize) -> u32 {
    ((read_be_u16(data, offset) as u32) << 16) | read_be_u16(data, offset + 2) as u32
}
