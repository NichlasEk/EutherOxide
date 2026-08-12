const BASE_SERVINGS = 5;
const CATALOG_PATH = "./recipes/catalog.toml";

const state = {
  servings: BASE_SERVINGS,
  flavour: "original",
  recipes: [],
  library: [],
  concepts: [],
  activeConcept: null,
  recipeByPath: new Map(),
  checked: new Set(),
};

const recipeList = document.querySelector("#recipe-list");
const recipeTemplate = document.querySelector("#recipe-card-template");
const servingsValue = document.querySelector("#servings-value");
const shoppingList = document.querySelector("#shopping-list");
const shoppingCount = document.querySelector("#shopping-count");
const recipeDialog = document.querySelector("#recipe-dialog");
const recipeDialogContent = document.querySelector("#recipe-dialog-content");
const recipeIndexDialog = document.querySelector("#recipe-index-dialog");
const recipeIndexSearch = document.querySelector("#recipe-index-search");
const recipeIndexResults = document.querySelector("#recipe-index-results");
const recipeIndexStatus = document.querySelector("#recipe-index-status");
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

function normaliseSearch(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("sv");
}

function recipeSearchText(recipe) {
  return normaliseSearch([
    recipe.title,
    recipe.collection,
    recipe.day,
    recipe.meal,
    recipe.mood,
    recipe.protein,
    recipe.description,
    ...(recipe.tags || []),
  ].join(" "));
}

function conceptSearchText(concept) {
  return normaliseSearch([
    concept.title,
    concept.headline,
    concept.headline_emphasis,
    concept.intro,
    concept.description,
    ...(concept.tags || []),
  ].join(" "));
}

function conceptRecipes(concept) {
  return concept.recipes.map((path) => state.recipeByPath.get(path)).filter(Boolean);
}

function mealSummary(recipes) {
  const lunches = recipes.filter((recipe) => recipe.meal === "Lunch").length;
  const dinners = recipes.filter((recipe) => recipe.meal === "Middag").length;
  return [
    lunches ? `${lunches} ${lunches === 1 ? "lunch" : "luncher"}` : "",
    dinners ? `${dinners} ${dinners === 1 ? "middag" : "middagar"}` : "",
  ].filter(Boolean).join(" · ");
}

function shoppingStorageKey() {
  return `euthercook-shopping-${state.activeConcept.id}`;
}

function loadCheckedForConcept() {
  let saved = localStorage.getItem(shoppingStorageKey());
  if (saved === null && state.activeConcept.id === "greek-weekend") {
    saved = localStorage.getItem("euthercook-shopping");
  }
  state.checked = new Set(JSON.parse(saved || "[]"));
}

function applyConceptContent(concept) {
  document.title = `EutherCook — ${concept.title}`;
  document.documentElement.dataset.concept = concept.id;
  document.querySelector("#book-headline").textContent = concept.headline;
  document.querySelector("#book-headline-emphasis").textContent = concept.headline_emphasis;
  document.querySelector("#book-intro").textContent = concept.intro;
  document.querySelector("#book-prompt").value = concept.prompt;
  document.querySelector("#prompt-status").textContent = concept.prompt_status;
  document.querySelector("#book-cover").setAttribute("aria-label", `Omslag för ${concept.title}`);
  const coverImage = document.querySelector("#book-cover-image");
  coverImage.src = concept.cover_image;
  coverImage.alt = concept.cover_alt;
  document.querySelector("#book-volume").textContent = concept.volume;
  document.querySelector("#book-cover-label").textContent = concept.cover_label;
  document.querySelector("#book-schedule").textContent = concept.schedule;
  document.querySelector("#book-title").textContent = concept.title;
  document.querySelector("#book-description").textContent = concept.description;
  document.querySelector("#shopping-summary").textContent = concept.shopping_summary;
}

