const DB_NAME = "book-flow";
const DB_VERSION = 1;
const STORE_NAME = "books";

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
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
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

export async function addBook({ title, text, wordCount }) {
  const db = await getDatabase();
  const book = {
    id: generateId(),
    title,
    text,
    wordCount,
    progress: 0,
    createdAt: Date.now(),
  };
  const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  await promisifyRequest(store.add(book));
  return book;
}

export async function getAllBooks() {
  const db = await getDatabase();
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  const books = await promisifyRequest(store.getAll());
  return books.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBook(id) {
  const db = await getDatabase();
  const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
  return promisifyRequest(store.get(id));
}

export async function updateProgress(id, progress) {
  const db = await getDatabase();
  const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  const book = await promisifyRequest(store.get(id));
  if (!book) return;
  book.progress = progress;
  await promisifyRequest(store.put(book));
}

export async function deleteBook(id) {
  const db = await getDatabase();
  const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  await promisifyRequest(store.delete(id));
}
