const BASE_SERVINGS = 5;
const CATALOG_PATH = "./recipes/catalog.toml";

const state = {
  servings: BASE_SERVINGS,
  flavour: "original",
  recipes: [],
  checked: new Set(JSON.parse(localStorage.getItem("euthercook-shopping") || "[]")),
};

const recipeList = document.querySelector("#recipe-list");
const recipeTemplate = document.querySelector("#recipe-card-template");
const servingsValue = document.querySelector("#servings-value");
const shoppingList = document.querySelector("#shopping-list");
const shoppingCount = document.querySelector("#shopping-count");
const recipeDialog = document.querySelector("#recipe-dialog");
const recipeDialogContent = document.querySelector("#recipe-dialog-content");
const aboutDialog = document.querySelector("#about-dialog");

function stripComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && !escaped) quoted = !quoted;
    if (char === "#" && !quoted) return line.slice(0, index);
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  return line;
}

function parseTomlValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("[")) return JSON.parse(value);
  if (value === "true") return true;
  if (value === "false") return false;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}

function parseToml(source) {
  const root = {};
  let target = root;
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = stripComment(sourceLine).trim();
    if (!line) continue;
    const arrayTable = line.match(/^\[\[([a-zA-Z0-9_-]+)\]\]$/);
    if (arrayTable) {
      const key = arrayTable[1];
      root[key] ||= [];
      target = {};
      root[key].push(target);
      continue;
    }
    const table = line.match(/^\[([a-zA-Z0-9_-]+)\]$/);
    if (table) {
      const key = table[1];
      root[key] ||= {};
      target = root[key];
      continue;
    }
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    target[line.slice(0, equals).trim()] = parseTomlValue(line.slice(equals + 1));
  }
  return root;
}

