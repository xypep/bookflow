import test from "node:test";
import assert from "node:assert/strict";

import { detectPageColumns, spreadCut } from "../src/scanner/pageDetection.js";
import { extractText } from "../src/scanner/extract.js";

const WIDTH = 1000;

const word = (text, x0, x1, confidence = 90) => ({
  text,
  confidence,
  bbox: { x0, y0: 100, x1, y1: 130 },
});

const pageOf = (...lines) => [
  {
    paragraphs: [
      {
        lines: lines.map((words) => ({
          words,
          baseline: { x0: words[0].bbox.x0, y0: 130, x1: words.at(-1).bbox.x1, y1: 130 },
        })),
      },
    ],
  },
];

// A column of words within the given horizontal band.
const column = (label, start, count) =>
  Array.from({ length: count }, (_, i) => word(`${label}${i}`, start + (i % 4) * 90, start + (i % 4) * 90 + 70));

test("a single page yields one column", () => {
  const blocks = pageOf(column("a", 100, 40));

  assert.equal(detectPageColumns(blocks, WIDTH).length, 1);
});

test("an open spread yields two columns in reading order", () => {
  const blocks = pageOf([...column("left", 60, 40), ...column("right", 560, 40)]);
  const columns = detectPageColumns(blocks, WIDTH);

  assert.equal(columns.length, 2);
  assert.ok(columns[0].x0 < columns[1].x0, "left page comes first");
  assert.ok(columns[0].x1 < columns[1].x0, "the columns do not overlap");
});

test("a fragment of the facing page is not a second page", () => {
  // Measured on real photos: a sliver of the opposite page came to roughly a
  // quarter of the main column, well short of an even split.
  const blocks = pageOf([...column("main", 60, 40), ...column("edge", 900, 8)]);

  assert.equal(detectPageColumns(blocks, WIDTH).length, 1);
});

test("a narrow gutter still splits the spread", () => {
  // Measured on a real photo: the gutter was about 50px of a 1280px image,
  // narrower than any fixed gap threshold that would leave ordinary paragraph
  // spacing alone. What identifies it is being the emptiest band near the
  // middle, not being wide.
  const left = Array.from({ length: 30 }, (_, i) =>
    word(`l${i}`, 60 + (i % 5) * 85, 60 + (i % 5) * 85 + 75)
  );
  const right = Array.from({ length: 30 }, (_, i) =>
    word(`r${i}`, 530 + (i % 5) * 85, 530 + (i % 5) * 85 + 75)
  );
  const columns = detectPageColumns(pageOf([...left, ...right]), WIDTH);

  assert.equal(columns.length, 2, "a 45px gutter should still be found");
  assert.ok(columns[0].x1 < columns[1].x0);
});

test("stray words at a margin do not masquerade as a gutter", () => {
  // The widest gap in a real photo sat at the left edge, among a few stray
  // words, not at the gutter. Only the central band is searched.
  const stray = [word("x", 10, 40), word("y", 45, 70)];
  const body = Array.from({ length: 40 }, (_, i) =>
    word(`b${i}`, 300 + (i % 6) * 100, 300 + (i % 6) * 100 + 85)
  );

  assert.equal(detectPageColumns(pageOf([...stray, ...body]), WIDTH).length, 1);
});

test("too little text yields no columns", () => {
  assert.deepEqual(detectPageColumns(pageOf(column("a", 100, 3)), WIDTH), []);
  assert.deepEqual(detectPageColumns([], WIDTH), []);
  assert.deepEqual(detectPageColumns(undefined, WIDTH), []);
});

test("a column restricts extraction to its own side", () => {
  // One recognized line running across the gutter, as happens on a spread.
  const blocks = pageOf([
    word("links", 60, 200),
    word("weiter", 220, 380),
    word("rechts", 620, 760),
    word("ende", 780, 900),
  ]);

  assert.equal(extractText(blocks, { column: { x0: 0, x1: 500 } }), "links weiter");
  assert.equal(extractText(blocks, { column: { x0: 500, x1: 1000 } }), "rechts ende");
});

test("a word straddling the boundary goes to the side it mostly sits on", () => {
  // Centre at 480, so it belongs to the left column.
  const blocks = pageOf([word("grenzfall", 440, 520)]);

  assert.equal(extractText(blocks, { column: { x0: 0, x1: 500 } }), "grenzfall");
  assert.equal(extractText(blocks, { column: { x0: 500, x1: 1000 } }), "");
});

test("extraction without a column is unchanged", () => {
  const blocks = pageOf([word("alles", 60, 200), word("zusammen", 620, 760)]);

  assert.equal(extractText(blocks), "alles zusammen");
});

test("the cut lands between the two pages, scaled to the full image", () => {
  // Columns come from a reduced probe, so the cut has to be scaled up.
  const columns = [
    { x0: 46, x1: 293 },
    { x0: 326, x1: 600 },
  ];

  assert.equal(spreadCut(columns, 600, 600), 310);
  assert.equal(spreadCut(columns, 3400, 600), 1754);
});

test("a single page is not cut", () => {
  assert.equal(spreadCut([{ x0: 100, x1: 500 }], 1000, 1000), null);
  assert.equal(spreadCut([], 1000, 1000), null);
  assert.equal(spreadCut(undefined, 1000, 1000), null);
});

test("a cut falling outside the image leaves the page whole", () => {
  const flush = [
    { x0: 0, x1: 0 },
    { x0: 0, x1: 400 },
  ];

  assert.equal(spreadCut(flush, 1000, 1000), null);
  assert.equal(spreadCut(flush, 1000, 0), null);
});
