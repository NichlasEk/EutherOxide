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
    lastEvent = await invoke<string>("set_wake_lock", { enabled });
  } catch (err) {
    lastEvent = `Wake lock failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
