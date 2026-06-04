# EutherDuke Plan

## Goal

Build EutherDuke as a real Build-engine vessel, not a DOSBox wrapper.

The first foundation pass adds a dedicated EutherDuke route and runtime mount. The actual
EDuke32/WebAssembly runtime and Duke game data stay outside git.

## Runtime Model

- Runtime mount: `/eutherduke-runtime/`
- Default filesystem root: `/home/nichlas/eutherduke-runtime`
- Override env var: `EUTHERDUKE_RUNTIME_PATH`
- Expected entrypoint: `/home/nichlas/eutherduke-runtime/index.html`
- Current external runtime files:
  - `/home/nichlas/eutherduke-runtime/index.html`
  - `/home/nichlas/eutherduke-runtime/eduke32.js`
  - `/home/nichlas/eutherduke-runtime/eduke32.wasm`

The external runtime directory can contain generated files such as `.wasm`, `.data`,
JavaScript loaders, config, and legal Duke data. Do not commit those blobs to this repo.

## Candidate Runtime

Primary target: EDuke32 compiled with Emscripten/WebAssembly.

Why:

- EDuke32 is a mature Duke Nukem 3D source port.
- It gives better control over render, input, audio, config, and later save handling than
  a DOSBox bundle.
- It keeps EutherDuke on the "real engine vessel" path.

Current external source checkout:

- `/home/nichlas/eutherduke-source/eduke32`
- Upstream: `https://voidpoint.io/terminx/eduke32.git`
- Emscripten config: `/home/nichlas/.emscripten-eutherduke`
- Emscripten cache: `/home/nichlas/.cache/emscripten`

Current build profile:

```sh
EM_CONFIG=/home/nichlas/.emscripten-eutherduke emmake make -C /home/nichlas/eutherduke-source/eduke32 eduke32 \
  CC=emcc CXX=em++ L_CC=emcc L_CXX=em++ CLANGNAME=emcc \
  AR=emar RANLIB=emranlib STRIP= \
  PLATFORM=LINUX SUBPLATFORM=EMSCRIPTEN \
  COMPILERTARGET=wasm32-unknown-emscripten IMPLICIT_ARCH=wasm32 \
  RELEASE=1 DEBUGANYWAY=0 NETCODE=0 STARTUP_WINDOW=0 \
  USE_OPENGL=0 POLYMER=0 USE_LIBVPX=0 USE_MIMALLOC=0 \
  HAVE_VORBIS=0 HAVE_FLAC=0 HAVE_XMP=0 SDL_STATIC=0 \
  LTO=0 \
  CUSTOMOPT='-DB_LITTLE_ENDIAN=1 -DB_BIG_ENDIAN=0' \
  LDFLAGS='-sUSE_SDL=2 -sALLOW_MEMORY_GROWTH=1 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072 -sMODULARIZE=1 -sEXPORT_NAME=EutherDukeModule -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain'
```

The current runtime is single-threaded. That avoids the browser `SharedArrayBuffer` and
`crossOriginIsolated` requirement, which is important for LAN HTTP testing. The external
EDuke32 checkout has a local Common.mak patch that skips `LIBS += -pthread` when
`SUBPLATFORM=EMSCRIPTEN`.

## External EDuke32 Patches

These patches live in `/home/nichlas/eutherduke-source/eduke32` and are not tracked by
this repository. Reapply them when moving the runtime build to a new machine.

- `Common.mak`: skip `LIBS += -pthread` for `SUBPLATFORM=EMSCRIPTEN`.
  This keeps the build single-threaded so LAN HTTP can run without SharedArrayBuffer.
- `source/build/src/baselayer.cpp`: skip the stdout/stderr `FILE` struct copy on
  Emscripten.
  The desktop hack is not valid in wasm.
- `source/build/src/compat.cpp`: make `Bgethomedir()` return `/home/web_user` on
  Emscripten.
  EDuke32 should not depend on a desktop `$HOME`.
- `source/build/src/sdlayer.cpp`: do not include/use `execinfo.h` backtrace support on
  Emscripten.
  The browser target does not provide that desktop API.
- `source/audiolib/src/drivers.cpp` and `source/audiolib/src/fx_man.cpp`: guard ALSA
  includes and driver entries out for Emscripten.
  Browser audio goes through SDL's Emscripten backend.
- `source/duke3d/src/premap.cpp`: skip the blocking `skill_voice` wait loop on
  Emscripten.
  The browser audio callback can start asynchronously; waiting synchronously can stall
  startup.
- `source/duke3d/src/game.cpp`: include `<emscripten.h>` and call
  `emscripten_sleep(16)` once per main-loop iteration under `__EMSCRIPTEN__`.
  EDuke32's native loop is `while (1)`; with `ASYNCIFY` this yields to the browser so
  rendering, input, audio, and logging can keep moving.
