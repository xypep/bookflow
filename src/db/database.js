import { generateId, tokenize } from "../utils.js";

const DB_NAME = "book-flow";
const DB_VERSION = 3;
const STORE_NAME = "books";
// Reading position lives in its own store: it changes several times per
// second, and IndexedDB can only replace whole records. Keeping it on the
// book record meant rewriting the entire book text on every word.
const PROGRESS_STORE = "progress";
// Raw reading sessions. Stats are derived from these on demand rather than
// aggregated here, so later views (per-day totals, streaks, WPM trend) can be
// added without another migration.
const SESSION_STORE = "sessions";

// The library is ordered by creation time, and books added in the same
// millisecond would otherwise have no defined order between them. Forcing the
// value to strictly increase keeps that ordering stable.
let lastCreatedAt = 0;

function nextCreatedAt() {
  lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
  return lastCreatedAt;
}

let dbPromise = null;

function getDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(PROGRESS_STORE)) {
          db.createObjectStore(PROGRESS_STORE, { keyPath: "id" });
        }
        // Each store is created only when missing, so a library arriving from
        // any earlier version keeps the books and positions it already has.
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
          sessions.createIndex("bookId", "bookId");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openStore(db, name, mode) {
  return db.transaction(name, mode).objectStore(name);
}

// Books written before the progress store existed still carry a `progress`
// field, so that value is used as a fallback for them.
function withProgress(book, progress) {
  return { ...book, progress: progress ?? book.progress ?? 0 };
}

export async function addBook({ title, text, wordCount }) {
  const db = await getDatabase();
  const book = {
    id: generateId(),
    title,
    text,
    wordCount,
    createdAt: nextCreatedAt(),
  };
  await promisifyRequest(openStore(db, STORE_NAME, "readwrite").add(book));
  return withProgress(book);
}

export async function getAllBooks() {
  const db = await getDatabase();
  const books = await promisifyRequest(openStore(db, STORE_NAME, "readonly").getAll());
  const records = await promisifyRequest(openStore(db, PROGRESS_STORE, "readonly").getAll());
  const progressById = new Map(records.map((record) => [record.id, record.progress]));

  return books
    .map((book) => withProgress(book, progressById.get(book.id)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBook(id) {
  const db = await getDatabase();
  const book = await promisifyRequest(openStore(db, STORE_NAME, "readonly").get(id));
  if (!book) return book;

  const record = await promisifyRequest(openStore(db, PROGRESS_STORE, "readonly").get(id));
  return withProgress(book, record?.progress);
}

export async function updateProgress(id, progress) {
  const db = await getDatabase();
  await promisifyRequest(openStore(db, PROGRESS_STORE, "readwrite").put({ id, progress }));
}

// Used by the importer when overwriting a book the user already has: the id
// stays, so its reading history keeps pointing at the same book.
export async function replaceBookContent(id, { title, text, wordCount }) {
  const db = await getDatabase();
  const store = openStore(db, STORE_NAME, "readwrite");
  const existing = await promisifyRequest(store.get(id));
  if (!existing) return null;

  const book = { ...existing, title, text, wordCount };
  await promisifyRequest(openStore(db, STORE_NAME, "readwrite").put(book));
  return book;
}

/**
 * Adds recognized pages to the end of a book. Scanning a whole book happens a
 * chunk at a time across several sittings, so text has to accumulate rather
 * than replace.
 */
export async function appendToBook(id, text) {
  const db = await getDatabase();
  const existing = await promisifyRequest(openStore(db, STORE_NAME, "readonly").get(id));
  if (!existing) return null;

  const combined = existing.text ? `${existing.text}\n\n${text}` : text;
  const book = { ...existing, text: combined, wordCount: tokenize(combined).length };
  await promisifyRequest(openStore(db, STORE_NAME, "readwrite").put(book));
  return book;
}

export async function deleteBook(id) {
  const db = await getDatabase();
  const transaction = db.transaction([STORE_NAME, PROGRESS_STORE, SESSION_STORE], "readwrite");
  const sessions = transaction.objectStore(SESSION_STORE).index("bookId");
  const sessionIds = await promisifyRequest(sessions.getAllKeys(id));

  await Promise.all([
    promisifyRequest(transaction.objectStore(STORE_NAME).delete(id)),
    promisifyRequest(transaction.objectStore(PROGRESS_STORE).delete(id)),
    // Orphaned sessions would otherwise be inherited by a book that reuses
    // the id, and would keep skewing any later stats.
    ...sessionIds.map((key) => promisifyRequest(transaction.objectStore(SESSION_STORE).delete(key))),
  ]);
}

export async function putSession(session) {
  const db = await getDatabase();
  await promisifyRequest(openStore(db, SESSION_STORE, "readwrite").put(session));
  return session;
}

export async function deleteSession(id) {
  const db = await getDatabase();
  await promisifyRequest(openStore(db, SESSION_STORE, "readwrite").delete(id));
}

export async function getAllSessions() {
  const db = await getDatabase();
  return promisifyRequest(openStore(db, SESSION_STORE, "readonly").getAll());
}

export async function getSessionsForBook(bookId) {
  const db = await getDatabase();
  const index = openStore(db, SESSION_STORE, "readonly").index("bookId");
  return promisifyRequest(index.getAll(bookId));
}

// Imported sessions merge by id: anything already stored wins, so re-importing
// the same file is a no-op and local history is never dropped. Returns how many
// were actually new.
export async function mergeSessions(sessions) {
  if (!sessions.length) return 0;

  const db = await getDatabase();
  const store = openStore(db, SESSION_STORE, "readwrite");
  const existing = new Set(await promisifyRequest(store.getAllKeys()));
  const fresh = sessions.filter((session) => !existing.has(session.id));

  const transaction = db.transaction(SESSION_STORE, "readwrite");
  await Promise.all(
    fresh.map((session) => promisifyRequest(transaction.objectStore(SESSION_STORE).put(session)))
  );
  return fresh.length;
}
