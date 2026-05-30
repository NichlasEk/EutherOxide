import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WEB_BUILD_ID } from "./build-info";
import eutherDogsManifestToml from "../assets/eutherdogs/manifest.toml?raw";
import shaderToml from "./shaders.toml?raw";
import "./styles.css";

const controllerGuideUrl = new URL("./controller-bindings.svg", import.meta.url).href;
const eutherDogsAssetModules = import.meta.glob("../assets/eutherdogs/**/*.{png,wav}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

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
type LobbyRole = "player" | "spectator";
type DogsAssetMode = "classic" | "2x";
type DogsCharacterKey = "night_shift_tech" | "neon_pharmacist";
type DogsBridgeInput = InputState & {
  player: PlayerPort;
  seq?: number;
  weaponSlot?: number;
  inspectionAnswer?: "yes" | "no" | "other";
};

type LobbyPlayer = {
  player: number;
  occupied: boolean;
  user?: string | null;
};

type LobbyInstance = {
  id: string;
  name: string;
  loaded: boolean;
  title: string;
  frame: number;
  players: LobbyPlayer[];
  subscribers: number;
  spectators: number;
  host?: string | null;
  createdUnixMs?: number;
};

type LobbyStatus = {
  instances: LobbyInstance[];
};

type LobbyJoinResult = {
  instance: LobbyStatus;
  role: {
    kind: LobbyRole;
    player?: number | null;
  };
};

type LobbyStartResult = {
  instance: LobbyStatus;
  id: string;
};

type HostUserSummary = {
  name: string;
  banned: boolean;
  admin: boolean;
};

type HostUserList = {
  users: HostUserSummary[];
};

type AuthStatus = {
  authenticated: boolean;
  user?: string;
  isAdmin?: boolean;
  csrfToken?: string | null;
};

type ChatMessage = {
  id: number;
  user: string;
  message: string;
  createdUnixMs: number;
};

type ChatResult = {
  messages: ChatMessage[];
};

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

type DogsCoreActor = {
  id: number;
  faction: "player" | "hostile_customer" | string;
  x: number;
  y: number;
  direction: string;
  sprite?: string;
  armor: number;
  lives: number;
  alive: boolean;
  activeWeapon: string;
  ammo: number;
};

type DogsCoreBullet = {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  ownerFaction: "player" | "hostile_customer" | string;
  weapon: string;
};

type DogsProjectileStyle = {
  asset: string;
  color: string;
  size: number;
  trail: number;
  glow: number;
  impact: number;
  spins?: boolean;
};

type DogsImpactEffect = {
  id: string;
  x: number;
  y: number;
  weapon: string;
  ownerFaction: string;
  startFrame: number;
};

type DogsCoreSummary = {
  mission: number;
  maxMission: number;
  status: "running" | "won" | "lost" | string;
  elapsedTicks: number;
  score: number;
  cash: number;
  kills: number;
  targetsDestroyed: number;
  objectsCollected: number;
  shotsFired: number;
  hits: number;
  damageTaken: number;
  targetsLeft: number;
  objectsLeft: number;
  minimumKills: number;
  timeRemainingTicks?: number | null;
  bossActive?: boolean;
  bossName?: string | null;
  bossArmor?: number | null;
  bossMaxArmor?: number | null;
  routineRead?: number;
  routineTotal?: number;
  inspectionAnswers?: number;
  inspectionProtocol?: number;
};

type DogsStoreItem = {
  id: string;
  label: string;
  price: number;
  detail: string;
  weapon?: string | null;
  ammo: number;
  armor: number;
  owned: boolean;
  currentAmmo?: number | null;
  active: boolean;
  affordable: boolean;
};

type DogsCoreFrame = {
  frame: number;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  characterWidth: number;
  characterHeight: number;
  tiles: string[];
  visibility: number[];
  characters: DogsCoreActor[];
  bullets: DogsCoreBullet[];
  inspectionDialogues?: DogsInspectionDialogue[];
  summary: DogsCoreSummary;
  store: DogsStoreItem[];
  audioEvents?: string[];
  highscoreCount: number;
  ackedInputSeq?: number;
};

type DogsInspectionDialogue = {
  player: number;
  inspectorId: number;
  question: string;
  complete: boolean;
};

type DogsStreamFrame = Partial<DogsCoreFrame> &
  Pick<DogsCoreFrame, "frame" | "characters" | "bullets" | "summary">;

type DogsHighScoreEntry = {
  id: string;
  name: string;
  score: number;
  cash: number;
  mission: number;
  kills: number;
  targetsDestroyed: number;
  objectsCollected: number;
  elapsedTicks: number;
  completed: boolean;
  staff: string;
  createdAt: string;
};

type DogsMenuMode = "staff" | "store" | "briefing" | "scores" | "result" | null;
type DogsActorFacing = "down" | "left" | "right" | "up";

type DogsStaffOption = {
  id: 1 | 2;
  character: DogsCharacterKey;
  name: string;
  role: string;
  armor: number;
  cash: number;
  loadout: string;
  note: string;
};

const isTauri = Boolean(window.__TAURI_INTERNALS__);
document.documentElement.classList.toggle("is-tauri-shell", isTauri);
const pageParams = new URLSearchParams(window.location.search);
const explicitBridgeBase = pageParams.get("bridge");
const hostedServerMode =
  !import.meta.env.DEV && !isTauri && !explicitBridgeBase && window.location.port !== "" && window.location.port !== "5173";
const forceMegaDriveStartup = pageParams.get("megadrive") === "1" || pageParams.get("eutherdogs") === "0";
const autoStartEutherDogs =
  pageParams.get("eutherdogs") === "1" || (hostedServerMode && !forceMegaDriveStartup);
const bridgeBase =
  explicitBridgeBase ??
  (window.location.port && window.location.port !== "5173"
    ? window.location.origin
    : "http://127.0.0.1:32161");
const eutherDogsAssets = parseEutherDogsManifest(eutherDogsManifestToml, eutherDogsAssetModules);
const dogsStaffOptions: DogsStaffOption[] = [
  {
    id: 1,
    character: "night_shift_tech",
    name: "Night Tech",
    role: "Closing shift technician",
    armor: 100,
    cash: 500,
    loadout: "Scanner Blaster, Rx Cannon",
    note: "Knows where the prior-auth forms are buried.",
  },
  {
    id: 2,
    character: "neon_pharmacist",
    name: "Neon Pharmacist",
    role: "Counter lead",
    armor: 100,
    cash: 500,
    loadout: "Scanner Blaster",
    note: "Can say 'policy' without blinking.",
  },
];
const romCacheDb = "eutheroxide-rom-cache";
const romCacheStore = "roms";
const volumeStorageKey = "eutheroxide-audio-volume";
const bindingsStorageKey = "eutheroxide-input-bindings";
const shaderStorageKey = "eutheroxide-video-shader";
const shaderConfigStorageKey = "eutheroxide-video-shader-toml";
const mobileModeStorageKey = "eutheroxide-mobile-mode";
const dogsAssetModeStorageKey = "eutheroxide-eutherdogs-asset-mode";
const dogsCharactersStorageKey = "eutheroxide-eutherdogs-characters";
const bridgeClientStorageKey = "eutheroxide-bridge-client-id";
const playerPortStorageKey = "eutheroxide-player-port";
const dogsHighScoresStorageKey = "eutheroxide-eutherdogs-highscores";
const dogsHighScoreLimit = 10;
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
const eutherDogsCameraWorldWidth = 330;
const eutherDogsCameraWorldHeight = 230;
const eutherDogsRenderYScale = 4 / 3;
const eutherDogsTopHudSafePx = 50;
const eutherDogsBottomHudSafePx = 30;
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
let lobbyRole: LobbyRole = "player";
let activeLobbyInstanceId = "main";
let claimedLobbyPlayer: PlayerPort | null = null;
let hostUsername: string | null = null;
let hostIsAdmin = false;
let hostCsrfToken: string | null = null;
let lobbyStatus: LobbyStatus | null = null;
let hostUsers: HostUserSummary[] = [];
let selectedAdminUser: string | null = null;
let chatMessages: ChatMessage[] = [];
let chatPollTimer: number | null = null;
let desiredBuildProfile: "debug" | "release" = "debug";
let audioContext: AudioContext | null = null;
let audioGain: GainNode | null = null;
let audioCursor = 0;
const activeAudioSources = new Set<AudioScheduledSourceNode>();
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
let dogsFrame: DogsCoreFrame | null = null;
let dogsMenuMode: DogsMenuMode = null;
let dogsAssetMode: DogsAssetMode = readStoredDogsAssetMode();
let selectedDogsStaff: 1 | 2 = 1;
let selectedDogsCharacters: Record<PlayerPort, DogsCharacterKey> = readStoredDogsCharacters();
let selectedDogsMission = 1;
let dogsStorePreviewItemId: string | null = null;
let dogsSubmittedHighscoreFrame: number | null = null;
let dogsHighScoresTomlLoadAttempted = false;
let dogsPendingHighscoreFrame: DogsCoreFrame | null = null;
let dogsHighscoreInitials = ["A", "A", "A"];
let dogsHighscoreInitialIndex = 0;
let dogsHighscoreSavedName: string | null = null;
let dogsSelectedHighScoreIndex = 0;
let dogsScoresReturnMode: Exclude<DogsMenuMode, null> = "briefing";
let dogsMapOpen = false;
const dogsImageCache = new Map<string, HTMLImageElement>();
const dogsSfxCache = new Map<string, AudioBuffer>();
let dogsPreviousActorPositions = new Map<string, { x: number; y: number }>();
let dogsRenderActorPositions = new Map<string, { x: number; y: number }>();
let dogsActorFacings = new Map<string, DogsActorFacing>();
let dogsLastExitReady = false;
let dogsLastPortalHumFrame = -9999;
let dogsPreviousAudioFrame: DogsCoreFrame | null = null;
let dogsInspectionAlertStartFrame = -1;
let dogsInspectionAlertUntilFrame = -1;
let dogsInspectionAlertTitle = "INSPECTION!!!";
let dogsInspectionAlertSubtitle = "RETAIL COMPLIANCE BREACH";
let dogsSawHostileQueue = false;
let dogsTrackedBullets = new Map<number, DogsCoreBullet>();
let dogsImpactEffects: DogsImpactEffect[] = [];
let dogsLastImpactFrameProcessed = -1;
let dogsInspectionAnswerRects: Array<{
  answer: "yes" | "no" | "other";
  x: number;
  y: number;
  w: number;
  h: number;
}> = [];
let lastDogsInputJson = "";
let lastDogsInputSentAt = 0;
let lastDogsSnapshotAt = 0;
let dogsSnapshotMisses = 0;
let dogsStream: EventSource | null = null;
let lastDogsProcessedFrame = -1;
let dogsInputSeq = 0;
let dogsLastAckedInputSeq = 0;
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

      <div class="rail-section lobby-section">
        <div class="section-head">
          <p class="section-label">Lobby</p>
          <div class="section-actions">
            <button id="admin-open" class="mini-action" type="button" hidden>Admin</button>
            <button id="lobby-refresh" class="mini-action" type="button">Scan</button>
          </div>
        </div>
        <div class="lobby-card" id="lobby-card">
          <strong id="lobby-title">Main Reaction Vessel</strong>
          <span id="lobby-meta">No instance scan</span>
          <span id="lobby-host">Host: open</span>
        </div>
        <div class="lobby-instances" id="lobby-instances"></div>
        <div class="lobby-actions">
          <button id="instance-start" type="button">Start New</button>
          <button id="instance-join" type="button">Join</button>
          <button id="claim-p1" type="button">Claim P1</button>
          <button id="claim-p2" type="button">Claim P2</button>
          <button id="release-slot" type="button">Release</button>
          <button id="spectate-instance" type="button">Spectate</button>
          <button id="kick-p1" type="button">Kick P1</button>
          <button id="kick-p2" type="button">Kick P2</button>
          <button id="close-instance" type="button">Close</button>
        </div>
      </div>

      <div class="rail-section dogs-mode-section">
        <p class="section-label">EutherDogs</p>
        <button id="eutherdogs-toggle" class="primary-action" type="button">EutherDogs</button>
        <div class="dogs-asset-switch" aria-label="EutherDogs asset resolution">
          <button data-dogs-asset-mode="classic" type="button">Low</button>
          <button data-dogs-asset-mode="2x" type="button">2x</button>
        </div>
      </div>

      <details id="megadrive-panel" class="rail-section megadrive-panel" ${forceMegaDriveStartup ? "open" : ""}>
        <summary>
          <span>MegaDrive</span>
          <strong id="rom-name">Load Mega Drive</strong>
        </summary>

        <label class="rom-drop" id="rom-drop">
          <input id="rom-input" type="file" accept=".bin,.gen,.md,.smd,.rom" />
          <span>ROM Reagent</span>
          <strong>Choose ROM</strong>
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
          </div>
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
      </details>

      <div class="rail-section volume-section">
        <div class="volume-head">
          <p class="section-label">Volume</p>
          <strong id="volume-value">80%</strong>
        </div>
        <input id="volume-slider" type="range" min="0" max="100" value="80" aria-label="volume" />
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
          <div id="eutherdogs-console" class="eutherdogs-console" aria-hidden="true">
            <div class="eutherdogs-console-top">
              <div class="eutherdogs-logo"></div>
              <div class="eutherdogs-shift">
                <span>Night shift</span>
                <strong id="eutherdogs-alert">Mission 1/10</strong>
              </div>
            </div>
            <div class="eutherdogs-dispensary">
              <div>
                <span>Mission</span>
                <strong id="eutherdogs-rx-left">0</strong>
              </div>
              <div>
                <span id="eutherdogs-clock-label">Elapsed</span>
                <strong id="eutherdogs-clock">--</strong>
              </div>
            </div>
            <span id="eutherdogs-targets-left" hidden>0</span>
            <span id="eutherdogs-cash" hidden>$0</span>
            <div class="eutherdogs-vitals">
              <span id="eutherdogs-lamp" class="eutherdogs-lamp"></span>
              <div class="eutherdogs-health">
                <span id="eutherdogs-health-fill"></span>
              </div>
              <strong id="eutherdogs-weapon">Scanner</strong>
            </div>
          </div>
          <div id="eutherdogs-menu" class="eutherdogs-menu" aria-hidden="true">
            <div class="eutherdogs-menu-panel">
              <header>
                <div>
                  <span id="eutherdogs-menu-kicker">RX Store</span>
                  <h3 id="eutherdogs-menu-title">Counter Before Chaos</h3>
                </div>
                <strong id="eutherdogs-menu-cash">$0</strong>
              </header>
              <div id="eutherdogs-menu-body" class="eutherdogs-menu-body"></div>
              <footer>
                <button id="eutherdogs-staff-open" type="button">Staff</button>
                <button id="eutherdogs-store-open" type="button">RX Store</button>
                <button id="eutherdogs-briefing-open" type="button">Briefing</button>
                <button id="eutherdogs-scores-open" type="button">Scores</button>
                <button id="eutherdogs-start-shift" class="primary-action" type="button">Start shift</button>
              </footer>
            </div>
          </div>
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
      <div class="perf-drawer" id="perf-drawer">
        <button id="perf-toggle" class="perf-toggle" type="button">
          <span>Perf</span>
          <strong id="perf-summary">0.00 ms | 0 lead</strong>
        </button>
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
      </div>
      <div class="chat-panel">
        <div class="section-head">
          <p class="section-label">Reaction Chat</p>
          <button id="chat-refresh" class="mini-action" type="button">Sync</button>
        </div>
        <div id="chat-list" class="chat-list">
          <span>Chat offline</span>
        </div>
        <form id="chat-form" class="chat-form">
          <input id="chat-input" type="text" maxlength="320" placeholder="message" aria-label="chat message" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
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
  <div id="admin-modal" class="admin-modal" aria-hidden="true">
    <div class="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-title">
      <header class="admin-dialog-head">
        <div>
          <p class="eyebrow">Host Control</p>
          <h2 id="admin-title">Users</h2>
        </div>
        <div class="controls-actions">
          <button id="admin-refresh" class="mini-action" type="button">Sync</button>
          <button id="admin-close" class="mini-action" type="button">Close</button>
        </div>
      </header>
      <div class="admin-dialog-body">
        <section class="admin-list-panel">
          <p class="section-label">User List</p>
          <div class="admin-users" id="admin-users">
            <span>Host admin offline</span>
          </div>
        </section>
        <section class="admin-edit-panel">
          <p class="section-label">Edit User</p>
          <div class="admin-form">
            <input id="admin-username" type="text" placeholder="user" aria-label="user" />
            <input id="admin-password" type="password" placeholder="new password" aria-label="new password" />
            <button id="admin-user-add" type="button">Add/Reset</button>
          </div>
          <div class="admin-form">
            <input id="invite-email" type="email" placeholder="invite email placeholder" aria-label="invite email" />
            <button id="invite-send" type="button">Invite</button>
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
const perfDrawer = document.querySelector<HTMLDivElement>("#perf-drawer")!;
const perfToggle = document.querySelector<HTMLButtonElement>("#perf-toggle")!;
const perfSummary = document.querySelector<HTMLElement>("#perf-summary")!;
const chatRefresh = document.querySelector<HTMLButtonElement>("#chat-refresh")!;
const chatList = document.querySelector<HTMLDivElement>("#chat-list")!;
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!;
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!;
const romInput = document.querySelector<HTMLInputElement>("#rom-input")!;
const romDrop = document.querySelector<HTMLLabelElement>("#rom-drop")!;
const megaDrivePanel = document.querySelector<HTMLDetailsElement>("#megadrive-panel")!;
const lobbyRefresh = document.querySelector<HTMLButtonElement>("#lobby-refresh")!;
const lobbyTitle = document.querySelector<HTMLElement>("#lobby-title")!;
const lobbyMeta = document.querySelector<HTMLElement>("#lobby-meta")!;
const lobbyHost = document.querySelector<HTMLElement>("#lobby-host")!;
const lobbyInstances = document.querySelector<HTMLDivElement>("#lobby-instances")!;
const adminOpen = document.querySelector<HTMLButtonElement>("#admin-open")!;
const instanceStart = document.querySelector<HTMLButtonElement>("#instance-start")!;
const instanceJoin = document.querySelector<HTMLButtonElement>("#instance-join")!;
const claimP1 = document.querySelector<HTMLButtonElement>("#claim-p1")!;
const claimP2 = document.querySelector<HTMLButtonElement>("#claim-p2")!;
const releaseSlot = document.querySelector<HTMLButtonElement>("#release-slot")!;
const spectateInstance = document.querySelector<HTMLButtonElement>("#spectate-instance")!;
const kickP1 = document.querySelector<HTMLButtonElement>("#kick-p1")!;
const kickP2 = document.querySelector<HTMLButtonElement>("#kick-p2")!;
const closeInstance = document.querySelector<HTMLButtonElement>("#close-instance")!;
const adminModal = document.querySelector<HTMLDivElement>("#admin-modal")!;
const adminClose = document.querySelector<HTMLButtonElement>("#admin-close")!;
const adminRefresh = document.querySelector<HTMLButtonElement>("#admin-refresh")!;
const adminUsers = document.querySelector<HTMLDivElement>("#admin-users")!;
const adminUsername = document.querySelector<HTMLInputElement>("#admin-username")!;
const adminPassword = document.querySelector<HTMLInputElement>("#admin-password")!;
const adminUserAdd = document.querySelector<HTMLButtonElement>("#admin-user-add")!;
const inviteEmail = document.querySelector<HTMLInputElement>("#invite-email")!;
const inviteSend = document.querySelector<HTMLButtonElement>("#invite-send")!;
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle")!;
const stepFrame = document.querySelector<HTMLButtonElement>("#step-frame")!;
const resetCore = document.querySelector<HTMLButtonElement>("#reset-core")!;
const eutherDogsToggle = document.querySelector<HTMLButtonElement>("#eutherdogs-toggle")!;
const dogsAssetModeButtons = document.querySelectorAll<HTMLButtonElement>("[data-dogs-asset-mode]");
const stateGrid = document.querySelector<HTMLDivElement>("#state-grid")!;
const screenGlass = document.querySelector<HTMLDivElement>("#screen-glass")!;
const eutherDogsConsole = document.querySelector<HTMLDivElement>("#eutherdogs-console")!;
const eutherDogsAlert = document.querySelector<HTMLElement>("#eutherdogs-alert")!;
const eutherDogsRxLeft = document.querySelector<HTMLElement>("#eutherdogs-rx-left")!;
const eutherDogsTargetsLeft = document.querySelector<HTMLElement>("#eutherdogs-targets-left")!;
const eutherDogsCash = document.querySelector<HTMLElement>("#eutherdogs-cash")!;
const eutherDogsClockLabel = document.querySelector<HTMLElement>("#eutherdogs-clock-label")!;
const eutherDogsClock = document.querySelector<HTMLElement>("#eutherdogs-clock")!;
const eutherDogsLamp = document.querySelector<HTMLSpanElement>("#eutherdogs-lamp")!;
const eutherDogsHealthFill = document.querySelector<HTMLSpanElement>("#eutherdogs-health-fill")!;
const eutherDogsWeapon = document.querySelector<HTMLElement>("#eutherdogs-weapon")!;
const eutherDogsMenu = document.querySelector<HTMLDivElement>("#eutherdogs-menu")!;
const eutherDogsMenuKicker = document.querySelector<HTMLElement>("#eutherdogs-menu-kicker")!;
const eutherDogsMenuTitle = document.querySelector<HTMLElement>("#eutherdogs-menu-title")!;
const eutherDogsMenuCash = document.querySelector<HTMLElement>("#eutherdogs-menu-cash")!;
const eutherDogsMenuBody = document.querySelector<HTMLDivElement>("#eutherdogs-menu-body")!;
const eutherDogsStaffOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-staff-open")!;
const eutherDogsStoreOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-store-open")!;
const eutherDogsBriefingOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-briefing-open")!;
const eutherDogsScoresOpen = document.querySelector<HTMLButtonElement>("#eutherdogs-scores-open")!;
const eutherDogsStartShift = document.querySelector<HTMLButtonElement>("#eutherdogs-start-shift")!;
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
applyEutherDogsCssAssets();
initializeShaderControls();
void loadShaderConfigFile();
void loadRomDirSetting();
void refreshLobby();
void refreshHostUsers();
updateVolumeUi();
applyAudioVolume();
applyMobileMode();
renderDogsAssetMode();
renderPlayerPort();
volumeSlider.addEventListener("input", () => {
  setAudioVolume(Number(volumeSlider.value) / 100);
});

mobileToggle.addEventListener("click", () => {
  setMobileMode(!mobileMode);
});

dogsAssetModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setDogsAssetMode(button.dataset.dogsAssetMode === "2x" ? "2x" : "classic");
  });
});

playerPortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (claimedLobbyPlayer !== null) {
      setPlayerPort(claimedLobbyPlayer);
      pushTrace(`Player locked to claimed P${claimedLobbyPlayer}`);
      return;
    }
    setPlayerPort(button.dataset.playerPort === "2" ? 2 : 1);
  });
});

lobbyRefresh.addEventListener("click", () => {
  void refreshLobby();
});

lobbyInstances.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-instance-id]");
  if (!button) {
    return;
  }
  const previousInstanceId = activeLobbyInstanceId;
  activeLobbyInstanceId = button.dataset.instanceId ?? "main";
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  stopBridgeStream();
  await releaseLobbySlot(false, previousInstanceId);
  renderLobby();
  await connectBridge(false);
});

instanceStart.addEventListener("click", async () => {
  await startLobbyInstance();
});

instanceJoin.addEventListener("click", async () => {
  await joinLobbyInstance();
});

claimP1.addEventListener("click", async () => {
  await joinLobbyInstance(1);
});

claimP2.addEventListener("click", async () => {
  await joinLobbyInstance(2);
});

releaseSlot.addEventListener("click", async () => {
  await releaseLobbySlot();
});

spectateInstance.addEventListener("click", async () => {
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  stopBridgeStream();
  await releaseLobbySlot(false);
  renderLobby();
});

kickP1.addEventListener("click", async () => {
  await kickLobbyPlayer(1);
});

kickP2.addEventListener("click", async () => {
  await kickLobbyPlayer(2);
});

closeInstance.addEventListener("click", async () => {
  await closeLobbyInstance();
});

adminOpen.addEventListener("click", async () => {
  if (!hostIsAdmin) {
    return;
  }
  adminModal.classList.add("is-open");
  adminModal.setAttribute("aria-hidden", "false");
  await refreshHostUsers();
});

adminClose.addEventListener("click", () => {
  adminModal.classList.remove("is-open");
  adminModal.setAttribute("aria-hidden", "true");
});

adminRefresh.addEventListener("click", () => {
  void refreshHostUsers();
});

adminUserAdd.addEventListener("click", async () => {
  await addOrResetHostUser();
});

adminUsers.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const select = target.closest<HTMLButtonElement>("[data-admin-select]");
  if (select) {
    selectedAdminUser = select.dataset.adminSelect ?? null;
    adminUsername.value = selectedAdminUser ?? "";
    adminPassword.value = "";
    renderHostUsers();
    return;
  }
  const adminButton = target.closest<HTMLButtonElement>("[data-admin-admin]");
  if (adminButton) {
    const username = adminButton.dataset.adminAdmin ?? "";
    const admin = adminButton.dataset.admin === "1";
    const result = await bridgeJson<HostUserList>(
      "/api/admin/users/admin",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, admin: String(admin) }),
      },
      1200,
    );
    hostUsers = result.users;
    selectedAdminUser = username;
    renderHostUsers();
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-admin-ban]");
  if (!button) {
    return;
  }
  const username = button.dataset.adminBan ?? "";
  const banned = button.dataset.banned === "1";
  const result = await bridgeJson<HostUserList>(
    "/api/admin/users/ban",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, banned: String(banned) }),
    },
    1200,
  );
  hostUsers = result.users;
  renderHostUsers();
});

inviteSend.addEventListener("click", async () => {
  await sendInvitePlaceholder();
});

perfToggle.addEventListener("click", () => {
  perfDrawer.classList.toggle("is-open");
});

chatRefresh.addEventListener("click", () => {
  void refreshChat();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendChatMessage();
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
    if (!canHostMutate()) {
      pushTrace("Host owner required");
      return;
    }
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
    if (!canHostMutate()) {
      pushTrace("Host owner required");
      return;
    }
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
    if (!canHostMutate()) {
      pushTrace("Host owner required");
      return;
    }
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
  if (dogsMode) {
    if (ui.playing) {
      startDogsSnapshotStream();
      nextFrameDue = performance.now();
      void ensureAudio();
      void animationLoop();
    } else {
      stopDogsSnapshotStream();
    }
    return;
  }
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
    void enterDogsMode();
  }
});

eutherDogsStaffOpen.addEventListener("click", () => {
  showDogsMenu("staff");
});

eutherDogsStoreOpen.addEventListener("click", () => {
  showDogsMenu("store");
});

eutherDogsBriefingOpen.addEventListener("click", () => {
  showDogsMenu("briefing");
});

eutherDogsScoresOpen.addEventListener("click", () => {
  dogsSelectedHighScoreIndex = 0;
  dogsScoresReturnMode = dogsMenuMode && dogsMenuMode !== "scores" ? dogsMenuMode : "briefing";
  showDogsMenu("scores");
});

eutherDogsStartShift.addEventListener("click", () => {
  if (dogsMenuMode === "scores") {
    showDogsMenu(dogsScoresReturnMode);
    return;
  }
  if (dogsMenuMode === "result") {
    if (dogsFrame?.summary.status === "won") {
      if ((dogsFrame.summary.mission ?? selectedDogsMission) >= (dogsFrame.summary.maxMission ?? 10)) {
        showDogsMenu("staff");
        return;
      }
      void startDogsNextMission();
      return;
    }
    void retryDogsShift();
    return;
  }
  startDogsShift();
});

eutherDogsMenuBody.addEventListener("click", (event) => {
  const initialButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-initial]");
  if (initialButton) {
    dogsHighscoreInitialIndex = Number(initialButton.dataset.scoreInitial) || 0;
    renderDogsMenu();
    return;
  }
  const initialStep = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-step]");
  if (initialStep) {
    stepDogsHighscoreInitial(Number(initialStep.dataset.scoreStep) || 1);
    renderDogsMenu();
    return;
  }
  const scoreSubmit = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-submit]");
  if (scoreSubmit) {
    void submitPendingDogsHighScore();
    return;
  }
  const scoreBack = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-back]");
  if (scoreBack) {
    showDogsMenu(dogsScoresReturnMode);
    return;
  }
  const scoreRow = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-score-row]");
  if (scoreRow) {
    dogsSelectedHighScoreIndex = Number(scoreRow.dataset.scoreRow) || 0;
    renderDogsMenu();
    return;
  }
  const staffButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-staff-id]");
  if (staffButton) {
    const staff = staffButton.dataset.staffId === "2" ? 2 : 1;
    void selectDogsStaff(staff);
    return;
  }
  const missionButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-dogs-mission]");
  if (missionButton) {
    void selectDogsMission(Number(missionButton.dataset.dogsMission) || 1);
    return;
  }
  const buyButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-store-buy]");
  if (buyButton) {
    if (!buyButton.disabled) void purchaseDogsStoreItem(buyButton.dataset.storeBuy ?? "");
    return;
  }
  const itemButton = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!itemButton) return;
  dogsStorePreviewItemId = itemButton.dataset.storeItem ?? dogsStorePreviewItemId;
  renderDogsMenu();
});

eutherDogsMenuBody.addEventListener("mouseover", (event) => {
  if ((event.target as HTMLElement).closest("[data-store-buy]")) return;
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!button || dogsMenuMode !== "store") return;
  const itemId = button.dataset.storeItem ?? null;
  if (itemId && dogsStorePreviewItemId !== itemId) {
    dogsStorePreviewItemId = itemId;
    renderDogsMenu();
  }
});

eutherDogsMenuBody.addEventListener("focusin", (event) => {
  if ((event.target as HTMLElement).closest("[data-store-buy]")) return;
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!button || dogsMenuMode !== "store") return;
  dogsStorePreviewItemId = button.dataset.storeItem ?? dogsStorePreviewItemId;
  renderDogsMenu();
});

eutherDogsMenuBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const buyButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-store-buy]");
  if (buyButton) return;
  const item = (event.target as HTMLElement).closest<HTMLElement>("[data-store-item]");
  if (!item || dogsMenuMode !== "store") return;
  dogsStorePreviewItemId = item.dataset.storeItem ?? dogsStorePreviewItemId;
  renderDogsMenu();
  event.preventDefault();
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
    if (!canHostMutate()) {
      return;
    }
    await saveStateSlot(slot);
  } else {
    if (!canHostMutate()) {
      return;
    }
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

dogsCanvas.addEventListener("pointerdown", (event) => {
  if (!dogsMode || !dogsFrame || dogsInspectionAnswerRects.length === 0) {
    return;
  }
  const bounds = dogsCanvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * (dogsCanvas.width / bounds.width);
  const y = (event.clientY - bounds.top) * (dogsCanvas.height / bounds.height);
  const hit = dogsInspectionAnswerRects.find((rect) =>
    x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
  );
  if (!hit) {
    return;
  }
  event.preventDefault();
  void answerDogsInspection(hit.answer);
});

window.addEventListener("keydown", (event) => {
  if (controlsOpen && event.key === "Escape") {
    closeControls();
    event.preventDefault();
    return;
  }
  if (isEditableEventTarget(event.target)) {
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
  if (event.key === "Shift" && dogsMode && dogsFrame) {
    dogsMapOpen = true;
    drawDogsFrame(dogsFrame);
    event.preventDefault();
    return;
  }
  const dogsWeaponSlot = dogsWeaponSlotForKey(event);
  if (dogsWeaponSlot !== null) {
    event.preventDefault();
    if (!event.repeat) {
      void syncDogsWeaponSlot(dogsWeaponSlot);
    }
    return;
  }
  if (dogsMode && dogsFrame && !event.repeat) {
    const dialogue = dogsLocalInspectionDialogue(dogsFrame);
    const answer = event.key.toLowerCase();
    if (dialogue && !dialogue.complete && (answer === "y" || answer === "n" || answer === "o")) {
      event.preventDefault();
      void answerDogsInspection(answer === "y" ? "yes" : answer === "n" ? "no" : "other");
      return;
    }
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
  if (isEditableEventTarget(event.target)) {
    return;
  }
  if (event.key === "Shift" && dogsMapOpen) {
    dogsMapOpen = false;
    if (dogsMode && dogsFrame) drawDogsFrame(dogsFrame);
    event.preventDefault();
    return;
  }
  const key = keyForEvent(event.key);
  if (!key) {
    return;
  }
  event.preventDefault();
  keyboardState[key] = false;
  recomputeInputState();
});

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function dogsWeaponSlotForKey(event: KeyboardEvent): number | null {
  if (!dogsMode || !dogsFrame || event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  if (/^Digit[1-9]$/.test(event.code)) {
    return Number(event.code.slice(5)) - 1;
  }
  if (/^Numpad[1-9]$/.test(event.code)) {
    return Number(event.code.slice(6)) - 1;
  }
  if (event.code === "Digit0" || event.code === "Numpad0") {
    return 9;
  }
  return null;
}

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
  if (dogsMode) {
    leaveDogsMode();
  }
  updateStartupModePreference("megadrive");
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

function updateStartupModePreference(mode: "dogs" | "megadrive"): void {
  if (!hostedServerMode) {
    return;
  }
  const url = new URL(window.location.href);
  if (mode === "dogs") {
    url.searchParams.set("eutherdogs", "1");
    url.searchParams.delete("megadrive");
    megaDrivePanel.open = false;
  } else {
    url.searchParams.set("megadrive", "1");
    url.searchParams.delete("eutherdogs");
    megaDrivePanel.open = true;
  }
  window.history.replaceState({}, "", url);
}

async function loadRomPath(path: string): Promise<void> {
  if (dogsMode) {
    leaveDogsMode();
  }
  updateStartupModePreference("megadrive");
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
  if (dogsMode) {
    leaveDogsMode();
  }
  updateStartupModePreference("megadrive");
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
    await refreshAuthStatus();
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

async function refreshLobby(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    lobbyStatus = await bridgeJson<LobbyStatus>("/api/lobby", {}, 900);
    if (
      lobbyStatus.instances.length > 0 &&
      !lobbyStatus.instances.some((instance) => instance.id === activeLobbyInstanceId)
    ) {
      activeLobbyInstanceId = lobbyStatus.instances[0].id;
    }
    renderLobby();
  } catch {
    lobbyMeta.textContent = "Host lobby unavailable";
  }
}

async function refreshAuthStatus(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    const status = await bridgeJson<AuthStatus>("/api/auth/status", {}, 700);
    hostUsername = status.authenticated ? status.user ?? null : null;
    hostIsAdmin = Boolean(status.authenticated && status.isAdmin);
    hostCsrfToken = status.authenticated ? status.csrfToken ?? null : null;
    updateChatPolling(status.authenticated);
  } catch {
    hostUsername = null;
    hostIsAdmin = false;
    hostCsrfToken = null;
    updateChatPolling(false);
  }
  renderAdminAccess();
}

async function startLobbyInstance(): Promise<void> {
  const result = await bridgeJson<LobbyStartResult>("/api/lobby/start", { method: "POST" }, 1200);
  lobbyStatus = result.instance;
  activeLobbyInstanceId = result.id;
  lobbyRole = "player";
  claimedLobbyPlayer = 1;
  setPlayerPort(1);
  pushTrace("New host instance primed");
  renderLobby();
  await connectBridge(false);
}

async function joinLobbyInstance(port: PlayerPort | "auto" = "auto"): Promise<void> {
  const result = await bridgeJson<LobbyJoinResult>(
    `/api/lobby/join?instance=${encodeURIComponent(activeLobbyInstanceId)}&player=${port}`,
    { method: "POST" },
    1200,
  );
  lobbyStatus = result.instance;
  if (result.role.kind === "player" && (result.role.player === 1 || result.role.player === 2)) {
    lobbyRole = "player";
    claimedLobbyPlayer = result.role.player;
    setPlayerPort(claimedLobbyPlayer);
    pushTrace(`Joined as P${result.role.player}`);
  } else {
    lobbyRole = "spectator";
    claimedLobbyPlayer = null;
    stopBridgeStream();
    pushTrace("Joined as spectator");
  }
  renderLobby();
}

async function releaseLobbySlot(announce = true, instanceId = activeLobbyInstanceId): Promise<void> {
  lobbyStatus = await bridgeJson<LobbyStatus>(
    `/api/lobby/release?instance=${encodeURIComponent(instanceId)}`,
    { method: "POST" },
    1200,
  );
  if (announce) {
    lobbyRole = "spectator";
    claimedLobbyPlayer = null;
    stopBridgeStream();
    pushTrace("Released player slot");
  }
  renderLobby();
}

async function kickLobbyPlayer(player: PlayerPort): Promise<void> {
  lobbyStatus = await bridgeJson<LobbyStatus>(
    `/api/lobby/kick?instance=${encodeURIComponent(activeLobbyInstanceId)}&player=${player}`,
    { method: "POST" },
    1200,
  );
  pushTrace(`Kicked P${player}`);
  renderLobby();
}

async function closeLobbyInstance(): Promise<void> {
  const closingId = activeLobbyInstanceId;
  lobbyStatus = await bridgeJson<LobbyStatus>(
    `/api/lobby/close?instance=${encodeURIComponent(closingId)}`,
    { method: "POST" },
    1200,
  );
  const fallback = lobbyStatus.instances.find((instance) => instance.id !== closingId);
  activeLobbyInstanceId = fallback?.id ?? "main";
  lobbyRole = "spectator";
  claimedLobbyPlayer = null;
  stopBridgeStream();
  pushTrace(`Closed ${closingId}`);
  renderLobby();
  await connectBridge(false);
}

async function refreshHostUsers(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    const result = await bridgeJson<HostUserList>("/api/admin/users", {}, 900);
    hostUsers = result.users;
    renderHostUsers();
  } catch {
    adminUsers.innerHTML = `<span>Host admin unavailable</span>`;
  }
}

async function addOrResetHostUser(): Promise<void> {
  const username = adminUsername.value.trim();
  const password = adminPassword.value;
  if (!username || !password) {
    return;
  }
  const existing = hostUsers.some((user) => user.name === username);
  const body = new URLSearchParams({ username, password });
  const result = await bridgeJson<HostUserList>(
    existing ? "/api/admin/users/password" : "/api/admin/users/create",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    1600,
  );
  hostUsers = result.users;
  selectedAdminUser = username;
  adminPassword.value = "";
  renderHostUsers();
}

async function sendInvitePlaceholder(): Promise<void> {
  const email = inviteEmail.value.trim();
  if (!email) {
    return;
  }
  await bridgeJson(
    "/api/admin/invites/placeholder",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email }),
    },
    900,
  );
  pushTrace("Invite placeholder logged");
}

