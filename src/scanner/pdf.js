// Multi-page PDF input.
//
// Apple's document scanner already does the hard part — finding the page,
// correcting perspective, evening out the lighting — and saves the result as
// a PDF. That is a far better source than a handheld photo, and it arrives a
// whole chapter at a time, so these pages skip the crop step entirely and go
// straight to recognition.

// Rendered larger than a photo would be, because a document scanner captures
// an open book as one sheet: two pages then share the width, and at 2400 each
// gets far too few pixels per character. A PDF is a vector source, so the
// resolution is there for the asking.
const MAX_EDGE = 3400;

// Safari stops allocating canvases somewhere around 16.7 megapixels, and gets
// unhappy well before that on a phone, so the area is capped short of it.
const MAX_PIXELS = 10_000_000;

let pdfjsPromise = null;

// Loaded on demand: nobody who only pastes text should pay for the library.
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [lib, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })().catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

export function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
}

function renderToCanvas(page) {
  const unscaled = page.getViewport({ scale: 1 });

  // A PDF page is measured in points, so it has to be rendered well above 1:1
  // to give recognition enough pixels to work with.
  const scale = Math.min(
    MAX_EDGE / Math.max(unscaled.width, unscaled.height),
    Math.sqrt(MAX_PIXELS / (unscaled.width * unscaled.height))
  );
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);

  return {
    canvas,
    done: page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise,
  };
}

/**
 * Yields each page of the PDF as a rendered canvas.
 *
 * Being a generator is the point: it pauses at each page until recognition
 * asks for the next, so only one page is ever held. A scanned book runs to
 * hundreds of pages, and rendering them all up front would exhaust a phone
 * long before the end. Each canvas is released once the consumer moves on, so
 * it must not be kept past that.
 */
export async function* readPdfPages(file) {
  const pdfjs = await getPdfjs();
  // Teardown lives on the loading task rather than the document, and skipping
  // it leaves the pdf.js worker running after the import is done.
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const document_ = await loadingTask.promise;

  try {
    for (let number = 1; number <= document_.numPages; number += 1) {
      const page = await document_.getPage(number);
      const { canvas, done } = renderToCanvas(page);

      try {
        await done;
        yield { image: canvas, number, total: document_.numPages };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }
}
