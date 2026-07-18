// Page orientation detection.
//
// A book held sideways under the camera produces text running bottom-to-top,
// which Tesseract reads as near-noise: on a real sample it scored 20 confidence
// with 2% of words solid, against 70 and 61% once turned upright. Tesseract's
// own orientation detection needs the legacy model, so instead all four
// quarter-turns are tried on a heavily reduced copy and the best-scoring one
// wins. At 600px the winner is unambiguous; at 400px it picked wrong on a page
// that was already upright, so the probe is not shrunk further.

const PROBE_EDGE = 600;
const PROBE_OUTPUT = { text: true, blocks: false };

// Most pages are photographed the right way up, and probing all four turns for
// those is three passes of wasted time. Measured at 600px, upright samples
// scored 43 and 51 on the first try while a sideways one managed 19, so a
// clearly-readable first result is taken at face value. A dim upright page
// falls below this and merely pays for the full probe, which still finds it.
const CONFIDENT_ENOUGH = 35;

export function rotateCanvas(source, turns) {
  const quarter = ((turns % 4) + 4) % 4;
  if (quarter === 0) return source;

  const swapped = quarter % 2 === 1;
  const canvas = document.createElement("canvas");
  canvas.width = swapped ? source.height : source.width;
  canvas.height = swapped ? source.width : source.height;

  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((quarter * Math.PI) / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);

  return canvas;
}

function probeCanvas(source, turns) {
  const rotated = rotateCanvas(source, turns);
  const factor = Math.min(1, PROBE_EDGE / Math.max(rotated.width, rotated.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rotated.width * factor);
  canvas.height = Math.round(rotated.height * factor);
  canvas.getContext("2d").drawImage(rotated, 0, 0, canvas.width, canvas.height);

  if (rotated !== source) {
    rotated.width = 0;
    rotated.height = 0;
  }
  return canvas;
}

/** Returns how many quarter-turns clockwise bring the page upright. */
export async function detectOrientation(worker, source) {
  let bestTurns = 0;
  let bestConfidence = -1;

  for (let turns = 0; turns < 4; turns += 1) {
    const probe = probeCanvas(source, turns);
    try {
      const { data } = await worker.recognize(probe, {}, PROBE_OUTPUT);
      if (data.confidence > bestConfidence) {
        bestConfidence = data.confidence;
        bestTurns = turns;
      }
    } finally {
      probe.width = 0;
      probe.height = 0;
    }

    if (turns === 0 && bestConfidence >= CONFIDENT_ENOUGH) return 0;
  }

  return bestTurns;
}
