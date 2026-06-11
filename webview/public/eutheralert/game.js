const params = new URLSearchParams(window.location.search);
const instanceId = params.get("instance") || "main";
const clientId = params.get("client") || "";
const playerSlot = Number(params.get("player") || "0");
const role = params.get("role") || "spectator";
const csrfToken = params.get("csrf") || "";

const canvas = document.querySelector("#battlefield");
const ctx = canvas.getContext("2d");
const minimap = document.querySelector("#minimap");
const mini = minimap.getContext("2d");
const roleLabel = document.querySelector("#role-label");
const selectionLabel = document.querySelector("#selection-label");
const orderLabel = document.querySelector("#order-label");
const creditsLabel = document.querySelector("#credits");
const powerLabel = document.querySelector("#power");
const unitsLabel = document.querySelector("#units");
const toast = document.querySelector("#toast");
const dockStatus = document.querySelector("#dock-status");

const world = { width: 2400, height: 1500 };
const tickRate = 30;
const tickSeconds = 1 / tickRate;
const commandDelayTicks = 12;
const localPlayer = playerSlot === 1 || playerSlot === 2 ? playerSlot : 1;
const canCommand = role === "player" && (playerSlot === 1 || playerSlot === 2);
const state = {
  time: 0,
  tick: 0,
  accumulator: 0,
  lastRemoteEvent: 0,
  initialSyncDone: false,
  localCommandSeq: 1,
  nextEntityId: 1,
  camera: { x: localPlayer === 1 ? 180 : 1100, y: localPlayer === 1 ? 160 : 620, zoom: 1 },
  selected: new Set(),
  pendingCommands: [],
  appliedCommands: new Set(),
  placing: null,
  attackMode: false,
  entities: [],
  particles: [],
  pointer: null,
  selectionBox: null,
};
let mapSeed = hashString(instanceId || "main");
const activePointers = new Map();
let pinchGesture = null;
let lastTap = { at: 0, x: 0, y: 0 };

const costs = {
  refinery: 900,
  barracks: 500,
  factory: 1200,
  power: 350,
  rifle: 120,
  tank: 700,
};

const unitStats = {
  rifle: { hp: 55, speed: 92, range: 150, damage: 9, cooldown: 0.75, radius: 10 },
  tank: { hp: 220, speed: 64, range: 210, damage: 34, cooldown: 1.45, radius: 17 },
  harvester: { hp: 150, speed: 58, range: 0, damage: 0, cooldown: 1, radius: 15, cargo: 700 },
};

const buildingStats = {
  conyard: { hp: 1400, w: 92, h: 78, power: 8 },
  refinery: { hp: 850, w: 86, h: 72, power: -4 },
  barracks: { hp: 620, w: 76, h: 64, power: -2 },
  factory: { hp: 980, w: 106, h: 76, power: -5 },
  power: { hp: 460, w: 66, h: 58, power: 16 },
};

