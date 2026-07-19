import test from "node:test";
import assert from "node:assert/strict";

import { coverStyle, coverInitials } from "../src/library/covers.js";

test("the same title always produces the same cover", () => {
  assert.equal(coverStyle("Dune"), coverStyle("Dune"));
});

test("casing and padding do not change a cover", () => {
  assert.equal(coverStyle("Dune"), coverStyle("  dune "));
});

test("different titles get different colours", () => {
  const titles = ["Dune", "Echo", "Paradox", "Book 1", "Book 2", "Book 3"];
  const hues = titles.map((title) => coverStyle(title).match(/hsl\((\d+)/)[1]);

  // Short, similar titles are exactly the case a weak hash would collide on.
  assert.equal(new Set(hues).size, titles.length);
});

test("a cover carries both gradient stops and an angle", () => {
  const style = coverStyle("Dune");

  assert.match(style, /--cover-a: hsl\(\d+ \d+% \d+%\)/);
  assert.match(style, /--cover-b: hsl\(\d+ \d+% \d+%\)/);
  assert.match(style, /--cover-tilt: \d+deg/);
});

test("initials come from the first and last word", () => {
  assert.equal(coverInitials("The Long Way to a Small Angry Planet"), "TP");
  assert.equal(coverInitials("Open Book Info"), "OI");
});

test("a single word gives its first two letters", () => {
  assert.equal(coverInitials("Dune"), "DU");
  assert.equal(coverInitials("Echo"), "EC");
});

test("punctuation-only words are skipped", () => {
  assert.equal(coverInitials("Hello — World"), "HW");
});

test("a title with no letters still yields something to draw", () => {
  assert.equal(coverInitials("— —"), "?");
  assert.equal(coverInitials("   "), "?");
});
