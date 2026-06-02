import { shoppingCategories } from "../types";

export function addItemBarMarkup(): string {
  return `
    <form class="add-bar" id="add-item-form">
      <input id="add-item-input" type="text" autocomplete="off" placeholder="Lägg till vara" aria-label="Lägg till vara" />
      <select id="add-item-category" aria-label="Kategori">
        <option value="auto">Auto</option>
        ${shoppingCategories.map((category) => `<option value="${category}">${category}</option>`).join("")}
      </select>
      <button type="submit" aria-label="Lägg till">+</button>
    </form>
  `;
}
