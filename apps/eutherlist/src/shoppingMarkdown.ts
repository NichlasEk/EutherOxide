import { ShoppingCategory, ShoppingItem, shoppingCategories } from "./types";

const categoryAliases = new Map<string, ShoppingCategory>([
  ["kyl", "Kyl"],
  ["kylen", "Kyl"],
  ["mejeri", "Kyl"],
  ["skafferi", "Skafferi"],
  ["torrvaror", "Skafferi"],
  ["brod", "Bröd"],
  ["bröd", "Bröd"],
  ["frukt and gront", "Frukt & grönt"],
  ["frukt gront", "Frukt & grönt"],
  ["frukt grönt", "Frukt & grönt"],
  ["gronsaker", "Frukt & grönt"],
  ["grönsaker", "Frukt & grönt"],
  ["frys", "Frys"],
  ["frysen", "Frys"],
  ["hushall", "Hushåll"],
  ["hushåll", "Hushåll"],
  ["hem stad", "Hushåll"],
  ["hem städ", "Hushåll"],
]);

const categoryKeywords: Array<{ category: ShoppingCategory; words: string[] }> = [
  { category: "Kyl", words: ["mjölk", "fil", "yoghurt", "ost", "smör", "ägg", "grädde", "creme fraiche"] },
  { category: "Bröd", words: ["bröd", "knäcke", "baguette", "tortilla", "korvbröd", "hamburgerbröd"] },
  { category: "Frukt & grönt", words: ["banan", "äpple", "tomat", "gurka", "sallad", "potatis", "lök", "morot", "paprika"] },
  { category: "Frys", words: ["fryst", "glass", "frysta", "fiskpinnar", "wok", "pizza"] },
  { category: "Hushåll", words: ["toapapper", "hushållspapper", "tvättmedel", "diskmedel", "batterier", "soppåsar"] },
];

export function defaultShoppingList(): ShoppingListDocumentSeed {
  const now = new Date().toISOString();
  const items: ShoppingItem[] = [
    makeShoppingItem("Mjölk", "Kyl", now),
    makeShoppingItem("Kaffe", "Skafferi", now),
    makeShoppingItem("Bananer", "Frukt & grönt", now),
  ];
  return {
    name: "shopping-list.md",
    sharedId: "local",
    items,
    markdown: itemsToMarkdown(items),
    updatedAt: now,
    canEdit: true,
    canManage: true,
    members: [],
  };
}

type ShoppingListDocumentSeed = {
  name: string;
  sharedId: string;
  items: ShoppingItem[];
  markdown: string;
  updatedAt: string;
  canEdit: boolean;
  canManage: boolean;
  members: [];
};

export function makeShoppingItem(text: string, category?: ShoppingCategory, now = new Date().toISOString()): ShoppingItem {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    text: text.trim(),
    category: category ?? inferCategory(text),
    checked: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function markdownToItems(markdown: string, updatedAt = new Date().toISOString()): ShoppingItem[] {
  const items: ShoppingItem[] = [];
  let category: ShoppingCategory = "Övrigt";
  markdown.split("\n").forEach((line, index) => {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      category = normalizeCategory(heading[1]);
      return;
    }
    const item = line.match(/^\s*-\s+\[( |x|X)\]\s+(.+?)\s*$/);
    if (!item) {
      return;
    }
    const text = item[2].trim();
    items.push({
      id: stableItemId(category, text, index),
      text,
      category,
      checked: item[1].toLowerCase() === "x",
      createdAt: updatedAt,
      updatedAt,
    });
  });
  return sortItems(items);
}

export function itemsToMarkdown(items: ShoppingItem[]): string {
  const lines = ["# Hemmet Shopping List", ""];
  for (const category of orderedCategories(items)) {
    const group = sortItems(items.filter((item) => normalizeCategory(item.category ?? "Övrigt") === category));
    if (group.length === 0) {
      continue;
    }
    lines.push(`## ${category}`);
    for (const item of group) {
      lines.push(`- [${item.checked ? "x" : " "}] ${item.text}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function sortItems(items: ShoppingItem[]): ShoppingItem[] {
  return [...items].sort((left, right) => {
    if (left.checked !== right.checked) {
      return left.checked ? 1 : -1;
    }
    const categoryRank = categoryIndex(left.category) - categoryIndex(right.category);
    if (categoryRank !== 0) {
      return categoryRank;
    }
    return left.text.localeCompare(right.text, "sv", { sensitivity: "base", numeric: true });
  });
}

export function inferCategory(text: string): ShoppingCategory {
  const lookup = lookupKey(text);
  const words = new Set(lookup.split(" ").filter(Boolean));
  for (const rule of categoryKeywords) {
    if (
      rule.words.some((word) => {
        const normalized = lookupKey(word);
        return normalized.includes(" ") ? lookup.includes(normalized) : words.has(normalized);
      })
    ) {
      return rule.category;
    }
  }
  return "Skafferi";
}

export function normalizeCategory(value: string): ShoppingCategory {
  const normalized = lookupKey(value);
  const alias = categoryAliases.get(normalized);
  if (alias) {
    return alias;
  }
  const known = shoppingCategories.find((category) => lookupKey(category) === normalized);
  return known ?? "Övrigt";
}

function orderedCategories(items: ShoppingItem[]): ShoppingCategory[] {
  const present = new Set(items.map((item) => normalizeCategory(item.category ?? "Övrigt")));
  const categories: ShoppingCategory[] = [...shoppingCategories, "Övrigt"];
  return categories.filter((category) => present.has(category));
}

function categoryIndex(category: string | undefined): number {
  const normalized = normalizeCategory(category ?? "Övrigt");
  const index = [...shoppingCategories, "Övrigt"].indexOf(normalized);
  return index < 0 ? shoppingCategories.length : index;
}

function stableItemId(category: ShoppingCategory, text: string, index: number): string {
  let hash = 0;
  const value = `${category}|${text}|${index}`;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `remote-${hash.toString(36)}`;
}

function lookupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
