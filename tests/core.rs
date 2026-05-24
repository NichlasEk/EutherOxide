use euther_oxide::audio::Ym2612;
use euther_oxide::rom::{SystemRegion, TimingMode, normalize_rom_bytes, parse_header};
use euther_oxide::savestate::{argon_path_for_rom, load_slot_for_emulator, save_slot_for_emulator};
use euther_oxide::z80::Z80;
use euther_oxide::{Emulator, M68k, M68kBus};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

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
fn cpu_68000_branch_ff_is_short_negative_displacement() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(&mut bus, 0x100, &[0x60ff, 0x7001]);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x101);
}

#[test]
fn cpu_dbcc_self_loop_caps_iterations_to_counter() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    cpu.d[0] = 1;
    load_program(&mut bus, 0x100, &[0x51c8, 0xfffe]);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x100);
    assert_eq!(cpu.d[0] & 0xffff, 0);
}

#[test]
fn cpu_cmpa_word_uses_sign_extended_24_bit_operand() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    cpu.set_address_register(1, 0x00ff_90c8);
    load_program(&mut bus, 0x100, &[0xb2fc, 0x90c8, 0x6702, 0x7001, 0x7002]);

    cpu.step(&mut bus).unwrap();
    assert!(cpu.flag_z());
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x108);
}

#[test]
fn cpu_eori_to_ccr_updates_condition_codes() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(&mut bus, 0x100, &[0x003c, 0x0011, 0x0a3c, 0x0011]);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.sr() & 0x1f, 0x11);
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.sr() & 0x1f, 0x00);
}

#[test]
fn cpu_trap_and_rte_restore_status_and_return_pc() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    bus.write_long(0x80, 0x200);
    load_program(&mut bus, 0x100, &[0x4e40, 0x7007]);
    load_program(&mut bus, 0x200, &[0x4e73]);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x200);
    assert_eq!(cpu.ssp, 0x00fe_fffa);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.pc, 0x102);
    assert_eq!(cpu.ssp, 0x00ff_0000);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[0], 7);
}

#[test]
fn cpu_roxl_uses_extend_and_shifts_update_extend() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(
        &mut bus,
        0x100,
        &[
            0x003c, 0x0010, // ori #$10,ccr
            0x7000, // moveq #0,d0
            0xe350, // roxl.w #1,d0
            0x303c, 0x8001, // move.w #$8001,d0
            0xe240, // asr.w #1,d0
        ],
    );

    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[0] & 0xffff, 0x0001);
    assert_eq!(cpu.sr() & 0x11, 0x00);

    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[0] & 0xffff, 0xc000);
    assert_eq!(cpu.sr() & 0x19, 0x19);
}

#[test]
fn cpu_addx_uses_extend_and_preserves_zero_for_multiprecision() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(
        &mut bus,
        0x100,
        &[
            0x7001, // moveq #1,d0
            0x7201, // moveq #1,d1
            0x003c, 0x0010, // ori #$10,ccr
            0xd300, // addx.b d0,d1
            0x70ff, // moveq #-1,d0
            0x7200, // moveq #0,d1
            0x003c, 0x0010, // ori #$10,ccr
            0xd300, // addx.b d0,d1
        ],
    );

    for _ in 0..4 {
        cpu.step(&mut bus).unwrap();
    }
    assert_eq!(cpu.d[1] & 0xff, 3);
    assert_eq!(cpu.sr() & 0x15, 0);

    for _ in 0..4 {
        cpu.step(&mut bus).unwrap();
    }
    assert_eq!(cpu.d[1] & 0xff, 0);
    assert_eq!(cpu.sr() & 0x15, 0x15);
}

#[test]
fn cpu_adda_suba_are_not_misdecoded_as_addx_subx() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    cpu.d[2] = 0x0000_0010;
    cpu.set_address_register(1, 0x0000_2000);
    cpu.set_sr(0x231f);
    load_program(
        &mut bus,
        0x100,
        &[
            0xd3c2, // adda.l d2,a1
            0x93c2, // suba.l d2,a1
        ],
    );

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.a()[1], 0x0000_2010);
    assert_eq!(cpu.sr(), 0x231f);

    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.a()[1], 0x0000_2000);
    assert_eq!(cpu.sr(), 0x231f);
}

