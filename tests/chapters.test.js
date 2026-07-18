import test from "node:test";
import assert from "node:assert/strict";

import { findChapters, chapterAt } from "../src/reader/chapters.js";

// Body text long enough to clear the minimum gap between chapters.
const filler = (words) => Array.from({ length: words }, (_, i) => `wort${i}`).join(" ");

test("finds a bare number used as a chapter heading", () => {
  const text = ["33", filler(500), "34", filler(500)].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Chapter 33", "Chapter 34"]
  );
});

test("reports the word offset a chapter starts at", () => {
  const text = ["33", filler(500), "34"].join("\n");
  const chapters = findChapters(text);

  assert.equal(chapters[0].index, 0);
  // The heading itself is one word, then 500 of body text.
  assert.equal(chapters[1].index, 501);
});

test("finds named sections", () => {
  const text = ["Prolog", filler(500), "Epilog"].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Prolog", "Epilog"]
  );
});

test("named sections are matched regardless of case", () => {
  const text = ["PROLOG", filler(500), "epilogue"].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Prolog", "Epilogue"]
  );
});

test("finds spelled-out chapter headings", () => {
  const text = ["Kapitel 1", filler(500), "Chapter IV", filler(500), "3. Kapitel"].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Kapitel 1", "Chapter IV", "3. Kapitel"]
  );
});

test("markers packed close together are not chapters", () => {
  // Page numbers surviving a scan look exactly like this.
  const text = ["230", filler(20), "231", filler(20), "232"].join("\n");

  assert.equal(findChapters(text).length, 1);
});

test("a stray page number does not break into the chapter run", () => {
  // 230 clears the distance rule but not the sequence, so it is rejected
  // while the real chapters either side of it survive.
  const text = ["1", filler(500), "2", filler(500), "230", filler(500), "3", filler(500)].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Chapter 1", "Chapter 2", "Chapter 3"]
  );
});

test("a book starting mid-numbering is still picked up", () => {
  const text = ["33", filler(500), "34", filler(500), "35"].join("\n");

  assert.equal(findChapters(text).length, 3);
});

test("named sections do not disturb the number run", () => {
  const text = ["Prolog", filler(500), "1", filler(500), "Epilog", filler(500), "2"].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Prolog", "Chapter 1", "Epilog", "Chapter 2"]
  );
});

test("a number inside a sentence is not a heading", () => {
  const text = ["Es waren 33 Jahre vergangen, seit er das Haus verlassen hatte."].join("\n");

  assert.deepEqual(findChapters(text), []);
});

test("a long line starting with a number is not a heading", () => {
  const text = ["33 Kilometer weiter stand der Wagen mit laufendem Motor am Rand"].join("\n");

  assert.deepEqual(findChapters(text), []);
});

test("numbers beyond three digits are ignored", () => {
  const text = ["1984", filler(500), "12345"].join("\n");

  assert.deepEqual(findChapters(text), []);
});

test("text without headings yields none", () => {
  assert.deepEqual(findChapters(filler(2000)), []);
  assert.deepEqual(findChapters(""), []);
  assert.deepEqual(findChapters(undefined), []);
});

test("surrounding whitespace does not hide a heading", () => {
  const text = ["   33   ", filler(500), "\tProlog\t"].join("\n");

  assert.deepEqual(
    findChapters(text).map((c) => c.title),
    ["Chapter 33", "Prolog"]
  );
});

test("chapterAt reports the chapter a position falls in", () => {
  const chapters = [
    { title: "Prolog", index: 0 },
    { title: "Chapter 1", index: 100 },
    { title: "Chapter 2", index: 500 },
  ];

  assert.equal(chapterAt(chapters, 0).title, "Prolog");
  assert.equal(chapterAt(chapters, 99).title, "Prolog");
  assert.equal(chapterAt(chapters, 100).title, "Chapter 1");
  assert.equal(chapterAt(chapters, 499).title, "Chapter 1");
  assert.equal(chapterAt(chapters, 9000).title, "Chapter 2");
});

test("chapterAt returns nothing before the first chapter", () => {
  assert.equal(chapterAt([{ title: "Chapter 1", index: 50 }], 10), null);
  assert.equal(chapterAt([], 10), null);
});
