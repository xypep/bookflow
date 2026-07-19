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

/**
 * What to offer on the home screen. Prefers the book last actually read;
 * falls back to one already started, then to the newest book — a fresh
 * install has no sessions but may well have books.
 */
export function bookToContinue(books, sessions) {
  if (!books.length) return null;

  const lastId = lastReadBookId(sessions);
  const lastRead = books.find((book) => book.id === lastId);
  if (lastRead) return lastRead;

  // getAllBooks() returns newest first, so the first match is the newest.
  return books.find((book) => (book.progress || 0) > 0) ?? books[0];
}
