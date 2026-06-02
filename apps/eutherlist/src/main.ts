import "./styles.css";
import "./themes/joanna-light.css";
import "./themes/euther.css";
import "./themes/apothecary-dark.css";

import iconDark from "./assets/eutherlist-icon-dark.svg";
import iconLight from "./assets/eutherlist-icon-light.svg";
import { ShoppingApi, cleanServerUrl } from "./api/ShoppingApi";
import { addItemBarMarkup } from "./components/AddItemBar";
import { categoryTabsMarkup } from "./components/CategoryTabs";
import { escapeHtml } from "./components/ItemRow";
import { settingsPanelMarkup } from "./components/SettingsPanel";
import { shoppingListMarkup } from "./components/ShoppingList";
import { LocalStore } from "./storage/LocalStore";
import { applyTheme } from "./theme/ThemeProvider";
import { AppSettings, ShoppingCategory, ShoppingItem, SyncState } from "./types";
import { inferCategory, itemsToMarkdown, makeShoppingItem, normalizeCategory, sortItems } from "./shoppingMarkdown";

const store = new LocalStore();
const root = document.querySelector<HTMLDivElement>("#app")!;

let settings = store.loadSettings();
let documentState = store.loadDocument();
let syncState: SyncState = settings.token ? (store.isDirty() ? "dirty" : "saved") : "login";
let activeCategory: ShoppingCategory | "Alla" = "Alla";
let settingsOpen = false;
let syncTimer: number | null = null;
let loginMessage = "";

applyTheme(settings.theme);
render();
if (settings.token) {
  void syncFromStartup();
}
window.addEventListener("online", () => scheduleSync(50));

function render(): void {
  root.innerHTML = settings.token ? appMarkup() : loginMarkup();
  bindCommonActions();
  if (settings.token) {
    bindListActions();
  } else {
    bindLoginActions();
  }
}

function appMarkup(): string {
  const openCount = documentState.items.filter((item) => !item.checked).length;
  const checkedCount = documentState.items.length - openCount;
  return `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand-lockup">
          <img src="${appIcon()}" alt="" />
          <div>
            <strong>EutherList</strong>
            <span>${escapeHtml(documentState.sharedId || "Hemmet")}</span>
          </div>
        </div>
        <div class="top-actions">
          <span class="sync-pill is-${syncState}">${syncLabel(syncState)}</span>
          <button id="settings-open" class="icon-button" type="button" aria-label="Settings">⚙</button>
        </div>
      </header>

      <nav class="category-tabs" aria-label="Categories">
        ${categoryTabsMarkup(activeCategory)}
      </nav>

      <section class="list-summary">
        <strong>${openCount} kvar</strong>
        ${checkedCount > 0 ? `<button id="clear-checked" type="button">Clear checked (${checkedCount})</button>` : ""}
      </section>

      <section class="shopping-list" id="shopping-list">
        ${shoppingListMarkup(documentState, activeCategory)}
      </section>

      ${addItemBarMarkup()}
      ${settingsPanelMarkup(settings, settingsOpen)}
    </main>
  `;
}

function loginMarkup(): string {
  return `
    <main class="login-shell">
      <section class="login-card">
        <img src="${appIcon()}" alt="" />
        <h1>EutherList</h1>
        <p>Log in once. After that the list opens directly.</p>
        <form id="login-form">
          <label>
            Server
            <input id="login-server" type="url" value="${escapeHtml(settings.serverUrl)}" placeholder="https://apothictech.se" required />
          </label>
          <label>
            User
            <input id="login-user" type="text" value="${escapeHtml(settings.username)}" autocomplete="username" required />
          </label>
          <label>
            Password
            <input id="login-password" type="password" autocomplete="current-password" required />
          </label>
          <button type="submit">Open list</button>
        </form>
        ${loginMessage ? `<span class="login-message">${escapeHtml(loginMessage)}</span>` : ""}
      </section>
    </main>
  `;
}

function appIcon(): string {
  return settings.theme === "apothecary-dark" ? iconDark : iconLight;
}

function bindCommonActions(): void {
  document.querySelector<HTMLButtonElement>("#settings-open")?.addEventListener("click", () => {
    settingsOpen = true;
    render();
  });
  document.querySelector<HTMLButtonElement>("#settings-close")?.addEventListener("click", () => {
    settingsOpen = false;
    render();
  });
  document.querySelector<HTMLButtonElement>("#settings-save")?.addEventListener("click", () => {
    const server = document.querySelector<HTMLInputElement>("#settings-server");
    const theme = document.querySelector<HTMLSelectElement>("#settings-theme");
    settings = {
      ...settings,
      serverUrl: cleanServerUrl(server?.value ?? settings.serverUrl),
      theme: (theme?.value ?? settings.theme) as AppSettings["theme"],
    };
    store.saveSettings(settings);
    applyTheme(settings.theme);
    settingsOpen = false;
    render();
    scheduleSync(50);
  });
  document.querySelector<HTMLButtonElement>("#settings-logout")?.addEventListener("click", () => {
    settings = store.clearToken();
    syncState = "login";
    settingsOpen = false;
    render();
  });
}

