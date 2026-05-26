import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WEB_BUILD_ID } from "./build-info";
import shaderToml from "./shaders.toml?raw";
import "./styles.css";

const controllerGuideUrl = new URL("./controller-bindings.svg", import.meta.url).href;

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    webkitAudioContext?: typeof AudioContext;
  }
}

type LoadResult = {
  title: string;
  region: string;
  timing: string;
  resetPc: number;
  width: number;
  height: number;
  statePath?: string | null;
};

type BridgeStatusResult = LoadResult & {
  loaded?: boolean;
  frame: number;
};

type BridgeBuildStatus = {
  activeProfile: "debug" | "release" | string;
  requestedProfile: "debug" | "release" | string;
  building: boolean;
  releaseReady: boolean;
  armed: boolean;
  lastStatus: string;
  lastMessage: string;
  releasePath: string;
  updatedUnixMs: number;
};

type FrameResult = {
  frame: number;
  width: number;
  height: number;
  rgba: number[] | Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  stopped: boolean;
  lastError?: string | null;
};

type AudioResult = {
  frame: number;
  sampleRate: number;
  samples: number[] | Int16Array<ArrayBuffer>;
  channels?: number;
};

type FrameAudioResult = {
  frame: FrameResult;
  audio: AudioResult;
  transport: string;
  videoFormat?: string;
};

type DecodedFrameAudioPacket = FrameAudioResult & {
  videoBytes?: Uint8Array<ArrayBufferLike>;
  videoOffset?: number;
  videoLength?: number;
};

type NativeAudioResult = {
  active: boolean;
  queuedMs: number;
};

type NativeFrameResult = {
  frame: number;
  width: number;
  height: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  stopped: boolean;
  lastError?: string | null;
  audioActive: boolean;
  audioLeadMs: number;
};

type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  b: boolean;
  c: boolean;
  start: boolean;
};

type InputName = keyof InputState;
type PlayerPort = 1 | 2;

type PadBinding = {
  kind: "button" | "axis";
  code: string;
  direction?: "positive" | "negative";
};

type ControlBinding = {
  key: string;
  pad: PadBinding;
};

type PadControl = {
  id: string;
  label: string;
  pressed: boolean;
  value?: number;
  kind: "button" | "axis";
  direction?: "positive" | "negative";
};

type GamepadDevice = {
  id: string;
  name: string;
  controls: PadControl[];
};

type GamepadSnapshot = {
  available: boolean;
  error?: string | null;
  gamepads: GamepadDevice[];
};

type RomDirSetting = {
  romDir?: string | null;
};

type RomDirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

type RomDirListing = {
  romDir?: string | null;
  path: string;
  parent?: string | null;
  entries: RomDirEntry[];
};

type ShaderParamName =
  | "scanlines"
  | "phosphor_glow"
  | "rgb_mask"
  | "vignette"
  | "curvature"
  | "noise"
  | "chroma_bleed"
  | "luma_sharpness"
  | "dither_blend"
  | "dot_crawl"
  | "rf_noise"
  | "bloom"
  | "highlight_glow"
  | "contrast_curve"
  | "saturation"
  | "glass_shimmer";

type ShaderParams = Record<ShaderParamName, number>;

type ShaderConfig = {
  selected: string;
  available: string[];
  presets: Record<string, ShaderParams>;
};

type StateSlot = {
  slot: number;
  occupied: boolean;
  createdUnixMs?: number | null;
  frameCount?: number | null;
  label?: string | null;
};

type StateSlotsResult = {
  path?: string | null;
  slots: StateSlot[];
};

type LoadStateResult = {
  frame: FrameResult;
  states: StateSlotsResult;
};

type WebStateSnapshot = {
  frame: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  status: string;
};

type CachedRomRecord = {
  key: "last";
  name: string;
  bytes: ArrayBuffer;
  hash: number;
  savedUnixMs: number;
};

type UiState = LoadResult & {
  loaded: boolean;
  playing: boolean;
  runtime: "tauri" | "web" | "bridge";
  frame: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  transportMs: number;
  drawMs: number;
  audioLeadMs: number;
  transportMode: string;
  status: string;
  lastError: string;
  stateSlots: StateSlot[];
  nativeStates: boolean;
  build: BridgeBuildStatus;
};

type DogsTile = "floor" | "wall" | "target" | "pickup" | "exit" | "prop";

type DogsActor = {
  x: number;
  y: number;
  hp: number;
  alive: boolean;
};

type DogsBullet = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  owner: "player" | "enemy";
  ttl: number;
};

type DogsState = {
  width: number;
  height: number;
  tiles: DogsTile[];
  player: DogsActor & { score: number; cash: number; weapon: number; ammo: number[] };
  enemies: DogsActor[];
  bullets: DogsBullet[];
  targetsLeft: number;
  objectsLeft: number;
  status: "RUNNING" | "WON" | "LOST";
  ticks: number;
};

const isTauri = Boolean(window.__TAURI_INTERNALS__);
document.documentElement.classList.toggle("is-tauri-shell", isTauri);
const explicitBridgeBase = new URLSearchParams(window.location.search).get("bridge");
const bridgeBase =
  explicitBridgeBase ??
  (window.location.port && window.location.port !== "5173"
    ? window.location.origin
    : "http://127.0.0.1:32161");
const romCacheDb = "eutheroxide-rom-cache";
const romCacheStore = "roms";
const volumeStorageKey = "eutheroxide-audio-volume";
const bindingsStorageKey = "eutheroxide-input-bindings";
const shaderStorageKey = "eutheroxide-video-shader";
const shaderConfigStorageKey = "eutheroxide-video-shader-toml";
const mobileModeStorageKey = "eutheroxide-mobile-mode";
const bridgeClientStorageKey = "eutheroxide-bridge-client-id";
const playerPortStorageKey = "eutheroxide-player-port";
let audioVolume = readStoredVolume();
const localAudioTargetLeadSeconds = 0.055;
const localAudioMinimumLeadSeconds = 0.018;
const localAudioMaximumLeadSeconds = 0.16;
const bridgeAudioTargetLeadSeconds = 0.14;
const bridgeAudioMinimumLeadSeconds = 0.08;
const bridgeAudioMaximumLeadSeconds = 0.65;
const mobileBridgeAudioTargetLeadSeconds = 0.24;
const mobileBridgeAudioMinimumLeadSeconds = 0.16;
const mobileBridgeAudioMaximumLeadSeconds = 1.0;
const inputState: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  c: false,
  start: false,
};
const keyboardState = emptyInputState();
const pointerState = emptyInputState();
const gamepadState = emptyInputState();
const inputNames: InputName[] = ["up", "down", "left", "right", "a", "b", "c", "start"];
const inputLabels: Record<InputName, string> = {
  up: "D-Pad Up",
  down: "D-Pad Down",
  left: "D-Pad Left",
  right: "D-Pad Right",
  a: "Button A",
  b: "Button B",
  c: "Button C",
  start: "Start",
};
const defaultBindings: Record<InputName, ControlBinding> = {
  up: { key: "ArrowUp", pad: { kind: "button", code: "DPadUp" } },
  down: { key: "ArrowDown", pad: { kind: "button", code: "DPadDown" } },
  left: { key: "ArrowLeft", pad: { kind: "button", code: "DPadLeft" } },
  right: { key: "ArrowRight", pad: { kind: "button", code: "DPadRight" } },
  a: { key: "z", pad: { kind: "button", code: "South" } },
  b: { key: "x", pad: { kind: "button", code: "East" } },
  c: { key: "c", pad: { kind: "button", code: "RightTrigger" } },
  start: { key: "Enter", pad: { kind: "button", code: "Start" } },
};
let controlBindings = readStoredBindings();
const shaderParamNames: ShaderParamName[] = [
  "scanlines",
  "phosphor_glow",
  "rgb_mask",
  "vignette",
  "curvature",
  "noise",
  "chroma_bleed",
  "luma_sharpness",
  "dither_blend",
  "dot_crawl",
  "rf_noise",
  "bloom",
  "highlight_glow",
  "contrast_curve",
  "saturation",
  "glass_shimmer",
];
const shaderParamLabels: Record<ShaderParamName, string> = {
  scanlines: "Scanlines",
  phosphor_glow: "Phosphor",
  rgb_mask: "RGB Mask",
  vignette: "Vignette",
  curvature: "Curvature",
  noise: "Noise",
  chroma_bleed: "Chroma",
  luma_sharpness: "Luma Sharp",
  dither_blend: "Dither",
  dot_crawl: "Dot Crawl",
  rf_noise: "RF Noise",
  bloom: "Bloom",
  highlight_glow: "Highlight",
  contrast_curve: "Contrast",
  saturation: "Saturation",
  glass_shimmer: "Glass",
};
let shaderConfig = parseShaderConfig(readStoredShaderConfigSource());
let selectedShader = readStoredShader(shaderConfig);
let activeShaderParams = cloneShaderParams(shaderConfig.presets[selectedShader]);

const ui: UiState = {
  loaded: false,
  playing: false,
  runtime: isTauri ? "tauri" : "web",
  title: "No ROM",
  region: "AUTO",
  timing: "NTSC",
  resetPc: 0,
  width: 320,
  height: 224,
  frame: 0,
  cpuCycles: 0,
  cpuSteps: 0,
  frameMs: 0,
  transportMs: 0,
  drawMs: 0,
  audioLeadMs: 0,
  transportMode: isTauri ? "TAURI INIT" : "WEB INIT",
  status: "IDLE",
  lastError: "",
  statePath: null,
  stateSlots: emptySlots(),
  nativeStates: false,
  build: emptyBuildStatus(),
};

