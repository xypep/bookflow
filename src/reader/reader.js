import { getBook, updateProgress } from "../db/database.js";
import { tokenize, escapeHtml } from "../utils.js";
import { getOrpIndex } from "./rsvp.js";
import { findChapters, chapterAt } from "./chapters.js";
import { startSession, pauseSession, countWord, endSession } from "../sessions/sessionTracker.js";
import { setLastOpenedBookId } from "./recent.js";

const WPM_STORAGE_KEY = "book-flow-wpm";
const MODE_STORAGE_KEY = "book-flow-mode";
const MIN_WPM = 100;
const MAX_WPM = 900;
const WPM_STEP = 25;

let state = null;

export async function renderReader(container, bookId) {
  const book = await getBook(bookId);
  if (!book) {
    window.location.hash = "#/library";
    return;
  }

  // Opening the reader is what "started reading" means, whether or not the
  // visit lasts long enough to become a session.
  setLastOpenedBookId(book.id);

  const words = tokenize(book.text);
  const chapters = findChapters(book.text);
  const wpm = clampWpm(Number(localStorage.getItem(WPM_STORAGE_KEY)) || 300);
  const mode = localStorage.getItem(MODE_STORAGE_KEY) === "manual" ? "manual" : "auto";

  state = {
    book,
    words,
    index: Math.min(book.progress || 0, Math.max(words.length - 1, 0)),
    wpm,
    mode,
    chapters,
    playing: false,
    timerId: null,
  };

  container.innerHTML = `
    <div class="screen reader-screen">
      <header class="reader-header">
        <button id="back-button" class="icon-button" aria-label="Back to library">‹</button>
        <div class="wpm-control">
          <button id="wpm-down" aria-label="Decrease speed">−</button>
          <span id="wpm-value">${wpm} WPM</span>
          <button id="wpm-up" aria-label="Increase speed">+</button>
        </div>
        <button id="mode-toggle" class="icon-button" aria-label="Switch tap mode">${modeLabel(mode)}</button>
        ${chapters.length ? `<button id="chapter-button" class="icon-button" aria-label="Jump to chapter">☰</button>` : ""}
      </header>

      <div class="reader-tap-zones">
        <div id="tap-left" class="tap-zone tap-left" aria-label="Pause / step back"></div>
        <div class="word-display">
          <div id="word" class="rsvp-word"></div>
        </div>
        <div id="tap-right" class="tap-zone tap-right" aria-label="Play / step forward"></div>
      </div>

      <div class="progress-bar">
        <div id="progress-fill" class="progress-fill"></div>
      </div>

      ${chapters.length ? chapterModal(chapters) : ""}
    </div>
  `;

  renderWord();
  updateProgressBar();

  container.querySelector("#back-button").addEventListener("click", handleBack);
  container.querySelector("#wpm-down").addEventListener("click", () => changeWpm(-WPM_STEP));
  container.querySelector("#wpm-up").addEventListener("click", () => changeWpm(WPM_STEP));
  container.querySelector("#tap-left").addEventListener("click", handleTapLeft);
  container.querySelector("#tap-right").addEventListener("click", handleTapRight);
  container.querySelector("#mode-toggle").addEventListener("click", toggleMode);

  if (chapters.length) {
    container.querySelector("#chapter-button").addEventListener("click", () => toggleChapters(true));
    container.querySelector("#chapter-close").addEventListener("click", () => toggleChapters(false));
    container.querySelector("#chapter-list").addEventListener("click", handleChapterPick);
  }
}

function chapterModal(chapters) {
  return `
    <div id="chapter-modal" class="modal hidden">
      <div class="modal-content chapter-sheet">
        <ul id="chapter-list" class="chapter-list">
          ${chapters
            .map(
              (chapter, index) =>
                `<li><button type="button" data-index="${index}">${escapeHtml(chapter.title)}</button></li>`
            )
            .join("")}
        </ul>
        <div class="modal-actions">
          <button id="chapter-close">Close</button>
        </div>
      </div>
    </div>
  `;
}

function toggleChapters(show) {
  const modal = document.getElementById("chapter-modal");
  if (!modal) return;

  // Jumping while the timer runs would land on the wrong word a moment later.
  if (show && state.playing) pause();

  modal.classList.toggle("hidden", !show);
  if (show) markCurrentChapter();
}

function markCurrentChapter() {
  const current = chapterAt(state.chapters, state.index);
  document.querySelectorAll("#chapter-list button").forEach((button, index) => {
    button.classList.toggle("current", current === state.chapters[index]);
  });
}

function handleChapterPick(event) {
  const button = event.target.closest("button[data-index]");
  if (!button) return;

  state.index = state.chapters[Number(button.dataset.index)].index;
  renderWord();
  updateProgressBar();
  saveProgress();
  toggleChapters(false);
}

