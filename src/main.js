import "./style.css";
import { renderLibrary } from "./library/library.js";
import { renderReader } from "./reader/reader.js";

const app = document.querySelector("#app");

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
