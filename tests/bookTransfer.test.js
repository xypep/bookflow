import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";

const transfer = await import("../src/transfer/bookTransfer.js");
const db = await import("../src/db/database.js");

function bookFile(overrides = {}) {
  return {
    format: "bookflow-book",
    version: 1,
    exportedAt: "2026-07-19T14:30:00.000Z",
    book: {
      title: "Moby Dick",
      text: "call me ishmael some years ago",
      readingPosition: 3,
      settings: { wpm: 350, theme: "sepia" },
      ...overrides.book,
    },
    sessions: overrides.sessions ?? [],
    ...overrides.envelope,
  };
}

function session(id, bookId = "whatever") {
  return {
    id,
    bookId,
    start: "2026-07-19T21:10:00.000Z",
    durationSec: 840,
    wordsRead: 4900,
    avgWpm: 350,
  };
}

/* Validation */

test("a well-formed export parses into one entry", () => {
  const [entry] = transfer.parseImportFile(JSON.stringify(bookFile()));

  assert.equal(entry.title, "Moby Dick");
  assert.equal(entry.wordCount, 6);
  assert.equal(entry.readingPosition, 3);
});

test("corrupt JSON is rejected with a readable message", () => {
  assert.throws(() => transfer.parseImportFile("{not json"), {
    name: "Error",
    message: "That file isn't valid JSON.",
  });
});

test("foreign JSON is rejected", () => {
  assert.throws(() => transfer.parseImportFile('{"hello":"world"}'), transfer.ImportError);
});

test("an unknown format is rejected by name", () => {
  const file = JSON.stringify(bookFile({ envelope: { format: "kindle-export" } }));

  assert.throws(() => transfer.parseImportFile(file), /kindle-export/);
});

test("a newer format version is rejected rather than guessed at", () => {
  const file = JSON.stringify(bookFile({ envelope: { version: 2 } }));

  assert.throws(() => transfer.parseImportFile(file), /version 2/);
});

test("a book without text is rejected", () => {
  const file = JSON.stringify(bookFile({ book: { text: "" } }));

  assert.throws(() => transfer.parseImportFile(file), transfer.ImportError);
});

test("a reading position past the end of the text is pulled back", () => {
  const file = JSON.stringify(bookFile({ book: { readingPosition: 9999 } }));
  const [entry] = transfer.parseImportFile(file);

  assert.equal(entry.readingPosition, 5);
});

test("malformed sessions are dropped without failing the import", () => {
  const file = JSON.stringify(
    bookFile({ sessions: [session("good"), { id: "bad" }, null] })
  );
  const [entry] = transfer.parseImportFile(file);

  assert.equal(entry.sessions.length, 1);
  assert.equal(entry.sessions[0].id, "good");
});

test("a collection parses into one entry per book", () => {
  const file = JSON.stringify({
    format: "bookflow-collection",
    version: 1,
    exportedAt: "2026-07-19T14:30:00.000Z",
    books: [bookFile(), bookFile({ book: { title: "Second" } })],
  });

  assert.deepEqual(
    transfer.parseImportFile(file).map((entry) => entry.title),
    ["Moby Dick", "Second"]
  );
});

/* Conflicts */

test("a conflict is found regardless of case and padding", () => {
  const local = [{ id: "x", title: "Moby Dick" }];
  const entry = { title: "  moby dick " };

  assert.equal(transfer.findConflict(entry, local)?.id, "x");
  assert.equal(transfer.findConflict({ title: "Other" }, local), null);
});

/* Writing */

test("importing a new book stores its text, position and sessions", async () => {
  const [entry] = transfer.parseImportFile(
    JSON.stringify(bookFile({ book: { title: "Fresh Import" }, sessions: [session("s1")] }))
  );
  const result = await transfer.importEntry(entry, { mode: "create" });

  const stored = await db.getBook(result.bookId);
  assert.equal(stored.title, "Fresh Import");
  assert.equal(stored.progress, 3);

  const [imported] = await db.getSessionsForBook(result.bookId);
  assert.equal(imported.id, "s1");
  assert.equal(imported.bookId, result.bookId);
});

