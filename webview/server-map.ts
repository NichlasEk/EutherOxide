import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

type MapNode = {
  id: string;
  label: string;
  type: string;
  status?: string;
  detail?: string;
};

type MapEdge = {
  from: string;
  to: string;
  label?: string;
  type?: string;
};

type ServiceReport = {
  name: string;
  status: string;
  units: string[];
  ports: string[];
  repo_path: string;
  persistent_paths: string[];
};

type ListeningService = {
  protocol: string;
  port: string;
  status: string;
  local?: string;
  process?: string;
};

type ServerMap = {
  collected_at: string;
  nodes: MapNode[];
  edges: MapEdge[];
  services: ServiceReport[];
  listening_services: ListeningService[];
  ssh_connections: Array<Record<string, string>>;
  ports: string[];
  map_md?: string;
};

type EutherNetCommand = {
  name: string;
  enabled: boolean;
  mode: string;
  required_action?: string;
  target?: string;
};

type EutherIdAuditEntry = {
  challengeId: string;
  actor: string;
  action: string;
  target: string;
  commandId: string;
  status: string;
  deviceId?: string | null;
  detail: string;
  createdAt: number;
  expiresAt: number;
};

type AuthStatus = {
  authenticated: boolean;
  isAdmin?: boolean;
  csrfToken?: string | null;
  permissions?: {
    canServerMap?: boolean;
  };
};

type SceneNode = MapNode & {
  object: THREE.Object3D;
  position: THREE.Vector3;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

type ViewMode = "walk" | "map";
type RoomMode = "city" | "eutherbooks" | "node";

type EutherBook = {
  id: string;
  title: string;
  author?: string;
  format?: string;
};

type EutherBooksJob = {
  id: string;
  book_id: string;
  status: string;
  owner?: string;
  audio_files?: string[];
  total_audio_files?: number;
  progress_label?: string;
  progress_detail?: string;
  error?: string | null;
};

type EutherBooksHealth = {
  status?: string;
  tts_backend?: string;
  storage?: {
    audio_free_bytes?: number;
    audio_total_bytes?: number;
    audio_used_bytes?: number;
  };
};

type GpuSchedulerJob = {
  id: string;
  owner: string;
  owner_id: string;
  label: string;
  kind: string;
  priority: number;
  status: string;
  progress: number;
  message?: string;
  updated_at?: number;
  expires_at?: number | null;
};

type GpuLeaseState = {
  active?: Record<string, unknown> | null;
  queue?: Array<Record<string, unknown>>;
  queue_length?: number;
};

type EutherLinkResources = {
  gpu_lease?: GpuLeaseState;
  tts?: {
    dots_tts?: {
      status?: string;
      model_loaded?: boolean;
      loaded_model?: string | null;
    };
    queued_or_running?: number;
    voxcpm_loaded?: boolean;
  };
  gpu?: {
    memory_used_mib?: number;
    memory_total_mib?: number;
    utilization_gpu_percent?: number;
    temperature_c?: number;
  };
};

type GpuSchedulerOverview = {
  resources: EutherLinkResources | null;
  jobs: GpuSchedulerJob[];
  error?: string;
};

const statusColors: Record<string, number> = {
  running: 0x39d77b,
  online: 0x39d7d2,
  listening: 0x39d7d2,
  failed: 0xff315a,
  unknown: 0x738096,
  present: 0x8aa8ff,
  configured: 0xb878ff,
  planned: 0xf0b85a,
  observed: 0x36a3ff,
};

const typeHeights: Record<string, number> = {
  external: 2.8,
  proxy: 4.2,
  host: 5.8,
  service: 4.6,
  port: 1.8,
  repo: 2.4,
  ssh: 2.2,
  ai: 5.2,
  storage: 3.8,
};

const alertRed = 0xff315a;
const alertDark = 0x4b0710;

let csrfToken = "";
let serverMap: ServerMap | null = null;
let eutherNetCommands: EutherNetCommand[] = [];
let gpuScheduler: GpuSchedulerOverview | null = null;
let selectedNode: SceneNode | null = null;
let focusedNode: SceneNode | null = null;
let viewMode: ViewMode = "walk";
let roomMode: RoomMode = "city";
let navigationEnabled = false;
let lastCityPosition = new THREE.Vector3(7, 3.2, 58);
let currentRoomNode: SceneNode | null = null;

const sceneNodes = new Map<string, SceneNode>();
const clock = new THREE.Clock();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const keys = new Set<string>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);
let mobileMapTouch:
  | {
      startedAt: number;
      startX: number;
      startY: number;
      startCamera: THREE.Vector3;
      startDistance?: number;
    }
  | null = null;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: PointerLockControls;
let cityRoot: THREE.Group;
let beamRoot: THREE.Group;
let detailPanel: HTMLElement;
let statusLine: HTMLElement;
let hintLine: HTMLElement;
let crosshair: HTMLElement;
let modeButton: HTMLButtonElement;
let enterNodeButton: HTMLButtonElement;
let leaveRoomButton: HTMLButtonElement;
let restartButton: HTMLButtonElement;
let custodianOverlay: HTMLElement;
let custodianTitle: HTMLElement;
let custodianContext: HTMLElement;
let custodianForm: HTMLFormElement;
let custodianQuestion: HTMLInputElement;
let custodianAnswer: HTMLElement;
let custodianLeaveButton: HTMLButtonElement;

bootstrap().catch((error) => {
  document.body.innerHTML = `<main class="eutherverse-fail"><h1>EutherVerse kunde inte starta</h1><pre>${escapeHtml(error.stack || error.message)}</pre></main>`;
});

async function bootstrap(): Promise<void> {
  installShell();
  await loadAuth();
  initScene();
  bindInput();
  await loadMap(false);
  animate();
}

