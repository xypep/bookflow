import "./style.css";
import { renderLibrary } from "./library/library.js";

const app = document.querySelector("#app");

function router() {
  renderLibrary(app);
}

window.addEventListener("hashchange", router);
router();
