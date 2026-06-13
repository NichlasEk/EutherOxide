# EutherAlert OpenRA Integration

EutherAlert should use real OpenRA for Red Alert rules, economy, multiplayer,
replays, and content handling. The browser prototype under
`webview/public/eutheralert` is only a controller shell and fallback skirmish
surface.

## Runtime Shape

- OpenRA is C#/.NET 8 using SDL/OpenGL and is GPL-3.0-or-later.
- EutherOxide keeps OpenRA as an external runtime process instead of copying or
  linking OpenRA code into the MIT Rust binary.
- Runtime path defaults to `.euther-openra/OpenRA`.
- Override with `EUTHERALERT_OPENRA_PATH=/path/to/OpenRA`.
- Local .NET path defaults to `.euther-openra/dotnet`.
- OpenRA release `release-20250330` builds with .NET 8 SDK but runs the server
  on `Microsoft.NETCore.App 6.x`, so the bootstrap installs both locally.
- Dedicated server port defaults to `32170`.
- Override with `EUTHERALERT_OPENRA_PORT=32170`.
- The host-rendered OpenRA client defaults SDL audio to PipeWire with
  `SDL_AUDIODRIVER=pipewire`.
- Override the SDL audio backend with `EUTHERALERT_SDL_AUDIODRIVER=<backend>`.
- EutherHost creates a per-instance PipeWire null sink and points OpenRA at it
  with `PIPEWIRE_NODE=<sink>`.
- EutherHost no longer creates PulseAudio null sinks or calls `pactl`.

## Bootstrap

```sh
scripts/eutheralert-openra-runtime.sh
```

The script clones OpenRA at `release-20250330` by default and builds it with
`make`. Override the ref with:

```sh
EUTHERALERT_OPENRA_REF=bleed scripts/eutheralert-openra-runtime.sh
```

## EutherHost API

- `GET /api/eutheralert/openra/status`
- `POST /api/eutheralert/openra/start?instance=<id>`
- `POST /api/eutheralert/openra/stop?instance=<id>`
- `GET /api/eutheralert/openra/client/status`
- `POST /api/eutheralert/openra/client/start?instance=<id>`
- `POST /api/eutheralert/openra/client/stop?instance=<id>`
- `POST /api/eutheralert/touch?instance=<id>&client=<client-id>`
- `GET /api/eutheralert/touch/events?instance=<id>&after=<event-id>`

`start` launches OpenRA's `launch-dedicated.sh` with `Mod=ra`,
`AdvertiseOnLocalNetwork=True`, `AdvertiseOnline=False`, and an isolated
support directory under `.euther-host/openra-alert/<instance>`.

`client/start` launches OpenRA's `launch-game.sh` with `Game.Mod=ra` and
`Launch.URI=tcp://127.0.0.1:<port>`, plus a client-specific
`Engine.SupportDir` under `.euther-host/openra-alert/<instance>/client`.
The EutherAlert panel exposes separate Start Server, Start Client, Stop Client,
and Stop Server buttons so the host-rendered client can be controlled without
mixing it with the dedicated server process.

Red Alert requires original/freeware artwork and audio before the GUI client can
enter the game. Install OpenRA's verified quickinstall package into the client
support directory with:

```sh
EUTHERALERT_OPENRA_CONTENT_OWNER=nobody:nogroup \
  scripts/eutheralert-install-ra-content.sh .euther-host/openra-alert/alert-2/client
```

## Touch Command Bridge

The browser vessel posts normalized touch commands to EutherHost. EutherHost
validates that the caller owns the requested P1/P2 slot before accepting the
event.

Accepted touch `kind` values:

- `tap`
- `doubleTap`
- `dragStart`
- `dragMove`
- `dragEnd`
- `pinch`
- `key`
- `cancel`

Every accepted event is stored in a small event log and can be consumed through
`/api/eutheralert/touch/events`.

For native injection, set:

```sh
EUTHERALERT_TOUCH_BRIDGE_CMD="/path/to/injector"
```

The injector receives one JSON `HostAlertTouchEvent` on stdin and should convert
it into OpenRA client input. EutherHost keeps the command running and writes one
JSON object per line. This keeps OpenRA GPL code external while letting
EutherOxide own the mobile gesture protocol.

Debug probe:

```sh
EUTHERALERT_TOUCH_BRIDGE_CMD="tools/eutheralert-openra-adapter/jsonl_probe.py /tmp/eutheralert-touch.jsonl"
```

When using the OpenRA-side adapter, EutherHost also sets:

```sh
EUTHERALERT_TOUCH_BRIDGE_FILE=".euther-host/openra-alert/<instance>/touch-events.jsonl"
EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG=".euther-host/openra-alert/<instance>/touch-applied.jsonl"
```

The apply log is a debug receipt written by the OpenRA-side adapter after it has
read and translated an event.

Install the OpenRA-side adapter into the external checkout:

```sh
scripts/eutheralert-install-openra-adapter.sh
```

The installer:

- copies `EutherAlertTouchBridge.cs` into `OpenRA.Game/EutherAlert`;
- patches `OpenRA.Game/Game.cs` so `Renderer.EndFrame(...)` wraps
  `DefaultInputHandler` with `OpenRA.EutherAlert.EutherAlertTouchBridge`;
- leaves all modified OpenRA files in the external `.euther-openra/OpenRA`
  checkout.

Default bridge flow:

1. EutherHost accepts mobile touch events.
2. EutherHost writes JSONL through `jsonl_probe.py` to
   `.euther-host/openra-alert/<instance>/touch-events.jsonl`.
3. The OpenRA-side input wrapper tails `EUTHERALERT_TOUCH_BRIDGE_FILE` once per
   rendered frame.
4. The wrapper converts events to synthetic OpenRA `MouseInput`/`KeyInput`
   values before delegating normal input.
5. The wrapper appends a compact receipt to `EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG`
   when it applies an event.

## Next Work

1. Smoke-test the per-instance PipeWire sink capture on the host and confirm the
   MP4 stream carries OpenRA audio without PulseAudio server packages.
2. Run the GUI client smoke test from a desktop session with DISPLAY/Wayland or
   Xvfb available, then confirm `touch-applied.jsonl` receives phone taps.
3. Decide whether to keep synthetic input for the first playable milestone or
   move directly to OpenRA order API calls for cleaner command semantics.
4. Add client discovery instructions for phones on the LAN.
5. Replace fallback JS RTS rules once OpenRA client/render path is operational.
