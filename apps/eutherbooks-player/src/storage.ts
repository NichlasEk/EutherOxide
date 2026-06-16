import { AppSettings } from "./types";

const settingsKey = "eutherbooks-player-settings";

export const defaultSettings: AppSettings = {
  serverUrl: defaultServerUrl(),
  voiceId: "dots-mf-own-sv",
  modelBackend: "dots.tts-mf",
  autoPlay: true,
  autoNext: true,
  sleepTimerMinutes: 0,
};

export function loadSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsKey) ?? "");
    return {
      ...defaultSettings,
      ...parsed,
      serverUrl: cleanServerUrl(parsed?.serverUrl) || defaultSettings.serverUrl,
    };
  } catch (_err) {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

export function cleanServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    return url.toString().replace(/\/+$/, "");
  } catch (_err) {
    return "";
  }
}

export function defaultServerUrl(): string {
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    const host = window.location.hostname.toLowerCase();
    if (host && !["localhost", "127.0.0.1"].includes(host)) {
      return `${window.location.origin.replace(/\/+$/, "")}/eutherbooks`;
    }
  }
  return "http://192.168.32.186:8088";
}

export function serverCandidates(preferredUrl: string): string[] {
  const candidates = [
    cleanServerUrl(preferredUrl),
    defaultServerUrl(),
    "http://192.168.32.186:8088",
    "http://192.168.32.186:8080/eutherbooks",
    "https://apothictech.se/eutherbooks",
  ];
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    candidates.push(`${window.location.origin.replace(/\/+$/, "")}/eutherbooks`);
  }
  return [...new Set(candidates.filter(Boolean))];
}