function createEntity(entity) {
  const stats = entity.kind === "unit"
    ? unitStats[entity.type]
    : entity.kind === "building"
      ? buildingStats[entity.type]
      : null;
  const full = {
    id: state.nextEntityId++,
    hp: stats?.hp ?? entity.hp ?? 1,
    maxHp: stats?.hp ?? entity.maxHp ?? entity.hp ?? 1,
    target: null,
    order: null,
    cooldown: 0,
    cargo: 0,
    buildQueue: [],
    ...entity,
  };
  state.entities.push(full);
  return full;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededNoise(seed, index) {
  let value = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function seedBase(player, x, y) {
  createEntity({ kind: "building", player, type: "conyard", x, y });
  createEntity({ kind: "building", player, type: "power", x: x + 130, y: y + 12 });
  createEntity({ kind: "building", player, type: "refinery", x: x + 20, y: y + 112 });
  createEntity({ kind: "unit", player, type: "harvester", x: x + 148, y: y + 124 });
  for (let i = 0; i < 4; i += 1) {
    createEntity({ kind: "unit", player, type: "rifle", x: x - 70 + i * 22, y: y + 86 });
  }
  createEntity({ kind: "unit", player, type: "tank", x: x + 20, y: y - 72 });
}

function seedWorld() {
  seedBase(1, 310, 260);
  seedBase(2, 1840, 990);
  for (let i = 0; i < 20; i += 1) {
    createEntity({
      kind: "ore",
      player: 0,
      type: "ore",
      x: 720 + (i % 5) * 74 + seededNoise(mapSeed, i * 2) * 25,
      y: 430 + Math.floor(i / 5) * 62 + seededNoise(mapSeed, i * 2 + 1) * 22,
      amount: 520,
      hp: 1,
      maxHp: 1,
    });
  }
  for (let i = 0; i < 16; i += 1) {
    createEntity({
      kind: "ore",
      player: 0,
      type: "ore",
      x: 1340 + (i % 4) * 78 + seededNoise(mapSeed, 100 + i * 2) * 25,
      y: 740 + Math.floor(i / 4) * 66 + seededNoise(mapSeed, 101 + i * 2) * 22,
      amount: 520,
      hp: 1,
      maxHp: 1,
    });
  }
}

const playerState = {
  1: { credits: 2800 },
  2: { credits: 2800 },
};

function resetMatch(seed) {
  mapSeed = Number(seed) || hashString(instanceId || "main");
  state.time = 0;
  state.tick = 0;
  state.accumulator = 0;
  state.nextEntityId = 1;
  state.pendingCommands = [];
  state.appliedCommands = new Set();
  state.selected.clear();
  state.placing = null;
  state.attackMode = false;
  state.entities = [];
  state.particles = [];
  state.pointer = null;
  state.selectionBox = null;
  playerState[1].credits = 2800;
  playerState[2].credits = 2800;
  seedWorld();
  selectBase();
}

function showToast(message) {
  toast.textContent = message;
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: state.camera.x + (clientX - rect.left) * scaleX / state.camera.zoom,
    y: state.camera.y + (clientY - rect.top) * scaleY / state.camera.zoom,
  };
}

function entityAt(pos) {
  for (let i = state.entities.length - 1; i >= 0; i -= 1) {
    const entity = state.entities[i];
    if (entity.kind === "ore") continue;
    if (entity.kind === "building") {
      const spec = buildingStats[entity.type];
      if (pos.x >= entity.x && pos.y >= entity.y && pos.x <= entity.x + spec.w && pos.y <= entity.y + spec.h) {
        return entity;
      }
    } else {
      const radius = unitStats[entity.type].radius + 8;
      if (Math.hypot(entity.x - pos.x, entity.y - pos.y) <= radius) {
        return entity;
      }
    }
  }
  return null;
}

async function postCommand(kind, payload) {
  if (!canCommand) {
    showToast("Claim P1 or P2 in the vessel lobby first");
    return;
  }
  const commandPayload = {
    ...payload,
    seq: `${clientId || "local"}-${state.localCommandSeq++}`,
  };
  try {
    const response = await fetch(
      `/api/eutheralert/cmd?instance=${encodeURIComponent(instanceId)}&client=${encodeURIComponent(clientId)}`,
      {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ player: playerSlot, kind, payload: commandPayload }),
      },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const result = await response.json();
    scheduleCommand(result.event || { player: playerSlot, kind, payload: commandPayload });
  } catch {
    showToast("Command rejected by host");
  }
}

async function postTouch(kind, payload = {}) {
  if (!canCommand || !clientId) return;
  try {
    await fetch(
      `/api/eutheralert/touch?instance=${encodeURIComponent(instanceId)}&client=${encodeURIComponent(clientId)}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ player: playerSlot, kind, payload }),
      },
    );
  } catch {
    showToast("Touch bridge unavailable");
  }
}

async function pollEvents() {
  try {
    const response = await fetch(
      `/api/eutheralert/events?instance=${encodeURIComponent(instanceId)}&after=${state.lastRemoteEvent}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) return;
    const result = await response.json();
    state.lastRemoteEvent = result.lastEventId || state.lastRemoteEvent;
    for (const event of result.events || []) {
      scheduleCommand(event);
    }
    synchronizeToServerTick(Number(result.serverTick) || 0);
  } catch {
    // The local skirmish remains playable if the host is unavailable.
  }
}