function updateChatPolling(enabled: boolean): void {
  if (isTauri || !enabled) {
    if (chatPollTimer !== null) {
      window.clearInterval(chatPollTimer);
      chatPollTimer = null;
    }
    return;
  }
  if (chatPollTimer === null) {
    void refreshChat();
    chatPollTimer = window.setInterval(() => void refreshChat(), 2200);
  }
}

async function refreshChat(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    const result = await bridgeJson<ChatResult>("/api/chat", {}, 900);
    chatMessages = result.messages;
    renderChat();
  } catch {
    chatList.innerHTML = `<span>Chat offline</span>`;
  }
}

async function sendChatMessage(): Promise<void> {
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }
  const result = await bridgeJson<ChatResult>(
    "/api/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message }),
    },
    1200,
  );
  chatMessages = result.messages;
  chatInput.value = "";
  renderChat();
}

function renderLobby(): void {
  const instance = activeLobbyInstance();
  if (!instance) {
    lobbyTitle.textContent = "No Reaction Vessel";
    lobbyMeta.textContent = "No instance scan";
    lobbyHost.textContent = "Host: open";
    lobbyInstances.innerHTML = "";
    return;
  }
  renderLobbyInstances();
  const occupied = instance.players
    .map((player) => `P${player.player}:${player.occupied ? player.user ?? "busy" : "open"}`)
    .join(" ");
  lobbyTitle.textContent = instance.name;
  lobbyMeta.textContent =
    `${instance.loaded ? instance.title : "No ROM"} | ${occupied} | ${instance.spectators} spec`;
  lobbyHost.textContent = `Host: ${instance.host ?? "open"}`;
  instanceJoin.textContent =
    lobbyRole === "spectator" || claimedLobbyPlayer === null ? "Join Auto" : `Joined P${claimedLobbyPlayer}`;
  instanceStart.disabled = false;
  releaseSlot.disabled = claimedLobbyPlayer === null && !ownsCurrentSlot();
  claimP1.disabled = claimedLobbyPlayer !== null || Boolean(instance.players.find((player) => player.player === 1)?.occupied);
  claimP2.disabled = claimedLobbyPlayer !== null || Boolean(instance.players.find((player) => player.player === 2)?.occupied);
  claimP1.classList.toggle("is-selected", claimedLobbyPlayer === 1);
  claimP2.classList.toggle("is-selected", claimedLobbyPlayer === 2);
  kickP1.disabled =
    !canHostMutate() || !Boolean(instance.players.find((player) => player.player === 1)?.occupied);
  kickP2.disabled =
    !canHostMutate() || !Boolean(instance.players.find((player) => player.player === 2)?.occupied);
  closeInstance.disabled = instance.id === "main" || !canHostMutate();
  spectateInstance.classList.toggle("is-selected", lobbyRole === "spectator");
  renderPlayerPort();
  if (dogsMenuMode === "staff") {
    renderDogsMenu();
  }
}

function activeLobbyInstance(): LobbyInstance | undefined {
  return (
    lobbyStatus?.instances.find((instance) => instance.id === activeLobbyInstanceId) ??
    lobbyStatus?.instances[0]
  );
}

function renderLobbyInstances(): void {
  const instances = lobbyStatus?.instances ?? [];
  lobbyInstances.innerHTML = instances
    .map(
      (instance) => `
        <button class="${instance.id === activeLobbyInstanceId ? "is-selected" : ""}" data-instance-id="${escapeHtml(instance.id)}" type="button">
          <strong>${escapeHtml(instance.name)}</strong>
          <span>${escapeHtml(instance.loaded ? instance.title : "No ROM")} | ${instance.players.filter((player) => player.occupied).length}P ${instance.spectators}S</span>
        </button>
      `,
    )
    .join("");
}

function ownsCurrentSlot(): boolean {
  if (!lobbyStatus) {
    return true;
  }
  if (!hostUsername) {
    return false;
  }
  const instance = activeLobbyInstance();
  const slot = instance?.players.find((player) => player.player === playerPort);
  return Boolean(slot?.occupied && hostUsername && slot.user === hostUsername);
}

function canHostMutate(): boolean {
  const host = activeLobbyInstance()?.host;
  return !host || host === hostUsername;
}

function renderAdminAccess(): void {
  adminOpen.hidden = !hostIsAdmin;
  if (!hostIsAdmin) {
    adminModal.classList.remove("is-open");
    adminModal.setAttribute("aria-hidden", "true");
  }
}

function renderHostUsers(): void {
  adminUsers.innerHTML = hostUsers.length
    ? hostUsers
        .map(
          (user) => `
            <div class="admin-user ${user.name === selectedAdminUser ? "is-selected" : ""}">
              <button data-admin-select="${escapeHtml(user.name)}" type="button">
                <strong>${escapeHtml(user.name)}</strong>
                <span>${user.admin ? "Admin" : "User"} | ${user.banned ? "Banned" : "Active"}</span>
              </button>
              <button data-admin-admin="${escapeHtml(user.name)}" data-admin="${user.admin ? "0" : "1"}" type="button">
                ${user.admin ? "User" : "Admin"}
              </button>
              <button data-admin-ban="${escapeHtml(user.name)}" data-banned="${user.banned ? "0" : "1"}" type="button">
                ${user.banned ? "Unban" : "Ban"}
              </button>
            </div>
          `,
        )
        .join("")
    : `<span>No users loaded</span>`;
}

function renderChat(): void {
  const shouldStickToBottom =
    chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 24;
  chatList.innerHTML = chatMessages.length
    ? chatMessages
        .map(
          (entry) => `
            <div class="chat-message">
              <strong>${escapeHtml(entry.user)}</strong>
              <p>${escapeHtml(entry.message)}</p>
            </div>
          `,
        )
        .join("")
    : `<span>No messages</span>`;
  if (shouldStickToBottom) {
    chatList.scrollTop = chatList.scrollHeight;
  }
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
  if (!url.searchParams.has("instance")) {
    url.searchParams.set("instance", activeLobbyInstanceId);
  }
  url.searchParams.set("client", bridgeClientId);
  if (!url.searchParams.has("player")) {
    url.searchParams.set("player", String(playerPort));
  }
  if (lobbyRole === "spectator" && path.includes("stream-frame-audio")) {
    url.searchParams.set("role", "spectator");
  }
  return url.toString();
}