function installShell(): void {
  document.title = "EutherVerse Admin Mode";
  document.body.innerHTML = `
    <div id="eutherverse">
      <canvas id="eutherverse-canvas" aria-label="EutherVerse 3D server map"></canvas>
      <div id="crosshair" aria-hidden="true"></div>
      <header class="ev-topbar">
        <div>
          <p>EutherNet</p>
          <h1>EutherVerse Admin Mode</h1>
        </div>
        <nav>
          <button id="ev-enter" type="button">Enter</button>
          <button id="ev-map-mode" type="button">Map</button>
          <button id="ev-refresh" type="button">Refresh</button>
          <a href="/">EutherOxide</a>
        </nav>
      </header>
      <aside id="ev-panel">
        <section>
          <p class="eyebrow">Target</p>
          <h2 id="ev-target">No node selected</h2>
          <div id="ev-detail">Aim at a node and press E.</div>
        </section>
        <section>
          <p class="eyebrow">Controls</p>
          <div id="ev-objective" class="ev-objective">Click Enter, walk with WASD, aim at a node and press E to inspect it.</div>
          <dl id="ev-controls-list">
            <div><dt>WASD</dt><dd>Move</dd></div>
            <div><dt>Mouse</dt><dd>Look</dd></div>
            <div><dt>E</dt><dd>Inspect</dd></div>
            <div><dt>M</dt><dd>Map mode</dd></div>
            <div><dt>R</dt><dd>Refresh inventory</dd></div>
            <div><dt>Esc</dt><dd>Release cursor</dd></div>
          </dl>
        </section>
        <section>
          <p class="eyebrow">Actions</p>
          <button id="ev-action-health" type="button">Health Check</button>
          <button id="ev-action-enter-node" type="button" disabled>Enter Node</button>
          <button id="ev-action-leave-room" type="button" disabled hidden>Back to Map</button>
          <a id="ev-action-open-eutherbooks" href="/eutherbooks" target="_blank" rel="noreferrer">Open EutherBooks</a>
          <button id="ev-action-restart" type="button" disabled>Restart Service</button>
          <small>Restart creates a device-bound EutherID request. Only explicitly enabled, allowlisted service handles can run after fingerprint approval.</small>
        </section>
        <section>
          <p class="eyebrow">EutherID Audit</p>
          <div id="ev-eutherid-audit" class="ev-audit"><small>No restart requests yet.</small></div>
        </section>
      </aside>
      <div id="ev-custodian-overlay" hidden>
        <div class="ev-dialog">
          <div class="ev-dialog-head">
            <div>
              <p class="eyebrow">Custodian Link</p>
              <h2 id="ev-custodian-title">Room Custodian</h2>
            </div>
            <button id="ev-custodian-leave" type="button">Leave</button>
          </div>
          <div id="ev-custodian-context" class="ev-dialog-context"></div>
          <div id="ev-custodian-answer" class="ev-dialog-answer" tabindex="0"></div>
          <form id="ev-custodian-form" class="ev-dialog-form">
            <input id="ev-custodian-question" type="text" maxlength="420" placeholder="Ask about status, alerts, ports, units or actions" autocomplete="off" />
            <button type="submit">Ask</button>
          </form>
        </div>
      </div>
      <footer class="ev-hud">
        <span id="ev-status">Booting scene...</span>
        <span id="ev-hint">Click Enter to take controls.</span>
      </footer>
    </div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    :root { color-scheme: dark; }
    body { margin: 0; overflow: hidden; background: #05070a; color: #f4fbff; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    button, a { font: inherit; }
    [hidden] { display: none !important; }
    #eutherverse { position: fixed; inset: 0; background: #05070a; }
    #eutherverse-canvas { width: 100%; height: 100%; display: block; touch-action: none; }
    .ev-topbar { position: fixed; top: 0; left: 0; right: 0; z-index: 2; display: flex; justify-content: space-between; gap: 16px; padding: 14px 16px; background: linear-gradient(180deg, rgba(4,8,13,.86), rgba(4,8,13,0)); pointer-events: none; }
    .ev-topbar p, .eyebrow { margin: 0; color: #77d7d3; text-transform: uppercase; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
    .ev-topbar h1 { margin: 2px 0 0; font-size: 20px; letter-spacing: 0; }
    .ev-topbar nav { display: flex; gap: 8px; pointer-events: auto; }
    .ev-topbar button, .ev-topbar a, #ev-panel button, #ev-panel a { border: 1px solid rgba(103,225,218,.38); border-radius: 6px; background: rgba(10,22,30,.82); color: #effcff; padding: 8px 11px; text-decoration: none; cursor: pointer; }
    .ev-topbar button:hover, .ev-topbar a:hover, #ev-panel button:hover:not(:disabled) { background: rgba(40,128,133,.72); }
    #ev-panel { position: fixed; top: 78px; right: 14px; bottom: 54px; z-index: 2; width: min(360px, calc(100vw - 28px)); overflow: auto; border: 1px solid rgba(103,225,218,.28); border-radius: 8px; background: rgba(5,10,16,.78); backdrop-filter: blur(16px); padding: 13px; box-shadow: 0 18px 80px rgba(0,0,0,.45); }
    #ev-panel h2 { margin: 4px 0 10px; font-size: 18px; }
    #ev-panel section { border-bottom: 1px solid rgba(110,142,160,.22); padding: 0 0 12px; margin: 0 0 12px; }
    #ev-panel section:last-child { border-bottom: 0; }
    #ev-detail { display: grid; gap: 7px; color: #b7c8d4; font-size: 13px; overflow-wrap: anywhere; }
    #ev-detail strong { color: #fff; }
    .ev-objective { margin-top: 8px; border: 1px solid rgba(244,207,120,.28); border-radius: 6px; background: rgba(244,207,120,.08); color: #f3e4b6; padding: 9px 10px; font-size: 13px; line-height: 1.35; }
    #ev-panel dl { display: grid; gap: 7px; margin: 8px 0 0; }
    #ev-panel dl div { display: grid; grid-template-columns: 64px 1fr; gap: 8px; color: #b7c8d4; font-size: 13px; }
    #ev-panel dt { color: #f4cf78; font-weight: 900; }
    #ev-panel dd { margin: 0; }
    #ev-panel button, #ev-panel a { width: 100%; margin: 6px 0; text-align: left; display: block; box-sizing: border-box; }
    #ev-panel button:disabled { opacity: .45; cursor: not-allowed; }
    #ev-panel small { color: #8fa3b2; line-height: 1.35; display: block; margin-top: 8px; }
    .ev-audit { display: grid; gap: 8px; margin-top: 8px; }
    .ev-audit-entry { border: 1px solid rgba(103,225,218,.2); border-radius: 6px; background: rgba(2,8,13,.58); padding: 8px; font-size: 12px; color: #b7c8d4; overflow-wrap: anywhere; }
    .ev-audit-head { display: flex; justify-content: space-between; gap: 8px; color: #f4fbff; font-weight: 800; }
    .ev-audit-status { color: #f4cf78; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
    .ev-audit-status.completed { color: #52de8b; }
    .ev-audit-status.failed, .ev-audit-status.denied, .ev-audit-status.expired { color: #ff6c84; }
    .ev-audit-meta { margin-top: 4px; color: #8fa3b2; }
    #ev-custodian-overlay { position: fixed; inset: 0; z-index: 5; display: grid; align-items: end; pointer-events: auto; background: linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.52)); padding: 24px; box-sizing: border-box; }
    .ev-dialog { width: min(980px, calc(100vw - 48px)); max-height: min(72vh, 720px); margin: 0 auto; border: 1px solid rgba(103,225,218,.36); border-radius: 8px; background: rgba(4,9,15,.78); backdrop-filter: blur(18px); box-shadow: 0 24px 120px rgba(0,0,0,.62); padding: 16px; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; box-sizing: border-box; }
    .ev-dialog-head { display: flex; align-items: start; justify-content: space-between; gap: 16px; border-bottom: 1px solid rgba(110,142,160,.24); padding-bottom: 12px; }
    .ev-dialog h2 { margin: 3px 0 0; font-size: 22px; }
    .ev-dialog-head button, .ev-dialog-form button { border: 1px solid rgba(103,225,218,.42); border-radius: 6px; background: rgba(10,22,30,.86); color: #effcff; padding: 9px 13px; font: inherit; cursor: pointer; }
    .ev-dialog-context { color: #8fded9; font-size: 13px; line-height: 1.4; margin: 12px 0; overflow-wrap: anywhere; }
    .ev-dialog-answer { min-height: 96px; overflow: auto; overscroll-behavior: contain; scrollbar-color: rgba(103,225,218,.62) rgba(1,5,9,.42); border: 1px solid rgba(103,225,218,.2); border-radius: 6px; background: rgba(1,5,9,.54); color: #d7e6ef; padding: 12px; line-height: 1.45; white-space: pre-wrap; }
    .ev-dialog-form { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-top: 12px; }
    .ev-dialog-form input { min-width: 0; border: 1px solid rgba(103,225,218,.34); border-radius: 6px; background: rgba(3,8,12,.82); color: #effcff; padding: 11px 12px; font: inherit; box-sizing: border-box; }
    .ev-hud { position: fixed; left: 14px; right: 14px; bottom: 12px; z-index: 2; display: flex; justify-content: space-between; gap: 12px; color: #b7c8d4; font-size: 13px; pointer-events: none; }
    #crosshair { position: fixed; z-index: 3; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; pointer-events: none; }
    #crosshair::before, #crosshair::after { content: ""; position: absolute; background: rgba(238,255,255,.76); box-shadow: 0 0 12px rgba(57,215,210,.9); }
    #crosshair::before { left: 8px; top: 0; width: 2px; height: 18px; }
    #crosshair::after { left: 0; top: 8px; width: 18px; height: 2px; }
    .eutherverse-fail { padding: 24px; }
    @media (max-width: 760px) {
      #ev-panel { left: 10px; right: 10px; top: auto; height: 42vh; width: auto; }
      .ev-topbar { align-items: flex-start; flex-wrap: wrap; padding: 14px 10px; }
      .ev-topbar nav { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
      .ev-topbar nav::-webkit-scrollbar { display: none; }
      .ev-topbar button, .ev-topbar a { padding: 7px 10px; white-space: nowrap; }
      .ev-topbar h1 { font-size: 17px; }
      #ev-panel { top: auto; left: 10px; right: 10px; bottom: 10px; width: auto; max-height: 42vh; }
      #ev-custodian-overlay { padding: 10px; align-items: stretch; }
      .ev-dialog { width: auto; min-height: 58vh; max-height: calc(100vh - 20px); padding: 12px; }
      .ev-dialog-form { grid-template-columns: 1fr; }
      .ev-hud { display: none; }
    }
  `;
  document.head.appendChild(style);
  detailPanel = document.querySelector("#ev-detail")!;
  statusLine = document.querySelector("#ev-status")!;
  hintLine = document.querySelector("#ev-hint")!;
  crosshair = document.querySelector("#crosshair")!;
  modeButton = document.querySelector<HTMLButtonElement>("#ev-map-mode")!;
  enterNodeButton = document.querySelector<HTMLButtonElement>("#ev-action-enter-node")!;
  leaveRoomButton = document.querySelector<HTMLButtonElement>("#ev-action-leave-room")!;
  restartButton = document.querySelector<HTMLButtonElement>("#ev-action-restart")!;
  custodianOverlay = document.querySelector<HTMLElement>("#ev-custodian-overlay")!;
  custodianTitle = document.querySelector<HTMLElement>("#ev-custodian-title")!;
  custodianContext = document.querySelector<HTMLElement>("#ev-custodian-context")!;
  custodianForm = document.querySelector<HTMLFormElement>("#ev-custodian-form")!;
  custodianQuestion = document.querySelector<HTMLInputElement>("#ev-custodian-question")!;
  custodianAnswer = document.querySelector<HTMLElement>("#ev-custodian-answer")!;
  custodianLeaveButton = document.querySelector<HTMLButtonElement>("#ev-custodian-leave")!;
}

async function loadAuth(): Promise<void> {
  const auth = await jsonFetch<AuthStatus>("/api/auth/status");
  csrfToken = auth.csrfToken || "";
  if (!auth.authenticated || (!auth.isAdmin && !auth.permissions?.canServerMap)) {
    throw new Error("Server Map permission required.");
  }
}