async function loadSnapshot() {
  try {
    const response = await fetch(
      `/api/eutheralert/snapshot?instance=${encodeURIComponent(instanceId)}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const snapshot = await response.json();
    resetMatch(snapshot.seed);
    state.lastRemoteEvent = snapshot.lastEventId || 0;
    applySnapshotEvents(snapshot.events, snapshot.serverTick);
    showToast(canCommand ? "Commander synced" : "Spectator synced");
  } catch {
    resetMatch(mapSeed);
    showToast(canCommand ? "Commander online" : "Local skirmish mode");
  }
}

function applySnapshotEvents(events, serverTick) {
  for (const event of events || []) {
    scheduleCommand(event);
  }
  synchronizeToServerTick(Number(serverTick) || 0);
}

async function heartbeatSlot() {
  if (!canCommand || !clientId) return;
  try {
    await fetch(
      `/api/lobby/join?instance=${encodeURIComponent(instanceId)}&client=${encodeURIComponent(clientId)}&player=${playerSlot}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
  } catch {
    showToast("Player slot heartbeat failed");
  }
}

function synchronizeToServerTick(serverTick) {
  if (!serverTick) return;
  const targetTick = Math.max(0, serverTick - commandDelayTicks);
  if (!state.initialSyncDone || state.tick + tickRate * 2 < targetTick) {
    const maxCatchUp = state.initialSyncDone ? tickRate * 5 : tickRate * 60 * 8;
    const catchUpTarget = Math.min(targetTick, state.tick + maxCatchUp);
    while (state.tick < catchUpTarget) {
      stepSimulation();
    }
    state.accumulator = 0;
    state.initialSyncDone = true;
    return;
  }
  state.initialSyncDone = true;
}

function commandKey(event) {
  const payload = event.payload || {};
  return `${event.player}:${event.kind}:${payload.seq ?? event.id ?? 0}:${payload.tick ?? 0}`;
}

function scheduleCommand(event) {
  const payload = event.payload || {};
  const key = commandKey(event);
  if (state.appliedCommands.has(key) || state.pendingCommands.some((command) => command.key === key)) {
    return;
  }
  state.pendingCommands.push({
    key,
    player: event.player,
    kind: event.kind,
    payload,
    tick: Math.max(state.tick, Number(payload.tick) || state.tick),
  });
  state.pendingCommands.sort((a, b) => a.tick - b.tick || a.player - b.player || a.key.localeCompare(b.key));
}

function runDueCommands() {
  while (state.pendingCommands.length && state.pendingCommands[0].tick <= state.tick) {
    const command = state.pendingCommands.shift();
    if (state.appliedCommands.has(command.key)) continue;
    state.appliedCommands.add(command.key);
    applyCommand(command);
  }
  if (state.appliedCommands.size > 512) {
    state.appliedCommands = new Set([...state.appliedCommands].slice(-256));
  }
}

function applyCommand(event) {
  const player = event.player;
  const payload = event.payload || {};
  if (event.kind === "build") {
    buildStructure(player, payload.type, payload.x, payload.y);
  } else if (event.kind === "train") {
    trainUnit(player, payload.type);
  } else if (event.kind === "order") {
    issueOrder(player, payload.ids || [], payload.order || {});
  }
}

function affordable(player, type) {
  return (playerState[player]?.credits || 0) >= costs[type];
}

function spend(player, type) {
  if (!affordable(player, type)) return false;
  playerState[player].credits -= costs[type];
  return true;
}

function buildStructure(player, type, x, y) {
  if (!buildingStats[type] || !spend(player, type)) {
    showToast("Insufficient credits");
    return;
  }
  createEntity({ kind: "building", player, type, x: snap(x), y: snap(y) });
  showToast(`${type} deployed`);
}

function trainUnit(player, type) {
  if (!unitStats[type] || !spend(player, type)) {
    showToast("Insufficient credits");
    return;
  }
  const factoryType = type === "tank" ? "factory" : "barracks";
  const producer = state.entities.find((entity) => entity.kind === "building" && entity.player === player && entity.type === factoryType)
    || state.entities.find((entity) => entity.kind === "building" && entity.player === player && entity.type === "conyard");
  if (!producer) {
    showToast(`${factoryType} required`);
    playerState[player].credits += costs[type];
    return;
  }
  const spec = buildingStats[producer.type];
  const spawnNoise = seededNoise(mapSeed, state.tick + player * 1000 + state.nextEntityId * 17);
  createEntity({
    kind: "unit",
    player,
    type,
    x: producer.x + spec.w + 34,
    y: producer.y + spec.h / 2 + spawnNoise * 32 - 16,
  });
  showToast(`${type} ready`);
}

function issueOrder(player, ids, order) {
  for (const entity of state.entities) {
    if (!ids.includes(entity.id) || entity.player !== player || entity.kind !== "unit") continue;
    entity.order = order;
    entity.target = null;
  }
}

function snap(value) {
  return Math.round(value / 24) * 24;
}

function selectedUnits() {
  return state.entities.filter((entity) => state.selected.has(entity.id) && entity.kind === "unit" && entity.player === localPlayer);
}

function selectedIds() {
  return selectedUnits().map((entity) => entity.id);
}

function selectUnitsInScreenRect(box) {
  const left = Math.min(box.startX, box.x);
  const right = Math.max(box.startX, box.x);
  const top = Math.min(box.startY, box.y);
  const bottom = Math.max(box.startY, box.y);
  state.selected.clear();
  for (const entity of state.entities) {
    if (entity.kind !== "unit" || entity.player !== localPlayer) continue;
    const point = worldToScreen(centerOf(entity));
    if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
      state.selected.add(entity.id);
    }
  }
  showToast(state.selected.size ? `${state.selected.size} units selected` : "No units in box");
}

