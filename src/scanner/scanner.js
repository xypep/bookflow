import { createWorker } from "tesseract.js";
import { toGrayscale, adaptiveThreshold, grayToRgba } from "./binarize.js";
import { extractText, dehyphenate } from "./extract.js";
import { detectPageColumns, spreadCut } from "./pageDetection.js";
import { detectOrientation, rotateCanvas } from "./orientation.js";
import { languageString } from "./languages.js";

// Worker + wasm core are self-hosted (see public/tesseract) instead of the
// default jsDelivr CDN, so scanning also works when the app is opened over
// plain http on the local network where CORS/mixed content can be an issue.
let workerPromise = null;
let loadedLanguages = null;

function createOcrWorker(languages) {
  return createWorker(languages, undefined, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/tesseract-core-simd-lstm.wasm.js",
  }).catch((error) => {
    // Don't keep a rejected promise cached — otherwise every later scan
    // fails instantly until the page is reloaded.
    workerPromise = null;
    loadedLanguages = null;
    throw error;
  });
}

// Shared with the live camera preview so the multi-megabyte core and language
// data are only ever loaded once. A changed language selection reinitializes
// the existing worker rather than building a new one, which would re-fetch the
// core for no reason.
export function getWorker() {
  const languages = languageString();

  if (!workerPromise) {
    workerPromise = createOcrWorker(languages);
  } else if (languages !== loadedLanguages) {
    workerPromise = workerPromise
      .then(async (worker) => {
        await worker.reinitialize(languages);
        return worker;
      })
      .catch((error) => {
        // Same reasoning as above: a cached rejection would break every later
        // scan, so drop it and let the next attempt start clean.
        workerPromise = null;
        loadedLanguages = null;
        throw error;
      });
  }

  loadedLanguages = languages;
  return workerPromise;
}

// Safari refuses to allocate canvases beyond roughly 16.7 megapixels and
// silently hands back a blank one instead. Modern phone cameras shoot well
// past that (a 24 MP iPhone photo is ~24.5 MP), so images are scaled down
// before drawing. ~2400px on the long edge is also plenty of resolution for
// OCR on a page of text, and keeps recognition fast.
const MAX_EDGE = 2400;

function fitDimensions(width, height) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function loadCanvas(file) {
  // "from-image" applies the EXIF rotation. Without it, portrait photos reach
  // Tesseract sideways, where text is essentially unrecognizable.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitDimensions(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas;
}

function binarizeCanvas(source) {
  const { width, height } = source;
  const sourceData = source.getContext("2d").getImageData(0, 0, width, height);
  const gray = toGrayscale(sourceData.data, width, height);
  const binary = adaptiveThreshold(gray, width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const output = new ImageData(width, height);
  grayToRgba(binary, output.data);
  canvas.getContext("2d").putImageData(output, 0, 0);

  return canvas;
}

// Frees the backing store right away rather than waiting for GC; a pair of
// full-page canvases is tens of megabytes on a phone.
function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

// Cleanup helps typical printed pages, but it can work against unusual
// typefaces with very thin or ornamental strokes. Rather than guessing, the
// cleaned image is tried first and the original is only re-run when Tesseract
// reports low confidence — then whichever read better is kept.
const LOW_CONFIDENCE = 75;

// Word-level output is needed so unreliable words can be discarded; the plain
// text Tesseract renders has already thrown that information away.
const WORD_OUTPUT = { blocks: true, text: false };

// A page photographed by hand is never quite square to the camera, and even a
// slight tilt costs accuracy. Tesseract can measure and correct the skew.
const RECOGNIZE_OPTIONS = { rotateAuto: true };

// Where a photo of a spread still slips through, the words are at least sorted
// back onto their own page. This is the weaker of the two remedies — see
// preparePage for why cutting the image first is preferred.
function textFromResult(result, width) {
  const columns = detectPageColumns(result.blocks, width);

  if (columns.length < 2) return extractText(result.blocks);

  return columns
    .map((column) => extractText(result.blocks, { column }).trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Cuts an open spread into its two pages at the gutter, and turns a sideways
 * page upright on the way.
 *
 * Both are settled from one reduced-size probe. Measured on a real scanner PDF:
 * a sideways page scored 36 confidence with 8% of its words solid, against 94
 * and 98% for the upright page beside it. And reading a spread whole runs
 * Tesseract's line segmentation straight across the gutter — filtering the
 * words by column afterwards recovers them but leaves the two pages
 * interleaved and out of order (83% solid, unreadable), where cutting the
 * image first gives 88% and 93% in correct reading order.
 *
 * Only for sources that skip the crop screen; a photographed page has already
 * been turned upright and cropped to one page by hand.
 */
async function preparePage(worker, canvas) {
  const probe = await detectOrientation(worker, canvas);

  let upright = canvas;
  if (probe.turns) {
    upright = rotateCanvas(canvas, probe.turns);
    release(canvas);
  }

  const columns = detectPageColumns(probe.blocks, probe.width);
  const cut = spreadCut(columns, upright.width, probe.width);
  if (cut === null) return [upright];

  const halves = [
    [0, cut],
    [cut, upright.width],
  ].map(([x0, x1]) => {
    const half = document.createElement("canvas");
    half.width = x1 - x0;
    half.height = upright.height;
    half.getContext("2d").drawImage(upright, -x0, 0);
    return half;
  });

  release(upright);
  return halves;
}

async function recognizeImage(worker, raw) {
  const cleaned = binarizeCanvas(raw);

  try {
    const cleanedResult = (await worker.recognize(cleaned, RECOGNIZE_OPTIONS, WORD_OUTPUT)).data;
    if (cleanedResult.confidence >= LOW_CONFIDENCE) {
      return textFromResult(cleanedResult, raw.width);
    }

    const rawResult = (await worker.recognize(raw, RECOGNIZE_OPTIONS, WORD_OUTPUT)).data;
    const better = rawResult.confidence > cleanedResult.confidence ? rawResult : cleanedResult;
    return textFromResult(better, raw.width);
  } finally {
    release(cleaned);
  }
}

async function recognizePage(worker, file, prepare) {
  const loaded = await loadCanvas(file);
  const images = prepare ? await preparePage(worker, loaded) : [loaded];
  const texts = [];

  try {
    for (const image of images) texts.push((await recognizeImage(worker, image)).trim());
  } finally {
    for (const image of images) release(image);
  }

  return texts.filter(Boolean).join("\n\n");
}

// Runs OCR over each page image in order and joins the recognized text,
// so a multi-page scan becomes one continuous book text.
export async function scanPages(images, onProgress) {
  return scanPageStream(
    (async function* () {
      for (let i = 0; i < images.length; i += 1) yield { image: images[i], number: i + 1, total: images.length };
    })(),
    onProgress
  );
}

/**
 * Same, but driven by a stream of pages. A scanned book runs to hundreds of
 * pages, and materializing them all as canvases first would exhaust a phone,
 * so the source stays in control of producing one at a time.
 *
 * `preparePages` turns each page upright and splits an open spread before
 * recognition — for sources that skip the crop screen, where neither has
 * happened yet. It costs one extra reduced-size pass per page, three more when
 * the page really is sideways.
 */
export async function scanPageStream(pages, onProgress, { preparePages = false } = {}) {
  const worker = await getWorker();
  const pageTexts = [];

  for await (const { image, number, total } of pages) {
    onProgress?.(number, total);
    const text = await recognizePage(worker, image, preparePages);
    pageTexts.push(dehyphenate(text).trim());
  }

  return pageTexts.filter(Boolean).join("\n\n");
}
