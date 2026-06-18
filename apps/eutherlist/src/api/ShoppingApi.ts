import { listsToMarkdown, markdownToItems, markdownToLists } from "../shoppingMarkdown";
import { AppSettings, ShoppingListDocument, ShoppingMember, UserPreferences } from "../types";

export const PUBLIC_SERVER_URL = "https://apothictech.se";
export const LAN_SERVER_PORT = "32162";

type ShoppingListResponse = {
  name: string;
  sharedId: string;
  markdown: string;
  updatedUnixMs?: number;
  canEdit?: boolean;
  canManage?: boolean;
  members?: Array<string | ShoppingMember>;
};

type LoginResponse = {
  authenticated: boolean;
  user: string;
  token: string;
  lanServerUrl?: string;
};

type AppStatusResponse = {
  authenticated: boolean;
  user: string;
  lanServerUrl?: string;
};

export type LoginResult = LoginResponse & {
  serverUrl: string;
};

export type AppStatusResult = AppStatusResponse & {
  serverUrl: string;
};

type ServerSettings = Pick<AppSettings, "serverUrl" | "lanServerUrl"> &
  Partial<Pick<AppSettings, "activeServerUrl">>;

type ServerResponse = {
  response: Response;
  serverUrl: string;
};

const fallbackFetchTimeoutMs = 3500;

export class ShoppingApi {
  activeServerUrl = "";

  constructor(private readonly settings: AppSettings) {}

  static async login(
    settings: ServerSettings,
    username: string,
    password: string,
  ): Promise<LoginResult> {
    const { response, serverUrl } = await fetchFromServerCandidates(settings, "/api/app/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const login = await response.json() as LoginResponse;
    return { ...login, serverUrl };
  }

  async status(): Promise<AppStatusResult> {
    const { response, serverUrl } = await this.fetch("/api/app/status");
    this.activeServerUrl = serverUrl;
    const status = await response.json() as AppStatusResponse;
    return { ...status, serverUrl };
  }

  async loadList(): Promise<ShoppingListDocument> {
    const { response, serverUrl } = await this.fetch("/api/interaction/shopping-list");
    this.activeServerUrl = serverUrl;
    return responseToDocument(await response.json() as ShoppingListResponse);
  }

  async saveList(document: ShoppingListDocument): Promise<ShoppingListDocument> {
    const markdown = listsToMarkdown(document.lists);
    const { response, serverUrl } = await this.fetch("/api/interaction/shopping-list", {
      method: "POST",
      body: JSON.stringify({ markdown }),
    });
    this.activeServerUrl = serverUrl;
    return responseToDocument(await response.json() as ShoppingListResponse);
  }

  async preferences(): Promise<UserPreferences> {
    const { response, serverUrl } = await this.fetch("/api/user/preferences");
    this.activeServerUrl = serverUrl;
    return response.json() as Promise<UserPreferences>;
  }

  async savePreferences(preferences: UserPreferences): Promise<UserPreferences> {
    const { response, serverUrl } = await this.fetch("/api/user/preferences", {
      method: "POST",
      body: JSON.stringify(preferences),
    });
    this.activeServerUrl = serverUrl;
    return response.json() as Promise<UserPreferences>;
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<ServerResponse> {
    return fetchFromServerCandidates(this.settings, path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Euther-App-Token": this.settings.token,
        ...(init.headers ?? {}),
      },
    });
  }
}

export function cleanServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return PUBLIC_SERVER_URL;
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const clean = withProtocol.replace(/\/+$/, "");
  return isInternalAppOrigin(clean) ? PUBLIC_SERVER_URL : clean;
}

export function cleanOptionalServerUrl(value: string): string {
  const trimmed = value.trim();
  return trimmed ? cleanServerUrl(trimmed) : "";
}

export function cleanLanServerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const withProtocol = hasProtocol ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol === "http:" && !url.port) {
      url.port = LAN_SERVER_PORT;
    }
    return cleanServerUrl(url.toString());
  } catch {
    return cleanOptionalServerUrl(trimmed);
  }
}

export function serverCandidates(
  settings: ServerSettings,
): string[] {
  const primaryUrl = cleanServerUrl(settings.serverUrl);
  const lanUrl = cleanLanServerUrl(settings.lanServerUrl);
  const activeUrl = cleanOptionalServerUrl(settings.activeServerUrl ?? "");
  const urls = activeUrl ? [activeUrl, primaryUrl, lanUrl] : [primaryUrl, lanUrl];
  return urls.filter((url, index) => url && urls.indexOf(url) === index);
}

export function cleanActiveServerUrl(settings: ServerSettings): string {
  const activeUrl = cleanOptionalServerUrl(settings.activeServerUrl ?? "");
  return activeUrl && serverCandidates({ ...settings, activeServerUrl: "" }).includes(activeUrl)
    ? activeUrl
    : "";
}

async function fetchFromServerCandidates(
  settings: ServerSettings,
  path: string,
  init: RequestInit,
): Promise<ServerResponse> {
  const candidates = serverCandidates(settings);
  let lastError: unknown = null;

  for (const [index, serverUrl] of candidates.entries()) {
    const isLastCandidate = index === candidates.length - 1;
    let response: Response;
    try {
      response = await fetchWithTimeout(`${serverUrl}${path}`, init, !isLastCandidate);
    } catch (error) {
      lastError = error;
      if (isLastCandidate) {
        break;
      }
      continue;
    }

    if (response.ok) {
      return { response, serverUrl };
    }
    lastError = new Error((await response.text()) || `Server request failed with ${response.status}`);
    if (!isLastCandidate && shouldTryNextServer(response.status)) {
      continue;
    }
    throw lastError;
  }

  throw lastError instanceof Error ? lastError : new Error("Server request failed");
}

function shouldTryNextServer(status: number): boolean {
  return status === 408 || status >= 500;
}

async function fetchWithTimeout(url: string, init: RequestInit, useTimeout: boolean): Promise<Response> {
  if (!useTimeout) {
    return fetch(url, init);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), fallbackFetchTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function isInternalAppOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "tauri.localhost" || url.protocol === "tauri:";
  } catch {
    return false;
  }
}

function responseToDocument(response: ShoppingListResponse): ShoppingListDocument {
  const updatedAt = response.updatedUnixMs
    ? new Date(response.updatedUnixMs).toISOString()
    : new Date().toISOString();
  const lists = markdownToLists(response.markdown, updatedAt);
  return {
    name: response.name,
    sharedId: response.sharedId,
    markdown: response.markdown,
    lists,
    items: markdownToItems(response.markdown, updatedAt),
    updatedAt,
    canEdit: response.canEdit ?? true,
    canManage: response.canManage ?? false,
    members: normalizeMembers(response.members),
  };
}

function normalizeMembers(members: Array<string | ShoppingMember> | undefined): ShoppingMember[] {
  return (members ?? []).map((member) =>
    typeof member === "string"
      ? { name: member, role: "edit" }
      : {
          name: member.name,
          role: member.role,
          isCurrentUser: member.isCurrentUser,
        },
  );
}
