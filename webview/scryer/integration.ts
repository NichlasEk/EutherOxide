import * as THREE from "three";
import { Inhabitant, SCRYER_ID } from "./inhabitant.ts";
import { ObservationAccess, mayObserve, type Authorization } from "./access.ts";
type SceneNode = {
  id: string;
  label: string;
  type: string;
  status?: string;
  object: THREE.Object3D;
  position: THREE.Vector3;
};
export function mountScryer(
  auth: Authorization,
  root: THREE.Group,
  nodes: Map<string, SceneNode>,
) {
  if (!mayObserve(auth)) throw Error("Server Map permission required");
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* memory-only supported */
  }
  const inhabitant = new Inhabitant(auth.user!, storage),
    access = new ObservationAccess(auth);
  let positions = new Map<string, THREE.Vector3>(),
    closed = false,
    busy = false,
    lastPoll = 0,
    lastAuth = 0,
    generation = 0,
    boundSignature = "";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const control = document.createElement("div");
  control.style.cssText =
    "position:fixed;bottom:48px;left:18px;z-index:20;display:flex;gap:8px;align-items:center;background:#101a25;padding:9px;border:1px solid #71879b;border-radius:10px;color:#eefaff;font:13px system-ui";
  const label = document.createElement("span");
  label.textContent = "Scryer";
  control.append(label);
  const button = (name: string, action: () => void) => {
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = action;
    control.append(b);
    return b;
  };
  const pause = button("Pause", () => {
    inhabitant.pause();
    generation++;
    updateButtons();
  });
  const disable = button("Disable", () => {
    inhabitant.disable();
    generation++;
    updateButtons();
  });
  function updateButtons() {
    pause.textContent = inhabitant.engine.state.paused ? "Resume" : "Pause";
    disable.textContent = inhabitant.engine.state.disabled
      ? "Enable"
      : "Disable";
  }
  updateButtons();
  document.body.append(control);
  function bindNodes() {
    for (const id of nodes.keys())
      if (id.startsWith("scryer:")) nodes.delete(id);
    if (inhabitant.engine.state.disabled) return;
    nodes.set(SCRYER_ID, {
      id: SCRYER_ID,
      label: "EutherScryer",
      type: "scryer",
      object: inhabitant.body,
      position: inhabitant.body.position,
    });
    for (const object of inhabitant.ghosts.children)
      nodes.set(object.userData.nodeId, {
        id: object.userData.nodeId,
        label: "What if… · hypothesis",
        type: "scryer-ghost",
        status: "speculative",
        object,
        position: object.position,
      });
  }
  function revoke() {
    closed = true;
    generation++;
    access.cancel();
    inhabitant.revoke();
    for (const selector of ["#ev-custodian-answer", "#ev-detail"]) {
      const el = document.querySelector(selector);
      if (el) el.textContent = "Observation authorization unavailable.";
    }
    for (const id of nodes.keys())
      if (id.startsWith("scryer:")) nodes.delete(id);
    label.textContent = "Scryer: access unavailable";
    pause.disabled = true;
    disable.disabled = true;
  }
  async function poll(now: number) {
    if (busy || closed || document.hidden) return;
    busy = true;
    try {
      if (now - lastAuth >= 30_000) {
        lastAuth = now;
        const current = await access.authorization();
        if (!mayObserve(current) || current.user !== auth.user) {
          revoke();
          return;
        }
      }
      if (
        !inhabitant.engine.state.disabled &&
        !inhabitant.engine.state.paused &&
        now - lastPoll >= 60_000
      ) {
        lastPoll = now;
        const map = await access.map();
        if (!closed) {
          inhabitant.ingest(map, positions);
          bindNodes();
        }
      }
    } catch {
      if (access.controller.signal.aborted) revoke();
      else label.textContent = "Scryer: observation unavailable";
    } finally {
      busy = false;
    }
  }
  window.addEventListener("pagehide", () => {
    inhabitant.save();
    access.cancel();
  });
  return {
    inhabitant,
    attach(map: unknown, nextPositions: Map<string, THREE.Vector3>) {
      positions = nextPositions;
      if (closed) return;
      inhabitant.ingest(map, positions);
      root.add(inhabitant.root);
      bindNodes();
    },
    update(dt: number, active: boolean) {
      if (closed) return;
      const now = Date.now();
      inhabitant.update(dt, now, active && !document.hidden, reduced.matches);
      if (active && !inhabitant.engine.state.disabled) {
        if (inhabitant.root.parent !== root) root.add(inhabitant.root);
      } else inhabitant.root.removeFromParent();
      if (active) {
        void poll(now);
        const signature =
          inhabitant.ghostSignature + inhabitant.engine.state.disabled;
        if (signature !== boundSignature) {
          bindNodes();
          boundSignature = signature;
        }
        label.textContent = `Scryer · ${inhabitant.engine.state.disabled ? "disabled" : inhabitant.engine.state.paused ? "paused" : inhabitant.engine.state.phase}${inhabitant.storageError ? " · unsaved" : ""}`;
      }
    },
    owns(id: string) {
      return id.startsWith("scryer:");
    },
    describe(id: string) {
      if (closed) return "Observation access unavailable.";
      const g = inhabitant.engine.state.ghosts.find(
        (g) => `scryer:ghost:${g.id}` === id,
      );
      return g
        ? [
            `HYPOTHESIS · ${g.status}`,
            g.description,
            `Verified inventory observation (${g.support.stamp}): ${g.support.node} reported ${g.support.status}; hosts edges to ${g.support.hosted.join(", ")}.`,
            `Linked inventory nodes: ${g.links.join(", ")}`,
            `Assumptions: ${g.assumptions}`,
            g.uncertainty,
            `Benefit: ${g.benefit}`,
            `Risks: ${g.risks}`,
            `Suggested test: ${g.test}`,
          ].join("\n\n")
        : inhabitant.engine.discuss("What are you looking at?");
    },
    converse(open: boolean) {
      if (closed) return;
      inhabitant.engine.state.phase = open
        ? "conversing"
        : inhabitant.engine.path.length
          ? "wandering"
          : "contemplating";
      if (!open) generation++;
    },
    dismiss(id: string) {
      const g = inhabitant.engine.state.ghosts.find(
        (g) => `scryer:ghost:${g.id}` === id,
      );
      if (g) {
        g.status = "dismissed";
        inhabitant.syncGhosts();
        inhabitant.save();
        bindNodes();
      }
    },
    async ask(question: string) {
      const s = inhabitant.engine.state;
      if (closed) return "Observation access unavailable.";
      try {
        const current = await access.authorization();
        if (!mayObserve(current) || current.user !== auth.user) {
          revoke();
          return "Observation access unavailable.";
        }
      } catch {
        revoke();
        return "Observation access unavailable.";
      }
      const local = inhabitant.engine.discuss(question);
      if (
        /restart|deploy|execute|sudo|delete|starta om/i.test(question) ||
        s.paused ||
        s.disabled ||
        busy ||
        Date.now() - s.lastModelAt < 60_000
      )
        return local;
      s.lastModelAt = Date.now();
      inhabitant.save();
      const token = ++generation;
      busy = true;
      try {
        const answer = await access.ask(
          question,
          s.observations.at(-1)?.node || s.destination || null,
        );
        if (closed || token !== generation) return "";
        if (answer.source !== "scryer-model") return local;
        return `${local}\n\nModel interpretation (unverified, no actions performed):\n${String(answer.answer).slice(0, 4000)}`;
      } catch {
        if (access.controller.signal.aborted) revoke();
        return closed
          ? "Observation access unavailable."
          : `${local}\n\nThe model is unavailable.`;
      } finally {
        busy = false;
      }
    },
  };
}
