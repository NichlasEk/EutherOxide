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

Run the debug TCP server from the repository root:

```sh
cargo run --manifest-path crates/eutherdoom-server/Cargo.toml --bin eutherdoom-debug-server
```

It binds to `127.0.0.1:32666` by default. To bind on the LAN server:

```sh
cargo run --manifest-path crates/eutherdoom-server/Cargo.toml --bin eutherdoom-debug-server -- 0.0.0.0:32666
```

Open two test clients:

```sh
nc 127.0.0.1 32666
```

Client 1:

```text
join nichlas
ready
cmd 0 10 0 0 1 0
```

Client 2:

```text
join player2
ready
cmd 0 -4 0 0 0 0
```

Both clients should receive:

```text
TIC 0 P1 10 0 0 1 0 P2 -4 0 0 0 0
```

Current scope:

- Two player slots.
- Ready/heartbeat state.
- Doom-style lockstep `TicCommand` submission.
- Ordered `TicFrame` completion.
- Timeout fallback for a missing player command.
- Debug TCP server with a tiny text protocol.