#[test]
fn cpu_dynamic_shift_count_zero_preserves_flags() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(
        &mut bus,
        0x100,
        &[
            0x70ff, // moveq #-1,d0
            0x7200, // moveq #0,d1
            0xe0a9, // lsr.l d0,d1, count comes from d0 & 63
            0xe2a9, // lsr.l d1,d1, zero count preserves CCR
        ],
    );

    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    let flags_after_nonzero_shift = cpu.sr() & 0x1f;
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.sr() & 0x1f, flags_after_nonzero_shift);
}

#[test]
fn cpu_eor_register_writes_destination_instead_of_comparing() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(
        &mut bus,
        0x100,
        &[
            0x283c, 0x1111, 0x2222, // move.l #$11112222,d4
            0x243c, 0x3333, 0x0000, // move.l #$33330000,d2
            0xb982, // eor.l d4,d2
        ],
    );

    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[2], 0x2222_2222);
    assert_eq!(cpu.sr() & 0x04, 0);
}

#[test]
fn cpu_cmpa_long_address_register_direct_is_not_eor() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x200);
    load_program(
        &mut bus,
        0x200,
        &[
            0xb5c9, // cmpa.l a1,a2
            0x4e71, // nop
        ],
    );

    cpu.set_address_register(1, 0x0000_2000);
    cpu.set_address_register(2, 0x0000_1000);
    cpu.step(&mut bus).unwrap();

    assert_eq!(cpu.pc, 0x202);
    assert_eq!(cpu.a()[1], 0x0000_2000);
    assert_eq!(cpu.a()[2], 0x0000_1000);
    assert_ne!(cpu.sr() & 0x08, 0);
}

#[test]
fn cpu_movem_predecrement_uses_reversed_register_mask() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    cpu.set_address_register(7, 0x00ff_0100);
    for index in 0..8 {
        cpu.d[index] = 0xd000_0000 | index as u32;
    }
    for index in 1..=5 {
        cpu.set_address_register(index, 0xa000_0000 | index as u32);
    }
    load_program(
        &mut bus,
        0x100,
        &[
            0x48e7, 0xff7c, // movem.l d0-d7/a1-a5,-(sp)
            0x7800, // moveq #0,d4
            0x4cdf, 0x3eff, // movem.l (sp)+,d0-d7/a1-a5
        ],
    );

    cpu.step(&mut bus).unwrap();
    cpu.step(&mut bus).unwrap();
    assert_eq!(cpu.d[4], 0);
    cpu.step(&mut bus).unwrap();

    assert_eq!(cpu.d[4], 0xd000_0004);
    assert_eq!(cpu.a()[1], 0x0000_0001);
    assert_eq!(cpu.a()[5], 0x0000_0005);
    assert_eq!(cpu.a()[7], 0x00ff_0100);
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
fn z80_bus_routes_ram_ym_psg_and_banked_68k() {
    let mut bus = M68kBus::new();

    bus.z80_write_byte(0x0000, 0x12);
    bus.z80_write_byte(0x2000, 0x34);
    assert_eq!(bus.z80_read_byte(0x0000), 0x34);

    bus.z80_write_byte(0x4000, 0x22);
    bus.z80_write_byte(0x4001, 0x35);
    assert_eq!(bus.ym2612.registers[0][0x22], 0x35);

    bus.z80_write_byte(0x7f11, 0x9f);
    assert_eq!(bus.psg.writes, 1);

    bus.load(0x8000, &[0xab]);
    bus.z80_write_byte(0x6000, 1);
    for _ in 0..8 {
        bus.z80_write_byte(0x6000, 0);
    }
    assert_eq!(bus.z80_read_byte(0x8000), 0xab);
}

#[test]
fn z80_ram_word_and_long_writes_use_uds_byte_lanes() {
    let mut bus = M68kBus::new();

    bus.write_byte(0x00a1_1100, 0x01);
    bus.write_word(0x00a0_0001, 0x3ea0);
    bus.write_long(0x00a0_0010, 0x1234_5678);

    assert_eq!(bus.read_byte(0x00a0_0000), 0x3e);
    assert_eq!(bus.read_byte(0x00a0_0001), 0x00);
    assert_eq!(bus.read_word(0x00a0_0001), 0x0000);
    assert_eq!(bus.read_byte(0x00a0_0010), 0x12);
    assert_eq!(bus.read_byte(0x00a0_0011), 0x00);
    assert_eq!(bus.read_byte(0x00a0_0012), 0x56);
    assert_eq!(bus.read_byte(0x00a0_0013), 0x00);
}

