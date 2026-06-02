export const shoppingCategories = [
  "Kyl",
  "Skafferi",
  "Bröd",
  "Frukt & grönt",
  "Frys",
  "Hushåll",
] as const;

export type ShoppingCategory = (typeof shoppingCategories)[number] | "Övrigt";

export type ShoppingItem = {
  id: string;
  text: string;
  category?: ShoppingCategory;
  checked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ShoppingListDocument = {
  name: string;
  sharedId: string;
  items: ShoppingItem[];
  markdown: string;
  updatedAt: string;
  canEdit: boolean;
  canManage: boolean;
  members: ShoppingMember[];
};

export type ShoppingMember = {
  name: string;
  role: "owner" | "edit" | "view";
  isCurrentUser?: boolean;
};

export type AppSettings = {
  serverUrl: string;
  username: string;
  token: string;
  theme: ThemeName;
};

export type ThemeName = "joanna-light" | "euther" | "apothecary-dark";

export type SyncState = "offline" | "login" | "syncing" | "saved" | "dirty" | "error";
