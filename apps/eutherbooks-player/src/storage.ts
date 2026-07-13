import { AppSettings, Bookmark, ModelBackend, ServerRouteConfig } from "./types";

const settingsKey = "eutherbooks-player-settings";
const bookmarksKey = "eutherbooks-player-bookmarks";
const serverRouteConfigKey = "eutherbooks-player-server-route-config";
const bootstrapUsername = import.meta.env.VITE_EUTHERBOOKS_PLAYER_USERNAME?.trim() ?? "";

export const defaultSettings: AppSettings = {
  serverUrl: defaultServerUrl(),
  username: bootstrapUsername,
  authToken: "",
  voiceId: "dots-mf-own-sv",
  modelBackend: "dots.tts-mf",
  autoPlay: true,
  autoNext: true,
  autoBookmark: true,
  cacheAudio: true,
  sleepTimerMinutes: 0,
};

export function loadSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsKey) ?? "");
    return {
      ...defaultSettings,
      ...parsed,
      serverUrl: toEutherBooksUrl(parsed?.serverUrl) || defaultSettings.serverUrl,
      username: typeof parsed?.username === "string" && parsed.username.trim()
        ? parsed.username.trim()
        : defaultSettings.username,
      authToken: "",
    };
  } catch (_err) {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(settingsKey, JSON.stringify({ ...settings, authToken: "" }));
}

export function bookmarkKey(bookId: string, chapterIndex: number, modelBackend: ModelBackend, voiceId: string): string {
  return `${bookId}::${chapterIndex}::${modelBackend}::${voiceId}`;
}

export function loadBookmarks(): Record<string, Bookmark> {
  try {
    const parsed = JSON.parse(localStorage.getItem(bookmarksKey) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

export function saveBookmark(bookmark: Bookmark): void {
  const bookmarks = loadBookmarks();
  bookmarks[bookmark.id] = bookmark;
  localStorage.setItem(bookmarksKey, JSON.stringify(bookmarks));
}

export function loadServerRouteConfig(): ServerRouteConfig {
  try {
    return normalizeServerRouteConfig(JSON.parse(localStorage.getItem(serverRouteConfigKey) ?? "{}"));
  } catch (_err) {
    return normalizeServerRouteConfig({});
  }
}

export function saveServerRouteConfig(config: Partial<ServerRouteConfig>): ServerRouteConfig {
  const normalized = normalizeServerRouteConfig({
    ...config,
    updatedAt: new Date().toISOString(),
  });
  localStorage.setItem(serverRouteConfigKey, JSON.stringify(normalized));
  return normalized;
}

export function cleanServerUrl(value: string): string {
  const trimmed = repairKnownServerUrl(value).trim().replace(/\/+$/, "");
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
  return "https://apothictech.se:8443/eutherbooks";
}

export function serverCandidates(preferredUrl: string, routeConfig: Partial<ServerRouteConfig> = {}): string[] {
  const routeUrls = normalizeUrlList(routeConfig.eutherbooksUrls);
  const lanRouteUrls = routeUrls.filter(isLanServerUrl);
  const remoteRouteUrls = routeUrls.filter((url) => !isLanServerUrl(url));
  const candidates = [
    defaultServerUrl(),
    toEutherBooksUrl(preferredUrl),
    ...remoteRouteUrls,
    "https://apothictech.se:8443/eutherbooks",
    "http://192.168.32.186:32162/eutherbooks",
    "http://192.168.32.186:8080/eutherbooks",
    "https://apothictech.se/eutherbooks",
    ...lanRouteUrls.map(toEutherBooksUrl),
  ];
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    candidates.push(`${window.location.origin.replace(/\/+$/, "")}/eutherbooks`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function hostConfigCandidates(preferredUrl: string, routeConfig: Partial<ServerRouteConfig> = {}): string[] {
  const candidates = [
    cleanServerUrl(routeConfig.publicServerUrl ?? ""),
    "https://apothictech.se:8443",
    ...normalizeUrlList(routeConfig.serverUrls).filter((url) => !isLanServerUrl(url)),
    hostBaseUrl(preferredUrl),
    cleanServerUrl(routeConfig.lanServerUrl ?? ""),
    "http://192.168.32.186:32162",
    "http://192.168.32.186:8080",
    "https://apothictech.se",
  ];
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    candidates.push(window.location.origin.replace(/\/+$/, ""));
  }
  return [...new Set(candidates.filter(Boolean))];
}

function normalizeServerRouteConfig(raw: unknown): ServerRouteConfig {
  const value = raw && typeof raw === "object" ? raw as Partial<ServerRouteConfig> : {};
  return {
    publicServerUrl: cleanServerUrl(value.publicServerUrl ?? "") || undefined,
    lanServerUrl: cleanServerUrl(value.lanServerUrl ?? "") || undefined,
    serverUrls: normalizeUrlList(value.serverUrls),
    eutherbooksUrls: normalizeUrlList(value.eutherbooksUrls),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

function normalizeUrlList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.map((value) => typeof value === "string" ? cleanServerUrl(value) : "").filter(Boolean))];
}

export function toEutherBooksUrl(value: string): string {
  const clean = cleanServerUrl(value);
  if (!clean) {
    return "";
  }
  try {
    const url = new URL(clean);
    if (url.hostname === "192.168.32.186" && url.port === "8088") {
      return "";
    }
    if (url.hostname.toLowerCase() === "apothictech.se" && (!url.port || url.port === "443")) {
      url.protocol = "https:";
      url.port = "8443";
    }
    if (url.pathname === "/eutherbooks" || url.pathname.startsWith("/eutherbooks/")) {
      return url.toString().replace(/\/+$/, "");
    }
    if (url.hostname === "192.168.32.186" && url.port === "32162") {
      url.port = "8080";
    }
    url.pathname = "/eutherbooks";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_err) {
    return "";
  }
}

function hostBaseUrl(value: string): string {
  const clean = cleanServerUrl(value);
  if (!clean) {
    return "";
  }
  try {
    const url = new URL(clean);
    if (url.hostname.toLowerCase() === "apothictech.se" && (!url.port || url.port === "443")) {
      url.protocol = "https:";
      url.port = "8443";
    }
    if (url.pathname === "/eutherbooks" || url.pathname.startsWith("/eutherbooks/")) {
      url.pathname = "";
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch (_err) {
    return "";
  }
}

function repairKnownServerUrl(value: string): string {
  return value.replace(/apothichtech\.se/gi, "apothictech.se");
}

function isLanServerUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "192.168.32.186" || hostname.endsWith(".local") || hostname.endsWith(".lan");
  } catch (_err) {
    return false;
  }
}
