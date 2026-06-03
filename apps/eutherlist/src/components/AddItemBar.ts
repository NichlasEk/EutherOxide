import { ShoppingCategory, shoppingCategories } from "../types";

export function addItemBarMarkup(activeCategory: ShoppingCategory | "Alla"): string {
  const selectedCategory = activeCategory === "Alla" ? "auto" : activeCategory;
  return `
    <form class="add-bar" id="add-item-form">
      <input id="add-item-input" type="text" autocomplete="off" placeholder="Lägg till vara" aria-label="Lägg till vara" />
      <select id="add-item-category" aria-label="Kategori">
        <option value="auto"${selectedCategory === "auto" ? " selected" : ""}>Auto</option>
        ${shoppingCategories
          .map((category) => `<option value="${category}"${selectedCategory === category ? " selected" : ""}>${category}</option>`)
          .join("")}
      </select>
      <button type="submit" aria-label="Lägg till">+</button>
    </form>
  `;
}