#[test]
fn z80_ram_window_is_inaccessible_without_bus_grant() {
    let mut bus = M68kBus::new();

    bus.write_byte(0x00a0_0000, 0x3e);

    assert_eq!(bus.read_byte(0x00a0_0000), 0xff);
    bus.write_byte(0x00a1_1100, 0x01);
    assert_eq!(bus.read_byte(0x00a0_0000), 0x00);
    bus.write_byte(0x00a0_0000, 0x3e);
    assert_eq!(bus.read_byte(0x00a0_0000), 0x3e);
}

#[test]
fn z80_reset_line_reports_assertion_edges() {
    let mut bus = M68kBus::new();

    assert!(!bus.take_z80_reset_request());
    bus.write_word(0x00a1_1200, 0x0100);
    assert!(!bus.take_z80_reset_request());
    bus.write_word(0x00a1_1200, 0x0000);
    assert!(bus.take_z80_reset_request());
    assert!(!bus.take_z80_reset_request());
}

#[test]
fn cpu_tas_memory_target_does_not_write_back_on_mega_drive() {
    let mut bus = M68kBus::new();
    let mut cpu = M68k::new();
    reset_to(&mut cpu, &mut bus, 0x100);
    load_program(&mut bus, 0x100, &[0x4af9, 0xffff, 0x006c]);
    bus.write_byte(0x00ff_006c, 0x01);

    cpu.step(&mut bus).unwrap();

    assert_eq!(bus.read_byte(0x00ff_006c), 0x01);
    assert_eq!(cpu.pc, 0x106);
}

#[test]
fn z80_program_can_drive_ym2612_ports() {
    let mut bus = M68kBus::new();
    let mut z80 = Z80::new();
    let program = [
        0x3e, 0x22, // ld a,$22
        0x32, 0x00, 0x40, // ld ($4000),a
        0x3e, 0x34, // ld a,$34
        0x32, 0x01, 0x40, // ld ($4001),a
        0x76, // halt
    ];

    for (offset, byte) in program.iter().copied().enumerate() {
        bus.z80_write_byte(offset as u16, byte);
    }
    bus.write_byte(0x00a1_1200, 0x01);
    bus.write_byte(0x00a1_1100, 0x00);

    z80.run_cycles(&mut bus, 96.0);

    assert!(z80.halted);
    assert_eq!(bus.ym2612.registers[0][0x22], 0x34);
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
fn vdp_skips_clean_redraws() {
    let mut bus = M68kBus::new();

    bus.vdp.render_frame();
    bus.vdp.framebuffer[0] = 0x1234_5678;
    bus.vdp.render_frame();

    assert_eq!(bus.vdp.framebuffer[0], 0x1234_5678);
}

#[test]
fn vdp_reports_hblank_status_while_vblank_interrupt_is_pending() {
    let mut bus = M68kBus::new();

    bus.vdp.request_vblank();

    assert_eq!(bus.vdp.read_control() & 0x0008, 0x0008);
}

#[test]
fn vdp_sprites_use_column_major_tile_order() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[5] = 0x00;
    for index in 1..=4 {
        bus.vdp.cram[index] = (index as u16) << 1;
    }

    write_vram_word_direct(&mut bus, 0x0000, 0x0080);
    write_vram_word_direct(&mut bus, 0x0002, 0x0500);
    write_vram_word_direct(&mut bus, 0x0004, 0x0001);
    write_vram_word_direct(&mut bus, 0x0006, 0x0080);
    for tile in 1..=4 {
        fill_pattern(&mut bus, tile, tile as u8);
    }

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.framebuffer[0], bus.vdp.palette_color(1));
    assert_eq!(bus.vdp.framebuffer[8], bus.vdp.palette_color(3));
    assert_eq!(
        bus.vdp.framebuffer[8 * bus.vdp.screen_width],
        bus.vdp.palette_color(2)
    );
    assert_eq!(
        bus.vdp.framebuffer[8 * bus.vdp.screen_width + 8],
        bus.vdp.palette_color(4)
    );
}

