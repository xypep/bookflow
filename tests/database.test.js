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
