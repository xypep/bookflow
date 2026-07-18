import test from "node:test";
import assert from "node:assert/strict";

// A minimal localStorage so the module under test can run outside a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { getLanguages, setLanguages, languageString, AVAILABLE_LANGUAGES } = await import(
  "../src/scanner/languages.js"
);

const ALL = ["deu", "eng", "spa", "fra", "ita"];

test("defaults to every supported language", () => {
  store.clear();

  assert.deepEqual(getLanguages(), ALL);
  assert.equal(languageString(), ALL.join("+"));
});

test("a selection round-trips", () => {
  store.clear();
  setLanguages(["deu", "fra", "ita"]);

  assert.deepEqual(getLanguages(), ["deu", "fra", "ita"]);
});

test("clearing everything falls back to the default", () => {
  store.clear();
  setLanguages([]);

  assert.deepEqual(getLanguages(), ALL);
});

test("unknown codes are discarded", () => {
  store.clear();
  setLanguages(["deu", "klingon", "eng"]);

  assert.deepEqual(getLanguages(), ["deu", "eng"]);
});

test("a selection of only unknown codes falls back", () => {
  store.clear();
  setLanguages(["klingon"]);

  assert.deepEqual(getLanguages(), ALL);
});

test("corrupt storage falls back instead of throwing", () => {
  store.clear();
  store.set("book-flow-ocr-languages", "{not json");

  assert.deepEqual(getLanguages(), ALL);
});

test("a non-array value falls back", () => {
  store.clear();
  store.set("book-flow-ocr-languages", '"deu"');

  assert.deepEqual(getLanguages(), ALL);
});

test("the language string keeps a stable order regardless of input order", () => {
  store.clear();
  setLanguages(["ita", "deu", "fra"]);
  const first = languageString();

  setLanguages(["fra", "ita", "deu"]);

  assert.equal(languageString(), first);
  assert.equal(first, "deu+fra+ita");
});

test("every offered language has a code and a label", () => {
  for (const language of AVAILABLE_LANGUAGES) {
    assert.ok(language.code, "missing code");
    assert.ok(language.label, `missing label for ${language.code}`);
  }
  assert.deepEqual(
    AVAILABLE_LANGUAGES.map((language) => language.code),
    ["deu", "eng", "spa", "fra", "ita"]
  );
});
