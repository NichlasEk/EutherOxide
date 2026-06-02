import { itemRowMarkup } from "./ItemRow";
import { ShoppingCategory, ShoppingListDocument } from "../types";

export function shoppingListMarkup(document: ShoppingListDocument, activeCategory: ShoppingCategory | "Alla"): string {
  const visibleItems = document.items.filter(
    (item) => activeCategory === "Alla" || (item.category ?? "Övrigt") === activeCategory,
  );
  if (visibleItems.length === 0) {
    return `<div class="empty-list">Inget på listan.</div>`;
  }
  const groups = new Map<string, typeof visibleItems>();
  for (const item of visibleItems) {
    const key = item.category ?? "Övrigt";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries())
    .map(
      ([category, items]) => `
        <section class="list-section">
          <div class="list-section-head">
            <strong>${category}</strong>
            <span>${items.filter((item) => !item.checked).length}/${items.length}</span>
          </div>
          ${items.map(itemRowMarkup).join("")}
        </section>
      `,
    )
    .join("");
}
