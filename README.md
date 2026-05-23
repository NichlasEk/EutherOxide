# EutherOxide

EutherOxide is a headless Rust Mega Drive core built from the local EutherDrive and EutherMaster references.

Current scope:

- Mega Drive ROM normalization, SMD deinterleave, header/region detection.
- 68k reset, stack, control flow, common data movement, arithmetic, bit, branch, and loop opcodes.
- 24-bit Mega Drive bus with ROM, 64 KB WRAM, Z80 window/control registers, controllers, VDP ports, PSG, and YM2612 routing.
- VDP register/data/control path, CRAM/VRAM/VSRAM writes, interrupts, HV counter, and a fast scroll-plane renderer.
- PSG and pragmatic YM2612 synthesis paths for headless audio jobs.
- CLI for loading a ROM, running frames, and dumping a PPM frame.

Run:

```sh
cargo test
cargo run --release -- path/to/game.md --frames 1 --dump frame.ppm
```

The core is intentionally dependency-free so it can build offline and stay portable.

