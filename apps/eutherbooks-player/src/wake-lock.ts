import { invoke } from "@tauri-apps/api/core";

let lastEvent = "Wake lock idle";

export function wakeLockStatus(): string {
  return lastEvent;
}

export async function setPlaybackWakeLock(enabled: boolean): Promise<void> {
  if (!window.__TAURI_INTERNALS__) {
    lastEvent = enabled ? "Browser wake lock unavailable" : "Wake lock released";
    return;
  }
  try {
    lastEvent = extractState(await invoke<unknown>("plugin:eutherbooks-native-audio|set_wake_lock", { enabled }));
  } catch (err) {
    try {
      lastEvent = await invoke<string>("set_wake_lock", { enabled });
    } catch (fallbackErr) {
      lastEvent = `Wake lock failed: ${err instanceof Error ? err.message : String(err)}; fallback: ${
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      }`;
    }
  }
}

function extractState(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "state" in value) {
    const state = (value as { state?: unknown }).state;
    if (typeof state === "string") {
      return state;
    }
  }
  return String(value ?? "Wake lock updated");
}