function initScene(): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#eutherverse-canvas")!;
  canvas.tabIndex = 0;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);
  scene.fog = new THREE.FogExp2(0x05070a, 0.012);

  camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(7, 3.2, 58);
  camera.lookAt(7, 2.2, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.object);
  cityRoot = new THREE.Group();
  beamRoot = new THREE.Group();
  scene.add(cityRoot, beamRoot);

  const ambient = new THREE.HemisphereLight(0x7bc7ff, 0x05070a, 1.2);
  const key = new THREE.DirectionalLight(0xdffcff, 2.6);
  key.position.set(-18, 28, 14);
  const cyan = new THREE.PointLight(0x39d7d2, 48, 80);
  cyan.position.set(0, 9, 0);
  scene.add(ambient, key, cyan);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180, 48, 48),
    new THREE.MeshStandardMaterial({ color: 0x070d12, roughness: 0.9, metalness: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  addGrid();
  window.addEventListener("resize", resize);
}

function addGrid(): void {
  const grid = new THREE.GridHelper(180, 72, 0x276b72, 0x122832);
  grid.position.y = 0.02;
  scene.add(grid);
}

function bindInput(): void {
  document.querySelector("#ev-enter")?.addEventListener("click", () => {
    if (viewMode === "map" && isTouchMapDevice()) {
      void enterFocusedNode().catch(showError);
      return;
    }
    enterWalkMode();
  });
  renderer.domElement.addEventListener("click", () => {
    if (viewMode === "walk" && !isTouchMapDevice()) enterWalkMode();
  });
  renderer.domElement.addEventListener("wheel", handleWheelZoom, { passive: false });
  renderer.domElement.addEventListener("touchstart", handleMapTouchStart, { passive: false });
  renderer.domElement.addEventListener("touchmove", handleMapTouchMove, { passive: false });
  renderer.domElement.addEventListener("touchend", handleMapTouchEnd, { passive: false });
  modeButton.addEventListener("click", toggleMapMode);
  document.querySelector("#ev-refresh")?.addEventListener("click", () => loadMap(true).catch(showError));
  document.querySelector("#ev-action-health")?.addEventListener("click", () => loadMap(true).catch(showError));
  enterNodeButton.addEventListener("click", () => enterFocusedNode().catch(showError));
  leaveRoomButton.addEventListener("click", leaveRoom);
  restartButton.addEventListener("click", () => restartSelectedService().catch(showError));
  custodianForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void askCustodian().catch(showError);
  });
  custodianLeaveButton.addEventListener("click", closeCustodianDialog);
  custodianOverlay.addEventListener("click", (event) => {
    if (event.target === custodianOverlay) closeCustodianDialog();
  });
  custodianQuestion.addEventListener("focus", () => {
    if (controls.isLocked) controls.unlock();
  });
  custodianQuestion.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  custodianAnswer.addEventListener("wheel", (event) => {
    event.stopPropagation();
  }, { passive: true });
  custodianAnswer.addEventListener("touchmove", (event) => {
    event.stopPropagation();
  }, { passive: true });
  custodianAnswer.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  document.addEventListener("keydown", (event) => {
    if (custodianDialogOpen()) {
      if (event.code === "Escape") {
        event.preventDefault();
        closeCustodianDialog();
      }
      return;
    }
    if (isTextInputEvent(event)) return;
    if (event.repeat && event.code !== "KeyE") return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyZ", "ShiftLeft", "ShiftRight", "KeyE", "KeyF", "KeyM", "KeyR", "Escape"].includes(event.code)) {
      event.preventDefault();
    }
    keys.add(event.code);
    if (event.code === "KeyE") inspectFocusedNode();
    if (event.code === "KeyF") void enterFocusedNode().catch(showError);
    if (event.code === "KeyM") toggleMapMode();
    if (event.code === "KeyR") void loadMap(true).catch(showError);
    if (event.code === "Escape" && roomMode !== "city") leaveRoom();
  });
  document.addEventListener("keyup", (event) => keys.delete(event.code));
  controls.addEventListener("lock", () => {
    navigationEnabled = true;
    hintLine.textContent = "Aim at a district and press E.";
  });
  controls.addEventListener("unlock", () => {
    if (viewMode === "walk" && navigationEnabled) {
      hintLine.textContent = "WASD moves. Space/Z changes depth. Click Enter again for mouse look.";
    } else if (viewMode === "walk") {
      hintLine.textContent = "Click Enter to take controls.";
    }
  });
}

function enterWalkMode(): void {
  if (isTouchMapDevice() && viewMode === "map" && roomMode !== "city") {
    enterMobileInspectionMode("room");
    return;
  }
  viewMode = "walk";
  navigationEnabled = true;
  modeButton.textContent = "Map";
  crosshair.style.display = "";
  controls.object.position.y = Math.max(3.2, controls.object.position.y);
  renderer.domElement.focus();
  if (isTouchMapDevice()) {
    controls.unlock();
    hintLine.textContent = "3D preview. Use Map to return to touch navigation, or tap a node in Map and Enter it.";
    return;
  }
  controls.lock();
  hintLine.textContent = "WASD moves. Space/Z changes depth. Mouse look starts when the browser grants pointer lock.";
}

function handleWheelZoom(event: WheelEvent): void {
  event.preventDefault();
  navigationEnabled = true;
  const amount = THREE.MathUtils.clamp(event.deltaY * 0.035, -14, 14);
  if (viewMode === "map") {
    const nextY = THREE.MathUtils.clamp(controls.object.position.y + amount * 1.8, 18, 118);
    controls.object.position.y = nextY;
    lookAtMapCenter();
    hintLine.textContent = "Map mode. Scroll zooms. WASD pans. Press M for 3D.";
    return;
  }
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() === 0) return;
  forward.normalize();
  controls.object.position.addScaledVector(forward, -amount);
  controls.object.position.y = THREE.MathUtils.clamp(controls.object.position.y, 2.2, 118);
  hintLine.textContent = "Scroll zooms. WASD moves. Space/Z changes depth.";
}

function handleMapTouchStart(event: TouchEvent): void {
  if (viewMode !== "map" || custodianDialogOpen()) return;
  event.preventDefault();
  const first = event.touches[0];
  if (!first) return;
  mobileMapTouch = {
    startedAt: performance.now(),
    startX: first.clientX,
    startY: first.clientY,
    startCamera: controls.object.position.clone(),
    startDistance: event.touches.length > 1 ? touchDistance(event.touches[0], event.touches[1]) : undefined,
  };
}

function handleMapTouchMove(event: TouchEvent): void {
  if (viewMode !== "map" || !mobileMapTouch || custodianDialogOpen()) return;
  event.preventDefault();
  if (event.touches.length > 1 && mobileMapTouch.startDistance) {
    const distance = touchDistance(event.touches[0], event.touches[1]);
    const zoom = (mobileMapTouch.startDistance - distance) * 0.16;
    controls.object.position.y = THREE.MathUtils.clamp(mobileMapTouch.startCamera.y + zoom, 18, 122);
  }
  const first = event.touches[0];
  if (!first) return;
  const scale = THREE.MathUtils.clamp(controls.object.position.y / 72, 0.35, 1.7);
  controls.object.position.x = mobileMapTouch.startCamera.x - (first.clientX - mobileMapTouch.startX) * 0.06 * scale;
  controls.object.position.z = mobileMapTouch.startCamera.z - (first.clientY - mobileMapTouch.startY) * 0.06 * scale;
  lookAtMapCenter();
  hintLine.textContent = "Mobile map. Drag pans, pinch zooms, tap a node to inspect.";
}