function bindLoginActions(): void {
  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void login();
  });
}

function bindListActions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-category-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.categoryTab as ShoppingCategory | "Alla";
      render();
    });
  });
  document.querySelector<HTMLFormElement>("#add-item-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#add-item-input");
    const category = document.querySelector<HTMLSelectElement>("#add-item-category");
    addItem(input?.value ?? "", category?.value ?? "auto");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-item-toggle]").forEach((button) => {
    button.addEventListener("click", () => updateItem(button.dataset.itemToggle ?? "", (item) => ({
      ...item,
      checked: !item.checked,
      updatedAt: new Date().toISOString(),
    })));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-item-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      documentState = {
        ...documentState,
        items: documentState.items.filter((item) => item.id !== button.dataset.itemDelete),
      };
      commitLocalChange();
    });
  });
  document.querySelector<HTMLButtonElement>("#clear-checked")?.addEventListener("click", () => {
    documentState = {
      ...documentState,
      items: documentState.items.filter((item) => !item.checked),
    };
    commitLocalChange();
  });
}

async function login(): Promise<void> {
  const serverUrl = cleanServerUrl(document.querySelector<HTMLInputElement>("#login-server")?.value ?? settings.serverUrl);
  const username = document.querySelector<HTMLInputElement>("#login-user")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#login-password")?.value ?? "";
  syncState = "syncing";
  loginMessage = "Connecting";
  render();
  try {
    const result = await ShoppingApi.login(serverUrl, username, password);
    settings = {
      ...settings,
      serverUrl,
      username: result.user,
      token: result.token,
    };
    store.saveSettings(settings);
    loginMessage = "";
    syncState = "syncing";
    render();
    await syncFromStartup();
  } catch {
    syncState = "login";
    loginMessage = "Login failed";
    render();
  }
}

function addItem(text: string, categoryValue: string): void {
  const clean = text.trim();
  if (!clean || !documentState.canEdit) {
    return;
  }
  const category = categoryValue === "auto" ? inferCategory(clean) : normalizeCategory(categoryValue);
  documentState = {
    ...documentState,
    items: sortItems([...documentState.items, makeShoppingItem(clean, category)]),
  };
  commitLocalChange();
}

function updateItem(id: string, updater: (item: ShoppingItem) => ShoppingItem): void {
  documentState = {
    ...documentState,
    items: sortItems(documentState.items.map((item) => (item.id === id ? updater(item) : item))),
  };
  commitLocalChange();
}

function commitLocalChange(): void {
  const now = new Date().toISOString();
  documentState = {
    ...documentState,
    markdown: itemsToMarkdown(documentState.items),
    updatedAt: now,
  };
  store.saveDocument(documentState);
  store.setDirty(true);
  syncState = "dirty";
  render();
  scheduleSync(350);
}

async function syncFromStartup(): Promise<void> {
  syncState = "syncing";
  render();
  try {
    const remote = await new ShoppingApi(settings).loadList();
    if (store.isDirty()) {
      await pushLocal();
      return;
    }
    documentState = remote;
    store.saveDocument(documentState);
    store.setDirty(false);
    syncState = "saved";
  } catch {
    syncState = navigator.onLine ? "error" : "offline";
  }
  render();
}

function scheduleSync(delayMs: number): void {
  if (!settings.token) {
    return;
  }
  if (syncTimer !== null) {
    window.clearTimeout(syncTimer);
  }
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void pushLocal();
  }, delayMs);
}

async function pushLocal(): Promise<void> {
  if (!settings.token || !store.isDirty()) {
    return;
  }
  syncState = "syncing";
  render();
  try {
    const remote = await new ShoppingApi(settings).saveList(documentState);
    documentState = {
      ...remote,
      items: documentState.items,
      markdown: itemsToMarkdown(documentState.items),
    };
    store.saveDocument(documentState);
    store.setDirty(false);
    syncState = "saved";
  } catch {
    syncState = navigator.onLine ? "error" : "offline";
    scheduleSync(5000);
  }
  render();
}

function syncLabel(state: SyncState): string {
  switch (state) {
    case "offline":
      return "Offline";
    case "login":
      return "Login";
    case "syncing":
      return "Sync";
    case "saved":
      return "Saved";
    case "dirty":
      return "Saving";
    case "error":
      return "Retry";
  }
}
