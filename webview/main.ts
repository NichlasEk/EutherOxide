import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
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

type FrameResult = {
  frame: number;
  width: number;
  height: number;
  rgba: number[];
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  stopped: boolean;
  lastError?: string | null;
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

type UiState = LoadResult & {
  loaded: boolean;
  playing: boolean;
  runtime: "tauri" | "web" | "bridge";
  frame: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  status: string;
  lastError: string;
  stateSlots: StateSlot[];
  nativeStates: boolean;
};

const isTauri = Boolean(window.__TAURI_INTERNALS__);
const bridgeBase =
  new URLSearchParams(window.location.search).get("bridge") ?? "http://127.0.0.1:32161";
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
  status: "IDLE",
  lastError: "",
  statePath: null,
  stateSlots: emptySlots(),
  nativeStates: false,
};

let romBytes = new Uint8Array();
let romDisplayName = "reaction.argon";
let romHash = 0xC0FFEE;
let webStateSlots: Array<WebStateSnapshot | null> = [null, null, null];
let stepping = false;
let videoCanvas: HTMLCanvasElement;
let videoContext: CanvasRenderingContext2D;
let lastInputJson = JSON.stringify(inputState);

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
        <div class="runtime-chip" id="runtime-chip">WEB VIEW</div>
      </header>

      <div class="screen-vessel">
        <div class="screen-glass">
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

playToggle.addEventListener("click", () => {
  ui.playing = !ui.playing;
  playToggle.textContent = ui.playing ? "Pause" : "Play";
  ui.status = ui.playing ? "RUNNING" : "PAUSED";
  renderUi();
  if (ui.playing) {
    void animationLoop();
  }
});

stepFrame.addEventListener("click", async () => {
  await advanceFrame();
});

resetCore.addEventListener("click", async () => {
  let drewCoreFrame = false;
  if (isTauri && ui.runtime === "tauri" && ui.loaded) {
    await invoke("reset_emulator");
  } else if (ui.runtime === "bridge" && ui.loaded) {
    const result = await bridgeJson<BridgeStatusResult>("/reset", {
      method: "POST",
    });
    Object.assign(ui, result);
    const frame = await bridgeJson<FrameResult>("/frame", { method: "POST" });
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
  const buffer = await file.arrayBuffer();
  romBytes = new Uint8Array(buffer);
  romDisplayName = file.name;
  romHash = hashBytes(romBytes);
  const webInfo = parseWebHeader(romBytes, file.name);

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
    if (await loadFileThroughBridge(file, buffer)) {
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
  }

  document.querySelector("#rom-name")!.textContent = file.name;
  drawSyntheticFrame();
  renderUi();
}

async function loadFileThroughBridge(file: File, buffer: ArrayBuffer): Promise<boolean> {
  try {
    const result = await bridgeJson<BridgeStatusResult>(
      "/load",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Rom-Name": encodeURIComponent(file.name),
        },
        body: new Blob([buffer]),
      },
      5000,
    );
    Object.assign(ui, result);
    ui.runtime = "bridge";
    ui.loaded = result.loaded ?? true;
    ui.nativeStates = Boolean(result.statePath);
    ui.status = "BRIDGE LOADED";
    ui.lastError = "";
    document.querySelector("#rom-name")!.textContent = file.name;
    await refreshStateSlots();
    const frame = await bridgeJson<FrameResult>("/frame", { method: "POST" }, 5000);
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
    return false;
  }
}

async function connectBridge(): Promise<void> {
  if (isTauri) {
    return;
  }
  try {
    const result = await bridgeJson<BridgeStatusResult>("/status", {}, 700);
    Object.assign(ui, result);
    ui.runtime = "bridge";
    ui.loaded = result.loaded ?? true;
    ui.nativeStates = ui.loaded && Boolean(result.statePath);
    ui.frame = result.frame;
    ui.status = ui.loaded ? "BRIDGE READY" : "BRIDGE IDLE";
    ui.lastError = "";
    document.querySelector("#rom-name")!.textContent = ui.loaded
      ? result.title
      : "Load Mega Drive";
    if (!ui.loaded) {
      ui.stateSlots = emptySlots();
      pushTrace("Rust core bridge waiting");
      renderUi();
      return;
    }
    await refreshStateSlots();
    const frame = await bridgeJson<FrameResult>("/frame", { method: "POST" });
    drawNativeFrame(frame);
    ui.frame = frame.frame;
    ui.cpuCycles = frame.cpuCycles;
    ui.cpuSteps = frame.cpuSteps;
    ui.frameMs = frame.frameMs;
    ui.lastError = frame.lastError ?? "";
    pushTrace("Headless core bridge online");
    renderUi();
  } catch {
    renderUi();
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
  await advanceFrame();
  window.requestAnimationFrame(() => void animationLoop());
}

async function advanceFrame(): Promise<void> {
  if (stepping) {
    return;
  }
  stepping = true;
  try {
    if ((isTauri && ui.runtime === "tauri" && ui.loaded) || ui.runtime === "bridge") {
      const frame =
        ui.runtime === "bridge"
          ? await bridgeJson<FrameResult>("/frame", { method: "POST" })
          : await invoke<FrameResult>("run_frame");
      drawNativeFrame(frame);
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
      ui.status = ui.playing ? "WEB RUN" : "WEB STEP";
      drawSyntheticFrame();
    }
  } finally {
    renderUi();
    stepping = false;
  }
}

function drawNativeFrame(frame: FrameResult): void {
  if (videoCanvas.width !== frame.width || videoCanvas.height !== frame.height) {
    videoCanvas.width = frame.width;
    videoCanvas.height = frame.height;
  }
  const image = new ImageData(
    new Uint8ClampedArray(frame.rgba),
    frame.width,
    frame.height,
  );
  videoContext.putImageData(image, 0, 0);
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
  document.querySelector("#runtime-chip")!.textContent =
    ui.runtime === "tauri"
      ? "TAURI 2 CORE"
      : ui.runtime === "bridge"
        ? "CORE BRIDGE"
        : "WEB VIEW";
  playToggle.disabled = !ui.loaded;
  stepFrame.disabled = !ui.loaded;
  resetCore.disabled = !ui.loaded;
  renderStateSlots();
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
void connectBridge();
