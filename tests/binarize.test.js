import test from "node:test";
import assert from "node:assert/strict";

import { toGrayscale, adaptiveThreshold, grayToRgba } from "../src/scanner/binarize.js";

const WIDTH = 400;
const HEIGHT = 200;

// A page photo with a heavy lighting gradient: bright on the left, deep shadow
// on the right, as if a spine shadow fell across it. Text bars sit across the
// whole width and are equally dark relative to their local background, so a
// well-behaved threshold has to find all of them.
function shadowedPage() {
  const gray = new Uint8ClampedArray(WIDTH * HEIGHT);
  const textPixels = new Set();

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const lighting = 240 - (x / WIDTH) * 190;
      const isText = y % 20 < 6 && x % 40 < 24;
      const index = y * WIDTH + x;

      gray[index] = isText ? lighting * 0.35 : lighting;
      if (isText) textPixels.add(index);
    }
  }
  return { gray, textPixels };
}

function score(result, textPixels) {
  let textFound = 0;
  let backgroundKept = 0;
  let backgroundTotal = 0;

  for (let i = 0; i < result.length; i += 1) {
    if (textPixels.has(i)) {
      if (result[i] === 0) textFound += 1;
    } else {
      backgroundTotal += 1;
      if (result[i] === 255) backgroundKept += 1;
    }
  }

  return {
    textRecall: textFound / textPixels.size,
    backgroundPurity: backgroundKept / backgroundTotal,
  };
}

// The approach this replaced: one global cutoff after a contrast stretch.
function globalThreshold(gray) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    const stretched = Math.min(255, Math.max(0, (gray[i] - 128) * 1.4 + 128));
    out[i] = stretched < 128 ? 0 : 255;
  }
  return out;
}

test("adaptive threshold recovers text across a shadowed page", () => {
  const { gray, textPixels } = shadowedPage();
  const result = score(adaptiveThreshold(gray, WIDTH, HEIGHT), textPixels);

  assert.ok(result.textRecall > 0.95, `text recall was ${result.textRecall}`);
  assert.ok(result.backgroundPurity > 0.95, `background purity was ${result.backgroundPurity}`);
});

test("a global cutoff drowns the shadowed side of the page", () => {
  const { gray, textPixels } = shadowedPage();
  const globalResult = score(globalThreshold(gray), textPixels);
  const adaptiveResult = score(adaptiveThreshold(gray, WIDTH, HEIGHT), textPixels);

  // The failure mode is not losing text, it is turning the dark half solid
  // black, which leaves OCR nothing to read there.
  assert.ok(globalResult.backgroundPurity < 0.7, "expected the global cutoff to lose background");
  assert.ok(adaptiveResult.backgroundPurity > globalResult.backgroundPurity + 0.2);
});

test("adaptive threshold emits strictly binary values", () => {
  const { gray } = shadowedPage();
  const values = new Set(adaptiveThreshold(gray, WIDTH, HEIGHT));

  assert.deepEqual([...values].sort((a, b) => a - b), [0, 255]);
});

test("an evenly lit page keeps its blank margins white", () => {
  const gray = new Uint8ClampedArray(100 * 100).fill(230);
  const result = adaptiveThreshold(gray, 100, 100);

  assert.ok([...result].every((value) => value === 255), "flat page should not produce speckle");
});

test("grayscale applies luminance weights", () => {
  const red = new Uint8ClampedArray([255, 0, 0, 255]);
  const green = new Uint8ClampedArray([0, 255, 0, 255]);

  assert.equal(Math.round(toGrayscale(red, 1, 1)[0]), 76);
  assert.equal(Math.round(toGrayscale(green, 1, 1)[0]), 150);
});

test("grayToRgba mirrors the channel and stays opaque", () => {
  const gray = new Uint8ClampedArray([0, 255]);
  const rgba = grayToRgba(gray, new Uint8ClampedArray(8));

  assert.deepEqual([...rgba], [0, 0, 0, 255, 255, 255, 255, 255]);
});
