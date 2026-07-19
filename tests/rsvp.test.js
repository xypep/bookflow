import test from "node:test";
import assert from "node:assert/strict";

import { getOrpIndex, getBionicLength } from "../src/reader/rsvp.js";

test("the fixation point moves right as words get longer", () => {
  assert.equal(getOrpIndex("a"), 0);
  assert.equal(getOrpIndex("word"), 1);
  assert.equal(getOrpIndex("reading"), 2);
  assert.equal(getOrpIndex("understanding"), 3);
  assert.equal(getOrpIndex("incomprehensible"), 4);
});

test("a short word emboldens a single letter", () => {
  // Half of "the" would be two of three letters, which emphasises nothing.
  assert.equal(getBionicLength("a"), 1);
  assert.equal(getBionicLength("to"), 1);
  assert.equal(getBionicLength("the"), 1);
});

test("longer words embolden roughly the first two fifths", () => {
  assert.equal(getBionicLength("word"), 2);
  assert.equal(getBionicLength("reading"), 3);
  assert.equal(getBionicLength("understanding"), 5);
});

test("some of the word always stays light", () => {
  for (const word of ["a", "to", "the", "word", "reading", "incomprehensible"]) {
    assert.ok(
      getBionicLength(word) < word.length || word.length <= 1,
      `"${word}" was emboldened in full`
    );
  }
});

test("an empty word emboldens nothing", () => {
  assert.equal(getBionicLength(""), 0);
});
