const DB_NAME = "book-flow";
const DB_VERSION = 2;
const STORE_NAME = "books";
// Reading position lives in its own store: it changes several times per
// second, and IndexedDB can only replace whole records. Keeping it on the
// book record meant rewriting the entire book text on every word.
const PROGRESS_STORE = "progress";

// crypto.randomUUID() only works in secure contexts (https or localhost), but
// the app is also used over plain http on the local network (phone testing),
// so we need an id generator that works everywhere.
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    createdAt: Date.now(),
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

export async function deleteBook(id) {
  const db = await getDatabase();
  const transaction = db.transaction([STORE_NAME, PROGRESS_STORE], "readwrite");
  await Promise.all([
    promisifyRequest(transaction.objectStore(STORE_NAME).delete(id)),
    promisifyRequest(transaction.objectStore(PROGRESS_STORE).delete(id)),
  ]);
}
