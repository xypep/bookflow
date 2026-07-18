import { addBook, getAllBooks, deleteBook } from "../db/database.js";
import { tokenize, escapeHtml } from "../utils.js";
import { getTheme, getThemeIcon, cycleTheme } from "../themes/themes.js";
import { scanPages } from "../scanner/scanner.js";

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
    container.querySelector("#scan-input").click();
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
    container.querySelector("#scan-input").click();
  });

  container.querySelector(".book-list").addEventListener("click", (event) => {
    handleListClick(event, container);
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

async function handleScan(event, container) {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  toggleScanOverlay(container, true);

  try {
    const text = await scanPages(files, (page, total) => {
      setScanStatus(container, `Scanning page ${page} of ${total}…`);
    });

    toggleScanOverlay(container, false);

    // Scanned text often needs a manual fix here and there (OCR isn't
    // perfect), so it's opened in the paste modal for review before saving
    // instead of being saved straight away. If the modal is already open
    // (via "Scan more pages"), the new pages are appended to the draft
    // instead of replacing it, so a book can be built up scan by scan.
    const modal = container.querySelector("#paste-modal");
    if (modal.classList.contains("hidden")) {
      togglePasteModal(container, true, {
        title: `Scan ${new Date().toLocaleDateString()}`,
        text,
      });
    } else {
      const textarea = container.querySelector("#paste-text");
      textarea.value = textarea.value ? `${textarea.value}\n\n${text}` : text;
    }
  } catch (error) {
    toggleScanOverlay(container, false);
    window.alert("Scanning failed. Please try again.");
    console.error(error);
  }

  event.target.value = "";
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
