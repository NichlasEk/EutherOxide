import "./styles.css";
import "./themes/joanna-light.css";
import "./themes/euther.css";
import "./themes/apothecary-dark.css";

import iconDark from "./assets/eutherlist-icon-dark.svg";
import iconLight from "./assets/eutherlist-icon-light.svg";
import {
  ShoppingApi,
  cleanActiveServerUrl,
  cleanLanServerUrl,
  cleanOptionalServerUrl,
  cleanServerUrl,
} from "./api/ShoppingApi";
import { addItemBarMarkup } from "./components/AddItemBar";
import { categoryTabsMarkup } from "./components/CategoryTabs";
import { escapeHtml } from "./components/ItemRow";
import { settingsPanelMarkup } from "./components/SettingsPanel";
import { shoppingListMarkup } from "./components/ShoppingList";
import { LocalStore } from "./storage/LocalStore";
import { applyTheme } from "./theme/ThemeProvider";
import { AppSettings, ShoppingCategory, ShoppingItem, ShoppingNamedList, SyncState, UserPreferences } from "./types";
import {
  cleanListTitle,
  inferCategory,
  listsToMarkdown,
  makeShoppingItem,
  makeShoppingList,
  normalizeCategory,
  sortItems,
} from "./shoppingMarkdown";

const store = new LocalStore();
const root = document.querySelector<HTMLDivElement>("#app")!;

let settings = store.loadSettings();
let documentState = store.loadDocument();
let syncState: SyncState = settings.token ? (store.isDirty() ? "dirty" : "saved") : "login";
let activeCategory: ShoppingCategory | "Alla" = "Alla";
let settingsOpen = false;
let activeListIndex = 0;
let searchQuery = "";
let syncTimer: number | null = null;
let loginMessage = "";
let lastSyncError = "";
let deferredRemoteRenderTimer: number | null = null;
let addItemEditing = false;
let addItemDraft: AddItemDraft | null = null;
let userPreferences: UserPreferences | null = null;

type AddItemDraft = {
  text: string;
  category: string;
};

applyTheme(settings.theme);
applyFontScale(settings.eutherlistFontScale);
render();
if (settings.token) {
  void syncFromStartup();
}
window.addEventListener("online", () => scheduleSync(50));

