import * as THREE from "three";
import { ideaDialog } from "./ideas.ts";
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
type Options = { shared?: boolean; onMap?: (map: any) => void; onFocus?: (id: string) => void };
export function mountScryer(
  auth: Authorization,
  root: THREE.Group,
  nodes: Map<string, SceneNode>,
  options: Options = {},
) {
  if (!mayObserve(auth)) throw Error("Server Map permission required");
  const shared = options.shared !== false;
  let storage: Storage | undefined;
  if (!shared)
    try {
      storage = window.localStorage;
    } catch {}
  const inhabitant = new Inhabitant(auth.user!, storage),
    access = new ObservationAccess(auth);
  inhabitant.shared = shared;
  let positions = new Map<string, THREE.Vector3>(),
    closed = false,
    busy = false,
    asking = false,
    controlling = false,
    ready = !shared;
  let lastPoll = 0,
    lastAuth = 0,
    lastShared = 0,
    generation = 0,
    boundSignature = "",
    error = "",
    modelAt = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const control = document.createElement("div");
  control.style.cssText =
    "position:fixed;bottom:48px;left:18px;z-index:20;display:flex;flex-wrap:wrap;max-width:calc(100vw - 54px);gap:8px;align-items:center;background:#101a25;padding:9px;border:1px solid #71879b;border-radius:10px;color:#eefaff;font:13px system-ui";
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
  const pause = button(
    "Pause",
    () =>
      void controlState(inhabitant.engine.state.paused ? "resume" : "pause"),
  );
  const disable = button(
    "Disable",
    () =>
      void controlState(
        inhabitant.engine.state.disabled ? "enable" : "disable",
      ),
  );
  const find = button("Find Scryer", () => options.onFocus?.(SCRYER_ID));
  find.hidden = !options.onFocus;
  const ideas = ideaDialog({
    ghosts: () => inhabitant.engine.state.ghosts,
    describe,
    focus: id => options.onFocus?.(id),
    canControl: () => !closed && (!shared || auth.isAdmin === true),
    control: controlState,
  });
  const ideaButton = button("Ideas", () => ideas.open());
  function updateButtons() {
    find.disabled = closed || !ready || inhabitant.engine.state.disabled;
    ideaButton.disabled = closed || !ready;
    const unreviewed = inhabitant.engine.state.ghosts.filter(g => g.status === "active" && (!g.review || g.review.outcome === "untested")).length;
    ideaButton.textContent = `Ideas · ${unreviewed} unreviewed`;
    pause.textContent = inhabitant.engine.state.paused ? "Resume" : "Pause";
    disable.textContent = inhabitant.engine.state.disabled
      ? "Enable"
      : "Disable";
    pause.disabled = disable.disabled =
      closed || controlling || (shared && (!ready || auth.isAdmin !== true));
  }
  updateButtons();
  document.body.append(control);
  function bindNodes() {
    for (const id of nodes.keys())
      if (id.startsWith("scryer:")) nodes.delete(id);
    if (!ready || inhabitant.engine.state.disabled) return;
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
    ideas.remove();
    inhabitant.revoke();
    inhabitant.root.removeFromParent();
    for (const id of nodes.keys())
      if (id.startsWith("scryer:")) nodes.delete(id);
    for (const selector of ["#ev-custodian-answer", "#ev-detail"]) {
      const el = document.querySelector(selector);
      if (el) el.textContent = "Observation authorization unavailable.";
    }
    label.textContent = "Scryer: access unavailable";
    updateButtons();
  }
  function apply(value: any) {
    const wasStopped = inhabitant.engine.state.paused || inhabitant.engine.state.disabled;
    inhabitant.applyShared(value);
    if (!wasStopped && (inhabitant.engine.state.paused || inhabitant.engine.state.disabled)) generation++;
    ready = true;
    error = value.diagnostics?.error ? "observer needs attention" : Date.now() - Date.parse(inhabitant.engine.world.stamp) > 86400000 ? "inventory older than 24h · exploration suspended" : "";
    updateButtons();
  }
  async function controlState(
    command: "pause" | "resume" | "disable" | "enable" | "dismiss" | "save" | "review",
    ghost_id?: string,
    data?: { outcome: string; note: string },
  ) {
    if (closed || controlling) return;
    generation++;
    controlling = true;
    updateButtons();
    try {
      if (shared) apply(await access.control(command, ghost_id, data));
      else if (command === "pause" || command === "resume") inhabitant.pause();
      else if (command === "disable" || command === "enable")
        inhabitant.disable();
      else {
        const g = inhabitant.engine.state.ghosts.find((g) => g.id === ghost_id);
        if (g) {
          if (command === "dismiss") g.status = "dismissed";
          else {
            const r = g.review || {saved: false, outcome: "untested" as const, note: "", at: 0};
            if (command === "save") r.saved = !r.saved;
            else if (data && ["untested", "supported", "not-supported", "inconclusive"].includes(data.outcome)) {
              r.outcome = data.outcome as typeof r.outcome; r.note = data.note.slice(0, 600);
            }
            r.at = Date.now(); g.review = r;
          }
        }
        inhabitant.syncGhosts();
        inhabitant.save();
      }
      bindNodes();
    } catch {
      error = "control not confirmed";
      if (access.controller.signal.aborted) revoke();
      throw Error("Scryer control could not be confirmed");
    } finally {
      controlling = false;
      updateButtons();
    }
  }
  // Button errors are displayed without unhandled promise rejections.
  pause.onclick = () =>
    void controlState(
      inhabitant.engine.state.paused ? "resume" : "pause",
    ).catch(() => {});
  disable.onclick = () =>
    void controlState(
      inhabitant.engine.state.disabled ? "enable" : "disable",
    ).catch(() => {});
  async function poll(now: number) {
    if (busy || closed || document.hidden) return;
    busy = true;
    try {
      if (now - lastAuth >= 30000) {
        lastAuth = now;
        const current = await access.authorization();
        if (!mayObserve(current) || current.user !== auth.user) {
          revoke();
          return;
        }
      }
      if (
        now - lastPoll >= 60000 &&
        (shared ||
          (!inhabitant.engine.state.disabled &&
            !inhabitant.engine.state.paused))
      ) {
        lastPoll = now;
        const map = await access.map();
        if (closed) return;
        options.onMap?.(map);
        if (!shared) {
          inhabitant.ingest(map, positions);
          bindNodes();
        }
      }
      if (shared && now - lastShared >= 1000) {
        lastShared = now;
        const value = await access.shared();
        if (!closed) {
          apply(value);
        }
      }
      if (!shared) error = "";
    } catch {
      error = "observation unavailable";
      if (access.controller.signal.aborted) revoke();
    } finally {
      busy = false;
    }
  }
  function describe(id: string) {
      if (closed) return "Observation access unavailable.";
      const g = inhabitant.engine.state.ghosts.find(
        (g) => `scryer:ghost:${g.id}` === id,
      );
      return g
        ? [
            `HYPOTHESIS · ${g.status}`,
            g.description,
            `Verified inventory observation (${g.support.stamp}): ${g.support.node} reported ${g.support.status}; ${g.pattern === "shared-dependency" ? "dependency edges from " + (g.support.dependents || []).join(", ") : "hosts edges to " + g.support.hosted.join(", ")}.`,
            ...(g.history || []).map(o => `Verified inventory history: ${o.stamp} · ${o.node} · ${o.status}`),
            `Linked inventory nodes: ${g.links.join(", ")}`,
            `Assumptions: ${g.assumptions}`,
            g.uncertainty,
            `Benefit: ${g.benefit}`,
            `Risks: ${g.risks}`,
            `Suggested test: ${g.test}`,
          ].join("\n\n")
        : inhabitant.engine.discuss("What are you looking at?");
    }
  window.addEventListener("pagehide", () => {
    if (!shared) inhabitant.save();
    access.cancel();
  });
  return {
    inhabitant,
    attach(map: unknown, nextPositions: Map<string, THREE.Vector3>) {
      positions = nextPositions;
      if (closed) return;
      if (!shared || !ready) inhabitant.ingest(map, positions);
      if (ready) root.add(inhabitant.root);
      bindNodes();
    },
    update(dt: number, active: boolean) {
      if (closed) return;
      const now = Date.now();
      inhabitant.update(
        dt,
        now,
        active && ready && !document.hidden,
        reduced.matches,
      );
      if (active && ready && !inhabitant.engine.state.disabled) {
        if (inhabitant.root.parent !== root) root.add(inhabitant.root);
      } else inhabitant.root.removeFromParent();
      if (active) {
        updateButtons();
        void poll(now);
        const signature =
          inhabitant.ghostSignature + inhabitant.engine.state.disabled + ready;
        if (signature !== boundSignature) {
          bindNodes();
          boundSignature = signature;
        }
        label.textContent = `Scryer · ${error || (!ready ? "connecting" : inhabitant.engine.state.disabled ? "disabled" : inhabitant.engine.state.paused ? "paused" : inhabitant.engine.state.phase)}${inhabitant.storageError ? " · unsaved" : ""}`;
      }
    },
    owns(id: string) {
      return id.startsWith("scryer:");
    },
    describe,
    openIdea(id: string) { ideas.open(id); },
    converse(open: boolean) {
      if (closed) return;
      inhabitant.conversing = open;
      if (!shared)
        inhabitant.engine.state.phase = open
          ? "conversing"
          : inhabitant.engine.path.length
            ? "wandering"
            : "contemplating";
      if (!open) generation++;
    },
    canControl() {
      return !shared || auth.isAdmin === true;
    },
    async dismiss(id: string) {
      await controlState("dismiss", id.replace(/^scryer:ghost:/, ""));
    },
    async ask(question: string) {
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
      const s = inhabitant.engine.state,
        local = inhabitant.engine.discuss(question);
      if (
        /restart|deploy|execute|sudo|delete|starta om/i.test(question) ||
        s.paused ||
        s.disabled ||
        asking ||
        Date.now() - Math.max(modelAt, s.lastModelAt) < 60000
      )
        return local;
      modelAt = Date.now();
      if (!shared) {
        s.lastModelAt = modelAt;
        inhabitant.save();
      }
      const token = ++generation;
      asking = true;
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
        asking = false;
      }
    },
  };
}
