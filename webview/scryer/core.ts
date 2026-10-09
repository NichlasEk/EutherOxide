export type Point = { x: number; z: number };
export type Phase =
  | "wandering"
  | "observing"
  | "investigating"
  | "contemplating"
  | "conversing"
  | "discovery";
export type Node = Point & { id: string; type: string; status: string };
export type Edge = { from: string; to: string; type: string };
export type World = {
  stamp: string;
  nodes: Node[];
  edges: Edge[];
  obstacles: Point[];
};
export type Observation = {
  id: string;
  node: string;
  stamp: string;
  status: string;
  at: number;
  kind: "verified fact";
  source: "EutherNet inventory";
  outcome: "inspected" | "nothing interesting";
  hosted: string[];
  dependents?: string[];
};
export type Ghost = {
  id: string;
  kind: "hypothesis";
  pattern?: "shared-host" | "shared-dependency" | "status-changes";
  history?: Observation[];
  review?: { saved: boolean; outcome: "untested" | "supported" | "not-supported" | "inconclusive"; note: string; at: number };
  support: Observation;
  node: string;
  links: string[];
  evidence: string[];
  description: string;
  assumptions: string;
  uncertainty: string;
  benefit: string;
  risks: string;
  test: string;
  status: "active" | "dismissed" | "archived";
  at: number;
};
export type State = {
  version: 1;
  position: Point;
  phase: Phase;
  destination: string | null;
  paused: boolean;
  disabled: boolean;
  nextAt: number;
  cursor: number;
  observations: Observation[];
  ghosts: Ghost[];
  statuses: Record<string, string>;
  stamp: string;
  lastModelAt: number;
  queued: string[];
  visited: string[];
};
const kinds = new Set(["host", "service", "storage", "proxy", "ai"]);
const statuses = new Set([
  "online",
  "running",
  "healthy",
  "failed",
  "degraded",
  "offline",
  "unknown",
  "configured",
  "connected",
  "observed",
  "reachable",
  "managed",
  "planned",
]);
const idOK = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_.-]{1,80}$/.test(v) &&
  !v.startsWith("scryer:");
const pointOK = (v: any): v is Point =>
  v &&
  Number.isFinite(v.x) &&
  Number.isFinite(v.z) &&
  Math.abs(v.x) <= 160 &&
  Math.abs(v.z) <= 160;