function handleMapTouchEnd(event: TouchEvent): void {
  if (viewMode !== "map" || !mobileMapTouch || custodianDialogOpen()) return;
  event.preventDefault();
  const changed = event.changedTouches[0];
  const travel = changed ? Math.hypot(changed.clientX - mobileMapTouch.startX, changed.clientY - mobileMapTouch.startY) : 999;
  const elapsed = performance.now() - mobileMapTouch.startedAt;
  const wasTap = travel < 10 && elapsed < 320;
  mobileMapTouch = null;
  if (!wasTap || !changed) return;
  setPointerFromClient(changed.clientX, changed.clientY);
  updateFocus();
  inspectFocusedNode();
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function setPointerFromClient(clientX: number, clientY: number): void {
  pointer.x = (clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(clientY / window.innerHeight) * 2 + 1;
}

function lookAtMapCenter(): void {
  camera.lookAt(controls.object.position.x, 0, controls.object.position.z - 8);
}

function isTouchMapDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
}

function toggleMapMode(): void {
  if (viewMode === "map") {
    enterWalkMode();
    return;
  }
  enterMapMode();
}

function enterMapMode(reason = "manual"): void {
  if (isTouchMapDevice() && roomMode !== "city") {
    enterMobileInspectionMode("room");
    return;
  }
  viewMode = "map";
  navigationEnabled = true;
  keys.clear();
  controls.unlock();
  modeButton.textContent = "3D";
  crosshair.style.display = "none";
  const height = reason === "mobile" ? 92 : 72;
  controls.object.position.set(7, height, 13);
  lookAtMapCenter();
  velocity.set(0, 0, 0);
  hintLine.textContent = isTouchMapDevice()
    ? "Mobile map. Drag pans, pinch zooms, tap a node to inspect."
    : "Map mode. WASD pans the overview. Press M for 3D.";
}

function enterMobileInspectionMode(scope: "city" | "room" = roomMode === "city" ? "city" : "room"): void {
  viewMode = "map";
  navigationEnabled = true;
  keys.clear();
  controls.unlock();
  modeButton.textContent = "3D";
  crosshair.style.display = "none";
  const height = scope === "room" ? (roomMode === "eutherbooks" ? 44 : 36) : 92;
  const z = scope === "room" ? (roomMode === "eutherbooks" ? 7 : 6) : 13;
  controls.object.position.set(0, height, z);
  lookAtMapCenter();
  velocity.set(0, 0, 0);
  updateEnterButton(focusedNode || selectedNode);
  updateControlsGuide(focusedNode || selectedNode);
  hintLine.textContent = scope === "room"
    ? "Mobile room map. Drag pans, pinch zooms, tap nodes, Use activates portals or custodians."
    : "Mobile map. Drag pans, pinch zooms, tap a node to inspect.";
}

async function loadMap(refresh: boolean): Promise<void> {
  roomMode = "city";
  currentRoomNode = null;
  leaveRoomButton.disabled = true;
  setCustodianVisible(false);
  statusLine.textContent = refresh ? "Refreshing EutherNet inventory..." : "Loading EutherNet map...";
  if (refresh) {
    await jsonFetch("/api/admin/euthernet/refresh", { method: "POST", body: "{}" });
  }
  const [map, gpu, commands, audit] = await Promise.all([
    jsonFetch<ServerMap>("/api/admin/euthernet/map"),
    loadGpuSchedulerOverview(),
    jsonFetch<{ commands: EutherNetCommand[] }>("/api/admin/euthernet/commands").catch(() => ({ commands: [] })),
    loadEutherIdAudit(),
  ]);
  serverMap = map;
  gpuScheduler = gpu;
  eutherNetCommands = commands.commands;
  renderEutherIdAudit(audit);
  buildCity(serverMap);
  if (isTouchMapDevice()) enterMobileInspectionMode("city");
  statusLine.textContent = `Snapshot ${serverMap.collected_at} | ${serverMap.nodes.length} nodes | ${serverMap.edges.length} links`;
}

async function loadEutherIdAudit(): Promise<EutherIdAuditEntry[]> {
  const result = await jsonFetch<{ entries: EutherIdAuditEntry[] }>(
    "/api/admin/eutherid/actions/service-restarts/audit",
  ).catch(() => ({ entries: [] }));
  return result.entries;
}

function renderEutherIdAudit(entries: EutherIdAuditEntry[]): void {
  const panel = document.querySelector<HTMLElement>("#ev-eutherid-audit");
  if (!panel) return;
  if (entries.length === 0) {
    panel.innerHTML = "<small>No restart requests yet.</small>";
    return;
  }
  panel.innerHTML = entries.slice(0, 8).map((entry) => {
    const when = new Date(entry.createdAt).toLocaleString("sv-SE");
    const device = entry.deviceId ? abbreviateAuditValue(entry.deviceId) : "awaiting device";
    const statusClass = entry.status.toLowerCase().replace(/[^a-z]/g, "");
    return `<article class="ev-audit-entry">
      <div class="ev-audit-head"><span>${escapeHtml(entry.target)}</span><span class="ev-audit-status ${statusClass}">${escapeHtml(entry.status)}</span></div>
      <div>${escapeHtml(entry.commandId)} · ${escapeHtml(entry.actor)}</div>
      <div class="ev-audit-meta">${escapeHtml(when)} · ${escapeHtml(device)}</div>
    </article>`;
  }).join("");
}

function abbreviateAuditValue(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`;
}

async function loadGpuSchedulerOverview(): Promise<GpuSchedulerOverview> {
  try {
    const [resources, jobs] = await Promise.all([
      jsonFetch<EutherLinkResources>("/api/admin/eutherlink/resources"),
      jsonFetch<GpuSchedulerJob[]>("/api/admin/eutherlink/gpu/jobs").catch(() => []),
    ]);
    return { resources, jobs };
  } catch (error) {
    return {
      resources: null,
      jobs: [],
      error: error instanceof Error ? error.message : "EutherLink unavailable",
    };
  }
}

function buildCity(map: ServerMap): void {
  roomMode = "city";
  leaveRoomButton.disabled = true;
  cityRoot.clear();
  beamRoot.clear();
  sceneNodes.clear();
  selectedNode = null;
  focusedNode = null;
  currentRoomNode = null;
  setCustodianVisible(false);

  const positions = layoutNodes(map.nodes);
  for (const node of map.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const object = createNodeObject(node);
    object.position.copy(position);
    cityRoot.add(object);
    sceneNodes.set(node.id, { ...node, object, position });
  }
  for (const edge of map.edges) {
    const from = sceneNodes.get(edge.from);
    const to = sceneNodes.get(edge.to);
    if (!from || !to) continue;
    beamRoot.add(createBeam(from.position, to.position, edge, nodeIsAlerting(from) || nodeIsAlerting(to)));
  }
  showOverview(map);
}

async function enterFocusedNode(): Promise<void> {
  const target = focusedNode || selectedNode;
  if (target && roomMode !== "city") {
    if (isRoomReturnNode(target)) leaveRoom();
    if (isCustodianNode(target)) focusCustodian();
    return;
  }
  if (!target || !nodeCanEnter(target)) return;
  lastCityPosition.copy(controls.object.position);
  currentRoomNode = target;
  if (isEutherBooksNode(target)) {
    await enterEutherBooksRoom(target);
    return;
  }
  if (isEutherGateNode(target)) {
    window.location.href = "/euthergate/";
    return;
  }
  enterGenericNodeRoom(target);
}

async function enterEutherBooksRoom(sourceNode: SceneNode): Promise<void> {
  roomMode = "eutherbooks";
  currentRoomNode = sourceNode;
  viewMode = "walk";
  navigationEnabled = true;
  modeButton.textContent = "Map";
  leaveRoomButton.disabled = false;
  enterNodeButton.disabled = true;
  setCustodianVisible(false);
  cityRoot.clear();
  beamRoot.clear();
  sceneNodes.clear();
  focusedNode = null;
  selectedNode = null;
  statusLine.textContent = "Entering EutherBooks library...";

  const library = await loadEutherBooksRoomData();
  buildEutherBooksLibrary(library.books, library.jobs, library.health);
  controls.object.position.set(0, 3.2, 34);
  camera.lookAt(0, 2.2, 0);
  showEutherBooksOverview(library.books, library.jobs, library.health, library.source);
  if (isTouchMapDevice()) enterMobileInspectionMode("room");
  statusLine.textContent = `EutherBooks Library | ${library.books.length} books | ${library.jobs.length} jobs | ${library.health?.status || library.source}`;
  if (!isTouchMapDevice()) hintLine.textContent = "EutherBooks room. Aim at Back to EutherVerse and press F to return.";
}

function leaveRoom(): void {
  if (roomMode === "city") return;
  currentRoomNode = null;
  setCustodianVisible(false);
  if (serverMap) buildCity(serverMap);
  controls.object.position.copy(lastCityPosition);
  controls.object.position.y = 3.2;
  camera.lookAt(7, 2.2, 0);
  if (isTouchMapDevice()) {
    enterMobileInspectionMode("city");
  } else {
    hintLine.textContent = "Back in EutherVerse. Aim at EutherBooks and press F to enter.";
  }
}

function enterGenericNodeRoom(sourceNode: SceneNode): void {
  roomMode = "node";
  currentRoomNode = sourceNode;
  viewMode = "walk";
  navigationEnabled = true;
  modeButton.textContent = "Map";
  leaveRoomButton.disabled = false;
  enterNodeButton.disabled = true;
  selectedNode = null;
  focusedNode = null;
  setCustodianVisible(false);
  cityRoot.clear();
  beamRoot.clear();
  sceneNodes.clear();
  buildGenericNodeRoom(sourceNode);
  controls.object.position.set(0, 3.2, 28);
  camera.lookAt(0, 2.5, 0);
  showGenericRoomOverview(sourceNode);
  if (isTouchMapDevice()) enterMobileInspectionMode("room");
  statusLine.textContent = `${sourceNode.label} room | ${sourceNode.type} | ${sourceNode.status || "unknown"}`;
  if (!isTouchMapDevice()) hintLine.textContent = `${sourceNode.label} room. Aim at ${sourceNode.label} Entry and press F to return.`;
}

function buildGenericNodeRoom(sourceNode: SceneNode): void {
  const service = serviceForNode(sourceNode);
  const status = sourceNode.status || service?.status || "unknown";
  addRoomNode(
    "room-custodian",
    `${sourceNode.label} Custodian`,
    "ai",
    nodeIsAlerting(sourceNode) ? "failed" : "configured",
    `Local guide for ${sourceNode.label}. Press F to ask about this room.`,
    new THREE.Vector3(-9, 0, -12),
    nodeIsAlerting(sourceNode) ? alertRed : 0xb878ff,
  );
  addRoomNode(
    "room-core",
    `${sourceNode.label} Core`,
    sourceNode.type,
    status,
    sourceNode.detail || service?.units.join(", ") || "Inventory-backed room core.",
    new THREE.Vector3(0, 0, -10),
    statusColors[status] || statusColors.unknown,
  );
  addRoomNode(
    "room-entry-gate",
    `${sourceNode.label} Entry`,
    "portal",
    "configured",
    "The node you entered from. Press F here to return to EutherVerse.",
    new THREE.Vector3(0, 0, 24),
    0x39d7d2,
  );
  addRoomNode(
    "room-status-console",
    "Status Console",
    "service",
    nodeIsAlerting(sourceNode) ? "failed" : "configured",
    roomConsoleDetail(sourceNode),
    new THREE.Vector3(9, 0, -12),
    nodeIsAlerting(sourceNode) ? alertRed : 0x39d7d2,
  );
  beamRoot.add(createBeam(new THREE.Vector3(-9, 0, -12), new THREE.Vector3(0, 0, -10), { from: "room-custodian", to: "room-core", type: "ai" }, nodeIsAlerting(sourceNode)));
  beamRoot.add(createBeam(new THREE.Vector3(9, 0, -12), new THREE.Vector3(0, 0, -10), { from: "room-status-console", to: "room-core", type: "status" }, nodeIsAlerting(sourceNode)));
}

async function loadEutherBooksRoomData(): Promise<{
  books: EutherBook[];
  jobs: EutherBooksJob[];
  health: EutherBooksHealth | null;
  source: string;
}> {
  try {
    const [books, jobs, health] = await Promise.all([
      jsonFetch<EutherBook[]>("/eutherbooks/books"),
      jsonFetch<EutherBooksJob[]>("/eutherbooks/jobs").catch(() => []),
      jsonFetch<EutherBooksHealth>("/eutherbooks/health").catch(() => null),
    ]);
    return { books, jobs, health, source: "live" };
  } catch (error) {
    const service = serverMap?.services.find((item) => item.name.toLowerCase() === "eutherbooks");
    return {
      books: [
        { id: "library-unavailable", title: "EutherBooks API unavailable", author: service?.status || "No live book list" },
        { id: "upload-zone", title: "Upload Intake", author: "Drop zone planned" },
        { id: "qwen-librarian", title: "Qwen Librarian", author: "Desk online when chat backend is wired" },
      ],
      jobs: [],
      health: { status: service?.status || "unknown", tts_backend: "fallback" },
      source: error instanceof Error ? error.message : "fallback",
    };
  }
}

function buildEutherBooksLibrary(books: EutherBook[], jobs: EutherBooksJob[], health: EutherBooksHealth | null): void {
  const visibleBooks = books.slice(0, 42);
  const shelfCount = Math.max(1, Math.ceil(visibleBooks.length / 7));
  for (let shelf = 0; shelf < shelfCount; shelf += 1) {
    const z = -16 + shelf * 7.5;
    cityRoot.add(createShelf(new THREE.Vector3(-18, 0, z), 11));
    cityRoot.add(createShelf(new THREE.Vector3(18, 0, z), 11));
  }

  visibleBooks.forEach((book, index) => {
    const row = Math.floor(index / 7);
    const col = index % 7;
    const side = index % 2 === 0 ? -1 : 1;
    const x = side * (12.8 + col * 0.72);
    const z = -16 + row * 7.5;
    const y = 1.1 + (col % 3) * 1.35;
    const job = latestJobForBook(book.id, jobs);
    const object = createBookObject(book, job);
    const position = new THREE.Vector3(x, y, z);
    object.position.copy(position);
    cityRoot.add(object);
    sceneNodes.set(`book-${book.id}`, {
      id: `book-${book.id}`,
      label: book.title,
      type: "book",
      status: bookStatus(book, job),
      detail: book.author || book.format || "EutherBooks volume",
      object,
      position,
      meta: {
        bookId: book.id,
        author: book.author,
        format: book.format,
        job: job?.status,
        audioFiles: job?.audio_files?.length ?? 0,
        totalAudioFiles: job?.total_audio_files ?? 0,
        error: job?.error,
      },
    });
  });

  addRoomNode("qwen-desk", "Qwen Librarian", "ai", "planned", "Ask about books, imports, voices, queue status and the way back.", new THREE.Vector3(0, 0, -24), 0xb878ff);
  addRoomNode("upload-intake", "Upload Intake", "service", "planned", "Future drag/drop intake for epub, pdf and audio.", new THREE.Vector3(-8, 0, -24), 0xf0b85a);
  addRoomNode("listening-booth", "Listening Booth", "service", "configured", "Open a selected book in EutherBooks Player.", new THREE.Vector3(8, 0, -24), 0x39d7d2);
  addRoomNode(
    "eutherbooks-entry-gate",
    "EutherBooks Entry",
    "portal",
    "configured",
    "The service node you entered from. Press F here to return to EutherVerse.",
    new THREE.Vector3(0, 0, 31),
    0x39d7d2,
  );
  addRoomNode(
    "library-stats",
    "Library Stats",
    "storage",
    health?.status || "unknown",
    `${books.length} books, ${jobs.length} jobs, ${health?.tts_backend || "unknown"} backend`,
    new THREE.Vector3(0, 0, 19),
    0x8aa8ff,
  );
}

function createShelf(position: THREE.Vector3, width: number): THREE.Object3D {
  const group = new THREE.Group();
  group.position.copy(position);
  const material = new THREE.MeshStandardMaterial({ color: 0x1a2a31, roughness: 0.72, metalness: 0.18 });
  for (let level = 0; level < 4; level += 1) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, 1.0), material);
    shelf.position.set(0, 0.65 + level * 1.35, 0);
    group.add(shelf);
  }
  const sideMaterial = new THREE.MeshStandardMaterial({ color: 0x223944, roughness: 0.68, metalness: 0.2 });
  [-width / 2, width / 2].forEach((x) => {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.2, 1.1), sideMaterial);
    side.position.set(x, 2.7, 0);
    group.add(side);
  });
  return group;
}

function createBookObject(book: EutherBook, job: EutherBooksJob | null): THREE.Object3D {
  const color = bookStatusColor(bookStatus(book, job));
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 1.18, 0.32),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.5, metalness: 0.1 }),
  );
  mesh.userData.nodeId = `book-${book.id}`;
  group.userData.nodeId = `book-${book.id}`;
  group.add(mesh);
  const label = createLabel(book.title, job?.status || book.format || "book", color);
  label.position.set(0, 1.25, 0);
  label.scale.set(5.8, 1.82, 1);
  group.add(label);
  return group;
}

function addRoomNode(
  id: string,
  label: string,
  type: string,
  status: string,
  detail: string,
  position: THREE.Vector3,
  color: number,
): void {
  const node: MapNode = { id, label, type, status, detail };
  const object = createNodeObject(node);
  object.position.copy(position);
  cityRoot.add(object);
  sceneNodes.set(id, { ...node, object, position, meta: { room: "eutherbooks" } });
}

function layoutNodes(nodes: MapNode[]): Map<string, THREE.Vector3> {
  const byType = new Map<string, MapNode[]>();
  for (const node of nodes) {
    const list = byType.get(node.type) || [];
    list.push(node);
    byType.set(node.type, list);
  }
  const lanes: Array<[string, number, number]> = [
    ["external", -36, -12],
    ["proxy", -24, -6],
    ["host", -10, 0],
    ["service", 8, 0],
    ["port", 24, 6],
    ["repo", 38, -5],
    ["ssh", 48, 16],
    ["ai", 0, 22],
    ["storage", 18, 22],
  ];
  const positions = new Map<string, THREE.Vector3>();
  for (const [type, x, zBase] of lanes) {
    const list = byType.get(type) || [];
    const spacing = Math.max(5.5, Math.min(10, 62 / Math.max(1, list.length)));
    const start = zBase - ((list.length - 1) * spacing) / 2;
    list.forEach((node, index) => positions.set(node.id, new THREE.Vector3(x, 0, start + index * spacing)));
  }
  let fallback = 0;
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    positions.set(node.id, new THREE.Vector3(0, 0, -32 + fallback * 6));
    fallback += 1;
  }
  return positions;
}

function createNodeObject(node: MapNode): THREE.Object3D {
  const group = new THREE.Group();
  const color = statusColors[node.status || "unknown"] || statusColors.unknown;
  const alerting = nodeIsAlerting(node);
  const height = typeHeights[node.type] || 2.6;
  const width = node.type === "host" ? 5.8 : node.type === "service" ? 4.6 : 3.4;
  const depth = node.type === "port" ? 2.2 : 3.4;
  const geometry = node.type === "ai"
    ? new THREE.OctahedronGeometry(2.4, 1)
    : node.type === "external"
      ? new THREE.CylinderGeometry(2.4, 2.4, height, 8)
      : new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color: alerting ? alertRed : color,
    emissive: alerting ? alertRed : color,
    emissiveIntensity: alerting ? 1.0 : 0.28,
    roughness: 0.38,
    metalness: 0.28,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height / 2;
  mesh.userData.nodeId = node.id;
  mesh.userData.alert = alerting;
  mesh.userData.baseColor = color;
  group.add(mesh);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(width * 0.72, width * 0.86, 32),
    new THREE.MeshBasicMaterial({ color: alerting ? alertRed : color, transparent: true, opacity: alerting ? 0.88 : 0.5, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.userData.alert = alerting;
  ring.userData.baseColor = color;
  group.add(ring);

  const label = createLabel(node.label, alerting ? `${node.type} ALERT` : node.type, alerting ? alertRed : color);
  label.position.set(0, height + 1.2, 0);
  group.add(label);
  group.userData.nodeId = node.id;
  group.userData.alert = alerting;
  return group;
}

function createLabel(title: string, subtitle: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(3, 8, 12, 0.78)";
  roundRect(ctx, 18, 18, 476, 110, 16);
  ctx.fill();
  ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 4;
  roundRect(ctx, 18, 18, 476, 110, 16);
  ctx.stroke();
  ctx.fillStyle = "#f3fbff";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText(shortText(title, 19), 36, 66);
  ctx.fillStyle = "#9fb6c7";
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillText(subtitle.toUpperCase(), 36, 103);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(8.6, 2.7, 1);
  return sprite;
}

function createBeam(from: THREE.Vector3, to: THREE.Vector3, edge: MapEdge, alerting: boolean): THREE.Object3D {
  const color = alerting ? alertRed : edge.type === "ssh" ? 0xf2bd5f : edge.type === "proxy" ? 0x39d7d2 : 0x4d6dff;
  const points = [
    from.clone().add(new THREE.Vector3(0, 1.4, 0)),
    from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 4.8, 0)),
    to.clone().add(new THREE.Vector3(0, 1.4, 0)),
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 32, alerting ? 0.14 : 0.08, 8, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: alerting ? 0.95 : 0.68 });
  const beam = new THREE.Mesh(geometry, material);
  beam.userData.phase = Math.random() * Math.PI * 2;
  beam.userData.alert = alerting;
  beam.userData.baseColor = color;
  return beam;
}

function animate(): void {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updateMovement(delta);
  updateFocus();
  updateLabelBillboards();
  const time = performance.now() * 0.001;
  updateAlertAnimations(time);
  beamRoot.children.forEach((child) => {
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    if (child.userData.alert) {
      material.opacity = 0.25 + alertPulse(time, child.userData.phase || 0) * 0.72;
      material.color.setHex(alertPulse(time, child.userData.phase || 0) > 0.54 ? alertRed : alertDark);
    } else {
      material.opacity = 0.42 + Math.sin(time * 3 + (child.userData.phase || 0)) * 0.18;
    }
  });
  renderer.render(scene, camera);
}

function updateAlertAnimations(time: number): void {
  cityRoot.traverse((object) => {
    if (!object.userData.alert) return;
    const pulse = alertPulse(time, object.userData.phase || 0);
    const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material || Array.isArray(material)) return;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.setHex(pulse > 0.5 ? alertRed : alertDark);
      material.emissive.setHex(alertRed);
      material.emissiveIntensity = 0.45 + pulse * 1.65;
      return;
    }
    if (material instanceof THREE.MeshBasicMaterial) {
      material.color.setHex(pulse > 0.5 ? alertRed : alertDark);
      material.opacity = 0.25 + pulse * 0.75;
    }
  });
}

function alertPulse(time: number, phase = 0): number {
  return 0.5 + Math.sin(time * 7.5 + phase) * 0.5;
}

function updateMovement(delta: number): void {
  if (!navigationEnabled) return;
  if (viewMode === "map") {
    updateMapMovement(delta);
    return;
  }
  velocity.x -= velocity.x * 9.0 * delta;
  velocity.y -= velocity.y * 9.0 * delta;
  velocity.z -= velocity.z * 9.0 * delta;
  direction.z = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  direction.x = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  direction.normalize();
  const speed = keys.has("ShiftLeft") ? 74 : 42;
  const verticalSpeed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 52 : 30;
  if (keys.has("KeyW") || keys.has("KeyS")) velocity.z -= direction.z * speed * delta;
  if (keys.has("KeyA") || keys.has("KeyD")) velocity.x -= direction.x * speed * delta;
  if (keys.has("Space")) velocity.y += verticalSpeed * delta;
  if (keys.has("KeyZ")) velocity.y -= verticalSpeed * delta;
  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);
  controls.object.position.y = THREE.MathUtils.clamp(controls.object.position.y + velocity.y * delta, 2.2, roomMode === "eutherbooks" ? 38 : 118);
}

function updateLabelBillboards(): void {
  cityRoot.traverse((object) => {
    if ((object as THREE.Sprite).isSprite) {
      object.quaternion.copy(camera.quaternion);
    }
  });
}

function updateMapMovement(delta: number): void {
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 62 : 34;
  const step = speed * delta;
  if (keys.has("KeyW")) controls.object.position.z -= step;
  if (keys.has("KeyS")) controls.object.position.z += step;
  if (keys.has("KeyA")) controls.object.position.x -= step;
  if (keys.has("KeyD")) controls.object.position.x += step;
  lookAtMapCenter();
}

function updateFocus(): void {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cityRoot.children, true);
  const hit = hits.find((item) => nodeIdForObject(item.object));
  const node = hit ? sceneNodes.get(nodeIdForObject(hit.object)!) || null : null;
  if (node === focusedNode) return;
  focusedNode = node;
  crosshair.style.opacity = node ? "1" : ".45";
  enterNodeButton.disabled = !(node && nodeCanEnter(node) && roomMode === "city");
  restartButton.disabled = !(node && restartCommandForNode(node));
  updateEnterButton(node);
  updateControlsGuide(node);
  if (viewMode === "map") {
    hintLine.textContent = node
      ? `Map target: ${node.label} | tap/press E inspect`
      : isTouchMapDevice()
        ? "Mobile map. Drag pans, pinch zooms, tap a node to inspect."
        : "Map mode. WASD pans the overview. Press M for 3D.";
    return;
  }
  hintLine.textContent = node
    ? `Target: ${node.label} | E inspect${nodeCanEnter(node) && roomMode === "city" ? " | F enter" : ""}${isRoomReturnNode(node) ? " | F back" : ""}${isCustodianNode(node) ? " | F ask" : ""}`
    : navigationEnabled
      ? "WASD moves. Space/Z changes depth. Click Enter again for mouse look."
      : "Click Enter to take controls.";
}

function inspectFocusedNode(): void {
  if (!focusedNode) return;
  selectedNode = focusedNode;
  showNode(selectedNode);
  restartButton.disabled = !restartCommandForNode(selectedNode);
  updateEnterButton(selectedNode);
}

function updateEnterButton(node: SceneNode | null): void {
  const action = mobileNodeAction(node);
  const canUse = Boolean(action);
  enterNodeButton.disabled = !canUse;
  enterNodeButton.textContent = action === "enter" ? "Enter Node" : action === "use" ? "Use" : "Enter Node";
  const topEnter = document.querySelector<HTMLButtonElement>("#ev-enter");
  if (!topEnter) return;
  topEnter.textContent = viewMode === "map" && isTouchMapDevice() && canUse
    ? action === "enter" ? "Enter Node" : "Use"
    : "Enter";
}

function mobileNodeAction(node: SceneNode | null): "enter" | "use" | null {
  if (!node) return null;
  if (roomMode === "city" && nodeCanEnter(node)) return "enter";
  if (roomMode !== "city" && (isRoomReturnNode(node) || isCustodianNode(node))) return "use";
  return null;
}

function showOverview(map: ServerMap): void {
  restartButton.disabled = true;
  updateEnterButton(null);
  updateControlsGuide(null);
  const alerts = map.nodes.filter(nodeIsAlerting).length;
  document.querySelector("#ev-target")!.textContent = "EutherVerse";
  detailPanel.innerHTML = `
    <div><strong>${map.nodes.length}</strong> nodes</div>
    <div><strong>${map.edges.length}</strong> links</div>
    <div><strong>${alerts}</strong> active alerts</div>
    <div><strong>${map.services.filter((service) => service.status === "running").length}</strong> running services</div>
    <div><strong>${map.listening_services.length || map.ports.length}</strong> observed ports</div>
    ${gpuSchedulerHtml(gpuScheduler)}
  `;
}

function gpuSchedulerHtml(overview: GpuSchedulerOverview | null): string {
  if (!overview) return `<div><strong>GPU:</strong> loading</div>`;
  if (overview.error) return `<div><strong>GPU:</strong> ${escapeHtml(overview.error)}</div>`;
  const resources = overview.resources;
  const lease = resources?.gpu_lease;
  const active = lease?.active || null;
  const running = overview.jobs.find((job) => job.status === "running");
  const queued = overview.jobs.filter((job) => job.status === "queued");
  const activeLabel = gpuActiveLabel(active, running);
  const vram = resources?.gpu?.memory_used_mib != null && resources.gpu.memory_total_mib != null
    ? `${resources.gpu.memory_used_mib}/${resources.gpu.memory_total_mib} MiB`
    : "unknown";
  const dots = resources?.tts?.dots_tts;
  const recent = overview.jobs
    .slice(0, 4)
    .map((job) => `${job.owner}:${job.status}`)
    .join(", ");
  return `
    <div><strong>GPU active:</strong> ${escapeHtml(activeLabel)}</div>
    <div><strong>GPU queue:</strong> ${lease?.queue_length ?? queued.length} waiting</div>
    <div><strong>VRAM:</strong> ${escapeHtml(vram)} | ${resources?.gpu?.utilization_gpu_percent ?? 0}% util</div>
    <div><strong>Dots:</strong> ${escapeHtml(dots?.status || "unknown")}${dots?.model_loaded ? " loaded" : ""}</div>
    <div><strong>GPU jobs:</strong> ${escapeHtml(recent || "none")}</div>
  `;
}

function gpuActiveLabel(active: Record<string, unknown> | null, running: GpuSchedulerJob | undefined): string {
  if (active) {
    const label = typeof active.label === "string" ? active.label : "";
    const owner = typeof active.owner === "string" ? active.owner : "";
    const ownerId = typeof active.owner_id === "string" ? active.owner_id : "";
    return label || [owner, ownerId].filter(Boolean).join(" ") || "busy";
  }
  if (running) return running.label || `${running.owner} ${running.owner_id}`;
  return "free";
}

function showGenericRoomOverview(node: SceneNode): void {
  const service = serviceForNode(node);
  document.querySelector("#ev-target")!.textContent = `${node.label} Room`;
  detailPanel.innerHTML = [
    ["Node", node.id],
    ["Type", node.type],
    ["Status", node.status || service?.status || "unknown"],
    ["Alarm", nodeIsAlerting(node) ? "active" : "clear"],
    ["Units", service?.units.join(", ") || ""],
    ["Ports", service?.ports.join(", ") || ""],
    ["Repo", service?.repo_path || ""],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</div>`)
    .join("");
}