function modeLabel(mode) {
  return mode === "manual" ? "Manual" : "Auto";
}

function clampWpm(wpm) {
  return Math.min(MAX_WPM, Math.max(MIN_WPM, wpm));
}

// Words beyond this length start shrinking so OCR artifacts (merged words,
// long compounds) don't get clipped off-screen at full size.
const COMFORTABLE_WORD_LENGTH = 10;
const MIN_WORD_SCALE = 0.35;

function wordScale(word) {
  if (word.length <= COMFORTABLE_WORD_LENGTH) return 1;
  return Math.max(MIN_WORD_SCALE, COMFORTABLE_WORD_LENGTH / word.length);
}

function renderWord() {
  const wordEl = document.getElementById("word");
  if (!wordEl) return;

  const word = state.words[state.index] ?? "";
  const orpIndex = Math.min(getOrpIndex(word), Math.max(word.length - 1, 0));

  wordEl.style.setProperty("--word-scale", wordScale(word));
  wordEl.innerHTML =
    `<span class="word-before">${escapeHtml(word.slice(0, orpIndex))}</span>` +
    `<span class="word-orp">${escapeHtml(word[orpIndex] ?? "")}</span>` +
    `<span class="word-after">${escapeHtml(word.slice(orpIndex + 1))}</span>`;
}

function updateProgressBar() {
  const fill = document.getElementById("progress-fill");
  if (!fill) return;
  const total = state.words.length - 1 || 1;
  fill.style.width = `${(state.index / total) * 100}%`;
}

function scheduleNext() {
  clearTimeout(state.timerId);
  state.timerId = setTimeout(tick, 60000 / state.wpm);
}

function tick() {
  if (state.index >= state.words.length - 1) {
    pause();
    return;
  }
  state.index += 1;
  countWord();
  renderWord();
  updateProgressBar();
  saveProgress();
  scheduleNext();
}

function play() {
  if (state.playing || !state.words.length) return;
  if (state.index >= state.words.length - 1) {
    state.index = 0;
  }
  state.playing = true;
  startSession(state.book.id);
  scheduleNext();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timerId);
  pauseSession();
  saveProgress();
  flushProgress();
}

function stepBack() {
  state.index = Math.max(0, state.index - 1);
  renderWord();
  updateProgressBar();
  saveProgress();
}

function stepForward() {
  state.index = Math.min(state.words.length - 1, state.index + 1);
  renderWord();
  updateProgressBar();
  saveProgress();
}

function handleTapLeft() {
  if (state.mode === "manual") {
    stepBack();
  } else if (state.playing) {
    pause();
  } else {
    stepBack();
  }
}

function handleTapRight() {
  if (state.mode === "manual") {
    stepForward();
  } else if (state.playing) {
    stepForward();
  } else {
    play();
  }
}

function toggleMode() {
  if (state.playing) {
    pause();
  }
  state.mode = state.mode === "manual" ? "auto" : "manual";
  localStorage.setItem(MODE_STORAGE_KEY, state.mode);
  document.getElementById("mode-toggle").textContent = modeLabel(state.mode);
}

function changeWpm(delta) {
  state.wpm = clampWpm(state.wpm + delta);
  localStorage.setItem(WPM_STORAGE_KEY, String(state.wpm));
  document.getElementById("wpm-value").textContent = `${state.wpm} WPM`;
  if (state.playing) {
    scheduleNext();
  }
}

// Progress changes on every word, which is far more often than it needs to be
// persisted. Writes are throttled, and the pending position is captured by
// value so a write that lands after navigation still targets the right book.
const PROGRESS_SAVE_INTERVAL = 1000;

let pendingSave = null;
let progressSaveTimer = null;

function saveProgress() {
  pendingSave = { id: state.book.id, index: state.index };
  if (progressSaveTimer) return;
  progressSaveTimer = setTimeout(flushProgress, PROGRESS_SAVE_INTERVAL);
}

function flushProgress() {
  clearTimeout(progressSaveTimer);
  progressSaveTimer = null;
  if (!pendingSave) return;

  updateProgress(pendingSave.id, pendingSave.index);
  pendingSave = null;
}

function handleBack() {
  pause();
  window.location.hash = "#/library";
}

// Called by the router before leaving the reader route (e.g. swipe-back
// navigation, not just the in-app back button), so a playing timer never
// keeps ticking against a state that's no longer on screen.
export function stopReader() {
  if (!state) return;
  if (state.playing) {
    pause();
  }
  flushProgress();
  // Leaving the reader closes the session even if the pause timeout hasn't
  // run out — the next book (or the next visit) starts a fresh one.
  endSession();
}