async function loadToml(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Kunde inte läsa ${path}`);
  return parseToml(await response.text());
}

function formatAmount(amount) {
  if (!amount) return "";
  const scaled = amount * (state.servings / BASE_SERVINGS);
  const rounded = Math.round(scaled * 4) / 4;
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(rounded);
}

function ingredientAmount(ingredient) {
  const amount = formatAmount(ingredient.amount);
  return [amount, ingredient.unit].filter(Boolean).join(" ");
}

function flavourNote(recipe) {
  return recipe[`variation_${state.flavour}`] || recipe.variation_original;
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key] || "Övrigt";
    (groups[value] ||= []).push(item);
    return groups;
  }, {});
}

function renderRecipes() {
  recipeList.replaceChildren();
  state.recipes.forEach((recipe, index) => {
    const card = recipeTemplate.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".recipe-image");
    image.src = recipe.image;
    image.alt = recipe.image_alt;
    card.querySelector(".day-number").textContent = String(index + 1).padStart(2, "0");
    card.querySelector(".recipe-day").textContent = `${recipe.day} · ${recipe.meal} · ${recipe.mood}`;
    card.querySelector("h3").textContent = recipe.title;
    card.querySelector(".recipe-description").textContent = recipe.description;
    card.querySelector(".recipe-meta").innerHTML = [
      `${recipe.total_minutes} min`,
      `${state.servings} personer`,
      recipe.protein,
      recipe.difficulty,
    ]
      .map((value) => `<span>${escapeHtml(value)}</span>`)
      .join("");
    card.querySelector(".sauce-callout strong").textContent = recipe.sauce_name;
    card.querySelector(".sauce-callout p").textContent = flavourNote(recipe);
    card.querySelector(".open-recipe").addEventListener("click", () => openRecipe(recipe));
    const save = card.querySelector(".save-button");
    const savedKey = `euthercook-saved-${recipe.id}`;
    save.classList.toggle("saved", localStorage.getItem(savedKey) === "true");
    save.textContent = save.classList.contains("saved") ? "♥" : "♡";
    save.addEventListener("click", () => {
      save.classList.toggle("saved");
      save.textContent = save.classList.contains("saved") ? "♥" : "♡";
      localStorage.setItem(savedKey, String(save.classList.contains("saved")));
    });
    recipeList.append(card);
  });
  observeRecipeCards();
}

function openRecipe(recipe) {
  const groups = groupBy(recipe.ingredients, "group");
  const ingredientHtml = Object.entries(groups)
    .map(
      ([group, ingredients]) => `
        <section class="ingredient-group">
          <h4>${escapeHtml(group)}</h4>
          <ul>
            ${ingredients
              .map(
                (ingredient) => `
                  <li>
                    <span>${escapeHtml(ingredient.item)}</span>
                    <span>${escapeHtml(ingredientAmount(ingredient))}</span>
                  </li>`,
              )
              .join("")}
          </ul>
        </section>`,
    )
    .join("");
  const stepsHtml = recipe.steps
    .map(
      (step) => `
        <li>
          <strong>${escapeHtml(step.title)}</strong>
          <span>${escapeHtml(step.text)}</span>
        </li>`,
    )
    .join("");
  recipeDialogContent.innerHTML = `
    <div class="dialog-hero"><img src="${escapeHtml(recipe.image)}" alt="${escapeHtml(recipe.image_alt)}" /></div>
    <div class="dialog-body">
      <p class="eyebrow">${escapeHtml(recipe.day)} · ${escapeHtml(recipe.meal)} · ${state.servings} personer · ${recipe.total_minutes} min</p>
      <h2>${escapeHtml(recipe.title)}</h2>
      <p>${escapeHtml(recipe.description)}</p>
      <div class="sauce-callout">
        <span>Ditt smakläge</span>
        <strong>${escapeHtml(recipe.sauce_name)}</strong>
        <p>${escapeHtml(flavourNote(recipe))}</p>
      </div>
      <div class="dialog-columns">
        <div>
          <h3>Du behöver</h3>
          ${ingredientHtml}
        </div>
        <div>
          <h3>Gör så här</h3>
          <ol class="steps">${stepsHtml}</ol>
        </div>
      </div>
    </div>`;
  recipeDialog.showModal();
}

function shoppingKey(item) {
  return `${item.group}:${item.item}:${item.unit}`.toLowerCase();
}

function combinedIngredients() {
  const combined = new Map();
  for (const recipe of state.recipes) {
    for (const ingredient of recipe.ingredients) {
      const key = shoppingKey(ingredient);
      const current = combined.get(key);
      if (current) {
        current.amount += Number(ingredient.amount || 0);
      } else {
        combined.set(key, { ...ingredient, amount: Number(ingredient.amount || 0) });
      }
    }
  }
  return [...combined.values()];
}

function renderShoppingList() {
  const ingredients = combinedIngredients();
  const groups = groupBy(ingredients, "group");
  shoppingList.innerHTML = Object.entries(groups)
    .map(
      ([group, items]) => `
        <section class="shopping-group">
          <h3>${escapeHtml(group)}</h3>
          ${items
            .sort((a, b) => a.item.localeCompare(b.item, "sv"))
            .map((item) => {
              const key = shoppingKey(item);
              return `
                <label class="shopping-item">
                  <input type="checkbox" data-shopping-key="${escapeHtml(key)}" ${state.checked.has(key) ? "checked" : ""} />
                  <span>${escapeHtml(item.item)}</span>
                  <span class="shopping-amount">${escapeHtml(ingredientAmount(item))}</span>
                </label>`;
            })
            .join("")}
        </section>`,
    )
    .join("");
  shoppingCount.textContent = `${ingredients.length} varor`;
  shoppingList.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.checked.add(input.dataset.shoppingKey);
      else state.checked.delete(input.dataset.shoppingKey);
      localStorage.setItem("euthercook-shopping", JSON.stringify([...state.checked]));
    });
  });
}

function renderAll() {
  servingsValue.textContent = state.servings;
  document.querySelector(".cover-stamp").innerHTML = `${state.servings}<br><small>pers</small>`;
  const lunches = state.recipes.filter((recipe) => recipe.meal === "Lunch").length;
  const dinners = state.recipes.filter((recipe) => recipe.meal === "Middag").length;
  document.querySelector("#book-kicker").textContent =
    `Helgkokbok · ${lunches} luncher · ${dinners} middagar · ${state.servings} personer`;
  renderRecipes();
  renderShoppingList();
}

function setServings(next) {
  state.servings = Math.max(2, Math.min(12, next));
  renderAll();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function observeRecipeCards() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".recipe-card").forEach((card) => card.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 },
  );
  document.querySelectorAll(".recipe-card").forEach((card) => observer.observe(card));
}

function composeFromPrompt() {
  const prompt = document.querySelector("#book-prompt").value.trim();
  const status = document.querySelector("#prompt-status");
  const people = prompt.match(/(\d{1,2})\s*(?:person|pers)/i);
  if (people) state.servings = Math.max(2, Math.min(12, Number(people[1])));
  if (!/grek|souvlaki|gyros|tzatziki|bläckfisk/i.test(prompt)) {
    status.textContent = "Den här utgåvan är bunden kring Grekland. Skriv gärna in antal personer så skalar hela helgen.";
  } else {
    status.textContent = `Klart — den grekiska helgen är ombunden för ${state.servings} personer.`;
  }
  renderAll();
  document.querySelector("#helgen").scrollIntoView({ behavior: "smooth" });
}

document.querySelector("#servings-minus").addEventListener("click", () => setServings(state.servings - 1));
document.querySelector("#servings-plus").addEventListener("click", () => setServings(state.servings + 1));
document.querySelector("#compose-book").addEventListener("click", composeFromPrompt);
document.querySelector("#print-book").addEventListener("click", () => window.print());
document.querySelectorAll('input[name="flavour"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.flavour = input.value;
    renderRecipes();
  });
});
document.querySelector("#clear-shopping").addEventListener("click", () => {
  state.checked.clear();
  localStorage.removeItem("euthercook-shopping");
  renderShoppingList();
});
document.querySelector("#close-recipe").addEventListener("click", () => recipeDialog.close());
document.querySelector("#open-about").addEventListener("click", () => aboutDialog.showModal());
document.querySelector("#close-about").addEventListener("click", () => aboutDialog.close());
[recipeDialog, aboutDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

async function init() {
  try {
    const catalog = await loadToml(CATALOG_PATH);
    state.recipes = await Promise.all(catalog.recipes.map((path) => loadToml(`./recipes/${path}`)));
    renderAll();
  } catch (error) {
    recipeList.innerHTML = `<p>Kokboken gick inte att läsa: ${escapeHtml(error.message)}</p>`;
  }
}

init();
