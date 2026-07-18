import "./style.css";
import { renderLibrary } from "./library/library.js";
import { renderReader } from "./reader/reader.js";
import { initTheme } from "./themes/themes.js";

const app = document.querySelector("#app");

initTheme();

function router() {
  const readerMatch = window.location.hash.match(/^#\/reader\/(.+)$/);

  if (readerMatch) {
    renderReader(app, readerMatch[1]);
  } else {
    renderLibrary(app);
  }
}

window.addEventListener("hashchange", router);
router();
