import {
  addBook,
  replaceBookContent,
  updateProgress,
  getSessionsForBook,
  mergeSessions,
} from "../db/database.js";
import { tokenize, generateId } from "../utils.js";

export const BOOK_FORMAT = "bookflow-book";
export const COLLECTION_FORMAT = "bookflow-collection";
// Bumped only when the shape changes in a way older readers can't handle.
// The importer rejects anything it doesn't know rather than guessing.
export const FORMAT_VERSION = 1;

/* -------------------------------------------------------------------------
 * Export
 * ---------------------------------------------------------------------- */

// WPM and theme are global preferences rather than per-book ones. They travel
// with the file so a future version could restore them, but importing never
// applies them — a single book should not reconfigure the whole app.
function currentSettings() {
  const store = globalThis.localStorage;
  return {
    wpm: Number(store?.getItem("book-flow-wpm")) || 300,
    theme: store?.getItem("book-flow-theme") || "light",
  };
}

async function bookPayload(book) {
  const sessions = await getSessionsForBook(book.id);
  return {
    book: {
      title: book.title,
      text: book.text,
      readingPosition: book.progress || 0,
      settings: currentSettings(),
    },
    // The in-progress marker of a session still running is deliberately left
    // out: it isn't a finished session yet.
    sessions: sessions.filter((session) => !session.inProgress),
  };
}

export async function exportBook(book) {
  const { book: payload, sessions } = await bookPayload(book);
  return {
    format: BOOK_FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    book: payload,
    sessions,
  };
}

export async function exportCollection(books) {
  return {
    format: COLLECTION_FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    books: await Promise.all(books.map(bookPayload)),
  };
}

// iOS has no writable filesystem to download into, so a filename with a slash
// or a colon in it can break the share sheet.
export function exportFileName(title) {
  const safe = String(title)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${safe || "book"}.bookflow.json`;
}

/**
 * Hands the file to the OS. On iOS that means the native share sheet, where
 * "Save to Files" puts it in iCloud Drive; everywhere else it falls back to a
 * plain download.
 *
 * Returns "shared", "downloaded" or "cancelled".
 */
export async function saveExport(data, fileName) {
  const json = JSON.stringify(data, null, 2);
  const file = new File([json], fileName, { type: "application/json" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // Safari refuses to share from a context it considers untrusted; the
      // download path still works there.
      console.error(error);
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoking straight away can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}

/* -------------------------------------------------------------------------
 * Import — validation
 * ---------------------------------------------------------------------- */

export class ImportError extends Error {}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEntry(raw, label) {
  if (!isPlainObject(raw) || !isPlainObject(raw.book)) {
    throw new ImportError(`${label} is missing its book data.`);
  }

  const { title, text, readingPosition } = raw.book;
  if (typeof title !== "string" || !title.trim()) {
    throw new ImportError(`${label} has no title.`);
  }
  if (typeof text !== "string" || !text.trim()) {
    throw new ImportError(`${label} has no text.`);
  }

  const wordCount = tokenize(text).length;
  const position = Number.isFinite(readingPosition) ? Math.floor(readingPosition) : 0;

  if (raw.sessions !== undefined && !Array.isArray(raw.sessions)) {
    throw new ImportError(`${label} has a broken session list.`);
  }

  return {
    title: title.trim(),
    text,
    wordCount,
    // A position past the end would leave the reader stuck on a word that
    // isn't there — most likely the text was edited before re-export.
    readingPosition: Math.min(Math.max(position, 0), Math.max(wordCount - 1, 0)),
    sessions: readSessions(raw.sessions ?? []),
  };
}

// Individual malformed sessions are dropped rather than failing the import:
// losing a statistics record is not worth losing the book over.
function readSessions(raw) {
  return raw.filter(
    (session) =>
      isPlainObject(session) &&
      typeof session.id === "string" &&
      typeof session.start === "string" &&
      Number.isFinite(session.durationSec) &&
      Number.isFinite(session.wordsRead)
  );
}

/**
 * Turns file text into validated entries, or throws an ImportError carrying a
 * message meant to be shown inline.
 */
export function parseImportFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("That file isn't valid JSON.");
  }

  if (!isPlainObject(data) || typeof data.format !== "string") {
    throw new ImportError("That doesn't look like a Book Flow export.");
  }
  if (data.format !== BOOK_FORMAT && data.format !== COLLECTION_FORMAT) {
    throw new ImportError(`Unknown file format "${data.format}".`);
  }
  if (data.version !== FORMAT_VERSION) {
    throw new ImportError(
      `This file uses format version ${data.version}, but this app only reads version ${FORMAT_VERSION}.`
    );
  }

  if (data.format === BOOK_FORMAT) {
    return [readEntry(data, "This export")];
  }

  if (!Array.isArray(data.books) || !data.books.length) {
    throw new ImportError("This collection contains no books.");
  }
  return data.books.map((entry, index) => readEntry(entry, `Book ${index + 1}`));
}

/* -------------------------------------------------------------------------
 * Import — writing
 * ---------------------------------------------------------------------- */

function normalizeTitle(title) {
  return title.trim().toLowerCase();
}

/** Finds the local book an entry would collide with, if any. */
export function findConflict(entry, localBooks) {
  const key = normalizeTitle(entry.title);
  return localBooks.find((book) => normalizeTitle(book.title) === key) ?? null;
}

function uniqueTitle(title, localBooks) {
  const taken = new Set(localBooks.map((book) => normalizeTitle(book.title)));
  let candidate = `${title} (imported)`;
  let counter = 2;
  while (taken.has(normalizeTitle(candidate))) {
    candidate = `${title} (imported ${counter})`;
    counter += 1;
  }
  return candidate;
}

async function attachSessions(sessions, bookId, { freshIds }) {
  const owned = sessions.map(({ inProgress, ...session }) => ({
    ...session,
    // Ids from the file are kept so re-importing the same export doesn't
    // duplicate history. A "keep both" copy is a different book, though, so
    // its sessions need ids of their own.
    id: freshIds ? generateId() : session.id,
    bookId,
  }));
  return mergeSessions(owned);
}

/**
 * Writes one validated entry.
 *
 * mode: "create" (no conflict), "overwrite" (replace the local book, keeping
 * its sessions), or "keep-both" (add a second copy under a free title).
 */
export async function importEntry(entry, { mode, existing = null, localBooks = [] } = {}) {
  if (mode === "overwrite") {
    if (!existing) throw new ImportError("The book to overwrite no longer exists.");
    await replaceBookContent(existing.id, entry);
    await updateProgress(existing.id, entry.readingPosition);
    const added = await attachSessions(entry.sessions, existing.id, { freshIds: false });
    return { title: entry.title, bookId: existing.id, sessionsAdded: added };
  }

  const title = mode === "keep-both" ? uniqueTitle(entry.title, localBooks) : entry.title;
  const book = await addBook({ title, text: entry.text, wordCount: entry.wordCount });
  await updateProgress(book.id, entry.readingPosition);
  const added = await attachSessions(entry.sessions, book.id, {
    freshIds: mode === "keep-both",
  });
  return { title, bookId: book.id, sessionsAdded: added };
}