function showEutherBooksOverview(
  books: EutherBook[],
  jobs: EutherBooksJob[],
  health: EutherBooksHealth | null,
  source: string,
): void {
  const runningJobs = jobs.filter((job) => job.status === "running" || job.status === "queued").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  updateControlsGuide(null);
  document.querySelector("#ev-target")!.textContent = "EutherBooks Library";
  detailPanel.innerHTML = `
    <div><strong>${books.length}</strong> books on shelves</div>
    <div><strong>${jobs.length}</strong> known jobs</div>
    <div><strong>${runningJobs}</strong> queued/running</div>
    <div><strong>${failedJobs}</strong> failed jobs</div>
    <div><strong>${escapeHtml(health?.tts_backend || "unknown")}</strong> TTS backend</div>
    <div><strong>${escapeHtml(source)}</strong> source</div>
  `;
}

function showNode(node: SceneNode): void {
  updateControlsGuide(node);
  document.querySelector("#ev-target")!.textContent = node.label || node.id;
  if (roomMode === "eutherbooks") {
    showRoomNode(node);
    return;
  }
  const service = serverMap?.services.find((item) => item.name.toLowerCase() === node.label.toLowerCase());
  const port = serverMap?.listening_services.find((item) => `port-${item.protocol}-${item.port}` === node.id);
  const lines = [
    ["ID", node.id],
    ["Type", node.type],
    ["Status", node.status || "unknown"],
    ["Alarm", nodeIsAlerting(node) ? "active" : "clear"],
    ["Detail", node.detail || ""],
  ];
  if (service) {
    lines.push(["Units", service.units.join(", ")]);
    lines.push(["Ports", service.ports.join(", ")]);
    lines.push(["Repo", service.repo_path]);
    lines.push(["Restart", restartCommandForService(service) ? "available" : "not allowlisted"]);
  }
  if (port) {
    lines.push(["Port", `${port.protocol}:${port.port}`]);
    lines.push(["Process", port.process || port.local || ""]);
  }
  detailPanel.innerHTML = lines
    .filter(([, value]) => value)
    .map(([key, value]) => `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</div>`)
    .join("");
}

