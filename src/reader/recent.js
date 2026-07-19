const STORAGE_KEY = "book-flow-last-opened";

// Which book was open last is not the same question as which book has a
// recorded session: sessions under 15 seconds are deliberately discarded, so
// deriving "continue reading" from them alone means opening a book, reading
// for a moment and finding the home screen still offering the previous one.
//
// This lives in localStorage rather than IndexedDB because it is a pointer to
// device state, not part of the library: it should not travel in an export.

export function setLastOpenedBookId(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing can refuse writes; continue-reading falls back to the
    // session history, which is a worse answer but not a broken one.
  }
}

export function getLastOpenedBookId() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
