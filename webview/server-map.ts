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
          <dl>
            <div><dt>WASD</dt><dd>Move</dd></div>
            <div><dt>Mouse</dt><dd>Look</dd></div>
            <div><dt>E</dt><dd>Inspect</dd></div>
            <div><dt>R</dt><dd>Refresh inventory</dd></div>
            <div><dt>Esc</dt><dd>Release cursor</dd></div>
          </dl>
        </section>
        <section>
          <p class="eyebrow">Actions</p>
          <button id="ev-action-health" type="button">Health Check</button>
          <button id="ev-action-restart" type="button" disabled>Restart Service</button>
          <small>Write actions are locked until EutherNet exposes an explicit restart allowlist.</small>
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
    .ev-topbar button, .ev-topbar a, #ev-panel button { border: 1px solid rgba(103,225,218,.38); border-radius: 6px; background: rgba(10,22,30,.82); color: #effcff; padding: 8px 11px; text-decoration: none; cursor: pointer; }
    .ev-topbar button:hover, .ev-topbar a:hover, #ev-panel button:hover:not(:disabled) { background: rgba(40,128,133,.72); }
    #ev-panel { position: fixed; top: 78px; right: 14px; bottom: 54px; z-index: 2; width: min(360px, calc(100vw - 28px)); overflow: auto; border: 1px solid rgba(103,225,218,.28); border-radius: 8px; background: rgba(5,10,16,.78); backdrop-filter: blur(16px); padding: 13px; box-shadow: 0 18px 80px rgba(0,0,0,.45); }
    #ev-panel h2 { margin: 4px 0 10px; font-size: 18px; }
    #ev-panel section { border-bottom: 1px solid rgba(110,142,160,.22); padding: 0 0 12px; margin: 0 0 12px; }
    #ev-panel section:last-child { border-bottom: 0; }
    #ev-detail { display: grid; gap: 7px; color: #b7c8d4; font-size: 13px; overflow-wrap: anywhere; }
    #ev-detail strong { color: #fff; }
    #ev-panel dl { display: grid; gap: 7px; margin: 8px 0 0; }
    #ev-panel dl div { display: grid; grid-template-columns: 64px 1fr; gap: 8px; color: #b7c8d4; font-size: 13px; }
    #ev-panel dt { color: #f4cf78; font-weight: 900; }
    #ev-panel dd { margin: 0; }
    #ev-panel button { width: 100%; margin: 6px 0; text-align: left; }
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
  document.querySelector("#ev-enter")?.addEventListener("click", () => controls.lock());
  document.querySelector("#ev-refresh")?.addEventListener("click", () => loadMap(true).catch(showError));
  document.querySelector("#ev-action-health")?.addEventListener("click", () => loadMap(true).catch(showError));
  document.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.code === "KeyE") inspectFocusedNode();
    if (event.code === "KeyR") void loadMap(true).catch(showError);
  });
  document.addEventListener("keyup", (event) => keys.delete(event.code));
  controls.addEventListener("lock", () => {
    hintLine.textContent = "Aim at a district and press E.";
  });
  controls.addEventListener("unlock", () => {
    hintLine.textContent = "Click Enter to take controls.";
  });
}

async function loadMap(refresh: boolean): Promise<void> {
  statusLine.textContent = refresh ? "Refreshing EutherNet inventory..." : "Loading EutherNet map...";
  if (refresh) {
    await jsonFetch("/api/admin/euthernet/refresh", { method: "POST", body: "{}" });
  }
  serverMap = await jsonFetch<ServerMap>("/api/admin/euthernet/map");
  buildCity(serverMap);
  statusLine.textContent = `Snapshot ${serverMap.collected_at} | ${serverMap.nodes.length} nodes | ${serverMap.edges.length} links`;
}

function buildCity(map: ServerMap): void {
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
  if (!controls.isLocked) return;
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

function updateFocus(): void {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cityRoot.children, true);
  const hit = hits.find((item) => nodeIdForObject(item.object));
  const node = hit ? sceneNodes.get(nodeIdForObject(hit.object)!) || null : null;
  if (node === focusedNode) return;
  focusedNode = node;
  crosshair.style.opacity = node ? "1" : ".45";
  hintLine.textContent = node ? `Target: ${node.label} | E inspect` : controls.isLocked ? "Aim at a district and press E." : "Click Enter to take controls.";
}

function inspectFocusedNode(): void {
  if (!focusedNode) return;
  selectedNode = focusedNode;
  showNode(selectedNode);
}

function showOverview(map: ServerMap): void {
  document.querySelector("#ev-target")!.textContent = "EutherVerse";
  detailPanel.innerHTML = `
    <div><strong>${map.nodes.length}</strong> nodes</div>
    <div><strong>${map.edges.length}</strong> links</div>
    <div><strong>${map.services.filter((service) => service.status === "running").length}</strong> running services</div>
    <div><strong>${map.listening_services.length || map.ports.length}</strong> observed ports</div>
  `;
}

function showNode(node: SceneNode): void {
  document.querySelector("#ev-target")!.textContent = node.label || node.id;
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