async function restartSelectedService(): Promise<void> {
  if (!selectedNode) return;
  const command = restartCommandForNode(selectedNode);
  if (!command) {
    statusLine.textContent = "Restart is not allowlisted for this node.";
    return;
  }
  const label = selectedNode.label || selectedNode.id;
  const ok = window.confirm(`Restart ${label}?`);
  if (!ok) return;
  restartButton.disabled = true;
  statusLine.textContent = `Sending EutherID approval request for ${label}...`;
  const created = await jsonFetch<{ challengeId: string; expiresAt: number }>("/api/admin/eutherid/actions/service-restarts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: command }),
  });
  renderEutherIdAudit(await loadEutherIdAudit());
  statusLine.textContent = `Approval sent to EutherID for ${label}. Waiting for fingerprint...`;
  const deadline = Math.min(created.expiresAt || Date.now() + 120_000, Date.now() + 125_000);
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    const result = await jsonFetch<{
      ok: boolean;
      status: string;
      result?: { stdout?: string };
    }>(`/api/admin/eutherid/actions/service-restarts/${encodeURIComponent(created.challengeId)}`);
    renderEutherIdAudit(await loadEutherIdAudit());
    if (result.status === "completed") {
      statusLine.textContent = `Restarted ${label}: ${(result.result?.stdout || "approved and verified").trim()}`;
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      await loadMap(false);
      return;
    }
    if (["denied", "expired", "consumed"].includes(result.status)) {
      throw new Error(`EutherID request ended with status: ${result.status}`);
    }
  }
  throw new Error("EutherID request timed out without approval");
}

