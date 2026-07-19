import { getAllBooks, getAllSessions } from "../db/database.js";
import { escapeHtml } from "../utils.js";
import { getTheme, getThemeIcon, cycleTheme } from "../themes/themes.js";
import { navBar, addSheet, bindAddSheet } from "../shell/nav.js";
import {
  totalSeconds,
  dailyTotals,
  secondsByBook,
  capSlices,
  isFinishedBook,
  formatDuration,
  overallWpm,
} from "../sessions/stats.js";

const DAYS = 7;
// Slots 1–5 of the validated categorical palette, in fixed order. Colour
// follows the book, never its rank, so filtering or a change in ranking never
// repaints the others — the index into this list is what the entry carries.
const SERIES = ["series-1", "series-2", "series-3", "series-4", "series-5"];

export async function renderStats(container) {
  const [books, sessions] = await Promise.all([getAllBooks(), getAllSessions()]);

  container.innerHTML = `
    <div class="screen stats-screen">
      <header class="library-header">
        <h1>Stats</h1>
        <button id="theme-toggle" class="icon-button" aria-label="Switch theme">${getThemeIcon(getTheme())}</button>
      </header>

      ${sessions.length ? statsBody(books, sessions) : emptyStats()}

      ${addSheet()}
      ${navBar("#/stats")}
    </div>
  `;

  container.querySelector("#theme-toggle").addEventListener("click", (event) => {
    const theme = cycleTheme();
    event.currentTarget.textContent = getThemeIcon(theme);
  });

  // A phone has no hover, so the readout is driven by tapping a bar.
  container.querySelector("#day-chart")?.addEventListener("click", (event) => {
    const bar = event.target.closest("[data-day]");
    if (bar) selectDay(container, bar);
  });

  bindAddSheet(container, () => {
    window.location.hash = "#/library";
  });
}

function emptyStats() {
  return `<p class="home-empty">Nothing recorded yet. Read for a bit and your numbers will show up here.</p>`;
}

function statsBody(books, sessions) {
  return `
    ${kpiRow(books, sessions)}
    ${dayChart(sessions)}
    ${bookChart(books, sessions)}
  `;
}

/* A handful of headline numbers is a KPI row, not a chart. */
function kpiRow(books, sessions) {
  const finishedBooks = books.filter(isFinishedBook).length;
  const rate = books.length ? Math.round((finishedBooks / books.length) * 100) : 0;

  return `
    <dl class="kpi-row">
      <div class="kpi">
        <dt>Total read</dt>
        <dd>${formatDuration(totalSeconds(sessions))}</dd>
      </div>
      <div class="kpi">
        <dt>Finished</dt>
        <dd>${finishedBooks}<span class="kpi-of"> / ${books.length}</span></dd>
        <p class="kpi-note">${rate}% of your library</p>
      </div>
      <div class="kpi">
        <dt>Your pace</dt>
        <dd>${overallWpm(sessions) || "—"}<span class="kpi-of"> wpm</span></dd>
      </div>
    </dl>
  `;
}

/**
 * Read time per day. One series, so no legend — the heading names it. Today
 * is the point of the chart and the other days are context, so today carries
 * the accent and the rest stay recessive.
 */
function dayChart(sessions) {
  const days = dailyTotals(sessions, DAYS);
  const peak = Math.max(...days.map((day) => day.seconds), 1);

  const bars = days
    .map((day, index) => {
      const label = day.isToday ? "Today" : weekday(day.date);
      // Zero still gets a sliver, so an empty day reads as "nothing" rather
      // than as a missing bar.
      const height = day.seconds ? Math.max((day.seconds / peak) * 100, 2) : 0;
      return `
        <button type="button" class="day-bar${day.isToday ? " current" : ""}"
          data-day="${index}" data-value="${formatDuration(day.seconds)}" data-label="${label}"
          aria-label="${label}: ${day.seconds ? formatDuration(day.seconds) : "nothing read"}">
          <span class="day-bar-track">
            <span class="day-bar-fill" style="height:${height}%"></span>
          </span>
          <span class="day-bar-label">${label}</span>
        </button>
      `;
    })
    .join("");

  const today = days.at(-1);
  return `
    <section class="chart-card">
      <div class="chart-head">
        <h2>Read time</h2>
        <p id="day-readout" class="chart-readout"
          data-default="Today · ${today.seconds ? formatDuration(today.seconds) : "nothing yet"}">
          Today · ${today.seconds ? formatDuration(today.seconds) : "nothing yet"}
        </p>
      </div>
      <div id="day-chart" class="day-chart">${bars}</div>
      <p class="chart-foot">Peak ${formatDuration(peak)} · last ${DAYS} days</p>
    </section>
  `;
}

function weekday(date) {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function selectDay(container, bar) {
  container.querySelectorAll(".day-bar").forEach((other) => {
    other.classList.toggle("current", other === bar);
  });
  container.querySelector("#day-readout").textContent =
    `${bar.dataset.label} · ${bar.dataset.value}`;
}

/**
 * Where the time went, as a part-to-whole bar rather than a donut: book
 * titles are long, and a donut of close values is the hardest way to compare
 * them. Every slice is labelled in the list below, which is also what carries
 * identity for anyone who can't separate the hues.
 */
function bookChart(books, sessions) {
  const entries = capSlices(secondsByBook(sessions, books), SERIES.length);
  if (!entries.length) return "";

  const total = entries.reduce((sum, entry) => sum + entry.seconds, 0);
  const share = (entry) => (entry.seconds / total) * 100;

  const segments = entries
    .map(
      (entry, index) =>
        `<span class="share-segment" style="width:${share(entry)}%;background:var(--${SERIES[index]})"
           role="presentation"></span>`
    )
    .join("");

  const legend = entries
    .map(
      (entry, index) => `
        <li>
          <span class="legend-swatch" style="background:var(--${SERIES[index]})"></span>
          <span class="legend-title">${escapeHtml(entry.title)}</span>
          <span class="legend-value">${Math.round(share(entry))}% · ${formatDuration(entry.seconds)}</span>
        </li>
      `
    )
    .join("");

  return `
    <section class="chart-card">
      <div class="chart-head"><h2>Where your time goes</h2></div>
      <div class="share-bar">${segments}</div>
      <ul class="legend">${legend}</ul>
    </section>
  `;
}
