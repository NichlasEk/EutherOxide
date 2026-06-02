import { ShoppingCategory, shoppingCategories } from "../types";

export function categoryTabsMarkup(active: ShoppingCategory | "Alla"): string {
  const categories: Array<ShoppingCategory | "Alla"> = ["Alla", ...shoppingCategories, "Övrigt"];
  return categories
    .map(
      (category) => `
        <button class="category-tab ${category === active ? "is-active" : ""}" data-category-tab="${category}" type="button">
          ${category}
        </button>
      `,
    )
    .join("");
}