function restartCommandForNode(node: SceneNode): string | null {
  const serviceNode = roomMode === "city" ? node : currentRoomNode;
  if (!serviceNode) return null;
  const service = serviceForNode(serviceNode);
  return service ? restartCommandForService(service) : null;
}

function serviceForNode(node: SceneNode): ServiceReport | null {
  const nodeLabel = node.label.toLowerCase();
  const nodeId = node.id.toLowerCase();
  return serverMap?.services.find((service) => {
    const serviceName = service.name.toLowerCase();
    return serviceName === nodeLabel || serviceName === nodeId || service.units.some((unit) => node.detail?.includes(unit));
  }) || null;
}

function restartCommandForService(service: ServiceReport): string | null {
  const units = service.units.filter((unit) => unit.endsWith(".service"));
  let command: string | null = null;
  if (units.includes("eutherhost.service")) command = "restart-eutherhost";
  if (units.includes("caddy.service")) command = "restart-caddy";
  if (units.includes("eutherbooks.service")) command = "restart-eutherbooks";
  if (units.includes("eutherpunkd.service")) command = "restart-eutherpunkd";
  if (units.includes("euthergate.service")) return "restart-euthergate-gateway";
  if (units.includes("euthergate-tunnel.service")) return "restart-euthergate-tunnel";
  if (units.includes("euthergate-forge.service")) return "restart-euthergate-forge";
  if (service.name.toLowerCase() === "euthersight") command = "restart-euthersight-frigate";
  if (!command) return null;
  return eutherNetCommands.some((item) => item.name === command && item.enabled) ? command : null;
}

function nodeIsAlerting(node: Pick<MapNode, "status" | "detail">): boolean {
  const status = `${node.status || ""} ${node.detail || ""}`.toLowerCase();
  if (!status.trim()) return false;
  return [
    "failed",
    "failure",
    "stopped",
    "inactive",
    "dead",
    "down",
    "offline",
    "error",
    "unreachable",
    "timeout",
    "refused",
    "missing",
    "degraded",
  ].some((word) => status.includes(word));
}

function showRoomNode(node: SceneNode): void {
  updateControlsGuide(node);
  const lines = [
    ["ID", node.id],
    ["Type", node.type],
    ["Status", node.status || "unknown"],
    ["Detail", node.detail || ""],
  ];
  if (node.id.startsWith("book-")) {
    lines.push(["Book ID", String(node.meta?.bookId || "")]);
    lines.push(["Author", String(node.meta?.author || "")]);
    lines.push(["Format", String(node.meta?.format || "")]);
    lines.push(["Job", String(node.meta?.job || "no recent job")]);
    lines.push(["Audio", `${node.meta?.audioFiles || 0}/${node.meta?.totalAudioFiles || 0}`]);
    lines.push(["Error", String(node.meta?.error || "")]);
  }
  if (node.id === "qwen-desk") {
    lines.push(["Next", "Wire local Qwen chat with selected book context"]);
  }
  if (isCustodianNode(node)) {
    lines.push(["Use", "Press F to ask this room custodian"]);
  }
  if (node.id === "upload-intake") {
    lines.push(["Next", "Expose confirmed EutherBooks upload action here"]);
  }
  if (isRoomReturnNode(node)) {
    lines.push(["Use", "Press F to return through the node you entered from"]);
  }
  detailPanel.innerHTML = lines
    .filter(([, value]) => value)
    .map(([key, value]) => `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</div>`)
    .join("");
}

