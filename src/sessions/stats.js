// Everything the app shows about reading is derived from the raw sessions on
// demand — nothing is aggregated in the database. These are pure functions so
// the arithmetic can be tested without a browser or a clock.

// Sessions store their start as UTC, but a reading day is a local day: a
// session at 23:30 belongs to that evening, not to the next morning in UTC.
export function dayKey(date) {
  const local = date instanceof Date ? date : new Date(date);
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${local.getFullYear()}-${month}-${day}`;
}

function finished(sessions) {
  // A session still being written is not part of any total yet.
  return sessions.filter((session) => !session.inProgress);
}

export function secondsOnDay(sessions, date = new Date()) {
  const key = dayKey(date);
  return finished(sessions)
    .filter((session) => dayKey(session.start) === key)
    .reduce((total, session) => total + session.durationSec, 0);
}

export function wordsOnDay(sessions, date = new Date()) {
  const key = dayKey(date);
  return finished(sessions)
    .filter((session) => dayKey(session.start) === key)
    .reduce((total, session) => total + session.wordsRead, 0);
}

/**
 * Consecutive days with at least one session, counting back from today. A day
 * with no reading yet doesn't break the streak — the day isn't over — so the
 * count starts at yesterday when today is still empty.
 */
export function streakDays(sessions, date = new Date()) {
  const days = new Set(finished(sessions).map((session) => dayKey(session.start)));
  if (!days.size) return 0;

  const cursor = new Date(date);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Words per minute across every session, weighted by how long each ran. */
export function overallWpm(sessions) {
  const done = finished(sessions);
  const seconds = done.reduce((total, session) => total + session.durationSec, 0);
  if (!seconds) return 0;

  const words = done.reduce((total, session) => total + session.wordsRead, 0);
  return Math.round(words / (seconds / 60));
}

/** The book of the most recently started session, or null if none exist. */
export function lastReadBookId(sessions) {
  const done = finished(sessions);
  if (!done.length) return null;

  return done.reduce((latest, session) => (session.start > latest.start ? session : latest)).bookId;
}

export function totalSeconds(sessions) {
  return finished(sessions).reduce((total, session) => total + session.durationSec, 0);
}

/**
 * One entry per day for the last `days` days, oldest first, including days
 * with nothing read — a gap in the chart has to be visible as a gap.
 */
export function dailyTotals(sessions, days = 7, date = new Date()) {
  const byDay = new Map();
  for (const session of finished(sessions)) {
    const key = dayKey(session.start);
    byDay.set(key, (byDay.get(key) ?? 0) + session.durationSec);
  }

  const out = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(date);
    day.setDate(day.getDate() - back);
    const key = dayKey(day);
    out.push({ key, date: day, seconds: byDay.get(key) ?? 0, isToday: back === 0 });
  }
  return out;
}

/**
 * Reading time per book, largest first. Books deleted since are dropped
 * rather than shown as an unnamed slice.
 */
export function secondsByBook(sessions, books) {
  const titles = new Map(books.map((book) => [book.id, book.title]));
  const byBook = new Map();

  for (const session of finished(sessions)) {
    if (!titles.has(session.bookId)) continue;
    byBook.set(session.bookId, (byBook.get(session.bookId) ?? 0) + session.durationSec);
  }

  return [...byBook.entries()]
    .map(([bookId, seconds]) => ({ bookId, title: titles.get(bookId), seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

/**
 * Caps the number of coloured slices and folds the tail into one "Other"
 * entry. Generating more hues past the palette would produce colours nobody
 * with colour blindness could tell apart.
 */
export function capSlices(entries, limit = 5) {
  if (entries.length <= limit) return entries;

  const head = entries.slice(0, limit - 1);
  const tail = entries.slice(limit - 1);
  return [
    ...head,
    {
      bookId: "__other__",
      title: `${tail.length} more books`,
      seconds: tail.reduce((total, entry) => total + entry.seconds, 0),
    },
  ];
}

export function isFinishedBook(book) {
  const total = book.wordCount || 0;
  return total > 1 && book.progress >= total - 1;
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * What to offer on the home screen, most trustworthy signal first:
 *
 * 1. the book last opened in the reader — the direct answer, and the only one
 *    that survives a visit too short to be recorded as a session;
 * 2. the book of the most recent session — covers a library restored from an
 *    export onto a device that has never opened the reader;
 * 3. a book already started, then the newest one, for a library with no
 *    reading history at all.
 */
export function bookToContinue(books, sessions, lastOpenedId = null) {
  if (!books.length) return null;

  const lastOpened = books.find((book) => book.id === lastOpenedId);
  if (lastOpened) return lastOpened;

  const lastId = lastReadBookId(sessions);
  const lastRead = books.find((book) => book.id === lastId);
  if (lastRead) return lastRead;

  // getAllBooks() returns newest first, so the first match is the newest.
  return books.find((book) => (book.progress || 0) > 0) ?? books[0];
}