function render(focusSearch = false): void {
  root.innerHTML = settings.token ? appMarkup() : loginMarkup();
  bindCommonActions();
  if (settings.token) {
    bindListActions();
  } else {
    bindLoginActions();
  }
  if (focusSearch) {
    const search = document.querySelector<HTMLInputElement>("#list-search");
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
}

function setSyncState(state: SyncState, error = ""): void {
  syncState = state;
  lastSyncError = error;
  renderSyncStatus();
}

function renderSyncStatus(): void {
  const pill = document.querySelector<HTMLSpanElement>(".sync-pill");
  if (!pill) {
    return;
  }
  pill.textContent = syncLabel(syncState);
  pill.className = `sync-pill is-${syncState}`;
  const detail = document.querySelector<HTMLSpanElement>(".sync-detail");
  if (detail) {
    detail.textContent = syncDetail(syncState);
  }
  const status = document.querySelector<HTMLDivElement>(".sync-status");
  if (status) {
    status.title = syncTitle(syncState);
  }
}

function rememberActiveServer(serverUrl: string): void {
  const activeServerUrl = cleanOptionalServerUrl(serverUrl);
  if (!activeServerUrl || activeServerUrl === settings.activeServerUrl) {
    return;
  }
  settings = { ...settings, activeServerUrl };
  store.saveSettings(settings);
}

function renderRemoteUpdate(): void {
  if (shouldDeferAddItemRender()) {
    if (deferredRemoteRenderTimer === null) {
      deferredRemoteRenderTimer = window.setTimeout(() => {
        deferredRemoteRenderTimer = null;
        renderRemoteUpdate();
      }, 600);
    }
    return;
  }
  render();
  restoreAddItemDraft(addItemDraft);
}

function shouldDeferAddItemRender(): boolean {
  const draft = captureAddItemDraft();
  if (draft) {
    addItemDraft = draft;
  }
  return addItemEditing || addItemFormHasFocus() || Boolean(addItemDraft?.text.trim());
}

function addItemFormHasFocus(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.closest("#add-item-form") !== null;
}

function captureAddItemDraft(): AddItemDraft | null {
  const input = document.querySelector<HTMLInputElement>("#add-item-input");
  const category = document.querySelector<HTMLSelectElement>("#add-item-category");
  if (!input || !category) {
    return null;
  }
  return {
    text: input.value,
    category: category.value,
  };
}

function restoreAddItemDraft(draft: AddItemDraft | null): void {
  if (!draft) {
    return;
  }
  const input = document.querySelector<HTMLInputElement>("#add-item-input");
  const category = document.querySelector<HTMLSelectElement>("#add-item-category");
  if (input) {
    input.value = draft.text;
  }
  if (category) {
    category.value = draft.category;
  }
}

function appMarkup(): string {
  activeListIndex = clampListIndex(activeListIndex);
  const activeList = getActiveList();
  const openCount = activeList.items.filter((item) => !item.checked).length;
  const checkedCount = activeList.items.length - openCount;
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
          <div class="sync-status" title="${escapeHtml(syncTitle(syncState))}">
            <span class="sync-pill is-${syncState}">${syncLabel(syncState)}</span>
            <span class="sync-detail">${escapeHtml(syncDetail(syncState))}</span>
          </div>
          <button id="settings-open" class="icon-button" type="button" aria-label="Settings">⚙</button>
        </div>
      </header>

      <section class="list-switcher" id="list-swipe-zone">
        <button class="icon-button" id="list-prev" type="button" aria-label="Föregående lista">‹</button>
        <label class="list-title-field">
          <input id="list-title-input" type="text" value="${escapeHtml(activeList.title)}" aria-label="Listrubrik" ${documentState.canEdit ? "" : "disabled"} />
          <span>${activeListIndex + 1} av ${documentState.lists.length} · ${activeList.items.length} rader</span>
        </label>
        <button class="icon-button" id="list-next" type="button" aria-label="Nästa lista">›</button>
        <button class="icon-button" id="list-new" type="button" aria-label="Ny lista">+</button>
      </section>

      ${addItemBarMarkup(activeCategory)}

      <section class="search-bar">
        <input id="list-search" type="search" value="${escapeHtml(searchQuery)}" placeholder="Sök listor" aria-label="Sök listor" />
        ${searchQuery ? `<button id="search-clear" type="button" aria-label="Rensa sök">×</button>` : ""}
      </section>

      ${searchResultsMarkup()}

      <nav class="category-tabs" aria-label="Categories">
        ${categoryTabsMarkup(activeCategory)}
      </nav>

      <section class="list-summary">
        <strong>${openCount} kvar</strong>
        ${checkedCount > 0 ? `<button id="clear-checked" type="button">Clear checked (${checkedCount})</button>` : ""}
      </section>

      <section class="shopping-list" id="shopping-list">
        ${shoppingListMarkup({ ...documentState, items: activeList.items }, activeCategory)}
      </section>

      ${settingsPanelMarkup(settings, settingsOpen)}
    </main>
`;
}

function searchResultsMarkup(): string {
  const query = searchQuery.trim();
  if (!query) {
    return "";
  }
  const results = listSearchResults(query);
  if (results.length === 0) {
    return `<section class="search-results"><span>Inga träffar</span></section>`;
  }
  return `
    <section class="search-results" aria-label="Sökresultat">
      ${results
        .map(
          ({ list, index, matchCount }) => `
            <button class="search-result" data-search-list="${index}" type="button">
              <strong>${escapeHtml(list.title)}</strong>
              <span>${matchCount} träff${matchCount === 1 ? "" : "ar"} · ${list.items.length} rader</span>
            </button>
          `,
        )
        .join("")}
    </section>
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
            LAN fallback
            <input id="login-lan-server" type="text" inputmode="url" value="${escapeHtml(settings.lanServerUrl)}" placeholder="LAN-IP" />
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
  const fontScale = document.querySelector<HTMLInputElement>("#settings-font-scale");
  const fontScaleLabel = document.querySelector<HTMLElement>("#settings-font-scale-label");
  fontScale?.addEventListener("input", () => {
    const nextScale = cleanFontScale(Number(fontScale.value) / 100);
    if (fontScaleLabel) {
      fontScaleLabel.textContent = `${Math.round(nextScale * 100)}%`;
    }
    applyFontScale(nextScale);
  });
  document.querySelector<HTMLButtonElement>("#settings-save")?.addEventListener("click", () => {
    const server = document.querySelector<HTMLInputElement>("#settings-server");
    const lanServer = document.querySelector<HTMLInputElement>("#settings-lan-server");
    const theme = document.querySelector<HTMLSelectElement>("#settings-theme");
    const nextFontScale = cleanFontScale(Number(fontScale?.value ?? settings.eutherlistFontScale * 100) / 100);
    const nextSettings = {
      ...settings,
      serverUrl: cleanServerUrl(server?.value ?? settings.serverUrl),
      lanServerUrl: cleanLanServerUrl(lanServer?.value ?? settings.lanServerUrl),
      theme: (theme?.value ?? settings.theme) as AppSettings["theme"],
      eutherlistFontScale: nextFontScale,
    };
    settings = { ...nextSettings, activeServerUrl: cleanActiveServerUrl(nextSettings) };
    store.saveSettings(settings);
    applyTheme(settings.theme);
    applyFontScale(settings.eutherlistFontScale);
    settingsOpen = false;
    render();
    void saveUserFontScale(nextFontScale);
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
  document.querySelector<HTMLButtonElement>("#list-prev")?.addEventListener("click", () => switchList(-1));
  document.querySelector<HTMLButtonElement>("#list-next")?.addEventListener("click", () => switchList(1));
  document.querySelector<HTMLButtonElement>("#list-new")?.addEventListener("click", () => addList());
  const titleInput = document.querySelector<HTMLInputElement>("#list-title-input");
  titleInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      titleInput.blur();
    }
  });
  titleInput?.addEventListener("blur", () => updateActiveListTitle(titleInput.value));
  const search = document.querySelector<HTMLInputElement>("#list-search");
  search?.addEventListener("input", () => {
    searchQuery = search.value;
    render(true);
  });
  document.querySelector<HTMLButtonElement>("#search-clear")?.addEventListener("click", () => {
    searchQuery = "";
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-search-list]").forEach((button) => {
    button.addEventListener("click", () => {
      activeListIndex = Number(button.dataset.searchList ?? activeListIndex);
      activeCategory = "Alla";
      searchQuery = "";
      render();
    });
  });
  bindSwipeActions();
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
    addItem(input?.value ?? "", category?.value ?? "auto", category?.value ?? "auto");
  });
  const addForm = document.querySelector<HTMLFormElement>("#add-item-form");
  const addInput = document.querySelector<HTMLInputElement>("#add-item-input");
  const addCategory = document.querySelector<HTMLSelectElement>("#add-item-category");
  addForm?.addEventListener("focusin", () => {
    addItemEditing = true;
    addItemDraft = captureAddItemDraft();
  });
  addForm?.addEventListener("focusout", () => {
    addItemDraft = captureAddItemDraft();
    window.setTimeout(() => {
      addItemEditing = addItemFormHasFocus();
    }, 900);
  });
  addInput?.addEventListener("input", () => {
    addItemEditing = true;
    addItemDraft = captureAddItemDraft();
  });
  addCategory?.addEventListener("change", () => {
    addItemDraft = captureAddItemDraft();
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
      updateActiveList((list) => ({
        ...list,
        items: list.items.filter((item) => item.id !== button.dataset.itemDelete),
      }));
      commitLocalChange();
    });
  });
  document.querySelector<HTMLButtonElement>("#clear-checked")?.addEventListener("click", () => {
    updateActiveList((list) => ({
      ...list,
      items: list.items.filter((item) => !item.checked),
    }));
    commitLocalChange();
  });
}