async function bridgeStreamRequest(signal: AbortSignal): Promise<Response> {
  const response = await fetch(bridgeUrl("/stream-frame-audio.bin"), {
    method: "GET",
    credentials: "include",
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
    const method = (init.method ?? "GET").toUpperCase();
    if (hostCsrfToken && !["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("X-CSRF-Token")) {
      headers.set("X-CSRF-Token", hostCsrfToken);
    }
    const response = await fetch(bridgeUrl(path), {
      ...init,
      headers,
      credentials: "include",
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
      await runDogsFrame();
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

function parseEutherDogsManifest(toml: string, modules: Record<string, string>): Map<string, string> {
  const byRelativePath = new Map<string, string>();
  for (const [modulePath, url] of Object.entries(modules)) {
    byRelativePath.set(modulePath.replace(/^\.\.\/assets\/eutherdogs\//, ""), url);
  }

  const entries = new Map<string, string>();
  let section = "";
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const valueMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"/);
    if (!valueMatch) continue;
    const [, key, relativePath] = valueMatch;
    const url = byRelativePath.get(relativePath);
    if (!url) continue;
    entries.set(`${section}.${key}`, url);
  }
  return entries;
}

function dogsAsset(section: string, key: string): string | null {
  if (dogsAssetMode === "2x") {
    const highres = dogsHighresAsset(section, key);
    if (highres) {
      return highres;
    }
  }
  return eutherDogsAssets.get(`${section}.${key}`) ?? null;
}

function dogsHighresAsset(section: string, key: string): string | null {
  return eutherDogsAssets.get(`highres.${section}.${key}`) ?? null;
}

function dogsTileAsset(tile: string): string | null {
  const tileMap: Record<string, [string, string]> = {
    floor: ["tiles.floor", "sterile_tile"],
    sterile_floor: ["tiles.floor", "sterile_tile"],
    neon_floor: ["tiles.floor", "neon_floor"],
    warning_floor: ["tiles.floor", "warning_floor"],
    fan_floor: ["tiles.floor", "fan_floor"],
    player_spawn_1: ["tiles.floor", "player_spawn_1"],
    player_spawn_2: ["tiles.floor", "player_spawn_2"],
    wall: ["tiles.walls", "pharmacy_wall"],
    door: ["tiles.walls", "security_glass_wall"],
    corrupt_med_cabinet: ["tiles.props", "corrupt_med_cabinet"],
    hacked_vending_unit: ["tiles.props", "hacked_vending_unit"],
    recall_crate: ["tiles.props", "recall_crate"],
    shipping_box: ["tiles.props", "shipping_box"],
    service_elevator: ["tiles.props", "service_elevator"],
    prescription: ["items", "prescription"],
    folder: ["items", "folder"],
    data_wafer: ["items", "data_wafer"],
    circuit_board: ["items", "circuit_board"],
    pill_sample: ["items", "pill_sample"],
    lab_coat_armor: ["items", "lab_coat_armor"],
    hazard_sleeves: ["items", "hazard_sleeves"],
    pill_splitter: ["items", "pill_splitter"],
    routine_directive: ["items", "routine_directive"],
    scorch_mark: ["sprites.effects", "scorch_mark"],
    spilled_syrup: ["sprites.effects", "spilled_syrup"],
  };
  const entry = tileMap[tile];
  return entry ? dogsAsset(entry[0], entry[1]) : null;
}

function dogsTileAt(frame: DogsCoreFrame, x: number, y: number): string {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return "void";
  return frame.tiles[y * frame.width + x] ?? "floor";
}

function dogsVisibilityAt(frame: DogsCoreFrame, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return 0;
  return frame.visibility?.[y * frame.width + x] ?? 255;
}

function dogsPixelVisibility(frame: DogsCoreFrame, x: number, y: number): number {
  return dogsVisibilityAt(frame, Math.floor(x / frame.tileWidth), Math.floor(y / frame.tileHeight));
}

function dogsWallTile(tile: string): boolean {
  return tile === "wall" || tile === "door";
}

function dogsWallAsset(frame: DogsCoreFrame, x: number, y: number, tile: string): string | null {
  const up = dogsWallTile(dogsTileAt(frame, x, y - 1));
  const down = dogsWallTile(dogsTileAt(frame, x, y + 1));
  const left = dogsWallTile(dogsTileAt(frame, x - 1, y));
  const right = dogsWallTile(dogsTileAt(frame, x + 1, y));
  const prefix = tile === "door" ? "security_glass_wall" : "pharmacy_wall";
  const horizontalRun = left || right;
  const verticalRun = up || down;
  const cornerAsset = (suffix: string): string | null => (
    dogsAsset("tiles.walls", `${prefix}_corner_${suffix}`)
      ?? dogsAsset("tiles.walls", `${prefix}_junction`)
      ?? dogsAsset("tiles.walls", prefix)
  );
  if (up && right && !down && !left) {
    return cornerAsset("up_right");
  }
  if (up && left && !down && !right) {
    return cornerAsset("up_left");
  }
  if (down && right && !up && !left) {
    return cornerAsset("down_right");
  }
  if (down && left && !up && !right) {
    return cornerAsset("down_left");
  }
  if (horizontalRun && verticalRun) {
    return dogsAsset("tiles.walls", `${prefix}_junction`) ?? dogsAsset("tiles.walls", prefix);
  }
  if (verticalRun && !horizontalRun) {
    return dogsAsset("tiles.walls", `${prefix}_column`) ?? dogsAsset("tiles.walls", prefix);
  }
  if (!verticalRun && !horizontalRun) {
    return dogsAsset("tiles.walls", `${prefix}_column`) ?? dogsAsset("tiles.walls", prefix);
  }
  if (horizontalRun && !down) {
    return dogsAsset("tiles.walls", `${prefix}_face`);
  }
  if (horizontalRun && !up) {
    return dogsAsset("tiles.walls", `${prefix}_cap`);
  }
  return dogsAsset("tiles.walls", prefix);
}

function dogsTileImageFit(tile: string): "contain" | "cover" {
  if (
    tile === "floor"
    || tile === "sterile_floor"
    || tile === "neon_floor"
    || tile === "warning_floor"
    || tile === "fan_floor"
    || tile === "player_spawn_1"
    || tile === "player_spawn_2"
  ) {
    return "cover";
  }
  return "contain";
}

function dogsQueueLeft(frame: DogsCoreFrame | null | undefined): number {
  if (!frame) return 0;
  if (frame.summary.bossActive) {
    dogsSawHostileQueue = true;
    return 1;
  }
  const hostileActors = frame.characters.filter((actor) => actor.faction === "hostile_customer");
  if (hostileActors.length > 0) {
    dogsSawHostileQueue = true;
    return hostileActors.filter((actor) => actor.alive).length;
  }
  return dogsSawHostileQueue ? 0 : frame.summary.targetsLeft;
}

function dogsExitReady(frame: DogsCoreFrame): boolean {
  return (
    frame.summary.status === "won" ||
    (frame.summary.status === "running" &&
      dogsQueueLeft(frame) <= 0 &&
      frame.summary.objectsLeft <= 0 &&
      frame.summary.kills >= frame.summary.minimumKills)
  );
}

function dogsHeroOnExit(frame: DogsCoreFrame): boolean {
  const hero = dogsLocalPlayer(frame);
  if (!hero) return false;
  const left = hero.x;
  const right = hero.x + frame.characterWidth - 1;
  const top = hero.y;
  const bottom = hero.y + frame.characterHeight - 1;
  const centerX = hero.x + frame.characterWidth / 2;
  const centerY = hero.y + frame.characterHeight / 2;
  return [
    [centerX, centerY],
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ].some(([x, y]) => {
    const tileX = Math.floor(x / frame.tileWidth);
    const tileY = Math.floor(y / frame.tileHeight);
    return dogsTileAt(frame, tileX, tileY) === "service_elevator";
  });
}

function dogsHeroKey(actor: DogsCoreActor, animated: boolean): string {
  const key = actor.sprite && dogsAsset("sprites.heroes", actor.sprite)
    ? actor.sprite
    : actor.id === 1
      ? "neon_pharmacist"
      : "night_shift_tech";
  return animated ? `${key}_walk` : key;
}

function dogsEnemyKey(actor: DogsCoreActor): string {
  const enemies = [
    "angry_customer",
    "claim_denier",
    "inventory_drone",
    "recall_enforcer",
    "black_market_courier",
    "district_manager",
    "inspector_cyan",
    "inspector_magenta",
    "senior_lma",
    "mpa_agent",
    "mpa_chief",
  ];
  return actor.sprite && dogsAsset("sprites.enemies", actor.sprite) ? actor.sprite : enemies[actor.id % enemies.length];
}

function dogsActorAsset(actor: DogsCoreActor): string | null {
  if (actor.faction === "player") {
    return dogsAsset("sprites.heroes", dogsHeroKey(actor, false));
  }
  return dogsAsset("sprites.enemies", dogsEnemyKey(actor));
}

function dogsActorSheetAsset(actor: DogsCoreActor): string | null {
  if (actor.faction !== "player") {
    const key = `${dogsEnemyKey(actor)}_walk`;
    if (dogsAssetMode === "2x" && !dogsHighresAsset("sprites.enemies", key)) {
      return null;
    }
    return dogsAsset("sprites.enemies", key);
  }
  const key = dogsHeroKey(actor, true);
  if (dogsAssetMode === "2x" && !dogsHighresAsset("sprites.heroes", key)) {
    return null;
  }
  return dogsAsset("sprites.heroes", key);
}

function dogsActorDirectionFacing(actor: DogsCoreActor): DogsActorFacing {
  switch (actor.direction) {
    case "up":
    case "up_left":
    case "up_right":
      return "up";
    case "left":
    case "down_left":
      return "left";
    case "right":
    case "down_right":
      return "right";
    default:
      return "down";
  }
}

function dogsFacingFromMovement(dx: number, dy: number, fallback: DogsActorFacing): DogsActorFacing {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? "left" : "right";
  }
  if (Math.abs(dy) > 0) {
    return dy < 0 ? "up" : "down";
  }
  return fallback;
}

function dogsActorFacingRow(facing: DogsActorFacing): number {
  switch (facing) {
    case "up":
      return 3;
    case "left":
      return 1;
    case "right":
      return 2;
    case "down":
    default:
      return 0;
  }
}

const dogsProjectileStyles: Record<string, DogsProjectileStyle> = {
  scanner_blaster: { asset: "cyan_rx_bolt", color: "#39f7c8", size: 13, trail: 14, glow: 12, impact: 18 },
  coupon_pistol: { asset: "red_denial_bolt", color: "#ff4b4b", size: 10, trail: 7, glow: 5, impact: 10 },
  receipt_gun: { asset: "red_denial_bolt", color: "#ffb35c", size: 9, trail: 18, glow: 7, impact: 9 },
  rx_cannon: { asset: "power_pill", color: "#fff04a", size: 22, trail: 28, glow: 28, impact: 42, spins: true },
  label_printer: { asset: "label_shred", color: "#f2f7ff", size: 11, trail: 20, glow: 5, impact: 8, spins: true },
  sterilizer_spray: { asset: "sterilizer_cloud", color: "#7dfff1", size: 26, trail: 8, glow: 18, impact: 36 },
  capsule_launcher: { asset: "capsule_grenade", color: "#ffde5a", size: 18, trail: 20, glow: 20, impact: 48, spins: true },
  neon_prior_auth: { asset: "green_auth_laser", color: "#42ff74", size: 12, trail: 34, glow: 16, impact: 14 },
  turbo_prior_auth: { asset: "yellow_warning_laser", color: "#ffee63", size: 10, trail: 42, glow: 18, impact: 16 },
  formulary_zapper: { asset: "zapper_arc", color: "#ad7cff", size: 20, trail: 18, glow: 26, impact: 38 },
  autoinjector: { asset: "injector_dart", color: "#ff79c8", size: 13, trail: 13, glow: 8, impact: 16 },
  needlegun: { asset: "needle_stream", color: "#d5f7ff", size: 8, trail: 32, glow: 5, impact: 8 },
  handsanitizer_flamethrower: { asset: "sanitizer_flame", color: "#ff7a24", size: 30, trail: 9, glow: 28, impact: 44 },
  compliance_laser: { asset: "compliance_laser", color: "#54ff70", size: 16, trail: 58, glow: 24, impact: 20 },
};

function dogsProjectileStyle(weapon: string): DogsProjectileStyle {
  return dogsProjectileStyles[weapon] ?? dogsProjectileStyles.scanner_blaster;
}

function dogsProjectileAsset(bullet: DogsCoreBullet): string | null {
  return dogsAsset("sprites.projectiles", dogsProjectileStyle(bullet.weapon).asset);
}

function dogsEffectAsset(frameIndex: number): string | null {
  return dogsAsset("sprites.effects", `explosion_0${Math.min(5, Math.max(1, frameIndex))}`);
}

function dogsWeaponAsset(weapon: string | null | undefined): string | null {
  return weapon ? dogsAsset("sprites.weapons", weapon) : null;
}

function dogsSfxAsset(sound: string | null | undefined): string | null {
  return sound ? dogsAsset("audio.sfx", sound) : null;
}

function dogsWeaponIconMarkup(weapon: string | null | undefined, label: string): string {
  const url = dogsWeaponAsset(weapon);
  return url
    ? `<img class="eutherdogs-weapon-icon" src="${url}" alt="${label}" />`
    : `<span class="eutherdogs-weapon-icon is-empty" aria-hidden="true"></span>`;
}

function dogsStoreItemIconMarkup(item: DogsStoreItem): string {
  const url = item.weapon
    ? dogsWeaponAsset(item.weapon)
    : item.armor > 0
      ? dogsAsset("items", "lab_coat_armor")
      : null;
  return url
    ? `<img class="eutherdogs-weapon-icon" src="${url}" alt="${item.label}" />`
    : `<span class="eutherdogs-weapon-icon is-empty" aria-hidden="true"></span>`;
}

function dogsStaffAsset(staff: DogsStaffOption): string | null {
  return dogsAsset("sprites.heroes", staff.character);
}

function dogsStaffSpriteMarkup(staff: DogsStaffOption): string {
  const url = dogsStaffAsset(staff);
  return url
    ? `<img class="eutherdogs-staff-sprite" src="${url}" alt="${staff.name}" />`
    : `<span class="eutherdogs-staff-sprite is-empty" aria-hidden="true"></span>`;
}

function dogsCharacterName(character: DogsCharacterKey): string {
  return dogsStaffOptions.find((staff) => staff.character === character)?.name ?? "Night Tech";
}

function drawDogsImage(
  url: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackColor: string,
  fit: "stretch" | "contain" | "cover" = "stretch",
  fillBackground = false,
): void {
  if (!url) {
    dogsContext.fillStyle = fallbackColor;
    dogsContext.fillRect(x, y, width, height);
    return;
  }
  let image = dogsImageCache.get(url);
  if (!image) {
    image = new Image();
    image.onload = () => {
      if (dogsMode && dogsFrame) drawDogsFrame(dogsFrame);
    };
    image.src = url;
    dogsImageCache.set(url, image);
  }
  if (image.complete && image.naturalWidth > 0) {
    if (fillBackground) {
      dogsContext.fillStyle = fallbackColor;
      dogsContext.fillRect(x, y, width, height);
    }
    if (fit === "stretch") {
      dogsContext.drawImage(image, x, y, width, height);
      return;
    }
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    const targetAspect = width / height;
    const scaleByWidth = fit === "contain" ? sourceAspect > targetAspect : sourceAspect < targetAspect;
    const drawW = scaleByWidth ? width : height * sourceAspect;
    const drawH = scaleByWidth ? width / sourceAspect : height;
    dogsContext.drawImage(image, x + (width - drawW) / 2, y + (height - drawH) / 2, drawW, drawH);
  } else {
    dogsContext.fillStyle = fallbackColor;
    dogsContext.fillRect(x, y, width, height);
  }
}

function drawDogsImageFrame(
  url: string | null,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackColor: string,
): boolean {
  if (!url) {
    drawDogsImage(null, x, y, width, height, fallbackColor);
    return false;
  }
  let image = dogsImageCache.get(url);
  if (!image) {
    image = new Image();
    image.onload = () => {
      if (dogsMode && dogsFrame) drawDogsFrame(dogsFrame);
    };
    image.src = url;
    dogsImageCache.set(url, image);
  }
  if (image.complete && image.naturalWidth > 0) {
    dogsContext.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    return true;
  } else {
    dogsContext.fillStyle = fallbackColor;
    dogsContext.fillRect(x, y, width, height);
    return false;
  }
}

function preloadDogsImage(url: string | null): void {
  if (!url || dogsImageCache.has(url)) return;
  const image = new Image();
  image.src = url;
  dogsImageCache.set(url, image);
}

function preloadDogsCombatAssets(): void {
  for (const style of Object.values(dogsProjectileStyles)) {
    preloadDogsImage(dogsAsset("sprites.projectiles", style.asset));
  }
  for (let index = 1; index <= 5; index += 1) {
    preloadDogsImage(dogsEffectAsset(index));
  }
}

function drawDogsProjectile(
  bullet: DogsCoreBullet,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
  frameTick: number,
): void {
  const style = dogsProjectileStyle(bullet.weapon);
  const cx = (bullet.x - cameraX) * scale;
  const cy = (bullet.y - cameraY) * yScale * scale;
  const size = Math.max(4, Math.ceil(style.size * scale));
  const velocity = Math.hypot(bullet.dx, bullet.dy) || 1;
  const ux = bullet.dx / velocity;
  const uy = bullet.dy / velocity;
  const trailLength = style.trail * scale;

  dogsContext.save();
  dogsContext.globalCompositeOperation = "lighter";
  dogsContext.strokeStyle = style.color;
  dogsContext.lineWidth = Math.max(1, Math.ceil(size * 0.22));
  dogsContext.globalAlpha = bullet.ownerFaction === "player" ? 0.7 : 0.52;
  dogsContext.beginPath();
  dogsContext.moveTo(cx - ux * trailLength, cy - uy * trailLength * yScale);
  dogsContext.lineTo(cx, cy);
  dogsContext.stroke();
  if (style.glow > 0) {
    const glow = dogsContext.createRadialGradient(cx, cy, 0, cx, cy, style.glow * scale);
    glow.addColorStop(0, style.color);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    dogsContext.globalAlpha = bullet.ownerFaction === "player" ? 0.36 : 0.24;
    dogsContext.fillStyle = glow;
    dogsContext.fillRect(cx - style.glow * scale, cy - style.glow * scale, style.glow * 2 * scale, style.glow * 2 * scale);
  }
  dogsContext.restore();

  const url = dogsProjectileAsset(bullet);
  const image = url ? dogsImageCache.get(url) : null;
  if (url && image?.complete && image.naturalWidth > 0 && style.spins) {
    dogsContext.save();
    dogsContext.translate(cx, cy);
    dogsContext.rotate((frameTick * 0.22 + bullet.id) % (Math.PI * 2));
    dogsContext.drawImage(image, -size / 2, -size / 2, size, size);
    dogsContext.restore();
  } else {
    drawDogsImage(
      url,
      Math.floor(cx - size / 2),
      Math.floor(cy - size / 2),
      size,
      size,
      bullet.ownerFaction === "player" ? style.color : "#ff3030",
    );
  }
}

function updateDogsImpactEffects(frame: DogsCoreFrame): void {
  if (dogsLastImpactFrameProcessed === frame.frame) return;
  const current = new Map<number, DogsCoreBullet>();
  for (const bullet of frame.bullets) {
    current.set(bullet.id, bullet);
  }
  for (const [id, previous] of dogsTrackedBullets) {
    if (!current.has(id)) {
      dogsImpactEffects.push({
        id: `${frame.frame}:${id}`,
        x: previous.x,
        y: previous.y,
        weapon: previous.weapon,
        ownerFaction: previous.ownerFaction,
        startFrame: frame.frame,
      });
    }
  }
  dogsTrackedBullets = current;
  dogsImpactEffects = dogsImpactEffects.filter((effect) => frame.frame - effect.startFrame < 18);
  dogsLastImpactFrameProcessed = frame.frame;
}

function drawDogsImpactEffects(frame: DogsCoreFrame, cameraX: number, cameraY: number, scale: number, yScale: number): void {
  for (const effect of dogsImpactEffects) {
    const age = frame.frame - effect.startFrame;
    if (age < 0 || age >= 18) continue;
    if (effect.ownerFaction !== "player" && dogsPixelVisibility(frame, effect.x, effect.y) < 255) continue;
    const style = dogsProjectileStyle(effect.weapon);
    const cx = (effect.x - cameraX) * scale;
    const cy = (effect.y - cameraY) * yScale * scale;
    const pulse = Math.sin((age / 18) * Math.PI);
    const size = Math.max(8, Math.ceil((style.impact + pulse * style.impact * 0.45) * scale));
    const frameIndex = Math.min(5, Math.floor((age / 18) * 5) + 1);
    dogsContext.save();
    dogsContext.globalCompositeOperation = "lighter";
    const glow = dogsContext.createRadialGradient(cx, cy, 0, cx, cy, size * 0.62);
    glow.addColorStop(0, style.color);
    glow.addColorStop(0.35, `${style.color}88`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    dogsContext.globalAlpha = 0.42 * (1 - age / 20);
    dogsContext.fillStyle = glow;
    dogsContext.fillRect(cx - size, cy - size, size * 2, size * 2);
    dogsContext.restore();
    drawDogsImage(
      dogsEffectAsset(frameIndex),
      Math.floor(cx - size / 2),
      Math.floor(cy - size / 2),
      size,
      size,
      style.color,
    );
  }
}

function drawDogsExitPortal(x: number, y: number, width: number, height: number, active: boolean, tick: number): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.max(4, Math.min(width, height) * (active ? 0.42 : 0.3));
  const pulse = (Math.sin(tick / (active ? 5 : 18)) + 1) / 2;
  dogsContext.save();
  dogsContext.globalCompositeOperation = "lighter";
  dogsContext.shadowColor = active ? "#b6ff2d" : "#46f7c8";
  dogsContext.shadowBlur = active ? 18 : 7;
  dogsContext.strokeStyle = active ? `rgba(190, 255, 45, ${0.72 + pulse * 0.24})` : `rgba(57, 247, 200, ${0.22 + pulse * 0.16})`;
  dogsContext.lineWidth = Math.max(1, width * 0.065);
  dogsContext.beginPath();
  dogsContext.ellipse(cx, cy, radius, radius * 0.7, tick / 16, 0.2, Math.PI * 1.62);
  dogsContext.stroke();
  dogsContext.strokeStyle = active ? `rgba(57, 247, 200, ${0.65 + pulse * 0.25})` : `rgba(255, 228, 60, ${0.2 + pulse * 0.12})`;
  dogsContext.lineWidth = Math.max(1, width * 0.04);
  dogsContext.beginPath();
  dogsContext.ellipse(cx, cy, radius * 0.62, radius * 0.42, -tick / 12, Math.PI * 0.35, Math.PI * 1.95);
  dogsContext.stroke();
  if (active) {
    const spokes = 5;
    for (let i = 0; i < spokes; i += 1) {
      const angle = tick / 10 + (Math.PI * 2 * i) / spokes;
      const px = cx + Math.cos(angle) * radius * 0.65;
      const py = cy + Math.sin(angle) * radius * 0.45;
      dogsContext.fillStyle = i % 2 === 0 ? "rgba(194, 255, 45, 0.85)" : "rgba(57, 247, 200, 0.75)";
      dogsContext.fillRect(px - width * 0.025, py - height * 0.025, width * 0.05, height * 0.05);
    }
  }
  dogsContext.restore();
}

function drawDogsVentFan(x: number, y: number, width: number, height: number, tick: number): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const radius = Math.min(width, height) * 0.36;
  const bladeLength = radius * 0.95;
  const bladeWidth = Math.max(2, Math.min(width, height) * 0.12);
  const spin = tick / 7;
  dogsContext.save();
  dogsContext.fillStyle = "#aebcb7";
  dogsContext.fillRect(x, y, width, height);
  dogsContext.strokeStyle = "rgba(91, 110, 109, 0.7)";
  dogsContext.lineWidth = Math.max(1, Math.ceil(width * 0.025));
  for (let i = 1; i < 4; i += 1) {
    const gx = Math.floor(x + (width * i) / 4) + 0.5;
    dogsContext.beginPath();
    dogsContext.moveTo(gx, y);
    dogsContext.lineTo(gx, y + height);
    dogsContext.stroke();
  }
  for (let i = 1; i < 3; i += 1) {
    const gy = Math.floor(y + (height * i) / 3) + 0.5;
    dogsContext.beginPath();
    dogsContext.moveTo(x, gy);
    dogsContext.lineTo(x + width, gy);
    dogsContext.stroke();
  }
  dogsContext.fillStyle = "#718480";
  dogsContext.strokeStyle = "#2f3d3d";
  dogsContext.lineWidth = Math.max(1, Math.ceil(width * 0.04));
  dogsContext.beginPath();
  dogsContext.arc(cx, cy, radius * 1.08, 0, Math.PI * 2);
  dogsContext.fill();
  dogsContext.stroke();
  dogsContext.fillStyle = "#1d2728";
  dogsContext.beginPath();
  dogsContext.arc(cx, cy, radius * 0.86, 0, Math.PI * 2);
  dogsContext.fill();
  dogsContext.fillStyle = "#96aaa5";
  for (let i = 0; i < 4; i += 1) {
    dogsContext.save();
    dogsContext.translate(cx, cy);
    dogsContext.rotate(spin + (Math.PI * i) / 2);
    dogsContext.beginPath();
    dogsContext.ellipse(bladeLength * 0.42, 0, bladeLength * 0.52, bladeWidth, 0.2, 0, Math.PI * 2);
    dogsContext.fill();
    dogsContext.restore();
  }
  dogsContext.fillStyle = "#c8d4cf";
  dogsContext.beginPath();
  dogsContext.arc(cx, cy, Math.max(2, radius * 0.18), 0, Math.PI * 2);
  dogsContext.fill();
  dogsContext.restore();
}

function drawDogsVisibilityFog(
  frame: DogsCoreFrame,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
  firstTileX: number,
  firstTileY: number,
  lastTileX: number,
  lastTileY: number,
): void {
  dogsContext.save();
  const time = frame.frame / 38;
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      const visibility = dogsVisibilityAt(frame, x, y);
      if (visibility >= 255) continue;
      const tileX = Math.floor((x * frame.tileWidth - cameraX) * scale);
      const tileY = Math.floor((y * frame.tileHeight - cameraY) * yScale * scale);
      const tileW = Math.ceil(frame.tileWidth * scale);
      const tileH = Math.ceil(frame.tileHeight * yScale * scale);
      const ripple = (Math.sin(x * 0.73 + y * 1.17 + time) + 1) * 0.5;
      if (visibility <= 0) {
        dogsContext.fillStyle = "#00040a";
        dogsContext.fillRect(tileX, tileY, tileW, tileH);
        const smoke = dogsContext.createRadialGradient(
          tileX + tileW * (0.25 + ripple * 0.48),
          tileY + tileH * (0.3 + (1 - ripple) * 0.34),
          0,
          tileX + tileW * 0.5,
          tileY + tileH * 0.5,
          Math.max(tileW, tileH) * 1.15,
        );
        smoke.addColorStop(0, `rgba(12, 32, 58, ${0.9 - ripple * 0.12})`);
        smoke.addColorStop(0.45, `rgba(4, 12, 28, ${0.94})`);
        smoke.addColorStop(1, "rgba(0, 4, 10, 1)");
        dogsContext.fillStyle = smoke;
        dogsContext.fillRect(tileX, tileY, tileW, tileH);
        dogsContext.strokeStyle = `rgba(39, 242, 255, ${0.035 + ripple * 0.018})`;
        dogsContext.strokeRect(tileX + 0.5, tileY + 0.5, Math.max(0, tileW - 1), Math.max(0, tileH - 1));
        continue;
      }
      const alpha = 0.48 + ripple * 0.12;
      dogsContext.fillStyle = `rgba(2, 13, 35, ${alpha})`;
      dogsContext.fillRect(tileX, tileY, tileW, tileH);
      const smoke = dogsContext.createRadialGradient(
        tileX + tileW * (0.35 + ripple * 0.3),
        tileY + tileH * 0.45,
        0,
        tileX + tileW * 0.5,
        tileY + tileH * 0.5,
        Math.max(tileW, tileH),
      );
      smoke.addColorStop(0, `rgba(72, 255, 225, ${0.05 + ripple * 0.025})`);
      smoke.addColorStop(0.55, `rgba(255, 42, 205, ${0.025 + ripple * 0.018})`);
      smoke.addColorStop(1, "rgba(0, 0, 0, 0)");
      dogsContext.fillStyle = smoke;
      dogsContext.fillRect(tileX, tileY, tileW, tileH);
    }
  }
  dogsContext.restore();
}

function dogsMapTileColor(tile: string, visibility: number): string {
  if (visibility <= 0) return "#02050a";
  if (dogsWallTile(tile)) return visibility >= 255 ? "#a6aeb2" : "#535a67";
  switch (tile) {
    case "corrupt_med_cabinet":
    case "hacked_vending_unit":
    case "recall_crate":
    case "shipping_box":
      return visibility >= 255 ? "#626b6a" : "#343a42";
    case "service_elevator":
      return "#c6ff35";
    case "player_spawn_1":
      return "#39f7c8";
    case "player_spawn_2":
      return "#ff5de1";
    case "prescription":
    case "folder":
    case "data_wafer":
    case "circuit_board":
    case "pill_sample":
      return "#ff5de1";
    case "lab_coat_armor":
    case "hazard_sleeves":
    case "pill_splitter":
      return "#ffe96d";
    case "scorch_mark":
    case "spilled_syrup":
      return visibility >= 255 ? "#2d3d43" : "#1a2330";
    default:
      return visibility >= 255 ? "#27313c" : "#171b2c";
  }
}

function drawDogsMapOverlay(frame: DogsCoreFrame, cameraX: number, cameraY: number, viewW: number, viewH: number): void {
  const margin = 34;
  const mapW = Math.min(dogsCanvas.width - margin * 2, frame.width * 7);
  const mapH = Math.min(dogsCanvas.height - margin * 2, frame.height * 7);
  const tileW = mapW / frame.width;
  const tileH = mapH / frame.height;
  const mapX = Math.floor((dogsCanvas.width - mapW) / 2);
  const mapY = Math.floor((dogsCanvas.height - mapH) / 2);

  dogsContext.save();
  dogsContext.fillStyle = "rgba(0, 0, 0, 0.86)";
  dogsContext.fillRect(0, 0, dogsCanvas.width, dogsCanvas.height);
  dogsContext.fillStyle = "rgba(44, 0, 58, 0.72)";
  dogsContext.fillRect(mapX - 12, mapY - 12, mapW + 24, mapH + 24);
  dogsContext.fillStyle = "#03070c";
  dogsContext.fillRect(mapX, mapY, mapW, mapH);

  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const visibility = dogsVisibilityAt(frame, x, y);
      const tile = frame.tiles[y * frame.width + x] ?? "floor";
      dogsContext.fillStyle = dogsMapTileColor(tile, visibility);
      dogsContext.fillRect(
        Math.floor(mapX + x * tileW),
        Math.floor(mapY + y * tileH),
        Math.max(1, Math.ceil(tileW)),
        Math.max(1, Math.ceil(tileH)),
      );
    }
  }

  for (const actor of frame.characters) {
    if (!actor.alive || dogsPixelVisibility(frame, actor.x, actor.y) <= 0) continue;
    dogsContext.fillStyle = actor.faction === "player" ? "#39ffe6" : "#ff3b62";
    dogsContext.fillRect(
      Math.floor(mapX + (actor.x / frame.tileWidth) * tileW) - 2,
      Math.floor(mapY + (actor.y / frame.tileHeight) * tileH) - 2,
      4,
      4,
    );
  }

  const viewX = mapX + (cameraX / frame.tileWidth) * tileW;
  const viewY = mapY + (cameraY / frame.tileHeight) * tileH;
  const rectW = (viewW / frame.tileWidth) * tileW;
  const rectH = (viewH / frame.tileHeight) * tileH;
  dogsContext.strokeStyle = "#ffffff";
  dogsContext.lineWidth = 2;
  dogsContext.strokeRect(viewX, viewY, rectW, rectH);
  dogsContext.strokeStyle = "rgba(39, 242, 255, 0.55)";
  dogsContext.lineWidth = 1;
  dogsContext.strokeRect(mapX - 1, mapY - 1, mapW + 2, mapH + 2);
  dogsContext.restore();
}

function dogsLocalInspectionDialogue(frame: DogsCoreFrame): DogsInspectionDialogue | undefined {
  return (frame.inspectionDialogues ?? []).find((dialogue) => dialogue.player === playerPort);
}

function wrapDogsDialogueText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  dogsContext.font = "900 12px monospace";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && dogsContext.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

function drawDogsInspectionDialogues(
  frame: DogsCoreFrame,
  cameraX: number,
  cameraY: number,
  scale: number,
  yScale: number,
): void {
  dogsInspectionAnswerRects = [];
  if (dogsMapOpen) return;
  const dialogue = dogsLocalInspectionDialogue(frame);
  if (!dialogue) return;
  const inspector = frame.characters.find((actor) => actor.id === dialogue.inspectorId && actor.alive);
  if (!inspector || dogsPixelVisibility(frame, inspector.x, inspector.y) < 255) return;

  const targetX = (inspector.x - cameraX + frame.characterWidth / 2) * scale;
  const targetY = (inspector.y - cameraY) * yScale * scale;
  const bubbleW = Math.min(330, Math.max(230, dogsCanvas.width * 0.48));
  const lines = wrapDogsDialogueText(dialogue.question, bubbleW - 28);
  const buttonH = dialogue.complete ? 0 : 24;
  const bubbleH = 34 + lines.length * 15 + (dialogue.complete ? 0 : buttonH + 10);
  const x = Math.max(8, Math.min(dogsCanvas.width - bubbleW - 8, targetX - bubbleW / 2));
  const y = Math.max(56, Math.min(dogsCanvas.height - bubbleH - 36, targetY - bubbleH - 14));

  dogsContext.save();
  dogsContext.fillStyle = "rgba(3, 9, 10, 0.94)";
  dogsContext.strokeStyle = dialogue.complete ? "#70ffe8" : "#ff405f";
  dogsContext.lineWidth = 1;
  dogsContext.shadowColor = dialogue.complete ? "#39f7c8" : "#ff305f";
  dogsContext.shadowBlur = 12;
  dogsContext.fillRect(x, y, bubbleW, bubbleH);
  dogsContext.strokeRect(x + 0.5, y + 0.5, bubbleW - 1, bubbleH - 1);
  dogsContext.shadowBlur = 0;
  dogsContext.fillStyle = dialogue.complete ? "#a7f7d0" : "#ff9aad";
  dogsContext.font = "900 10px monospace";
  dogsContext.textAlign = "left";
  dogsContext.textBaseline = "top";
  dogsContext.fillText("INSPECTOR QUERY", x + 12, y + 10);
  dogsContext.fillStyle = "#ecffe4";
  dogsContext.font = "900 12px monospace";
  lines.forEach((line, index) => dogsContext.fillText(line, x + 12, y + 28 + index * 15));

  if (!dialogue.complete) {
    const labels: Array<["yes" | "no" | "other", string]> = [["yes", "Y YES"], ["no", "N NO"], ["other", "O OTHER"]];
    const gap = 7;
    const buttonW = (bubbleW - 24 - gap * 2) / 3;
    const buttonY = y + bubbleH - buttonH - 10;
    for (const [index, [answer, label]] of labels.entries()) {
      const buttonX = x + 12 + index * (buttonW + gap);
      dogsContext.fillStyle = "rgba(255, 255, 255, 0.06)";
      dogsContext.strokeStyle = answer === "yes" ? "#70ffe8" : answer === "no" ? "#ff5f7a" : "#ffef7a";
      dogsContext.fillRect(buttonX, buttonY, buttonW, buttonH);
      dogsContext.strokeRect(buttonX + 0.5, buttonY + 0.5, buttonW - 1, buttonH - 1);
      dogsContext.fillStyle = "#ecffe4";
      dogsContext.textAlign = "center";
      dogsContext.fillText(label, buttonX + buttonW / 2, buttonY + 7);
      dogsInspectionAnswerRects.push({ answer, x: buttonX, y: buttonY, w: buttonW, h: buttonH });
    }
  }
  dogsContext.restore();
}

function drawDogsInspectionOverlay(frame: DogsCoreFrame, viewW: number, viewH: number): void {
  if (frame.frame < dogsInspectionAlertStartFrame || frame.frame > dogsInspectionAlertUntilFrame) return;
  const elapsed = frame.frame - dogsInspectionAlertStartFrame;
  const external = dogsInspectionAlertTitle.startsWith("WARNING");
  const flashIndex = Math.floor(elapsed / (external ? 48 : 36));
  const flashFrame = elapsed % (external ? 48 : 36);
  if (!external && (flashIndex >= 3 || flashFrame >= 22)) return;
  const visibleFrameLimit = external ? 38 : 22;
  if (flashFrame >= visibleFrameLimit) return;
  const alpha =
    flashFrame < 5
      ? flashFrame / 5
      : flashFrame > visibleFrameLimit - 7
        ? (visibleFrameLimit - flashFrame) / 7
        : 1;
  dogsContext.save();
  dogsContext.globalAlpha = alpha;
  dogsContext.fillStyle = "rgba(110, 0, 8, 0.34)";
  dogsContext.fillRect(0, 0, viewW, viewH);
  dogsContext.textAlign = "center";
  dogsContext.textBaseline = "middle";
  dogsContext.font = `900 ${Math.max(28, Math.floor(viewW / (external ? 19 : 13)))}px "Arial Black", Impact, sans-serif`;
  dogsContext.lineWidth = Math.max(3, Math.floor(viewW / 160));
  dogsContext.strokeStyle = "rgba(0, 0, 0, 0.92)";
  dogsContext.fillStyle = flashIndex % 2 === 0 ? "#ff304f" : "#ffef6e";
  dogsContext.shadowColor = "#ff304f";
  dogsContext.shadowBlur = 26;
  dogsContext.strokeText(dogsInspectionAlertTitle, viewW / 2, viewH * 0.35);
  dogsContext.fillText(dogsInspectionAlertTitle, viewW / 2, viewH * 0.35);
  dogsContext.font = `900 ${Math.max(12, Math.floor(viewW / (external ? 48 : 42)))}px monospace`;
  dogsContext.fillStyle = "#ffffff";
  dogsContext.shadowBlur = 8;
  for (const [index, line] of dogsInspectionAlertSubtitle.split("\n").entries()) {
    dogsContext.fillText(line, viewW / 2, viewH * 0.46 + index * Math.max(16, viewW / 46));
  }
  dogsContext.restore();
}

function processDogsAudio(frame: DogsCoreFrame): void {
  const events = frame.audioEvents ?? [];
  for (const event of events) {
    if (event === "inspection_alarm") {
      triggerDogsInspectionAlert(frame);
      void playDogsInspectionSiren();
    } else if (event === "external_inspection_alarm") {
      triggerDogsExternalInspectionAlert(frame);
      void playDogsExternalInspectionSiren();
    } else if (event === "mpa_hum") {
      void playDogsMpaHum();
    } else {
      void playDogsSfx(event, dogsGameplaySfxGain(event));
    }
  }
  if (events.length === 0) {
    processDogsAudioFallback(frame, dogsPreviousAudioFrame);
  }
  const exitReady = dogsExitReady(frame);
  if (exitReady && !dogsLastExitReady) {
    void playDogsSfx("portal_ready");
  }
  if (frame.summary.status === "won" && dogsLastExitReady) {
    void playDogsSfx("portal_enter");
  } else if (frame.summary.status === "running" && frame.frame - dogsLastPortalHumFrame >= (exitReady ? 210 : 600)) {
    dogsLastPortalHumFrame = frame.frame;
    void playDogsSfx("portal_idle", exitReady ? 0.14 : 0.045);
  }
  dogsLastExitReady = exitReady;
  dogsPreviousAudioFrame = frame;
}

function processDogsAudioFallback(frame: DogsCoreFrame, previous: DogsCoreFrame | null): void {
  if (!previous) return;
  if (
    frame.summary.mission === 2 &&
    previous.summary.mission === 2 &&
    previous.summary.elapsedTicks < 900 &&
    frame.summary.elapsedTicks >= 900
  ) {
    triggerDogsInspectionAlert(frame);
    void playDogsInspectionSiren();
  }
  if (
    frame.summary.mission === 10 &&
    previous.summary.mission === 10 &&
    previous.summary.elapsedTicks < 900 &&
    frame.summary.elapsedTicks >= 900
  ) {
    triggerDogsExternalInspectionAlert(frame);
    void playDogsExternalInspectionSiren();
  }
  if (frame.bullets.length > previous.bullets.length) {
    const hero = dogsLocalPlayer(frame);
    void playDogsSfx(hero?.activeWeapon ?? "scanner_blaster", 0.9);
  }
  if (frame.summary.objectsCollected > previous.summary.objectsCollected || frame.summary.cash > previous.summary.cash) {
    void playDogsSfx("pickup_rx", 0.82);
  }
  if (frame.summary.kills > previous.summary.kills || dogsQueueLeft(frame) < dogsQueueLeft(previous)) {
    void playDogsSfx("customer_defeated", 0.95);
  } else if (frame.summary.hits > previous.summary.hits || frame.summary.damageTaken > previous.summary.damageTaken) {
    void playDogsSfx("impact_heavy", 0.9);
  }
}

function triggerDogsInspectionAlert(frame: DogsCoreFrame): void {
  dogsInspectionAlertStartFrame = frame.frame;
  dogsInspectionAlertUntilFrame = frame.frame + 108;
  dogsInspectionAlertTitle = "INSPECTION!!!";
  dogsInspectionAlertSubtitle = "RETAIL COMPLIANCE BREACH";
}

function triggerDogsExternalInspectionAlert(frame: DogsCoreFrame): void {
  dogsInspectionAlertStartFrame = frame.frame;
  dogsInspectionAlertUntilFrame = frame.frame + 210;
  dogsInspectionAlertTitle = "WARNING EXTERNAL INSPECTION!";
  dogsInspectionAlertSubtitle = "The Medical Product Agency have arrived.\nBrace yourself.";
}

async function playDogsInspectionSiren(): Promise<void> {
  try {
    const context = await ensureAudio();
    if (!context) return;
    const scheduleBurst = (startTime: number): void => {
      const alarmGain = context.createGain();
      alarmGain.gain.setValueAtTime(0.0001, startTime);
      alarmGain.gain.exponentialRampToValueAtTime(0.42, startTime + 0.03);
      alarmGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.46);
      alarmGain.connect(audioGain ?? context.destination);
      let endedOscillators = 0;
      const makeOscillator = (offset: number): void => {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(420 + offset, startTime);
        oscillator.frequency.linearRampToValueAtTime(980 + offset, startTime + 0.23);
        oscillator.frequency.linearRampToValueAtTime(360 + offset, startTime + 0.46);
        oscillator.connect(alarmGain);
        activeAudioSources.add(oscillator);
        oscillator.onended = () => {
          activeAudioSources.delete(oscillator);
          oscillator.disconnect();
          endedOscillators += 1;
          if (endedOscillators >= 2) {
            alarmGain.disconnect();
          }
        };
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.5);
      };
      makeOscillator(0);
      makeOscillator(-14);
    };
    for (let index = 0; index < 3; index += 1) {
      scheduleBurst(context.currentTime + index * 0.62);
    }
  } catch {
    pushTrace("EutherDogs inspection siren skipped");
  }
}

