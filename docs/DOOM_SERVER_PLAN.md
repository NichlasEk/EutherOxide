# EutherDoom Server Plan

Goal: make classic Doom-style games playable online through EutherHost with two
players, while keeping the server code ours and the game data legally clean.

## First Target

Build a small EutherDoom server that coordinates a two-player match using
Doom-style lockstep input:

- Clients run the game simulation.
- Each client sends one compact input command per game tic.
- The server assigns player slots, orders commands by tic, and broadcasts the
  full tic command set to both clients.
- A match advances only when both player commands for the tic are available, or
  when a configured timeout produces a neutral/repeated command.

This is the best first step because Doom's original networking model is based on
syncing player commands, not streaming a full authoritative world every frame.

## Legal And Asset Boundary

- The original Doom engine source is available, but bringing GPL engine code
  directly into this MIT repo would affect the licensing of the combined code.
- The original commercial WAD files are not free and should remain user-provided.
- Freedoom is the preferred test data for a fully free development path.

For now, keep EutherDoom server code clean and independent. If we later use an
existing Doom engine, keep that engine as a separate optional process or clearly
document the licensing boundary before merging it into this repository.

## MVP Protocol

Use a simple WebSocket or HTTP-upgrade protocol first:

- `create_match`: creates a two-player lobby.
- `join_match`: joins player 1 or player 2.
- `ready`: marks the client loaded and ready.
- `ticcmd`: submits input for a specific tic.
- `tic`: server broadcast containing both players' commands for that tic.
- `heartbeat`: keeps the slot alive and measures rough latency.
- `leave`: releases a player slot.

The first command payload can be small and explicit:

```text
tic: u32
forward: i8
strafe: i8
turn: i16
buttons: u16
weapon: u8
```

## Integration With EutherHost

Add Doom as a sibling mode to the current hosted emulator sessions:

- EutherHost owns accounts, HTTPS, lobby pages, and match creation.
- EutherDoom owns only two-player Doom match state and tic command relay.
- The web UI can show Doom matches beside emulator/EutherDogs sessions.
- The server should support LAN first, then public hosting through the existing
  `apothictech.se` Caddy path.

## Milestones

1. Add a tiny in-memory Doom match server with two player slots and tic relay.
2. Add a debug HTML client that sends fake tic commands and verifies both clients
   receive identical ordered tic frames.
3. Add match timeout and disconnect cleanup.
4. Connect a minimal Doom-compatible client loop using Freedoom data.
5. Add replay logging so a desync can be reproduced from recorded tic commands.

## Non-Goals For MVP

- No custom Doom renderer yet.
- No original WAD distribution.
- No compatibility with every existing source port protocol.
- No server-authoritative monster/world simulation until lockstep works.