async function login(): Promise<void> {
  const serverUrl = cleanServerUrl(document.querySelector<HTMLInputElement>("#login-server")?.value ?? settings.serverUrl);
  const lanServerUrl = cleanLanServerUrl(
    document.querySelector<HTMLInputElement>("#login-lan-server")?.value ?? settings.lanServerUrl,
  );
  const username = document.querySelector<HTMLInputElement>("#login-user")?.value.trim() ?? "";
  const password = document.querySelector<HTMLInputElement>("#login-password")?.value ?? "";
  syncState = "syncing";
  loginMessage = "Connecting";
  render();
  try {
    const result = await ShoppingApi.login({ serverUrl, lanServerUrl }, username, password);
    settings = {
      ...settings,
      serverUrl,
      lanServerUrl: cleanLanServerUrl(result.lanServerUrl ?? "") || lanServerUrl,
      activeServerUrl: cleanLanServerUrl(result.lanServerUrl ?? "") || result.serverUrl,
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

function addItem(text: string, categoryValue: string, nextCategoryValue = categoryValue): void {
  const clean = text.trim();
  if (!clean || !documentState.canEdit) {
    return;
  }
  const category = categoryValue === "auto" ? inferCategory(clean) : normalizeCategory(categoryValue);
  updateActiveList((list) => ({
    ...list,
    items: sortItems([...list.items, makeShoppingItem(clean, category)]),
  }));
  addItemDraft = { text: "", category: nextCategoryValue };
  addItemEditing = true;
  commitLocalChange();
  restoreAddItemDraft({ text: "", category: nextCategoryValue });
  document.querySelector<HTMLInputElement>("#add-item-input")?.focus();
}

function updateItem(id: string, updater: (item: ShoppingItem) => ShoppingItem): void {
  updateActiveList((list) => ({
    ...list,
    items: sortItems(list.items.map((item) => (item.id === id ? updater(item) : item))),
  }));
  commitLocalChange();
}

function commitLocalChange(): void {
  const now = new Date().toISOString();
  const activeList = getActiveList();
  documentState = {
    ...documentState,
    lists: documentState.lists.map((list, index) =>
      index === activeListIndex ? { ...list, updatedAt: now } : list,
    ),
    items: activeList.items,
    markdown: listsToMarkdown(documentState.lists),
    updatedAt: now,
  };
  store.saveDocument(documentState);
  store.setDirty(true);
  lastSyncError = "";
  syncState = "dirty";
  render();
  scheduleSync(350);
}

async function syncFromStartup(): Promise<void> {
  setSyncState("syncing");
  let remoteChanged = false;
  try {
    const api = new ShoppingApi(settings);
    const status = await api.status();
    rememberActiveServer(api.activeServerUrl);
    applyServerLanUrl(status.lanServerUrl);
    await syncUserPreferences(api);
    const listApi = new ShoppingApi(settings);
    const remote = await listApi.loadList();
    rememberActiveServer(listApi.activeServerUrl);
    if (store.isDirty()) {
      await pushLocal();
      return;
    }
    documentState = remote;
    activeListIndex = clampListIndex(activeListIndex);
    store.saveDocument(documentState);
    store.setDirty(false);
    remoteChanged = true;
    setSyncState("saved");
  } catch (error) {
    setSyncState(navigator.onLine ? "error" : "offline", syncErrorMessage(error));
    scheduleSync(5000);
  }
  if (remoteChanged) {
    renderRemoteUpdate();
  }
}

async function syncUserPreferences(api: ShoppingApi): Promise<void> {
  try {
    userPreferences = await api.preferences();
    rememberActiveServer(api.activeServerUrl);
    const nextScale = cleanFontScale(Number(userPreferences.eutherlistFontScale ?? settings.eutherlistFontScale));
    if (nextScale !== settings.eutherlistFontScale) {
      settings = { ...settings, eutherlistFontScale: nextScale };
      store.saveSettings(settings);
    }
    applyFontScale(nextScale);
  } catch (error) {
    lastSyncError = syncErrorMessage(error);
  }
}

async function saveUserFontScale(fontScale: number): Promise<void> {
  if (!settings.token) {
    return;
  }
  try {
    const api = new ShoppingApi(settings);
    const preferences = userPreferences ?? await api.preferences();
    userPreferences = await api.savePreferences({
      ...preferences,
      eutherlistFontScale: cleanFontScale(fontScale),
    });
    rememberActiveServer(api.activeServerUrl);
  } catch (error) {
    setSyncState(navigator.onLine ? "error" : "offline", syncErrorMessage(error));
    scheduleSync(5000);
  }
}

function applyFontScale(fontScale: number): void {
  document.documentElement.style.setProperty("--eutherlist-font-scale", cleanFontScale(fontScale).toFixed(3));
}

function cleanFontScale(value: number): number {
  return Number.isFinite(value) ? Math.max(0.72, Math.min(1.2, value)) : 1;
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
    void (store.isDirty() ? pushLocal() : syncFromStartup());
  }, delayMs);
}

async function pushLocal(): Promise<void> {
  if (!settings.token || !store.isDirty()) {
    return;
  }
  setSyncState("syncing");
  try {
    const localLists = documentState.lists;
    const api = new ShoppingApi(settings);
    const remote = await api.saveList(documentState);
    rememberActiveServer(api.activeServerUrl);
    activeListIndex = clampListIndex(activeListIndex);
    documentState = {
      ...remote,
      lists: localLists,
      items: localLists[activeListIndex]?.items ?? [],
      markdown: listsToMarkdown(localLists),
    };
    store.saveDocument(documentState);
    store.setDirty(false);
    setSyncState("saved");
  } catch (error) {
    setSyncState(navigator.onLine ? "error" : "offline", syncErrorMessage(error));
    scheduleSync(5000);
  }
}

function getActiveList(): ShoppingNamedList {
  activeListIndex = clampListIndex(activeListIndex);
  return documentState.lists[activeListIndex];
}

function clampListIndex(index: number): number {
  const listCount = documentState.lists.length;
  if (listCount === 0) {
    documentState = {
      ...documentState,
      lists: [makeShoppingList("Hemmet", documentState.items)],
    };
    return 0;
  }
  return Math.max(0, Math.min(index, listCount - 1));
}

function updateActiveList(updater: (list: ShoppingNamedList) => ShoppingNamedList): void {
  activeListIndex = clampListIndex(activeListIndex);
  documentState = {
    ...documentState,
    lists: documentState.lists.map((list, index) => (index === activeListIndex ? updater(list) : list)),
  };
}

function updateActiveListTitle(value: string): void {
  const title = cleanListTitle(value);
  if (title === getActiveList().title) {
    return;
  }
  updateActiveList((list) => ({ ...list, title }));
  commitLocalChange();
}

function addList(): void {
  if (!documentState.canEdit) {
    return;
  }
  const title = `Lista ${documentState.lists.length + 1}`;
  documentState = {
    ...documentState,
    lists: [...documentState.lists, makeShoppingList(title)],
  };
  activeListIndex = documentState.lists.length - 1;
  activeCategory = "Alla";
  commitLocalChange();
}

function switchList(direction: -1 | 1): void {
  const listCount = documentState.lists.length;
  if (listCount < 2) {
    return;
  }
  activeListIndex = (activeListIndex + direction + listCount) % listCount;
  activeCategory = "Alla";
  render();
}

function bindSwipeActions(): void {
  const zone = document.querySelector<HTMLElement>("#shopping-list");
  let startX = 0;
  let startY = 0;
  zone?.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: true },
  );
  zone?.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      if (Math.abs(deltaX) < 70 || Math.abs(deltaY) > 60) {
        return;
      }
      switchList(deltaX < 0 ? 1 : -1);
    },
    { passive: true },
  );
}

