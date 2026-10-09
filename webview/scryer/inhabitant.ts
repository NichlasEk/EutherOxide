import * as THREE from "three";
import { Scryer, project, type Point } from "./core.ts";
export const SCRYER_ID = "scryer:inhabitant";
const palette = {
  wandering: 0x72e9dd,
  observing: 0x98caff,
  investigating: 0xe4bd76,
  contemplating: 0xa992df,
  conversing: 0xffffff,
  discovery: 0xffd998,
};
export class Inhabitant {
  engine = new Scryer();
  root = new THREE.Group();
  body = new THREE.Group();
  ghosts = new THREE.Group();
  core: THREE.Mesh;
  rings: THREE.Mesh[] = [];
  lastSave = 0;
  ghostSignature = "";
  storageError = "";
  key: string;
  constructor(
    user: string,
    private storage?: Storage,
  ) {
    this.key = `eutherscryer:v1:${encodeURIComponent(user)}`;
    this.engine.authorize(true);
    try {
      const saved = storage?.getItem(this.key);
      if (saved && !this.engine.restore(saved, Date.now()))
        this.storageError = "Invalid saved state discarded";
    } catch {
      this.storageError = "Storage unavailable: memory only";
    }
    this.body.userData.nodeId = SCRYER_ID;
    const glow = new THREE.MeshStandardMaterial({
      color: 0x9ef7e4,
      emissive: 0x72e9dd,
      emissiveIntensity: 0.65,
      roughness: 0.3,
      metalness: 0.5,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), glow);
    this.body.add(this.core);
    // Split, asymmetric lantern silhouette enclosing a suspended, faceted seed.
    const shell = new THREE.MeshStandardMaterial({
      color: 0x142c39,
      emissive: 0x243c50,
      emissiveIntensity: 0.4,
      metalness: 0.75,
      roughness: 0.35,
    });
    for (let i = 0; i < 3; i++) {
      const petal = new THREE.Mesh(
        new THREE.ConeGeometry(0.29, 1.65, 3),
        shell,
      );
      const a = (i * Math.PI * 2) / 3;
      petal.position.set(Math.cos(a) * 0.72, 0.12, Math.sin(a) * 0.72);
      petal.rotation.set(0, -a, 0.32);
      this.body.add(petal);
    }
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.75 + i * 0.24, 0.018, 5, 40, Math.PI * 1.65),
        new THREE.MeshBasicMaterial({ color: i ? 0xd5b0f7 : 0x72e9dd }),
      );
      ring.rotation.set(Math.PI / 3 + i, 0, i);
      this.rings.push(ring);
      this.body.add(ring);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.85, 4), glow);
    tail.position.y = -1.15;
    tail.rotation.z = Math.PI;
    this.body.add(tail);
    this.root.add(this.body, this.ghosts);
  }
  ingest(raw: unknown, positions: Map<string, Point>) {
    this.engine.ingest(project(raw, positions), Date.now());
    this.ghostSignature = "";
    this.syncGhosts();
  }
  update(dt: number, now: number, active: boolean, reduced: boolean) {
    this.root.visible = active && !this.engine.state.disabled;
    if (!active || this.engine.state.disabled) return;
    const previous = { ...this.engine.state.position };
    this.engine.tick(dt, now);
    const s = this.engine.state;
    this.body.position.set(
      s.position.x,
      3.5 + (reduced || s.paused ? 0 : Math.sin(now / 1900) * 0.09),
      s.position.z,
    );
    const dx = s.position.x - previous.x,
      dz = s.position.z - previous.z;
    if (Math.hypot(dx, dz) > 0.001) {
      const desired = Math.atan2(dx, dz),
        diff = Math.atan2(
          Math.sin(desired - this.body.rotation.y),
          Math.cos(desired - this.body.rotation.y),
        );
      this.body.rotation.y += diff * Math.min(dt * 4, 1);
    }
    (this.core.material as THREE.MeshStandardMaterial).emissive.setHex(
      palette[s.phase],
    );
    if (!reduced && !s.paused) {
      this.core.rotation.y += dt * 0.25;
      this.rings.forEach((r, i) => (r.rotation.z += dt * (i ? -0.12 : 0.18)));
    }
    this.syncGhosts();
    if (now - this.lastSave > 5000) this.save(now);
  }
  syncGhosts() {
    const signature = JSON.stringify(
      this.engine.state.ghosts.map((g) => [g.id, g.status, g.links]),
    );
    if (signature === this.ghostSignature) return;
    this.ghostSignature = signature;
    this.ghosts.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (m.material)
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((v) =>
          v.dispose(),
        );
    });
    this.ghosts.clear();
    for (const g of this.engine.state.ghosts.filter(
      (g) => g.status === "active",
    )) {
      const node = this.engine.world.nodes.find((n) => n.id === g.node);
      if (!node) continue;
      const group = new THREE.Group();
      group.position.set(node.x, 9, node.z);
      group.userData.nodeId = `scryer:ghost:${g.id}`;
      const cage = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.1, 0),
        new THREE.MeshBasicMaterial({
          color: 0xc7a4ff,
          transparent: true,
          opacity: 0.32,
          wireframe: true,
          depthWrite: false,
        }),
      );
      group.add(cage);
      const inner = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.65, 0),
        new THREE.MeshBasicMaterial({
          color: 0xc7a4ff,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      );
      group.add(inner);
      const segments: THREE.Vector3[] = [];
      for (const id of g.links.filter((id) => id !== g.node)) {
        const linked = this.engine.world.nodes.find((n) => n.id === id);
        if (!linked) continue;
        segments.push(
          new THREE.Vector3(0, -0.8, 0),
          new THREE.Vector3(linked.x - node.x, -7, linked.z - node.z),
        );
      }
      if (segments.length) {
        const tether = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(segments),
          new THREE.LineDashedMaterial({
            color: 0xae8ce0,
            transparent: true,
            opacity: 0.3,
            dashSize: 0.3,
            gapSize: 0.45,
            depthWrite: false,
          }),
        );
        tether.computeLineDistances();
        group.add(tether);
      }
      this.ghosts.add(group);
    }
  }
  save(now = Date.now()) {
    try {
      this.storage?.setItem(this.key, this.engine.serialize());
      this.lastSave = now;
    } catch {
      this.storageError = "State could not be saved";
    }
  }
  pause() {
    this.engine.state.paused = !this.engine.state.paused;
    this.save();
  }
  disable() {
    this.engine.state.disabled = !this.engine.state.disabled;
    this.save();
  }
  revoke() {
    this.engine.authorize(false);
    this.root.visible = false;
    this.ghostSignature = "";
    this.syncGhosts();
  }
  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (m.material)
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((v) =>
          v.dispose(),
        );
    });
    this.root.removeFromParent();
  }
}
