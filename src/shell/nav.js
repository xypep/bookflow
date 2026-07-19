// Bottom navigation: a pill holding the three screens, plus the add button
// sitting apart from it as its own circle. The reader has no nav — it fills
// the screen — so this is only rendered on the top-level routes.

const TABS = [
  { route: "#/", label: "Home", icon: homeIcon },
  { route: "#/library", label: "Library", icon: libraryIcon },
  { route: "#/stats", label: "Stats", icon: statsIcon },
];

// Inline SVG rather than an icon font or emoji: it inherits currentColor, so
// the active tab tints with the theme and nothing extra has to load.
function icon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function homeIcon() {
  return icon(`<path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" />`);
}

function libraryIcon() {
  return icon(
    `<path d="M4 4.5h6.5v15H4z" /><path d="M13 4.5h3v15h-3z" /><path d="M18.4 4.9l2.6.6-3 14.2-2.6-.6z" />`
  );
}

function statsIcon() {
  return icon(`<path d="M4 20V11" /><path d="M10 20V4" /><path d="M16 20v-6" /><path d="M22 20H2" />`);
}

export function navBar(activeRoute) {
  const tabs = TABS.map(
    (tab) => `
      <a href="${tab.route}" class="nav-tab${tab.route === activeRoute ? " active" : ""}"
         ${tab.route === activeRoute ? 'aria-current="page"' : ""} aria-label="${tab.label}">
        ${tab.icon()}
        <span>${tab.label}</span>
      </a>
    `
  ).join("");

  return `
    <nav class="nav-bar">
      <div class="nav-tabs">${tabs}</div>
      <button id="add-button" class="nav-add" aria-label="Add a book">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
          stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </nav>
  `;
}

// The add options live here rather than in the library so every screen can
// offer them from the same button.
export function addSheet() {
  return `
    <div id="add-sheet" class="add-sheet hidden">
      <div class="add-sheet-backdrop" data-close="1"></div>
      <div class="add-sheet-options" role="menu">
        <button type="button" data-add="scan">Scan</button>
        <button type="button" data-add="upload">Upload txt / md</button>
        <button type="button" data-add="pdf">Import PDF</button>
        <button type="button" data-add="paste">Paste text</button>
        <button type="button" data-add="import">Import book file</button>
      </div>
    </div>
  `;
}

export function toggleAddSheet(container, show) {
  container.querySelector("#add-sheet")?.classList.toggle("hidden", !show);
}

/**
 * Wires the add button and its sheet. `onPick` receives the chosen action.
 */
export function bindAddSheet(container, onPick) {
  const sheet = container.querySelector("#add-sheet");
  if (!sheet) return;

  container.querySelector("#add-button")?.addEventListener("click", () => {
    toggleAddSheet(container, sheet.classList.contains("hidden"));
  });

  sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) {
      toggleAddSheet(container, false);
      return;
    }

    const option = event.target.closest("[data-add]");
    if (!option) return;
    toggleAddSheet(container, false);
    onPick(option.dataset.add);
  });
}
