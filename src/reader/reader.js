import { getBook, updateProgress } from "../db/database.js";
import { tokenize, escapeHtml } from "../utils.js";
import { getOrpIndex, getBionicLength } from "./rsvp.js";
import { findChapters, chapterAt } from "./chapters.js";
import { startSession, pauseSession, countWord, endSession } from "../sessions/sessionTracker.js";
import { setLastOpenedBookId } from "./recent.js";

const WPM_STORAGE_KEY = "book-flow-wpm";
const MODE_STORAGE_KEY = "book-flow-mode";
const BIONIC_STORAGE_KEY = "book-flow-bionic";
const MENU_STORAGE_KEY = "book-flow-reader-menu";
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
  const bionic = localStorage.getItem(BIONIC_STORAGE_KEY) === "on";
  const menuOpen = localStorage.getItem(MENU_STORAGE_KEY) !== "closed";

  state = {
    book,
    words,
    index: Math.min(book.progress || 0, Math.max(words.length - 1, 0)),
    wpm,
    mode,
    bionic,
    menuOpen,
    chapters,
    playing: false,
    timerId: null,
  };

  container.innerHTML = `
    <div class="screen reader-screen">
      <header id="reader-menu" class="reader-menu${menuOpen ? "" : " collapsed"}">
        <button id="menu-toggle" class="reader-menu-button toggle" aria-expanded="${menuOpen}"
          aria-label="${menuOpen ? "Hide menu" : "Show menu"}">${chevronIcon()}</button>
        <button id="home-button" class="reader-menu-button" aria-label="Home">${homeIcon()}</button>
        <button id="reader-settings-button" class="reader-menu-button" aria-label="Reading settings">${slidersIcon()}</button>
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
      ${settingsSheet({ wpm, mode, bionic, hasChapters: chapters.length > 0 })}
    </div>
  `;

  renderWord();
  updateProgressBar();

  container.querySelector("#menu-toggle").addEventListener("click", toggleMenu);
  container.querySelector("#home-button").addEventListener("click", handleHome);
  container.querySelector("#tap-left").addEventListener("click", handleTapLeft);
  container.querySelector("#tap-right").addEventListener("click", handleTapRight);

  container.querySelector("#reader-settings-button").addEventListener("click", () => {
    toggleSettings(true);
  });
  container.querySelector("#reader-settings").addEventListener("click", handleSettingsClick);

  if (chapters.length) {
    container.querySelector("#chapter-close").addEventListener("click", () => toggleChapters(false));
    container.querySelector("#chapter-list").addEventListener("click", handleChapterPick);
  }
}

// Inline SVG so the icons inherit the theme's text colour, matching the
// bottom navigation elsewhere in the app.
function icon(paths, width = 1.8) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function chevronIcon() {
  // Spans nearly the full box: a chevron is a flat shape, and drawn small it
  // reads as a stray mark next to icons that fill their box.
  return icon(`<path d="M4 8.5l8 8 8-8" />`, 2.4);
}

function homeIcon() {
  return icon(`<path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20h13V9.5" />`);
}

function slidersIcon() {
  return icon(
    `<circle cx="8" cy="8" r="2.4" /><path d="M10.4 8H21" /><path d="M3 8h2.6" />
     <circle cx="16" cy="16" r="2.4" /><path d="M18.4 16H21" /><path d="M3 16h10.6" />`
  );
}

// Collapsing leaves only the chevron, so a long reading session isn't spent
// looking at controls. The choice sticks: someone who wants the screen clear
// wants it clear next time too.
function toggleMenu() {
  state.menuOpen = !state.menuOpen;
  localStorage.setItem(MENU_STORAGE_KEY, state.menuOpen ? "open" : "closed");

  const menu = document.getElementById("reader-menu");
  menu.classList.toggle("collapsed", !state.menuOpen);

  const toggle = document.getElementById("menu-toggle");
  toggle.setAttribute("aria-expanded", String(state.menuOpen));
  toggle.setAttribute("aria-label", state.menuOpen ? "Hide menu" : "Show menu");
}

function handleHome() {
  pause();
  flushProgress();
  endSession();
  window.location.hash = "#/";
}