#[test]
fn vdp_low_priority_sprites_stay_behind_high_priority_plane_pixels() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[2] = 0x38;
    bus.vdp.registers[5] = 0x00;
    bus.vdp.registers[13] = 0x3f;
    bus.vdp.cram[1] = 0x00e;
    bus.vdp.cram[2] = 0x0e0;

    let plane_a = ((bus.vdp.registers[2] as usize & 0x38) << 10) & 0xffff;
    write_vram_word_direct(&mut bus, plane_a, 0x8002);
    write_vram_word_direct(&mut bus, 0x0000, 0x0080);
    write_vram_word_direct(&mut bus, 0x0002, 0x0000);
    write_vram_word_direct(&mut bus, 0x0004, 0x0001);
    write_vram_word_direct(&mut bus, 0x0006, 0x0080);
    fill_pattern(&mut bus, 1, 1);
    fill_pattern(&mut bus, 2, 2);

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.framebuffer[0], bus.vdp.palette_color(2));
}

#[test]
fn vdp_high_priority_sprites_draw_over_high_priority_plane_pixels() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[2] = 0x38;
    bus.vdp.registers[5] = 0x00;
    bus.vdp.registers[13] = 0x3f;
    bus.vdp.cram[1] = 0x00e;
    bus.vdp.cram[2] = 0x0e0;

    let plane_a = ((bus.vdp.registers[2] as usize & 0x38) << 10) & 0xffff;
    write_vram_word_direct(&mut bus, plane_a, 0x8002);
    write_vram_word_direct(&mut bus, 0x0000, 0x0080);
    write_vram_word_direct(&mut bus, 0x0002, 0x0000);
    write_vram_word_direct(&mut bus, 0x0004, 0x8001);
    write_vram_word_direct(&mut bus, 0x0006, 0x0080);
    fill_pattern(&mut bus, 1, 1);
    fill_pattern(&mut bus, 2, 2);

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.framebuffer[0], bus.vdp.palette_color(1));
}

#[test]
fn vdp_full_screen_hscroll_is_reused_on_every_line() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[2] = 0x38;
    bus.vdp.registers[4] = 0x07;
    bus.vdp.registers[11] = 0x00;
    bus.vdp.registers[13] = 0x3f;
    bus.vdp.cram[1] = 0x00e;
    bus.vdp.cram[2] = 0x0e0;

    let plane_a = ((bus.vdp.registers[2] as usize & 0x38) << 10) & 0xffff;
    let hscroll_base = ((bus.vdp.registers[13] as usize & 0x3f) << 10) & 0xffff;
    write_vram_word_direct(&mut bus, plane_a, 0x0001);
    write_vram_word_direct(&mut bus, plane_a + 2, 0x0002);
    write_vram_word_direct(&mut bus, plane_a + 64, 0x0001);
    write_vram_word_direct(&mut bus, plane_a + 66, 0x0002);
    write_vram_word_direct(&mut bus, hscroll_base, 0x0008);
    fill_pattern(&mut bus, 1, 1);
    fill_pattern(&mut bus, 2, 2);

    bus.vdp.render_frame();

    assert_eq!(
        bus.vdp.framebuffer[8 * bus.vdp.screen_width + 8],
        bus.vdp.palette_color(1)
    );
}

#[test]
fn vdp_offscreen_sprites_consume_scanline_sprite_cell_budget() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[5] = 0x40;
    bus.vdp.registers[12] = 0x01;
    bus.vdp.cram[2] = 0x0e0;
    bus.vdp.cram[3] = 0x00e;
    let sprite_base = 0x8000;

    for index in 0..10 {
        let entry = sprite_base + index * 8;
        write_vram_word_direct(&mut bus, entry, 0x0080);
        write_vram_word_direct(&mut bus, entry + 2, 0x0f00 | (index as u16 + 1));
        write_vram_word_direct(&mut bus, entry + 4, 0x0001);
        write_vram_word_direct(&mut bus, entry + 6, 0x0050);
    }
    let visible = sprite_base + 10 * 8;
    write_vram_word_direct(&mut bus, visible, 0x0080);
    write_vram_word_direct(&mut bus, visible + 2, 0x0000);
    write_vram_word_direct(&mut bus, visible + 4, 0x0002);
    write_vram_word_direct(&mut bus, visible + 6, 0x0080);
    fill_pattern(&mut bus, 2, 2);

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.screen_width, 320);
    assert_ne!(bus.vdp.framebuffer[0], bus.vdp.palette_color(2));
}