function selectOwn(entity, additive = false) {
  if (!additive) state.selected.clear();
  if (entity && entity.player === localPlayer) {
    state.selected.add(entity.id);
  }
}

function selectBase() {
  state.selected.clear();
  for (const entity of state.entities) {
    if (entity.player === localPlayer && entity.kind === "building") {
      state.selected.add(entity.id);
    }
  }
  showToast("Base selected");
}

function handleWorldTap(pos) {
  if (state.placing) {
    void postCommand("build", { type: state.placing, x: pos.x, y: pos.y });
    state.placing = null;
    return;
  }
  const hit = entityAt(pos);
  if (hit && hit.player === localPlayer) {
    selectOwn(hit);
    return;
  }
  const ids = selectedIds();
  if (!ids.length) return;
  if (hit && hit.player !== localPlayer) {
    void postCommand("order", { ids, order: { type: "attack", targetId: hit.id } });
  } else {
    void postCommand("order", { ids, order: { type: state.attackMode ? "attackMove" : "move", x: pos.x, y: pos.y } });
  }
}

function stepSimulation() {
  state.tick += 1;
  state.time = state.tick * tickSeconds;
  runDueCommands();
  for (const entity of state.entities) {
    if (entity.kind !== "unit") continue;
    entity.cooldown = Math.max(0, entity.cooldown - tickSeconds);
    updateUnit(entity, tickSeconds);
  }
  state.entities = state.entities.filter((entity) => entity.hp > 0 && (entity.kind !== "ore" || entity.amount > 0));
  state.particles = state.particles.filter((particle) => {
    particle.life -= tickSeconds;
    return particle.life > 0;
  });
  updateHud();
}

function updateUnit(unit, dt) {
  const stats = unitStats[unit.type];
  if (unit.type === "harvester") {
    updateHarvester(unit, dt);
    return;
  }
  const enemies = state.entities.filter((entity) => entity.player && entity.player !== unit.player && entity.kind !== "ore");
  let target = unit.target && state.entities.find((entity) => entity.id === unit.target && entity.hp > 0);
  if (!target && (unit.order?.type === "attack" || unit.order?.type === "attackMove")) {
    target = state.entities.find((entity) => entity.id === unit.order.targetId && entity.hp > 0) || nearest(unit, enemies, stats.range + 80);
  }
  if (!target && !unit.order) {
    target = nearest(unit, enemies, stats.range);
  }
  if (target && stats.damage > 0) {
    const point = centerOf(target);
    const distance = Math.hypot(point.x - unit.x, point.y - unit.y);
    if (distance <= stats.range) {
      unit.target = target.id;
      if (unit.cooldown <= 0) {
        target.hp -= stats.damage;
        unit.cooldown = stats.cooldown;
        state.particles.push({ x: point.x, y: point.y, life: 0.22, player: unit.player });
      }
      return;
    }
  }
  if (unit.order?.x !== undefined && unit.order?.y !== undefined) {
    moveToward(unit, unit.order.x, unit.order.y, stats.speed * dt);
    if (Math.hypot(unit.order.x - unit.x, unit.order.y - unit.y) < 14) {
      unit.order = unit.order.type === "attackMove" ? unit.order : null;
    }
  }
}