let romBytes = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
let romDisplayName = "reaction.argon";
let romHash = 0xC0FFEE;
let romDirRoot: string | null = null;
let romDirPath = "";
let romDirEntries: RomDirEntry[] = [];
let webStateSlots: Array<WebStateSnapshot | null> = [null, null, null];
let stepping = false;
let shaderRenderer: ShaderRenderer | null = null;
let nativeStatusPolling = false;
let videoCanvas: HTMLCanvasElement;
let videoContext: CanvasRenderingContext2D;
let shaderCanvas: HTMLCanvasElement;
let dogsCanvas: HTMLCanvasElement;
let dogsContext: CanvasRenderingContext2D;
let lastInputJson = JSON.stringify(inputState);
let lastBrowserFile: File | null = null;
let bridgeRetryTimer: number | null = null;
let buildPollTimer: number | null = null;
let bridgeStreamAbort: AbortController | null = null;
let bridgeStreamActive = false;
let bridgeStreamGeneration = 0;
let bridgeRestarting = false;
let bridgeReconnectToken = 0;
let nativeBridgeBase: string | null = null;
const bridgeClientId = readBridgeClientId();
let playerPort: PlayerPort = readStoredPlayerPort();
let desiredBuildProfile: "debug" | "release" = "debug";
let audioContext: AudioContext | null = null;
let audioGain: GainNode | null = null;
let audioCursor = 0;
const activeAudioSources = new Set<AudioBufferSourceNode>();
let nextFrameDue = performance.now();
let nativeSurfaceRectTimer: number | null = null;
let controlsOpen = false;
let captureTarget: InputName | null = null;
let captureMode: "key" | "pad" | null = null;
let gamepadPollTimer: number | null = null;
let shaderSaveTimer: number | null = null;
let shaderConfigLoadAttempted = false;
let mobileMode = readStoredMobileMode();
let dogsMode = false;
let dogsState: DogsState = createDogsState(0xC0FFEE);
let lastGamepadSnapshot: GamepadSnapshot = {
  available: false,
  error: null,
  gamepads: [],
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="oxide-shell">
    <section class="control-rail">
      <div class="brand-block">
        <div class="brand-mark">
          <span>C</span>
          <i></i>
          <span>O</span>
        </div>
        <div>
          <p class="eyebrow">EutherOxide</p>
          <h1>Reaction Core</h1>
        </div>
      </div>

      <label class="rom-drop" id="rom-drop">
        <input id="rom-input" type="file" accept=".bin,.gen,.md,.smd,.rom" />
        <span>ROM Reagent</span>
        <strong id="rom-name">Load Mega Drive</strong>
      </label>

      <div class="rail-section rom-browser-section">
        <div class="section-head">
          <p class="section-label">ROM Directory</p>
          <button id="rom-dir-set" class="mini-action" type="button">Set</button>
        </div>
        <div class="rom-dir-path" id="rom-dir-path">No directory</div>
        <div class="rom-dir-manual" id="rom-dir-manual">
          <input id="rom-dir-input" type="text" placeholder="/path/to/roms" aria-label="ROM directory path" />
          <button id="rom-dir-apply" class="mini-action" type="button">Use</button>
        </div>
        <div class="rom-breadcrumb" id="rom-breadcrumb">/</div>
        <div class="rom-list" id="rom-list">
          <button type="button" disabled>Set ROM directory</button>
        </div>
      </div>

      <div class="rail-section transport-section">
        <p class="section-label">Transport</p>
        <div class="transport-grid">
          <button id="play-toggle" class="primary-action" type="button">Play</button>
          <button id="step-frame" type="button">Step</button>
          <button id="reset-core" type="button">Reset</button>
          <button id="eutherdogs-toggle" type="button">EutherDogs</button>
        </div>
      </div>

      <div class="rail-section volume-section">
        <div class="volume-head">
          <p class="section-label">Volume</p>
          <strong id="volume-value">80%</strong>
        </div>
        <input id="volume-slider" type="range" min="0" max="100" value="80" aria-label="volume" />
      </div>

      <div class="rail-section state-section">
        <p class="section-label">Argon States</p>
        <div class="state-grid" id="state-grid">
          <div class="state-slot" data-slot-row="1">
            <span>1</span><strong>Empty</strong>
            <button data-state-action="save" data-slot="1" type="button">Save</button>
            <button data-state-action="load" data-slot="1" type="button">Load</button>
          </div>
          <div class="state-slot" data-slot-row="2">
            <span>2</span><strong>Empty</strong>
            <button data-state-action="save" data-slot="2" type="button">Save</button>
            <button data-state-action="load" data-slot="2" type="button">Load</button>
          </div>
          <div class="state-slot" data-slot-row="3">
            <span>3</span><strong>Empty</strong>
            <button data-state-action="save" data-slot="3" type="button">Save</button>
            <button data-state-action="load" data-slot="3" type="button">Load</button>
          </div>
        </div>
      </div>

      <div class="rail-section">
        <div class="section-head">
          <p class="section-label">Pad</p>
          <button id="controls-open" class="mini-action" type="button">Controls</button>
        </div>
        <div class="player-switch" aria-label="controller port">
          <button data-player-port="1" type="button">1st Player</button>
          <button data-player-port="2" type="button">2nd Player</button>
        </div>
        <div class="pad-grid" aria-label="controller">
          <button data-pad="up" class="pad-key pad-up" type="button">U</button>
          <button data-pad="left" class="pad-key pad-left" type="button">L</button>
          <button data-pad="right" class="pad-key pad-right" type="button">R</button>
          <button data-pad="down" class="pad-key pad-down" type="button">D</button>
          <button data-pad="a" class="pad-key action-a" type="button">A</button>
          <button data-pad="b" class="pad-key action-b" type="button">B</button>
          <button data-pad="c" class="pad-key action-c" type="button">C</button>
          <button data-pad="start" class="pad-key action-start" type="button">Start</button>
        </div>
      </div>
    </section>

    <section class="reactor-stage">
      <header class="stage-header">
        <div>
          <p class="eyebrow">Alkene Chamber</p>
          <h2 id="game-title">No ROM</h2>
        </div>
        <div class="stage-tools">
          <div class="build-console" id="build-console">
            <div class="build-slider" aria-label="bridge build profile">
              <button data-build-profile="debug" type="button">Debug</button>
              <button data-build-profile="release" type="button">Bin</button>
            </div>
            <button id="release-build" class="build-button" type="button">Build</button>
            <span id="build-lamp" class="build-lamp is-cold" title="Release binary not armed"></span>
          </div>
          <button id="mobile-toggle" class="mobile-toggle" type="button" aria-pressed="false">Mobile</button>
          <div class="player-switch stage-player-switch" aria-label="controller port">
            <button data-player-port="1" type="button">1P</button>
            <button data-player-port="2" type="button">2P</button>
          </div>
          <div class="runtime-chip" id="runtime-chip">WEB VIEW</div>
        </div>
      </header>

      <div class="screen-vessel">
        <div class="screen-glass" id="screen-glass">
          <canvas id="video" width="320" height="224"></canvas>
          <canvas id="shader-video" width="320" height="224"></canvas>
          <canvas id="eutherdogs-canvas" width="320" height="224"></canvas>
          <div id="eutherdogs-hud" class="eutherdogs-hud" aria-live="polite"></div>
          <div class="scanlines"></div>
          <div class="oxidation-ring"></div>
        </div>
      </div>

      <div class="reaction-strip">
        <span>C=C</span>
        <span>C#C</span>
        <span>R-CHO</span>
        <span>O2</span>
        <span>e- flow</span>
      </div>
    </section>

    <aside class="telemetry-panel">
      <div class="metric hero-metric">
        <span>Status</span>
        <strong id="status-text">IDLE</strong>
      </div>
      <div class="shader-drawer" id="shader-drawer">
        <button id="shader-toggle" class="shader-toggle" type="button">
          <span>Shaders</span>
          <strong id="shader-mode">System Regis CRT</strong>
        </button>
        <div class="shader-panel" id="shader-panel">
          <select id="shader-select" aria-label="video shader"></select>
          <div id="shader-controls" class="shader-controls"></div>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric"><span>Frame</span><strong id="frame-count">0</strong></div>
        <div class="metric"><span>Timing</span><strong id="timing-mode">NTSC</strong></div>
        <div class="metric"><span>Region</span><strong id="region-mode">AUTO</strong></div>
        <div class="metric"><span>Reset PC</span><strong id="reset-pc">$000000</strong></div>
        <div class="metric"><span>Cycles</span><strong id="cycle-count">0</strong></div>
        <div class="metric"><span>Steps</span><strong id="step-count">0</strong></div>
        <div class="metric"><span>Frame ms</span><strong id="frame-ms">0.00</strong></div>
        <div class="metric"><span>Bridge</span><strong id="bridge-mode">WEB</strong></div>
        <div class="metric"><span>Fetch ms</span><strong id="fetch-ms">0.00</strong></div>
        <div class="metric"><span>Draw ms</span><strong id="draw-ms">0.00</strong></div>
        <div class="metric"><span>Audio lead</span><strong id="audio-lead-ms">0</strong></div>
        <div class="metric"><span>Transport</span><strong id="transport-mode">INIT</strong></div>
        <div class="metric"><span>Build</span><strong id="build-id">dev</strong></div>
      </div>
      <div class="reaction-log">
        <p class="section-label">Oxidative Trace</p>
        <ol id="trace-list">
          <li>Core cold</li>
          <li>Awaiting substrate</li>
          <li>Canvas online</li>
        </ol>
      </div>
    </aside>
  </main>
  <div class="mobile-pad" id="mobile-pad" aria-label="mobile controller">
    <div class="mobile-pad-cluster mobile-dpad">
      <button data-pad="up" class="pad-key pad-up" type="button">U</button>
      <button data-pad="left" class="pad-key pad-left" type="button">L</button>
      <button data-pad="right" class="pad-key pad-right" type="button">R</button>
      <button data-pad="down" class="pad-key pad-down" type="button">D</button>
    </div>
    <div class="mobile-system">
      <button data-mobile-command="play" class="mobile-command primary-action" type="button">Play</button>
      <div class="player-switch mobile-player-switch" aria-label="controller port">
        <button data-player-port="1" type="button">1P</button>
        <button data-player-port="2" type="button">2P</button>
      </div>
      <button data-pad="start" class="pad-key mobile-start" type="button">Start</button>
      <button data-mobile-command="reset" class="mobile-command" type="button">Reset</button>
      <button data-mobile-command="controls" class="mobile-command" type="button">Bind</button>
    </div>
    <div class="mobile-pad-cluster mobile-actions">
      <button data-pad="a" class="pad-key action-a" type="button">A</button>
      <button data-pad="b" class="pad-key action-b" type="button">B</button>
      <button data-pad="c" class="pad-key action-c" type="button">C</button>
    </div>
  </div>
  <div id="controls-modal" class="controls-modal" aria-hidden="true">
    <div class="controls-dialog" role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <header class="controls-dialog-head">
        <div>
          <p class="eyebrow">Input Matrix</p>
          <h2 id="controls-title">Controls</h2>
        </div>
        <div class="controls-actions">
          <button id="controls-reset" class="mini-action" type="button">Reset</button>
          <button id="controls-close" class="mini-action" type="button" aria-label="Close controls">Close</button>
        </div>
      </header>
      <div class="controls-body">
        <section class="binding-list" aria-label="controller bindings">
          <p class="section-label">Bindings</p>
          <div id="binding-rows" class="binding-rows"></div>
        </section>
        <section class="controller-guide" aria-label="controller map">
          <img src="${controllerGuideUrl}" alt="Neon controller binding map" />
          <div class="capture-readout" id="capture-readout">Ready</div>
        </section>
        <section class="gamepad-panel" aria-label="detected gamepads">
          <p class="section-label">Gilrs Pads</p>
          <div id="gamepad-list" class="gamepad-list">
            <span>No pad detected</span>
          </div>
        </section>
      </div>
    </div>
  </div>
`;

videoCanvas = document.querySelector<HTMLCanvasElement>("#video")!;
videoContext = videoCanvas.getContext("2d", { alpha: false })!;
shaderCanvas = document.querySelector<HTMLCanvasElement>("#shader-video")!;
dogsCanvas = document.querySelector<HTMLCanvasElement>("#eutherdogs-canvas")!;
dogsContext = dogsCanvas.getContext("2d", { alpha: false })!;

const volumeSlider = document.querySelector<HTMLInputElement>("#volume-slider")!;
const volumeValue = document.querySelector<HTMLElement>("#volume-value")!;
const romDirSet = document.querySelector<HTMLButtonElement>("#rom-dir-set")!;
const romDirPathLabel = document.querySelector<HTMLDivElement>("#rom-dir-path")!;
const romDirManual = document.querySelector<HTMLDivElement>("#rom-dir-manual")!;
const romDirInput = document.querySelector<HTMLInputElement>("#rom-dir-input")!;
const romDirApply = document.querySelector<HTMLButtonElement>("#rom-dir-apply")!;
const romBreadcrumb = document.querySelector<HTMLDivElement>("#rom-breadcrumb")!;
const romList = document.querySelector<HTMLDivElement>("#rom-list")!;
const shaderDrawer = document.querySelector<HTMLDivElement>("#shader-drawer")!;
const shaderToggle = document.querySelector<HTMLButtonElement>("#shader-toggle")!;
const shaderSelect = document.querySelector<HTMLSelectElement>("#shader-select")!;
const shaderMode = document.querySelector<HTMLElement>("#shader-mode")!;
const shaderControls = document.querySelector<HTMLDivElement>("#shader-controls")!;
const romInput = document.querySelector<HTMLInputElement>("#rom-input")!;
const romDrop = document.querySelector<HTMLLabelElement>("#rom-drop")!;
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle")!;
const stepFrame = document.querySelector<HTMLButtonElement>("#step-frame")!;
const resetCore = document.querySelector<HTMLButtonElement>("#reset-core")!;
const eutherDogsToggle = document.querySelector<HTMLButtonElement>("#eutherdogs-toggle")!;
const stateGrid = document.querySelector<HTMLDivElement>("#state-grid")!;
const screenGlass = document.querySelector<HTMLDivElement>("#screen-glass")!;
const mobileToggle = document.querySelector<HTMLButtonElement>("#mobile-toggle")!;
const mobilePlay = document.querySelector<HTMLButtonElement>('[data-mobile-command="play"]')!;
const releaseBuild = document.querySelector<HTMLButtonElement>("#release-build")!;
const buildLamp = document.querySelector<HTMLSpanElement>("#build-lamp")!;
const controlsOpenButton = document.querySelector<HTMLButtonElement>("#controls-open")!;
const controlsModal = document.querySelector<HTMLDivElement>("#controls-modal")!;
const controlsClose = document.querySelector<HTMLButtonElement>("#controls-close")!;
const controlsReset = document.querySelector<HTMLButtonElement>("#controls-reset")!;
const bindingRows = document.querySelector<HTMLDivElement>("#binding-rows")!;
const gamepadList = document.querySelector<HTMLDivElement>("#gamepad-list")!;
const captureReadout = document.querySelector<HTMLDivElement>("#capture-readout")!;
const buildProfileButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-profile]"),
);
const playerPortButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-player-port]"),
);

volumeSlider.value = Math.round(audioVolume * 100).toString();
initializeShaderControls();
void loadShaderConfigFile();
void loadRomDirSetting();
updateVolumeUi();
applyAudioVolume();
applyMobileMode();
renderPlayerPort();
volumeSlider.addEventListener("input", () => {
  setAudioVolume(Number(volumeSlider.value) / 100);
});

mobileToggle.addEventListener("click", () => {
  setMobileMode(!mobileMode);
});

playerPortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setPlayerPort(button.dataset.playerPort === "2" ? 2 : 1);
  });
});

shaderSelect.addEventListener("change", () => {
  setActiveShader(shaderSelect.value);
});

shaderToggle.addEventListener("click", () => {
  shaderDrawer.classList.toggle("is-open");
});

shaderControls.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-shader-param]");
  if (!input) {
    return;
  }
  const param = input.dataset.shaderParam as ShaderParamName;
  activeShaderParams[param] = Number(input.value);
  shaderConfig.presets[selectedShader][param] = activeShaderParams[param];
  const value = shaderControls.querySelector<HTMLElement>(`[data-shader-value="${param}"]`);
  if (value) {
    value.textContent = activeShaderParams[param].toFixed(2);
  }
  renderShaderFrame();
  scheduleShaderConfigSave();
});

romDrop.addEventListener("click", async (event) => {
  if (!isTauri) {
    return;
  }
  event.preventDefault();
  await chooseDesktopRom();
});

romInput.addEventListener("change", async () => {
  const file = romInput.files?.[0];
  if (file) {
    await loadFile(file);
  }
});

romDirSet.addEventListener("click", async () => {
  if (isTauri) {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (typeof selected === "string") {
      await setRomDir(selected);
    }
    return;
  }
  romDirManual.classList.toggle("is-open");
  romDirInput.focus();
});

romDirApply.addEventListener("click", async () => {
  await setRomDir(romDirInput.value);
});

romDirInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    await setRomDir(romDirInput.value);
  }
});

romList.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rom-path]");
  if (!button) {
    return;
  }
  const path = button.dataset.romPath ?? "";
  if (button.dataset.romKind === "dir") {
    await refreshRomDir(path);
  } else {
    await loadRomDirEntry(path, button.dataset.romName ?? basename(path));
  }
});

romDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
  romDrop.classList.add("is-dragging");
});

romDrop.addEventListener("dragleave", () => {
  romDrop.classList.remove("is-dragging");
});

romDrop.addEventListener("drop", async (event) => {
  event.preventDefault();
  romDrop.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    const filePath = tauriFilePath(file);
    if (isTauri && filePath) {
      await loadRomPath(filePath);
    } else {
      await loadFile(file);
    }
  }
});

playToggle.addEventListener("click", async () => {
  ui.playing = !ui.playing;
  playToggle.textContent = ui.playing ? "Pause" : "Play";
  ui.status = ui.playing ? "RUNNING" : "PAUSED";
  renderUi();
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    await invoke("set_native_running", { running: ui.playing });
    if (ui.playing) {
      void nativeStatusLoop();
    }
    return;
  }
  if (ui.runtime === "bridge" && ui.loaded) {
    if (ui.playing) {
      void ensureAudio();
      void bridgeStreamLoop();
    } else {
      stopBridgeStream();
    }
    return;
  }
  if (ui.playing) {
    nextFrameDue = performance.now();
    void ensureAudio();
    void animationLoop();
  }
});

stepFrame.addEventListener("click", async () => {
  if (isTauri && ui.runtime === "tauri") {
    ui.playing = false;
    playToggle.textContent = "Play";
    await invoke("set_native_running", { running: false });
  } else if (ui.runtime === "bridge") {
    ui.playing = false;
    playToggle.textContent = "Play";
    stopBridgeStream();
  }
  resetScheduledAudio();
  await advanceFrame();
});

resetCore.addEventListener("click", async () => {
  if (dogsMode) {
    resetDogsMode();
    return;
  }
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  let drewCoreFrame = false;
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    ui.playing = false;
    playToggle.textContent = "Play";
    await invoke("set_native_running", { running: false });
    resetScheduledAudio();
    await invoke("reset_emulator");
  } else if (ui.runtime === "bridge" && ui.loaded) {
    ui.playing = false;
    playToggle.textContent = "Play";
    stopBridgeStream();
    const result = await bridgeJson<BridgeStatusResult>("/reset", {
      method: "POST",
    });
    Object.assign(ui, result);
    const frame = await bridgeFrame();
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    drewCoreFrame = true;
  }
  if (!drewCoreFrame) {
    ui.frame = 0;
    ui.cpuCycles = 0;
    ui.cpuSteps = 0;
    drawSyntheticFrame();
  }
  ui.status = ui.loaded ? "RESET" : "IDLE";
  pushTrace("Reset vector reloaded");
  renderUi();
  resetCore.blur();
  window.scrollTo(scrollX, scrollY);
});

eutherDogsToggle.addEventListener("click", () => {
  if (dogsMode) {
    leaveDogsMode();
  } else {
    enterDogsMode();
  }
});

releaseBuild.addEventListener("click", async () => {
  await buildReleaseBinary();
});

buildProfileButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const profile = button.dataset.buildProfile === "release" ? "release" : "debug";
    await setBridgeBuildProfile(profile);
  });
});

stateGrid.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-state-action]",
  );
  if (!button) {
    return;
  }
  const slot = Number(button.dataset.slot ?? 0);
  if (button.dataset.stateAction === "save") {
    await saveStateSlot(slot);
  } else {
    await loadStateSlot(slot);
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((button) => {
  const name = button.dataset.pad as keyof InputState;
  const set = (pressed: boolean) => {
    pointerState[name] = pressed;
    recomputeInputState();
    button.classList.toggle("is-active", pressed);
  };
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    set(true);
  });
  button.addEventListener("pointerup", () => set(false));
  button.addEventListener("pointercancel", () => set(false));
  button.addEventListener("pointerleave", () => set(false));
});

document.querySelectorAll<HTMLButtonElement>("[data-mobile-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.mobileCommand;
    if (command === "play") {
      playToggle.click();
    } else if (command === "reset") {
      resetCore.click();
    } else if (command === "controls") {
      openControls();
    }
  });
});

controlsOpenButton.addEventListener("click", () => openControls());
controlsClose.addEventListener("click", () => closeControls());
controlsReset.addEventListener("click", () => {
  controlBindings = cloneDefaultBindings();
  storeBindings();
  captureTarget = null;
  captureMode = null;
  renderBindings();
});
controlsModal.addEventListener("pointerdown", (event) => {
  if (event.target === controlsModal) {
    closeControls();
  }
});

bindingRows.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-bind]");
  if (!button) {
    return;
  }
  captureTarget = button.dataset.input as InputName;
  captureMode = button.dataset.bind === "pad" ? "pad" : "key";
  renderBindings();
});

window.addEventListener("keydown", (event) => {
  if (controlsOpen && event.key === "Escape") {
    closeControls();
    event.preventDefault();
    return;
  }
  if (captureTarget && captureMode === "key") {
    event.preventDefault();
    controlBindings[captureTarget].key = event.key;
    storeBindings();
    captureTarget = null;
    captureMode = null;
    renderBindings();
    return;
  }
  const key = keyForEvent(event.key);
  if (!key || keyboardState[key]) {
    return;
  }
  event.preventDefault();
  keyboardState[key] = true;
  recomputeInputState();
});

window.addEventListener("keyup", (event) => {
  const key = keyForEvent(event.key);
  if (!key) {
    return;
  }
  event.preventDefault();
  keyboardState[key] = false;
  recomputeInputState();
});

function emptyInputState(): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    a: false,
    b: false,
    c: false,
    start: false,
  };
}

function keyForEvent(key: string): InputName | null {
  return inputNames.find((name) => controlBindings[name].key === key) ?? null;
}

function recomputeInputState(): void {
  for (const name of inputNames) {
    inputState[name] = keyboardState[name] || pointerState[name] || gamepadState[name];
  }
  updatePadButtons();
  void syncInput();
}

async function loadRomDirSetting(): Promise<void> {
  try {
    const setting = isTauri
      ? await invoke<RomDirSetting>("get_rom_dir")
      : ui.runtime === "bridge"
        ? await bridgeJson<RomDirSetting>("/rom-dir", {}, 400)
        : { romDir: null };
    romDirRoot = setting.romDir ?? null;
    romDirInput.value = romDirRoot ?? "";
    if (romDirRoot) {
      await refreshRomDir("");
    } else {
      renderRomDir();
    }
  } catch {
    renderRomDir();
  }
}

async function setRomDir(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) {
    return;
  }
  try {
    const setting = isTauri
      ? await invoke<RomDirSetting>("set_rom_dir", { path: trimmed })
      : await bridgeJson<RomDirSetting>(
          "/rom-dir",
          {
            method: "POST",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: trimmed,
          },
        );
    romDirRoot = setting.romDir ?? trimmed;
    romDirInput.value = romDirRoot;
    romDirManual.classList.remove("is-open");
    await refreshRomDir("");
    pushTrace("ROM directory bonded");
  } catch (err) {
    pushTrace(`ROM directory rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function refreshRomDir(path: string): Promise<void> {
  try {
    const listing = isTauri
      ? await invoke<RomDirListing>("list_rom_dir", { relativePath: path })
      : await bridgeJson<RomDirListing>(
          `/rom-dir/list?path=${encodeURIComponent(path)}`,
          {},
          700,
        );
    romDirRoot = listing.romDir ?? romDirRoot;
    romDirPath = listing.path;
    romDirEntries = listing.entries;
    renderRomDir(listing.parent ?? null);
  } catch (err) {
    romDirEntries = [];
    renderRomDir();
    pushTrace(`ROM directory read missed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadRomDirEntry(path: string, name: string): Promise<void> {
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  try {
    if (isTauri) {
      const result = await invoke<LoadResult>("load_rom_from_dir", { relativePath: path });
      await applyLoadedRomResult(result, name, "tauri");
    } else {
      const result = await bridgeJson<BridgeStatusResult>(
        `/rom-dir/load?path=${encodeURIComponent(path)}`,
        { method: "POST" },
      );
      await applyLoadedRomResult(result, name, "bridge");
      const frame = await bridgeFrame();
      drawNativeFrame(frame);
      ui.frame = frame.frame;
      ui.cpuCycles = frame.cpuCycles;
      ui.cpuSteps = frame.cpuSteps;
      ui.frameMs = frame.frameMs;
    }
    pushTrace("ROM directory launch");
  } catch (err) {
    pushTrace(`ROM launch missed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function applyLoadedRomResult(
  result: LoadResult,
  displayName: string,
  runtime: UiState["runtime"],
): Promise<void> {
  romDisplayName = displayName;
  romHash = hashText(displayName);
  romBytes = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  lastBrowserFile = null;
  Object.assign(ui, result);
  ui.runtime = runtime;
  ui.loaded = true;
  ui.nativeStates = Boolean(result.statePath);
  ui.status = "LOADED";
  ui.lastError = "";
  document.querySelector("#rom-name")!.textContent = displayName;
  await refreshStateSlots();
  renderUi();
}

function renderRomDir(parent: string | null = null): void {
  romDirPathLabel.textContent = romDirRoot ? basename(romDirRoot) || romDirRoot : "No directory";
  romBreadcrumb.textContent = romDirPath ? `/${romDirPath}` : "/";
  if (!romDirRoot) {
    romList.innerHTML = `<button type="button" disabled>Set ROM directory</button>`;
    return;
  }
  const rows = [];
  if (parent !== null) {
    rows.push(
      `<button data-rom-kind="dir" data-rom-path="${escapeHtml(parent)}" type="button"><span>..</span><strong>Parent</strong></button>`,
    );
  }
  rows.push(
    ...romDirEntries.map((entry) => {
      const kind = entry.isDir ? "dir" : "rom";
      return `<button data-rom-kind="${kind}" data-rom-path="${escapeHtml(entry.path)}" data-rom-name="${escapeHtml(entry.name)}" type="button"><span>${entry.isDir ? "DIR" : "ROM"}</span><strong>${escapeHtml(entry.name)}</strong></button>`;
    }),
  );
  romList.innerHTML = rows.length
    ? rows.join("")
    : `<button type="button" disabled>No ROMs here</button>`;
}

function cloneDefaultBindings(): Record<InputName, ControlBinding> {
  return Object.fromEntries(
    inputNames.map((name) => [
      name,
      {
        key: defaultBindings[name].key,
        pad: { ...defaultBindings[name].pad },
      },
    ]),
  ) as Record<InputName, ControlBinding>;
}

function readStoredBindings(): Record<InputName, ControlBinding> {
  const defaults = cloneDefaultBindings();
  try {
    const raw = window.localStorage.getItem(bindingsStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<InputName, ControlBinding>>) : null;
    if (!parsed) {
      return defaults;
    }
    for (const name of inputNames) {
      const binding = parsed[name];
      if (binding?.key && binding.pad?.kind && binding.pad.code) {
        defaults[name] = {
          key: binding.key,
          pad: {
            kind: binding.pad.kind,
            code: binding.pad.code,
            direction: binding.pad.direction,
          },
        };
      }
    }
  } catch {
    return defaults;
  }
  return defaults;
}

function storeBindings(): void {
  window.localStorage.setItem(bindingsStorageKey, JSON.stringify(controlBindings));
}

function openControls(): void {
  controlsOpen = true;
  controlsModal.classList.add("is-open");
  controlsModal.setAttribute("aria-hidden", "false");
  renderBindings();
  startGamepadPolling();
}

function closeControls(): void {
  controlsOpen = false;
  captureTarget = null;
  captureMode = null;
  controlsModal.classList.remove("is-open");
  controlsModal.setAttribute("aria-hidden", "true");
  renderBindings();
}

function renderBindings(): void {
  bindingRows.innerHTML = inputNames
    .map((name) => {
      const binding = controlBindings[name];
      const isKeyCapture = captureTarget === name && captureMode === "key";
      const isPadCapture = captureTarget === name && captureMode === "pad";
      return `
        <div class="binding-row" data-binding-row="${name}">
          <strong>${inputLabels[name]}</strong>
          <button data-bind="key" data-input="${name}" type="button">${isKeyCapture ? "Press key" : labelKey(binding.key)}</button>
          <button data-bind="pad" data-input="${name}" type="button">${isPadCapture ? "Press pad" : labelPad(binding.pad)}</button>
        </div>
      `;
    })
    .join("");
  captureReadout.textContent =
    captureTarget && captureMode
      ? `Listening for ${captureMode === "key" ? "keyboard" : "pad"} input: ${inputLabels[captureTarget]}`
      : "Ready";
  renderGamepadList();
}

function labelKey(key: string): string {
  if (key === " ") {
    return "Space";
  }
  return key.replace("Arrow", "");
}

function labelPad(binding: PadBinding): string {
  if (binding.kind === "axis") {
    return `${binding.code} ${binding.direction === "negative" ? "-" : "+"}`;
  }
  return binding.code;
}

function startGamepadPolling(): void {
  if (gamepadPollTimer !== null) {
    return;
  }
  void pollGamepads();
  gamepadPollTimer = window.setInterval(() => void pollGamepads(), 90);
}

async function pollGamepads(): Promise<void> {
  const snapshot = await readGamepadSnapshot();
  lastGamepadSnapshot = snapshot;
  applyGamepadSnapshot(snapshot);
  if (controlsOpen) {
    renderGamepadList();
  }
}

async function readGamepadSnapshot(): Promise<GamepadSnapshot> {
  if (isTauri && ui.runtime === "tauri") {
    try {
      return await invoke<GamepadSnapshot>("gamepad_snapshot");
    } catch (err) {
      return browserGamepadSnapshot(String(err));
    }
  }
  if (ui.runtime === "bridge") {
    try {
      return await bridgeJson<GamepadSnapshot>("/gamepads", {}, 300);
    } catch (err) {
      return browserGamepadSnapshot(String(err));
    }
  }
  return browserGamepadSnapshot(null);
}

function browserGamepadSnapshot(error: string | null): GamepadSnapshot {
  const pads = Array.from(navigator.getGamepads?.() ?? [])
    .filter((pad): pad is Gamepad => Boolean(pad))
    .map((pad) => ({
      id: String(pad.index),
      name: pad.id,
      controls: browserPadControls(pad),
    }));
  return {
    available: true,
    error,
    gamepads: pads,
  };
}

function browserPadControls(pad: Gamepad): PadControl[] {
  const buttonNames = [
    "South",
    "East",
    "West",
    "North",
    "LeftTrigger",
    "RightTrigger",
    "LeftTrigger2",
    "RightTrigger2",
    "Select",
    "Start",
    "LeftThumb",
    "RightThumb",
    "DPadUp",
    "DPadDown",
    "DPadLeft",
    "DPadRight",
    "Mode",
  ];
  const controls: PadControl[] = [];
  pad.buttons.forEach((button, index) => {
    const code = buttonNames[index] ?? `Button${index}`;
    controls.push({
      id: code,
      label: code,
      pressed: button.pressed || button.value > 0.55,
      value: button.value,
      kind: "button",
    });
  });
  const axisNames = ["LeftStickX", "LeftStickY", "RightStickX", "RightStickY"];
  pad.axes.forEach((value, index) => {
    const code = axisNames[index] ?? `Axis${index}`;
    controls.push({
      id: `${code}-negative`,
      label: `${code} -`,
      pressed: value < -0.45,
      value,
      kind: "axis",
      direction: "negative",
    });
    controls.push({
      id: `${code}-positive`,
      label: `${code} +`,
      pressed: value > 0.45,
      value,
      kind: "axis",
      direction: "positive",
    });
  });
  return controls;
}

function applyGamepadSnapshot(snapshot: GamepadSnapshot): void {
  const next = emptyInputState();
  for (const pad of snapshot.gamepads) {
    for (const control of pad.controls) {
      if (!control.pressed) {
        continue;
      }
      if (captureTarget && captureMode === "pad") {
        controlBindings[captureTarget].pad = {
          kind: control.kind,
          code: control.kind === "axis" ? control.id.replace(/-(negative|positive)$/, "") : control.id,
          direction: control.direction,
        };
        storeBindings();
        captureTarget = null;
        captureMode = null;
        renderBindings();
      }
      for (const name of inputNames) {
        if (padMatches(control, controlBindings[name].pad)) {
          next[name] = true;
        }
      }
    }
  }
  let changed = false;
  for (const name of inputNames) {
    changed ||= gamepadState[name] !== next[name];
    gamepadState[name] = next[name];
  }
  if (changed) {
    recomputeInputState();
  }
}

function padMatches(control: PadControl, binding: PadBinding): boolean {
  if (control.kind !== binding.kind) {
    return false;
  }
  if (binding.kind === "axis") {
    const code = control.id.replace(/-(negative|positive)$/, "");
    return code === binding.code && control.direction === binding.direction;
  }
  return control.id === binding.code;
}

function renderGamepadList(): void {
  if (!lastGamepadSnapshot.available) {
    gamepadList.innerHTML = `<span>Gilrs unavailable</span>`;
    return;
  }
  if (lastGamepadSnapshot.gamepads.length === 0) {
    gamepadList.innerHTML = `<span>${lastGamepadSnapshot.error ? "Browser fallback" : "No pad detected"}</span>`;
    return;
  }
  gamepadList.innerHTML = lastGamepadSnapshot.gamepads
    .map((pad) => {
      const active = pad.controls.filter((control) => control.pressed).slice(0, 6);
      return `
        <div class="gamepad-device">
          <strong>${escapeHtml(pad.name)}</strong>
          <span>${active.length ? active.map((control) => escapeHtml(control.label)).join(", ") : "Idle"}</span>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initializeShaderControls(): void {
  shaderSelect.innerHTML = shaderConfig.available
    .map((name) => `<option value="${name}">${shaderDisplayName(name)}</option>`)
    .join("");
  shaderSelect.value = selectedShader;
  renderShaderControls();
}

function setActiveShader(name: string): void {
  selectedShader = shaderConfig.presets[name] ? name : shaderConfig.selected;
  shaderConfig.selected = selectedShader;
  activeShaderParams = cloneShaderParams(shaderConfig.presets[selectedShader]);
  window.localStorage.setItem(shaderStorageKey, selectedShader);
  renderShaderControls();
  renderShaderFrame();
  scheduleShaderConfigSave();
}

function renderShaderControls(): void {
  shaderSelect.value = selectedShader;
  shaderMode.textContent = shaderDisplayName(selectedShader);
  shaderControls.innerHTML = shaderParamNames
    .map((param) => {
      const value = activeShaderParams[param];
      const max = param === "contrast_curve" || param === "saturation" || param === "luma_sharpness"
        ? "1.60"
        : "1.00";
      const min = param === "contrast_curve" || param === "saturation" || param === "luma_sharpness"
        ? "0.40"
        : "0.00";
      return `
        <label class="shader-control">
          <span>${shaderParamLabels[param]}</span>
          <input data-shader-param="${param}" type="range" min="${min}" max="${max}" step="0.01" value="${value.toFixed(2)}" />
          <strong data-shader-value="${param}">${value.toFixed(2)}</strong>
        </label>
      `;
    })
    .join("");
}

function renderShaderFrame(): void {
  if (!shaderRenderer) {
    shaderCanvas.classList.add("is-disabled");
    return;
  }
  shaderCanvas.width = videoCanvas.width;
  shaderCanvas.height = videoCanvas.height;
  shaderRenderer.render(videoCanvas, activeShaderParams, performance.now() / 1000);
}

function readStoredShader(config: ShaderConfig): string {
  const stored = window.localStorage.getItem(shaderStorageKey);
  if (stored && config.presets[stored]) {
    return stored;
  }
  return config.presets[config.selected] ? config.selected : "raw_pixels";
}

function readStoredShaderConfigSource(): string {
  return window.localStorage.getItem(shaderConfigStorageKey) ?? shaderToml;
}

async function loadShaderConfigFile(): Promise<void> {
  if (shaderConfigLoadAttempted) {
    return;
  }
  if (!isTauri && ui.runtime !== "bridge") {
    return;
  }
  shaderConfigLoadAttempted = true;
  const toml = await readShaderConfigToml();
  if (!toml) {
    return;
  }
  applyShaderConfigToml(toml);
}

async function readShaderConfigToml(): Promise<string | null> {
  if (isTauri) {
    try {
      return await invoke<string | null>("read_shader_config_toml");
    } catch {
      return null;
    }
  }
  if (ui.runtime === "bridge") {
    try {
      const response = await bridgeRequest("/shader-config", {}, 300);
      if (response.status === 204) {
        return null;
      }
      return await response.text();
    } catch {
      return null;
    }
  }
  return null;
}

function applyShaderConfigToml(toml: string): void {
  const next = parseShaderConfig(toml);
  shaderConfig = next;
  selectedShader = next.presets[next.selected] ? next.selected : readStoredShader(next);
  activeShaderParams = cloneShaderParams(next.presets[selectedShader]);
  window.localStorage.setItem(shaderConfigStorageKey, serializeShaderConfig(next));
  window.localStorage.setItem(shaderStorageKey, selectedShader);
  initializeShaderControls();
  renderShaderFrame();
}

function scheduleShaderConfigSave(): void {
  const toml = serializeShaderConfig(shaderConfig);
  window.localStorage.setItem(shaderConfigStorageKey, toml);
  window.localStorage.setItem(shaderStorageKey, selectedShader);
  if (shaderSaveTimer !== null) {
    window.clearTimeout(shaderSaveTimer);
  }
  shaderSaveTimer = window.setTimeout(() => {
    shaderSaveTimer = null;
    void saveShaderConfigToml(toml);
  }, 250);
}

async function saveShaderConfigToml(toml: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke("save_shader_config_toml", { toml });
    } catch {
      pushTrace("Shader TOML save missed");
    }
    return;
  }
  if (ui.runtime === "bridge") {
    try {
      await bridgeRequest("/shader-config", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: toml,
      });
    } catch {
      pushTrace("Shader TOML save missed");
    }
  }
}

function serializeShaderConfig(config: ShaderConfig): string {
  const lines = [
    "[video]",
    `shader = "${config.selected}"`,
    "",
    "[video.shader_presets]",
    `available = [${config.available.map((name) => `"${name}"`).join(", ")}]`,
    "",
  ];
  for (const name of config.available) {
    const preset = config.presets[name];
    if (!preset) {
      continue;
    }
    lines.push(`[shader.${name}]`);
    for (const param of shaderParamNames) {
      lines.push(`${param} = ${preset[param].toFixed(2)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function cloneShaderParams(params: ShaderParams): ShaderParams {
  return { ...params };
}

function defaultShaderParams(): ShaderParams {
  return {
    scanlines: 0,
    phosphor_glow: 0,
    rgb_mask: 0,
    vignette: 0,
    curvature: 0,
    noise: 0,
    chroma_bleed: 0,
    luma_sharpness: 1,
    dither_blend: 0,
    dot_crawl: 0,
    rf_noise: 0,
    bloom: 0,
    highlight_glow: 0,
    contrast_curve: 1,
    saturation: 1,
    glass_shimmer: 0,
  };
}

function parseShaderConfig(source: string): ShaderConfig {
  const presets: Record<string, ShaderParams> = {};
  let selected = "system_regis_crt";
  let available: string[] = ["raw_pixels", "system_regis_crt"];
  let section = "";
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section.startsWith("shader.")) {
        presets[section.slice("shader.".length)] = defaultShaderParams();
      }
      continue;
    }
    const [rawKey, ...rawValueParts] = line.split("=");
    if (!rawKey || rawValueParts.length === 0) {
      continue;
    }
    const key = rawKey.trim();
    const value = rawValueParts.join("=").trim().replace(/,$/, "");
    if (section === "video" && key === "shader") {
      selected = value.replaceAll('"', "");
      continue;
    }
    if (section === "video.shader_presets" && key === "available") {
      available = parseTomlArray(value);
      continue;
    }
    if (section.startsWith("shader.")) {
      const preset = section.slice("shader.".length);
      if (shaderParamNames.includes(key as ShaderParamName)) {
        presets[preset][key as ShaderParamName] = Number(value);
      }
    }
  }
  if (!presets.raw_pixels) {
    presets.raw_pixels = defaultShaderParams();
  }
  available = available.filter((name) => Boolean(presets[name]));
  if (!available.includes("raw_pixels")) {
    available.unshift("raw_pixels");
  }
  return { selected, available, presets };
}

function parseTomlArray(value: string): string[] {
  return value
    .replace(/^\[/, "")
    .replace(/]$/, "")
    .split(",")
    .map((item) => item.trim().replaceAll('"', ""))
    .filter(Boolean);
}

function shaderDisplayName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

class ShaderRenderer {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
    private readonly program: WebGLProgram,
    private readonly texture: WebGLTexture,
    private readonly uniforms: Record<string, WebGLUniformLocation>,
  ) {}

  static create(canvas: HTMLCanvasElement): ShaderRenderer | null {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      return null;
    }
    const vertex = compileShader(gl, gl.VERTEX_SHADER, SHADER_VERTEX);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, SHADER_FRAGMENT);
    const program = gl.createProgram();
    const texture = gl.createTexture();
    const buffer = gl.createBuffer();
    if (!vertex || !fragment || !program || !texture || !buffer) {
      return null;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(program));
      return null;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "aPosition");
    const uv = gl.getAttribLocation(program, "aUv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const uniformNames = [
      "uFrame",
      "uSourceSize",
      "uTime",
      ...shaderParamNames.map((param) => `u_${param}`),
    ];
    const uniforms = Object.fromEntries(
      uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]),
    ) as Record<string, WebGLUniformLocation | null>;
    if (Object.values(uniforms).some((uniform) => !uniform)) {
      return null;
    }
    gl.uniform1i(uniforms.uFrame, 0);
    return new ShaderRenderer(
      canvas,
      gl,
      program,
      texture,
      uniforms as Record<string, WebGLUniformLocation>,
    );
  }

  render(source: HTMLCanvasElement, params: ShaderParams, time: number): void {
    const gl = this.gl;
    if (this.canvas.width !== source.width || this.canvas.height !== source.height) {
      this.canvas.width = source.width;
      this.canvas.height = source.height;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform2f(this.uniforms.uSourceSize, source.width, source.height);
    gl.uniform1f(this.uniforms.uTime, time);
    for (const param of shaderParamNames) {
      gl.uniform1f(this.uniforms[`u_${param}`], params[param]);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

const SHADER_VERTEX = `
attribute vec2 aPosition;
attribute vec2 aUv;
varying vec2 vUv;

void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const SHADER_FRAGMENT = `
precision mediump float;

uniform sampler2D uFrame;
uniform vec2 uSourceSize;
uniform float uTime;
uniform float u_scanlines;
uniform float u_phosphor_glow;
uniform float u_rgb_mask;
uniform float u_vignette;
uniform float u_curvature;
uniform float u_noise;
uniform float u_chroma_bleed;
uniform float u_luma_sharpness;
uniform float u_dither_blend;
uniform float u_dot_crawl;
uniform float u_rf_noise;
uniform float u_bloom;
uniform float u_highlight_glow;
uniform float u_contrast_curve;
uniform float u_saturation;
uniform float u_glass_shimmer;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec3 saturateColor(vec3 color, float saturation) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, saturation);
}

vec3 sampleFrame(vec2 uv) {
  return texture2D(uFrame, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv * 2.0 - 1.0;
  float curve = dot(centered, centered) * u_curvature * 0.075;
  uv = uv + centered * curve;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec2 texel = 1.0 / uSourceSize;
  vec2 bleed = vec2(texel.x * 2.5 * u_chroma_bleed, 0.0);
  vec3 color = sampleFrame(uv);
  color.r = mix(color.r, sampleFrame(uv + bleed).r, u_chroma_bleed);
  color.b = mix(color.b, sampleFrame(uv - bleed).b, u_chroma_bleed);

  vec3 blur = (
    sampleFrame(uv + vec2(texel.x, 0.0)) +
    sampleFrame(uv - vec2(texel.x, 0.0)) +
    sampleFrame(uv + vec2(0.0, texel.y)) +
    sampleFrame(uv - vec2(0.0, texel.y))
  ) * 0.25;
  float soften = clamp(1.0 - u_luma_sharpness, 0.0, 1.0);
  float sharpen = clamp(u_luma_sharpness - 1.0, 0.0, 0.8);
  color = mix(color, blur, soften);
  color += (color - blur) * sharpen;

  float checker = mod(floor(uv.x * uSourceSize.x) + floor(uv.y * uSourceSize.y), 2.0);
  color = mix(color, mix(color, blur, 0.7), u_dither_blend * checker);

  float scan = 0.5 + 0.5 * sin(uv.y * uSourceSize.y * 3.14159265);
  color *= 1.0 - u_scanlines * (1.0 - scan);

  float maskIndex = mod(floor(uv.x * uSourceSize.x * 3.0), 3.0);
  vec3 mask = vec3(
    maskIndex < 1.0 ? 1.0 : 1.0 - u_rgb_mask,
    maskIndex >= 1.0 && maskIndex < 2.0 ? 1.0 : 1.0 - u_rgb_mask,
    maskIndex >= 2.0 ? 1.0 : 1.0 - u_rgb_mask
  );
  color *= mask;

  float bright = max(max(color.r, color.g), color.b);
  vec3 glow = blur * (u_phosphor_glow + u_bloom * smoothstep(0.55, 1.0, bright));
  color += glow;

  vec3 highlight = color * color * vec3(0.75, 0.95, 1.25);
  color += highlight * u_highlight_glow * smoothstep(0.58, 0.95, bright);

  float crawl = sin((uv.x * uSourceSize.x + uv.y * 2.0 + uTime * 55.0) * 3.14159265);
  color += crawl * u_dot_crawl * 0.035;

  float grain = hash(floor(uv * uSourceSize) + uTime * 60.0) - 0.5;
  color += grain * (u_noise + u_rf_noise) * 0.12;

  color = saturateColor(color, u_saturation);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_contrast_curve, 0.01)));

  float vig = smoothstep(1.22, 0.18, length(centered));
  color *= mix(1.0, vig, u_vignette);

  float shimmer = sin((uv.y * 90.0) + uTime * 1.7) * u_glass_shimmer * 0.035;
  color += shimmer;

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

