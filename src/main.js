import "./style.css";
import { renderLibrary } from "./library/library.js";
import { renderReader, stopReader } from "./reader/reader.js";
import { initTheme } from "./themes/themes.js";
import { initSessionTracker } from "./sessions/sessionTracker.js";

const app = document.querySelector("#app");

initTheme();
// Finalizes any session left half-written by an app the OS killed, before the
// reader can open a new one.
initSessionTracker();

function router() {
  stopReader();

  const readerMatch = window.location.hash.match(/^#\/reader\/(.+)$/);

  if (readerMatch) {
    renderReader(app, readerMatch[1]);
  } else {
    renderLibrary(app);
  }
}

window.addEventListener("hashchange", router);
router();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
