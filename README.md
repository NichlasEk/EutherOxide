# EutherOxide

EutherOxide is a headless Rust Mega Drive core built from the local EutherDrive and EutherMaster references.

EutherDogs is now part of EutherOxide. It is a new Rust game core inspired by the old Cyberdogs source, rebuilt with a pharmacy cyberpunk theme, new placeholder assets, and a renderer-independent simulation layer for further development inside this repo.

Current scope:

- Mega Drive ROM normalization, SMD deinterleave, header/region detection.
- 68k reset, stack, control flow, common data movement, arithmetic, bit, branch, and loop opcodes.
- 24-bit Mega Drive bus with ROM, 64 KB WRAM, Z80 window/control registers, controllers, VDP ports, PSG, and YM2612 routing.
- VDP register/data/control path, CRAM/VRAM/VSRAM writes, interrupts, HV counter, and a fast scroll-plane renderer.
- PSG and pragmatic YM2612 synthesis paths for headless audio jobs.
- CLI for loading a ROM, running frames, and dumping a PPM frame.
- EutherDogs core under `crates/eutherdogs-core`, with placeholder assets under `assets/eutherdogs`.

Run:

```sh
cargo test
cargo run --release -- path/to/game.md --frames 1 --dump frame.ppm
cargo run --bin euther-oxide -- --eutherdogs-demo
```

UI:

```sh
npm install
npm run dev
npm run tauri dev
```

`npm run dev` starts the TypeScript WebView as a browser app. `npm run tauri dev`
starts the same UI inside Tauri 2 with native Rust emulator commands.

The core is intentionally dependency-free so it can build offline and stay portable.