async function chooseDesktopRom(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Mega Drive ROM",
        extensions: ["bin", "gen", "md", "smd", "rom"],
      },
    ],
  });
  if (typeof selected === "string") {
    await loadRomPath(selected);
  }
}

async function loadRomPath(path: string): Promise<void> {
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  await invoke("set_native_running", { running: false });
  romDisplayName = basename(path);
  romHash = hashText(path);
  const result = await invoke<LoadResult>("load_rom_path", { path });
  Object.assign(ui, result);
  ui.runtime = "tauri";
  ui.loaded = true;
  ui.nativeStates = Boolean(result.statePath);
  ui.status = "LOADED";
  ui.lastError = "";
  document.querySelector("#rom-name")!.textContent = romDisplayName;
  await refreshStateSlots();
  drawSyntheticFrame();
  pushTrace(".argon path bonded");
  renderUi();
}

async function loadFile(file: File): Promise<void> {
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  if (isTauri) {
    await invoke("set_native_running", { running: false });
  }
  lastBrowserFile = file;
  const buffer = await file.arrayBuffer();
  romBytes = new Uint8Array(buffer);
  romDisplayName = file.name;
  romHash = hashBytes(romBytes);
  const webInfo = parseWebHeader(romBytes, file.name);
  await persistCachedRom(file.name, romBytes);

  if (isTauri) {
    try {
      const result = await invoke<LoadResult>("load_rom_bytes", {
        bytes: Array.from(romBytes),
      });
      Object.assign(ui, result);
      ui.runtime = "tauri";
      ui.loaded = true;
      ui.nativeStates = Boolean(result.statePath);
      ui.status = "LOADED";
      ui.lastError = "";
      await refreshStateSlots();
      pushTrace("Native core bonded");
    } catch (error) {
      Object.assign(ui, webInfo);
      ui.runtime = "web";
      ui.loaded = true;
      ui.nativeStates = false;
      ui.status = "WEB FALLBACK";
      ui.lastError = String(error);
      loadWebSlots();
      pushTrace("Web bridge took over");
    }
  } else {
    if (await loadBytesThroughBridge(file.name, romBytes)) {
      return;
    }
    Object.assign(ui, webInfo);
    ui.runtime = "web";
    ui.loaded = true;
    ui.nativeStates = false;
    ui.status = "WEB PREVIEW";
    ui.lastError = "";
    loadWebSlots();
    pushTrace("Browser substrate loaded");
    scheduleBridgeRetry();
  }

  document.querySelector("#rom-name")!.textContent = file.name;
  drawSyntheticFrame();
  renderUi();
}