#[test]
fn vdp_sprite_cell_limit_renders_overflowing_sprite_then_stops() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[5] = 0x40;
    bus.vdp.registers[12] = 0x01;
    bus.vdp.cram[2] = 0x0e0;
    bus.vdp.cram[3] = 0x00e;
    let sprite_base = 0x8000;

    for index in 0..9 {
        let entry = sprite_base + index * 8;
        write_vram_word_direct(&mut bus, entry, 0x0080);
        write_vram_word_direct(&mut bus, entry + 2, 0x0c00 | (index as u16 + 1));
        write_vram_word_direct(&mut bus, entry + 4, 0x0001);
        write_vram_word_direct(&mut bus, entry + 6, 0x0050);
    }
    let partial = sprite_base + 9 * 8;
    write_vram_word_direct(&mut bus, partial, 0x0080);
    write_vram_word_direct(&mut bus, partial + 2, 0x0400 | 10);
    write_vram_word_direct(&mut bus, partial + 4, 0x0001);
    write_vram_word_direct(&mut bus, partial + 6, 0x0068);

    let visible = sprite_base + 10 * 8;
    write_vram_word_direct(&mut bus, visible, 0x0080);
    write_vram_word_direct(&mut bus, visible + 2, 0x0c00 | 11);
    write_vram_word_direct(&mut bus, visible + 4, 0x0002);
    write_vram_word_direct(&mut bus, visible + 6, 0x0080);
    let blocked = sprite_base + 11 * 8;
    write_vram_word_direct(&mut bus, blocked, 0x0080);
    write_vram_word_direct(&mut bus, blocked + 2, 0x0000);
    write_vram_word_direct(&mut bus, blocked + 4, 0x0006);
    write_vram_word_direct(&mut bus, blocked + 6, 0x00a8);
    for pattern in 2..=5 {
        fill_pattern(&mut bus, pattern, 2);
    }
    fill_pattern(&mut bus, 6, 3);

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.framebuffer[0], bus.vdp.palette_color(2));
    assert_eq!(bus.vdp.framebuffer[31], bus.vdp.palette_color(2));
    assert_ne!(bus.vdp.framebuffer[40], bus.vdp.palette_color(3));
}

#[test]
fn vdp_non_interlace_sprites_wrap_y_with_nine_bits() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[5] = 0x00;
    bus.vdp.cram[2] = 0x0e0;

    write_vram_word_direct(&mut bus, 0x0000, 0x0280);
    write_vram_word_direct(&mut bus, 0x0002, 0x0000);
    write_vram_word_direct(&mut bus, 0x0004, 0x0002);
    write_vram_word_direct(&mut bus, 0x0006, 0x0080);
    fill_pattern(&mut bus, 2, 2);

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.framebuffer[0], bus.vdp.palette_color(2));
}

#[test]
fn vdp_dma_fill_writes_high_byte_to_vram_bytes() {
    let mut bus = M68kBus::new();
    const VDP_DATA: u32 = 0x00c0_0000;
    const VDP_CONTROL: u32 = 0x00c0_0004;

    bus.write_word(VDP_CONTROL, 0x8110);
    bus.write_word(VDP_CONTROL, 0x9302);
    bus.write_word(VDP_CONTROL, 0x9400);
    bus.write_word(VDP_CONTROL, 0x9780);
    bus.write_word(VDP_CONTROL, 0x4000);
    bus.write_word(VDP_CONTROL, 0x0080);
    bus.write_word(VDP_DATA, 0xabcd);

    assert_eq!(bus.vdp.vram[0], 0x00);
    assert_eq!(bus.vdp.vram[1], 0xab);
    assert_eq!(bus.vdp.vram[2], 0x00);
    assert_eq!(bus.vdp.vram[3], 0xab);
}

#[test]
fn vdp_vram_copy_dma_uses_raw_byte_source_and_updates_registers() {
    let mut bus = M68kBus::new();
    const VDP_CONTROL: u32 = 0x00c0_0004;

    bus.vdp.vram[0x0100] = 0x11;
    bus.vdp.vram[0x0101] = 0x22;
    bus.vdp.vram[0x0200] = 0x33;
    bus.vdp.vram[0x0201] = 0x44;

    bus.write_word(VDP_CONTROL, 0x8110);
    bus.write_word(VDP_CONTROL, 0x9301);
    bus.write_word(VDP_CONTROL, 0x9400);
    bus.write_word(VDP_CONTROL, 0x9500);
    bus.write_word(VDP_CONTROL, 0x9601);
    bus.write_word(VDP_CONTROL, 0x97c0);
    bus.write_word(VDP_CONTROL, 0x4004);
    bus.write_word(VDP_CONTROL, 0x0080);

    assert_eq!(bus.vdp.vram[4], 0x11);
    assert_eq!(bus.vdp.vram[5], 0x22);
    assert_eq!(bus.vdp.registers[19], 0);
    assert_eq!(bus.vdp.registers[20], 0);
    assert_eq!(bus.vdp.registers[21], 0x02);
    assert_eq!(bus.vdp.registers[22], 0x01);
}

