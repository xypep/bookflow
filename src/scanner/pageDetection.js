// Automatic placement of the crop corners.
//
// The obvious approach — contour detection on the paper edge — does not work
// on a page inside a bound book. Measured against real photos with OpenCV
// (Otsu, Canny, adaptive threshold, downscaling): not one correct find. The
// reason is physical rather than a matter of tuning. A loose sheet is framed
// by darker background on all four sides; an open book has no edge at the
// gutter, only more paper of the same brightness, so the wanted page and the
// facing one merge into a single blob.
//
// What we actually want to crop to is the text block, and Tesseract already
// reports where every word sits — in the same pass used to settle orientation.
// So detection works from word boxes instead of pixels, which also keeps an
// 8 MB dependency out of the bundle.

// Words below this are too unreliable to define an edge with.
const MIN_WORD_CONFIDENCE = 60;

// Fewer than this and there is not enough evidence to trust a box.
const MIN_WORDS = 15;

// TUNING, first of two knobs: how wide a horizontal gap has to be, as a share
// of image width, before words are treated as belonging to separate columns.
// This is what separates the wanted page from fragments of the facing one.
// Too small and a page with wide word spacing splits into pieces; too large
// and the facing page is swallowed into the crop. 0.06 held on all samples.
const COLUMN_GAP_RATIO = 0.06;

// TUNING, second knob: how much room to leave around the text, as a share of
// the block's own size.
//
// Swept against the real samples, scored on how much text survives the crop
// rather than on the share read cleanly — a tight crop loses words while the
// share among what remains stays flattering, so the percentage misleads here.
// Retained words by margin: .02→559  .04→566  .05→578  .07→535  .09→592.
//
// 0.09 keeps marginally the most, but pulls roughly fifty words of the facing
// page into one sample. 0.05 retains within noise of it and stays clean, so
// that is the setting. Raise it if line beginnings start going missing; lower
// it if text from the opposite page creeps in.
const MARGIN_RATIO = 0.05;

// A detected block covering less than this of the frame is more likely a stray
// cluster than a page of body text.
const MIN_AREA_RATIO = 0.08;

function collectWords(blocks) {
  const words = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (!word.bbox || !word.text?.trim()) continue;
          if (word.confidence < MIN_WORD_CONFIDENCE) continue;
          words.push({ bbox: word.bbox, baseline: line.baseline });
        }
      }
    }
  }
  return words;
}

/**
 * Groups words into columns separated by wide horizontal gaps. The facing page
 * shows up as its own group, which is how the wanted page gets isolated.
 */
export function clusterByColumn(words, imageWidth) {
  if (!words.length) return [];

  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const gap = imageWidth * COLUMN_GAP_RATIO;
  const clusters = [[sorted[0]]];
  let reach = sorted[0].bbox.x1;

  for (let i = 1; i < sorted.length; i += 1) {
    const word = sorted[i];
    if (word.bbox.x0 - reach > gap) {
      clusters.push([word]);
      reach = word.bbox.x1;
    } else {
      clusters.at(-1).push(word);
      reach = Math.max(reach, word.bbox.x1);
    }
  }
  return clusters;
}

/**
 * Median tilt of the text, in radians, taken from the line baselines Tesseract
 * reports. Using the median keeps one badly-fitted line from skewing the
 * result. Lets the corners follow a tilted shot instead of sitting square.
 */