async function loadBytesThroughBridge(fileName: string, bytes: Uint8Array): Promise<boolean> {
  stopBridgeStream();
  try {
    const result = await bridgeJson<BridgeStatusResult>(
      "/load",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Rom-Name": encodeURIComponent(fileName),
        },
        body: copyArrayBuffer(bytes),
      },
      5000,
    );
    stopBridgeRetry();
    Object.assign(ui, result);
    ui.runtime = "bridge";
    ui.loaded = result.loaded ?? true;
    ui.nativeStates = Boolean(result.statePath);
    ui.status = "BRIDGE LOADED";
    ui.lastError = "";
    document.querySelector("#rom-name")!.textContent = fileName;
    await refreshBuildStatus(false);
    await refreshStateSlots();
    const frame = await bridgeFrame(5000);
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    ui.status = frame.stopped ? "STOPPED" : "BRIDGE RUN";
    ui.lastError = frame.lastError ?? "";
    pushTrace("Browser ROM bonded to Rust core");
    renderUi();
    return true;
  } catch {
    scheduleBridgeRetry();
    return false;
  }
}

async function connectBridge(announce = true): Promise<boolean> {
  if (isTauri) {
    return false;
  }
  try {
    const result = await bridgeJson<BridgeStatusResult>("/status", {}, 700);
    stopBridgeRetry();
    Object.assign(ui, result);
    ui.runtime = "bridge";
    ui.loaded = result.loaded ?? true;
    ui.nativeStates = ui.loaded && Boolean(result.statePath);
    ui.frame = result.frame;
    ui.status = ui.loaded ? "BRIDGE READY" : "BRIDGE IDLE";
    ui.lastError = "";
    await refreshBuildStatus(false);
    await loadShaderConfigFile();
    await loadRomDirSetting();
    document.querySelector("#rom-name")!.textContent = ui.loaded
      ? result.title
      : "Load Mega Drive";
    if (!ui.loaded) {
      ui.stateSlots = emptySlots();
      if (announce) {
        pushTrace("Rust core bridge waiting");
      }
      renderUi();
      return true;
    }
    await refreshStateSlots();
    const frame = await bridgeFrame();
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    ui.lastError = frame.lastError ?? "";
    if (announce) {
      pushTrace("Headless core bridge online");
    }
    renderUi();
    return true;
  } catch {
    if (announce) {
      scheduleBridgeRetry();
    }
    renderUi();
    return false;
  }
}

async function buildReleaseBinary(): Promise<void> {
  if (isTauri || ui.runtime !== "bridge") {
    if (!(await connectBridge(false))) {
      pushTrace("Bridge offline");
      return;
    }
  }
  desiredBuildProfile = "release";
  const wasPlaying = pauseBridgeForRestart();
  try {
    applyBuildStatus(
      await bridgeJson<BridgeBuildStatus>("/build/release", { method: "POST" }, 1000),
    );
    pushTrace("Release build started");
    renderUi();
    pollBuildStatus();
  } catch (error) {
    ui.lastError = String(error);
    pushTrace("Release build refused");
    renderUi();
  } finally {
    bridgeRestarting = false;
    restoreBridgePlaybackAfterRestart(wasPlaying);
  }
}

async function setBridgeBuildProfile(profile: "debug" | "release"): Promise<void> {
  desiredBuildProfile = profile;
  if (isTauri || ui.runtime !== "bridge") {
    if (!(await connectBridge(false))) {
      pushTrace("Bridge offline");
      return;
    }
  }
  await refreshBuildStatus(false);
  if (profile === "release" && !ui.build.releaseReady) {
    pushTrace("Build latest bin first");
    renderUi();
    return;
  }
  const wasPlaying = pauseBridgeForRestart();
  try {
    const status = await bridgeJson<BridgeBuildStatus>(
      `/build/profile?profile=${profile}`,
      { method: "POST" },
      1000,
    );
    applyBuildStatus(status);
    pushTrace(profile === "release" ? "Release bin arming" : "Debug bridge arming");
    renderUi();
    await reconnectAfterBridgeRestart(wasPlaying);
  } catch (error) {
    ui.lastError = String(error);
    pushTrace("Bridge profile switch failed");
    renderUi();
  } finally {
    bridgeRestarting = false;
  }
}

