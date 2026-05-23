use euther_oxide::audio::Ym2612;
use euther_oxide::rom::{SystemRegion, TimingMode, normalize_rom_bytes, parse_header};
use euther_oxide::{Emulator, M68k, M68kBus};

fn reset_to(cpu: &mut M68k, bus: &mut M68kBus, address: u32) {
    bus.write_long(0, 0x00ff_0000);
    bus.write_long(4, address);
    cpu.reset(bus);
}

fn load_program(bus: &mut M68kBus, address: u32, words: &[u16]) {
    let mut bytes = Vec::with_capacity(words.len() * 2);
    for &word in words {
        bytes.push((word >> 8) as u8);
        bytes.push(word as u8);
    }
    bus.load(address, &bytes);
}

#[test]
fn parses_mega_drive_header_and_region() {
    let mut rom = vec![0; 0x200];
    rom[0x100..0x104].copy_from_slice(b"SEGA");
    rom[0x150..0x150 + 10].copy_from_slice(b"OXIDE TEST");
    rom[0x1f0..0x1f3].copy_from_slice(b"UE ");

    let header = parse_header(&rom).expect("header");
    assert_eq!(header.header_offset, 0x100);
    assert_eq!(header.region, SystemRegion::Usa);
    assert_eq!(header.timing, TimingMode::Ntsc);
}

#[test]
fn deinterleaves_smd_images_when_header_appears_after_decode() {
    let mut plain = vec![0; 0x4000];
    plain[0x100..0x104].copy_from_slice(b"SEGA");
    let mut smd = vec![0; 512];
    let half = plain.len() / 2;
    smd.extend_from_slice(&plain.iter().skip(1).step_by(2).copied().collect::<Vec<_>>());
    smd.extend_from_slice(&plain.iter().step_by(2).copied().collect::<Vec<_>>());
    let normalized = normalize_rom_bytes(&smd);
    assert_eq!(&normalized[0x100..0x104], b"SEGA");
    assert_eq!(normalized.len(), 0x4000);
    assert_eq!(half, 0x2000);
}

#[test]
fn cpu_loads_reset_vectors_and_executes_moveq() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(&mut bus, 0x100, &[0x70ff, 0x7200]);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[0], 0xffff_ffff);
    assert!(cpu.flag_n());
    assert!(!cpu.flag_z());

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[1], 0);
    assert!(cpu.flag_z());
}

#[test]
fn cpu_branches_calls_and_returns_on_supervisor_stack() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(
        &mut bus,
        0x100,
        &[
            0x6104, 0x7001, 0x4e71, 0x7002, 0x4e75, 0x6002, 0x7203, 0x7204,
        ],
    );

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x106);
    assert_eq!(cpu.ssp, 0x00fe_fffc);
    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x102);
    assert_eq!(cpu.ssp, 0x00ff_0000);
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[0], 1);
}

#[test]
fn bus_routes_ym_and_psg_writes() {
    let mut bus = M68kBus::new();
    bus.write_word(0x00a0_4000, 0xa034);
    assert_eq!(bus.ym2612.registers[0][0xa0], 0x34);
    assert_ne!(bus.ym2612.read_register(0x4000) & 0x80, 0);

    bus.write_word(0x00c0_0010, 0x009f);
    assert_eq!(bus.psg.writes, 1);
    assert_eq!(bus.psg.write_log.last().unwrap().value, 0x9f);
}

#[test]
fn vdp_renders_plane_a_tile() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[2] = 0x38;
    bus.vdp.registers[4] = 0x07;
    bus.vdp.cram[1] = 0x00e;
    let plane_a = ((bus.vdp.registers[2] as usize & 0x38) << 10) & 0xffff;
    bus.vdp.vram[plane_a] = 0x00;
    bus.vdp.vram[plane_a ^ 1] = 0x01;
    bus.vdp.vram[32] = 0x11;
    bus.vdp.vram[33] = 0x11;
    bus.vdp.vram[34] = 0x11;
    bus.vdp.vram[35] = 0x11;
    bus.vdp.render_frame();
    assert_ne!(bus.vdp.framebuffer[0], 0);
}

#[test]
fn ym2612_timer_busy_and_pitch_paths_work() {
    let mut ym = Ym2612::new();
    ym.write_address_1(0xa0);
    ym.write_data(0x6a, 0, None);
    ym.write_address_1(0xa4);
    ym.write_data((4 << 3) | 0x02, 0, None);
    assert!((ym.channel_frequency(0) - 261.95).abs() < 0.75);
    assert_ne!(ym.read_register(0), 0);
    ym.tick(Ym2612::WRITE_BUSY_CYCLES);
    assert_eq!(ym.read_register(0) & 0x80, 0);
}

#[test]
fn emulator_loads_tiny_rom_and_sets_reset_pc() {
    let mut rom = vec![0; 0x200];
    rom[0x000..0x004].copy_from_slice(&0x00ff_0000u32.to_be_bytes());
    rom[0x004..0x008].copy_from_slice(&0x0000_0120u32.to_be_bytes());
    rom[0x100..0x104].copy_from_slice(b"SEGA");
    rom[0x120] = 0x70;
    rom[0x121] = 0x01;

    let mut emulator = Emulator::new();
    emulator.load_rom_bytes(&rom);
    assert_eq!(emulator.cpu.pc, 0x120);
    emulator.cpu.step(&mut emulator.bus).unwrap();
    assert_eq!(emulator.cpu.d[0], 1);
}
