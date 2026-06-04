import { listsToMarkdown, markdownToItems, markdownToLists } from "../shoppingMarkdown";
import { AppSettings, ShoppingListDocument, ShoppingMember } from "../types";

export const PUBLIC_SERVER_URL = "https://apothictech.se";

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
};

export class ShoppingApi {
  constructor(private readonly settings: AppSettings) {}

  static async login(serverUrl: string, username: string, password: string): Promise<LoginResponse> {
    const response = await fetch(`${cleanServerUrl(serverUrl)}/api/app/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.json() as Promise<LoginResponse>;
  }

  async loadList(): Promise<ShoppingListDocument> {
    const response = await this.fetch("/api/interaction/shopping-list");
    return responseToDocument(await response.json() as ShoppingListResponse);
  }

  async saveList(document: ShoppingListDocument): Promise<ShoppingListDocument> {
    const markdown = listsToMarkdown(document.lists);
    const response = await this.fetch("/api/interaction/shopping-list", {
      method: "POST",
      body: JSON.stringify({ markdown }),
    });
    return responseToDocument(await response.json() as ShoppingListResponse);
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${cleanServerUrl(this.settings.serverUrl)}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Euther-App-Token": this.settings.token,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response;
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
