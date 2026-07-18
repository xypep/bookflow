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

// Runs OCR over each page image in order and joins the recognized text,
// so a multi-page scan becomes one continuous book text.
export async function scanPages(files, onProgress) {
  const worker = await getWorker();
  const pageTexts = [];

  for (let i = 0; i < files.length; i += 1) {
    onProgress?.(i + 1, files.length);
    const { data } = await worker.recognize(files[i]);
    pageTexts.push(cleanOcrText(data.text).trim());
  }

  return pageTexts.join("\n\n");
}