async function refreshBuildStatus(announce = false): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    applyBuildStatus(await bridgeJson<BridgeBuildStatus>("/build/status", {}, 700));
    if (announce && ui.build.armed) {
      pushTrace("Release bin armed");
    }
  } catch {
    ui.build = {
      ...ui.build,
      building: false,
      armed: false,
      lastStatus: "offline",
      lastMessage: "Bridge offline",
    };
  } finally {
    renderUi();
  }
}

function pollBuildStatus(): void {
  if (buildPollTimer !== null) {
    window.clearInterval(buildPollTimer);
  }
  buildPollTimer = window.setInterval(async () => {
    await refreshBuildStatus(false);
    if (!ui.build.building) {
      if (buildPollTimer !== null) {
        window.clearInterval(buildPollTimer);
        buildPollTimer = null;
      }
      if (ui.build.releaseReady && desiredBuildProfile === "release") {
        await setBridgeBuildProfile("release");
      }
    }
  }, 1000);
}

function applyBuildStatus(status: BridgeBuildStatus): void {
  ui.build = status;
  desiredBuildProfile =
    status.requestedProfile === "release" || status.activeProfile === "release"
      ? "release"
      : desiredBuildProfile;
}

async function reconnectAfterBridgeRestart(resumePlayback = false): Promise<void> {
  const token = ++bridgeReconnectToken;
  ui.status = "REARMING";
  renderUi();
  await sleep(700);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (token !== bridgeReconnectToken) {
      return;
    }
    if (romBytes.length > 0) {
      if (await loadBytesThroughBridge(romDisplayName, romBytes)) {
        await refreshBuildStatus(true);
        restoreBridgePlaybackAfterRestart(resumePlayback);
        return;
      }
    } else if (await connectBridge(false)) {
      await refreshBuildStatus(true);
      restoreBridgePlaybackAfterRestart(resumePlayback);
      return;
    }
    await sleep(350);
  }
  scheduleBridgeRetry();
}

function pauseBridgeForRestart(): boolean {
  const wasPlaying = ui.playing;
  bridgeRestarting = true;
  bridgeReconnectToken += 1;
  ui.playing = false;
  playToggle.textContent = "Play";
  stopBridgeStream();
  return wasPlaying;
}

function restoreBridgePlaybackAfterRestart(wasPlaying: boolean): void {
  if (!wasPlaying || ui.runtime !== "bridge" || !ui.loaded) {
    renderUi();
    return;
  }
  ui.playing = true;
  ui.status = "RUNNING";
  playToggle.textContent = "Pause";
  resetScheduledAudio();
  void ensureAudio();
  void bridgeStreamLoop();
  renderUi();
}

function emptyBuildStatus(): BridgeBuildStatus {
  return {
    activeProfile: "debug",
    requestedProfile: "debug",
    building: false,
    releaseReady: false,
    armed: false,
    lastStatus: "cold",
    lastMessage: "Bridge build status cold",
    releasePath: "target/release/euther-oxide",
    updatedUnixMs: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scheduleBridgeRetry(): void {
  if (isTauri || bridgeRetryTimer !== null || ui.runtime === "bridge") {
    return;
  }
  bridgeRetryTimer = window.setInterval(() => void retryBridgeConnection(), 1500);
}

function stopBridgeRetry(): void {
  if (bridgeRetryTimer !== null) {
    window.clearInterval(bridgeRetryTimer);
    bridgeRetryTimer = null;
  }
}

async function retryBridgeConnection(): Promise<void> {
  if (ui.runtime === "bridge") {
    stopBridgeRetry();
    return;
  }
  if (lastBrowserFile && ui.loaded) {
    if (romBytes.length === 0) {
      romBytes = new Uint8Array(await lastBrowserFile.arrayBuffer());
    }
    if (await loadBytesThroughBridge(lastBrowserFile.name, romBytes)) {
      stopBridgeRetry();
    }
    return;
  }
  if (romBytes.length > 0 && ui.loaded) {
    if (await loadBytesThroughBridge(romDisplayName, romBytes)) {
      stopBridgeRetry();
    }
    return;
  }
  if (await connectBridge(false)) {
    stopBridgeRetry();
  }
}

async function bridgeJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 0,
): Promise<T> {
  const response = await bridgeRequest(path, init, timeoutMs);
  return (await response.json()) as T;
}

async function bridgeFrame(timeoutMs = 0): Promise<FrameResult> {
  const response = await bridgeRequest("/frame.bin", { method: "POST" }, timeoutMs);
  const buffer = await response.arrayBuffer();
  return decodeBridgeFrame(buffer);
}

async function bridgeAudio(timeoutMs = 0): Promise<AudioResult> {
  const response = await bridgeRequest("/audio.bin", { method: "POST" }, timeoutMs);
  const buffer = await response.arrayBuffer();
  return decodeBridgeAudio(buffer);
}

async function bridgeFrameAudio(timeoutMs = 0): Promise<FrameAudioResult> {
  const response = await bridgeRequest("/frame-audio.bin", { method: "POST" }, timeoutMs);
  const buffer = await response.arrayBuffer();
  return decodeBridgeFrameAudio(buffer);
}

function readBridgeClientId(): string {
  const stored = localStorage.getItem(bridgeClientStorageKey);
  if (stored) {
    return stored;
  }
  const generated =
    globalThis.crypto?.randomUUID?.() ??
    `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(bridgeClientStorageKey, generated);
  return generated;
}

function bridgeUrl(path: string): string {
  const url = new URL(path, bridgeBase);
  url.searchParams.set("client", bridgeClientId);
  url.searchParams.set("player", String(playerPort));
  return url.toString();
}

async function bridgeStreamRequest(signal: AbortSignal): Promise<Response> {
  const response = await fetch(bridgeUrl("/stream-frame-audio.bin"), {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response;
}

async function nativeBridgeRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 0,
): Promise<Response> {
  if (!nativeBridgeBase) {
    nativeBridgeBase = await invoke<string>("native_bridge_url");
    if (!nativeBridgeBase) {
      throw new Error("Tauri native bridge is not armed");
    }
    pushTrace("Tauri localhost transport armed");
  }
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout =
    controller && window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${nativeBridgeBase}${path}`, {
      ...init,
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  } finally {
    if (timeout) {
      window.clearTimeout(timeout);
    }
  }
}

async function tauriLocalFrameAudio(): Promise<FrameAudioResult> {
  const response = await nativeBridgeRequest("/frame-audio.bin");
  const buffer = await response.arrayBuffer();
  return { ...decodeBridgeFrameAudio(buffer), transport: "TAURI LOCALHOST AUDIO" };
}

async function tauriNativeFrame(): Promise<NativeFrameResult> {
  return await invoke<NativeFrameResult>("run_native_frame");
}

async function tauriNativeStatus(): Promise<NativeFrameResult | null> {
  return await invoke<NativeFrameResult | null>("native_frame_status");
}

async function tauriFrameAudio(): Promise<FrameAudioResult> {
  try {
    const packet = await invoke<ArrayBuffer | Uint8Array<ArrayBuffer> | number[]>(
      "run_frame_audio_packet",
    );
    const transport =
      packet instanceof ArrayBuffer
        ? "TAURI RAW BUFFER"
        : packet instanceof Uint8Array
          ? "TAURI RAW UINT8"
          : "TAURI RAW ARRAY";
    const buffer =
      packet instanceof ArrayBuffer
        ? packet
        : packet instanceof Uint8Array
          ? packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength)
          : new Uint8Array(packet).buffer;
    return { ...decodeBridgeFrameAudio(buffer), transport };
  } catch (error) {
    pushTrace(`Tauri IPC missed: ${String(error)}`);
  }

  try {
    return await tauriLocalFrameAudio();
  } catch (error) {
    nativeBridgeBase = null;
    pushTrace(`Tauri localhost missed: ${String(error)}`);
    throw error;
  }
}

function decodeBridgeFrameAudio(
  buffer: ArrayBuffer,
  deferVideo = false,
): DecodedFrameAudioPacket {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const headerLength = magic === "EOX2" || magic === "EOX3" || magic === "EOX4" ? 52 : 48;
  if (
    bytes.length < headerLength ||
    (magic !== "EOXB" && magic !== "EOX2" && magic !== "EOX3" && magic !== "EOX4")
  ) {
    throw new Error("Bad EutherOxide frame/audio packet");
  }
  const view = new DataView(buffer);
  const hasChannels = magic === "EOX2" || magic === "EOX3" || magic === "EOX4";
  const isRgb565 = magic === "EOX3" || magic === "EOX4";
  const isAudioFirst = magic === "EOX4";
  const frame = view.getUint32(4, true);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const cpuCycles = view.getUint32(16, true);
  const cpuSteps = view.getUint32(20, true);
  const frameMs = view.getUint32(24, true) / 1000;
  const stopped = view.getUint32(28, true) !== 0;
  const sampleRate = view.getUint32(32, true);
  const sampleCount = view.getUint32(36, true);
  const videoLength = view.getUint32(40, true);
  const pcmLength = view.getUint32(44, true);
  const channels = hasChannels ? Math.max(1, view.getUint32(48, true)) : 1;
  const pcmOffset = isAudioFirst ? headerLength : headerLength + videoLength;
  const videoOffset = isAudioFirst ? headerLength + pcmLength : headerLength;
  const videoEnd = videoOffset + videoLength;
  const expectedVideoLength = isRgb565 ? width * height * 2 : width * height * 4;
  if (
    videoLength !== expectedVideoLength ||
    pcmLength !== sampleCount * channels * 2 ||
    bytes.byteLength !== headerLength + videoLength + pcmLength
  ) {
    throw new Error("EutherOxide frame/audio packet size mismatch");
  }
  const rgba = deferVideo && isAudioFirst
    ? new Uint8ClampedArray(0) as Uint8ClampedArray<ArrayBuffer>
    : isRgb565
      ? decodeRgb565Frame(bytes.subarray(videoOffset, videoEnd), width, height)
      : bytes.subarray(videoOffset, videoEnd);
  return {
    frame: {
      frame,
      width,
      height,
      rgba,
      cpuCycles,
      cpuSteps,
      frameMs,
      stopped,
      lastError: null,
    },
    audio: {
      frame,
      sampleRate,
      samples: new Int16Array(buffer, pcmOffset, sampleCount * channels) as Int16Array<ArrayBuffer>,
      channels,
    },
    transport: isRgb565 ? "BRIDGE RGB565 PACKET" : "BRIDGE RGBA PACKET",
    videoFormat: isAudioFirst ? "RGB565_AUDIO_FIRST" : isRgb565 ? "RGB565" : "RGBA",
    videoBytes: deferVideo && isAudioFirst ? bytes : undefined,
    videoOffset: deferVideo && isAudioFirst ? videoOffset : undefined,
    videoLength: deferVideo && isAudioFirst ? videoLength : undefined,
  };
}

function finishDeferredVideoFrame(packet: DecodedFrameAudioPacket): void {
  if (
    packet.videoFormat !== "RGB565_AUDIO_FIRST" ||
    !packet.videoBytes ||
    packet.videoOffset === undefined ||
    packet.videoLength === undefined
  ) {
    return;
  }
  packet.frame.rgba = decodeRgb565Frame(
    packet.videoBytes.subarray(packet.videoOffset, packet.videoOffset + packet.videoLength),
    packet.frame.width,
    packet.frame.height,
  );
}

function decodeRgb565Frame(
  data: Uint8Array<ArrayBufferLike>,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4) as Uint8ClampedArray<ArrayBuffer>;
  let output = 0;
  for (let index = 0; index < data.byteLength; index += 2) {
    const value = data[index] | (data[index + 1] << 8);
    const r5 = (value >> 11) & 0x1f;
    const g6 = (value >> 5) & 0x3f;
    const b5 = value & 0x1f;
    pixels[output] = (r5 << 3) | (r5 >> 2);
    pixels[output + 1] = (g6 << 2) | (g6 >> 4);
    pixels[output + 2] = (b5 << 3) | (b5 >> 2);
    pixels[output + 3] = 255;
    output += 4;
  }
  return pixels;
}

function decodeBridgeAudio(buffer: ArrayBuffer): AudioResult {
  const bytes = new Uint8Array(buffer);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const headerLength = magic === "EOA2" ? 20 : 16;
  if (
    bytes.length < headerLength ||
    (magic !== "EOXA" && magic !== "EOA2")
  ) {
    throw new Error("Bad EutherOxide audio packet");
  }
  const view = new DataView(buffer);
  const hasChannels = magic === "EOA2";
  const frame = view.getUint32(4, true);
  const sampleRate = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const channels = hasChannels ? Math.max(1, view.getUint32(16, true)) : 1;
  const pcmOffset = headerLength;
  if (bytes.byteLength !== pcmOffset + count * channels * 2) {
    throw new Error("EutherOxide audio packet size mismatch");
  }
  const samples = new Int16Array(buffer, pcmOffset, count * channels) as Int16Array<ArrayBuffer>;
  return { frame, sampleRate, samples, channels };
}

function decodeBridgeFrame(buffer: ArrayBuffer): FrameResult {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 32 ||
    bytes[0] !== 0x45 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x58 ||
    bytes[3] !== 0x46
  ) {
    throw new Error("Bad EutherOxide frame packet");
  }
  const view = new DataView(buffer);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const rgba = bytes.subarray(32);
  if (rgba.byteLength !== width * height * 4) {
    throw new Error("EutherOxide frame packet size mismatch");
  }
  return {
    frame: view.getUint32(4, true),
    width,
    height,
    rgba,
    cpuCycles: view.getUint32(16, true),
    cpuSteps: view.getUint32(20, true),
    frameMs: view.getUint32(24, true) / 1000,
    stopped: view.getUint32(28, true) !== 0,
    lastError: null,
  };
}

