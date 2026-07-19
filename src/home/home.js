import { getAllBooks, getAllSessions } from "../db/database.js";
import { escapeHtml } from "../utils.js";
import { getTheme, getThemeIcon, cycleTheme } from "../themes/themes.js";
import { navBar, addSheet, bindAddSheet } from "../shell/nav.js";
import { coverStyle, coverInitials } from "../library/covers.js";
import { secondsOnDay, wordsOnDay, streakDays, overallWpm, bookToContinue } from "../sessions/stats.js";

const GOAL_STORAGE_KEY = "book-flow-daily-goal";
const GOAL_STEP = 5;
const MIN_GOAL = 5;
const MAX_GOAL = 180;

function getGoal() {
  const stored = Number(localStorage.getItem(GOAL_STORAGE_KEY));
  return clampGoal(stored || 30);
}

function clampGoal(minutes) {
  return Math.min(MAX_GOAL, Math.max(MIN_GOAL, minutes));
}

export async function renderHome(container) {
  const [books, sessions] = await Promise.all([getAllBooks(), getAllSessions()]);
  const book = bookToContinue(books, sessions);

  container.innerHTML = `
    <div class="screen home-screen">
      <header class="library-header">
        <h1>Book Flow</h1>
        <button id="theme-toggle" class="icon-button" aria-label="Switch theme">${getThemeIcon(getTheme())}</button>
      </header>

      <p id="goal-headline" class="goal-headline">${goalHeadline(sessions, getGoal())}</p>

      <div class="goal-control">
        <button id="goal-down" aria-label="Lower daily goal">−</button>
        <span id="goal-value">${getGoal()} min a day</span>
        <button id="goal-up" aria-label="Raise daily goal">+</button>
      </div>

      ${factsCard(sessions)}
      ${continueCard(book)}

      ${addSheet()}
      ${navBar("#/")}
    </div>
  `;

  container.querySelector("#theme-toggle").addEventListener("click", (event) => {
    const theme = cycleTheme();
    event.currentTarget.textContent = getThemeIcon(theme);
  });

  container.querySelector("#goal-down").addEventListener("click", () => changeGoal(container, sessions, -GOAL_STEP));
  container.querySelector("#goal-up").addEventListener("click", () => changeGoal(container, sessions, GOAL_STEP));

  container.querySelector("#continue-card")?.addEventListener("click", (event) => {
    window.location.hash = `#/reader/${event.currentTarget.dataset.id}`;
  });

  bindAddSheet(container, () => {
    window.location.hash = "#/library";
  });
}

function changeGoal(container, sessions, delta) {
  const goal = clampGoal(getGoal() + delta);
  localStorage.setItem(GOAL_STORAGE_KEY, String(goal));

  container.querySelector("#goal-value").textContent = `${goal} min a day`;
  container.querySelector("#goal-headline").innerHTML = goalHeadline(sessions, goal);
}

// The headline is the one thing on this screen worth reading from across the
// room, so it says the single number that matters and nothing else.
function goalHeadline(sessions, goal) {
  const minutesRead = Math.floor(secondsOnDay(sessions) / 60);
  const remaining = goal - minutesRead;

  if (!sessions.length) {
    return `Read <em>${goal} min</em> a day.<br />Start whenever you like.`;
  }
  if (remaining <= 0) {
    return `You read <em>${minutesRead} min</em> today.<br />Goal reached.`;
  }
  if (minutesRead === 0) {
    return `<em>${goal} min</em> to go<br />to reach today's goal.`;
  }
  return `<em>${remaining} min</em> more to reach<br />your goal of ${goal} min a day.`;
}

function factsCard(sessions) {
  const streak = streakDays(sessions);
  const words = wordsOnDay(sessions);
  const wpm = overallWpm(sessions);

  return `
    <section class="facts-card">
      <h2>Facts</h2>
      <dl class="facts-list">
        <div><dt>Streak</dt><dd>${streak} ${streak === 1 ? "day" : "days"}</dd></div>
        <div><dt>Words today</dt><dd>${words.toLocaleString()}</dd></div>
        <div><dt>Your pace</dt><dd>${wpm ? `${wpm} wpm` : "—"}</dd></div>
      </dl>
    </section>
  `;
}

function continueCard(book) {
  if (!book) {
    return `<p class="home-empty">No books yet — tap + to add one.</p>`;
  }

  const total = book.wordCount || 0;
  const percent = total > 1 ? Math.round((book.progress / (total - 1)) * 100) : 0;

  return `
    <button type="button" id="continue-card" class="continue-card" data-id="${book.id}">
      <span class="continue-cover" style="${coverStyle(book.title)}">
        <span class="book-cover-spine"></span>
        <span class="book-cover-initials">${escapeHtml(coverInitials(book.title))}</span>
      </span>
      <span class="continue-body">
        <span class="continue-label">Continue reading</span>
        <span class="continue-title">${escapeHtml(book.title)}</span>
        <span class="book-meter"><span class="book-meter-fill" style="width:${percent}%"></span></span>
        <span class="book-percent">${percent}%</span>
      </span>
    </button>
  `;
}
