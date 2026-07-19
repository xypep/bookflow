import "fake-indexeddb/auto";

import test from "node:test";
import assert from "node:assert/strict";

const LEGACY_ID = "legacy-book";
const LEGACY_TEXT = "one two three four five";

// Recreate a database exactly as version 1 shipped it: a single "books" store
// where the reading position lives on the book record itself. Version 2 moved
// it into its own store, and existing libraries have to survive that.
function seedVersionOne() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("book-flow", 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore("books", { keyPath: "id" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("books", "readwrite");

      transaction.objectStore("books").add({
        id: LEGACY_ID,
        title: "Legacy Book",
        text: LEGACY_TEXT,
        wordCount: 5,
        progress: 3,
        createdAt: 1000,
      });

      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

// Seeding has to finish before the module under test opens the database,
// otherwise it would create version 2 from scratch and never exercise the
// upgrade path.
await seedVersionOne();
const db = await import("../src/db/database.js");

test("a book stored before the upgrade keeps its reading position", async () => {
  const book = await db.getBook(LEGACY_ID);

  assert.equal(book.title, "Legacy Book");
  assert.equal(book.progress, 3);
});

test("a new position overrides the value left on an old record", async () => {
  await db.updateProgress(LEGACY_ID, 4);

  assert.equal((await db.getBook(LEGACY_ID)).progress, 4);
});

test("progress updates leave the book text untouched", async () => {
  await db.updateProgress(LEGACY_ID, 5);

  assert.equal((await db.getBook(LEGACY_ID)).text, LEGACY_TEXT);
});

test("a freshly added book starts at position zero", async () => {
  const book = await db.addBook({ title: "Fresh", text: "a b c", wordCount: 3 });

  assert.equal(book.progress, 0);
  assert.equal((await db.getBook(book.id)).progress, 0);
});

test("progress round-trips for a new book", async () => {
  const book = await db.addBook({ title: "Round Trip", text: "a b c", wordCount: 3 });
  await db.updateProgress(book.id, 2);

  assert.equal((await db.getBook(book.id)).progress, 2);
});

test("the library lists newest first and carries each position", async () => {
  const book = await db.addBook({ title: "Newest", text: "a b", wordCount: 2 });
  await db.updateProgress(book.id, 1);

  const books = await db.getAllBooks();

  assert.equal(books[0].title, "Newest");
  assert.equal(books[0].progress, 1);
  assert.equal(books.at(-1).title, "Legacy Book");
});

test("books added within the same millisecond keep their order", async () => {
  const titles = ["First", "Second", "Third", "Fourth"];
  for (const title of titles) {
    await db.addBook({ title, text: "a b", wordCount: 2 });
  }

  const listed = (await db.getAllBooks())
    .map((book) => book.title)
    .filter((title) => titles.includes(title));

  assert.deepEqual(listed, [...titles].reverse());
});

test("deleting a book removes it from the library", async () => {
  const book = await db.addBook({ title: "Doomed", text: "a b", wordCount: 2 });
  await db.deleteBook(book.id);

  assert.equal(await db.getBook(book.id), undefined);
});

test("deleting a book discards its stored position", async () => {
  const book = await db.addBook({ title: "Recycled", text: "a b c d", wordCount: 4 });
  const { id } = book;

  await db.updateProgress(id, 3);
  await db.deleteBook(id);

  // A leftover progress record would be inherited by anything reusing the id.
  const revived = await db.addBook({ title: "Revived", text: "a b c d", wordCount: 4 });
  await db.updateProgress(revived.id, 0);

  assert.equal((await db.getBook(revived.id)).progress, 0);
});

test("getBook returns undefined for an unknown id", async () => {
  assert.equal(await db.getBook("does-not-exist"), undefined);
});

test("appending pages extends a book instead of replacing it", async () => {
  const book = await db.addBook({ title: "Growing", text: "chapter one", wordCount: 2 });

  await db.appendToBook(book.id, "chapter two");
  await db.appendToBook(book.id, "chapter three");

  const stored = await db.getBook(book.id);
  assert.equal(stored.text, "chapter one\n\nchapter two\n\nchapter three");
  assert.equal(stored.wordCount, 6);
});

test("appending leaves the reading position where it was", async () => {
  // Scanning the rest of a book must not move the reader back to the start.
  const book = await db.addBook({ title: "Resumed", text: "a b c", wordCount: 3 });
  await db.updateProgress(book.id, 2);

  await db.appendToBook(book.id, "d e f");

  assert.equal((await db.getBook(book.id)).progress, 2);
});

test("appending to an empty book does not lead with a blank line", async () => {
  const book = await db.addBook({ title: "Empty", text: "", wordCount: 0 });

  await db.appendToBook(book.id, "first page");

  assert.equal((await db.getBook(book.id)).text, "first page");
});

test("each appended chunk survives on its own", async () => {
  // The point of flushing part-way through a long scan: an interrupted run
  // keeps whatever was already banked.
  const book = await db.addBook({ title: "Interrupted", text: "start", wordCount: 1 });

  for (const chunk of ["pages 1-10", "pages 11-20", "pages 21-30"]) {
    await db.appendToBook(book.id, chunk);
  }

  const stored = await db.getBook(book.id);
  assert.match(stored.text, /start.*pages 1-10.*pages 11-20.*pages 21-30/s);
  // "start" plus two words per chunk.
  assert.equal(stored.wordCount, 7);
});

test("appending to a book that is gone reports rather than throws", async () => {
  assert.equal(await db.appendToBook("no-such-book", "text"), null);
});