export function project(raw: any, positions: Map<string, Point>): World {
  if (
    !raw ||
    !Array.isArray(raw.nodes) ||
    !Array.isArray(raw.edges) ||
    raw.nodes.length > 2000 ||
    raw.edges.length > 8000
  )
    throw Error("Invalid topology");
  const stamp =
    typeof raw.collected_at === "string" &&
    Number.isFinite(Date.parse(raw.collected_at))
      ? new Date(raw.collected_at).toISOString()
      : "";
  if (!stamp) throw Error("Inventory timestamp missing");
  const nodes: Node[] = [],
    obstacles: Point[] = [];
  for (const n of raw.nodes) {
    const p = positions.get(n.id);
    if (!pointOK(p)) continue;
    obstacles.push({ x: p.x, z: p.z });
    if (!idOK(n.id) || !kinds.has(n.type) || nodes.some((v) => v.id === n.id))
      continue;
    nodes.push({
      id: n.id,
      type: n.type,
      status: statuses.has(n.status) ? n.status : "unknown",
      x: p.x,
      z: p.z,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = raw.edges
    .filter(
      (e: any) =>
        ids.has(e.from) &&
        ids.has(e.to) &&
        ["hosts", "dependency", "proxy", "ai", "state", "access"].includes(
          e.type,
        ),
    )
    .map((e: any) => ({ from: e.from, to: e.to, type: e.type }));
  return { stamp, nodes, edges, obstacles };
}
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export function clear(p: Point, obstacles: Point[]): boolean {
  return pointOK(p) && obstacles.every((o) => distance(p, o) >= 4.5);
}
// Bounded 2-unit grid BFS. Clearance includes body radius and the largest host.
// Only cardinal steps: no diagonal corner cutting through infrastructure.
export function route(
  start: Point,
  target: Point,
  obstacles: Point[],
): Point[] {
  const snap = (v: number) => Math.round(v / 2) * 2;
  const origin = { x: snap(start.x), z: snap(start.z) };
  if (!clear(origin, obstacles) || !clear(start, obstacles)) return [];
  const segmentClear = (a: Point, b: Point) =>
    [0.25, 0.5, 0.75, 1].every((t) =>
      clear({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, obstacles),
    );
  if (!segmentClear(start, origin)) return [];
  const key = (p: Point) => `${p.x},${p.z}`;
  const queue = [origin],
    parents = new Map<string, Point | null>([[key(origin), null]]);
  for (let i = 0; i < queue.length && i < 26000; i++) {
    const p = queue[i];
    if (distance(p, target) >= 4.5 && distance(p, target) <= 7) {
      const path: Point[] = [p];
      let prev = parents.get(key(p));
      while (prev) {
        path.push(prev);
        prev = parents.get(key(prev));
      }
      return path.reverse();
    }
    for (const [dx, dz] of [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ]) {
      const next = { x: p.x + dx, z: p.z + dz };
      if (
        parents.has(key(next)) ||
        !clear(next, obstacles) ||
        !segmentClear(p, next)
      )
        continue;
      parents.set(key(next), p);
      queue.push(next);
    }
  }
  return [];
}
export function initial(): State {
  return {
    version: 1,
    position: { x: 0, z: 58 },
    phase: "contemplating",
    destination: null,
    paused: false,
    disabled: false,
    nextAt: 0,
    cursor: 0,
    observations: [],
    ghosts: [],
    statuses: {},
    stamp: "",
    lastModelAt: 0,
    queued: [],
    visited: [],
  };
}
export class Scryer {
  state = initial();
  world: World = { stamp: "", nodes: [], edges: [], obstacles: [] };
  path: Point[] = [];
  authorized = false;
  get pending() {
    return this.state.queued;
  }
  set pending(value: string[]) {
    this.state.queued = value;
  }
  authorize(ok: boolean) {
    this.authorized = ok;
    if (!ok) {
      this.path = [];
      this.pending = [];
      this.world = { stamp: "", nodes: [], edges: [], obstacles: [] };
      this.state = initial();
    }
  }
  ingest(world: World, now: number) {
    if (!this.authorized) throw Error("Server Map permission required");
    if (
      this.state.stamp &&
      Date.parse(world.stamp) < Date.parse(this.state.stamp)
    )
      return;
    if (world.stamp !== this.state.stamp) this.state.visited = [];
    this.world = world;
    this.pending = this.pending.filter((id) =>
      world.nodes.some((n) => n.id === id),
    );
    for (const n of world.nodes) {
      const old = this.state.statuses[n.id];
      if (old && old !== n.status && !this.pending.includes(n.id))
        this.pending.push(n.id);
    }
    this.pending = this.pending.slice(-32);
    this.state.statuses = Object.fromEntries(
      world.nodes.map((n) => [n.id, n.status]),
    );
    this.state.stamp = world.stamp;
    if (!clear(this.state.position, world.obstacles)) {
      // Deterministic recovery to a clear city boundary, never inside a node.
      const candidates = Array.from({ length: 159 }, (_, i) => ({
        x: -158,
        z: -158 + i * 2,
      }));
      const safe = candidates.find((p) => clear(p, world.obstacles));
      if (!safe) {
        this.state.paused = true;
        return;
      }
      this.state.position = safe;
    }
    const target = world.nodes.find((n) => n.id === this.state.destination);
    this.path = target
      ? route(this.state.position, target, world.obstacles)
      : [];
    if (this.state.destination && (!target || !this.path.length)) {
      this.state.destination = null;
      this.state.phase = "contemplating";
      this.state.nextAt = now;
    }
    for (const g of this.state.ghosts)
      if (
        g.status === "active" &&
        (g.links.some((id) => !world.nodes.some((n) => n.id === id)) ||
          g.links
            .filter((id) => id !== g.node)
            .some(
              (id) =>
                !world.edges.some(
                  (e) => e.type === "hosts" && e.from === g.node && e.to === id,
                ),
            ))
      )
        g.status = "archived";
  }
  tick(dt: number, now: number) {
    const s = this.state;
    if (
      !this.authorized ||
      s.paused ||
      s.disabled ||
      s.phase === "conversing" ||
      !this.world.nodes.length
    )
      return;
    // Inventory is not live telemetry. Do not keep investigating stale data.
    if (now - Date.parse(this.world.stamp) > 24 * 3600_000) {
      s.phase = "contemplating";
      return;
    }
    if (this.path.length) {
      const p = this.path[0],
        d = distance(s.position, p),
        step = Math.min(Math.max(dt, 0), 0.1) * 4;
      if (d <= step) {
        s.position = { ...p };
        this.path.shift();
      } else {
        s.position.x += ((p.x - s.position.x) * step) / d;
        s.position.z += ((p.z - s.position.z) * step) / d;
      }
      if (!this.path.length) {
        s.phase = "observing";
        s.nextAt = now + 4000;
      }
      return;
    }
    if (now < s.nextAt) return;
    if (s.destination) {
      this.inspect(s.destination, now);
      s.destination = null;
      s.nextAt = now + 60_000;
      return;
    }
    const ordered = [
      ...this.pending,
      ...this.world.nodes.slice(s.cursor).map((n) => n.id),
      ...this.world.nodes.slice(0, s.cursor).map((n) => n.id),
    ];
    for (const id of ordered.slice(0, 32)) {
      const target = this.world.nodes.find((n) => n.id === id)!;
      const path = route(s.position, target, this.world.obstacles);
      if (!path.length) continue;
      s.destination = id;
      s.phase = this.pending.includes(id) ? "investigating" : "wandering";
      this.pending = this.pending.filter((v) => v !== id);
      this.path = path;
      s.cursor =
        (this.world.nodes.indexOf(target) + 1) % this.world.nodes.length;
      return;
    }
    s.cursor = (s.cursor + 32) % this.world.nodes.length;
    s.phase = "contemplating";
    s.nextAt = now + 60_000;
  }
  inspect(id: string, now: number) {
    const n = this.world.nodes.find((n) => n.id === id);
    if (!n || !this.authorized || distance(n, this.state.position) > 7.1)
      return;
    const s = this.state,
      oid = `${this.world.stamp}/${id}/${n.status}`;
    if (s.visited.includes(id)) {
      s.phase = "contemplating";
      return;
    }
    const children = this.world.edges
      .filter((e) => e.type === "hosts" && e.from === id)
      .map((e) => e.to)
      .sort();
    const links = [...new Set(children)].slice(0, 12);
    const interesting = links.length >= 2;
    s.observations.push({
      id: oid,
      node: id,
      stamp: this.world.stamp,
      status: n.status,
      at: now,
      kind: "verified fact",
      source: "EutherNet inventory",
      outcome: interesting ? "inspected" : "nothing interesting",
      hosted: links,
    });
    s.visited.push(id);
    s.observations = s.observations.slice(-64);
    const gid = `shared-host/${id}/${links.join(",")}`;
    if (interesting && !s.ghosts.some((g) => g.id === gid)) {
      s.ghosts.push({
        id: gid,
        kind: "hypothesis",
        support: { ...s.observations.at(-1)!, hosted: [...links] },
        node: id,
        links: [id, ...links],
        evidence: [oid],
        description: `What if the services mapped to ${id} had independently tested recovery paths?`,
        assumptions:
          "Inventory hosts edges describe actual placement. Co-location does not establish shared backup or recovery dependencies.",
        uncertainty:
          "Unknown: recovery isolation, restore success, redundancy and failure probability. Inference: co-location may create correlated downtime.",
        benefit:
          "A documented recovery exercise could reveal missing independent recovery paths.",
        risks:
          "A real restore exercise may consume resources or interrupt service; requires a separate owner-approved plan.",
        test: "First compare documented recovery locations for the linked services. Scryer has not performed a restore or read backup contents.",
        status: "active",
        at: now,
      });
      s.ghosts = s.ghosts.slice(-24);
      s.phase = "discovery";
    } else s.phase = "contemplating";
  }
  discuss(question: string): string {
    if (!this.authorized) return "Observation access unavailable.";
    const g = this.state.ghosts.filter((g) => g.status === "active").at(-1);
    if (/restart|deploy|execute|sudo|delete|starta om/i.test(question))
      return "I can observe and suggest. I have no execution capability.";
    const o = this.state.observations.at(-1);
    return [
      this.state.destination
        ? `I am approaching ${this.state.destination}.`
        : "I am considering the available inventory.",
      o
        ? `Verified inventory fact (${o.stamp}): ${o.node} was reported ${o.status}. This is not a fresh health check.`
        : "I have not completed an observation yet.",
      g
        ? `Hypothesis: ${g.description}\n${g.uncertainty}\nSuggested test: ${g.test}`
        : "I have no grounded hypothesis to offer yet. Silence is useful too.",
    ].join("\n\n");
  }
  serialize() {
    return JSON.stringify(this.state);
  }
  restore(raw: string, now: number): boolean {
    if (!this.authorized || raw.length > 128_000) return false;
    try {
      const s = JSON.parse(raw) as State;
      if (
        s.version !== 1 ||
        !Array.isArray(s.queued) ||
        s.queued.length > 32 ||
        !s.queued.every(idOK) ||
        !Array.isArray(s.visited) ||
        s.visited.length > 2000 ||
        !s.visited.every(idOK) ||
        !pointOK(s.position) ||
        !Array.isArray(s.observations) ||
        s.observations.length > 64 ||
        !Array.isArray(s.ghosts) ||
        s.ghosts.length > 24 ||
        !Number.isFinite(s.nextAt) ||
        !Number.isFinite(s.cursor) ||
        !Number.isFinite(s.lastModelAt) ||
        !s.statuses ||
        Object.keys(s.statuses).length > 2000
      )
        return false;
      const validObservation = (o: Observation) =>
        o &&
        idOK(o.node) &&
        Array.isArray(o.hosted) &&
        o.hosted.length <= 12 &&
        o.hosted.every(idOK) &&
        (o.dependents === undefined || (Array.isArray(o.dependents) && o.dependents.length <= 12 && o.dependents.every(idOK))) &&
        o.kind === "verified fact" &&
        o.source === "EutherNet inventory" &&
        statuses.has(o.status) &&
        Number.isFinite(o.at) &&
        Number.isFinite(Date.parse(o.stamp)) &&
        o.id === `${o.stamp}/${o.node}/${o.status}`;
      const copyObservation = (o: Observation): Observation => ({
        id: o.id,
        node: o.node,
        stamp: o.stamp,
        status: o.status,
        at: o.at,
        kind: o.kind,
        source: o.source,
        hosted: [...o.hosted],
        ...(o.dependents ? {dependents: [...o.dependents]} : {}),
        outcome:
          o.outcome === "inspected" ? "inspected" : "nothing interesting",
      });
      if (!s.observations.every(validObservation)) return false;
      if (
        s.ghosts.some(
          (g) =>
            g.kind !== "hypothesis" ||
            (g.pattern !== undefined && !["shared-host", "shared-dependency", "status-changes"].includes(g.pattern)) ||
            (g.history !== undefined && (!Array.isArray(g.history) || g.history.length > 4 || !g.history.every(validObservation))) ||
            (g.review !== undefined && (!g.review || typeof g.review.note !== "string" || g.review.note.length > 600 || !Number.isFinite(g.review.at) || !["untested", "supported", "not-supported", "inconclusive"].includes(g.review.outcome))) ||
            !validObservation(g.support) ||
            g.support.node !== g.node ||
            !idOK(g.node) ||
            !Array.isArray(g.links) ||
            g.links.length > 13 ||
            !g.links.every(idOK) ||
            !Array.isArray(g.evidence) ||
            g.evidence.length > 8 ||
            !g.evidence.every(
              (id) => typeof id === "string" && id.length < 200,
            ) ||
            !["active", "dismissed", "archived"].includes(g.status) ||
            !Number.isFinite(g.at) ||
            [
              "id",
              "description",
              "assumptions",
              "uncertainty",
              "benefit",
              "risks",
              "test",
            ].some(
              (k) =>
                typeof (g as any)[k] !== "string" ||
                (g as any)[k].length > 2000,
            ),
        )
      )
        return false;
      // Explicit projection: never retain arbitrary fields from stored state.
      this.state = {
        ...initial(),
        queued: [...s.queued],
        visited: [...s.visited],
        position: { x: s.position.x, z: s.position.z },
        paused: s.paused === true,
        disabled: s.disabled === true,
        cursor: Math.max(0, Math.floor(s.cursor)) % 2000,
        nextAt: Math.min(Math.max(now, s.nextAt), now + 60_000),
        lastModelAt: Math.min(Math.max(0, s.lastModelAt), now),
        stamp:
          typeof s.stamp === "string" && Number.isFinite(Date.parse(s.stamp))
            ? s.stamp
            : "",
        statuses: Object.fromEntries(
          Object.entries(s.statuses).filter(
            ([k, v]) => idOK(k) && statuses.has(v),
          ),
        ),
        observations: s.observations.map((o) => ({
          id: o.id,
          node: o.node,
          stamp: o.stamp,
          status: o.status,
          at: o.at,
          kind: o.kind,
          source: o.source,
          hosted: [...o.hosted],
        ...(o.dependents ? {dependents: [...o.dependents]} : {}),
          outcome:
            o.outcome === "inspected" ? "inspected" : "nothing interesting",
        })),
        ghosts: s.ghosts.map((g) => ({
          id: g.id,
          kind: g.kind,
          ...(g.pattern ? {pattern: g.pattern} : {}),
          ...(g.history ? {history: g.history.map(copyObservation)} : {}),
          ...(g.review ? {review: {saved: g.review.saved === true, outcome: g.review.outcome, note: g.review.note, at: g.review.at}} : {}),
          support: copyObservation(g.support),
          node: g.node,
          links: g.links,
          evidence: g.evidence,
          description: g.description,
          assumptions: g.assumptions,
          uncertainty: g.uncertainty,
          benefit: g.benefit,
          risks: g.risks,
          test: g.test,
          status: g.status,
          at: g.at,
        })),
      };
      this.state.destination = idOK(s.destination) ? s.destination : null;
      this.path = [];
      return true;
    } catch {
      return false;
    }
  }
}
