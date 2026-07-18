import test from "node:test";
import assert from "node:assert/strict";

import { coverTransform, projectBox, significantBlocks, framingQuality } from "../src/scanner/detect.js";

const box = (x0, y0, x1, y1) => ({ bbox: { x0, y0, x1, y1 } });

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
  const transform = coverTransform(400, 300, 400, 300);

  assert.deepEqual(transform, { scale: 1, offsetX: 0, offsetY: 0 });
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

test("specks are filtered out", () => {
  const blocks = [box(0, 0, 400, 300), box(0, 0, 5, 5)];

  assert.deepEqual(significantBlocks(blocks, 400, 300), [blocks[0]]);
});

test("filtering tolerates missing data", () => {
  assert.deepEqual(significantBlocks(undefined, 400, 300), []);
  assert.deepEqual(significantBlocks([{}], 400, 300), []);
  assert.deepEqual(significantBlocks([box(0, 0, 100, 100)], 0, 0), []);
});

test("one dominant block reads as good framing", () => {
  const blocks = significantBlocks([box(20, 20, 380, 280)], 400, 300);

  assert.equal(framingQuality(blocks, 400, 300), "good");
});

test("scattered blocks read as cluttered", () => {
  const blocks = significantBlocks(
    [box(0, 0, 200, 150), box(210, 0, 400, 150), box(0, 160, 200, 300), box(210, 160, 400, 300)],
    400,
    300
  );

  assert.equal(framingQuality(blocks, 400, 300), "cluttered");
});

test("a distant page reads as too small", () => {
  const blocks = significantBlocks([box(150, 120, 250, 180)], 400, 300);

  assert.equal(framingQuality(blocks, 400, 300), "small");
});

test("no blocks at all is reported as none", () => {
  assert.equal(framingQuality([], 400, 300), "none");
});
