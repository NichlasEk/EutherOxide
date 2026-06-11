# EutherAlert OpenRA Adapter

This directory contains the EutherAlert touch bridge adapter scaffolding.

OpenRA itself remains outside this repository under `.euther-openra/OpenRA`.
EutherOxide owns the mobile protocol and host bridge. The OpenRA-side adapter
consumes newline-delimited JSON touch events and translates them into OpenRA
client input or OpenRA order APIs.

## Runtime Contract

Set:

```sh
EUTHERALERT_TOUCH_BRIDGE_CMD="tools/eutheralert-openra-adapter/jsonl_probe.py /tmp/eutheralert-touch.jsonl"
```

EutherHost starts the command once and writes one `HostAlertTouchEvent` JSON
object per line to stdin.

The default command is `jsonl_probe.py`, which appends stdin events to
`.euther-host/openra-alert/<instance>/touch-events.jsonl`. The installed
OpenRA-side adapter tails that file via:

```sh
EUTHERALERT_TOUCH_BRIDGE_FILE=".euther-host/openra-alert/<instance>/touch-events.jsonl"
EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG=".euther-host/openra-alert/<instance>/touch-applied.jsonl"
```

`EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG` is optional and records compact receipts
after OpenRA has translated an event into synthetic input.

Minimal event shape:

```json
{
  "id": 1,
  "unix_ms": 1781160000000,
  "instance": "alert-2",
  "client": "browser-client-id",
  "player": 1,
  "kind": "tap",
  "payload": {
    "normalizedX": 0.42,
    "normalizedY": 0.55,
    "worldX": 840,
    "worldY": 510
  }
}
```

## Files

- `jsonl_probe.py`: debugging adapter that records touch events to JSONL.
- `openra-side/EutherAlertTouchBridge.cs`: GPL-3.0-or-later OpenRA-side input
  wrapper. It is installed into the external OpenRA checkout, not compiled into
  EutherOxide. The wrapper drains the touch file once per rendered frame from
  `Renderer.EndFrame(...)`.

## Long-Term Shape

1. Keep EutherOxide as the auth/vessel/mobile UI host.
2. Keep OpenRA as an external GPL runtime.
3. Install the OpenRA-side adapter into `OpenRA.Game/EutherAlert` in the
   external checkout when we need direct access to OpenRA input/order APIs.
