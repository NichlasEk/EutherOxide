# EutherDoom Server

Small isolated crate for the EutherDoom two-player server experiments.

This crate is intentionally not wired into the main emulator binary yet. Work in
this folder when developing the Doom server on a separate machine to avoid git
conflicts with the larger emulator and web UI files.

Run from the repository root:

```sh
cargo test --manifest-path crates/eutherdoom-server/Cargo.toml
```

Or run from this directory:

```sh
cargo test
```

Current scope:

- Two player slots.
- Ready/heartbeat state.
- Doom-style lockstep `TicCommand` submission.
- Ordered `TicFrame` completion.
- Timeout fallback for a missing player command.