async function playDogsExternalInspectionSiren(): Promise<void> {
  try {
    const context = await ensureAudio();
    if (!context) return;
    const scheduleWail = (startTime: number): void => {
      const alarmGain = context.createGain();
      alarmGain.gain.setValueAtTime(0.0001, startTime);
      alarmGain.gain.exponentialRampToValueAtTime(0.34, startTime + 0.08);
      alarmGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);
      alarmGain.connect(audioGain ?? context.destination);
      let endedOscillators = 0;
      const makeOscillator = (offset: number): void => {
        const oscillator = context.createOscillator();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(190 + offset, startTime);
        oscillator.frequency.linearRampToValueAtTime(620 + offset, startTime + 0.58);
        oscillator.frequency.linearRampToValueAtTime(180 + offset, startTime + 1.18);
        oscillator.connect(alarmGain);
        activeAudioSources.add(oscillator);
        oscillator.onended = () => {
          activeAudioSources.delete(oscillator);
          oscillator.disconnect();
          endedOscillators += 1;
          if (endedOscillators >= 3) {
            alarmGain.disconnect();
          }
        };
        oscillator.start(startTime);
        oscillator.stop(startTime + 1.22);
      };
      makeOscillator(0);
      makeOscillator(-9);
      makeOscillator(-23);
    };
    for (let index = 0; index < 3; index += 1) {
      scheduleWail(context.currentTime + index * 1.15);
    }
  } catch {
    pushTrace("EutherDogs external inspection siren skipped");
  }
}

async function playDogsMpaHum(): Promise<void> {
  try {
    const context = await ensureAudio();
    if (!context) return;
    const startTime = context.currentTime;
    const humGain = context.createGain();
    humGain.gain.setValueAtTime(0.0001, startTime);
    humGain.gain.exponentialRampToValueAtTime(0.08, startTime + 0.04);
    humGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.7);
    humGain.connect(audioGain ?? context.destination);
    const oscillators: OscillatorNode[] = [];
    for (const [index, frequency] of [82, 123].entries()) {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, startTime);
      oscillator.frequency.linearRampToValueAtTime(frequency + 9, startTime + 0.28);
      oscillator.frequency.linearRampToValueAtTime(frequency - 4, startTime + 0.68);
      oscillator.connect(humGain);
      activeAudioSources.add(oscillator);
      oscillator.onended = () => {
        activeAudioSources.delete(oscillator);
        oscillator.disconnect();
        if (oscillators.every((node) => !activeAudioSources.has(node))) {
          humGain.disconnect();
        }
      };
      oscillators.push(oscillator);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.72);
    }
  } catch {
    pushTrace("EutherDogs MPA hum skipped");
  }
}

function resolveDogsLocalExit(frame: DogsCoreFrame): boolean {
  if (frame.summary.status !== "running" || !dogsExitReady(frame) || !dogsHeroOnExit(frame)) {
    return false;
  }
  frame.summary.status = "won";
  void playDogsSfx("portal_enter");
  return true;
}

function dogsGameplaySfxGain(sound: string): number {
  if (sound === "portal_ready") return 0.95;
  if (sound === "customer_defeated" || sound === "impact_heavy") return 0.95;
  if (sound === "pickup_rx" || sound === "weapon_switch") return 0.82;
  return 0.88;
}

async function playDogsSfx(sound: string, gain = 0.55): Promise<void> {
  try {
    const url = dogsSfxAsset(sound);
    if (!url) return;
    const context = await ensureAudio();
    if (!context) return;
    let buffer = dogsSfxCache.get(url);
    if (!buffer) {
      const response = await fetch(url);
      const bytes = await response.arrayBuffer();
      buffer = await context.decodeAudioData(bytes.slice(0));
      dogsSfxCache.set(url, buffer);
    }
    const source = context.createBufferSource();
    const sfxGain = context.createGain();
    sfxGain.gain.value = Math.max(0, Math.min(1, gain));
    source.buffer = buffer;
    source.connect(sfxGain);
    sfxGain.connect(audioGain ?? context.destination);
    activeAudioSources.add(source);
    source.onended = () => {
      activeAudioSources.delete(source);
      sfxGain.disconnect();
    };
    source.start();
  } catch {
    pushTrace(`EutherDogs SFX skipped: ${sound}`);
  }
}

function applyEutherDogsCssAssets(): void {
  const plannedAssets: Record<string, string> = {
    "--dogs-shift-console": "shift_console_background",
    "--dogs-staff-roster": "staff_roster_background",
    "--dogs-dispensary": "dispensary_background",
    "--dogs-briefing": "shift_briefing_background",
    "--dogs-logo": "eutherdogs_logo",
    "--dogs-lamp-off": "selector_lamp_off",
    "--dogs-lamp-on": "selector_lamp_on",
    "--dogs-hud-bar": "hud_health_bar",
    "--dogs-menu-panel": "menu_panel",
    "--dogs-map-overlay": "security_map_overlay",
  };
  for (const [property, key] of Object.entries(plannedAssets)) {
    const url = dogsAsset("ui.planned", key);
    if (url) {
      document.documentElement.style.setProperty(property, `url("${url}")`);
    }
  }
}