async function bridgeRequest(
  path: string,
  init: RequestInit = {},
  timeoutMs = 0,
): Promise<Response> {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout =
    controller && window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(bridgeUrl(path), {
      ...init,
      headers,
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
  } finally {
    if (timeout) {
      window.clearTimeout(timeout);
    }
  }
}

async function animationLoop(): Promise<void> {
  if (!ui.playing) {
    return;
  }
  const now = performance.now();
  if (now >= nextFrameDue - 1) {
    await advanceFrame();
    const frameMs = 1000 / (ui.timing === "PAL" ? 50 : 60);
    nextFrameDue += frameMs;
    if (nextFrameDue < performance.now() - frameMs) {
      nextFrameDue = performance.now();
    }
  }
  window.requestAnimationFrame(() => void animationLoop());
}

function stopBridgeStream(): void {
  bridgeStreamGeneration += 1;
  bridgeStreamAbort?.abort();
  bridgeStreamAbort = null;
  bridgeStreamActive = false;
  resetScheduledAudio();
}

async function bridgeStreamLoop(): Promise<void> {
  if (bridgeStreamActive) {
    return;
  }
  bridgeStreamActive = true;
  const generation = bridgeStreamGeneration;
  bridgeStreamAbort = new AbortController();
  const started = performance.now();
  let received = 0;
  let pending = new Uint8Array(0) as Uint8Array<ArrayBufferLike>;
  try {
    const response = await bridgeStreamRequest(bridgeStreamAbort.signal);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Bridge stream body unavailable");
    }
    pushTrace("Bridge stream bonded");
    while (generation === bridgeStreamGeneration && ui.playing && ui.runtime === "bridge") {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      if (!read.value) {
        continue;
      }
      pending = appendBytes(pending, read.value);
      let latestFrameAudio: DecodedFrameAudioPacket | null = null;
      const audioBatch: AudioResult[] = [];
      let batchCount = 0;
      const before = performance.now();
      while (pending.byteLength >= 4) {
        const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
        const packetLength = view.getUint32(0, true);
        if (pending.byteLength < 4 + packetLength) {
          break;
        }
        const packet = pending.slice(4, 4 + packetLength);
        pending = pending.slice(4 + packetLength);
        if (generation !== bridgeStreamGeneration || !ui.playing || ui.runtime !== "bridge") {
          break;
        }
        const frameAudio = decodeBridgeFrameAudio(packet.buffer, true);
        if (frameAudio.videoFormat === "RGB565_AUDIO_FIRST") {
          audioBatch.push(frameAudio.audio);
        }
        latestFrameAudio = frameAudio;
        batchCount += 1;
        received += 1;
      }
      if (latestFrameAudio) {
        if (audioBatch.length > 0) {
          ui.audioLeadMs = await scheduleAudioBatch(audioBatch);
        }
        finishDeferredVideoFrame(latestFrameAudio);
        const decoded = performance.now();
        drawNativeFrame(latestFrameAudio.frame);
        const drawn = performance.now();
        if (latestFrameAudio.videoFormat !== "RGB565_AUDIO_FIRST") {
          ui.audioLeadMs = await scheduleAudio(latestFrameAudio.audio);
        }
        ui.transportMode =
          latestFrameAudio.videoFormat?.startsWith("RGB565") ? "BRIDGE RGB565 STREAM" : "BRIDGE STREAM";
        ui.transportMs = received === batchCount ? decoded - started : decoded - before;
        ui.drawMs = drawn - decoded;
        applyBridgeFrame(latestFrameAudio.frame);
        renderUi();
        if (latestFrameAudio.frame.stopped) {
          ui.playing = false;
          playToggle.textContent = "Play";
          pushTrace("CPU reached unsupported reaction");
          stopBridgeStream();
          return;
        }
      }
    }
  } catch (error) {
    if (ui.playing && ui.runtime === "bridge" && !bridgeRestarting) {
      ui.lastError = String(error);
      if (ui.lastError.toLowerCase().includes("busy")) {
        ui.playing = false;
        playToggle.textContent = "Play";
        ui.status = "BUSY";
        ui.transportMode = "VIEWER";
        resetScheduledAudio();
        pushTrace("Bridge player slot occupied");
        renderUi();
      } else {
        pushTrace("Bridge stream fell back");
        nextFrameDue = performance.now();
        void animationLoop();
      }
    }
  } finally {
    if (generation === bridgeStreamGeneration) {
      bridgeStreamActive = false;
      bridgeStreamAbort = null;
    }
  }
}

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (left.byteLength === 0) {
    return right;
  }
  const out = new Uint8Array(left.byteLength + right.byteLength);
  out.set(left, 0);
  out.set(right, left.byteLength);
  return out;
}

function applyBridgeFrame(frame: FrameResult): void {
  ui.frame = frame.frame;
  ui.cpuCycles = frame.cpuCycles;
  ui.cpuSteps = frame.cpuSteps;
  ui.frameMs = frame.frameMs;
  ui.status = frame.stopped ? "STOPPED" : ui.playing ? "RUNNING" : "STEPPED";
  ui.lastError = frame.lastError ?? "";
}

function applyNativeFrameStatus(frame: NativeFrameResult, transportMs: number): void {
  ui.transportMs = transportMs;
  ui.drawMs = 0;
  ui.audioLeadMs = frame.audioLeadMs;
  ui.transportMode = frame.audioActive ? "TAURI RUST LOOP" : "TAURI RUST VIDEO";
  ui.frame = frame.frame;
  ui.width = frame.width;
  ui.height = frame.height;
  ui.cpuCycles = frame.cpuCycles;
  ui.cpuSteps = frame.cpuSteps;
  ui.frameMs = frame.frameMs;
  ui.status = frame.stopped ? "STOPPED" : ui.playing ? "RUNNING" : "STEPPED";
  ui.lastError = frame.lastError ?? "";
  if (frame.stopped) {
    ui.playing = false;
    playToggle.textContent = "Play";
    void invoke("set_native_running", { running: false });
    pushTrace("CPU reached unsupported reaction");
  }
}

async function nativeStatusLoop(): Promise<void> {
  if (nativeStatusPolling) {
    return;
  }
  nativeStatusPolling = true;
  try {
    while (ui.playing && isTauri && ui.runtime === "tauri" && ui.loaded) {
      const started = performance.now();
      const frame = await tauriNativeStatus();
      const done = performance.now();
      if (frame) {
        applyNativeFrameStatus(frame, done - started);
        renderUi();
      }
      await sleep(80);
    }
  } finally {
    nativeStatusPolling = false;
  }
}

async function advanceFrame(): Promise<void> {
  if (stepping) {
    return;
  }
  stepping = true;
  try {
    if (dogsMode) {
      runDogsFrame();
    } else if (isTauri && ui.runtime === "tauri" && ui.loaded) {
      const fetchStart = performance.now();
      const frame = await tauriNativeFrame();
      const fetchDone = performance.now();
      applyNativeFrameStatus(frame, fetchDone - fetchStart);
    } else if (ui.runtime === "bridge") {
      const fetchStart = performance.now();
      const frameAudio =
        ui.runtime === "bridge"
          ? await bridgeFrameAudio()
          : null;
      const frame = frameAudio?.frame ?? await invoke<FrameResult>("run_frame");
      const fetchDone = performance.now();
      drawNativeFrame(frame);
      const drawDone = performance.now();
      if (frameAudio) {
        ui.audioLeadMs = await scheduleAudio(frameAudio.audio);
        ui.transportMode = frameAudio.transport;
      } else {
        ui.transportMode = "FRAME JSON";
        void queueNativeAudio();
      }
      ui.transportMs = fetchDone - fetchStart;
      ui.drawMs = drawDone - fetchDone;
      ui.frame = frame.frame;
      ui.cpuCycles = frame.cpuCycles;
      ui.cpuSteps = frame.cpuSteps;
      ui.frameMs = frame.frameMs;
      ui.status = frame.stopped ? "STOPPED" : ui.playing ? "RUNNING" : "STEPPED";
      ui.lastError = frame.lastError ?? "";
      if (frame.stopped) {
        ui.playing = false;
        playToggle.textContent = "Play";
        pushTrace("CPU reached unsupported reaction");
      }
    } else {
      ui.frame += 1;
      ui.cpuCycles = 488 * 262;
      ui.cpuSteps = Math.max(1, Math.floor(420 + ((romHash ^ ui.frame) & 0xff)));
      ui.frameMs = 16.67;
      ui.transportMs = 0;
      ui.drawMs = 0;
      ui.audioLeadMs = 0;
      ui.transportMode = "WEB SYNTH";
      ui.status = ui.playing ? "WEB RUN" : "WEB STEP";
      drawSyntheticFrame();
    }
  } finally {
    renderUi();
    stepping = false;
  }
}

async function queueNativeAudio(): Promise<void> {
  if (!ui.playing || !ui.loaded) {
    return;
  }
  try {
    const audio =
      ui.runtime === "bridge"
        ? await bridgeAudio()
        : isTauri && ui.runtime === "tauri"
          ? await invoke<AudioResult>("render_audio_frame")
          : null;
    if (audio) {
      ui.audioLeadMs = await scheduleAudio(audio);
    }
  } catch {
    pushTrace("Audio bridge warming");
  }
}

function readStoredVolume(): number {
  const stored = Number(localStorage.getItem(volumeStorageKey));
  return Number.isFinite(stored) ? clampVolume(stored) : 0.8;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.8;
  }
  return Math.min(1, Math.max(0, value));
}

function readStoredMobileMode(): boolean {
  const stored = localStorage.getItem(mobileModeStorageKey);
  if (stored === "1") {
    return true;
  }
  if (stored === "0") {
    return false;
  }
  return window.matchMedia("(max-width: 760px)").matches;
}

function setMobileMode(enabled: boolean): void {
  mobileMode = enabled;
  localStorage.setItem(mobileModeStorageKey, enabled ? "1" : "0");
  resetScheduledAudio();
  applyMobileMode();
}

function applyMobileMode(): void {
  document.body.classList.toggle("mobile-play-mode", mobileMode);
  mobileToggle.classList.toggle("is-active", mobileMode);
  mobileToggle.setAttribute("aria-pressed", mobileMode ? "true" : "false");
  mobileToggle.textContent = mobileMode ? "Desk" : "Mobile";
  ui.audioLeadMs = 0;
}

function enterDogsMode(): void {
  dogsMode = true;
  dogsState = createDogsState(0xC0FFEE);
  resetScheduledAudio();
  stopBridgeStream();
  Object.assign(ui, {
    loaded: true,
    playing: false,
    runtime: "web" as const,
    title: "EutherDogs",
    region: "RX",
    timing: "60HZ",
    resetPc: 0,
    width: dogsCanvas.width,
    height: dogsCanvas.height,
    frame: 0,
    cpuCycles: 0,
    cpuSteps: 0,
    frameMs: 16.67,
    transportMode: "DOGS CORE",
    status: "DOGS READY",
    lastError: "",
  });
  playToggle.textContent = "Play";
  document.body.classList.add("eutherdogs-mode");
  eutherDogsToggle.classList.add("is-active");
  drawDogsFrame();
  renderUi();
  pushTrace("EutherDogs shift started");
}

function leaveDogsMode(): void {
  dogsMode = false;
  ui.playing = false;
  ui.loaded = false;
  ui.title = "No ROM";
  ui.status = "IDLE";
  playToggle.textContent = "Play";
  document.body.classList.remove("eutherdogs-mode");
  eutherDogsToggle.classList.remove("is-active");
  drawSyntheticFrame();
  renderUi();
}

function resetDogsMode(): void {
  dogsState = createDogsState(0xC0FFEE);
  ui.playing = false;
  ui.frame = 0;
  ui.status = "DOGS RESET";
  playToggle.textContent = "Play";
  drawDogsFrame();
  renderUi();
}

function createDogsState(seed: number): DogsState {
  const width = 40;
  const height = 28;
  const tiles = Array<DogsTile>(width * height).fill("floor");
  let rng = seed >>> 0;
  const next = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng;
  };
  const set = (x: number, y: number, tile: DogsTile) => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      tiles[y * width + x] = tile;
    }
  };
  for (let x = 0; x < width; x += 1) {
    set(x, 0, "wall");
    set(x, height - 1, "wall");
  }
  for (let y = 0; y < height; y += 1) {
    set(0, y, "wall");
    set(width - 1, y, "wall");
  }
  for (let i = 0; i < 115; i += 1) {
    const x = 2 + (next() % (width - 4));
    const y = 2 + (next() % (height - 4));
    set(x, y, next() % 5 === 0 ? "prop" : "wall");
  }
  for (let i = 0; i < 8; i += 1) {
    set(2 + (next() % (width - 4)), 2 + (next() % (height - 4)), "pickup");
  }
  for (let i = 0; i < 5; i += 1) {
    set(2 + (next() % (width - 4)), 2 + (next() % (height - 4)), "target");
  }
  set(width - 3, height - 3, "exit");
  for (let y = 1; y < 5; y += 1) {
    for (let x = 1; x < 7; x += 1) {
      set(x, y, "floor");
    }
  }
  return {
    width,
    height,
    tiles,
    player: { x: 2, y: 2, hp: 100, alive: true, score: 0, cash: 0, weapon: 0, ammo: [-1, 12] },
    enemies: [
      { x: 30, y: 4, hp: 35, alive: true },
      { x: 24, y: 18, hp: 35, alive: true },
      { x: 10, y: 20, hp: 35, alive: true },
      { x: 34, y: 22, hp: 35, alive: true },
    ],
    bullets: [],
    targetsLeft: tiles.filter((tile) => tile === "target").length,
    objectsLeft: tiles.filter((tile) => tile === "pickup").length,
    status: "RUNNING",
    ticks: 0,
  };
}

function runDogsFrame(): void {
  const started = performance.now();
  stepDogsState();
  drawDogsFrame();
  const done = performance.now();
  ui.frame += 1;
  ui.cpuCycles = dogsState.enemies.filter((enemy) => enemy.alive).length;
  ui.cpuSteps = dogsState.bullets.length;
  ui.frameMs = 16.67;
  ui.transportMs = 0;
  ui.drawMs = done - started;
  ui.audioLeadMs = 0;
  ui.status = `DOGS ${dogsState.status}`;
  if (dogsState.status !== "RUNNING") {
    ui.playing = false;
    playToggle.textContent = "Play";
  }
}

function stepDogsState(): void {
  if (dogsState.status !== "RUNNING") {
    return;
  }
  dogsState.ticks += 1;
  let dx = 0;
  let dy = 0;
  if (inputState.left) dx -= 1;
  if (inputState.right) dx += 1;
  if (inputState.up) dy -= 1;
  if (inputState.down) dy += 1;
  moveDogsActor(dogsState.player, dx, dy);
  if ((inputState.a || inputState.b) && dogsState.ticks % 8 === 0) {
    dogsFire("player", dx || 1, dy);
  }
  if (inputState.c && dogsState.ticks % 12 === 0) {
    dogsState.player.weapon = (dogsState.player.weapon + 1) % dogsState.player.ammo.length;
  }
  dogsCollect();
  for (const enemy of dogsState.enemies) {
    if (!enemy.alive) continue;
    const ex = Math.sign(dogsState.player.x - enemy.x);
    const ey = Math.sign(dogsState.player.y - enemy.y);
    if (Math.abs(dogsState.player.x - enemy.x) <= 1 && Math.abs(dogsState.player.y - enemy.y) <= 1) {
      dogsState.player.hp -= 1;
    } else if (dogsState.ticks % 2 === 0) {
      moveDogsActor(enemy, ex, ey);
    }
    if (dogsState.ticks % 40 === 0) {
      dogsFire("enemy", ex || -1, ey, enemy);
    }
  }
  moveDogsBullets();
  if (dogsState.player.hp <= 0) {
    dogsState.player.alive = false;
    dogsState.status = "LOST";
  } else if (
    dogsState.targetsLeft === 0 &&
    dogsState.objectsLeft === 0 &&
    dogsTileAt(dogsState.player.x, dogsState.player.y) === "exit"
  ) {
    dogsState.status = "WON";
  }
}

function moveDogsActor(actor: DogsActor, dx: number, dy: number): void {
  const nx = actor.x + Math.sign(dx);
  const ny = actor.y + Math.sign(dy);
  if (!dogsBlocks(nx, actor.y)) actor.x = nx;
  if (!dogsBlocks(actor.x, ny)) actor.y = ny;
}

function dogsFire(owner: "player" | "enemy", dx: number, dy: number, source?: DogsActor): void {
  const actor = owner === "player" ? dogsState.player : source;
  if (!actor || (owner === "player" && dogsState.player.ammo[dogsState.player.weapon] === 0)) return;
  if (owner === "player" && dogsState.player.ammo[dogsState.player.weapon] > 0) {
    dogsState.player.ammo[dogsState.player.weapon] -= 1;
  }
  dogsState.bullets.push({ x: actor.x, y: actor.y, dx: Math.sign(dx) || 1, dy: Math.sign(dy), owner, ttl: 36 });
}

function moveDogsBullets(): void {
  const kept: DogsBullet[] = [];
  for (const bullet of dogsState.bullets) {
    bullet.x += bullet.dx;
    bullet.y += bullet.dy;
    bullet.ttl -= 1;
    const tile = dogsTileAt(bullet.x, bullet.y);
    if (bullet.ttl <= 0 || tile === "wall") continue;
    if (tile === "target" && bullet.owner === "player") {
      setDogsTile(bullet.x, bullet.y, "floor");
      dogsState.targetsLeft = Math.max(0, dogsState.targetsLeft - 1);
      dogsState.player.score += 250;
      dogsState.player.cash += 50;
      continue;
    }
    const actors = bullet.owner === "player" ? dogsState.enemies : [dogsState.player];
    const hit = actors.find((actor) => actor.alive && actor.x === bullet.x && actor.y === bullet.y);
    if (hit) {
      hit.hp -= bullet.owner === "player" ? 20 : 8;
      if (hit.hp <= 0) {
        hit.alive = false;
        if (bullet.owner === "player") {
          dogsState.player.score += 100;
          dogsState.player.cash += 25;
        }
      }
      continue;
    }
    kept.push(bullet);
  }
  dogsState.bullets = kept;
}

