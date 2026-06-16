import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const cacheName = "eutherbooks-player-audio-v1";
const objectUrls = new Map<string, string>();
const pending = new Set<string>();

export type AudioCacheState = {
  available: boolean;
  enabled: boolean;
  cached: number;
  pending: number;
  lastEvent: string;
};

let state: AudioCacheState = {
  available: typeof caches !== "undefined",
  enabled: true,
  cached: 0,
  pending: 0,
  lastEvent: "Audio cache idle",
};

export function audioCacheState(): AudioCacheState {
  return { ...state, pending: pending.size };
}

export function setAudioCacheEnabled(enabled: boolean): void {
  state = { ...state, enabled, lastEvent: enabled ? "Audio cache enabled" : "Audio cache disabled" };
}

export async function refreshAudioCacheState(): Promise<AudioCacheState> {
  if (!state.available) {
    state = { ...state, cached: 0, lastEvent: "Audio cache unavailable" };
    return audioCacheState();
  }
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    state = { ...state, cached: keys.length };
  } catch (err) {
    state = { ...state, available: false, cached: 0, lastEvent: cacheError("Audio cache unavailable", err) };
  }
  return audioCacheState();
}

export async function clearAudioCache(): Promise<void> {
  revokeObjectUrls();
  if (!state.available) {
    state = { ...state, cached: 0, lastEvent: "Audio cache unavailable" };
    return;
  }
  await caches.delete(cacheName);
  state = { ...state, cached: 0, lastEvent: "Audio cache cleared" };
}

export async function playableAudioUrl(url: string): Promise<string> {
  if (!state.enabled || !state.available) {
    return url;
  }
  const cached = objectUrls.get(url);
  if (cached) {
    return cached;
  }
  try {
    const cache = await caches.open(cacheName);
    const response = await cache.match(url);
    if (!response) {
      return url;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    objectUrls.set(url, objectUrl);
    state = { ...state, lastEvent: "Playing cached audio" };
    return objectUrl;
  } catch (err) {
    state = { ...state, lastEvent: cacheError("Audio cache read failed", err) };
    return url;
  }
}

export function prefetchAudio(urls: string[]): void {
  if (!state.enabled || !state.available) {
    return;
  }
  for (const url of urls) {
    if (pending.has(url)) {
      continue;
    }
    pending.add(url);
    void prefetchOne(url);
  }
}

async function prefetchOne(url: string): Promise<void> {
  try {
    const cache = await caches.open(cacheName);
    if (await cache.match(url)) {
      return;
    }
    const response = await requestAudio(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    await cache.put(url, response.clone());
    state = { ...state, cached: state.cached + 1, lastEvent: "Cached audio part" };
  } catch (err) {
    state = { ...state, lastEvent: cacheError("Audio cache prefetch failed", err) };
  } finally {
    pending.delete(url);
  }
}

async function requestAudio(url: string): Promise<Response> {
  if (window.__TAURI_INTERNALS__) {
    return tauriFetch(url);
  }
  return fetch(url, { credentials: "include" });
}

function revokeObjectUrls(): void {
  for (const objectUrl of objectUrls.values()) {
    URL.revokeObjectURL(objectUrl);
  }
  objectUrls.clear();
}

function cacheError(prefix: string, err: unknown): string {
  return `${prefix}: ${err instanceof Error ? err.message : "unknown error"}`;
}
