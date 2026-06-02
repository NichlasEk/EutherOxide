import { AppSettings, ThemeName } from "../types";
import { themes } from "../theme/ThemeProvider";
import { escapeHtml } from "./ItemRow";

export function settingsPanelMarkup(settings: AppSettings, open: boolean): string {
  return `
    <aside class="settings-panel ${open ? "is-open" : ""}" id="settings-panel" aria-hidden="${open ? "false" : "true"}">
      <div class="settings-sheet">
        <div class="settings-head">
          <strong>Settings</strong>
          <button id="settings-close" type="button" aria-label="Close settings">×</button>
        </div>
        <label>
          Server
          <input id="settings-server" type="url" value="${escapeHtml(settings.serverUrl)}" placeholder="https://apothictech.se" />
        </label>
        <label>
          Theme
          <select id="settings-theme">
            ${themes.map((theme) => themeOption(theme.id, theme.label, settings.theme)).join("")}
          </select>
        </label>
        <div class="settings-user">
          <span>Signed in as</span>
          <strong>${escapeHtml(settings.username || "No one")}</strong>
        </div>
        <button id="settings-save" class="wide-button" type="button">Save settings</button>
        <button id="settings-logout" class="wide-button subtle" type="button">Log out on this phone</button>
      </div>
    </aside>
  `;
}

function themeOption(id: ThemeName, label: string, selected: ThemeName): string {
  return `<option value="${id}" ${id === selected ? "selected" : ""}>${label}</option>`;
}