function settingsSheet({ wpm, mode, bionic, hasChapters }) {
  return `
    <div id="reader-settings" class="add-sheet hidden">
      <div class="add-sheet-backdrop" data-close="1"></div>
      <div class="add-sheet-options">
        <p class="add-sheet-title">Reading</p>

        <div class="setting-row static">
          <span class="setting-text">
            <span class="setting-name">Speed</span>
            <span class="setting-note">Words shown per minute.</span>
          </span>
          <span class="stepper">
            <button type="button" data-wpm="-1" aria-label="Decrease speed">−</button>
            <span id="wpm-value">${wpm}</span>
            <button type="button" data-wpm="1" aria-label="Increase speed">+</button>
          </span>
        </div>

        <div class="setting-row static">
          <span class="setting-text">
            <span class="setting-name">Tapping</span>
            <span class="setting-note">Auto plays on its own; manual steps a word per tap.</span>
          </span>
          <span class="segmented" role="group" aria-label="Tap mode">
            <button type="button" data-mode="auto" aria-pressed="${mode === "auto"}">Auto</button>
            <button type="button" data-mode="manual" aria-pressed="${mode === "manual"}">Manual</button>
          </span>
        </div>

        <button type="button" class="setting-row" data-setting="bionic" aria-pressed="${bionic}">
          <span class="setting-text">
            <span class="setting-name">Bold first letters</span>
            <span class="setting-note">Emboldens the start of each word so the eye can complete it.</span>
          </span>
          <span class="setting-switch" aria-hidden="true"></span>
        </button>

        ${hasChapters ? `<button type="button" data-jump="chapters">Jump to chapter</button>` : ""}
        <button type="button" data-close="1">Done</button>
      </div>
    </div>
  `;
}

function toggleSettings(show) {
  // The word would advance behind the sheet, and the setting is about how the
  // word looks — so playback stops while it's open.
  if (show && state.playing) pause();
  document.getElementById("reader-settings")?.classList.toggle("hidden", !show);
}

function handleSettingsClick(event) {
  const step = event.target.closest("[data-wpm]");
  if (step) {
    changeWpm(Number(step.dataset.wpm) * WPM_STEP);
    return;
  }

  const modeButton = event.target.closest("[data-mode]");
  if (modeButton) {
    setMode(modeButton.dataset.mode);
    return;
  }

  if (event.target.closest("[data-jump]")) {
    toggleSettings(false);
    toggleChapters(true);
    return;
  }

  const setting = event.target.closest("[data-setting]");
  if (setting?.dataset.setting === "bionic") {
    state.bionic = !state.bionic;
    localStorage.setItem(BIONIC_STORAGE_KEY, state.bionic ? "on" : "off");
    setting.setAttribute("aria-pressed", String(state.bionic));
    // Shows the change on the word already on screen, rather than at the next
    // tick — which in manual mode might never come.
    renderWord();
    return;
  }

  if (event.target.closest("[data-close]")) toggleSettings(false);
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

// The emboldened opening and the fixation letter overlap, so each of the three
// display segments is split again at whatever part of it falls inside the
// bold prefix. `from` is the segment's offset within the whole word.
function segment(text, from, boldUntil) {
  const bold = Math.min(Math.max(boldUntil - from, 0), text.length);
  if (!bold) return escapeHtml(text);
  return `<b>${escapeHtml(text.slice(0, bold))}</b>${escapeHtml(text.slice(bold))}`;
}

function renderWord() {
  const wordEl = document.getElementById("word");
  if (!wordEl) return;

  const word = state.words[state.index] ?? "";
  const orpIndex = Math.min(getOrpIndex(word), Math.max(word.length - 1, 0));
  const boldUntil = state.bionic ? getBionicLength(word) : 0;

  wordEl.style.setProperty("--word-scale", wordScale(word));
  wordEl.classList.toggle("bionic", state.bionic);
  wordEl.innerHTML =
    `<span class="word-before">${segment(word.slice(0, orpIndex), 0, boldUntil)}</span>` +
    `<span class="word-orp">${segment(word[orpIndex] ?? "", orpIndex, boldUntil)}</span>` +
    `<span class="word-after">${segment(word.slice(orpIndex + 1), orpIndex + 1, boldUntil)}</span>`;
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

function setMode(mode) {
  if (state.mode === mode) return;
  if (state.playing) pause();

  state.mode = mode;
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
}

function changeWpm(delta) {
  state.wpm = clampWpm(state.wpm + delta);
  localStorage.setItem(WPM_STORAGE_KEY, String(state.wpm));
  document.getElementById("wpm-value").textContent = String(state.wpm);
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

// Called by the router before leaving the reader route (e.g. swipe-back
// navigation, not just the home button), so a playing timer never keeps
// ticking against a state that's no longer on screen.
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
