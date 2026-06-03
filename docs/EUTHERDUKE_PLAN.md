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
  LTO=0 CFLAGS='-pthread' \
  CUSTOMOPT='-DB_LITTLE_ENDIAN=1 -DB_BIG_ENDIAN=0' \
  LDFLAGS='-sUSE_SDL=2 -sALLOW_MEMORY_GROWTH=1 -sASYNCIFY=1 -sMODULARIZE=1 -sEXPORT_NAME=EutherDukeModule -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain'
```

The current runtime is pthread-based. EutherHost sends COOP/COEP/CORP headers so browser
`SharedArrayBuffer` support is available for the iframe runtime.

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