#[test]
fn vdp_memory_dma_updates_source_and_length_registers() {
    let mut bus = M68kBus::new();
    const VDP_CONTROL: u32 = 0x00c0_0004;

    bus.write_word(0x0200, 0x000e);
    bus.write_word(0x0202, 0x00e0);
    bus.write_word(VDP_CONTROL, 0x8110);
    bus.write_word(VDP_CONTROL, 0x9302);
    bus.write_word(VDP_CONTROL, 0x9400);
    bus.write_word(VDP_CONTROL, 0x9500);
    bus.write_word(VDP_CONTROL, 0x9601);
    bus.write_word(VDP_CONTROL, 0x9700);
    bus.write_word(VDP_CONTROL, 0xc000);
    bus.write_word(VDP_CONTROL, 0x0080);

    assert_eq!(bus.vdp.cram[0], 0x000e);
    assert_eq!(bus.vdp.cram[1], 0x00e0);
    assert_eq!(bus.vdp.registers[19], 0);
    assert_eq!(bus.vdp.registers[20], 0);
    assert_eq!(bus.vdp.registers[21], 0x02);
    assert_eq!(bus.vdp.registers[22], 0x01);
}

#[test]
fn vdp_prohibited_plane_size_uses_single_cell_vertical_wrap() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[2] = 0x38;
    bus.vdp.registers[4] = 0x00;
    bus.vdp.registers[16] = 0x02;
    bus.vdp.cram[1] = 0x00e;
    bus.vdp.cram[2] = 0x0e0;

    let plane_a = ((bus.vdp.registers[2] as usize & 0x38) << 10) & 0xffff;
    write_vram_word_direct(&mut bus, plane_a, 0x0001);
    write_vram_word_direct(&mut bus, plane_a + 64 * 2, 0x0002);
    fill_pattern(&mut bus, 1, 1);
    fill_pattern(&mut bus, 2, 2);

    bus.vdp.render_frame();

    assert_eq!(
        bus.vdp.framebuffer[8 * bus.vdp.screen_width],
        bus.vdp.palette_color(1)
    );
}

#[test]
fn vdp_interlace_mode_2_scroll_tiles_use_sixteen_pixel_rows() {
    let mut bus = M68kBus::new();
    bus.vdp.registers[1] = 0x40;
    bus.vdp.registers[2] = 0x30;
    bus.vdp.registers[4] = 0x00;
    bus.vdp.registers[12] = 0x87;
    bus.vdp.cram[2] = 0x0e0;

    let plane_a = ((bus.vdp.registers[2] as usize & 0x38) << 10) & 0xffff;
    write_vram_word_direct(&mut bus, plane_a, 0x0001);
    bus.vdp.vram[0x0060] = 0x22;
    bus.vdp.vram[0x0061] = 0x22;
    bus.vdp.vram[0x0062] = 0x22;
    bus.vdp.vram[0x0063] = 0x22;

    bus.vdp.render_frame();

    assert_eq!(bus.vdp.screen_width, 320);
    assert_eq!(bus.vdp.screen_height, 448);
    assert_eq!(bus.vdp.framebuffer[8 * 320], bus.vdp.palette_color(2));
}

fn write_vram_word_direct(bus: &mut M68kBus, address: usize, value: u16) {
    bus.vdp.vram[address & 0xffff] = (value >> 8) as u8;
    bus.vdp.vram[(address ^ 1) & 0xffff] = value as u8;
}

