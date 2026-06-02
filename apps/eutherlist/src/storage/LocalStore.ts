import { AppSettings, ShoppingListDocument, ThemeName } from "../types";
import { defaultShoppingList } from "../shoppingMarkdown";
import { PUBLIC_SERVER_URL, cleanServerUrl } from "../api/ShoppingApi";

const settingsKey = "eutherlist.settings.v1";
const documentKey = "eutherlist.document.v1";
const dirtyKey = "eutherlist.dirty.v1";

export class LocalStore {
  loadSettings(): AppSettings {
    const fallback: AppSettings = {
      serverUrl: PUBLIC_SERVER_URL,
      username: "",
      token: "",
      theme: "joanna-light",
    };
    const settings = { ...fallback, ...readJson<Partial<AppSettings>>(settingsKey, {}) };
    return { ...settings, serverUrl: cleanServerUrl(settings.serverUrl) };
  }

  saveSettings(settings: AppSettings): void {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }

  loadDocument(): ShoppingListDocument {
    return readJson<ShoppingListDocument>(documentKey, defaultShoppingList());
  }

  saveDocument(document: ShoppingListDocument): void {
    localStorage.setItem(documentKey, JSON.stringify(document));
  }

  isDirty(): boolean {
    return localStorage.getItem(dirtyKey) === "1";
  }

  setDirty(dirty: boolean): void {
    if (dirty) {
      localStorage.setItem(dirtyKey, "1");
    } else {
      localStorage.removeItem(dirtyKey);
    }
  }

  setTheme(theme: ThemeName): AppSettings {
    const settings = { ...this.loadSettings(), theme };
    this.saveSettings(settings);
    return settings;
  }

  clearToken(): AppSettings {
    const settings = { ...this.loadSettings(), token: "", username: "" };
    this.saveSettings(settings);
    return settings;
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
