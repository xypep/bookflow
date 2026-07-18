const STORAGE_KEY = "book-flow-theme";
const THEMES = ["light", "sepia", "dark"];
const THEME_ICONS = { light: "☀", sepia: "📖", dark: "☾" };

export function initTheme() {
  applyTheme(localStorage.getItem(STORAGE_KEY) || "light");
}

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

export function getThemeIcon(theme) {
  return THEME_ICONS[theme] ?? THEME_ICONS.light;
}

export function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
  applyTheme(next);
  return next;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}
