import { invoke } from "@tauri-apps/api/core";
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

type UiState = LoadResult & {
  loaded: boolean;
  playing: boolean;
  runtime: "tauri" | "web";
  frame: number;
  cpuCycles: number;
  cpuSteps: number;
  frameMs: number;
  status: string;
  lastError: string;
};

const isTauri = Boolean(window.__TAURI_INTERNALS__);
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
};

let romBytes = new Uint8Array();
let romHash = 0xC0FFEE;
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

      <div class="rail-section">
        <p class="section-label">Transport</p>
        <button id="play-toggle" class="primary-action" type="button">Play</button>
        <button id="step-frame" type="button">Step Frame</button>
        <button id="reset-core" type="button">Reset</button>
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
    await loadFile(file);
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
  if (isTauri && ui.loaded) {
    await invoke("reset_emulator");
  }
  ui.frame = 0;
  ui.cpuCycles = 0;
  ui.cpuSteps = 0;
  ui.status = ui.loaded ? "RESET" : "IDLE";
  drawSyntheticFrame();
  pushTrace("Reset vector reloaded");
  renderUi();
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

async function loadFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer();
  romBytes = new Uint8Array(buffer);
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
      ui.status = "LOADED";
      ui.lastError = "";
      pushTrace("Native core bonded");
    } catch (error) {
      Object.assign(ui, webInfo);
      ui.runtime = "web";
      ui.loaded = true;
      ui.status = "WEB FALLBACK";
      ui.lastError = String(error);
      pushTrace("Web bridge took over");
    }
  } else {
    Object.assign(ui, webInfo);
    ui.runtime = "web";
    ui.loaded = true;
    ui.status = "WEB PREVIEW";
    ui.lastError = "";
    pushTrace("Browser substrate loaded");
  }

  document.querySelector("#rom-name")!.textContent = file.name;
  drawSyntheticFrame();
  renderUi();
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
    if (isTauri && ui.runtime === "tauri" && ui.loaded) {
      const frame = await invoke<FrameResult>("run_frame");
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
  }
}

function updatePadButtons(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((button) => {
    const name = button.dataset.pad as keyof InputState;
    button.classList.toggle("is-active", inputState[name]);
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
    ui.runtime === "tauri" ? "TAURI 2 CORE" : "WEB VIEW";
  playToggle.disabled = !ui.loaded;
  stepFrame.disabled = !ui.loaded;
  resetCore.disabled = !ui.loaded;
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

function hashBytes(bytes: Uint8Array): number {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(bytes.length / 4096));
  for (let index = 0; index < bytes.length; index += stride) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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