function listSearchResults(query: string): Array<{ list: ShoppingNamedList; index: number; matchCount: number }> {
  const normalizedQuery = normalizeSearch(query);
  return documentState.lists
    .map((list, index) => {
      const titleMatch = normalizeSearch(list.title).includes(normalizedQuery) ? 1 : 0;
      const itemMatches = list.items.filter((item) => normalizeSearch(item.text).includes(normalizedQuery)).length;
      return { list, index, matchCount: titleMatch + itemMatches };
    })
    .filter((result) => result.matchCount > 0);
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
      return "Active";
    case "dirty":
      return "Saving";
    case "error":
      return "Retry";
  }
}

function syncDetail(state: SyncState): string {
  switch (state) {
    case "offline":
      return "No network";
    case "login":
      return "Login required";
    case "syncing":
      return settings.activeServerUrl ? `Checking ${serverLabel(settings.activeServerUrl)}` : "Checking server";
    case "saved":
      return settings.activeServerUrl ? `Synced via ${serverLabel(settings.activeServerUrl)}` : "Synced";
    case "dirty":
      return settings.activeServerUrl ? `Saving to ${serverLabel(settings.activeServerUrl)}` : "Saving";
    case "error":
      return settings.activeServerUrl ? `Retry via ${serverLabel(settings.activeServerUrl)}` : retryDetail();
  }
}