function updateControlsGuide(node: SceneNode | null): void {
  const objective = document.querySelector<HTMLElement>("#ev-objective");
  const controlsList = document.querySelector<HTMLElement>("#ev-controls-list");
  if (!objective || !controlsList) return;

  const mobileMap = viewMode === "map" && isTouchMapDevice();
  const rows: Array<[string, string]> = mobileMap
    ? [
        ["Drag", "Pan map"],
        ["Pinch", "Zoom map"],
        ["Tap", "Inspect node"],
        ["3D", "Enter walk mode"],
        ["Refresh", "Reload inventory"],
      ]
    : [
        ["WASD", viewMode === "map" ? "Pan overview" : "Move"],
        ["Mouse", viewMode === "map" ? "Disabled in map" : "Look"],
        ["Scroll", viewMode === "map" ? "Zoom overview" : "Move closer/farther"],
        ["Space", viewMode === "map" ? "Not used" : "Ascend"],
        ["Z", viewMode === "map" ? "Not used" : "Descend"],
        ["E", "Inspect target"],
        ["M", viewMode === "map" ? "Return to 3D" : "Map mode"],
        ["R", "Refresh inventory"],
      ];

  if (roomMode === "eutherbooks") {
    if (mobileMap) {
      rows.push(["Use", "Portal/custodian"]);
    } else {
      rows.push(["F", "Back through portal"]);
      rows.push(["Esc", "Release cursor"]);
    }
    objective.textContent = node
      ? eutherBooksObjectiveFor(node)
      : mobileMap
        ? "Mobile room map. Drag to pan, pinch to zoom, tap shelves or stations to inspect. Tap EutherBooks Entry or Qwen Librarian, then Use to return."
        : "You are inside EutherBooks. Move like an inspection diver: WASD across the room, Space/Z up and down, E to inspect shelves and stations. Aim at EutherBooks Entry or Qwen Librarian and press F to return.";
  } else if (roomMode === "node") {
    if (mobileMap) {
      rows.push(["Use", "Ask/back"]);
    } else {
      rows.push(["F", "Ask/back when targeted"]);
      rows.push(["Esc", "Release cursor"]);
    }
    objective.textContent = node
      ? genericRoomObjectiveFor(node)
      : mobileMap
        ? `Mobile room map for ${currentRoomNode?.label || "this node"}. Drag to pan, pinch to zoom, tap room nodes to inspect. Tap Custodian or Entry, then Use.`
        : `You are inside ${currentRoomNode?.label || "a node"} room. Inspect the core, ask the custodian, or aim at the Entry node and press F to return.`;
  } else {
    rows.push(["F", "Enter node when available"]);
    rows.push(["Esc", "Release cursor"]);
    objective.textContent = node
      ? cityObjectiveFor(node)
      : mobileMap
        ? "Mobile map mode. Drag to pan, pinch to zoom, tap a node to inspect it. Use 3D when you want to enter walk mode."
        : "Click Enter for mouse look. Move like an inspection diver around the server city: WASD across, Space/Z up and down. Aim at EutherBooks, then press F or Enter Node.";
  }

  controlsList.innerHTML = rows
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function cityObjectiveFor(node: SceneNode): string {
  if (isEutherGateNode(node)) {
    return "EutherGate is the admin-only remote forge. Press F or click Enter Node to open the live terminal and Wayland desktop.";
  }
  if (isEutherBooksNode(node)) {
    return "EutherBooks has an explorable room. Press F or click Enter Node to go into the library. Press E first if you want service details and restart controls.";
  }
  if (nodeCanEnter(node)) {
    return `${node.label} has an explorable room. Press F or click Enter Node to inspect it with its custodian.`;
  }
  const restart = restartCommandForNode(node) ? " Restart is available after inspection." : "";
  return `Targeting ${node.label}. Press E to inspect status, ports, units and repo path.${restart}`;
}

function eutherBooksObjectiveFor(node: SceneNode): string {
  if (node.id.startsWith("book-")) {
    return "Book target. Press E to inspect metadata, conversion job status and available audio files.";
  }
  if (node.id === "qwen-desk") {
    return "Qwen Librarian desk. Press F to ask the librarian to send you back to EutherVerse, or use the custodian dialog for status questions.";
  }
  if (node.id === "upload-intake") {
    return "Upload Intake. Press E to inspect the planned station for adding new books.";
  }
  if (node.id === "listening-booth") {
    return "Listening Booth. Press E to inspect the player station for opening and listening to processed books.";
  }
  if (node.id === "library-stats") {
    return "Library Stats. Press E to inspect book counts, queue state and backend health.";
  }
  if (isRoomReturnNode(node)) {
    return "This is the EutherBooks entry node. Press F to return through the node you entered from.";
  }
  return `Targeting ${node.label}. Press E to inspect this library object.`;
}

function genericRoomObjectiveFor(node: SceneNode): string {
  if (isRoomReturnNode(node)) {
    return "Entry node. Press F to return through the node you entered from.";
  }
  if (isCustodianNode(node)) {
    return "Room custodian. Press F to open the dialog, then ask about status, ports, units, alerts or safe actions.";
  }
  if (node.id === "room-core") {
    return "Room core. Press E to inspect the real inventory state represented by this room.";
  }
  if (node.id === "room-status-console") {
    return "Status console. Press E to inspect the condensed health context for this node.";
  }
  return `Targeting ${node.label}. Press E to inspect.`;
}

function isRoomReturnNode(node: SceneNode): boolean {
  return roomMode === "eutherbooks"
    ? node.id === "eutherbooks-entry-gate" || node.id === "qwen-desk"
    : roomMode === "node" && node.id === "room-entry-gate";
}

function isCustodianNode(node: SceneNode): boolean {
  return (roomMode === "eutherbooks" && node.id === "qwen-desk") || (roomMode === "node" && node.id === "room-custodian");
}

function isEutherBooksNode(node: SceneNode): boolean {
  const value = `${node.id} ${node.label} ${node.detail || ""}`.toLowerCase();
  return value.includes("eutherbooks");
}

function isEutherGateNode(node: SceneNode): boolean {
  const value = `${node.id} ${node.label}`.toLowerCase();
  return value.includes("euthergate");
}

function nodeCanEnter(node: SceneNode): boolean {
  if (roomMode !== "city") return false;
  if (isEutherBooksNode(node)) return true;
  return ["service", "proxy", "host", "ai", "storage"].includes(node.type);
}

function roomConsoleDetail(node: SceneNode): string {
  const service = serviceForNode(node);
  const pieces = [
    `status=${node.status || service?.status || "unknown"}`,
    service?.units.length ? `units=${service.units.join(",")}` : "",
    service?.ports.length ? `ports=${service.ports.join(",")}` : "",
    service?.repo_path ? `repo=${service.repo_path}` : "",
  ].filter(Boolean);
  return pieces.join(" | ") || node.detail || "No expanded inventory detail.";
}

function focusCustodian(): void {
  openCustodianDialog();
}

function openCustodianDialog(): void {
  setCustodianVisible(true);
  if (controls.isLocked) controls.unlock();
  const node = currentRoomNode;
  custodianTitle.textContent = node ? `${node.label} Custodian` : "Room Custodian";
  custodianContext.textContent = node ? roomCustodianContext(node) : "No room context.";
  custodianQuestion.focus({ preventScroll: true });
  custodianAnswer.textContent = currentRoomNode
    ? `Custodian linked to ${currentRoomNode.label}. Ask about status, alerts, ports, units or allowed actions.`
    : "Custodian online.";
}

function setCustodianVisible(visible: boolean): void {
  custodianOverlay.hidden = !visible;
  if (!visible) {
    custodianQuestion.value = "";
    custodianAnswer.textContent = "";
    custodianContext.textContent = "";
  }
}

function closeCustodianDialog(): void {
  setCustodianVisible(false);
  renderer.domElement.focus();
  hintLine.textContent = "Custodian link closed. Click Enter for mouse look.";
}

function custodianDialogOpen(): boolean {
  return !custodianOverlay.hidden;
}

function isTextInputEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
}

function roomCustodianContext(node: SceneNode): string {
  const service = serviceForNode(node);
  return [
    `${node.type.toUpperCase()} | ${node.status || service?.status || "unknown"} | alarm ${nodeIsAlerting(node) ? "active" : "clear"}`,
    service?.units.length ? `units: ${service.units.join(", ")}` : "",
    service?.ports.length ? `ports: ${service.ports.join(", ")}` : "",
    service?.repo_path ? `repo: ${service.repo_path}` : "",
  ].filter(Boolean).join("  ");
}

async function askCustodian(): Promise<void> {
  const node = currentRoomNode;
  if (!node) return;
  const question = custodianQuestion.value.trim() || "Sammanfatta status och risker för den här noden.";
  custodianAnswer.textContent = "Custodian thinking...";
  const service = serviceForNode(node);
  const prompt = [
    `Du är custodian i EutherVerse-rummet för noden ${node.label}.`,
    `Nod-id: ${node.id}`,
    `Typ: ${node.type}`,
    `Status: ${node.status || "unknown"}`,
    `Alarm: ${nodeIsAlerting(node) ? "active" : "clear"}`,
    `Detalj: ${node.detail || ""}`,
    service ? `Units: ${service.units.join(", ")}` : "",
    service ? `Ports: ${service.ports.join(", ")}` : "",
    service?.repo_path ? `Repo: ${service.repo_path}` : "",
    "Svara kort, praktiskt och basera dig på EutherNet inventory. Föreslå bara allowlistade actions om åtgärder behövs.",
    `Fråga: ${question}`,
  ].filter(Boolean).join("\n");
  try {
    const result = await jsonFetch<{ ok?: boolean; answer?: string; source?: string; fallback?: string }>("/api/admin/euthernet/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: prompt }),
    });
    custodianAnswer.textContent = result.answer || result.fallback || "No custodian answer.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    custodianAnswer.textContent = `Custodian link failed: ${message}`;
    throw error;
  }
}

function latestJobForBook(bookId: string, jobs: EutherBooksJob[]): EutherBooksJob | null {
  return jobs.find((job) => job.book_id === bookId) || null;
}

function bookStatus(book: EutherBook, job: EutherBooksJob | null): string {
  if (!job) return book.format || "present";
  if (job.status === "done") {
    const ready = job.audio_files?.length || 0;
    const total = job.total_audio_files || ready;
    return ready >= total ? "running" : "configured";
  }
  return job.status || "present";
}

function bookStatusColor(status: string): number {
  if (statusColors[status]) return statusColors[status];
  if (status.includes("epub")) return 0x39d7d2;
  if (status.includes("pdf")) return 0xf0b85a;
  return 0x8aa8ff;
}

function nodeIdForObject(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.nodeId === "string") return current.userData.nodeId;
    current = current.parent;
  }
  return null;
}

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function jsonFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.method && options.method !== "GET" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.json() as Promise<T>;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  statusLine.textContent = `Error: ${message}`;
}

function shortText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] || char);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
