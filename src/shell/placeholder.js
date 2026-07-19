import { navBar, addSheet, bindAddSheet } from "./nav.js";

// Home and Stats are designed but not built yet. They still render the shell,
// so the navigation is complete and the add button works from anywhere —
// an empty tab is better than a tab that does nothing.
export function renderPlaceholder(container, { route, title, note }) {
  container.innerHTML = `
    <div class="screen placeholder-screen">
      <header class="library-header"><h1>${title}</h1></header>
      <p class="placeholder-note">${note}</p>
      ${addSheet()}
      ${navBar(route)}
    </div>
  `;

  bindAddSheet(container, () => {
    window.location.hash = "#/library";
  });
}
