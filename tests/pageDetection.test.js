import test from "node:test";
import assert from "node:assert/strict";

import {
  detectPageCorners,
  clusterByColumn,
  textAngle,
  tiltedBounds,
} from "../src/scanner/pageDetection.js";

const WIDTH = 600;
const HEIGHT = 800;

const wordAt = (x0, y0, x1, y1, confidence = 90) => ({
  text: "wort",
  confidence,
  bbox: { x0, y0, x1, y1 },
});

// Builds recognition output shaped like Tesseract's, one line per row.
function pageOf(rows) {
  return [
    {
      paragraphs: [
        {
          lines: rows.map((words) => ({
            words,
            baseline: {
              x0: words[0].bbox.x0,
              y0: words[0].bbox.y1,
              x1: words.at(-1).bbox.x1,
              y1: words.at(-1).bbox.y1,
            },
          })),
        },
      ],
    },
  ];
}

// A column of body text: 10 lines of 4 words, filling the left two-thirds.
function bodyText({ left = 100, top = 100, lineHeight = 50, confidence = 90 } = {}) {
  return Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) =>
      wordAt(
        left + column * 90,
        top + row * lineHeight,
        left + column * 90 + 70,
        top + row * lineHeight + 30,
        confidence
      )
    )
  );
}

test("places corners around a page of body text", () => {
  const corners = detectPageCorners(pageOf(bodyText()), WIDTH, HEIGHT);

  assert.ok(corners, "expected a detection");
  assert.equal(corners.length, 4);

  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  assert.ok(topLeft.x < topRight.x, "top-left sits left of top-right");
  assert.ok(topLeft.y < bottomLeft.y, "top-left sits above bottom-left");
  assert.ok(bottomLeft.x < bottomRight.x, "bottom-left sits left of bottom-right");
});

test("the box encloses the text with a little room to spare", () => {
  const rows = bodyText();
  const corners = detectPageCorners(pageOf(rows), WIDTH, HEIGHT);

  const words = rows.flat();
  const left = Math.min(...words.map((w) => w.bbox.x0));
  const right = Math.max(...words.map((w) => w.bbox.x1));

  assert.ok(corners[0].x < left, "left edge clears the first column");
  assert.ok(corners[1].x > right, "right edge clears the last column");
});

test("fragments of the facing page are left out", () => {
  // Body text on the left, plus a narrow strip far to the right with a wide
  // gap between them — the shape a facing page makes.
  const facingPage = Array.from({ length: 6 }, (_, row) => [
    wordAt(560, 120 + row * 60, 598, 150 + row * 60),
  ]);
  const corners = detectPageCorners(pageOf([...bodyText(), ...facingPage]), WIDTH, HEIGHT);

  assert.ok(corners, "expected a detection");
  assert.ok(corners[1].x < 540, `right edge should stop before the strip, was ${corners[1].x}`);
});

test("corners follow the tilt of the text", () => {
  // Each line steps down as it goes right, as in a photo taken at an angle.
  const slope = 0.12;
  const rows = Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => {
      const x = 100 + column * 90;
      const drop = Math.round(x * slope);
      return wordAt(x, 100 + row * 50 + drop, x + 70, 130 + row * 50 + drop);
    })
  );

  const corners = detectPageCorners(pageOf(rows), WIDTH, HEIGHT);

  assert.ok(corners, "expected a detection");
  // A square box would have a level top edge; a tilted one drops to the right.
  assert.ok(corners[1].y > corners[0].y + 10, "top edge should follow the slope");
});

test("too little text is reported as no detection", () => {
  const corners = detectPageCorners(pageOf([[wordAt(100, 100, 170, 130)]]), WIDTH, HEIGHT);

  assert.equal(corners, null);
});

test("unreliable words do not count as evidence", () => {
  const corners = detectPageCorners(pageOf(bodyText({ confidence: 30 })), WIDTH, HEIGHT);

  assert.equal(corners, null);
});

test("a block too small to be a page is rejected", () => {
  // Plenty of words, but crammed into a corner of the frame.
  const rows = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      wordAt(10 + column * 12, 10 + row * 6, 10 + column * 12 + 10, 10 + row * 6 + 5)
    )
  );

  assert.equal(detectPageCorners(pageOf(rows), WIDTH, HEIGHT), null);
});

test("missing or empty input is reported as no detection", () => {
  assert.equal(detectPageCorners(undefined, WIDTH, HEIGHT), null);
  assert.equal(detectPageCorners([], WIDTH, HEIGHT), null);
  assert.equal(detectPageCorners([{}], WIDTH, HEIGHT), null);
});

test("corners stay inside the image", () => {
  // Text running right up to every edge, so the margin would push outside.
  const rows = Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) =>
      wordAt(column * 150, row * 80, column * 150 + 145, row * 80 + 75)
    )
  );

  for (const { x, y } of detectPageCorners(pageOf(rows), WIDTH, HEIGHT)) {
    assert.ok(x >= 0 && x <= WIDTH, `x out of range: ${x}`);
    assert.ok(y >= 0 && y <= HEIGHT, `y out of range: ${y}`);
  }
});

test("columns split on wide gaps only", () => {
  const words = [
    wordAt(10, 10, 100, 40),
    wordAt(110, 10, 200, 40),
    // A gap well past the threshold starts a new column.
    wordAt(400, 10, 500, 40),
  ].map((word) => ({ bbox: word.bbox }));

  const clusters = clusterByColumn(words, WIDTH);

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].length, 2);
  assert.equal(clusters[1].length, 1);
});

test("clustering handles a single word and none at all", () => {
  assert.deepEqual(clusterByColumn([], WIDTH), []);
  assert.equal(clusterByColumn([{ bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }], WIDTH).length, 1);
});

test("level text reports no tilt", () => {
  const words = [{ baseline: { x0: 0, y0: 100, x1: 300, y1: 100 } }];

  assert.equal(textAngle(words), 0);
});

test("tilt is taken as the median across lines", () => {
  const words = [
    { baseline: { x0: 0, y0: 0, x1: 100, y1: 10 } },
    { baseline: { x0: 0, y0: 0, x1: 100, y1: 11 } },
    { baseline: { x0: 0, y0: 0, x1: 100, y1: 12 } },
    // One wildly misfitted line must not drag the answer with it.
    { baseline: { x0: 0, y0: 0, x1: 100, y1: 400 } },
  ];

  const angle = textAngle(words);

  assert.ok(angle > 0.09 && angle < 0.13, `median angle was ${angle}`);
});

test("tilt falls back to zero without baselines", () => {
  assert.equal(textAngle([{ bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }]), 0);
});

test("bounds around level words stay square", () => {
  const words = [{ bbox: { x0: 100, y0: 100, x1: 200, y1: 150 } }];
  const [topLeft, topRight, , bottomLeft] = tiltedBounds(words, 0);

  assert.equal(Math.round(topLeft.y), Math.round(topRight.y));
  assert.equal(Math.round(topLeft.x), Math.round(bottomLeft.x));
});