function updateHarvester(unit, dt) {
  const capacity = unitStats.harvester.cargo;
  const refinery = nearestOwnBuilding(unit.player, "refinery", unit) || nearestOwnBuilding(unit.player, "conyard", unit);
  if (!refinery) return;

  if (unit.cargo >= capacity) {
    unit.harvestTarget = null;
    unit.order = { type: "return", targetId: refinery.id };
  }

  if (unit.order?.type === "return") {
    const dock = centerOf(refinery);
    moveToward(unit, dock.x, dock.y, unitStats.harvester.speed * dt);
    if (Math.hypot(dock.x - unit.x, dock.y - unit.y) < 34) {
      playerState[unit.player].credits += unit.cargo;
      if (unit.cargo > 0) {
        state.particles.push({ x: dock.x, y: dock.y, life: 0.36, player: unit.player, kind: "deposit" });
      }
      unit.cargo = 0;
      unit.order = null;
    }
    return;
  }

  let ore = unit.harvestTarget && state.entities.find((entity) => entity.id === unit.harvestTarget && entity.kind === "ore" && entity.amount > 0);
  if (!ore) {
    ore = nearestOre(unit);
    unit.harvestTarget = ore?.id ?? null;
  }
  if (!ore) return;

  const distance = Math.hypot(ore.x - unit.x, ore.y - unit.y);
  if (distance > 22) {
    moveToward(unit, ore.x, ore.y, unitStats.harvester.speed * dt);
    return;
  }

  const mined = Math.min(ore.amount, capacity - unit.cargo, 140 * dt);
  ore.amount -= mined;
  unit.cargo += mined;
  if (state.tick % 8 === 0) {
    state.particles.push({ x: ore.x, y: ore.y, life: 0.18, player: unit.player, kind: "ore" });
  }
  if (unit.cargo >= capacity || ore.amount <= 0) {
    unit.order = { type: "return", targetId: refinery.id };
  }
}

function nearestOwnBuilding(player, type, origin) {
  return nearest(
    origin,
    state.entities.filter((entity) => entity.kind === "building" && entity.player === player && entity.type === type),
    Infinity,
  );
}

function nearestOre(origin) {
  return nearest(
    origin,
    state.entities.filter((entity) => entity.kind === "ore" && entity.amount > 0),
    Infinity,
  );
}

function nearest(origin, entities, maxDistance) {
  let best = null;
  let bestDistance = maxDistance;
  for (const entity of entities) {
    const point = centerOf(entity);
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    if (distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}

function centerOf(entity) {
  if (entity.kind === "building") {
    const spec = buildingStats[entity.type];
    return { x: entity.x + spec.w / 2, y: entity.y + spec.h / 2 };
  }
  return { x: entity.x, y: entity.y };
}

function worldToScreen(point) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((point.x - state.camera.x) * state.camera.zoom) / canvas.width * rect.width,
    y: rect.top + ((point.y - state.camera.y) * state.camera.zoom) / canvas.height * rect.height,
  };
}

function moveToward(unit, x, y, distance) {
  const dx = x - unit.x;
  const dy = y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length <= distance || length < 0.01) {
    unit.x = x;
    unit.y = y;
    return;
  }
  unit.x += (dx / length) * distance;
  unit.y += (dy / length) * distance;
}

function updateHud() {
  const mine = playerState[localPlayer];
  const power = state.entities
    .filter((entity) => entity.kind === "building" && entity.player === localPlayer)
    .reduce((total, entity) => total + buildingStats[entity.type].power, 0);
  const units = state.entities.filter((entity) => entity.kind === "unit" && entity.player === localPlayer).length;
  roleLabel.textContent = canCommand ? `P${playerSlot} Commander` : "Spectator";
  creditsLabel.textContent = Math.floor(mine.credits).toString();
  powerLabel.textContent = power.toString();
  unitsLabel.textContent = units.toString();
  selectionLabel.textContent = state.selected.size ? `${state.selected.size} selected` : "No selection";
  orderLabel.textContent = state.placing ? `Place ${state.placing}` : state.attackMode ? "Attack move" : `Tick ${state.tick}`;
  dockStatus.textContent = state.placing ? `Placing ${state.placing}` : state.attackMode ? "Attack move armed" : "Ready";
  updateButtonStates();
}

function updateButtonStates() {
  document.querySelector("#attack-move").classList.toggle("is-active", state.attackMode);
  document.querySelectorAll("[data-build]").forEach((button) => {
    button.classList.toggle("is-active", Boolean(state.placing && button.dataset.build === state.placing));
    button.disabled = !affordable(localPlayer, button.dataset.build);
  });
  document.querySelectorAll("[data-train]").forEach((button) => {
    button.disabled = !affordable(localPlayer, button.dataset.train);
  });
}

function draw() {
  resizeCanvas();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x, -state.camera.y);
  drawTerrain();
  for (const entity of state.entities) drawEntity(entity);
  for (const particle of state.particles) drawParticle(particle);
  if (state.placing) drawPlacement();
  ctx.restore();
  drawSelectionBox();
  drawMinimap();
}

