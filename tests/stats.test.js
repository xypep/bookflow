import test from "node:test";
import assert from "node:assert/strict";

import {
  dayKey,
  secondsOnDay,
  wordsOnDay,
  streakDays,
  overallWpm,
  lastReadBookId,
  bookToContinue,
  totalSeconds,
  dailyTotals,
  secondsByBook,
  capSlices,
  isFinishedBook,
  formatDuration,
} from "../src/sessions/stats.js";

// Sessions are built at local times, because a reading day is a local day and
// building them from UTC strings would hide exactly the bug that matters.
function at(year, month, day, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

function session(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    bookId: "book",
    start: at(2026, 7, 19),
    durationSec: 600,
    wordsRead: 3000,
    avgWpm: 300,
    ...overrides,
  };
}

const TODAY = new Date(2026, 6, 19, 21, 0);

test("a day key follows local time, not UTC", () => {
  // Late evening local can already be the next day in UTC.
  const lateEvening = new Date(2026, 6, 19, 23, 30);

  assert.equal(dayKey(lateEvening), "2026-07-19");
  assert.equal(dayKey(lateEvening.toISOString()), "2026-07-19");
});

test("today's total only counts today", () => {
  const sessions = [
    session({ start: at(2026, 7, 19, 9), durationSec: 300 }),
    session({ start: at(2026, 7, 19, 20), durationSec: 540 }),
    session({ start: at(2026, 7, 18, 20), durationSec: 900 }),
  ];

  assert.equal(secondsOnDay(sessions, TODAY), 840);
  assert.equal(secondsOnDay(sessions, new Date(2026, 6, 18)), 900);
});

test("a session still in progress is left out of the totals", () => {
  const sessions = [
    session({ start: at(2026, 7, 19), durationSec: 600, wordsRead: 3000 }),
    session({ start: at(2026, 7, 19), durationSec: 120, wordsRead: 600, inProgress: true }),
  ];

  assert.equal(secondsOnDay(sessions, TODAY), 600);
  assert.equal(wordsOnDay(sessions, TODAY), 3000);
});

test("an empty day totals zero rather than failing", () => {
  assert.equal(secondsOnDay([], TODAY), 0);
  assert.equal(wordsOnDay([], TODAY), 0);
  assert.equal(overallWpm([]), 0);
  assert.equal(streakDays([], TODAY), 0);
});

test("a streak counts back over consecutive days", () => {
  const sessions = [17, 18, 19].map((day) => session({ start: at(2026, 7, day) }));

  assert.equal(streakDays(sessions, TODAY), 3);
});

test("a gap ends the streak", () => {
  const sessions = [15, 18, 19].map((day) => session({ start: at(2026, 7, day) }));

  assert.equal(streakDays(sessions, TODAY), 2);
});

test("a day with no reading yet does not break the streak", () => {
  // Nothing read today, but yesterday and the day before count: the day isn't
  // over, so the streak is still alive.
  const sessions = [17, 18].map((day) => session({ start: at(2026, 7, day) }));

  assert.equal(streakDays(sessions, TODAY), 2);
});

test("a streak that ended before yesterday counts as zero", () => {
  const sessions = [15, 16].map((day) => session({ start: at(2026, 7, day) }));

  assert.equal(streakDays(sessions, TODAY), 0);
});

test("several sessions on one day count as one streak day", () => {
  const sessions = [
    session({ start: at(2026, 7, 19, 8) }),
    session({ start: at(2026, 7, 19, 21) }),
  ];

  assert.equal(streakDays(sessions, TODAY), 1);
});

test("overall speed weights sessions by how long they ran", () => {
  const sessions = [
    session({ durationSec: 60, wordsRead: 600 }), // 600 wpm, but short
    session({ durationSec: 540, wordsRead: 2700 }), // 300 wpm, much longer
  ];

  // 3300 words over 10 minutes — not the average of 600 and 300.
  assert.equal(overallWpm(sessions), 330);
});

test("the last read book is the one most recently started", () => {
  const sessions = [
    session({ bookId: "old", start: at(2026, 7, 18, 20) }),
    session({ bookId: "newest", start: at(2026, 7, 19, 20) }),
    session({ bookId: "middle", start: at(2026, 7, 19, 9) }),
  ];

  assert.equal(lastReadBookId(sessions), "newest");
});

test("continue offers the book last opened, even with no session for it", () => {
  const books = [{ id: "a", progress: 0 }, { id: "b", progress: 40 }];
  // A visit too short to be recorded still counts as the book being read:
  // the session for "b" is the older one, but "a" is where the reader was.
  const sessions = [session({ bookId: "b" })];

  assert.equal(bookToContinue(books, sessions, "a").id, "a");
});

