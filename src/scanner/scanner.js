import { createWorker } from "tesseract.js";

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

// Undoes the most common OCR artifact: a word split by a line-break hyphen
// (e.g. "informa-\ntion") comes out as two separate tokens otherwise, which
// breaks the one-word-at-a-time reader.
function cleanOcrText(text) {
  return text.replace(/(\w)-\n(\w)/g, "$1$2");
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

// Plain phone photos (no perspective correction, uneven lighting) recognize
// noticeably worse than scanner-app output. Converting to grayscale and
// stretching contrast around the midpoint gives Tesseract a cleaner,
// more binary-looking image to work with and measurably helps accuracy.
async function preprocessImage(file) {
  // "from-image" applies the EXIF rotation. Without it, portrait photos reach
  // Tesseract sideways, where text is essentially unrecognizable.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitDimensions(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const contrast = 1.4;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const stretched = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Runs OCR over each page image in order and joins the recognized text,
// so a multi-page scan becomes one continuous book text.
export async function scanPages(files, onProgress) {
  const worker = await getWorker();
  const pageTexts = [];

  for (let i = 0; i < files.length; i += 1) {
    onProgress?.(i + 1, files.length);
    const canvas = await preprocessImage(files[i]);
    const { data } = await worker.recognize(canvas);
    pageTexts.push(cleanOcrText(data.text).trim());
  }

  return pageTexts.join("\n\n");
}
