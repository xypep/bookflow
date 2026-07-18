import test from "node:test";
import assert from "node:assert/strict";

import { extractText, dehyphenate } from "../src/scanner/extract.js";

const word = (text, confidence) => ({ text, confidence });
const line = (...words) => ({ words });
const page = (...lines) => [{ paragraphs: [{ lines }] }];

test("keeps confident body text", () => {
  const blocks = page(
    line(word("Anders", 94), word("als", 92), word("am", 91), word("Vortag", 93)),
    line(word("konnten", 95), word("sie", 90), word("sich", 96))
  );

  assert.equal(extractText(blocks), "Anders als am Vortag\nkonnten sie sich");
});

// Modelled on a real scan: a clean line of text with the page edge misread as
// stray capitals trailing off the right margin.
test("drops margin noise trailing a line", () => {
  const blocks = page(
    line(word("wiesen.", 91), word("Sie", 93), word("mussten", 94), word("&.", 22), word("N", 18), word("2", 31)),
    line(word("Die", 92), word("Szenen,", 90), word("X", 14))
  );

  assert.equal(extractText(blocks), "wiesen. Sie mussten\nDie Szenen,");
});

test("drops a line that is nothing but noise", () => {
  const blocks = page(
    line(word("vorbehalten", 93), word("war.", 90)),
    line(word("SS", 19), word("DZ", 24), word("NG", 17))
  );

  assert.equal(extractText(blocks), "vorbehalten war.");
});

test("keeps short words that score well", () => {
  const blocks = page(line(word("er", 93), word("ist", 95), word("in", 91), word("SS", 40)));

  assert.equal(extractText(blocks), "er ist in");
});

test("holds short tokens to a stricter bar than long ones", () => {
  // Both sit above the general threshold; only the long one is trustworthy at
  // that score, because short noise fragments routinely reach it.
  const blocks = page(line(word("Campingplätzen", 65), word("Ds", 65)));

  assert.equal(extractText(blocks), "Campingplätzen");
});

test("separates paragraphs but keeps lines inside them", () => {
  const blocks = [
    { paragraphs: [{ lines: [line(word("Erster", 90), word("Absatz", 91))] }] },
    { paragraphs: [{ lines: [line(word("Zweiter", 92))] }] },
  ];

  assert.equal(extractText(blocks), "Erster Absatz\n\nZweiter");
});

test("survives missing or empty structures", () => {
  assert.equal(extractText(undefined), "");
  assert.equal(extractText([]), "");
  assert.equal(extractText([{ paragraphs: [{ lines: [line()] }] }]), "");
  assert.equal(extractText([{}]), "");
});

test("thresholds are configurable", () => {
  const blocks = page(line(word("grenzwertig", 55)));

  assert.equal(extractText(blocks), "");
  assert.equal(extractText(blocks, { minWordConfidence: 50 }), "grenzwertig");
});

test("rejoins a word split across a line break", () => {
  assert.equal(dehyphenate("Kaum waren sie damit fer-\ntig, machten sie"), "Kaum waren sie damit fertig, machten sie");
});

test("rejoins across leftover spacing at the break", () => {
  // Margin noise sat here before filtering and can leave trailing blanks.
  assert.equal(dehyphenate("zuge-  \n  wiesen"), "zugewiesen");
});

test("leaves a genuine hyphenated compound alone", () => {
  assert.equal(dehyphenate("Nord-Süd-Achse"), "Nord-Süd-Achse");
});

test("leaves a hyphen at a paragraph break alone", () => {
  assert.equal(dehyphenate("Gedankenstrich -\n\nNeuer Absatz"), "Gedankenstrich -\n\nNeuer Absatz");
});