function retryDetail(): string {
  return settings.lanServerUrl ? "Trying primary + LAN" : "Trying primary";
}

function syncTitle(state: SyncState): string {
  const parts = [syncDetail(state)];
  if (settings.activeServerUrl) {
    parts.push(settings.activeServerUrl);
  }
  if (state === "error" && lastSyncError) {
    parts.push(lastSyncError);
  }
  return parts.join(" · ");
}

function serverLabel(serverUrl: string): string {
  const cleanUrl = cleanServerUrl(serverUrl);
  if (settings.lanServerUrl && cleanUrl === cleanLanServerUrl(settings.lanServerUrl)) {
    return "LAN";
  }
  if (cleanUrl === cleanServerUrl(settings.serverUrl)) {
    return "primary";
  }
  try {
    return new URL(cleanUrl).host;
  } catch {
    return "server";
  }
}

function syncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sync request failed";
}

function applyServerLanUrl(value: string | undefined): void {
  const lanServerUrl = cleanLanServerUrl(value ?? "");
  if (!lanServerUrl || lanServerUrl === settings.lanServerUrl) {
    return;
  }
  const nextSettings = { ...settings, lanServerUrl, activeServerUrl: lanServerUrl };
  settings = { ...nextSettings, activeServerUrl: cleanActiveServerUrl(nextSettings) };
  store.saveSettings(settings);
}
