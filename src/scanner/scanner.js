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

// Plain phone photos (no perspective correction, uneven lighting) recognize
// noticeably worse than scanner-app output. Converting to grayscale and
// stretching contrast around the midpoint gives Tesseract a cleaner,
// more binary-looking image to work with and measurably helps accuracy.
async function preprocessImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

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