fn fill_pattern(bus: &mut M68kBus, pattern: usize, color: u8) {
    let packed = (color & 0x0f) * 0x11;
    let base = pattern * 32;
    for offset in 0..32 {
        bus.vdp.vram[(base + offset) & 0xffff] = packed;
    }
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
fn ym2612_timers_use_144_cycle_tick_and_gate_status_flags() {
    let mut ym = Ym2612::new();
    ym.write_address_1(0x24);
    ym.write_data(0xff, 0, None);
    ym.write_address_1(0x25);
    ym.write_data(0x03, 0, None);
    ym.write_address_1(0x27);
    ym.write_data(0x01, 0, None);

    ym.tick(Ym2612::TIMER_TICK_CYCLES);
    assert_eq!(ym.read_register(0) & 0x01, 0);

    ym.write_address_1(0x27);
    ym.write_data(0x05, 0, None);
    ym.tick(Ym2612::TIMER_TICK_CYCLES - 1);
    assert_eq!(ym.read_register(0) & 0x01, 0);
    ym.tick(1);
    assert_eq!(ym.read_register(0) & 0x01, 0x01);
}

#[test]
fn ym2612_audio_render_does_not_roll_back_live_busy_state() {
    let mut ym = Ym2612::new();
    ym.begin_frame();
    ym.write_address_1(0xa0);
    ym.write_data(0x34, 0, None);
    ym.tick(Ym2612::WRITE_BUSY_CYCLES);

    let _ = ym.render_frame_mono_samples(64, 1_000.0, 44_100);

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

#[test]
fn mega_drive_sram_header_maps_and_persists_beside_rom() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let rom_path = std::env::temp_dir().join(format!(
        "euther_oxide_sram_{}_{}.md",
        std::process::id(),
        suffix
    ));
    let srm_path = rom_path.with_extension("srm");
    let _ = fs::remove_file(&srm_path);

    let mut rom = vec![0; 0x200];
    rom[0x000..0x004].copy_from_slice(&0x00ff_0000u32.to_be_bytes());
    rom[0x004..0x008].copy_from_slice(&0x0000_0100u32.to_be_bytes());
    rom[0x100..0x104].copy_from_slice(b"SEGA");
    rom[0x1b0..0x1bc].copy_from_slice(&[
        b'R', b'A', 0xf8, 0x20, 0x00, 0x20, 0x00, 0x01, 0x00, 0x20, 0x00, 0x0f,
    ]);
    fs::write(&rom_path, &rom).unwrap();

    let mut emulator = Emulator::new();
    emulator.load_rom_file(&rom_path).unwrap();
    assert_eq!(emulator.bus.sram_path(), Some(srm_path.as_path()));
    assert_eq!(emulator.bus.read_byte(0x0020_0001), 0xff);
    emulator.bus.write_byte(0x00a1_30f1, 0x01);
    emulator.bus.write_byte(0x0020_0001, 0x42);
    emulator.bus.write_byte(0x0020_0002, 0x24);
    emulator.bus.flush_sram().unwrap();

    assert_eq!(fs::read(&srm_path).unwrap()[0], 0x42);

    let mut reloaded = Emulator::new();
    reloaded.load_rom_file(&rom_path).unwrap();
    reloaded.bus.write_byte(0x00a1_30f1, 0x01);
    assert_eq!(reloaded.bus.read_byte(0x0020_0001), 0x42);
    assert_eq!(reloaded.bus.read_byte(0x0020_0002), 0xff);

    let _ = fs::remove_file(&srm_path);
    let _ = fs::remove_file(&rom_path);
}

#[test]
fn mega_drive_without_sram_header_does_not_shadow_rom_mirror() {
    let mut rom = vec![0; 0x20_0000];
    rom[0x000..0x004].copy_from_slice(&0x00ff_0000u32.to_be_bytes());
    rom[0x004..0x008].copy_from_slice(&0x0000_0100u32.to_be_bytes());
    rom[0x100..0x104].copy_from_slice(b"SEGA");
    rom[0] = 0x42;

    let mut bus = M68kBus::new();
    bus.load_rom(rom);

    assert_eq!(bus.sram_path(), None);
    assert_eq!(bus.read_byte(0x0020_0000), 0x42);
}

#[test]
fn mega_drive_sram_latch_accepts_word_and_long_accesses() {
    let mut bus = M68kBus::new();
    bus.load_rom(vec![0; 0x200]);
    bus.write_byte(0x00a1_30f1, 0x00);

    assert_eq!(bus.read_word(0x00a1_30f0), 0x0000);
    bus.write_word(0x00a1_30f0, 0x0001);
    assert_eq!(bus.read_byte(0x00a1_30f1), 0x01);
    assert_eq!(bus.read_word(0x00a1_30f0), 0x0101);
    assert_eq!(bus.read_long(0x00a1_30ee), 0x0101_0101);

    bus.write_long(0x00a1_30ee, 0x0000_0000);
    assert_eq!(bus.read_word(0x00a1_30f0), 0x0000);
}

fn paprium_test_rom() -> Vec<u8> {
    let mut rom = vec![0; 0x1_0000];
    rom[0x100..0x104].copy_from_slice(b"SEGA");
    rom[0x183..0x183 + b"T-574120-00".len()].copy_from_slice(b"T-574120-00");
    rom[0xc000] = 0xab;
    rom[0xc001] = 0xcd;
    rom
}

#[test]
fn paprium_override_maps_registers_before_plain_rom() {
    let mut bus = M68kBus::new();
    bus.load_rom(paprium_test_rom());

    assert_eq!(bus.read_word(0x0000_c000), 0xabcd);
    assert_eq!(bus.read_word(0x0000_1fe4), 0xffbb);
    assert_eq!(bus.read_word(0x0000_1fe6), 0xbcff);
    assert_eq!(bus.read_word(0x0000_1fea), 0x7fff);

    bus.write_word(0x0000_0100, 0x1234);
    assert_eq!(bus.read_word(0x0000_0100), 0x1234);
    bus.write_byte(0x0000_0101, 0xab);
    assert_eq!(bus.read_word(0x0000_0100), 0x12ab);

    bus.write_word(0x0000_1fea, 0x8100);
    assert_eq!(bus.read_word(0x0000_c000), 0x0000);
    bus.write_word(0x0000_1fea, 0x8400);
    assert_eq!(bus.read_word(0x0000_c000), 0xabcd);
}

#[test]
fn paprium_override_persists_nvram_beside_rom() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let rom_path = std::env::temp_dir().join(format!(
        "euther_oxide_paprium_{}_{}.md",
        std::process::id(),
        suffix
    ));
    let srm_path = rom_path.with_file_name(format!(
        "{}.paprium.srm",
        rom_path.file_stem().unwrap().to_string_lossy()
    ));
    let _ = fs::remove_file(&srm_path);
    fs::write(&rom_path, paprium_test_rom()).unwrap();

    let mut bus = M68kBus::new();
    bus.load_rom_with_path(fs::read(&rom_path).unwrap(), Some(rom_path.clone()));
    assert_eq!(bus.paprium_save_path(), Some(srm_path.as_path()));
    bus.write_word(0x0000_0400, 0xbeef);
    bus.write_word(0x0000_1e12, 0x0400);
    bus.write_word(0x0000_1fea, 0xe004);
    bus.flush_cartridge_override().unwrap();
    assert_eq!(&fs::read(&srm_path).unwrap()[0..2], &[0xbe, 0xef]);

    let mut reloaded = M68kBus::new();
    reloaded.load_rom_with_path(fs::read(&rom_path).unwrap(), Some(rom_path.clone()));
    reloaded.write_word(0x0000_1e10, 0x0500);
    reloaded.write_word(0x0000_1fea, 0xdf04);
    assert_eq!(reloaded.read_word(0x0000_0500), 0xbeef);

    let _ = fs::remove_file(&srm_path);
    let _ = fs::remove_file(&rom_path);
}

