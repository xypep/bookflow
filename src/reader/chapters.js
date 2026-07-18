// Chapter markers in a book's text.
//
// Word indices are counted the same way the reader tokenizes, so a marker's
// index is directly the position to jump to.

// Named sections, German and English, as they appear on their own line.
const NAMED_SECTION =
  /^(prolog|epilog|prologue|epilogue|vorwort|nachwort|foreword|afterword|einleitung|introduction|widmung|dedication)$/i;

// "Kapitel 3", "Chapter IV", "3. Kapitel".
const NUMBERED_SECTION = /^(kapitel|chapter)\s+([0-9]{1,3}|[ivxlcdm]{1,7})\.?$/i;
const SECTION_SUFFIXED = /^([0-9]{1,3})\.\s*(kapitel|chapter)$/i;

// A line that is nothing but a small number, which is how many novels set
// their chapter headings.
const BARE_NUMBER = /^([0-9]{1,3})$/;

// Markers closer together than this are not chapters. Page numbers survive
// scanning often enough to matter, and they arrive every few hundred words;
// a real chapter runs far longer.
const MIN_WORDS_BETWEEN = 400;

// Headings are short. Anything longer is a sentence that happens to start
// with a number.
const MAX_HEADING_LENGTH = 40;

// Chapter numbers climb in small steps. A stray page number that clears the
// distance rule still breaks the run — 1, 2, 230, 3 — so a bare number has to
// follow its predecessor closely to be believed.
const MAX_CHAPTER_STEP = 3;

function countWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function headingOf(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return null;

  if (NAMED_SECTION.test(trimmed)) {
    return { title: trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase() };
  }

  const numbered = trimmed.match(NUMBERED_SECTION);
  if (numbered) return { title: trimmed.replace(/\.$/, "") };

  const suffixed = trimmed.match(SECTION_SUFFIXED);
  if (suffixed) return { title: trimmed };

  const bare = trimmed.match(BARE_NUMBER);
  if (bare) return { title: `Chapter ${bare[1]}`, number: Number(bare[1]) };

  return null;
}

/**
 * Finds chapter markers and where they start, as `{ title, index }` with
 * `index` being the word offset the reader can jump to.
 *
 * Detection is a guess about someone else's typography, so it is kept
 * conservative: a heading has to stand on its own line and be far enough past
 * the previous one to be plausible.
 */
export function findChapters(text) {
  if (!text) return [];

  const chapters = [];
  let wordIndex = 0;
  let lastNumber = null;

  for (const line of text.split("\n")) {
    const heading = headingOf(line);

    if (heading) {
      const previous = chapters[chapters.length - 1];
      const farEnough = !previous || wordIndex - previous.index >= MIN_WORDS_BETWEEN;

      // A bare number also has to continue the run, which is what keeps a
      // page number from posing as a chapter.
      const step = heading.number - lastNumber;
      const inSequence =
        heading.number === undefined ||
        lastNumber === null ||
        (step > 0 && step <= MAX_CHAPTER_STEP);

      if (farEnough && inSequence) {
        chapters.push({ title: heading.title, index: wordIndex });
        if (heading.number !== undefined) lastNumber = heading.number;
      }
    }

    wordIndex += countWords(line);
  }

  return chapters;
}

/** The last chapter starting at or before `index`, or null before the first. */
export function chapterAt(chapters, index) {
  let current = null;
  for (const chapter of chapters) {
    if (chapter.index > index) break;
    current = chapter;
  }
  return current;
}
