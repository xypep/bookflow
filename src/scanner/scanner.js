import { createWorker } from "tesseract.js";
import { toGrayscale, adaptiveThreshold, grayToRgba } from "./binarize.js";
import { extractText, dehyphenate } from "./extract.js";
import { detectPageColumns } from "./pageDetection.js";
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

// A document scanner treats an open book as one sheet, so a spread arrives as
// a single image. Reading it as one page would run lines across the gutter and
// interleave the two; splitting on the detected columns keeps them apart and
// in reading order.
function textFromResult(result, width) {
  const columns = detectPageColumns(result.blocks, width);

  if (columns.length < 2) return extractText(result.blocks);

  return columns
    .map((column) => extractText(result.blocks, { column }).trim())
    .filter(Boolean)
    .join("\n\n");
}

async function recognizePage(worker, file) {
  const raw = await loadCanvas(file);
  const cleaned = binarizeCanvas(raw);
  const { width } = raw;

  try {
    const cleanedResult = (await worker.recognize(cleaned, RECOGNIZE_OPTIONS, WORD_OUTPUT)).data;
    if (cleanedResult.confidence >= LOW_CONFIDENCE) {
      return textFromResult(cleanedResult, width);
    }

    const rawResult = (await worker.recognize(raw, RECOGNIZE_OPTIONS, WORD_OUTPUT)).data;
    const better = rawResult.confidence > cleanedResult.confidence ? rawResult : cleanedResult;
    return textFromResult(better, width);
  } finally {
    release(cleaned);
    release(raw);
  }
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
 */
export async function scanPageStream(pages, onProgress) {
  const worker = await getWorker();
  const pageTexts = [];

  for await (const { image, number, total } of pages) {
    onProgress?.(number, total);
    const text = await recognizePage(worker, image);
    pageTexts.push(dehyphenate(text).trim());
  }

  return pageTexts.filter(Boolean).join("\n\n");
}