function dogsCollect(): void {
  if (dogsTileAt(dogsState.player.x, dogsState.player.y) !== "pickup") return;
  setDogsTile(dogsState.player.x, dogsState.player.y, "floor");
  dogsState.objectsLeft = Math.max(0, dogsState.objectsLeft - 1);
  dogsState.player.score += 25;
  dogsState.player.cash += 5;
  dogsState.player.ammo[1] += 2;
}

function dogsTileAt(x: number, y: number): DogsTile {
  if (x < 0 || y < 0 || x >= dogsState.width || y >= dogsState.height) return "wall";
  return dogsState.tiles[y * dogsState.width + x];
}

function setDogsTile(x: number, y: number, tile: DogsTile): void {
  if (x >= 0 && y >= 0 && x < dogsState.width && y < dogsState.height) {
    dogsState.tiles[y * dogsState.width + x] = tile;
  }
}

function dogsBlocks(x: number, y: number): boolean {
  const tile = dogsTileAt(x, y);
  return tile === "wall" || tile === "prop" || tile === "target";
}

function drawDogsFrame(): void {
  const tileW = dogsCanvas.width / dogsState.width;
  const tileH = dogsCanvas.height / dogsState.height;
  dogsContext.fillStyle = "#07100d";
  dogsContext.fillRect(0, 0, dogsCanvas.width, dogsCanvas.height);
  const colors: Record<DogsTile, string> = {
    floor: "#dfe8dc",
    wall: "#263630",
    target: "#ff37c8",
    pickup: "#39f7c8",
    exit: "#f7d852",
    prop: "#65716b",
  };
  for (let y = 0; y < dogsState.height; y += 1) {
    for (let x = 0; x < dogsState.width; x += 1) {
      dogsContext.fillStyle = colors[dogsTileAt(x, y)];
      dogsContext.fillRect(x * tileW, y * tileH, Math.ceil(tileW), Math.ceil(tileH));
    }
  }
  dogsContext.fillStyle = "#1a1f1c";
  dogsContext.globalAlpha = 0.12;
  for (let x = 0; x < dogsCanvas.width; x += tileW) dogsContext.fillRect(x, 0, 1, dogsCanvas.height);
  for (let y = 0; y < dogsCanvas.height; y += tileH) dogsContext.fillRect(0, y, dogsCanvas.width, 1);
  dogsContext.globalAlpha = 1;
  for (const enemy of dogsState.enemies) {
    if (!enemy.alive) continue;
    dogsContext.fillStyle = "#f04444";
    dogsContext.fillRect(enemy.x * tileW, enemy.y * tileH, tileW, tileH);
  }
  dogsContext.fillStyle = "#101014";
  for (const bullet of dogsState.bullets) {
    dogsContext.fillRect(bullet.x * tileW + tileW * 0.35, bullet.y * tileH + tileH * 0.35, tileW * 0.3, tileH * 0.3);
  }
  if (dogsState.player.alive) {
    dogsContext.fillStyle = "#ffffff";
    dogsContext.fillRect(dogsState.player.x * tileW, dogsState.player.y * tileH, tileW, tileH);
    dogsContext.fillStyle = "#27f2ff";
    dogsContext.fillRect(dogsState.player.x * tileW + 2, dogsState.player.y * tileH + 2, tileW - 4, tileH - 4);
  }
  const hud = document.querySelector<HTMLDivElement>("#eutherdogs-hud");
  if (hud) {
    const ammo = dogsState.player.ammo[dogsState.player.weapon];
    hud.textContent = `HP ${dogsState.player.hp} | $${dogsState.player.cash} | SCORE ${dogsState.player.score} | RX ${dogsState.objectsLeft} | TARGETS ${dogsState.targetsLeft} | AMMO ${ammo < 0 ? "INF" : ammo} | ${dogsState.status}`;
  }
}

function readStoredPlayerPort(): PlayerPort {
  return localStorage.getItem(playerPortStorageKey) === "2" ? 2 : 1;
}

function setPlayerPort(port: PlayerPort): void {
  if (playerPort === port) {
    return;
  }
  playerPort = port;
  localStorage.setItem(playerPortStorageKey, String(port));
  lastInputJson = "";
  resetScheduledAudio();
  if (ui.runtime === "bridge" && ui.playing) {
    stopBridgeStream();
    void bridgeStreamLoop();
  }
  renderPlayerPort();
}

function renderPlayerPort(): void {
  playerPortButtons.forEach((button) => {
    const selected = Number(button.dataset.playerPort ?? 1) === playerPort;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function setAudioVolume(value: number): void {
  audioVolume = clampVolume(value);
  localStorage.setItem(volumeStorageKey, audioVolume.toString());
  updateVolumeUi();
  applyAudioVolume();
}

function updateVolumeUi(): void {
  volumeValue.textContent = `${Math.round(audioVolume * 100)}%`;
}

function applyAudioVolume(): void {
  if (audioGain && audioContext) {
    audioGain.gain.setTargetAtTime(audioVolume, audioContext.currentTime, 0.01);
  }
  if (isTauri) {
    void invoke("set_audio_volume", { volume: audioVolume });
  }
}

function resetScheduledAudio(): void {
  for (const source of activeAudioSources) {
    try {
      source.stop();
    } catch {
      // Already ended or not started yet.
    }
  }
  activeAudioSources.clear();
  audioCursor = audioContext?.currentTime ?? 0;
  ui.audioLeadMs = 0;
}

async function ensureAudio(): Promise<AudioContext | null> {
  const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioCtor();
    audioGain = audioContext.createGain();
    audioGain.connect(audioContext.destination);
    applyAudioVolume();
    audioCursor = audioContext.currentTime;
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  return audioContext;
}

async function scheduleAudioBatch(batch: AudioResult[]): Promise<number> {
  if (batch.length === 0) {
    return 0;
  }
  if (batch.length === 1) {
    return scheduleAudio(batch[0]);
  }
  const sampleRate = batch[0].sampleRate;
  const channels = Math.max(1, Math.floor(batch[0].channels ?? 1));
  let sampleCount = 0;
  for (const audio of batch) {
    if (audio.sampleRate !== sampleRate || Math.max(1, Math.floor(audio.channels ?? 1)) !== channels) {
      return scheduleAudio(batch[batch.length - 1]);
    }
    sampleCount += audio.samples.length;
  }
  const samples = new Int16Array(sampleCount);
  let offset = 0;
  for (const audio of batch) {
    const source =
      audio.samples instanceof Int16Array
        ? audio.samples
        : Int16Array.from(audio.samples);
    samples.set(source, offset);
    offset += source.length;
  }
  return scheduleAudio({
    frame: batch[batch.length - 1].frame,
    sampleRate,
    samples,
    channels,
  });
}

async function scheduleAudio(audio: AudioResult): Promise<number> {
  const samples =
    audio.samples instanceof Int16Array
      ? audio.samples
      : Int16Array.from(audio.samples);
  if (samples.length === 0) {
    return 0;
  }
  const channels = Math.max(1, Math.floor(audio.channels ?? 1));
  const frameCount = Math.floor(samples.length / channels);
  if (frameCount === 0) {
    return 0;
  }
  if (isTauri && ui.runtime === "tauri" && channels === 1) {
    try {
      const result = await invoke<NativeAudioResult>("play_native_audio", {
        samples: Array.from(samples),
        sampleRate: audio.sampleRate,
      });
      if (result.active) {
        return result.queuedMs;
      }
    } catch {
      pushTrace("Native audio warming");
    }
  }

  const context = await ensureAudio();
  if (!context) {
    return 0;
  }
  const timing = audioLeadTiming();
  const outputChannels = channels === 1 ? 1 : 2;
  const buffer = context.createBuffer(outputChannels, frameCount, audio.sampleRate);
  if (channels === 1) {
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = samples[index] / 32768;
    }
  } else {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = 0; index < frameCount; index += 1) {
      const sampleOffset = index * channels;
      left[index] = samples[sampleOffset] / 32768;
      right[index] = samples[sampleOffset + 1] / 32768;
    }
  }

  const now = context.currentTime;
  if (audioCursor > now + timing.maximum) {
    resetScheduledAudio();
    audioCursor = now + timing.target;
  } else if (audioCursor < now + timing.minimum) {
    audioCursor = now + timing.target;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(audioGain ?? context.destination);
  activeAudioSources.add(source);
  source.onended = () => activeAudioSources.delete(source);
  source.start(audioCursor);
  const leadMs = Math.max(0, (audioCursor - now) * 1000);
  audioCursor += buffer.duration;
  return leadMs;
}

function audioLeadTiming(): { target: number; minimum: number; maximum: number } {
  if (ui.runtime === "bridge") {
    if (mobileMode) {
      return {
        target: mobileBridgeAudioTargetLeadSeconds,
        minimum: mobileBridgeAudioMinimumLeadSeconds,
        maximum: mobileBridgeAudioMaximumLeadSeconds,
      };
    }
    return {
      target: bridgeAudioTargetLeadSeconds,
      minimum: bridgeAudioMinimumLeadSeconds,
      maximum: bridgeAudioMaximumLeadSeconds,
    };
  }
  return {
    target: localAudioTargetLeadSeconds,
    minimum: localAudioMinimumLeadSeconds,
    maximum: localAudioMaximumLeadSeconds,
  };
}

function drawNativeFrame(frame: FrameResult): void {
  syncScreenGeometry(frame.width, frame.height);
  if (videoCanvas.width !== frame.width || videoCanvas.height !== frame.height) {
    videoCanvas.width = frame.width;
    videoCanvas.height = frame.height;
  }
  const image = new ImageData(
    framePixels(frame.rgba),
    frame.width,
    frame.height,
  );
  videoContext.putImageData(image, 0, 0);
  renderShaderFrame();
}

function syncScreenGeometry(width: number, height: number): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  ui.width = safeWidth;
  ui.height = safeHeight;
  screenGlass.style.setProperty("--screen-aspect-value", (safeWidth / safeHeight).toFixed(6));
  screenGlass.style.setProperty("--screen-aspect-ratio", `${safeWidth} / ${safeHeight}`);
}

function framePixels(
  rgba: number[] | Uint8Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike>,
): Uint8ClampedArray<ArrayBuffer> {
  if (rgba instanceof Uint8ClampedArray) {
    return rgba as Uint8ClampedArray<ArrayBuffer>;
  }
  const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba);
  const pixels = new Uint8ClampedArray(bytes.byteLength) as Uint8ClampedArray<ArrayBuffer>;
  pixels.set(bytes);
  return pixels;
}

async function refreshStateSlots(): Promise<void> {
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
      applyStateSlots(await invoke<StateSlotsResult>("list_state_slots"));
      return;
    } catch (error) {
      ui.lastError = String(error);
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
      applyStateSlots(await bridgeJson<StateSlotsResult>("/states"));
      return;
    } catch (error) {
      ui.lastError = String(error);
    }
  }
  loadWebSlots();
}

async function saveStateSlot(slot: number): Promise<void> {
  if (!ui.loaded) {
    return;
  }
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
      applyStateSlots(await invoke<StateSlotsResult>("save_state_slot", { slot }));
      pushTrace(`Argon slot ${slot} sealed`);
      renderUi();
      return;
    } catch (error) {
      ui.lastError = String(error);
      pushTrace("Native argon save rejected");
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
      applyStateSlots(
        await bridgeJson<StateSlotsResult>(`/state/save?slot=${slot}`, {
          method: "POST",
        }),
      );
      pushTrace(`Argon slot ${slot} sealed`);
      renderUi();
      return;
    } catch (error) {
      ui.lastError = String(error);
      pushTrace("Bridge argon save rejected");
    }
  }

  const index = slot - 1;
  webStateSlots[index] = {
    frame: ui.frame,
    cpuCycles: ui.cpuCycles,
    cpuSteps: ui.cpuSteps,
    frameMs: ui.frameMs,
    status: ui.status,
  };
  persistWebSlots();
  ui.stateSlots = webSlotSummaries();
  pushTrace(`Web argon slot ${slot} held`);
  renderUi();
}

async function loadStateSlot(slot: number): Promise<void> {
  if (!ui.loaded) {
    return;
  }
  const wasPlaying = ui.playing;
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
      ui.playing = false;
      playToggle.textContent = "Play";
      await invoke("set_native_running", { running: false });
      const result = await invoke<LoadStateResult>("load_state_slot", { slot });
      drawNativeFrame(result.frame);
      ui.frame = result.frame.frame;
      ui.cpuCycles = result.frame.cpuCycles;
      ui.cpuSteps = result.frame.cpuSteps;
      ui.frameMs = result.frame.frameMs;
      ui.lastError = result.frame.lastError ?? "";
      ui.status = `ARGON ${slot}`;
      applyStateSlots(result.states);
      pushTrace(`Argon slot ${slot} reduced`);
      resetScheduledAudio();
      if (wasPlaying) {
        ui.playing = true;
        playToggle.textContent = "Pause";
        await invoke("set_native_running", { running: true });
        void nativeStatusLoop();
      }
      renderUi();
      return;
    } catch (error) {
      ui.playing = wasPlaying;
      playToggle.textContent = ui.playing ? "Pause" : "Play";
      if (wasPlaying) {
        await invoke("set_native_running", { running: true });
        void nativeStatusLoop();
      }
      ui.lastError = String(error);
      pushTrace("Native argon load rejected");
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
      ui.playing = false;
      playToggle.textContent = "Play";
      stopBridgeStream();
      const result = await bridgeJson<LoadStateResult>(`/state/load?slot=${slot}`, {
        method: "POST",
      });
      drawNativeFrame(result.frame);
      ui.frame = result.frame.frame;
      ui.cpuCycles = result.frame.cpuCycles;
      ui.cpuSteps = result.frame.cpuSteps;
      ui.frameMs = result.frame.frameMs;
      ui.lastError = result.frame.lastError ?? "";
      ui.status = `ARGON ${slot}`;
      applyStateSlots(result.states);
      pushTrace(`Argon slot ${slot} reduced`);
      resetScheduledAudio();
      await syncInput();
      if (wasPlaying) {
        ui.playing = true;
        ui.status = "RUNNING";
        playToggle.textContent = "Pause";
        void ensureAudio();
        void bridgeStreamLoop();
      }
      renderUi();
      return;
    } catch (error) {
      ui.playing = wasPlaying;
      playToggle.textContent = ui.playing ? "Pause" : "Play";
      if (wasPlaying) {
        void bridgeStreamLoop();
      }
      ui.lastError = String(error);
      pushTrace("Bridge argon load rejected");
    }
  }

  const snapshot = webStateSlots[slot - 1];
  if (!snapshot) {
    return;
  }
  ui.frame = snapshot.frame;
  ui.cpuCycles = snapshot.cpuCycles;
  ui.cpuSteps = snapshot.cpuSteps;
  ui.frameMs = snapshot.frameMs;
  ui.status = `ARGON ${slot}`;
  drawSyntheticFrame();
  pushTrace(`Web argon slot ${slot} restored`);
  renderUi();
}