function formatDogsClock(ticks: number | null | undefined): string {
  if (!Number.isFinite(ticks ?? NaN)) return "--";
  const totalSeconds = Math.max(0, Math.ceil((ticks ?? 0) / 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function dogsClockSource(summary: DogsCoreSummary): { label: string; ticks: number | null | undefined } {
  return summary.timeRemainingTicks == null
    ? { label: "Elapsed", ticks: summary.elapsedTicks }
    : { label: "Deadline", ticks: summary.timeRemainingTicks };
}

function updateDogsConsole(frame: DogsCoreFrame): void {
  const hero = dogsLocalPlayer(frame);
  const status = frame.summary.status.toUpperCase();
  const weapon = hero?.activeWeapon.replaceAll("_", " ") ?? "scanner";
  const armor = Math.max(0, hero?.armor ?? 0);
  const healthPercent = Math.min(100, Math.max(8, armor));
  const clock = dogsClockSource(frame.summary);
  const weaponIcon = dogsWeaponAsset(hero?.activeWeapon);
  const queueLeft = dogsQueueLeft(frame);
  eutherDogsRxLeft.textContent = `${frame.summary.mission}/${frame.summary.maxMission}`;
  eutherDogsTargetsLeft.textContent = String(queueLeft);
  eutherDogsCash.textContent = `$${frame.summary.cash}`;
  eutherDogsClockLabel.textContent = clock.label;
  eutherDogsClock.textContent = formatDogsClock(clock.ticks);
  eutherDogsWeapon.textContent = weapon;
  eutherDogsWeapon.style.setProperty("--dogs-active-weapon", weaponIcon ? `url("${weaponIcon}")` : "none");
  eutherDogsAlert.textContent =
    frame.summary.bossActive
      ? `BOSS:${frame.summary.bossName ?? "NGR3"}`
      : status === "RUNNING" ? `Mission ${frame.summary.mission}/${frame.summary.maxMission}` : `Mission ${status}`;
  eutherDogsHealthFill.style.width = `${healthPercent}%`;
  eutherDogsLamp.classList.toggle("is-hot", queueLeft > 0 && frame.summary.status === "running");
  eutherDogsConsole.classList.toggle("is-alert", queueLeft > 0);
  eutherDogsConsole.classList.toggle("is-boss", Boolean(frame.summary.bossActive));
  eutherDogsConsole.classList.toggle("is-closed", frame.summary.status !== "running");
  if (dogsMenuMode) {
    renderDogsMenu();
  }
}

function dogsLocalPlayer(frame: DogsCoreFrame): DogsCoreActor | undefined {
  const players = frame.characters.filter((actor) => actor.faction === "player" && actor.alive);
  return (
    players.find((actor) => actor.id === playerPort - 1) ??
    players[playerPort - 1] ??
    players[0]
  );
}

function predictedDogsActor(actor: DogsCoreActor | undefined): DogsCoreActor | undefined {
  if (!actor || actor.faction !== "player" || dogsInputSeq <= dogsLastAckedInputSeq) {
    return actor;
  }
  const dx = Number(inputState.right) - Number(inputState.left);
  const dy = Number(inputState.down) - Number(inputState.up);
  if (dx === 0 && dy === 0) {
    return actor;
  }
  const unacked = Math.min(3, Math.max(1, dogsInputSeq - dogsLastAckedInputSeq));
  const distance = 3 * unacked;
  const diagonal = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
  return {
    ...actor,
    x: actor.x + Math.round(dx * distance * diagonal),
    y: actor.y + Math.round(dy * distance * diagonal),
  };
}

function smoothDogsActor(actor: DogsCoreActor, isLocalPlayer: boolean): DogsCoreActor {
  const key = `${actor.faction}:${actor.id}`;
  const previous = dogsRenderActorPositions.get(key);
  if (!previous) {
    dogsRenderActorPositions.set(key, { x: actor.x, y: actor.y });
    return actor;
  }
  const dx = actor.x - previous.x;
  const dy = actor.y - previous.y;
  if (Math.hypot(dx, dy) > 80) {
    dogsRenderActorPositions.set(key, { x: actor.x, y: actor.y });
    return actor;
  }
  const factor = isLocalPlayer ? 0.72 : 0.42;
  const x = previous.x + dx * factor;
  const y = previous.y + dy * factor;
  const smoothed = { x, y };
  dogsRenderActorPositions.set(key, smoothed);
  return { ...actor, x: Math.round(x), y: Math.round(y) };
}

function dogsCurrentCash(): number {
  return dogsFrame?.summary.cash ?? 0;
}

function dogsCurrentHero(): DogsCoreActor | null {
  return dogsFrame ? dogsLocalPlayer(dogsFrame) ?? null : null;
}

function dogsAmmoLabel(ammo: number | null | undefined): string {
  if (ammo == null) return "Not stocked";
  return ammo < 0 ? "INF" : String(ammo);
}

const dogsStoreCatalog: Array<Pick<DogsStoreItem, "id" | "label" | "price" | "detail" | "weapon" | "ammo" | "armor">> = [
  {
    id: "label_printer",
    label: "Label Printer",
    price: 125,
    detail: "Fast short-range sticker burst",
    weapon: "label_printer",
    ammo: 80,
    armor: 0,
  },
  {
    id: "sterilizer_spray",
    label: "Sterilizer Spray",
    price: 175,
    detail: "Wide cone for queue control",
    weapon: "sterilizer_spray",
    ammo: 70,
    armor: 0,
  },
  {
    id: "capsule_launcher",
    label: "Capsule Launcher",
    price: 250,
    detail: "Slow explosive capsule dose",
    weapon: "capsule_launcher",
    ammo: 12,
    armor: 0,
  },
  {
    id: "autoinjector",
    label: "Autoinjector",
    price: 210,
    detail: "Single-dose dart with rude bedside manner",
    weapon: "autoinjector",
    ammo: 24,
    armor: 0,
  },
  {
    id: "needlegun",
    label: "Needlegun",
    price: 275,
    detail: "Rapid insurance-approved acupuncture",
    weapon: "needlegun",
    ammo: 120,
    armor: 0,
  },
  {
    id: "handsanitizer_flamethrower",
    label: "Handsanitizer Flamethrower",
    price: 325,
    detail: "Kills 99.9% of queue escalation",
    weapon: "handsanitizer_flamethrower",
    ammo: 90,
    armor: 0,
  },
  {
    id: "coat_reinforcement",
    label: "Coat Reinforcement",
    price: 100,
    detail: "Add 25 white-coat armor",
    weapon: null,
    ammo: 0,
    armor: 25,
  },
];

function dogsVisibleStoreItems(frame: DogsCoreFrame | null, cash: number, hero: DogsCoreActor | null): DogsStoreItem[] {
  const byId = new Map((frame?.store ?? []).map((item) => [item.id, item]));
  for (const item of dogsStoreCatalog) {
    const existing = byId.get(item.id);
    const active = Boolean(item.weapon && hero?.activeWeapon === item.weapon);
    byId.set(item.id, {
      ...existing,
      ...item,
      owned: item.armor > 0 ? Boolean(existing?.owned) : active || Boolean(existing?.owned),
      currentAmmo: active ? hero?.ammo : existing?.currentAmmo ?? null,
      active,
      affordable: cash >= (existing?.price ?? item.price),
    });
  }
  return dogsStoreCatalog.map((item) => byId.get(item.id)).filter((item): item is DogsStoreItem => Boolean(item));
}

function dogsStoreItemMeta(item: DogsStoreItem): string {
  if (item.armor > 0) {
    return `Coat +${item.armor}`;
  }
  if (item.owned) {
    return `${item.active ? "Active" : "Owned"} | Ammo ${dogsAmmoLabel(item.currentAmmo)}`;
  }
  return `New | Ammo +${dogsAmmoLabel(item.ammo)}`;
}

function dogsStoreActionLabel(item: DogsStoreItem): string {
  if (item.armor > 0) return `Boost $${item.price}`;
  if (item.owned) return `Refill $${item.price}`;
  return `Buy $${item.price}`;
}

function dogsStoreItemStatus(item: DogsStoreItem): string {
  if (item.active) return "Active";
  if (item.owned) return "Owned";
  if (item.armor > 0) return "Coat";
  return "New";
}

function dogsStoreItemClass(item: DogsStoreItem): string {
  return [
    item.active ? "is-equipped" : "",
    item.owned ? "is-owned" : "",
    item.armor > 0 ? "is-armor" : "is-weapon",
    dogsStorePreviewItemId === item.id ? "is-previewed" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function dogsStorePreviewMarkup(item: DogsStoreItem | null): string {
  if (!item) {
    return "";
  }
  const icon = dogsStoreItemIconMarkup(item);
  return `
    <section class="eutherdogs-store-preview" aria-label="RX store preview">
      ${icon}
      <span>${dogsStoreItemStatus(item)}</span>
      <strong>${item.label}</strong>
      <small>${item.detail}</small>
      <small>${dogsStoreItemMeta(item)}</small>
      <em>${dogsStoreActionLabel(item)}</em>
    </section>
  `;
}

function dogsDefaultHighScores(): DogsHighScoreEntry[] {
  return [
    {
      id: "seed-anon",
      name: "ANON",
      score: 1000,
      cash: 100,
      mission: 1,
      kills: 10,
      targetsDestroyed: 3,
      objectsCollected: 5,
      elapsedTicks: 3600,
      completed: true,
      staff: "Counter",
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  ];
}

function parseDogsHighScoresToml(toml: string): DogsHighScoreEntry[] {
  const entries: DogsHighScoreEntry[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (!current) return;
    const entry = normalizeDogsHighScoreEntry({
      id: current.id,
      name: current.name,
      score: Number(current.score),
      cash: Number(current.cash),
      mission: Number(current.mission),
      kills: Number(current.kills),
      targetsDestroyed: Number(current.targets_destroyed),
      objectsCollected: Number(current.objects_collected),
      elapsedTicks: Number(current.elapsed_ticks),
      completed: current.completed === "true",
      staff: current.staff,
      createdAt: current.created_at,
    });
    if (entry) entries.push(entry);
  };
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[highscores]]") {
      flush();
      current = {};
      continue;
    }
    if (!current) continue;
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    current[key] = value.startsWith('"') ? value.replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\") : value;
  }
  flush();
  return entries.sort(compareDogsHighScores).slice(0, dogsHighScoreLimit);
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function serializeDogsHighScoresToml(entries: DogsHighScoreEntry[]): string {
  const lines = [
    "# EutherDogs high scores",
    "# Edit values freely if you want to mod or cheat the board.",
    "",
  ];
  for (const entry of entries.sort(compareDogsHighScores).slice(0, dogsHighScoreLimit)) {
    lines.push("[[highscores]]");
    lines.push(`id = ${tomlString(entry.id)}`);
    lines.push(`name = ${tomlString(entry.name)}`);
    lines.push(`score = ${Math.trunc(entry.score)}`);
    lines.push(`cash = ${Math.trunc(entry.cash)}`);
    lines.push(`mission = ${Math.trunc(entry.mission)}`);
    lines.push(`kills = ${Math.trunc(entry.kills)}`);
    lines.push(`targets_destroyed = ${Math.trunc(entry.targetsDestroyed)}`);
    lines.push(`objects_collected = ${Math.trunc(entry.objectsCollected)}`);
    lines.push(`elapsed_ticks = ${Math.trunc(entry.elapsedTicks)}`);
    lines.push(`completed = ${entry.completed ? "true" : "false"}`);
    lines.push(`staff = ${tomlString(entry.staff)}`);
    lines.push(`created_at = ${tomlString(entry.createdAt)}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function loadDogsHighScoresToml(): Promise<void> {
  if (dogsHighScoresTomlLoadAttempted) return;
  if (!isTauri && ui.runtime !== "bridge") return;
  dogsHighScoresTomlLoadAttempted = true;
  const toml = await readDogsHighScoresToml();
  if (!toml) {
    await saveDogsHighScoresToml(serializeDogsHighScoresToml(readDogsHighScores()));
    return;
  }
  const entries = parseDogsHighScoresToml(toml);
  if (entries.length > 0) {
    window.localStorage.setItem(dogsHighScoresStorageKey, JSON.stringify(entries));
  }
}

async function readDogsHighScoresToml(): Promise<string | null> {
  if (isTauri) {
    try {
      return await invoke<string | null>("read_eutherdogs_highscores_toml");
    } catch {
      return null;
    }
  }
  if (ui.runtime === "bridge") {
    try {
      const response = await bridgeRequest("/eutherdogs-highscores", {}, 300);
      if (response.status === 204) return null;
      return await response.text();
    } catch {
      return null;
    }
  }
  return null;
}

async function saveDogsHighScoresToml(toml: string): Promise<void> {
  if (isTauri) {
    try {
      await invoke("save_eutherdogs_highscores_toml", { toml });
    } catch {
      pushTrace("EutherDogs highscore TOML save missed");
    }
    return;
  }
  if (ui.runtime === "bridge") {
    try {
      await bridgeRequest("/eutherdogs-highscores", {
        method: "POST",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: toml,
      });
    } catch {
      pushTrace("EutherDogs highscore TOML save missed");
    }
  }
}

function normalizeDogsHighScoreEntry(value: unknown): DogsHighScoreEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<DogsHighScoreEntry>;
  const score = Number(entry.score);
  if (!Number.isFinite(score)) return null;
  const name = String(entry.name ?? "ANON").trim().slice(0, 16) || "ANON";
  return {
    id: String(entry.id ?? `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`),
    name,
    score,
    cash: Number(entry.cash) || 0,
    mission: Number(entry.mission) || 1,
    kills: Number(entry.kills) || 0,
    targetsDestroyed: Number(entry.targetsDestroyed) || 0,
    objectsCollected: Number(entry.objectsCollected) || 0,
    elapsedTicks: Number(entry.elapsedTicks) || 0,
    completed: Boolean(entry.completed),
    staff: String(entry.staff ?? "Counter").slice(0, 24),
    createdAt: String(entry.createdAt ?? new Date().toISOString()),
  };
}

function compareDogsHighScores(a: DogsHighScoreEntry, b: DogsHighScoreEntry): number {
  return (
    Number(b.completed) - Number(a.completed) ||
    b.score - a.score ||
    b.mission - a.mission ||
    b.kills - a.kills ||
    b.targetsDestroyed - a.targetsDestroyed ||
    b.objectsCollected - a.objectsCollected ||
    a.elapsedTicks - b.elapsedTicks ||
    a.name.localeCompare(b.name)
  );
}

function readDogsHighScores(): DogsHighScoreEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(dogsHighScoresStorageKey) ?? "[]");
    const entries = Array.isArray(parsed)
      ? parsed.map(normalizeDogsHighScoreEntry).filter((entry): entry is DogsHighScoreEntry => Boolean(entry))
      : [];
    return (entries.length ? entries : dogsDefaultHighScores()).sort(compareDogsHighScores).slice(0, dogsHighScoreLimit);
  } catch {
    return dogsDefaultHighScores();
  }
}

function writeDogsHighScores(entries: DogsHighScoreEntry[]): void {
  localStorage.setItem(
    dogsHighScoresStorageKey,
    JSON.stringify(entries.sort(compareDogsHighScores).slice(0, dogsHighScoreLimit)),
  );
}

function makeDogsHighScoreEntry(frame: DogsCoreFrame, name: string): DogsHighScoreEntry {
  const staff = dogsStaffOptions.find((option) => option.id === selectedDogsStaff);
  return {
    id: `score-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    name: name.trim().slice(0, 3).toUpperCase() || "AAA",
    score: frame.summary.score,
    cash: frame.summary.cash,
    mission: frame.summary.mission || selectedDogsMission,
    kills: frame.summary.kills,
    targetsDestroyed: frame.summary.targetsDestroyed,
    objectsCollected: frame.summary.objectsCollected,
    elapsedTicks: frame.summary.elapsedTicks,
    completed: frame.summary.status === "won",
    staff: staff?.role ?? "Counter",
    createdAt: new Date().toISOString(),
  };
}

function storeDogsHighScoreEntry(entry: DogsHighScoreEntry): void {
  const entries = [...readDogsHighScores(), entry].sort(compareDogsHighScores).slice(0, dogsHighScoreLimit);
  writeDogsHighScores(entries);
  void saveDogsHighScoresToml(serializeDogsHighScoresToml(entries));
}

function queueDogsHighScore(frame: DogsCoreFrame): void {
  if (frame.summary.status === "running" || dogsSubmittedHighscoreFrame === frame.frame) return;
  dogsSubmittedHighscoreFrame = frame.frame;
  dogsPendingHighscoreFrame = frame;
  dogsHighscoreInitials = ["A", "A", "A"];
  dogsHighscoreInitialIndex = 0;
  dogsHighscoreSavedName = null;
}

function stepDogsHighscoreInitial(delta: number): void {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const current = alphabet.indexOf(dogsHighscoreInitials[dogsHighscoreInitialIndex] ?? "A");
  dogsHighscoreInitials[dogsHighscoreInitialIndex] = alphabet[(current + delta + alphabet.length) % alphabet.length];
}

async function submitPendingDogsHighScore(): Promise<void> {
  if (!dogsPendingHighscoreFrame) return;
  const name = dogsHighscoreInitials.join("");
  storeDogsHighScoreEntry(makeDogsHighScoreEntry(dogsPendingHighscoreFrame, name));
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = name;
  renderDogsMenu();
}

function dogsTimeLabel(ticks: number): string {
  const totalSeconds = Math.max(0, Math.floor(ticks / 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function dogsHighScoreBoardMarkup(): string {
  const entries = readDogsHighScores();
  dogsSelectedHighScoreIndex = Math.max(0, Math.min(dogsSelectedHighScoreIndex, entries.length - 1));
  const selected = entries[dogsSelectedHighScoreIndex] ?? null;
  const backMarkup = `
    <button class="eutherdogs-score-back" data-score-back="true" type="button">
      Back
    </button>
  `;
  if (!entries.length) {
    return `
      <div class="eutherdogs-scoreboard">
        ${backMarkup}
        <div class="eutherdogs-score-empty">No closures logged</div>
      </div>
    `;
  }
  return `
    <div class="eutherdogs-scoreboard">
      ${backMarkup}
      ${
        selected
          ? `
            <div class="eutherdogs-score-detail">
              <span>${String(dogsSelectedHighScoreIndex + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(selected.name)}</strong>
              <em>${selected.score}</em>
              <small>${selected.completed ? "Closed" : "Failed"} | K ${selected.kills} | RX ${selected.objectsCollected} | ${dogsTimeLabel(selected.elapsedTicks)}</small>
            </div>
          `
          : ""
      }
      ${entries
        .map(
          (entry, index) => `
            <button class="eutherdogs-score-row ${index === dogsSelectedHighScoreIndex ? "is-selected" : ""} ${entry.completed ? "is-complete" : "is-failed"}" data-score-row="${index}" type="button">
              <span>${String(index + 1).padStart(2, "0")}</span>
              <strong>${escapeHtml(entry.name)}</strong>
              <em>${entry.score}</em>
              <small>${entry.completed ? "Closed" : "Failed"} | K ${entry.kills} | RX ${entry.objectsCollected} | ${dogsTimeLabel(entry.elapsedTicks)}</small>
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}

function dogsHighScoreEntryMarkup(frame: DogsCoreFrame | null): string {
  if (!frame) return dogsHighScoreBoardMarkup();
  return `
    <div class="eutherdogs-score-entry">
      <div class="eutherdogs-score-entry-summary">
        <span>Score</span><strong>${frame.summary.score}</strong>
        <span>Cash</span><strong>$${frame.summary.cash}</strong>
        <span>Queue</span><strong>${frame.summary.kills}</strong>
      </div>
      <div class="eutherdogs-initials" aria-label="high score initials">
        ${dogsHighscoreInitials
          .map(
            (letter, index) => `
              <button class="${index === dogsHighscoreInitialIndex ? "is-active" : ""}" data-score-initial="${index}" type="button">
                ${letter}
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="eutherdogs-initial-actions">
        <button data-score-step="-1" type="button">Prev</button>
        <button data-score-step="1" type="button">Next</button>
        <button data-score-submit="true" type="button">Save</button>
      </div>
    </div>
  `;
}

function dogsHighScoreSavedMarkup(): string {
  if (!dogsHighscoreSavedName) return "";
  return `
    <div class="eutherdogs-score-entry">
      <div class="eutherdogs-score-entry-summary">
        <span>Highscore</span><strong>Saved</strong>
        <span>Name</span><strong>${dogsHighscoreSavedName}</strong>
      </div>
    </div>
  `;
}

function showDogsMenu(mode: Exclude<DogsMenuMode, null>): void {
  dogsMenuMode = mode;
  ui.playing = false;
  playToggle.textContent = "Play";
  stopDogsSnapshotStream();
  stopBridgeStream();
  renderDogsMenu();
  eutherDogsMenu.setAttribute("aria-hidden", "false");
  eutherDogsMenu.classList.add("is-open");
}

function hideDogsMenu(): void {
  dogsMenuMode = null;
  eutherDogsMenu.setAttribute("aria-hidden", "true");
  eutherDogsMenu.classList.remove("is-open");
}

function startDogsShift(): void {
  hideDogsMenu();
  ui.playing = true;
  ui.status = "DOGS RUNNING";
  playToggle.textContent = "Pause";
  startDogsSnapshotStream();
  nextFrameDue = performance.now();
  renderUi();
  void ensureAudio();
  void animationLoop();
}

function renderDogsMenu(): void {
  const cash = dogsCurrentCash();
  const hero = dogsCurrentHero();
  const storeItems = dogsVisibleStoreItems(dogsFrame, cash, hero);
  const mission = dogsFrame?.summary.mission ?? selectedDogsMission;
  const maxMission = dogsFrame?.summary.maxMission ?? 10;
  eutherDogsMenuCash.textContent = `$${cash}`;
  eutherDogsStaffOpen.classList.toggle("is-active", dogsMenuMode === "staff");
  eutherDogsStoreOpen.classList.toggle("is-active", dogsMenuMode === "store");
  eutherDogsBriefingOpen.classList.toggle("is-active", dogsMenuMode === "briefing");
  eutherDogsScoresOpen.classList.toggle("is-active", dogsMenuMode === "scores");
  eutherDogsStartShift.textContent =
    dogsMenuMode === "scores"
      ? "Back"
      : dogsMenuMode === "result" && dogsFrame?.summary.status === "won"
      ? mission >= maxMission
        ? "Main menu"
        : "Next shift"
      : dogsMenuMode === "result"
        ? "Retry shift"
        : "Start shift";
  eutherDogsMenu.classList.toggle("is-staff", dogsMenuMode === "staff");
  eutherDogsMenu.classList.toggle("is-store", dogsMenuMode === "store");
  eutherDogsMenu.classList.toggle("is-briefing", dogsMenuMode === "briefing");
  eutherDogsMenu.classList.toggle("is-scores", dogsMenuMode === "scores");
  eutherDogsMenu.classList.toggle("is-result", dogsMenuMode === "result");
  if (dogsMenuMode === "staff") {
    eutherDogsMenuKicker.textContent = "Staff Select";
    eutherDogsMenuTitle.textContent = `Choose P${playerPort} Counter Liability`;
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-briefing-grid">
        <div><span>P1</span><strong>${dogsCharacterName(selectedDogsCharacters[1])}</strong></div>
        <div><span>P2</span><strong>${dogsCharacterName(selectedDogsCharacters[2])}</strong></div>
      </div>
      <div class="eutherdogs-staff-grid">
        ${dogsStaffOptions
          .map(
            (staff) => `
              <button class="eutherdogs-staff-card ${selectedDogsCharacters[playerPort] === staff.character ? "is-selected" : ""}" data-staff-id="${staff.id}" type="button">
                <span class="eutherdogs-selector-lamp"></span>
                ${dogsStaffSpriteMarkup(staff)}
                <span>${staff.role}</span>
                <strong>${staff.name}</strong>
                <small>Coat ${staff.armor} | Cash $${staff.cash}</small>
                <small>${staff.loadout}</small>
                <em>${staff.note}</em>
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }
  if (dogsMenuMode === "briefing") {
    const summary = dogsFrame?.summary;
    const queueLeft = dogsQueueLeft(dogsFrame);
    eutherDogsMenuKicker.textContent = "Briefing";
    eutherDogsMenuTitle.textContent = `Mission ${mission}/${maxMission} Protocol`;
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-briefing-grid">
        <div><span>Mission</span><strong>${mission} / ${maxMission}</strong></div>
        <div><span>Retrieve</span><strong>${summary?.objectsLeft ?? 0} RX objects</strong></div>
        <div><span>Defuse</span><strong>${queueLeft} angry customers</strong></div>
        <div><span>Minimum</span><strong>${summary?.minimumKills ?? 0} removals</strong></div>
        <div><span>Policy</span><strong>No refunds after laser contact</strong></div>
        <div><span>Uniform</span><strong>White coat, zero patience</strong></div>
      </div>
      <div class="eutherdogs-level-select" aria-label="mission select">
        ${Array.from({ length: maxMission }, (_, index) => index + 1)
          .map(
            (level) => `
              <button class="${level === selectedDogsMission ? "is-selected" : ""}" data-dogs-mission="${level}" type="button">
                <span>Level</span>
                <strong>${level}</strong>
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    return;
  }
  if (dogsMenuMode === "scores") {
    eutherDogsMenuKicker.textContent = "High Score Board";
    eutherDogsMenuTitle.textContent = "Best Counter Closures";
    eutherDogsMenuBody.innerHTML = dogsHighScoreBoardMarkup();
    return;
  }
  if (dogsMenuMode === "result") {
    const summary = dogsFrame?.summary;
    const won = summary?.status === "won";
    eutherDogsMenuKicker.textContent = won ? "Shift Closed" : "Shift Failed";
    eutherDogsMenuTitle.textContent = dogsPendingHighscoreFrame
      ? "Enter Initials"
      : won
        ? "Receipts Balanced"
        : "Counter Incident Report";
    eutherDogsMenuBody.innerHTML = `
      <div class="eutherdogs-result-grid">
        <div><span>Mission</span><strong>${summary?.mission ?? mission} / ${summary?.maxMission ?? maxMission}</strong></div>
        <div><span>Status</span><strong>${summary?.status.toUpperCase() ?? "UNKNOWN"}</strong></div>
        <div><span>Score</span><strong>${summary?.score ?? 0}</strong></div>
        <div><span>Cash</span><strong>$${summary?.cash ?? 0}</strong></div>
        <div><span>Kills</span><strong>${summary?.kills ?? 0}</strong></div>
        <div><span>RX collected</span><strong>${summary?.objectsCollected ?? 0}</strong></div>
        <div><span>Targets</span><strong>${summary?.targetsDestroyed ?? 0}</strong></div>
        <div><span>Shots / hits</span><strong>${summary?.shotsFired ?? 0} / ${summary?.hits ?? 0}</strong></div>
        <div><span>Damage taken</span><strong>${summary?.damageTaken ?? 0}</strong></div>
        <div><span>Board</span><strong>${readDogsHighScores()[0]?.score ?? 0}</strong></div>
      </div>
      ${dogsPendingHighscoreFrame ? dogsHighScoreEntryMarkup(dogsPendingHighscoreFrame) : dogsHighScoreSavedMarkup()}
    `;
    return;
  }
  eutherDogsMenuKicker.textContent = "RX Store";
  eutherDogsMenuTitle.textContent = `Counter | Coat ${hero?.armor ?? 0} | ${hero?.activeWeapon.replaceAll("_", " ") ?? "scanner"}`;
  const previewItem =
    storeItems.find((item) => item.id === dogsStorePreviewItemId) ??
    storeItems.find((item) => item.active) ??
    storeItems[0] ??
    null;
  eutherDogsMenuBody.innerHTML = storeItems
    ? `
      <div class="eutherdogs-armory-layout">
        <aside class="eutherdogs-inventory-panel">
          <section class="eutherdogs-player-loadout">
            ${hero ? dogsWeaponIconMarkup(hero.activeWeapon, hero.activeWeapon) : ""}
            <strong>${dogsCharacterName(selectedDogsCharacters[playerPort])}</strong>
            <span>Coat ${hero?.armor ?? 0}</span>
            <span>Active ${hero?.activeWeapon.replaceAll("_", " ") ?? "scanner"}</span>
            <span>Ammo ${dogsAmmoLabel(hero?.ammo)}</span>
            <em>Cash $${cash}</em>
          </section>
          ${dogsStorePreviewMarkup(previewItem)}
        </aside>
        <div class="eutherdogs-store-grid">
          ${storeItems
            .map((item) => {
              return `
                <div class="eutherdogs-store-item ${dogsStoreItemClass(item)}" data-store-item="${item.id}" role="button" tabindex="0">
                  ${dogsStoreItemIconMarkup(item)}
                  <span>
                    <b>${dogsStoreItemStatus(item)}</b>
                    <strong>${item.label}</strong>
                    <small>${item.detail}</small>
                    <small>${dogsStoreItemMeta(item)}</small>
                  </span>
                  <button class="eutherdogs-store-buy" data-store-buy="${item.id}" type="button" ${item.affordable ? "" : "disabled"}>
                    ${dogsStoreActionLabel(item)}
                  </button>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `
    : "";
}

async function purchaseDogsStoreItem(itemId: string): Promise<void> {
  if (!itemId) return;
  try {
    void playDogsSfx("impact_heavy", 0.9);
    void playDogsSfx("pickup_rx", 0.5);
    dogsFrame = await purchaseDogsCoreItem(itemId);
    processDogsAudio(dogsFrame);
    drawDogsFrame(dogsFrame);
    renderDogsMenu();
    pushTrace(`RX Store purchased ${itemId}`);
  } catch (err) {
    pushTrace(`RX Store denied ${itemId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function selectDogsStaff(staff: 1 | 2): Promise<void> {
  selectedDogsStaff = staff;
  selectedDogsCharacters[playerPort] = dogsStaffOptions.find((option) => option.id === staff)?.character ?? "night_shift_tech";
  writeStoredDogsCharacters();
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    drawDogsFrame(dogsFrame);
    showDogsMenu("store");
    pushTrace(`EutherDogs P${playerPort} selected ${dogsCharacterName(selectedDogsCharacters[playerPort])}`);
  } catch (err) {
    pushTrace(`EutherDogs staff select failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

async function selectDogsMission(mission: number): Promise<void> {
  selectedDogsMission = Math.min(10, Math.max(1, Math.trunc(mission)));
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    drawDogsFrame(dogsFrame);
    showDogsMenu("briefing");
    pushTrace(`EutherDogs level ${selectedDogsMission} selected`);
  } catch (err) {
    pushTrace(`EutherDogs level select failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

async function retryDogsShift(): Promise<void> {
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    drawDogsFrame(dogsFrame);
    showDogsMenu("store");
    pushTrace("EutherDogs shift retried");
  } catch (err) {
    pushTrace(`EutherDogs retry failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
}

async function startDogsNextMission(): Promise<void> {
  try {
    if (dogsPendingHighscoreFrame) {
      await submitPendingDogsHighScore();
    }
    dogsFrame = await nextDogsCoreMission();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission + 1;
    dogsLastExitReady = dogsExitReady(dogsFrame);
    dogsLastPortalHumFrame = -9999;
    dogsPreviousAudioFrame = dogsFrame;
    drawDogsFrame(dogsFrame);
    showDogsMenu("store");
    pushTrace(`EutherDogs mission ${selectedDogsMission} ready`);
  } catch (err) {
    pushTrace(`EutherDogs next mission failed: ${err instanceof Error ? err.message : String(err)}`);
    renderDogsMenu();
  }
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

function readStoredDogsAssetMode(): DogsAssetMode {
  return localStorage.getItem(dogsAssetModeStorageKey) === "2x" ? "2x" : "classic";
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

function setDogsAssetMode(mode: DogsAssetMode): void {
  if (dogsAssetMode === mode) {
    return;
  }
  dogsAssetMode = mode;
  localStorage.setItem(dogsAssetModeStorageKey, mode);
  dogsImageCache.clear();
  dogsSfxCache.clear();
  applyEutherDogsCssAssets();
  preloadDogsCombatAssets();
  renderDogsAssetMode();
  if (dogsMode && dogsFrame) {
    drawDogsFrame(dogsFrame);
    renderDogsMenu();
  }
}

function renderDogsAssetMode(): void {
  dogsAssetModeButtons.forEach((button) => {
    const selected = button.dataset.dogsAssetMode === dogsAssetMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

async function enterDogsMode(): Promise<void> {
  dogsMode = true;
  updateStartupModePreference("dogs");
  resetScheduledAudio();
  stopBridgeStream();
  preloadDogsCombatAssets();
  try {
    dogsFrame = await startDogsCore();
    selectedDogsMission = dogsFrame.summary.mission || selectedDogsMission;
    await loadDogsHighScoresToml();
  } catch (err) {
    dogsMode = false;
    pushTrace(`EutherDogs core failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  Object.assign(ui, {
    loaded: true,
    playing: false,
    runtime: isTauri ? ("tauri" as const) : ui.runtime === "bridge" ? ("bridge" as const) : ("web" as const),
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
  eutherDogsConsole.setAttribute("aria-hidden", "false");
  eutherDogsToggle.classList.add("is-active");
  dogsLastExitReady = dogsExitReady(dogsFrame);
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = dogsFrame;
  drawDogsFrame(dogsFrame);
  showDogsMenu("staff");
  renderUi();
  pushTrace("EutherDogs Rust core started");
}

function leaveDogsMode(): void {
  dogsMode = false;
  updateStartupModePreference("megadrive");
  stopDogsSnapshotStream();
  dogsLastExitReady = false;
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = null;
  dogsInspectionAlertStartFrame = -1;
  dogsInspectionAlertUntilFrame = -1;
  dogsInspectionAlertTitle = "INSPECTION!!!";
  dogsInspectionAlertSubtitle = "RETAIL COMPLIANCE BREACH";
  dogsSawHostileQueue = false;
  ui.playing = false;
  ui.loaded = false;
  ui.title = "No ROM";
  ui.status = "IDLE";
  playToggle.textContent = "Play";
  document.body.classList.remove("eutherdogs-mode");
  eutherDogsConsole.setAttribute("aria-hidden", "true");
  hideDogsMenu();
  eutherDogsToggle.classList.remove("is-active");
  drawSyntheticFrame();
  renderUi();
}

function resetDogsMode(): void {
  ui.playing = false;
  ui.frame = 0;
  ui.status = "DOGS RESET";
  dogsSubmittedHighscoreFrame = null;
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = null;
  playToggle.textContent = "Play";
  void resetDogsCore()
    .then((frame) => {
      dogsFrame = frame;
      drawDogsFrame(frame);
      renderUi();
    })
    .catch((err) => {
      ui.status = "DOGS ERROR";
      ui.lastError = err instanceof Error ? err.message : String(err);
      renderUi();
    });
}

async function runDogsFrame(): Promise<void> {
  const started = performance.now();
  try {
    dogsFrame = await runDogsCoreFrame();
    lastDogsSnapshotAt = performance.now();
    dogsSnapshotMisses = 0;
  } catch (err) {
    dogsSnapshotMisses += 1;
    if (!dogsFrame) {
      throw err;
    }
    drawDogsFrame(dogsFrame);
    const held = performance.now();
    ui.frame = dogsFrame.frame;
    ui.transportMs = held - started;
    ui.drawMs = 0;
    ui.transportMode = `DOGS HOLD ${dogsSnapshotMisses}`;
    ui.status = `DOGS ${dogsFrame.summary.status.toUpperCase()}`;
    return;
  }
  if (dogsFrame.frame !== lastDogsProcessedFrame) {
    processDogsAudio(dogsFrame);
    resolveDogsLocalExit(dogsFrame);
    lastDogsProcessedFrame = dogsFrame.frame;
  }
  drawDogsFrame(dogsFrame);
  const done = performance.now();
  ui.frame = dogsFrame.frame;
  ui.cpuCycles = dogsFrame.characters.filter((actor) => actor.faction !== "player" && actor.alive).length;
  ui.cpuSteps = dogsFrame.bullets.length;
  ui.frameMs = 16.67;
  ui.transportMs = 0;
  ui.drawMs = done - started;
  ui.audioLeadMs = 0;
  ui.status = `DOGS ${dogsFrame.summary.status.toUpperCase()}`;
  if (dogsFrame.summary.status !== "running") {
    queueDogsHighScore(dogsFrame);
    ui.playing = false;
    playToggle.textContent = "Play";
    stopDogsSnapshotStream();
    showDogsMenu("result");
  }
}

function startDogsSnapshotStream(): void {
  if (isTauri || ui.runtime !== "bridge" || dogsStream) {
    return;
  }
  dogsStream = new EventSource(bridgeUrl(`/eutherdogs/stream?player=${playerPort}`), {
    withCredentials: true,
  });
  dogsStream.onmessage = (event) => {
    try {
      dogsFrame = mergeDogsStreamFrame(dogsFrame, JSON.parse(event.data) as DogsStreamFrame);
      dogsLastAckedInputSeq = dogsFrame.ackedInputSeq ?? dogsLastAckedInputSeq;
      lastDogsSnapshotAt = performance.now();
      dogsSnapshotMisses = 0;
      ui.transportMode = "DOGS SSE";
    } catch (err) {
      ui.lastError = err instanceof Error ? err.message : String(err);
    }
  };
  dogsStream.onerror = () => {
    dogsSnapshotMisses += 1;
    ui.transportMode = `DOGS SSE HOLD ${dogsSnapshotMisses}`;
  };
}

function mergeDogsStreamFrame(previous: DogsCoreFrame | null, patch: DogsStreamFrame): DogsCoreFrame {
  if (!previous && (!patch.tiles || !patch.visibility || !patch.store)) {
    throw new Error("EutherDogs stream missing initial static state");
  }
  const base = previous as DogsCoreFrame;
  return {
    frame: patch.frame,
    width: patch.width ?? base.width,
    height: patch.height ?? base.height,
    tileWidth: patch.tileWidth ?? base.tileWidth,
    tileHeight: patch.tileHeight ?? base.tileHeight,
    characterWidth: patch.characterWidth ?? base.characterWidth,
    characterHeight: patch.characterHeight ?? base.characterHeight,
    tiles: patch.tiles ?? base.tiles,
    visibility: patch.visibility ?? base.visibility,
    characters: patch.characters,
    bullets: patch.bullets,
    inspectionDialogues: patch.inspectionDialogues ?? base.inspectionDialogues ?? [],
    summary: patch.summary,
    store: patch.store ?? base.store,
    audioEvents: patch.audioEvents ?? [],
    highscoreCount: patch.highscoreCount ?? base.highscoreCount,
    ackedInputSeq: patch.ackedInputSeq ?? base.ackedInputSeq,
  };
}

function stopDogsSnapshotStream(): void {
  dogsStream?.close();
  dogsStream = null;
}

async function startDogsCore(): Promise<DogsCoreFrame> {
  const start = {
    staff: selectedDogsStaff,
    mission: selectedDogsMission,
    players: 2,
    characters: [selectedDogsCharacters[1], selectedDogsCharacters[2]],
  };
  dogsPreviousActorPositions = new Map();
  dogsRenderActorPositions = new Map();
  dogsActorFacings = new Map();
  dogsLastExitReady = false;
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = null;
  dogsSawHostileQueue = false;
  dogsTrackedBullets = new Map();
  dogsImpactEffects = [];
  dogsLastImpactFrameProcessed = -1;
  dogsSubmittedHighscoreFrame = null;
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = null;
  lastDogsInputJson = "";
  lastDogsInputSentAt = 0;
  lastDogsSnapshotAt = 0;
  dogsSnapshotMisses = 0;
  lastDogsProcessedFrame = -1;
  dogsInputSeq = 0;
  dogsLastAckedInputSeq = 0;
  stopDogsSnapshotStream();
  if (isTauri) {
    return await invoke<DogsCoreFrame>("start_eutherdogs", { start });
  }
  if (ui.runtime !== "bridge") {
    await connectBridge(false);
  }
  if (ui.runtime === "bridge") {
    return await bridgeJson<DogsCoreFrame>("/eutherdogs/start", {
      method: "POST",
      body: JSON.stringify(start),
    });
  }
  throw new Error("starta web bridge eller Tauri for Rust-core demo");
}

async function nextDogsCoreMission(): Promise<DogsCoreFrame> {
  dogsPreviousActorPositions = new Map();
  dogsRenderActorPositions = new Map();
  dogsActorFacings = new Map();
  dogsLastExitReady = false;
  dogsLastPortalHumFrame = -9999;
  dogsPreviousAudioFrame = null;
  dogsSawHostileQueue = false;
  dogsTrackedBullets = new Map();
  dogsImpactEffects = [];
  dogsLastImpactFrameProcessed = -1;
  dogsSubmittedHighscoreFrame = null;
  dogsPendingHighscoreFrame = null;
  dogsHighscoreSavedName = null;
  if (isTauri) {
    return await invoke<DogsCoreFrame>("advance_eutherdogs_mission");
  }
  if (ui.runtime !== "bridge") {
    await connectBridge(false);
  }
  if (ui.runtime === "bridge") {
    return await bridgeJson<DogsCoreFrame>("/eutherdogs/next", { method: "POST" });
  }
  throw new Error("starta web bridge eller Tauri for Rust-core demo");
}

async function resetDogsCore(): Promise<DogsCoreFrame> {
  dogsTrackedBullets = new Map();
  dogsImpactEffects = [];
  dogsLastImpactFrameProcessed = -1;
  if (isTauri) {
    return await invoke<DogsCoreFrame>("reset_eutherdogs");
  }
  return await bridgeJson<DogsCoreFrame>("/eutherdogs/reset", { method: "POST" });
}

async function runDogsCoreFrame(): Promise<DogsCoreFrame> {
  const input = { ...inputState, player: playerPort, seq: dogsInputSeq };
  if (isTauri) {
    return await invoke<DogsCoreFrame>("run_eutherdogs_frame", { input });
  }
  await syncDogsBridgeInput(input);
  if (dogsStream && dogsFrame) {
    const age = performance.now() - lastDogsSnapshotAt;
    if (age > 450) {
      stopDogsSnapshotStream();
      ui.transportMode = "DOGS SSE RESTART";
      startDogsSnapshotStream();
    }
    return dogsFrame;
  }
  const now = performance.now();
  if (dogsFrame && now - lastDogsSnapshotAt < 33) {
    return dogsFrame;
  }
  return await bridgeJson<DogsCoreFrame>(`/eutherdogs/snapshot?player=${playerPort}`, {}, 180);
}

async function syncDogsWeaponSlot(slot: number): Promise<void> {
  try {
    await syncDogsBridgeInput({ ...inputState, player: playerPort, weaponSlot: slot });
    pushTrace(`EutherDogs weapon slot ${slot + 1}`);
  } catch (err) {
    dogsSnapshotMisses += 1;
    ui.transportMode = "DOGS INPUT HOLD";
    ui.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function answerDogsInspection(answer: "yes" | "no" | "other"): Promise<void> {
  try {
    await syncDogsBridgeInput({ ...inputState, player: playerPort, inspectionAnswer: answer });
    pushTrace(`Inspection answer ${answer.toUpperCase()}`);
  } catch (err) {
    dogsSnapshotMisses += 1;
    ui.transportMode = "DOGS INSPECTION HOLD";
    ui.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function syncDogsBridgeInput(input: DogsBridgeInput): Promise<void> {
  const now = performance.now();
  const changedInput = { ...input, seq: undefined };
  const nextState = JSON.stringify(changedInput);
  if (nextState === lastDogsInputJson && now - lastDogsInputSentAt < 120) {
    return;
  }
  if (nextState !== lastDogsInputJson) {
    dogsInputSeq += 1;
  }
  const payload = { ...input, seq: dogsInputSeq };
  const next = JSON.stringify(payload);
  lastDogsInputJson = nextState;
  lastDogsInputSentAt = now;
  await bridgeRequest("/eutherdogs/input", {
    method: "POST",
    body: next,
  }, 180);
}

async function purchaseDogsCoreItem(itemId: string): Promise<DogsCoreFrame> {
  const purchase = { itemId, player: playerPort };
  if (isTauri) {
    return await invoke<DogsCoreFrame>("purchase_eutherdogs_item", { purchase });
  }
  return await bridgeJson<DogsCoreFrame>("/eutherdogs/purchase", {
    method: "POST",
    body: JSON.stringify(purchase),
  });
}

function drawDogsFrame(frame: DogsCoreFrame | null): void {
  dogsInspectionAnswerRects = [];
  dogsContext.fillStyle = "#07100d";
  dogsContext.fillRect(0, 0, dogsCanvas.width, dogsCanvas.height);
  if (!frame) return;

  const worldW = frame.width * frame.tileWidth;
  const worldH = frame.height * frame.tileHeight;
  const serverPlayer = dogsLocalPlayer(frame);
  const localPlayerTarget = predictedDogsActor(serverPlayer);
  const localPlayer =
    localPlayerTarget && serverPlayer
      ? smoothDogsActor(localPlayerTarget, true)
      : undefined;
  const player = localPlayer ?? frame.characters[0];
  const yScale = eutherDogsRenderYScale;
  const scale = Math.max(
    0.18,
    Math.min(
      dogsCanvas.width / eutherDogsCameraWorldWidth,
      dogsCanvas.height / (eutherDogsCameraWorldHeight * yScale),
    ),
  );
  const viewW = dogsCanvas.width / scale;
  const viewH = dogsCanvas.height / (scale * yScale);
  const cameraX = Math.max(0, Math.min(worldW - viewW, (player?.x ?? 0) - viewW / 2));
  const rawCameraY = Math.max(0, Math.min(worldH - viewH, (player?.y ?? 0) - viewH / 2));
  const playerY = player?.y ?? 0;
  const playerScreenY = (playerY - rawCameraY) * yScale * scale;
  const safeTop = eutherDogsTopHudSafePx + frame.characterHeight * scale * 0.25;
  const safeBottom = dogsCanvas.height - eutherDogsBottomHudSafePx - frame.characterHeight * scale;
  const cameraY =
    playerScreenY < safeTop
      ? Math.max(0, Math.min(worldH - viewH, playerY - safeTop / (scale * yScale)))
      : playerScreenY > safeBottom
        ? Math.max(0, Math.min(worldH - viewH, playerY - safeBottom / (scale * yScale)))
        : rawCameraY;
  const colors: Record<string, string> = {
    floor: "#dfe8dc",
    sterile_floor: "#dfe8dc",
    neon_floor: "#2ff7dc",
    warning_floor: "#f7d852",
    fan_floor: "#9fb2aa",
    player_spawn_1: "#39f7c8",
    player_spawn_2: "#ff5de1",
    wall: "#263630",
    door: "#374a42",
    corrupt_med_cabinet: "#ff37c8",
    hacked_vending_unit: "#65716b",
    recall_crate: "#7f6b46",
    shipping_box: "#8b7658",
    service_elevator: "#f7d852",
    prescription: "#39f7c8",
    folder: "#60c5ff",
    data_wafer: "#9c7dff",
    circuit_board: "#39f767",
    pill_sample: "#ffffff",
    lab_coat_armor: "#cfefff",
    hazard_sleeves: "#ffef7a",
    pill_splitter: "#ff9bd9",
    scorch_mark: "#1b211e",
    spilled_syrup: "#70ffe8",
  };
  const firstTileX = Math.max(0, Math.floor(cameraX / frame.tileWidth));
  const firstTileY = Math.max(0, Math.floor(cameraY / frame.tileHeight));
  const lastTileX = Math.min(frame.width - 1, Math.ceil((cameraX + viewW) / frame.tileWidth));
  const lastTileY = Math.min(frame.height - 1, Math.ceil((cameraY + viewH) / frame.tileHeight));
  const exitReady = dogsExitReady(frame);
  const baseFloorAsset = dogsAsset("tiles.floor", "sterile_tile");
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      const tile = frame.tiles[y * frame.width + x] ?? "floor";
      const tileX = Math.floor((x * frame.tileWidth - cameraX) * scale);
      const tileY = Math.floor((y * frame.tileHeight - cameraY) * yScale * scale);
      const tileW = Math.ceil(frame.tileWidth * scale);
      const tileH = Math.ceil(frame.tileHeight * yScale * scale);
      const asset = dogsWallTile(tile) ? dogsWallAsset(frame, x, y, tile) : dogsTileAsset(tile);
      drawDogsImage(baseFloorAsset, tileX, tileY, tileW, tileH, colors.floor, "cover");
      if (tile === "spilled_syrup") {
        drawDogsVentFan(tileX, tileY, tileW, tileH, frame.frame);
      } else {
        drawDogsImage(asset, tileX, tileY, tileW, tileH, colors[tile] ?? "#65716b", dogsTileImageFit(tile));
      }
      if (tile === "service_elevator") {
        drawDogsExitPortal(tileX, tileY, tileW, tileH, exitReady, frame.frame);
      }
    }
  }
  dogsContext.fillStyle = "rgba(0, 0, 0, 0.32)";
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      const tile = frame.tiles[y * frame.width + x] ?? "floor";
      if (!dogsWallTile(tile) || dogsWallTile(dogsTileAt(frame, x, y + 1))) continue;
      const shadowX = Math.floor((x * frame.tileWidth - cameraX + 3) * scale);
      const shadowY = Math.floor(((y + 1) * frame.tileHeight - cameraY - 3) * yScale * scale);
      const shadowW = Math.ceil((frame.tileWidth - 4) * scale);
      const shadowH = Math.max(2, Math.ceil(7 * scale));
      dogsContext.fillRect(shadowX, shadowY, shadowW, shadowH);
    }
  }
  const nextActorPositions = new Map<string, { x: number; y: number }>();
  const nextActorFacings = new Map<string, DogsActorFacing>();
  const localPlayerId = player?.faction === "player" ? player.id : null;
  for (const serverActor of frame.characters) {
    const isLocalPlayer = serverActor.id === localPlayerId && serverActor.faction === "player";
    const targetActor = isLocalPlayer
      ? localPlayerTarget ?? serverActor
      : serverActor;
    const actor = isLocalPlayer && localPlayer
      ? localPlayer
      : smoothDogsActor(targetActor, false);
    if (!actor.alive) continue;
    if (actor.faction === "player" && actor.id !== localPlayerId && dogsPixelVisibility(frame, actor.x, actor.y) < 255) {
      continue;
    }
    if (actor.faction !== "player" && dogsPixelVisibility(frame, actor.x, actor.y) < 255) continue;
    const enemyKey = actor.faction !== "player" ? dogsEnemyKey(actor) : "";
    const spriteUnit = enemyKey === "senior_lma" ? 56 : enemyKey === "mpa_chief" ? 46 : enemyKey === "district_manager" ? 44 : 32;
    const spriteW = Math.max(8, Math.ceil(spriteUnit * scale));
    const spriteH = Math.max(8, Math.ceil(spriteUnit * scale));
    const bodyW = frame.characterWidth * scale;
    const bodyH = frame.characterHeight * yScale * scale;
    const x = Math.floor((actor.x - cameraX) * scale - (spriteW - bodyW) / 2);
    const y = Math.floor((actor.y - cameraY) * yScale * scale - Math.max(0, spriteH - bodyH));
    const actorKey = `${actor.faction}:${actor.id}`;
    const serverPrevious = dogsPreviousActorPositions.get(actorKey);
    const moving = Boolean(serverPrevious && (serverPrevious.x !== targetActor.x || serverPrevious.y !== targetActor.y));
    const fallbackFacing = dogsActorFacings.get(actorKey) ?? dogsActorDirectionFacing(actor);
    const facing = serverPrevious
      ? dogsFacingFromMovement(targetActor.x - serverPrevious.x, targetActor.y - serverPrevious.y, fallbackFacing)
      : fallbackFacing;
    nextActorPositions.set(actorKey, { x: targetActor.x, y: targetActor.y });
    nextActorFacings.set(actorKey, facing);
    const sheetAsset = dogsActorSheetAsset(actor);
    if (sheetAsset) {
      const frameColumn = moving ? Math.floor(frame.frame / 8) % 3 : 1;
      const frameRow = dogsActorFacingRow(facing);
      const sheetFrameSize = dogsAssetMode === "2x" ? 64 : 32;
      const drewFrame = drawDogsImageFrame(
        sheetAsset,
        frameColumn * sheetFrameSize,
        frameRow * sheetFrameSize,
        sheetFrameSize,
        sheetFrameSize,
        x,
        y,
        spriteW,
        spriteH,
        actor.faction === "player" ? "#27f2ff" : "#f04444",
      );
      if (!drewFrame) {
        drawDogsImage(dogsActorAsset(actor), x, y, spriteW, spriteH, actor.faction === "player" ? "#27f2ff" : "#f04444");
      }
    } else {
      drawDogsImage(dogsActorAsset(actor), x, y, spriteW, spriteH, "#f04444");
    }
  }
  dogsPreviousActorPositions = nextActorPositions;
  dogsActorFacings = nextActorFacings;
  for (const actorKey of Array.from(dogsRenderActorPositions.keys())) {
    if (!nextActorPositions.has(actorKey)) {
      dogsRenderActorPositions.delete(actorKey);
    }
  }
  updateDogsImpactEffects(frame);
  drawDogsImpactEffects(frame, cameraX, cameraY, scale, yScale);
  for (const bullet of frame.bullets) {
    if (bullet.ownerFaction !== "player" && dogsPixelVisibility(frame, bullet.x, bullet.y) < 255) continue;
    drawDogsProjectile(bullet, cameraX, cameraY, scale, yScale, frame.frame);
  }
  drawDogsVisibilityFog(frame, cameraX, cameraY, scale, yScale, firstTileX, firstTileY, lastTileX, lastTileY);
  drawDogsInspectionDialogues(frame, cameraX, cameraY, scale, yScale);
  if (dogsMapOpen) {
    drawDogsMapOverlay(frame, cameraX, cameraY, viewW, viewH);
  }
  drawDogsInspectionOverlay(frame, viewW, viewH);
  const hud = document.querySelector<HTMLDivElement>("#eutherdogs-hud");
  if (hud) {
    const hero = dogsLocalPlayer(frame);
    const ammo = hero?.ammo ?? -1;
    const bossActive = Boolean(frame.summary.bossActive);
    const bossArmor = Math.max(0, frame.summary.bossArmor ?? 0);
    const bossMaxArmor = Math.max(1, frame.summary.bossMaxArmor ?? 1);
    const bossPercent = Math.round(Math.min(100, (bossArmor / bossMaxArmor) * 100));
    const bossName = escapeHtml(frame.summary.bossName ?? "NGR3");
    const status = escapeHtml(frame.summary.status.toUpperCase());
    const routineTotal = frame.summary.routineTotal ?? 0;
    const routineText = routineTotal > 0
      ? ` | RUTINE ${frame.summary.routineRead ?? 0}/${routineTotal} READ`
      : "";
    const inspectionText = (frame.summary.inspectionAnswers ?? 0) > 0 || (frame.summary.inspectionProtocol ?? 0) > 0
      ? ` | INSPECT ${frame.summary.inspectionAnswers ?? 0}/10 | PROTOCOL ${frame.summary.inspectionProtocol ?? 0}`
      : "";
    hud.innerHTML = `
      <span class="eutherdogs-hud-main">COAT ${hero?.armor ?? 0} | CASH $${frame.summary.cash} | SCORE ${frame.summary.score} | RX ${frame.summary.objectsLeft} | QUEUE <strong class="eutherdogs-queue${bossActive ? " is-boss" : ""}">${dogsQueueLeft(frame)}</strong>${routineText}${inspectionText} | AMMO ${ammo < 0 ? "INF" : ammo} | ${status}</span>
      ${bossActive ? `<span class="eutherdogs-boss"><strong>BOSS:${bossName}</strong><span class="eutherdogs-boss-bar"><span style="width: ${bossPercent}%"></span></span></span>` : ""}
    `;
  }
  updateDogsConsole(frame);
}

function readStoredPlayerPort(): PlayerPort {
  return localStorage.getItem(playerPortStorageKey) === "2" ? 2 : 1;
}

function readStoredDogsCharacters(): Record<PlayerPort, DogsCharacterKey> {
  try {
    const parsed = JSON.parse(localStorage.getItem(dogsCharactersStorageKey) ?? "{}") as Partial<Record<PlayerPort, string>>;
    return {
      1: parsed[1] === "neon_pharmacist" ? "neon_pharmacist" : "night_shift_tech",
      2: parsed[2] === "night_shift_tech" ? "night_shift_tech" : "neon_pharmacist",
    };
  } catch {
    return { 1: "night_shift_tech", 2: "neon_pharmacist" };
  }
}

function writeStoredDogsCharacters(): void {
  localStorage.setItem(dogsCharactersStorageKey, JSON.stringify(selectedDogsCharacters));
}

function setPlayerPort(port: PlayerPort): void {
  if (playerPort === port) {
    return;
  }
  playerPort = port;
  localStorage.setItem(playerPortStorageKey, String(port));
  lastInputJson = "";
  lastDogsInputJson = "";
  dogsInputSeq = 0;
  dogsLastAckedInputSeq = 0;
  if (dogsMode && ui.runtime === "bridge") {
    stopDogsSnapshotStream();
    if (ui.playing) {
      startDogsSnapshotStream();
    }
  }
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
    button.disabled = claimedLobbyPlayer !== null && !selected;
    button.title =
      claimedLobbyPlayer === null ? "" : `Locked to claimed P${claimedLobbyPlayer}`;
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
  if (dogsMode) {
    void syncDogsBridgeInput({ ...inputState, player: playerPort }).catch((err) => {
      dogsSnapshotMisses += 1;
      ui.transportMode = "DOGS INPUT HOLD";
      ui.lastError = err instanceof Error ? err.message : String(err);
    });
    return;
  }
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    try {
      await invoke("set_input", { input: inputState });
    } catch {
      ui.runtime = "web";
      pushTrace("Input bridge fallback");
    }
  } else if (ui.runtime === "bridge" && ui.loaded) {
    if (lobbyRole === "spectator" || !ownsCurrentSlot()) {
      return;
    }
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
    save.disabled = !ui.loaded || !canHostMutate();
    load.disabled = !ui.loaded || !Boolean(slot?.occupied) || !canHostMutate();
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
  perfSummary.textContent = `${ui.frameMs.toFixed(2)} ms | ${ui.audioLeadMs.toFixed(0)} lead`;
  document.querySelector("#runtime-chip")!.textContent =
    ui.runtime === "tauri"
      ? "TAURI 2 CORE"
      : ui.runtime === "bridge"
        ? "CORE BRIDGE"
        : "WEB VIEW";
  playToggle.disabled = !ui.loaded;
  stepFrame.disabled = !ui.loaded;
  resetCore.disabled = !ui.loaded || !canHostMutate();
  mobilePlay.disabled = !ui.loaded;
  mobilePlay.textContent = ui.playing ? "Pause" : "Play";
  screenGlass.classList.toggle("is-native-frame", ui.loaded && ui.runtime !== "web");
  renderPlayerPort();
  renderLobby();
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
  if (autoStartEutherDogs) {
    await enterDogsMode();
  } else {
    await restoreCachedRom();
  }
})();