function activateConcept(concept, { scrollToTop = false } = {}) {
  state.activeConcept = concept;
  state.recipes = conceptRecipes(concept);
  localStorage.setItem("euthercook-active-concept", concept.id);
  loadCheckedForConcept();
  applyConceptContent(concept);
  renderAll();
  renderRecipeIndex(recipeIndexSearch.value);
  if (scrollToTop) window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderRecipeIndex(query = "") {
  const needle = normaliseSearch(query.trim());
  const conceptMatches = state.concepts.filter((concept) => !needle || conceptSearchText(concept).includes(needle));
  const recipeMatches = state.library.filter((recipe) => !needle || recipeSearchText(recipe).includes(needle));
  recipeIndexStatus.textContent = `${conceptMatches.length} helgböcker · ${recipeMatches.length} recept`;
  recipeIndexResults.replaceChildren();

  if (!conceptMatches.length && !recipeMatches.length) {
    recipeIndexResults.innerHTML = `<p class="index-empty">Ingen helgbok eller rätt matchade “${escapeHtml(query.trim())}”.</p>`;
    return;
  }

  if (conceptMatches.length) {
    recipeIndexResults.insertAdjacentHTML("beforeend", '<p class="index-section-label">Helgböcker</p>');
  }
  conceptMatches.forEach((concept) => {
    const recipes = conceptRecipes(concept);
    const active = concept.id === state.activeConcept?.id;
    const button = document.createElement("button");
    button.className = `concept-result${active ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <img src="${escapeHtml(concept.cover_image)}" alt="" loading="lazy" />
      <span>
        <small>Helgkoncept</small>
        <strong>${escapeHtml(concept.title)}</strong>
        <span>${escapeHtml(mealSummary(recipes))}</span>
      </span>
      <span>${active ? "Vald" : "Välj ↗"}</span>`;
    button.addEventListener("click", () => {
      recipeIndexDialog.close();
      activateConcept(concept, { scrollToTop: true });
    });
    recipeIndexResults.append(button);
  });

  if (recipeMatches.length) {
    recipeIndexResults.insertAdjacentHTML("beforeend", '<p class="index-section-label">Enskilda recept</p>');
  }
  recipeMatches.forEach((recipe) => {
    const button = document.createElement("button");
    button.className = "index-result";
    button.type = "button";
    button.innerHTML = `
      <img src="${escapeHtml(recipe.image)}" alt="" loading="lazy" />
      <span>
        <small>${escapeHtml(recipe.collection)}</small>
        <strong>${escapeHtml(recipe.title)}</strong>
        <span>${escapeHtml(recipe.day)} · ${escapeHtml(recipe.meal)} · ${escapeHtml(recipe.protein)}</span>
      </span>
      <span aria-hidden="true">↗</span>`;
    button.addEventListener("click", () => {
      recipeIndexDialog.close();
      openRecipe(recipe);
    });
    recipeIndexResults.append(button);
  });
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
      localStorage.setItem(shoppingStorageKey(), JSON.stringify([...state.checked]));
    });
  });
}

function renderAll() {
  servingsValue.textContent = state.servings;
  document.querySelector(".cover-stamp").innerHTML = `${state.servings}<br><small>pers</small>`;
  document.querySelector("#book-kicker").textContent =
    `Helgkokbok · ${mealSummary(state.recipes)} · ${state.servings} personer`;
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
  status.textContent = `Klart — ${state.activeConcept.title} är ombunden för ${state.servings} personer.`;
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
  localStorage.setItem(shoppingStorageKey(), "[]");
  if (state.activeConcept.id === "greek-weekend") localStorage.removeItem("euthercook-shopping");
  renderShoppingList();
});
document.querySelector("#close-recipe").addEventListener("click", () => recipeDialog.close());
document.querySelector("#open-recipe-index").addEventListener("click", () => {
  renderRecipeIndex(recipeIndexSearch.value);
  recipeIndexDialog.showModal();
  recipeIndexSearch.focus();
});
document.querySelector("#close-recipe-index").addEventListener("click", () => recipeIndexDialog.close());
recipeIndexSearch.addEventListener("input", () => renderRecipeIndex(recipeIndexSearch.value));
document.querySelector("#open-about").addEventListener("click", () => aboutDialog.showModal());
document.querySelector("#close-about").addEventListener("click", () => aboutDialog.close());
[recipeDialog, recipeIndexDialog, aboutDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

async function init() {
  try {
    const catalog = await loadToml(CATALOG_PATH);
    const libraryPaths = catalog.library || catalog.recipes;
    const loaded = await Promise.all(libraryPaths.map(async (path) => [path, await loadToml(`./recipes/${path}`)]));
    state.recipeByPath = new Map(loaded);
    state.library = libraryPaths.map((path) => state.recipeByPath.get(path));
    state.concepts = catalog.concepts || [];
    document.querySelector("#recipe-index-count").textContent = `${state.concepts.length}+${state.library.length}`;
    const savedConcept = localStorage.getItem("euthercook-active-concept");
    const initialConcept = state.concepts.find((concept) => concept.id === savedConcept)
      || state.concepts.find((concept) => concept.id === catalog.default_concept)
      || state.concepts[0];
    activateConcept(initialConcept);
  } catch (error) {
    recipeList.innerHTML = `<p>Kokboken gick inte att läsa: ${escapeHtml(error.message)}</p>`;
  }
}

init();