function drawSyntheticFrame(): void {
  const width = 320;
  const height = 224;
  syncScreenGeometry(width, height);
  if (videoCanvas.width !== width || videoCanvas.height !== height) {
    videoCanvas.width = width;
    videoCanvas.height = height;
  }
  const image = videoContext.createImageData(width, height);
  const data = image.data;
  const t = ui.frame;
  const inputPulse =
    Number(inputState.a) * 31 +
    Number(inputState.b) * 57 +
    Number(inputState.c) * 83 +
    Number(inputState.start) * 127;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const wave = Math.sin((x + t * 3) * 0.045) + Math.cos((y - t * 2) * 0.065);
      const carbon = (x * 3 + y * 5 + romHash + t * 7 + inputPulse) & 255;
      const bond = Math.abs(((x - width / 2) * (y - height / 2) + t * 11) % 113) < 5;
      data[index] = bond ? 226 : 24 + ((carbon + wave * 34) & 63);
      data[index + 1] = bond ? 245 : 64 + (((carbon >> 1) + y + t) & 95);
      data[index + 2] = bond ? 172 : 50 + (((romHash >> 8) + x + inputPulse) & 79);
      data[index + 3] = 255;
    }
  }

  videoContext.putImageData(image, 0, 0);
  videoContext.fillStyle = "rgba(12, 17, 14, 0.62)";
  videoContext.fillRect(14, 14, 108, 34);
  videoContext.fillStyle = "#dff7c1";
  videoContext.font = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
  videoContext.fillText(ui.loaded ? ui.timing : "C-O CORE", 24, 36);
  renderShaderFrame();
}

async function syncInput(): Promise<void> {
  const next = JSON.stringify(inputState);
  if (next === lastInputJson) {
    return;
  }
  lastInputJson = next;
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    try {
      await invoke("set_input", { input: inputState });
    } catch {
      ui.runtime = "web";
      pushTrace("Input bridge fallback");
    }
  } else if (ui.runtime === "bridge" && ui.loaded) {
    try {
      await bridgeRequest("/input", {
        method: "POST",
        body: JSON.stringify({ ...inputState, player: playerPort }),
      });
    } catch {
      pushTrace("Core bridge input missed");
    }
  }
}

function updatePadButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((button) => {
    const name = button.dataset.pad as keyof InputState;
    button.classList.toggle("is-active", inputState[name]);
  });
}

function applyStateSlots(result: StateSlotsResult): void {
  ui.statePath = result.path ?? ui.statePath ?? null;
  ui.stateSlots = normalizeStateSlots(result.slots);
  ui.nativeStates = Boolean(result.path);
}

function loadWebSlots(): void {
  ui.nativeStates = false;
  ui.statePath = `${stemName(romDisplayName)}.argon`;
  try {
    const raw = window.localStorage.getItem(webStateKey());
    const parsed = raw
      ? (JSON.parse(raw) as { slots?: Array<WebStateSnapshot | null> })
      : null;
    webStateSlots = normalizeWebSlots(parsed?.slots ?? []);
  } catch {
    webStateSlots = [null, null, null];
  }
  ui.stateSlots = webSlotSummaries();
}

function persistWebSlots(): void {
  window.localStorage.setItem(
    webStateKey(),
    JSON.stringify({
      magic: "EUTHEROXIDE_WEB_ARGON",
      version: 1,
      romHash,
      slots: webStateSlots,
    }),
  );
}

async function restoreCachedRom(): Promise<void> {
  if (isTauri || ui.loaded) {
    return;
  }
  const cached = await readCachedRom();
  if (!cached) {
    return;
  }

  romBytes = cached.bytes;
  romDisplayName = cached.name;
  romHash = cached.hash || hashBytes(cached.bytes);
  Object.assign(ui, parseWebHeader(romBytes, romDisplayName));
  ui.loaded = true;
  ui.runtime = "web";
  ui.nativeStates = false;
  ui.status = "ROM CACHE";
  ui.lastError = "";
  document.querySelector("#rom-name")!.textContent = romDisplayName;
  loadWebSlots();
  drawSyntheticFrame();
  pushTrace("Browser ROM cache restored");
  renderUi();

  if (!(await loadBytesThroughBridge(romDisplayName, romBytes))) {
    scheduleBridgeRetry();
  }
}

async function persistCachedRom(name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri || !window.indexedDB) {
    return;
  }
  await withRomStore<IDBValidKey>("readwrite", (store) =>
    store.put({
      key: "last",
      name,
      bytes: copyArrayBuffer(bytes),
      hash: hashBytes(bytes),
      savedUnixMs: Date.now(),
    } satisfies CachedRomRecord),
  ).catch(() => undefined);
}

async function readCachedRom(): Promise<{
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  hash: number;
} | null> {
  if (!window.indexedDB) {
    return null;
  }
  const record = await withRomStore<CachedRomRecord | undefined>("readonly", (store) =>
    store.get("last") as IDBRequest<CachedRomRecord | undefined>,
  ).catch(() => undefined);
  if (!record?.bytes || typeof record.name !== "string") {
    return null;
  }
  const bytes = new Uint8Array(record.bytes.slice(0)) as Uint8Array<ArrayBuffer>;
  if (bytes.length === 0) {
    return null;
  }
  return {
    name: record.name,
    bytes,
    hash: record.hash >>> 0,
  };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function openRomCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(romCacheDb, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(romCacheStore)) {
        db.createObjectStore(romCacheStore, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open ROM cache"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function withRomStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openRomCacheDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(romCacheStore, mode);
    const request = action(transaction.objectStore(romCacheStore));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    const fail = () => {
      db.close();
      reject(transaction.error ?? request.error ?? new Error("ROM cache request failed"));
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
  });
}

function webSlotSummaries(): StateSlot[] {
  return webStateSlots.map((slot, index) => ({
    slot: index + 1,
    occupied: Boolean(slot),
    createdUnixMs: slot ? Date.now() : null,
    frameCount: slot?.frame ?? null,
    label: slot ? `Frame ${slot.frame}` : null,
  }));
}

function normalizeWebSlots(slots: Array<WebStateSnapshot | null>): Array<WebStateSnapshot | null> {
  return Array.from({ length: 3 }, (_, index) => slots[index] ?? null);
}

function emptySlots(): StateSlot[] {
  return Array.from({ length: 3 }, (_, index) => ({
    slot: index + 1,
    occupied: false,
    createdUnixMs: null,
    frameCount: null,
    label: null,
  }));
}

function normalizeStateSlots(slots: StateSlot[]): StateSlot[] {
  const bySlot = new Map(slots.map((slot) => [slot.slot, slot]));
  return emptySlots().map((slot) => bySlot.get(slot.slot) ?? slot);
}

function renderStateSlots(): void {
  const bySlot = new Map(ui.stateSlots.map((slot) => [slot.slot, slot]));
  stateGrid.querySelectorAll<HTMLElement>("[data-slot-row]").forEach((row) => {
    const slotNumber = Number(row.dataset.slotRow ?? 0);
    const slot = bySlot.get(slotNumber);
    const label = row.querySelector("strong")!;
    const save = row.querySelector<HTMLButtonElement>('[data-state-action="save"]')!;
    const load = row.querySelector<HTMLButtonElement>('[data-state-action="load"]')!;
    label.textContent = slot?.occupied ? slot.label ?? `Frame ${slot.frameCount ?? "?"}` : "Empty";
    save.disabled = !ui.loaded;
    load.disabled = !ui.loaded || !Boolean(slot?.occupied);
  });
}

function renderUi(): void {
  document.querySelector("#game-title")!.textContent = ui.title;
  document.querySelector("#status-text")!.textContent = ui.status;
  document.querySelector("#frame-count")!.textContent = String(ui.frame);
  document.querySelector("#timing-mode")!.textContent = ui.timing;
  document.querySelector("#region-mode")!.textContent = ui.region;
  document.querySelector("#reset-pc")!.textContent = `$${ui.resetPc.toString(16).padStart(6, "0").toUpperCase()}`;
  document.querySelector("#cycle-count")!.textContent = String(ui.cpuCycles);
  document.querySelector("#step-count")!.textContent = String(ui.cpuSteps);
  document.querySelector("#frame-ms")!.textContent = ui.frameMs.toFixed(2);
  document.querySelector("#bridge-mode")!.textContent = ui.runtime.toUpperCase();
  document.querySelector("#fetch-ms")!.textContent = ui.transportMs.toFixed(2);
  document.querySelector("#draw-ms")!.textContent = ui.drawMs.toFixed(2);
  document.querySelector("#audio-lead-ms")!.textContent = ui.audioLeadMs.toFixed(0);
  document.querySelector("#transport-mode")!.textContent = ui.transportMode;
  document.querySelector("#build-id")!.textContent = WEB_BUILD_ID;
  document.querySelector("#runtime-chip")!.textContent =
    ui.runtime === "tauri"
      ? "TAURI 2 CORE"
      : ui.runtime === "bridge"
        ? "CORE BRIDGE"
        : "WEB VIEW";
  playToggle.disabled = !ui.loaded;
  stepFrame.disabled = !ui.loaded;
  resetCore.disabled = !ui.loaded;
  mobilePlay.disabled = !ui.loaded;
  mobilePlay.textContent = ui.playing ? "Pause" : "Play";
  screenGlass.classList.toggle("is-native-frame", ui.loaded && ui.runtime !== "web");
  renderPlayerPort();
  renderBuildControls();
  renderStateSlots();
  scheduleNativeSurfaceRectSync();
}

function renderBuildControls(): void {
  const bridgeOnline = ui.runtime === "bridge" && !isTauri;
  releaseBuild.disabled = !bridgeOnline || ui.build.building;
  releaseBuild.textContent = ui.build.building ? "Building" : "Build";
  const selectedProfile =
    desiredBuildProfile === "release" || ui.build.activeProfile === "release"
      ? "release"
      : "debug";
  buildProfileButtons.forEach((button) => {
    const profile = button.dataset.buildProfile === "release" ? "release" : "debug";
    button.classList.toggle("is-selected", profile === selectedProfile);
    button.disabled = !bridgeOnline || ui.build.building;
  });
  buildLamp.className = "build-lamp";
  buildLamp.classList.add(ui.build.armed ? "is-armed" : "is-cold");
  if (ui.build.building) {
    buildLamp.classList.add("is-building");
  }
  buildLamp.title = ui.build.armed
    ? "Release binary ready and armed"
    : ui.build.building
      ? "Release build running"
      : ui.build.releaseReady
        ? "Release binary ready"
        : "Release binary not ready";
}

function scheduleNativeSurfaceRectSync(): void {
  if (!isTauri) {
    return;
  }
  if (nativeSurfaceRectTimer !== null) {
    window.clearTimeout(nativeSurfaceRectTimer);
  }
  nativeSurfaceRectTimer = window.setTimeout(() => {
    nativeSurfaceRectTimer = null;
    void syncNativeSurfaceRect();
  }, 0);
}

async function syncNativeSurfaceRect(): Promise<void> {
  if (!isTauri) {
    return;
  }
  const rect = screenGlass.getBoundingClientRect();
  try {
    await invoke("set_native_surface_rect", {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  } catch {
    // The native surface is Linux/Tauri specific and may not be present in all dev modes.
  }
}

function pushTrace(message: string): void {
  const list = document.querySelector<HTMLOListElement>("#trace-list")!;
  const entry = document.createElement("li");
  entry.textContent = message;
  list.prepend(entry);
  while (list.children.length > 6) {
    list.lastElementChild?.remove();
  }
}

function parseWebHeader(bytes: Uint8Array, fallbackName: string): LoadResult {
  const headerOffset =
    ascii(bytes, 0x100, 4) === "SEGA" ? 0x100 : ascii(bytes, 0x300, 4) === "SEGA" ? 0x300 : -1;
  const regionText = headerOffset >= 0 ? ascii(bytes, headerOffset + 0xf0, 16).toUpperCase() : "";
  const title = headerOffset >= 0 ? ascii(bytes, headerOffset + 0x50, 48).trim() : "";
  const hasEurope = regionText.includes("E") || /^[89A-F]/.test(regionText);
  const hasUs = regionText.includes("U") || /^[4567CDEF]/.test(regionText);
  const hasJapan = regionText.includes("J") || /^[1237BDF]/.test(regionText);
  return {
    title: title || fallbackName,
    region: hasUs ? "US" : hasEurope ? "EU" : hasJapan ? "JP" : "AUTO",
    timing: hasEurope ? "PAL" : "NTSC",
    resetPc: readU32(bytes, 4),
    width: 320,
    height: 224,
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + index] ?? 32;
    out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : " ";
  }
  return out;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function tauriFilePath(file: File): string | null {
  const withPath = file as File & { path?: unknown };
  return typeof withPath.path === "string" ? withPath.path : null;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function stemName(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function webStateKey(): string {
  return `eutheroxide.argon.${romHash.toString(16)}`;
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(bytes.length / 4096));
  for (let index = 0; index < bytes.length; index += stride) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashText(value: string): number {
  return hashBytes(new TextEncoder().encode(value));
}

function startMoleculeField(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#molecule-field")!;
  const context = canvas.getContext("2d")!;
  const atoms = Array.from({ length: 86 }, (_, index) => ({
    x: Math.random(),
    y: Math.random(),
    r: 2 + (index % 6),
    phase: Math.random() * Math.PI * 2,
    kind: index % 7 === 0 ? "O" : index % 11 === 0 ? "H" : "C",
  }));

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    scheduleNativeSurfaceRectSync();
  };
  window.addEventListener("resize", resize);
  resize();

  const draw = (time: number) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const protectedRect = screenGlass.getBoundingClientRect();
    const guard = {
      left: protectedRect.left - 18,
      right: protectedRect.right + 18,
      top: protectedRect.top - 18,
      bottom: protectedRect.bottom + 18,
    };
    const inGuard = (x: number, y: number) =>
      x >= guard.left && x <= guard.right && y >= guard.top && y <= guard.bottom;

    context.clearRect(0, 0, width, height);
    context.save();
    context.globalCompositeOperation = "screen";
    context.lineWidth = 1.4;

    const waveY = height * 0.54 + Math.sin(time * 0.00022) * 18;
    context.strokeStyle = "rgba(245, 215, 125, 0.12)";
    context.beginPath();
    context.moveTo(0, waveY);
    for (let x = 0; x <= width; x += 44) {
      const y = waveY + Math.sin(x * 0.018 + time * 0.00058) * 34;
      context.lineTo(x, y);
    }
    context.stroke();

    context.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillStyle = "rgba(223, 246, 180, 0.13)";
    for (let index = 0; index < 9; index += 1) {
      const x = (index * 211 + time * 0.012) % (width + 180) - 90;
      const y = 72 + ((index * 83) % Math.max(1, height - 140));
      if (!inGuard(x, y)) {
        context.fillText(index % 3 === 0 ? "C=C" : index % 3 === 1 ? "O2" : "R-CHO", x, y);
      }
    }

    for (let i = 0; i < atoms.length; i += 1) {
      const atom = atoms[i];
      const x = atom.x * width + Math.sin(time * 0.00018 + atom.phase) * 24;
      const y = atom.y * height + Math.cos(time * 0.00021 + atom.phase) * 18;
      if (inGuard(x, y)) {
        continue;
      }
      for (let j = i + 1; j < atoms.length; j += 1) {
        const other = atoms[j];
        const ox = other.x * width + Math.sin(time * 0.00018 + other.phase) * 24;
        const oy = other.y * height + Math.cos(time * 0.00021 + other.phase) * 18;
        if (inGuard(ox, oy)) {
          continue;
        }
        const dx = x - ox;
        const dy = y - oy;
        const distance = Math.hypot(dx, dy);
        if (distance < 170) {
          context.strokeStyle = `rgba(168, 229, 139, ${0.16 * (1 - distance / 170)})`;
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(ox, oy);
          context.stroke();
        }
      }
      context.fillStyle =
        atom.kind === "O" ? "rgba(255, 95, 82, 0.38)" : atom.kind === "H" ? "rgba(240, 229, 154, 0.26)" : "rgba(161, 220, 168, 0.31)";
      context.beginPath();
      context.arc(x, y, atom.r, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();

    window.requestAnimationFrame(draw);
  };

  window.requestAnimationFrame(draw);
}

shaderRenderer = ShaderRenderer.create(shaderCanvas);
screenGlass.classList.toggle("has-shader", Boolean(shaderRenderer));
drawSyntheticFrame();
renderUi();
startMoleculeField();
void (async () => {
  await connectBridge();
  await restoreCachedRom();
})();