test("re-importing the same file does not duplicate sessions", async () => {
  const [entry] = transfer.parseImportFile(
    JSON.stringify(bookFile({ book: { title: "Idempotent" }, sessions: [session("dup-1")] }))
  );
  const first = await transfer.importEntry(entry, { mode: "create" });
  const again = await transfer.importEntry(entry, {
    mode: "overwrite",
    existing: { id: first.bookId },
  });

  assert.equal(again.sessionsAdded, 0);
  assert.equal((await db.getSessionsForBook(first.bookId)).length, 1);
});

test("overwriting keeps the local sessions and adds the imported ones", async () => {
  const local = await db.addBook({ title: "Overwrite Me", text: "a b", wordCount: 2 });
  await db.putSession(session("local-only", local.id));

  const [entry] = transfer.parseImportFile(
    JSON.stringify(bookFile({ book: { title: "Overwrite Me" }, sessions: [session("from-file")] }))
  );
  await transfer.importEntry(entry, { mode: "overwrite", existing: local });

  const stored = await db.getBook(local.id);
  assert.equal(stored.text, "call me ishmael some years ago");
  assert.equal(stored.progress, 3);

  const ids = (await db.getSessionsForBook(local.id)).map((entry) => entry.id).sort();
  assert.deepEqual(ids, ["from-file", "local-only"]);
});

test("keeping both leaves the local book untouched under a free title", async () => {
  const local = await db.addBook({ title: "Twin", text: "a b", wordCount: 2 });
  await db.updateProgress(local.id, 1);

  const [entry] = transfer.parseImportFile(
    JSON.stringify(bookFile({ book: { title: "Twin" }, sessions: [session("twin-session")] }))
  );
  const localBooks = await db.getAllBooks();
  const result = await transfer.importEntry(entry, {
    mode: "keep-both",
    existing: local,
    localBooks,
  });

  assert.equal(result.title, "Twin (imported)");
  assert.notEqual(result.bookId, local.id);

  const original = await db.getBook(local.id);
  assert.equal(original.text, "a b");
  assert.equal(original.progress, 1);

  // A separate copy needs session ids of its own, or merging by id would drop
  // them against the sessions of the book it was copied from.
  const [copied] = await db.getSessionsForBook(result.bookId);
  assert.notEqual(copied.id, "twin-session");
  assert.equal(copied.wordsRead, 4900);
});

test("a second keep-both copy gets a numbered title", async () => {
  await db.addBook({ title: "Triplet", text: "a b", wordCount: 2 });
  const [entry] = transfer.parseImportFile(
    JSON.stringify(bookFile({ book: { title: "Triplet" } }))
  );

  const first = await transfer.importEntry(entry, {
    mode: "keep-both",
    existing: {},
    localBooks: await db.getAllBooks(),
  });
  const second = await transfer.importEntry(entry, {
    mode: "keep-both",
    existing: {},
    localBooks: await db.getAllBooks(),
  });

  assert.equal(first.title, "Triplet (imported)");
  assert.equal(second.title, "Triplet (imported 2)");
});

/* Round trip */

test("an exported book imports back with the same text, position and sessions", async () => {
  const book = await db.addBook({
    title: "Round Trip",
    text: "one two three four five",
    wordCount: 5,
  });
  await db.updateProgress(book.id, 4);
  await db.putSession(session("rt-1", book.id));

  const file = await transfer.exportBook(await db.getBook(book.id));
  assert.equal(file.format, "bookflow-book");
  assert.equal(file.version, 1);

  const [entry] = transfer.parseImportFile(JSON.stringify(file));
  await db.deleteBook(book.id);
  const restored = await transfer.importEntry(entry, { mode: "create" });

  const stored = await db.getBook(restored.bookId);
  assert.equal(stored.text, "one two three four five");
  assert.equal(stored.progress, 4);
  assert.equal((await db.getSessionsForBook(restored.bookId))[0].id, "rt-1");
});

test("an unfinished session is left out of the export", async () => {
  const book = await db.addBook({ title: "Mid Session", text: "a b c", wordCount: 3 });
  await db.putSession(session("done", book.id));
  await db.putSession({ ...session("running", book.id), inProgress: true });

  const file = await transfer.exportBook(await db.getBook(book.id));

  assert.deepEqual(file.sessions.map((entry) => entry.id), ["done"]);
});

test("the export file name is safe for the iOS share sheet", () => {
  assert.equal(transfer.exportFileName("Notes: 03/2026"), "Notes- 03-2026.bookflow.json");
  assert.equal(transfer.exportFileName("   "), "book.bookflow.json");
});
