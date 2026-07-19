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