- The Emscripten link step uses `-sASYNCIFY_STACK_SIZE=131072`.
  The default Asyncify stack is too small for EDuke32's deep level-start call path and
  can freeze silently around the first browser yield/rewind.
- `source/duke3d/src/game.cpp`: after `CONFIG_ReadSettings()`, explicitly execute
  `/settings.cfg` and `/home/web_user/settings.cfg` on Emscripten, then enable mouse,
  speech, and ambience while keeping joystick off. The desktop setup-window path can
  otherwise skip the runtime settings file.
- `source/build/src/baselayer.cpp`: make `engineFPSLimit()` return immediately under
  Emscripten and let the browser-yielding main loop provide pacing. The desktop limiter
  was the Hollywood Holocaust freeze point.
- `source/duke3d/src/cmdline.cpp` and `cmdline.h`: add `-ep1`/`-ep2` as a local
  EutherDuke-only wasm player selector for fake multiplayer proof-of-concepts.
- `source/duke3d/src/game.cpp`: when fake multiplayer is active under Emscripten, set
  `myconnectindex` and `screenpeek` from the `-epN` selector so one browser runtime can
  be started as P1 or P2.
- `source/duke3d/src/gameexec.cpp`: under Emscripten, `resetplayer` currently suppresses
  the native reset/respawn path and returns to `MODE_GAME` without calling
  `P_ResetMultiPlayer()` or `MODE_RESTART`.
  Both browser death-path reset variants caused repeated wasm out-of-bounds failures.
  This is a stability guard, not the final respawn implementation.
- `source/duke3d/src/game.cpp`: temporary low-volume Emscripten loop/yield markers are
  used while isolating the level-start freeze. Avoid per-frame browser logging; it can
  overwhelm the runtime during level start.

Current runtime `index.html` choices:

- writes `eduke32.cfg` into the wasm filesystem
- uses `ScreenWidth = 640`, `ScreenHeight = 480`, `ScreenBPP = 8`
- keeps browser canvas scaled by CSS instead of asking EDuke32 for oversized window modes
- writes `settings.cfg` with sound, music, ambience, speech, mouse input, and
  Doom/Duke mouse-sensitivity-derived EDuke32 mouse values
- exposes a first DukeMatch proof-of-concept control surface:
  local player P1 currently runs as the stable normal local controller, while P2 starts
  EDuke32 with `-q2 -ep2`. Bot opponent adds `-a` only in the P2 experimental path.
  The old EDuke32 `-a` behavior and fake multiplayer input routing are ambiguous with
  the P1 local-input proof-of-concept and can steal the wrong side.
- returns keyboard focus to the canvas after start and pointer-lock changes so P1/P2
  selection controls do not keep keyboard input
- exposes a small `Reload Duke` escape button in the runtime overlay so a broken wasm
  session can be restarted without fighting pointer lock
- posts browser/runtime diagnostics to `/api/eutherduke/log`, which EutherHost writes to
  `.euther-host/eutherduke-browser.log`

## Current Stability Notes

The original Hollywood Holocaust freeze was caused by EDuke32's desktop frame limiter
blocking the browser path. `engineFPSLimit()` is now bypassed under Emscripten, while the
main loop yields with `emscripten_sleep(16)`.

The remaining known hard failure is the death/reset path. `MODE_RESTART` and soft
`P_ResetMultiPlayer()` respawn attempts both produced repeated wasm `index out of bounds`
errors after death. The current runtime therefore suppresses the native reset path to
keep the browser session controllable. The permanent fix should isolate a safe
browser-owned respawn/reload path instead of calling EDuke32's desktop reset machinery
from CON `resetplayer`.

## Legal Data Boundary

EutherOxide must not ship commercial Duke data. Runtime data should be supplied separately:

- shareware data when appropriate
- user-owned `DUKE3D.GRP`
- future per-user or per-server data config

The current `index.html` looks for `DUKE3D.GRP` or `duke3d.grp` in
`/home/nichlas/eutherduke-runtime`, loads it into the WebAssembly filesystem, then starts
EDuke32 with `-nosetup`.

## MVP Steps

1. Keep the EutherDuke route and runtime mount in EutherOxide.
2. Build or obtain an EDuke32 WebAssembly runtime outside git.
3. Place runtime output in `/home/nichlas/eutherduke-runtime`.
4. Verify `index.html` boots in the EutherDuke vessel.
5. Add Duke-specific controls: mouse sensitivity, invert mouse, gamma, fullscreen.
6. Add per-user save/config storage after the runtime boots reliably.

## Later Multiplayer Track

Singleplayer comes first. Multiplayer should be treated as a separate research track:

- browser networking constraints
- EDuke32 netplay assumptions
- WebRTC or server relay options
- spectator mode through the existing EutherHost model
