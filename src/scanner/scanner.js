import { createWorker } from "tesseract.js";
import { toGrayscale, adaptiveThreshold, grayToRgba } from "./binarize.js";
import { extractText, dehyphenate } from "./extract.js";

// Worker + wasm core are self-hosted (see public/tesseract) instead of the
// default jsDelivr CDN, so scanning also works when the app is opened over
// plain http on the local network where CORS/mixed content can be an issue.
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("deu+eng", undefined, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/tesseract-core-simd-lstm.wasm.js",
    }).catch((error) => {
      // Don't keep a rejected promise cached — otherwise every later scan
      // fails instantly until the page is reloaded.
      workerPromise = null;
      throw error;
    });
  }
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

async function recognizePage(worker, file) {
  const raw = await loadCanvas(file);
  const cleaned = binarizeCanvas(raw);

  try {
    const cleanedResult = (await worker.recognize(cleaned, RECOGNIZE_OPTIONS, WORD_OUTPUT)).data;
    if (cleanedResult.confidence >= LOW_CONFIDENCE) {
      return extractText(cleanedResult.blocks);
    }

    const rawResult = (await worker.recognize(raw, RECOGNIZE_OPTIONS, WORD_OUTPUT)).data;
    const better = rawResult.confidence > cleanedResult.confidence ? rawResult : cleanedResult;
    return extractText(better.blocks);
  } finally {
    release(cleaned);
    release(raw);
  }
}

// Runs OCR over each page image in order and joins the recognized text,
// so a multi-page scan becomes one continuous book text.
export async function scanPages(files, onProgress) {
  const worker = await getWorker();
  const pageTexts = [];

  for (let i = 0; i < files.length; i += 1) {
    onProgress?.(i + 1, files.length);
    const text = await recognizePage(worker, files[i]);
    pageTexts.push(dehyphenate(text).trim());
  }

  return pageTexts.join("\n\n");
}
