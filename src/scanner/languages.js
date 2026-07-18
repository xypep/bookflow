// Which languages the recognizer is loaded with. Each extra one costs a
// download on first use and, more importantly, slows every later scan and can
// pull accuracy down for the others — so this is a choice rather than a
// "load everything" default.

const STORAGE_KEY = "book-flow-ocr-languages";

export const AVAILABLE_LANGUAGES = [
  { code: "deu", label: "German" },
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "ita", label: "Italian" },
];

const DEFAULT_LANGUAGES = ["deu", "eng"];

const isKnown = (code) => AVAILABLE_LANGUAGES.some((language) => language.code === code);

export function getLanguages() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGES;
  }

  if (!Array.isArray(stored)) return DEFAULT_LANGUAGES;

  const codes = stored.filter(isKnown);
  // An empty selection would leave the recognizer with no model at all.
  return codes.length ? codes : DEFAULT_LANGUAGES;
}

export function setLanguages(codes) {
  const selected = codes.filter(isKnown);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selected.length ? selected : DEFAULT_LANGUAGES));
}

// Tesseract takes its language set as a "+"-joined string. Ordering is kept
// stable so an unchanged selection never looks like a change to the worker.
export function languageString() {
  const selected = new Set(getLanguages());
  return AVAILABLE_LANGUAGES.filter(({ code }) => selected.has(code))
    .map(({ code }) => code)
    .join("+");
}
