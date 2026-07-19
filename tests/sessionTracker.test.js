import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";

const tracker = await import("../src/sessions/sessionTracker.js");
const db = await import("../src/db/database.js");

// Real sessions run for minutes, so the tracker reads the clock through an
// injectable function rather than sleeping through the tests.
let clock = 0;
tracker.setClock(() => clock);

function advance(seconds) {
  clock += seconds * 1000;
}

async function readWords(bookId, count, { wpm = 300 } = {}) {
  await tracker.startSession(bookId);
  for (let i = 0; i < count; i += 1) {
    advance(60 / wpm);
    tracker.countWord();
  }
}

test("a session shorter than 15 seconds is discarded", async () => {
  await readWords("short-book", 20, { wpm: 300 });
  const session = await tracker.endSession();

  assert.equal(session, null);
  assert.equal((await db.getSessionsForBook("short-book")).length, 0);
});

test("a real session is stored with its active time and words", async () => {
  await readWords("book-a", 300, { wpm: 300 });
  const session = await tracker.endSession();

  assert.equal(session.bookId, "book-a");
  assert.equal(session.durationSec, 60);
  assert.equal(session.wordsRead, 300);
  assert.equal(session.avgWpm, 300);
});

test("paused time does not count towards the session", async () => {
  await readWords("book-b", 300, { wpm: 300 });
  await tracker.pauseSession();
  advance(45);
  await tracker.startSession("book-b");
  advance(30);
  const session = await tracker.endSession();

  // 60s of reading plus 30s of reading after the pause — the 45s pause itself
  // is excluded.
  assert.equal(session.durationSec, 90);
});

test("avgWpm reflects the words actually read, not the configured speed", async () => {
  // Half a minute of reading at 200 WPM leaves 100 words on the clock.
  await readWords("book-c", 100, { wpm: 200 });
  const session = await tracker.endSession();

  assert.equal(session.avgWpm, 200);
});

test("words counted while paused are ignored", async () => {
  await readWords("book-d", 300, { wpm: 300 });
  await tracker.pauseSession();
  tracker.countWord();
  const session = await tracker.endSession();

  assert.equal(session.wordsRead, 300);
});

test("switching books closes the session for the previous one", async () => {
  await readWords("book-e", 300, { wpm: 300 });
  await tracker.startSession("book-f");
  advance(30);
  await tracker.endSession();

  const [first] = await db.getSessionsForBook("book-e");
  assert.equal(first.durationSec, 60);
  assert.equal((await db.getSessionsForBook("book-f")).length, 1);
});

test("a session left in progress by a killed app is finalized on next launch", async () => {
  await db.putSession({
    id: "crashed",
    bookId: "book-g",
    start: "2026-07-19T21:10:00.000Z",
    durationSec: 840,
    wordsRead: 4900,
    avgWpm: 350,
    inProgress: true,
  });

  await tracker.recoverSessions();

  const [recovered] = await db.getSessionsForBook("book-g");
  assert.equal(recovered.inProgress, undefined);
  assert.equal(recovered.durationSec, 840);
  assert.equal(recovered.wordsRead, 4900);
});

test("a too-short marker is dropped rather than recovered", async () => {
  await db.putSession({
    id: "crashed-short",
    bookId: "book-h",
    start: "2026-07-19T21:10:00.000Z",
    durationSec: 4,
    wordsRead: 12,
    avgWpm: 180,
    inProgress: true,
  });

  await tracker.recoverSessions();

  assert.equal((await db.getSessionsForBook("book-h")).length, 0);
});

test("deleting a book removes the sessions recorded for it", async () => {
  const book = await db.addBook({ title: "Tracked", text: "a b c", wordCount: 3 });

  await readWords(book.id, 300, { wpm: 300 });
  await tracker.endSession();
  assert.equal((await db.getSessionsForBook(book.id)).length, 1);

  await db.deleteBook(book.id);
  assert.equal((await db.getSessionsForBook(book.id)).length, 0);
});
