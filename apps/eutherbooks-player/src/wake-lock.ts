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
  const pluginErrors: string[] = [];
  for (const command of ["set_wake_lock", "setWakeLock"]) {
    try {
      lastEvent = extractState(await invoke<unknown>(`plugin:eutherbooks-native-audio|${command}`, { enabled }));
      return;
    } catch (err) {
      pluginErrors.push(`${command}: ${errorMessage(err)}`);
    }
  }
  try {
    lastEvent = await invoke<string>("set_wake_lock", { enabled });
  } catch (fallbackErr) {
    lastEvent = `Wake lock failed: ${pluginErrors.join(" | ")}; fallback: ${errorMessage(fallbackErr)}`;
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch (_jsonErr) {
    return String(err);
  }
}