#[test]
fn argon_savestate_round_trips_emulator_state() {
    let mut rom = vec![0; 0x200];
    rom[0x000..0x004].copy_from_slice(&0x00ff_0000u32.to_be_bytes());
    rom[0x004..0x008].copy_from_slice(&0x0000_0120u32.to_be_bytes());
    rom[0x100..0x104].copy_from_slice(b"SEGA");
    rom[0x120] = 0x70;
    rom[0x121] = 0x01;

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let rom_path = std::env::temp_dir().join(format!(
        "euther_oxide_savestate_{}_{}.md",
        std::process::id(),
        suffix
    ));
    let argon_path = argon_path_for_rom(&rom_path);
    let _ = fs::remove_file(&argon_path);
    fs::write(&rom_path, rom).unwrap();

    let mut emulator = Emulator::new();
    emulator.load_rom_file(&rom_path).unwrap();
    emulator.cpu.step(&mut emulator.bus).unwrap();
    emulator.frame_count = 7;

    let summary = save_slot_for_emulator(&emulator, 1).unwrap();
    assert!(summary.slots[0].occupied);
    assert!(!summary.slots[1].occupied);

    emulator.cpu.d[0] = 0xfeed_beef;
    emulator.frame_count = 99;
    load_slot_for_emulator(&mut emulator, 1).unwrap();

    assert_eq!(emulator.cpu.d[0], 1);
    assert_eq!(emulator.frame_count, 7);

    let _ = fs::remove_file(argon_path);
    let _ = fs::remove_file(rom_path);
}