test("continue falls back to the last session when nothing was opened here", () => {
  const books = [{ id: "a", progress: 0 }, { id: "b", progress: 40 }];
  const sessions = [session({ bookId: "b" })];

  assert.equal(bookToContinue(books, sessions, null).id, "b");
});

test("a last-opened book that has since been deleted is ignored", () => {
  const books = [{ id: "a", progress: 0 }, { id: "b", progress: 40 }];
  const sessions = [session({ bookId: "b" })];

  assert.equal(bookToContinue(books, sessions, "deleted-since").id, "b");
});

test("with no sessions it falls back to a book already started", () => {
  const books = [{ id: "fresh", progress: 0 }, { id: "started", progress: 120 }];

  assert.equal(bookToContinue(books, []).id, "started");
});

test("with nothing started it offers the newest book", () => {
  const books = [{ id: "newest", progress: 0 }, { id: "older", progress: 0 }];

  assert.equal(bookToContinue(books, []).id, "newest");
});

test("a session pointing at a deleted book does not strand the home screen", () => {
  const books = [{ id: "still-here", progress: 5 }];
  const sessions = [session({ bookId: "deleted-since" })];

  assert.equal(bookToContinue(books, sessions).id, "still-here");
});

test("an empty library offers nothing", () => {
  assert.equal(bookToContinue([], []), null);
});

/* Chart inputs */

test("the daily series covers every day, including empty ones", () => {
  const sessions = [
    session({ start: at(2026, 7, 19), durationSec: 600 }),
    session({ start: at(2026, 7, 16), durationSec: 300 }),
  ];

  const days = dailyTotals(sessions, 7, TODAY);

  assert.equal(days.length, 7);
  // Oldest first, so the chart reads left to right.
  assert.deepEqual(days.map((d) => d.key.slice(-2)), ["13", "14", "15", "16", "17", "18", "19"]);
  // A day with no reading is a visible zero, not a missing bar.
  assert.deepEqual(days.map((d) => d.seconds), [0, 0, 0, 300, 0, 0, 600]);
  assert.equal(days.at(-1).isToday, true);
});

test("several sessions on the same day add up in the series", () => {
  const sessions = [
    session({ start: at(2026, 7, 19, 8), durationSec: 300 }),
    session({ start: at(2026, 7, 19, 21), durationSec: 240 }),
  ];

  assert.equal(dailyTotals(sessions, 7, TODAY).at(-1).seconds, 540);
});

test("time per book is ranked and titled", () => {
  const books = [
    { id: "a", title: "Echo" },
    { id: "b", title: "Dune" },
  ];
  const sessions = [
    session({ bookId: "a", durationSec: 300 }),
    session({ bookId: "b", durationSec: 900 }),
    session({ bookId: "a", durationSec: 200 }),
  ];

  assert.deepEqual(secondsByBook(sessions, books), [
    { bookId: "b", title: "Dune", seconds: 900 },
    { bookId: "a", title: "Echo", seconds: 500 },
  ]);
});

test("sessions of a deleted book are left out rather than shown unnamed", () => {
  const books = [{ id: "a", title: "Echo" }];
  const sessions = [session({ bookId: "a" }), session({ bookId: "gone" })];

  assert.deepEqual(secondsByBook(sessions, books).map((e) => e.bookId), ["a"]);
});

test("a short list of books is left alone", () => {
  const entries = [1, 2, 3].map((n) => ({ bookId: `${n}`, title: `B${n}`, seconds: n }));

  assert.deepEqual(capSlices(entries, 5), entries);
});

test("a long tail of books folds into one entry", () => {
  const entries = [50, 40, 30, 20, 10, 5].map((s, i) => ({
    bookId: `${i}`,
    title: `B${i}`,
    seconds: s,
  }));

  const capped = capSlices(entries, 5);

  assert.equal(capped.length, 5);
  assert.equal(capped.at(-1).title, "2 more books");
  assert.equal(capped.at(-1).seconds, 15);
  // Nothing may be lost in the fold, or the shares stop summing to the whole.
  assert.equal(
    capped.reduce((t, e) => t + e.seconds, 0),
    entries.reduce((t, e) => t + e.seconds, 0)
  );
});

test("a book counts as finished only at the last word", () => {
  assert.equal(isFinishedBook({ wordCount: 400, progress: 399 }), true);
  assert.equal(isFinishedBook({ wordCount: 400, progress: 398 }), false);
  // An empty book must not count as finished just because 0 >= -1.
  assert.equal(isFinishedBook({ wordCount: 0, progress: 0 }), false);
});

test("total time ignores a session still running", () => {
  const sessions = [
    session({ durationSec: 600 }),
    session({ durationSec: 300, inProgress: true }),
  ];

  assert.equal(totalSeconds(sessions), 600);
});

test("durations read the way a person would say them", () => {
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(600), "10m");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(5040), "1h 24m");
});
