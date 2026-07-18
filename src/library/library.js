import { addBook, getAllBooks, deleteBook } from "../db/database.js";
import { tokenize, escapeHtml } from "../utils.js";
import { getTheme, getThemeIcon, cycleTheme } from "../themes/themes.js";
import { scanPages, getWorker } from "../scanner/scanner.js";
import { detectOrientation, rotateCanvas } from "../scanner/orientation.js";
import { isCameraAvailable, captureFromCamera } from "../scanner/camera.js";
import { AVAILABLE_LANGUAGES, getLanguages, setLanguages } from "../scanner/languages.js";
import { cropAndStraighten } from "../scanner/cropper.js";

export async function renderLibrary(container) {
  const books = await getAllBooks();

  container.innerHTML = `
    <div class="screen library-screen">
      <header class="library-header">
        <h1>Book Flow</h1>
        <button id="theme-toggle" class="icon-button" aria-label="Switch theme">${getThemeIcon(getTheme())}</button>
      </header>

      <div class="add-book">
        <input type="file" id="file-input" accept=".txt,.md,text/plain,text/markdown" hidden />
        <input type="file" id="scan-input" accept="image/*" hidden />
        <button id="upload-button">Upload .txt / .md</button>
        <button id="scan-button">Scan document</button>
        <button id="paste-button">Paste text</button>
      </div>

      <details class="scan-languages">
        <summary>Scan languages</summary>
        <p class="scan-languages-note">All on by default. Turning some off makes scanning faster.</p>
        <div class="scan-languages-options">${languageCheckboxes()}</div>
      </details>

      <ul class="book-list">
        ${books.length ? books.map(bookItem).join("") : emptyState()}
      </ul>

      <div id="paste-modal" class="modal hidden">
        <div class="modal-content">
          <input type="text" id="paste-title" placeholder="Title" maxlength="120" />
          <textarea id="paste-text" placeholder="Paste your book text here..."></textarea>
          <div class="modal-actions">
            <button id="paste-cancel">Cancel</button>
            <button id="paste-scan-more">Scan more pages</button>
            <button id="paste-save">Save</button>
          </div>
        </div>
      </div>

      <div id="scan-overlay" class="modal hidden">
        <div class="modal-content scan-status">
          <p id="scan-status-text">Scanning…</p>
        </div>
      </div>
    </div>
  `;

  container.querySelector("#theme-toggle").addEventListener("click", (event) => {
    const theme = cycleTheme();
    event.target.textContent = getThemeIcon(theme);
  });

  container.querySelector("#upload-button").addEventListener("click", () => {
    container.querySelector("#file-input").click();
  });

  container.querySelector("#file-input").addEventListener("change", (event) => {
    handleFileUpload(event, container);
  });

  container.querySelector("#scan-button").addEventListener("click", () => {
    startScan(container);
  });

  container.querySelector("#scan-input").addEventListener("change", (event) => {
    handleScan(event, container);
  });

  container.querySelector("#paste-button").addEventListener("click", () => {
    togglePasteModal(container, true);
  });

  container.querySelector("#paste-cancel").addEventListener("click", () => {
    togglePasteModal(container, false);
  });

  container.querySelector("#paste-save").addEventListener("click", () => {
    handlePasteSave(container);
  });

  container.querySelector("#paste-scan-more").addEventListener("click", () => {
    startScan(container);
  });

  container.querySelector(".scan-languages-options").addEventListener("change", () => {
    handleLanguageChange(container);
  });

  container.querySelector(".book-list").addEventListener("click", (event) => {
    handleListClick(event, container);
  });
}

function languageCheckboxes() {
  const selected = new Set(getLanguages());

  return AVAILABLE_LANGUAGES.map(
    ({ code, label }) => `
      <label class="scan-language">
        <input type="checkbox" value="${code}" ${selected.has(code) ? "checked" : ""} />
        ${label}
      </label>
    `
  ).join("");
}

function handleLanguageChange(container) {
  const checked = [...container.querySelectorAll(".scan-languages-options input:checked")];
  setLanguages(checked.map((input) => input.value));

  // Clearing every box would leave nothing to recognize with, so the stored
  // default is reflected back into the UI.
  const selected = new Set(getLanguages());
  container.querySelectorAll(".scan-languages-options input").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function bookItem(book) {
  const total = book.wordCount || 0;
  const percent = total > 1 ? Math.round((book.progress / (total - 1)) * 100) : 0;
  return `
    <li class="book-item" data-id="${book.id}">
      <div class="book-info">
        <span class="book-title">${escapeHtml(book.title)}</span>
        <span class="book-progress">${percent}% read</span>
      </div>
      <button class="delete-button" data-id="${book.id}" aria-label="Delete book">×</button>
    </li>
  `;
}

function emptyState() {
  return `<li class="empty-state">No books yet — upload a .txt or .md file or paste some text to get started.</li>`;
}

async function handleFileUpload(event, container) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  const title = file.name.replace(/\.(txt|md)$/i, "");
  await saveBook(title, text);

  event.target.value = "";
  renderLibrary(container);
}

