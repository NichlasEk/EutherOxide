# EutherHost Remote Multiplayer Plan

## Vision

EutherHost can become a small private couch-coop server: two authenticated users join the same running emulator session from different machines, each client owns a different controller port, and the server remains the single source of truth for game state, video, audio, saves, and input timing.

The first target is not rollback netcode or internet-grade fighting-game precision. The target is practical two-player Mega Drive play over LAN and friendly WAN links, with simple session rules and predictable input ownership.

## Core Idea

The server runs one emulator instance per active play session. Browsers never advance the emulator directly. They only send input events and receive the same canonical output stream.

```text
EutherHost session
 ├─ Emulator core
 ├─ Input mixer
 │   ├─ player 1: user/session A
 │   └─ player 2: user/session B
 ├─ Video/audio broadcaster
 ├─ Save-state owner rules
 └─ Spectator/status clients
```

This avoids the current dangerous case where two browser UIs both pull frames and accidentally make the shared core run twice as hard or desync audio pacing.

## First Usable Version

1. Add session ownership.
   - A session has exactly one emulator clock.
   - Only the server run loop advances frames.
   - Clients subscribe to output instead of requesting frame advancement.

2. Add player slots.
   - Authenticated users can claim `p1` or `p2`.
   - Each slot maps to a distinct controller input state.
   - A user can release a slot or be timed out after disconnect.

3. Add spectator mode.
   - Extra logged-in clients can watch status/video without sending input.
   - Spectators cannot pause, reset, load ROMs, or mutate saves unless promoted.

4. Add host controls.
   - Session owner chooses ROM, reset, pause, save/load.
   - Optional setting: allow `p2` to pause.

5. Keep audio simple at first.
   - One active audio listener should be preferred by default.
   - Other clients can mute automatically or choose audio manually.
   - Later, each client can receive its own jitter-buffered audio stream.

## Input Model

Each client sends compact input snapshots with a monotonically increasing client sequence number:

```json
{
  "session": "alkene-7f3c",
  "player": 1,
  "seq": 1842,
  "buttons": {
    "up": false,
    "down": false,
    "left": true,
    "right": false,
    "a": true,
    "b": false,
    "c": false,
    "start": false
  }
}
```

The server keeps the latest valid snapshot for each player slot and samples those snapshots once per emulated frame.

For the first version, late packets simply affect the next frame. This keeps implementation understandable and avoids premature rollback complexity.

## Sync Strategy

Use server-authoritative lockstep:

- The server owns frame pacing.
- The server samples the latest `p1` and `p2` inputs at frame start.
- The server advances exactly one frame.
- The server broadcasts frame metadata, video, and audio.
- Clients never call `run_frame` endpoints directly during multiplayer.

This is simple and robust. It adds input latency equal to network delay plus the server frame boundary, but it prevents divergent state.

## Transport Sketch

Short term:

- WebSocket for input, session events, chat/status, and ownership.
- Existing HTTP stream can continue for video/audio while the model stabilizes.

Better version:

- One WebSocket or WebTransport channel for control/input.
- One audio stream with priority.
- One video stream that can drop frames.
- Optional WebRTC data/video/audio later if WAN streaming needs lower latency and better congestion control.

## TOML Configuration

```toml
[host.multiplayer]
enabled = false
max_players = 2
allow_spectators = true
spectator_limit = 4
slot_timeout_seconds = 20
owner_required_for_rom_load = true
owner_required_for_reset = true
allow_player_pause = false

[host.multiplayer.audio]
default_policy = "owner_only" # owner_only | all_muted | per_client
mobile_lead_ms = 240
desktop_lead_ms = 140

[host.multiplayer.session]
default_visibility = "private"
invite_codes = true
```

## UI Shape

The lobby should stay in the current chemistry theme:

- `Reaction Vessel`: active play session.
- `Catalyst Slots`: player 1 and player 2 claims.
- `Observer Layer`: spectators.
- `Input Reagent`: selected keyboard/gamepad/touch profile.

Expected controls:

- Claim P1
- Claim P2
- Release slot
- Invite link
- Mute local audio
- Spectate
- Host reset
- Host pause

## Safety Rules

- One emulator clock per session.
- One user owns one controller slot at a time.
- Only the session owner can load ROMs by default.
- ROM file paths and directory listings stay server-side and authenticated.
- Save/load actions must be owner-only until permission rules exist.
- Disconnects clear input state immediately so stuck buttons do not persist.
- Input packets from non-owners are ignored.

## Technical Milestones

1. Refactor bridge run loop into a server-owned session loop.
2. Replace frame-pulling clients with output subscribers.
3. Add `p1` and `p2` input states to the emulator bridge.
4. Add session/player slot endpoints.
5. Add spectator-safe UI state.
6. Add two-player input mapping in the web UI.
7. Add LAN test page for two browsers on the same machine.
8. Add WAN tolerance work: audio priority, video frame dropping, reconnect handling.

## Open Questions

- Should a single logged-in user be allowed to claim both P1 and P2 for testing?
- Should mobile clients default to touch controls only after claiming a player slot?
- Should save states record which users were in the session?
- Should remote multiplayer be disabled per ROM/system until the core has stable two-controller support?
- Should the first WAN version recommend Caddy HTTPS plus private invite links only?

## Recommended Next Step

Before adding true two-player remote play, make the current bridge server session-owned even for one player. That solves the current multi-UI contention problem and creates the exact foundation multiplayer needs.