function drawTerrain() {
  ctx.fillStyle = "#14170f";
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.strokeStyle = "rgba(233, 211, 133, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < world.width; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, world.height);
    ctx.stroke();
  }
  for (let y = 0; y < world.height; y += 96) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(world.width, y);
    ctx.stroke();
  }
  ctx.fillStyle = "#252117";
  ctx.fillRect(1040, 0, 210, world.height);
  ctx.fillStyle = "#0f1b16";
  ctx.fillRect(0, 650, world.width, 78);
}

function drawEntity(entity) {
  if (entity.kind === "ore") {
    ctx.fillStyle = "#c2a33e";
    ctx.fillRect(entity.x - 18, entity.y - 11, 36, 22);
    return;
  }
  const mine = entity.player === localPlayer;
  const color = entity.player === 1 ? "#d84434" : "#d6bd59";
  const stroke = mine ? "#c9f07b" : "#2b1411";
  if (entity.kind === "building") {
    const spec = buildingStats[entity.type];
    ctx.fillStyle = entity.type === "power" ? "#47564a" : color;
    ctx.fillRect(entity.x, entity.y, spec.w, spec.h);
    ctx.strokeStyle = state.selected.has(entity.id) ? "#c9f07b" : stroke;
    ctx.lineWidth = state.selected.has(entity.id) ? 4 : 2;
    ctx.strokeRect(entity.x, entity.y, spec.w, spec.h);
    ctx.fillStyle = "rgba(0,0,0,0.36)";
    ctx.fillRect(entity.x + 8, entity.y + 10, spec.w - 16, 8);
  } else {
    const spec = unitStats[entity.type];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(entity.x, entity.y, spec.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = state.selected.has(entity.id) ? "#c9f07b" : "#0b0d0a";
    ctx.lineWidth = state.selected.has(entity.id) ? 4 : 2;
    ctx.stroke();
    if (entity.type === "tank") {
      ctx.strokeStyle = "#19130d";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(entity.x, entity.y);
      ctx.lineTo(entity.x + 24, entity.y - 8);
      ctx.stroke();
    }
  }
  drawHealth(entity);
}

function drawHealth(entity) {
  const point = centerOf(entity);
  const width = entity.kind === "building" ? 54 : 30;
  const y = point.y - (entity.kind === "building" ? 48 : 28);
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fillRect(point.x - width / 2, y, width, 5);
  ctx.fillStyle = entity.hp / entity.maxHp > 0.45 ? "#8fe077" : "#ff5040";
  ctx.fillRect(point.x - width / 2, y, width * Math.max(0, entity.hp / entity.maxHp), 5);
}

function drawParticle(particle) {
  ctx.fillStyle = particle.player === 1 ? "rgba(255, 95, 72, 0.8)" : "rgba(255, 224, 93, 0.8)";
  ctx.beginPath();
  ctx.arc(particle.x, particle.y, 18 * particle.life, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlacement() {
  const pos = state.pointer ? screenToWorld(state.pointer.x, state.pointer.y) : {
    x: state.camera.x + canvas.width / 2,
    y: state.camera.y + canvas.height / 2,
  };
  const spec = buildingStats[state.placing];
  ctx.fillStyle = "rgba(143, 224, 119, 0.25)";
  ctx.strokeStyle = "#8fe077";
  ctx.fillRect(snap(pos.x), snap(pos.y), spec.w, spec.h);
  ctx.strokeRect(snap(pos.x), snap(pos.y), spec.w, spec.h);
}

function drawSelectionBox() {
  if (!state.selectionBox) return;
  const rect = canvas.getBoundingClientRect();
  const dprX = canvas.width / rect.width;
  const dprY = canvas.height / rect.height;
  const left = (Math.min(state.selectionBox.startX, state.selectionBox.x) - rect.left) * dprX;
  const top = (Math.min(state.selectionBox.startY, state.selectionBox.y) - rect.top) * dprY;
  const width = Math.abs(state.selectionBox.x - state.selectionBox.startX) * dprX;
  const height = Math.abs(state.selectionBox.y - state.selectionBox.startY) * dprY;
  ctx.save();
  ctx.fillStyle = "rgba(143, 224, 119, 0.14)";
  ctx.strokeStyle = "#c9f07b";
  ctx.lineWidth = 2;
  ctx.fillRect(left, top, width, height);
  ctx.strokeRect(left, top, width, height);
  ctx.restore();
}

function drawMinimap() {
  mini.clearRect(0, 0, minimap.width, minimap.height);
  mini.fillStyle = "#11170f";
  mini.fillRect(0, 0, minimap.width, minimap.height);
  for (const entity of state.entities) {
    if (entity.kind === "ore") {
      mini.fillStyle = "#c2a33e";
    } else {
      mini.fillStyle = entity.player === 1 ? "#d84434" : "#d6bd59";
    }
    const point = centerOf(entity);
    mini.fillRect(point.x / world.width * minimap.width, point.y / world.height * minimap.height, 3, 3);
  }
  mini.strokeStyle = "#c9f07b";
  mini.strokeRect(
    state.camera.x / world.width * minimap.width,
    state.camera.y / world.height * minimap.height,
    canvas.width / state.camera.zoom / world.width * minimap.width,
    canvas.height / state.camera.zoom / world.height * minimap.height,
  );
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const nextWidth = Math.max(640, Math.floor(rect.width * dpr));
  const nextHeight = Math.max(360, Math.floor(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
}

canvas.addEventListener("pointerdown", (event) => {
  const point = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    startedAt: performance.now(),
    pointerType: event.pointerType || "unknown",
  };
  activePointers.set(event.pointerId, point);
  canvas.setPointerCapture(event.pointerId);
  if (activePointers.size === 1) {
    state.pointer = { ...point, mode: "pending" };
  } else if (activePointers.size === 2) {
    beginPinchGesture();
  }
});

canvas.addEventListener("pointermove", (event) => {
  const point = activePointers.get(event.pointerId);
  if (!point) return;
  const dx = event.clientX - point.x;
  const dy = event.clientY - point.y;
  point.x = event.clientX;
  point.y = event.clientY;
  if (activePointers.size >= 2) {
    updatePinchGesture(event);
    return;
  }
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;
  const moved = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY);
  const heldMs = performance.now() - state.pointer.startedAt;
  if (state.pointer.mode === "pending" && moved > 8) {
    state.pointer.mode = heldMs > 180 && !state.placing ? "select" : "pan";
    void postTouch("dragStart", touchPayload(event, { mode: state.pointer.mode }));
    if (state.pointer.mode === "select") {
      state.selectionBox = {
        startX: state.pointer.startX,
        startY: state.pointer.startY,
        x: event.clientX,
        y: event.clientY,
      };
    }
  }
  if (state.pointer.mode === "select" && state.selectionBox) {
    state.selectionBox.x = event.clientX;
    state.selectionBox.y = event.clientY;
    void postTouch("dragMove", touchPayload(event, { mode: "select" }));
    return;
  }
  if (state.pointer.mode === "pan") {
    void postTouch("dragMove", touchPayload(event, { mode: "pan", dx, dy }));
    panCamera(dx, dy);
  }
});

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);

function finishPointer(event) {
  const point = activePointers.get(event.pointerId);
  activePointers.delete(event.pointerId);
  if (pinchGesture) {
    void postTouch("dragEnd", touchPayload(event, { mode: "pinch" }));
    pinchGesture = null;
    state.pointer = null;
    state.selectionBox = null;
    return;
  }
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  const moved = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY);
  if (state.pointer.mode === "select" && state.selectionBox) {
    void postTouch("dragEnd", touchPayload(event, { mode: "select" }));
    selectUnitsInScreenRect(state.selectionBox);
  } else if (moved <= 8) {
    const now = performance.now();
    const doubleTap = now - lastTap.at < 320 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30;
    void postTouch(doubleTap ? "doubleTap" : "tap", touchPayload(event, { tapCount: doubleTap ? 2 : 1 }));
    handleWorldTap(screenToWorld(event.clientX, event.clientY));
    lastTap = { at: now, x: event.clientX, y: event.clientY };
  } else if (state.pointer.mode === "pan") {
    void postTouch("dragEnd", touchPayload(event, { mode: "pan" }));
  }
  state.pointer = activePointers.size === 1 && point ? null : null;
  state.selectionBox = null;
}

function beginPinchGesture() {
  const points = [...activePointers.values()].slice(0, 2);
  const center = pointerCenter(points);
  pinchGesture = {
    distance: pointerDistance(points),
    center,
    cameraX: state.camera.x,
    cameraY: state.camera.y,
    zoom: state.camera.zoom,
    worldCenter: screenToWorld(center.x, center.y),
  };
  state.pointer = null;
  state.selectionBox = null;
}

function updatePinchGesture(event) {
  if (!pinchGesture || activePointers.size < 2) {
    beginPinchGesture();
    return;
  }
  const points = [...activePointers.values()].slice(0, 2);
  const center = pointerCenter(points);
  const distance = pointerDistance(points);
  const nextZoom = clamp(pinchGesture.zoom * distance / Math.max(1, pinchGesture.distance), 0.72, 1.85);
  state.camera.zoom = nextZoom;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  state.camera.x = pinchGesture.worldCenter.x - (center.x - rect.left) * scaleX / nextZoom;
  state.camera.y = pinchGesture.worldCenter.y - (center.y - rect.top) * scaleY / nextZoom;
  clampCamera();
  void postTouch("pinch", touchPayload(event, {
    mode: "pinch",
    scale: nextZoom / pinchGesture.zoom,
    x2: points[1].x - rect.left,
    y2: points[1].y - rect.top,
  }));
}

function pointerCenter(points) {
  return {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };
}

function pointerDistance(points) {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function panCamera(dx, dy) {
  state.camera.x -= dx / state.camera.zoom;
  state.camera.y -= dy / state.camera.zoom;
  clampCamera();
}

function clampCamera() {
  state.camera.x = clamp(state.camera.x, 0, Math.max(0, world.width - canvas.width / state.camera.zoom));
  state.camera.y = clamp(state.camera.y, 0, Math.max(0, world.height - canvas.height / state.camera.zoom));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function touchPayload(event, extra = {}) {
  const rect = canvas.getBoundingClientRect();
  const worldPos = screenToWorld(event.clientX, event.clientY);
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    normalizedX: (event.clientX - rect.left) / Math.max(1, rect.width),
    normalizedY: (event.clientY - rect.top) / Math.max(1, rect.height),
    worldX: worldPos.x,
    worldY: worldPos.y,
    pointer: event.pointerType || "unknown",
    ...extra,
  };
}

minimap.addEventListener("pointerdown", (event) => {
  const rect = minimap.getBoundingClientRect();
  state.camera.x = (event.clientX - rect.left) / rect.width * world.width - canvas.width / (2 * state.camera.zoom);
  state.camera.y = (event.clientY - rect.top) / rect.height * world.height - canvas.height / (2 * state.camera.zoom);
  clampCamera();
  void postTouch("tap", {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    normalizedX: (event.clientX - rect.left) / Math.max(1, rect.width),
    normalizedY: (event.clientY - rect.top) / Math.max(1, rect.height),
    mode: "minimap",
    pointer: event.pointerType || "unknown",
  });
});

document.querySelectorAll("[data-build]").forEach((button) => {
  button.addEventListener("click", () => {
    const type = button.dataset.build;
    if (!affordable(localPlayer, type)) {
      showToast("Insufficient credits");
      return;
    }
    state.placing = type;
    state.attackMode = false;
    updateButtonStates();
    showToast(`Tap map to place ${type}`);
  });
});

document.querySelectorAll("[data-train]").forEach((button) => {
  button.addEventListener("click", () => {
    void postCommand("train", { type: button.dataset.train });
  });
});

document.querySelector("#select-base").addEventListener("click", () => {
  void postTouch("key", { key: "selectBase" });
  selectBase();
});
document.querySelector("#attack-move").addEventListener("click", () => {
  state.attackMode = !state.attackMode;
  state.placing = null;
  document.querySelector("#attack-move").classList.toggle("is-active", state.attackMode);
  void postTouch("key", { key: "attackMove", active: state.attackMode });
});
document.querySelector("#hold-position").addEventListener("click", () => {
  const ids = selectedIds();
  void postTouch("key", { key: "hold" });
  void postCommand("order", { ids, order: { type: "hold" } });
});
document.querySelector("#center-action").addEventListener("click", () => {
  const selected = selectedUnits()[0] || state.entities.find((entity) => entity.player === localPlayer && entity.kind === "building");
  if (!selected) return;
  void postTouch("key", { key: "focus" });
  const point = centerOf(selected);
  state.camera.x = Math.max(0, point.x - canvas.width / 2);
  state.camera.y = Math.max(0, point.y - canvas.height / 2);
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  state.accumulator += dt;
  while (state.accumulator >= tickSeconds) {
    stepSimulation();
    state.accumulator -= tickSeconds;
  }
  draw();
  requestAnimationFrame(frame);
}

async function start() {
  await loadSnapshot();
  setInterval(pollEvents, 400);
  setInterval(heartbeatSlot, 4000);
  void heartbeatSlot();
  last = performance.now();
  requestAnimationFrame(frame);
}

void start();
