import test from "node:test";
import assert from "node:assert/strict";

import { coverTransform, projectBox, wordBoxes, readingQuality } from "../src/scanner/detect.js";

const word = (text, confidence, bbox = { x0: 0, y0: 0, x1: 10, y1: 10 }) => ({ text, confidence, bbox });
const page = (...words) => [{ paragraphs: [{ lines: [{ words }] }] }];

test("cover scales by the axis that needs the most growth", () => {
  // A 4:3 frame shown in a taller portrait element has to be scaled to cover
  // the height, which crops the sides.
  const transform = coverTransform(800, 600, 400, 600);

  assert.equal(transform.scale, 1);
  assert.equal(transform.offsetX, -200);
  assert.equal(transform.offsetY, 0);
});

test("cover centres the crop on both axes", () => {
  const wide = coverTransform(800, 600, 400, 600);
  const tall = coverTransform(600, 800, 600, 400);

  assert.equal(wide.offsetX * 2 + 800 * wide.scale, 400);
  assert.equal(tall.offsetY * 2 + 800 * tall.scale, 400);
});

test("a frame matching its element is left untouched", () => {
  assert.deepEqual(coverTransform(400, 300, 400, 300), { scale: 1, offsetX: 0, offsetY: 0 });
});

test("a box projects onto the displayed video", () => {
  const transform = coverTransform(400, 300, 800, 600);
  const projected = projectBox({ x0: 100, y0: 50, x1: 200, y1: 150 }, transform);

  assert.deepEqual(projected, { left: 200, top: 100, width: 200, height: 200 });
});

test("a box in a cropped frame shifts with the crop", () => {
  const transform = coverTransform(800, 600, 400, 600);
  const projected = projectBox({ x0: 400, y0: 0, x1: 500, y1: 100 }, transform);

  // The frame is cropped 200px on each side, so a box at x=400 lands at 200.
  assert.equal(projected.left, 200);
  assert.equal(projected.width, 100);
});

test("words are collected out of the nested result", () => {
  const blocks = page(word("Anders", 94), word("als", 91));

  assert.deepEqual(
    wordBoxes(blocks).map((entry) => entry.text),
    ["Anders", "als"]
  );
});

test("guesswork is left out", () => {
  const blocks = page(word("Anders", 94), word("SS", 18), word("DZ", 25));

  assert.deepEqual(
    wordBoxes(blocks).map((entry) => entry.text),
    ["Anders"]
  );
});

test("blank and box-less words are skipped", () => {
  const blocks = page(word("   ", 95), { text: "kein bbox", confidence: 95 }, word("gut", 90));

  assert.deepEqual(
    wordBoxes(blocks).map((entry) => entry.text),
    ["gut"]
  );
});

test("collecting tolerates missing structures", () => {
  assert.deepEqual(wordBoxes(undefined), []);
  assert.deepEqual(wordBoxes([]), []);
  assert.deepEqual(wordBoxes([{}]), []);
  assert.deepEqual(wordBoxes([{ paragraphs: [{ lines: [{}] }] }]), []);
});

test("the confidence floor is adjustable", () => {
  const blocks = page(word("grenzwertig", 25));

  assert.deepEqual(wordBoxes(blocks), []);
  assert.equal(wordBoxes(blocks, { minConfidence: 20 }).length, 1);
});

test("a page read confidently reports good", () => {
  const words = Array.from({ length: 20 }, () => ({ confidence: 92 }));

  assert.equal(readingQuality(words).level, "good");
});

test("a few good words are not enough on their own", () => {
  // All confident, but too little text to judge the shot by.
  const words = Array.from({ length: 4 }, () => ({ confidence: 95 }));

  assert.equal(readingQuality(words).level, "fair");
});

test("a mostly shaky page reports poor", () => {
  const words = [
    ...Array.from({ length: 3 }, () => ({ confidence: 90 })),
    ...Array.from({ length: 17 }, () => ({ confidence: 45 })),
  ];

  assert.equal(readingQuality(words).level, "poor");
});

test("quality reports the counts behind it", () => {
  const words = [{ confidence: 95 }, { confidence: 95 }, { confidence: 40 }];
  const quality = readingQuality(words);

  assert.equal(quality.solid, 2);
  assert.equal(quality.total, 3);
});

test("nothing recognized reports none", () => {
  assert.deepEqual(readingQuality([]), { level: "none", solid: 0, total: 0 });
});
