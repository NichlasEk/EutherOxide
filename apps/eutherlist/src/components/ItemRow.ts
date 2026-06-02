import { ShoppingItem } from "../types";

export function itemRowMarkup(item: ShoppingItem): string {
  return `
    <div class="item-row ${item.checked ? "is-checked" : ""}" data-item-id="${item.id}">
      <button class="item-check" data-item-toggle="${item.id}" type="button" aria-label="${item.checked ? "Markera som kvar" : "Markera köpt"}">
        <span></span>
      </button>
      <span class="item-text">${escapeHtml(item.text)}</span>
      <button class="item-delete" data-item-delete="${item.id}" type="button" aria-label="Ta bort">×</button>
    </div>
  `;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
