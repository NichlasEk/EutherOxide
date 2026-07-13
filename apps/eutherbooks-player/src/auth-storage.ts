import { invoke } from "@tauri-apps/api/core";

export async function loadAuthToken(): Promise<string> {
  if (!window.__TAURI_INTERNALS__) {
    return "";
  }
  try {
    return (await invoke<string>("secure_auth_load")).trim();
  } catch (_err) {
    return "";
  }
}

export async function saveAuthToken(token: string): Promise<void> {
  if (!window.__TAURI_INTERNALS__) {
    return;
  }
  await invoke("secure_auth_save", { token });
}

export async function clearAuthToken(): Promise<void> {
  if (!window.__TAURI_INTERNALS__) {
    return;
  }
  await invoke("secure_auth_clear");
}
