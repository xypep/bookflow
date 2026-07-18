// Geometry and filtering for the live word overlay. Kept free of DOM access so
// the coordinate mapping — the part that is easy to get subtly wrong — can be
// tested directly.

// Below this the reading is guesswork, and highlighting it would only clutter
// the preview.
const MIN_WORD_CONFIDENCE = 30;

/**
 * The video fills its element with `object-fit: cover`: scaled up until both
 * axes are covered, then centre-cropped. Boxes measured on the analysed frame
 * have to follow that same transform to line up with what is on screen.
 */
export function coverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
  return {
    scale,
    offsetX: (displayWidth - sourceWidth * scale) / 2,
    offsetY: (displayHeight - sourceHeight * scale) / 2,
  };
}

export function projectBox(bbox, { scale, offsetX, offsetY }) {
  return {
    left: bbox.x0 * scale + offsetX,
    top: bbox.y0 * scale + offsetY,
    width: (bbox.x1 - bbox.x0) * scale,
    height: (bbox.y1 - bbox.y0) * scale,
  };
}

/** Flattens the nested recognition result down to the words worth drawing. */
export function wordBoxes(blocks, { minConfidence = MIN_WORD_CONFIDENCE } = {}) {
  const words = [];

  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          if (!word.bbox || !word.text?.trim()) continue;
          if (word.confidence < minConfidence) continue;

          words.push({ bbox: word.bbox, confidence: word.confidence, text: word.text.trim() });
        }
      }
    }
  }
  return words;
}

/**
 * How well the current shot is being read, as a share of confidently
 * recognized words. This is the signal that tells you to adjust before
 * shooting rather than after.
 */
export function readingQuality(words) {
  if (!words.length) return { level: "none", solid: 0, total: 0 };

  const solid = words.filter((word) => word.confidence >= 80).length;
  const share = solid / words.length;

  let level = "poor";
  if (share >= 0.8 && solid >= 10) level = "good";
  else if (share >= 0.5) level = "fair";

  return { level, solid, total: words.length };
}
