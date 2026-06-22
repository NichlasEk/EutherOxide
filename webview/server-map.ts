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
type RoomMode = "city" | "eutherbooks";

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

let csrfToken = "";
let serverMap: ServerMap | null = null;
let selectedNode: SceneNode | null = null;
let focusedNode: SceneNode | null = null;
let viewMode: ViewMode = "walk";
let roomMode: RoomMode = "city";
let navigationEnabled = false;
let lastCityPosition = new THREE.Vector3(7, 3.2, 58);

const sceneNodes = new Map<string, SceneNode>();
const clock = new THREE.Clock();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const keys = new Set<string>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(0, 0);

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
          <button id="ev-action-leave-room" type="button" disabled>Leave Room</button>
          <a id="ev-action-open-eutherbooks" href="/eutherbooks" target="_blank" rel="noreferrer">Open EutherBooks</a>
          <button id="ev-action-restart" type="button" disabled>Restart Service</button>
          <small>Restart uses EutherNet's configured command allowlist. System services may need sudoers for non-interactive restart.</small>
        </section>
      </aside>
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
    #eutherverse { position: fixed; inset: 0; background: #05070a; }
    #eutherverse-canvas { width: 100%; height: 100%; display: block; }
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
  document.querySelector("#ev-enter")?.addEventListener("click", enterWalkMode);
  renderer.domElement.addEventListener("click", () => {
    if (viewMode === "walk") enterWalkMode();
  });
  renderer.domElement.addEventListener("wheel", handleWheelZoom, { passive: false });
  modeButton.addEventListener("click", toggleMapMode);
  document.querySelector("#ev-refresh")?.addEventListener("click", () => loadMap(true).catch(showError));
  document.querySelector("#ev-action-health")?.addEventListener("click", () => loadMap(true).catch(showError));
  enterNodeButton.addEventListener("click", () => enterFocusedNode().catch(showError));
  leaveRoomButton.addEventListener("click", leaveRoom);
  restartButton.addEventListener("click", () => restartSelectedService().catch(showError));
  document.addEventListener("keydown", (event) => {
    if (event.repeat && event.code !== "KeyE") return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "KeyE", "KeyF", "KeyM", "KeyR", "Escape"].includes(event.code)) {
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
      hintLine.textContent = "WASD moves. Click Enter again for mouse look.";
    } else if (viewMode === "walk") {
      hintLine.textContent = "Click Enter to take controls.";
    }
  });
}

function enterWalkMode(): void {
  viewMode = "walk";
  navigationEnabled = true;
  modeButton.textContent = "Map";
  crosshair.style.display = "";
  controls.object.position.y = 3.2;
  renderer.domElement.focus();
  controls.lock();
  hintLine.textContent = "WASD moves. Mouse look starts when the browser grants pointer lock.";
}

function handleWheelZoom(event: WheelEvent): void {
  event.preventDefault();
  navigationEnabled = true;
  const amount = THREE.MathUtils.clamp(event.deltaY * 0.035, -14, 14);
  if (viewMode === "map") {
    const nextY = THREE.MathUtils.clamp(controls.object.position.y + amount * 1.8, 18, 118);
    controls.object.position.y = nextY;
    camera.lookAt(controls.object.position.x, 0, controls.object.position.z - 8);
    hintLine.textContent = "Map mode. Scroll zooms. WASD pans. Press M for 3D.";
    return;
  }
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() === 0) return;
  forward.normalize();
  controls.object.position.addScaledVector(forward, -amount);
  controls.object.position.y = 3.2;
  hintLine.textContent = "Scroll zooms. WASD moves. Click Enter for mouse look.";
}

function toggleMapMode(): void {
  if (viewMode === "map") {
    enterWalkMode();
    return;
  }
  viewMode = "map";
  navigationEnabled = true;
  keys.clear();
  controls.unlock();
  modeButton.textContent = "3D";
  crosshair.style.display = "none";
  controls.object.position.set(7, 72, 13);
  camera.lookAt(7, 0, 5);
  velocity.set(0, 0, 0);
  hintLine.textContent = "Map mode. WASD pans the overview. Press M for 3D.";
}

async function loadMap(refresh: boolean): Promise<void> {
  roomMode = "city";
  leaveRoomButton.disabled = true;
  statusLine.textContent = refresh ? "Refreshing EutherNet inventory..." : "Loading EutherNet map...";
  if (refresh) {
    await jsonFetch("/api/admin/euthernet/refresh", { method: "POST", body: "{}" });
  }
  serverMap = await jsonFetch<ServerMap>("/api/admin/euthernet/map");
  buildCity(serverMap);
  statusLine.textContent = `Snapshot ${serverMap.collected_at} | ${serverMap.nodes.length} nodes | ${serverMap.edges.length} links`;
}

function buildCity(map: ServerMap): void {
  roomMode = "city";
  leaveRoomButton.disabled = true;
  cityRoot.clear();
  beamRoot.clear();
  sceneNodes.clear();
  selectedNode = null;
  focusedNode = null;

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
    beamRoot.add(createBeam(from.position, to.position, edge));
  }
  showOverview(map);
}

