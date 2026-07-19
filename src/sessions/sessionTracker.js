import { putSession, deleteSession, getAllSessions } from "../db/database.js";
import { generateId } from "../utils.js";

// Anything shorter than this is an accidental tap rather than reading.
const MIN_SESSION_SEC = 15;
// A pause this long means the reader walked away; whatever comes after is a
// new session.
const PAUSE_TIMEOUT_MS = 2 * 60 * 1000;
// How often the in-progress marker is written while playback runs. An app
// killed by iOS loses at most this much of the current session.
const MARKER_INTERVAL_MS = 30 * 1000;

// { id, bookId, start, activeMs, wordsRead, runningSince }
let current = null;
let pauseTimer = null;
let markerTimer = null;

// Injectable so tests don't have to wait in real time.
let now = () => Date.now();

export function setClock(clock) {
  now = clock;
}

function activeMs(session) {
  return session.activeMs + (session.runningSince === null ? 0 : now() - session.runningSince);
}

function toRecord(session) {
  const ms = activeMs(session);
  const minutes = ms / 60000;
  return {
    id: session.id,
    bookId: session.bookId,
    start: session.start,
    durationSec: Math.round(ms / 1000),
    wordsRead: session.wordsRead,
    avgWpm: minutes > 0 ? Math.round(session.wordsRead / minutes) : 0,
  };
}

function clearTimers() {
  clearTimeout(pauseTimer);
  clearInterval(markerTimer);
  pauseTimer = null;
  markerTimer = null;
}

// The marker is the same record the session will eventually be stored as, just
// flagged as unfinished. Recovery can then finalize it without knowing
// anything about how it was being tracked.
function writeMarker() {
  if (!current) return Promise.resolve();
  return putSession({ ...toRecord(current), inProgress: true });
}

/**
 * Called when RSVP playback starts. Resumes the running session if it is for
 * the same book and the pause was short enough, otherwise starts a fresh one.
 */
export async function startSession(bookId) {
  if (current && current.bookId !== bookId) {
    await endSession();
  }

  if (current) {
    // Resuming: only the pause timer needs standing down, the accumulated
    // active time carries over.
    clearTimers();
    if (current.runningSince === null) current.runningSince = now();
  } else {
    current = {
      id: generateId(),
      bookId,
      start: new Date(now()).toISOString(),
      activeMs: 0,
      wordsRead: 0,
      runningSince: now(),
    };
  }

  markerTimer = setInterval(writeMarker, MARKER_INTERVAL_MS);
  await writeMarker();
}

/** Called for every word the player advances past. */
export function countWord() {
  if (current && current.runningSince !== null) current.wordsRead += 1;
}

/**
 * Called when playback pauses. Active time stops accumulating; the session
 * itself stays open until the pause outlives PAUSE_TIMEOUT_MS.
 */
export async function pauseSession() {
  if (!current || current.runningSince === null) return;

  current.activeMs = activeMs(current);
  current.runningSince = null;
  clearTimers();

  pauseTimer = setTimeout(() => {
    endSession();
  }, PAUSE_TIMEOUT_MS);

  await writeMarker();
}

/**
 * Closes the running session for good — leaving the reader, switching books,
 * backgrounding the app, or a pause that ran past the timeout.
 */
export async function endSession() {
  if (!current) return null;

  const session = current;
  current = null;
  clearTimers();

  const record = toRecord(session);
  if (record.durationSec < MIN_SESSION_SEC) {
    // The marker may already be on disk from a 30s write, so discarding means
    // an actual delete rather than just not writing.
    await deleteSession(record.id);
    return null;
  }

  await putSession(record);
  return record;
}

/**
 * Turns markers left behind by a killed app into finished sessions. Runs once
 * at startup, before anything can open a new session.
 */
export async function recoverSessions() {
  const stale = (await getAllSessions()).filter((session) => session.inProgress);

  for (const session of stale) {
    const { inProgress, ...record } = session;
    if (record.durationSec < MIN_SESSION_SEC) {
      await deleteSession(record.id);
    } else {
      await putSession(record);
    }
  }

  return stale.length;
}

export function initSessionTracker() {
  // Safari fires visibilitychange when the app is backgrounded or the tab is
  // hidden; pagehide covers the tab actually going away.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") endSession();
  });
  document.addEventListener("pagehide", () => {
    endSession();
  });

  return recoverSessions();
}
