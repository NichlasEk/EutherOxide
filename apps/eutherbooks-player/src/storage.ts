import { AppSettings } from "./types";

const settingsKey = "eutherbooks-player-settings";

export const defaultSettings: AppSettings = {
  serverUrl: "http://192.168.32.186:8088",
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
