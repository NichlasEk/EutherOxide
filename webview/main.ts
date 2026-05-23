import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { WEB_BUILD_ID } from "./build-info";
import "./styles.css";

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
  rgba: number[] | Uint8Array<ArrayBuffer>;
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
};

type FrameAudioResult = {
  frame: FrameResult;
  audio: AudioResult;
  transport: string;
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

const isTauri = Boolean(window.__TAURI_INTERNALS__);
document.documentElement.classList.toggle("is-tauri-shell", isTauri);
const bridgeBase =
  new URLSearchParams(window.location.search).get("bridge") ?? "http://127.0.0.1:32161";
const romCacheDb = "eutheroxide-rom-cache";
const romCacheStore = "roms";
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
let webStateSlots: Array<WebStateSnapshot | null> = [null, null, null];
let stepping = false;
let nativeStatusPolling = false;
let videoCanvas: HTMLCanvasElement;
let videoContext: CanvasRenderingContext2D;
let lastInputJson = JSON.stringify(inputState);
let lastBrowserFile: File | null = null;
let bridgeRetryTimer: number | null = null;
let buildPollTimer: number | null = null;
let bridgeStreamAbort: AbortController | null = null;
let bridgeStreamActive = false;
let nativeBridgeBase: string | null = null;
let desiredBuildProfile: "debug" | "release" = "debug";
let audioContext: AudioContext | null = null;
let audioCursor = 0;
let nextFrameDue = performance.now();
let nativeSurfaceRectTimer: number | null = null;

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

      <div class="rail-section">
        <p class="section-label">Pad</p>
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
          <div class="runtime-chip" id="runtime-chip">WEB VIEW</div>
        </div>
      </header>

      <div class="screen-vessel">
        <div class="screen-glass" id="screen-glass">
          <canvas id="video" width="320" height="224"></canvas>
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
`;

videoCanvas = document.querySelector<HTMLCanvasElement>("#video")!;
videoContext = videoCanvas.getContext("2d", { alpha: false })!;

const romInput = document.querySelector<HTMLInputElement>("#rom-input")!;
const romDrop = document.querySelector<HTMLLabelElement>("#rom-drop")!;
const playToggle = document.querySelector<HTMLButtonElement>("#play-toggle")!;
const stepFrame = document.querySelector<HTMLButtonElement>("#step-frame")!;
const resetCore = document.querySelector<HTMLButtonElement>("#reset-core")!;
const stateGrid = document.querySelector<HTMLDivElement>("#state-grid")!;
const screenGlass = document.querySelector<HTMLDivElement>("#screen-glass")!;
const releaseBuild = document.querySelector<HTMLButtonElement>("#release-build")!;
const buildLamp = document.querySelector<HTMLSpanElement>("#build-lamp")!;
const buildProfileButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-build-profile]"),
);

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
  await advanceFrame();
});

resetCore.addEventListener("click", async () => {
  let drewCoreFrame = false;
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    ui.playing = false;
    playToggle.textContent = "Play";
    await invoke("set_native_running", { running: false });
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
    inputState[name] = pressed;
    button.classList.toggle("is-active", pressed);
    void syncInput();
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

const keyMap: Record<string, keyof InputState> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  z: "a",
  x: "b",
  c: "c",
  Enter: "start",
};

window.addEventListener("keydown", (event) => {
  const key = keyMap[event.key];
  if (!key || inputState[key]) {
    return;
  }
  event.preventDefault();
  inputState[key] = true;
  updatePadButtons();
  void syncInput();
});

window.addEventListener("keyup", (event) => {
  const key = keyMap[event.key];
  if (!key) {
    return;
  }
  event.preventDefault();
  inputState[key] = false;
  updatePadButtons();
  void syncInput();
});

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
  try {
    const status = await bridgeJson<BridgeBuildStatus>(
      `/build/profile?profile=${profile}`,
      { method: "POST" },
      1000,
    );
    applyBuildStatus(status);
    pushTrace(profile === "release" ? "Release bin arming" : "Debug bridge arming");
    renderUi();
    await reconnectAfterBridgeRestart();
  } catch (error) {
    ui.lastError = String(error);
    pushTrace("Bridge profile switch failed");
    renderUi();
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

async function reconnectAfterBridgeRestart(): Promise<void> {
  ui.status = "REARMING";
  renderUi();
  await sleep(700);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (romBytes.length > 0) {
      if (await loadBytesThroughBridge(romDisplayName, romBytes)) {
        await refreshBuildStatus(true);
        return;
      }
    } else if (await connectBridge(false)) {
      await refreshBuildStatus(true);
      return;
    }
    await sleep(350);
  }
  scheduleBridgeRetry();
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

async function bridgeStreamRequest(signal: AbortSignal): Promise<Response> {
  const response = await fetch(`${bridgeBase}/stream-frame-audio.bin`, {
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

function decodeBridgeFrameAudio(buffer: ArrayBuffer): FrameAudioResult {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 48 ||
    bytes[0] !== 0x45 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x58 ||
    bytes[3] !== 0x42
  ) {
    throw new Error("Bad EutherOxide frame/audio packet");
  }
  const view = new DataView(buffer);
  const frame = view.getUint32(4, true);
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const cpuCycles = view.getUint32(16, true);
  const cpuSteps = view.getUint32(20, true);
  const frameMs = view.getUint32(24, true) / 1000;
  const stopped = view.getUint32(28, true) !== 0;
  const sampleRate = view.getUint32(32, true);
  const sampleCount = view.getUint32(36, true);
  const rgbaLength = view.getUint32(40, true);
  const pcmLength = view.getUint32(44, true);
  const rgbaOffset = 48;
  const pcmOffset = rgbaOffset + rgbaLength;
  if (
    rgbaLength !== width * height * 4 ||
    pcmLength !== sampleCount * 2 ||
    bytes.byteLength !== pcmOffset + pcmLength
  ) {
    throw new Error("EutherOxide frame/audio packet size mismatch");
  }
  return {
    frame: {
      frame,
      width,
      height,
      rgba: bytes.subarray(rgbaOffset, pcmOffset),
      cpuCycles,
      cpuSteps,
      frameMs,
      stopped,
      lastError: null,
    },
    audio: {
      frame,
      sampleRate,
      samples: new Int16Array(buffer, pcmOffset, sampleCount) as Int16Array<ArrayBuffer>,
    },
    transport: "BRIDGE PACKET",
  };
}

function decodeBridgeAudio(buffer: ArrayBuffer): AudioResult {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 16 ||
    bytes[0] !== 0x45 ||
    bytes[1] !== 0x4f ||
    bytes[2] !== 0x58 ||
    bytes[3] !== 0x41
  ) {
    throw new Error("Bad EutherOxide audio packet");
  }
  const view = new DataView(buffer);
  const frame = view.getUint32(4, true);
  const sampleRate = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  if (bytes.byteLength !== 16 + count * 2) {
    throw new Error("EutherOxide audio packet size mismatch");
  }
  const samples = new Int16Array(buffer, 16, count) as Int16Array<ArrayBuffer>;
  return { frame, sampleRate, samples };
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
    const response = await fetch(`${bridgeBase}${path}`, {
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
  bridgeStreamAbort?.abort();
  bridgeStreamAbort = null;
  bridgeStreamActive = false;
}

async function bridgeStreamLoop(): Promise<void> {
  if (bridgeStreamActive) {
    return;
  }
  bridgeStreamActive = true;
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
    while (ui.playing && ui.runtime === "bridge") {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      if (!read.value) {
        continue;
      }
      pending = appendBytes(pending, read.value);
      while (pending.byteLength >= 4) {
        const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
        const packetLength = view.getUint32(0, true);
        if (pending.byteLength < 4 + packetLength) {
          break;
        }
        const packet = pending.slice(4, 4 + packetLength);
        pending = pending.slice(4 + packetLength);
        const before = performance.now();
        const frameAudio = decodeBridgeFrameAudio(packet.buffer);
        const decoded = performance.now();
        drawNativeFrame(frameAudio.frame);
        const drawn = performance.now();
        ui.audioLeadMs = await scheduleAudio(frameAudio.audio);
        ui.transportMode = "BRIDGE STREAM";
        ui.transportMs = received === 0 ? decoded - started : decoded - before;
        ui.drawMs = drawn - decoded;
        applyBridgeFrame(frameAudio.frame);
        renderUi();
        received += 1;
        if (frameAudio.frame.stopped) {
          ui.playing = false;
          playToggle.textContent = "Play";
          pushTrace("CPU reached unsupported reaction");
          stopBridgeStream();
          return;
        }
      }
    }
  } catch (error) {
    if (ui.playing && ui.runtime === "bridge") {
      ui.lastError = String(error);
      pushTrace("Bridge stream fell back");
      nextFrameDue = performance.now();
      void animationLoop();
    }
  } finally {
    bridgeStreamActive = false;
    bridgeStreamAbort = null;
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
    if (isTauri && ui.runtime === "tauri" && ui.loaded) {
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

async function ensureAudio(): Promise<AudioContext | null> {
  const AudioCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioCtor();
    audioCursor = audioContext.currentTime;
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  return audioContext;
}

async function scheduleAudio(audio: AudioResult): Promise<number> {
  const samples =
    audio.samples instanceof Int16Array
      ? audio.samples
      : Int16Array.from(audio.samples);
  if (samples.length === 0) {
    return 0;
  }
  if (isTauri && ui.runtime === "tauri") {
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
  const buffer = context.createBuffer(1, samples.length, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    channel[index] = samples[index] / 32768;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const now = context.currentTime;
  if (audioCursor < now + 0.02 || audioCursor > now + 0.18) {
    audioCursor = now + 0.035;
  }
  source.start(audioCursor);
  const leadMs = Math.max(0, (audioCursor - now) * 1000);
  audioCursor += buffer.duration;
  return leadMs;
}

function drawNativeFrame(frame: FrameResult): void {
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
}

function framePixels(rgba: number[] | Uint8Array<ArrayBufferLike>): Uint8ClampedArray<ArrayBuffer> {
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
  if (isTauri && ui.runtime === "tauri" && ui.nativeStates) {
    try {
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
      renderUi();
      return;
    } catch (error) {
      ui.lastError = String(error);
      pushTrace("Native argon load rejected");
    }
  } else if (ui.runtime === "bridge" && ui.nativeStates) {
    try {
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
      renderUi();
      return;
    } catch (error) {
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
        body: JSON.stringify(inputState),
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
  screenGlass.classList.toggle("is-native-frame", ui.loaded && ui.runtime !== "web");
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
  const atoms = Array.from({ length: 42 }, (_, index) => ({
    x: Math.random(),
    y: Math.random(),
    r: 2 + (index % 5),
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
    context.clearRect(0, 0, width, height);
    context.lineWidth = 1;

    for (let i = 0; i < atoms.length; i += 1) {
      const atom = atoms[i];
      const x = atom.x * width + Math.sin(time * 0.00018 + atom.phase) * 24;
      const y = atom.y * height + Math.cos(time * 0.00021 + atom.phase) * 18;
      for (let j = i + 1; j < atoms.length; j += 1) {
        const other = atoms[j];
        const ox = other.x * width + Math.sin(time * 0.00018 + other.phase) * 24;
        const oy = other.y * height + Math.cos(time * 0.00021 + other.phase) * 18;
        const dx = x - ox;
        const dy = y - oy;
        const distance = Math.hypot(dx, dy);
        if (distance < 150) {
          context.strokeStyle = `rgba(168, 229, 139, ${0.09 * (1 - distance / 150)})`;
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

    window.requestAnimationFrame(draw);
  };

  window.requestAnimationFrame(draw);
}

drawSyntheticFrame();
renderUi();
startMoleculeField();
void (async () => {
  await connectBridge();
  await restoreCachedRom();
})();
