import { getBook, updateProgress } from "../db/database.js";
import { tokenize, escapeHtml } from "../utils.js";
import { getOrpIndex } from "./rsvp.js";

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

  const words = tokenize(book.text);
  const wpm = clampWpm(Number(localStorage.getItem(WPM_STORAGE_KEY)) || 300);
  const mode = localStorage.getItem(MODE_STORAGE_KEY) === "manual" ? "manual" : "auto";

  state = {
    book,
    words,
    index: Math.min(book.progress || 0, Math.max(words.length - 1, 0)),
    wpm,
    mode,
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
}

function modeLabel(mode) {
  return mode === "manual" ? "Manual" : "Auto";
}

function clampWpm(wpm) {
  return Math.min(MAX_WPM, Math.max(MIN_WPM, wpm));
}

function renderWord() {
  const wordEl = document.getElementById("word");
  if (!wordEl) return;

  const word = state.words[state.index] ?? "";
  const orpIndex = Math.min(getOrpIndex(word), Math.max(word.length - 1, 0));

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
  scheduleNext();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timerId);
  saveProgress();
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

function saveProgress() {
  updateProgress(state.book.id, state.index);
}

function handleBack() {
  pause();
  window.location.hash = "#/library";
}

// Called by the router before leaving the reader route (e.g. swipe-back
// navigation, not just the in-app back button), so a playing timer never
// keeps ticking against a state that's no longer on screen.
export function stopReader() {
  if (state && state.playing) {
    pause();
  }
}
