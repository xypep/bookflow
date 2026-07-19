import { addBook, getAllBooks, deleteBook } from "../db/database.js";
import {
  exportBook,
  exportCollection,
  exportFileName,
  saveExport,
  parseImportFile,
  findConflict,
  importEntry,
  ImportError,
} from "../transfer/bookTransfer.js";
import { tokenize, escapeHtml } from "../utils.js";
import { getTheme, getThemeIcon, cycleTheme } from "../themes/themes.js";
import { scanPages, scanPageStream, getWorker } from "../scanner/scanner.js";
import { isPdf, readPdfPages } from "../scanner/pdf.js";
import { detectOrientation, rotateCanvas } from "../scanner/orientation.js";
import { detectPageCorners } from "../scanner/pageDetection.js";
import { isCameraAvailable, captureFromCamera } from "../scanner/camera.js";
import { AVAILABLE_LANGUAGES, getLanguages, setLanguages } from "../scanner/languages.js";
import { cropAndStraighten } from "../scanner/cropper.js";
import { navBar, addSheet, bindAddSheet } from "../shell/nav.js";
import { coverStyle, coverInitials } from "./covers.js";

let libraryBooks = [];
let searchTerm = "";

export async function renderLibrary(container) {
  const books = await getAllBooks();
  libraryBooks = books;

  container.innerHTML = `
    <div class="screen library-screen">
      <header class="library-header">
        <h1>Library</h1>
        <button id="theme-toggle" class="icon-button" aria-label="Switch theme">${getThemeIcon(getTheme())}</button>
      </header>

      <input type="search" id="book-search" class="book-search" placeholder="Search books"
        autocomplete="off" autocorrect="off" spellcheck="false" value="${escapeHtml(searchTerm)}" />

      <input type="file" id="file-input" accept=".txt,.md,text/plain,text/markdown" hidden />
      <input type="file" id="pdf-input" accept="application/pdf,.pdf" hidden />
      <input type="file" id="scan-input" accept="image/*,application/pdf,.pdf" multiple hidden />
      <input type="file" id="import-input" accept=".json,application/json" hidden />

      <div id="library-notice" class="library-notice hidden" role="status"></div>
      <div id="import-conflict" class="import-conflict hidden"></div>

      <ul id="book-grid" class="book-grid">${bookGrid(books, searchTerm)}</ul>

      <details class="scan-languages">
        <summary>Scan languages</summary>
        <p class="scan-languages-note">All on by default. Turning some off makes scanning faster.</p>
        <div class="scan-languages-options">${languageCheckboxes()}</div>
      </details>

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

      <!-- Non-blocking counterpart to the overlay above, for the short steps
           between the shutter and the crop screen. -->
      <div id="scan-toast" class="scan-toast hidden">
        <span class="scan-toast-spinner"></span>
        <span id="scan-toast-text"></span>
      </div>

      <div id="book-sheet" class="add-sheet hidden">
        <div class="add-sheet-backdrop" data-close="1"></div>
        <div id="book-sheet-options" class="add-sheet-options" role="menu"></div>
      </div>

      ${addSheet()}
      ${navBar("#/library")}
    </div>
  `;

  container.querySelector("#theme-toggle").addEventListener("click", (event) => {
    const theme = cycleTheme();
    event.currentTarget.textContent = getThemeIcon(theme);
  });

  container.querySelector("#file-input").addEventListener("change", (event) => {
    handleFileUpload(event, container);
  });

  container.querySelector("#scan-input").addEventListener("change", (event) => {
    handleScan(event, container);
  });

  container.querySelector("#pdf-input").addEventListener("change", (event) => {
    handlePdf(event, container);
  });

  container.querySelector("#import-input").addEventListener("change", (event) => {
    handleImport(event, container);
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

  container.querySelector("#book-grid").addEventListener("click", (event) => {
    handleListClick(event, container);
  });

  container.querySelector("#book-search").addEventListener("input", (event) => {
    searchTerm = event.target.value;
    container.querySelector("#book-grid").innerHTML = bookGrid(libraryBooks, searchTerm);
  });

  bindAddSheet(container, (action) => handleAddAction(action, container));

  container.querySelector("#book-sheet").addEventListener("click", (event) => {
    handleBookSheetClick(event, container);
  });
}

function handleAddAction(action, container) {
  if (action === "scan") startScan(container);
  else if (action === "upload") container.querySelector("#file-input").click();
  else if (action === "pdf") container.querySelector("#pdf-input").click();
  else if (action === "import") container.querySelector("#import-input").click();
  else if (action === "paste") togglePasteModal(container, true);
}

/* Inline status line — never blocks, and replaces itself on the next message. */
function showNotice(container, message, tone = "info") {
  const notice = container.querySelector("#library-notice");
  if (!notice) return;
  notice.textContent = message;
  notice.className = `library-notice ${tone}`;
}

function clearNotice(container) {
  const notice = container.querySelector("#library-notice");
  if (notice) notice.className = "library-notice hidden";
}

async function handleExportBook(id, container) {
  const book = (await getAllBooks()).find((entry) => entry.id === id);
  if (!book) return;

  try {
    const data = await exportBook(book);
    const result = await saveExport(data, exportFileName(book.title));
    if (result !== "cancelled") {
      showNotice(container, `Exported “${book.title}”.`, "success");
    }
  } catch (error) {
    console.error(error);
    showNotice(container, "Could not export that book.", "error");
  }
}

async function handleExportAll(container) {
  const books = await getAllBooks();
  if (!books.length) return;

  try {
    const data = await exportCollection(books);
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await saveExport(data, `book-flow-library-${stamp}.bookflow.json`);
    if (result !== "cancelled") {
      showNotice(container, `Exported ${books.length} book${books.length === 1 ? "" : "s"}.`, "success");
    }
  } catch (error) {
    console.error(error);
    showNotice(container, "Could not export your library.", "error");
  }
}

async function handleImport(event, container) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  clearNotice(container);

  let entries;
  try {
    entries = parseImportFile(await file.text());
  } catch (error) {
    if (error instanceof ImportError) {
      showNotice(container, `${error.message} Nothing was imported.`, "error");
      return;
    }
    console.error(error);
    showNotice(container, "Could not read that file. Nothing was imported.", "error");
    return;
  }

  await runImport(entries, container);
}

// Entries are written one at a time so a conflict on the third book of a
// collection can be answered without holding up the two before it.
async function runImport(entries, container) {
  let imported = 0;
  let skipped = 0;
  let sessions = 0;

  for (const entry of entries) {
    const localBooks = await getAllBooks();
    const existing = findConflict(entry, localBooks);
    let mode = "create";

    if (existing) {
      mode = await askConflict(container, entry, existing);
      if (mode === "cancel") {
        skipped += 1;
        continue;
      }
    }

    try {
      const result = await importEntry(entry, { mode, existing, localBooks });
      imported += 1;
      sessions += result.sessionsAdded;
    } catch (error) {
      console.error(error);
      skipped += 1;
    }
  }

  await renderLibrary(container);

  if (!imported) {
    showNotice(container, "Nothing was imported.", "info");
    return;
  }

  const parts = [`Imported ${imported} book${imported === 1 ? "" : "s"}`];
  if (sessions) parts.push(`${sessions} new session${sessions === 1 ? "" : "s"}`);
  if (skipped) parts.push(`${skipped} skipped`);
  showNotice(container, `${parts.join(", ")}.`, "success");
}

// Resolves to "overwrite", "keep-both" or "cancel". Rendered inline in the
// page rather than as a dialog, so the rest of the library stays visible.
function askConflict(container, entry, existing) {
  const panel = container.querySelector("#import-conflict");

  panel.innerHTML = `
    <p class="import-conflict-title">“${escapeHtml(entry.title)}” is already in your library.</p>
    <p class="import-conflict-detail">
      Import: word ${entry.readingPosition} / Local: word ${existing.progress || 0}
    </p>
    <div class="import-conflict-actions">
      <button type="button" data-choice="overwrite">Overwrite</button>
      <button type="button" data-choice="keep-both">Keep both</button>
      <button type="button" data-choice="cancel">Cancel</button>
    </div>
  `;
  panel.classList.remove("hidden");

  // A collection can raise several conflicts in a row, so the listener is torn
  // down with the panel instead of stacking up across questions.
  const controller = new AbortController();

  return new Promise((resolve) => {
    panel.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("button[data-choice]");
        if (!button) return;
        controller.abort();
        panel.classList.add("hidden");
        panel.innerHTML = "";
        resolve(button.dataset.choice);
      },
      { signal: controller.signal }
    );
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

function readPercent(book) {
  const total = book.wordCount || 0;
  return total > 1 ? Math.round((book.progress / (total - 1)) * 100) : 0;
}

function bookGrid(books, term) {
  if (!books.length) {
    return `<li class="empty-state">No books yet — tap + to scan a page, upload a file or paste some text.</li>`;
  }

  const needle = term.trim().toLowerCase();
  const matching = needle
    ? books.filter((book) => book.title.toLowerCase().includes(needle))
    : books;

  if (!matching.length) {
    return `<li class="empty-state">No book matches “${escapeHtml(term.trim())}”.</li>`;
  }

  return matching.map(bookCard).join("");
}

function bookCard(book) {
  const percent = readPercent(book);
  return `
    <li class="book-card">
      <button class="book-open" data-id="${book.id}">
        <span class="book-cover" style="${coverStyle(book.title)}">
          <span class="book-cover-spine"></span>
          <span class="book-cover-initials">${escapeHtml(coverInitials(book.title))}</span>
        </span>
        <span class="book-title">${escapeHtml(book.title)}</span>
        <span class="book-meter"><span class="book-meter-fill" style="width:${percent}%"></span></span>
        <span class="book-percent">${percent}%</span>
      </button>
      <button class="book-menu" data-menu="${book.id}" aria-label="Actions for ${escapeHtml(book.title)}">⋯</button>
    </li>
  `;
}

// One sheet reused for every book, so the grid stays free of hidden menus.
function openBookSheet(container, book) {
  const options = container.querySelector("#book-sheet-options");
  options.dataset.id = book.id;
  options.innerHTML = `
    <p class="add-sheet-title">${escapeHtml(book.title)}</p>
    <button type="button" data-book-action="read">Continue reading</button>
    <button type="button" data-book-action="export">Export as file</button>
    <button type="button" data-book-action="export-all">Export whole library</button>
    <button type="button" class="destructive" data-book-action="delete">Delete</button>
  `;
  container.querySelector("#book-sheet").classList.remove("hidden");
}

function handleBookSheetClick(event, container) {
  const sheet = container.querySelector("#book-sheet");
  if (event.target.closest("[data-close]")) {
    sheet.classList.add("hidden");
    return;
  }

  const button = event.target.closest("[data-book-action]");
  if (!button) return;

  const id = container.querySelector("#book-sheet-options").dataset.id;
  const action = button.dataset.bookAction;

  if (action === "delete") {
    // Deleting is the one irreversible action here, so it asks a second time
    // in place rather than through a confirm() the page has to wait on.
    button.dataset.bookAction = "delete-confirm";
    button.textContent = "Really delete — tap again";
    return;
  }

  sheet.classList.add("hidden");

  if (action === "read") window.location.hash = `#/reader/${id}`;
  else if (action === "export") handleExportBook(id, container);
  else if (action === "export-all") handleExportAll(container);
  else if (action === "delete-confirm") handleDelete(id, container);
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
    return;
  }

  if (Array.isArray(capture) && capture.length) {
    await prepareAndScan(capture, container);
  }
}

// Each captured page goes through orientation, detection and the crop screen
// in turn; skipping a page there just leaves it out rather than abandoning the
// whole batch.
async function prepareAndScan(images, container) {
  const pages = [];

  for (const [index, image] of images.entries()) {
    const position = images.length > 1 ? ` (${index + 1} of ${images.length})` : "";
    const straightened = await straightenCapture(image, container, position);
    if (straightened) pages.push(straightened);
  }

  if (pages.length) await runScan(pages, container);
}

// Safari will not allocate a canvas much beyond 16.7 megapixels, which a photo
// straight from the library can exceed.
const MAX_SOURCE_EDGE = 4000;

// Cropping to one page and squaring it up is what makes a page inside a bound
// book readable: it removes the facing page and the curved area near the
// spine, and undoes the angle the photo was taken at. Orientation is settled
// first, so the corners are dragged on an upright page.
async function straightenCapture(image, container, position = "") {
  const bitmap = await createImageBitmap(image, { imageOrientation: "from-image" });

  const factor = Math.min(1, MAX_SOURCE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * factor);
  canvas.height = Math.round(bitmap.height * factor);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let upright = canvas;
  let corners = null;

  // Orientation detection takes a moment, and the very first scan also has to
  // fetch the language data. Without this the app just sits there looking
  // broken between the shutter and the crop screen.
  toggleScanToast(container, `Preparing page${position}…`);

  try {
    // One recognition pass settles the orientation and locates the text block:
    // the winning probe's word boxes are exactly what page detection needs.
    const probe = await detectOrientation(await getWorker(), canvas);
    upright = rotateCanvas(canvas, probe.turns);

    const detected = detectPageCorners(probe.blocks, probe.width, probe.height);
    if (detected) {
      const scale = upright.width / probe.width;
      corners = detected.map(({ x, y }) => ({ x: x * scale, y: y * scale }));
    }
  } catch (error) {
    // Both steps are conveniences — if either fails, fall back to placing the
    // corners by hand on the shot as taken.
    console.error(error);
  } finally {
    toggleScanToast(container, null);
  }

  return cropAndStraighten(upright, { detectedQuad: corners, position });
}

async function handleScan(event, container) {
  const files = Array.from(event.target.files);
  // Cleared up front so picking the same file twice still fires a change.
  event.target.value = "";
  if (!files.length) return;

  // A PDF picked here is the scanner-app case, not a photo to crop.
  if (files.every(isPdf)) {
    await scanPdfFiles(files, container);
    return;
  }

  await prepareAndScan(files.filter((file) => !isPdf(file)), container);
}

async function handlePdf(event, container) {
  const files = Array.from(event.target.files);
  event.target.value = "";
  if (files.length) await scanPdfFiles(files, container);
}

// Pages from a document-scanner PDF are already cropped, straightened and
// evened out, so they go straight to recognition — no crop screen, which is
// the whole point when a chapter arrives as one file.
async function scanPdfFiles(files, container) {
  setScanStatus(container, "Reading PDF…");
  toggleScanOverlay(container, true);

  try {
    const texts = [];
    for (const file of files) {
      texts.push(
        await scanPageStream(
          readPdfPages(file),
          (number, total) => {
            setScanStatus(container, `Scanning page ${number} of ${total}…`);
          },
          // Nothing has straightened these yet: a document scanner saves a
          // sideways-held book exactly as it was held, and an open book as one
          // sheet with both pages on it.
          { preparePages: true }
        )
      );
    }

    toggleScanOverlay(container, false);
    showScanResult(container, texts.filter(Boolean).join("\n\n"));
  } catch (error) {
    toggleScanOverlay(container, false);
    window.alert("Could not read that PDF. Please try again.");
    console.error(error);
  }
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

// Pass a message to show it, or null to hide.
function toggleScanToast(container, message) {
  const toast = container.querySelector("#scan-toast");
  if (message) container.querySelector("#scan-toast-text").textContent = message;
  toast.classList.toggle("hidden", !message);
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
  const menuButton = event.target.closest("[data-menu]");
  if (menuButton) {
    const book = libraryBooks.find((entry) => entry.id === menuButton.dataset.menu);
    if (book) openBookSheet(container, book);
    return;
  }

  const open = event.target.closest(".book-open");
  if (open) {
    window.location.hash = `#/reader/${open.dataset.id}`;
  }
}

async function handleDelete(id, container) {
  const book = libraryBooks.find((entry) => entry.id === id);
  await deleteBook(id);
  await renderLibrary(container);
  showNotice(container, `Deleted “${book?.title ?? "book"}”.`, "info");
}
