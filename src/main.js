import "./style.css";
import { renderLibrary } from "./library/library.js";
import { renderReader, stopReader } from "./reader/reader.js";
import { initTheme } from "./themes/themes.js";
import { initSessionTracker } from "./sessions/sessionTracker.js";
import { renderPlaceholder } from "./shell/placeholder.js";
import { renderHome } from "./home/home.js";

const app = document.querySelector("#app");

initTheme();
// Finalizes any session left half-written by an app the OS killed, before the
// reader can open a new one.
initSessionTracker();

function router() {
  stopReader();

  const hash = window.location.hash;
  const readerMatch = hash.match(/^#\/reader\/(.+)$/);

  if (readerMatch) {
    renderReader(app, readerMatch[1]);
  } else if (hash === "#/library") {
    renderLibrary(app);
  } else if (hash === "#/stats") {
    renderPlaceholder(app, {
      route: "#/stats",
      title: "Stats",
      note: "Your reading is already being recorded. The charts land here next.",
    });
  } else {
    renderHome(app);
  }
}

window.addEventListener("hashchange", router);
router();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