function togglePasteModal(container, show, prefill = {}) {
  const modal = container.querySelector("#paste-modal");
  modal.classList.toggle("hidden", !show);
  if (show) {
    container.querySelector("#paste-title").value = prefill.title ?? "";
    container.querySelector("#paste-text").value = prefill.text ?? "";
    container.querySelector("#paste-title").focus();
  }
}

function pickImageFile(container) {
  container.querySelector("#scan-input").click();
}

// Prefers the in-app camera, which guides framing and so avoids most of the
// noise OCR struggles with. Falls back to the file picker wherever the camera
// isn't reachable — notably over plain http, where it isn't exposed at all.
async function startScan(container) {
  if (!isCameraAvailable()) {
    pickImageFile(container);
    return;
  }

  let capture;
  try {
    capture = await captureFromCamera();
  } catch (error) {
    console.error(error);
    pickImageFile(container);
    return;
  }

  if (capture === "files") {
    pickImageFile(container);
  } else if (capture) {
    const straightened = await straightenCapture(capture, container);
    if (straightened) await runScan([straightened], container);
  }
}

// Safari will not allocate a canvas much beyond 16.7 megapixels, which a photo
// straight from the library can exceed.
const MAX_SOURCE_EDGE = 4000;

// Cropping to one page and squaring it up is what makes a page inside a bound
// book readable: it removes the facing page and the curved area near the
// spine, and undoes the angle the photo was taken at. Orientation is settled
// first, so the corners are dragged on an upright page.
async function straightenCapture(image, container) {
  const bitmap = await createImageBitmap(image, { imageOrientation: "from-image" });

  const factor = Math.min(1, MAX_SOURCE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * factor);
  canvas.height = Math.round(bitmap.height * factor);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let upright = canvas;

  // Orientation detection takes a moment, and the very first scan also has to
  // fetch the language data. Without this the app just sits there looking
  // broken between the shutter and the crop screen.
  setScanStatus(container, "Preparing page…");
  toggleScanOverlay(container, true);

  try {
    const turns = await detectOrientation(await getWorker(), canvas);
    upright = rotateCanvas(canvas, turns);
  } catch (error) {
    // Detection is a convenience — if it fails, crop the shot as taken.
    console.error(error);
  } finally {
    toggleScanOverlay(container, false);
  }

  return cropAndStraighten(upright);
}

async function handleScan(event, container) {
  const files = Array.from(event.target.files);
  // Cleared up front so picking the same file twice still fires a change.
  event.target.value = "";

  const prepared = [];
  for (const file of files) {
    const straightened = await straightenCapture(file, container);
    if (straightened) prepared.push(straightened);
  }

  if (prepared.length) await runScan(prepared, container);
}

async function runScan(files, container) {
  toggleScanOverlay(container, true);

  try {
    const text = await scanPages(files, (page, total) => {
      setScanStatus(container, `Scanning page ${page} of ${total}…`);
    });
    toggleScanOverlay(container, false);
    showScanResult(container, text);
  } catch (error) {
    toggleScanOverlay(container, false);
    window.alert("Scanning failed. Please try again.");
    console.error(error);
  }
}

// Scanned text always needs a fix here and there, so it lands in the paste
// modal for review rather than being saved straight away. When the modal is
// already open (via "Scan more pages") the new page is appended to the draft,
// letting a book be built up scan by scan.
function showScanResult(container, text) {
  const modal = container.querySelector("#paste-modal");

  if (modal.classList.contains("hidden")) {
    togglePasteModal(container, true, {
      title: `Scan ${new Date().toLocaleDateString()}`,
      text,
    });
    return;
  }

  const textarea = container.querySelector("#paste-text");
  textarea.value = textarea.value ? `${textarea.value}\n\n${text}` : text;
}

function toggleScanOverlay(container, show) {
  container.querySelector("#scan-overlay").classList.toggle("hidden", !show);
}

function setScanStatus(container, text) {
  container.querySelector("#scan-status-text").textContent = text;
}

async function handlePasteSave(container) {
  const title = container.querySelector("#paste-title").value.trim();
  const text = container.querySelector("#paste-text").value.trim();

  if (!title || !text) return;

  await saveBook(title, text);
  renderLibrary(container);
}

async function saveBook(title, text) {
  const wordCount = tokenize(text).length;
  await addBook({ title, text, wordCount });
}

function handleListClick(event, container) {
  const deleteButton = event.target.closest(".delete-button");
  if (deleteButton) {
    event.stopPropagation();
    handleDelete(deleteButton.dataset.id, container);
    return;
  }

  const item = event.target.closest(".book-item");
  if (item) {
    window.location.hash = `#/reader/${item.dataset.id}`;
  }
}

async function handleDelete(id, container) {
  if (!window.confirm("Delete this book?")) return;
  await deleteBook(id);
  renderLibrary(container);
}