async function enterFocusedNode(): Promise<void> {
  if (!focusedNode || !isEutherBooksNode(focusedNode)) return;
  lastCityPosition.copy(controls.object.position);
  await enterEutherBooksRoom();
}

async function enterEutherBooksRoom(): Promise<void> {
  roomMode = "eutherbooks";
  viewMode = "walk";
  navigationEnabled = true;
  modeButton.textContent = "Map";
  leaveRoomButton.disabled = false;
  enterNodeButton.disabled = true;
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
  statusLine.textContent = `EutherBooks Library | ${library.books.length} books | ${library.jobs.length} jobs | ${library.health?.status || library.source}`;
  hintLine.textContent = "EutherBooks room. WASD moves. Aim at a book and press E. Esc leaves room.";
}

function leaveRoom(): void {
  if (roomMode === "city") return;
  if (serverMap) buildCity(serverMap);
  controls.object.position.copy(lastCityPosition);
  controls.object.position.y = 3.2;
  camera.lookAt(7, 2.2, 0);
  hintLine.textContent = "Back in EutherVerse. Aim at EutherBooks and press F to enter.";
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

  addRoomNode("qwen-desk", "Qwen Librarian", "ai", "planned", "Ask about books, imports, voices and queue status.", new THREE.Vector3(0, 0, -24), 0xb878ff);
  addRoomNode("upload-intake", "Upload Intake", "service", "planned", "Future drag/drop intake for epub, pdf and audio.", new THREE.Vector3(-8, 0, -24), 0xf0b85a);
  addRoomNode("listening-booth", "Listening Booth", "service", "configured", "Open a selected book in EutherBooks Player.", new THREE.Vector3(8, 0, -24), 0x39d7d2);
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
  const height = typeHeights[node.type] || 2.6;
  const width = node.type === "host" ? 5.8 : node.type === "service" ? 4.6 : 3.4;
  const depth = node.type === "port" ? 2.2 : 3.4;
  const geometry = node.type === "ai"
    ? new THREE.OctahedronGeometry(2.4, 1)
    : node.type === "external"
      ? new THREE.CylinderGeometry(2.4, 2.4, height, 8)
      : new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: node.status === "failed" ? 0.85 : 0.28,
    roughness: 0.38,
    metalness: 0.28,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = height / 2;
  mesh.userData.nodeId = node.id;
  group.add(mesh);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(width * 0.72, width * 0.86, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  const label = createLabel(node.label, node.type, color);
  label.position.set(0, height + 1.2, 0);
  group.add(label);
  group.userData.nodeId = node.id;
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

function createBeam(from: THREE.Vector3, to: THREE.Vector3, edge: MapEdge): THREE.Object3D {
  const color = edge.type === "ssh" ? 0xf2bd5f : edge.type === "proxy" ? 0x39d7d2 : 0x4d6dff;
  const points = [
    from.clone().add(new THREE.Vector3(0, 1.4, 0)),
    from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 4.8, 0)),
    to.clone().add(new THREE.Vector3(0, 1.4, 0)),
  ];
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 32, 0.08, 8, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.68 });
  const beam = new THREE.Mesh(geometry, material);
  beam.userData.phase = Math.random() * Math.PI * 2;
  return beam;
}

function animate(): void {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updateMovement(delta);
  updateFocus();
  const time = performance.now() * 0.001;
  beamRoot.children.forEach((child) => {
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    material.opacity = 0.42 + Math.sin(time * 3 + (child.userData.phase || 0)) * 0.18;
  });
  renderer.render(scene, camera);
}

function updateMovement(delta: number): void {
  if (!navigationEnabled) return;
  if (viewMode === "map") {
    updateMapMovement(delta);
    return;
  }
  velocity.x -= velocity.x * 9.0 * delta;
  velocity.z -= velocity.z * 9.0 * delta;
  direction.z = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
  direction.x = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
  direction.normalize();
  const speed = keys.has("ShiftLeft") ? 74 : 42;
  if (keys.has("KeyW") || keys.has("KeyS")) velocity.z -= direction.z * speed * delta;
  if (keys.has("KeyA") || keys.has("KeyD")) velocity.x -= direction.x * speed * delta;
  controls.moveRight(-velocity.x * delta);
  controls.moveForward(-velocity.z * delta);
  controls.object.position.y = 3.2;
}

function updateMapMovement(delta: number): void {
  const speed = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 62 : 34;
  const step = speed * delta;
  if (keys.has("KeyW")) controls.object.position.z -= step;
  if (keys.has("KeyS")) controls.object.position.z += step;
  if (keys.has("KeyA")) controls.object.position.x -= step;
  if (keys.has("KeyD")) controls.object.position.x += step;
  camera.lookAt(controls.object.position.x, 0, controls.object.position.z - 8);
}