export function textAngle(words) {
  const angles = [];
  const seen = new Set();

  for (const { baseline } of words) {
    if (!baseline) continue;
    const key = `${baseline.x0},${baseline.y0},${baseline.x1},${baseline.y1}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const dx = baseline.x1 - baseline.x0;
    const dy = baseline.y1 - baseline.y0;
    if (Math.abs(dx) < 1) continue;
    angles.push(Math.atan2(dy, dx));
  }

  if (!angles.length) return 0;
  angles.sort((a, b) => a - b);
  return angles[Math.floor(angles.length / 2)];
}

const rotatePoint = (x, y, cx, cy, angle) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
};

/** Smallest box around the words that follows the text's own tilt. */
export function tiltedBounds(words, angle, marginRatio = MARGIN_RATIO) {
  const corners = words.flatMap(({ bbox }) => [
    { x: bbox.x0, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y1 },
    { x: bbox.x0, y: bbox.y1 },
  ]);

  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;

  // Straighten the points, measure an axis-aligned box, then tilt the box back.
  const straightened = corners.map(({ x, y }) => rotatePoint(x, y, cx, cy, -angle));
  const xs = straightened.map((p) => p.x);
  const ys = straightened.map((p) => p.y);

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  const padX = (maxX - minX) * marginRatio;
  const padY = (maxY - minY) * marginRatio;
  minX -= padX;
  maxX += padX;
  minY -= padY;
  maxY += padY;

  return [
    rotatePoint(minX, minY, cx, cy, angle),
    rotatePoint(maxX, minY, cx, cy, angle),
    rotatePoint(maxX, maxY, cx, cy, angle),
    rotatePoint(minX, maxY, cx, cy, angle),
  ];
}

// A spread splits roughly evenly. Measured on a real photo, a fragment of the
// facing page came to about a quarter of the main column, so requiring the
// smaller half to be at least this share of the larger keeps them apart.
const SPREAD_BALANCE = 0.5;

// Resolution of the density profile used to locate the gutter.
const PROFILE_BUCKETS = 60;

// The gutter is looked for here, as a fraction of image width. A book is held
// roughly centred, and searching the whole width would find the blank margins
// outside the text instead.
const GUTTER_SEARCH = [0.3, 0.7];

const extentOf = (words) => ({
  x0: Math.min(...words.map((w) => w.bbox.x0)),
  x1: Math.max(...words.map((w) => w.bbox.x1)),
});

/**
 * Locates the gutter as the emptiest vertical band near the middle.
 *
 * A fixed gap threshold was tried first and does not work: measured on a real
 * spread the gutter was only about 50px of a 1280px image — narrower than any
 * threshold safe enough not to split ordinary paragraph spacing — while the
 * widest gap in the picture sat off at the left margin among stray words. The
 * gutter is reliably the *emptiest* place near the centre, though, even when
 * it is narrow.
 */
function findGutter(words, width) {
  const buckets = new Array(PROFILE_BUCKETS).fill(0);
  for (const { bbox } of words) {
    const centre = (bbox.x0 + bbox.x1) / 2;
    const index = Math.floor((centre / width) * PROFILE_BUCKETS);
    buckets[Math.min(PROFILE_BUCKETS - 1, Math.max(0, index))] += 1;
  }

  const from = Math.floor(PROFILE_BUCKETS * GUTTER_SEARCH[0]);
  const to = Math.ceil(PROFILE_BUCKETS * GUTTER_SEARCH[1]);

  // The middle of the longest near-empty run, so the split lands in the centre
  // of the gutter rather than against the text on one side.
  const peak = Math.max(...buckets);
  const empty = (index) => buckets[index] <= peak * 0.1;

  let best = null;
  let runStart = null;

  for (let i = from; i <= to; i += 1) {
    if (empty(i)) {
      if (runStart === null) runStart = i;
      const length = i - runStart + 1;
      if (!best || length > best.length) best = { start: runStart, length };
    } else {
      runStart = null;
    }
  }

  if (!best) return null;
  return ((best.start + best.length / 2) / PROFILE_BUCKETS) * width;
}

/**
 * Horizontal extents of the pages visible in the image: one entry for a single
 * page, two for an open spread, ordered left to right — reading order.
 *
 * A document scanner treats an open book as one sheet, so a spread arrives as
 * a single image. Splitting it means each page is read on its own instead of
 * the recognizer running lines straight across the gutter.
 */
export function detectPageColumns(blocks, width) {
  const words = collectWords(blocks);
  if (words.length < MIN_WORDS) return [];

  const main = clusterByColumn(words, width)
    .filter((cluster) => cluster.length >= MIN_WORDS)
    .sort((a, b) => b.length - a.length)[0];

  if (!main) return [];

  const gutter = findGutter(words, width);
  if (gutter !== null) {
    const centre = ({ bbox }) => (bbox.x0 + bbox.x1) / 2;
    const left = words.filter((word) => centre(word) < gutter);
    const right = words.filter((word) => centre(word) >= gutter);
    const smaller = Math.min(left.length, right.length);
    const larger = Math.max(left.length, right.length);

    if (smaller >= MIN_WORDS && smaller >= larger * SPREAD_BALANCE) {
      return [extentOf(left), extentOf(right)];
    }
  }

  return [extentOf(main)];
}

/**
 * Where to cut a spread into two pages, in the coordinates of `imageWidth`.
 *
 * The columns are measured on a reduced probe, so they have to be scaled back
 * up. Returns `null` when there is nothing to split or the cut would fall
 * outside the image, which the caller treats as "leave the page whole".
 */
export function spreadCut(columns, imageWidth, probeWidth) {
  if (!columns || columns.length < 2 || !probeWidth) return null;

  // Midway between the two text blocks, so the cut lands in the gutter rather
  // than against the last line of either page.
  const cut = Math.round(((columns[0].x1 + columns[1].x0) / 2) * (imageWidth / probeWidth));
  return cut > 0 && cut < imageWidth ? cut : null;
}

function quadArea(quad) {
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}

function isPlausible(quad, width, height) {
  if (quadArea(quad) / (width * height) < MIN_AREA_RATIO) return false;

  const side = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const across = (side(quad[0], quad[1]) + side(quad[3], quad[2])) / 2;
  const down = (side(quad[0], quad[3]) + side(quad[1], quad[2])) / 2;
  if (across < 1 || down < 1) return false;

  const aspect = across / down;
  return aspect > 0.15 && aspect < 6;
}

/**
 * Places the four crop corners around the page's own text block.
 *
 * `blocks` is Tesseract's recognition output; `width`/`height` describe the
 * image those coordinates were measured on. Corners come back in that same
 * space, ordered top-left, top-right, bottom-right, bottom-left — the order
 * the cropper and the perspective correction expect.
 *
 * Returns `null` whenever the evidence is too thin or the result implausible,
 * which the caller treats as "leave the handles where they were".
 */
export function detectPageCorners(blocks, width, height, { marginRatio = MARGIN_RATIO } = {}) {
  const words = collectWords(blocks);
  if (words.length < MIN_WORDS) return null;

  const clusters = clusterByColumn(words, width);
  if (!clusters.length) return null;

  // Most words wins rather than largest area: a few big stray characters at
  // the edge can cover more ground than a column of body text.
  const main = clusters.reduce((best, cluster) => (cluster.length > best.length ? cluster : best));
  if (main.length < MIN_WORDS) return null;

  const quad = tiltedBounds(main, textAngle(main), marginRatio);
  if (!isPlausible(quad, width, height)) return null;

  // Clamped last: a margin pushing a corner off-image would otherwise sample
  // outside the photo.
  return quad.map(({ x, y }) => ({
    x: Math.min(width, Math.max(0, x)),
    y: Math.min(height, Math.max(0, y)),
  }));
}