function updateFocus(): void {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cityRoot.children, true);
  const hit = hits.find((item) => nodeIdForObject(item.object));
  const node = hit ? sceneNodes.get(nodeIdForObject(hit.object)!) || null : null;
  if (node === focusedNode) return;
  focusedNode = node;
  crosshair.style.opacity = node ? "1" : ".45";
  enterNodeButton.disabled = !(node && isEutherBooksNode(node) && roomMode === "city");
  restartButton.disabled = !(node && restartCommandForNode(node));
  updateControlsGuide(node);
  if (viewMode === "map") {
    hintLine.textContent = node ? `Map target: ${node.label} | E inspect` : "Map mode. WASD pans the overview. Press M for 3D.";
    return;
  }
  hintLine.textContent = node
    ? `Target: ${node.label} | E inspect${isEutherBooksNode(node) && roomMode === "city" ? " | F enter" : ""}`
    : navigationEnabled
      ? "WASD moves. Click Enter again for mouse look."
      : "Click Enter to take controls.";
}

function inspectFocusedNode(): void {
  if (!focusedNode) return;
  selectedNode = focusedNode;
  showNode(selectedNode);
  restartButton.disabled = !restartCommandForNode(selectedNode);
}

function showOverview(map: ServerMap): void {
  restartButton.disabled = true;
  updateControlsGuide(null);
  document.querySelector("#ev-target")!.textContent = "EutherVerse";
  detailPanel.innerHTML = `
    <div><strong>${map.nodes.length}</strong> nodes</div>
    <div><strong>${map.edges.length}</strong> links</div>
    <div><strong>${map.services.filter((service) => service.status === "running").length}</strong> running services</div>
    <div><strong>${map.listening_services.length || map.ports.length}</strong> observed ports</div>
  `;
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
  statusLine.textContent = `Restarting ${label}...`;
  const result = await jsonFetch<{ ok: boolean; stdout?: string; stderr?: string; error?: string }>("/api/admin/euthernet/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: command }),
  });
  if (!result.ok) {
    throw new Error(result.error || result.stderr || "restart failed");
  }
  statusLine.textContent = `Restarted ${label}: ${(result.stdout || "ok").trim()}`;
  await new Promise((resolve) => window.setTimeout(resolve, 900));
  await loadMap(false);
}

function restartCommandForNode(node: SceneNode): string | null {
  if (roomMode !== "city") return null;
  const service = serviceForNode(node);
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
  if (units.includes("eutherhost.service")) return "restart-eutherhost";
  if (units.includes("caddy.service")) return "restart-caddy";
  if (units.includes("eutherbooks.service")) return "restart-eutherbooks";
  if (units.includes("eutherpunkd.service")) return "restart-eutherpunkd";
  return null;
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
  if (node.id === "upload-intake") {
    lines.push(["Next", "Expose confirmed EutherBooks upload action here"]);
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

  const rows: Array<[string, string]> = [
    ["WASD", viewMode === "map" ? "Pan overview" : "Move"],
    ["Mouse", viewMode === "map" ? "Disabled in map" : "Look"],
    ["Scroll", viewMode === "map" ? "Zoom overview" : "Move closer/farther"],
    ["E", "Inspect target"],
    ["M", viewMode === "map" ? "Return to 3D" : "Map mode"],
    ["R", "Refresh inventory"],
  ];

  if (roomMode === "eutherbooks") {
    rows.push(["Esc", "Leave library"]);
    rows.push(["Button", "Leave Room"]);
    objective.textContent = node
      ? eutherBooksObjectiveFor(node)
      : "You are inside EutherBooks. Aim at a book, desk, booth or stats node and press E to inspect it. Use Leave Room or Esc to return to the server city.";
  } else {
    rows.push(["F", "Enter node when available"]);
    rows.push(["Esc", "Release cursor"]);
    objective.textContent = node
      ? cityObjectiveFor(node)
      : "Click Enter for mouse look. Walk to EutherBooks, aim at the green service block, then press F or click Enter Node to open the library room.";
  }

  controlsList.innerHTML = rows
    .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
}

function cityObjectiveFor(node: SceneNode): string {
  if (isEutherBooksNode(node)) {
    return "EutherBooks has an explorable room. Press F or click Enter Node to go into the library. Press E first if you want service details and restart controls.";
  }
  const restart = restartCommandForNode(node) ? " Restart is available after inspection." : "";
  return `Targeting ${node.label}. Press E to inspect status, ports, units and repo path.${restart}`;
}

function eutherBooksObjectiveFor(node: SceneNode): string {
  if (node.id.startsWith("book-")) {
    return "Book target. Press E to inspect metadata, conversion job status and available audio files.";
  }
  if (node.id === "qwen-desk") {
    return "Qwen Librarian desk. Press E to inspect the planned local chat station for book questions and library operations.";
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
  return `Targeting ${node.label}. Press E to inspect this library object.`;
}

function isEutherBooksNode(node: SceneNode): boolean {
  const value = `${node.id} ${node.label} ${node.detail || ""}`.toLowerCase();
  return value.includes("eutherbooks");
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
