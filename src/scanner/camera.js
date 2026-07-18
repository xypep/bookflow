// Live capture with a framing guide. Most OCR failures on photographed pages
// trace back to how the shot was framed — page edges, the facing page and the
// surrounding table all end up as invented words — so it is worth steering the
// shot rather than repairing it afterwards.

import { getWorker } from "./scanner.js";
import { coverTransform, projectBox, wordBoxes, readingQuality } from "./detect.js";

// getUserMedia is only exposed in a secure context, which rules out the plain
// http origin used when testing over the local network.
export function isCameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

const CAPTURE_TYPE = "image/jpeg";
const CAPTURE_QUALITY = 0.95;

// Word positions only exist once the text has actually been read, so the
// preview runs full recognition. That is the expensive pass, which is why the
// frame is reduced hard — enough to place words, not to archive them.
const DETECT_EDGE = 700;
const DETECT_PAUSE = 120;

// Word-level output; the rendered plain text is not needed here.
const DETECT_OUTPUT = { blocks: true, text: false };

// Confidence bands for the highlight colour, so it is visible at a glance
// which words are being read cleanly and which are guesses.
const SOLID_CONFIDENCE = 80;
const FAIR_CONFIDENCE = 60;

function wordColour(confidence) {
  if (confidence >= SOLID_CONFIDENCE) return "rgba(74, 222, 128, 0.45)";
  if (confidence >= FAIR_CONFIDENCE) return "rgba(251, 191, 36, 0.45)";
  return "rgba(248, 113, 113, 0.45)";
}

function qualityHint({ level, solid, total }) {
  if (level === "none") return "Point the camera at a page";
  return `${solid} of ${total} words read cleanly`;
}

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "camera-overlay";
  overlay.innerHTML = `
    <video class="camera-video" playsinline muted autoplay></video>
    <canvas class="camera-boxes"></canvas>
    <button type="button" class="camera-cancel" aria-label="Cancel scanning">&times;</button>
    <p class="camera-hint">Point the camera at a page</p>
    <p class="camera-count" hidden></p>
    <div class="camera-flash" hidden></div>
    <div class="camera-controls">
      <button type="button" class="camera-pick">Files</button>
      <button type="button" class="camera-shutter" aria-label="Take picture"></button>
      <button type="button" class="camera-done" disabled>Done</button>
    </div>
  `;
  return overlay;
}

function grabFrame(video) {
  const canvas = document.createElement("canvas");
  // videoWidth/Height is the sensor resolution being delivered, which is what
  // OCR should get — not the size the element happens to be displayed at.
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        resolve(blob);
      },
      CAPTURE_TYPE,
      CAPTURE_QUALITY
    );
  });
}

// Each recognized word gets its own wash, tinted by how sure the reading is.
function drawWords(canvas, words) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  for (const { box, confidence } of words) {
    ctx.fillStyle = wordColour(confidence);
    // Padded slightly so the wash reads as a highlighter stroke over the word
    // rather than a tight box around it.
    ctx.fillRect(box.left - 1, box.top - 1, box.width + 2, box.height + 2);
  }
}

function detectionFrame(video) {
  const scale = Math.min(1, DETECT_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Continuously reports where text is visible, so framing can be corrected
// before the shot rather than diagnosed afterwards. Failures are swallowed:
// the preview is an aid, and losing it must never block taking a picture.
async function trackTextBlocks(video, canvas, hint, isRunning) {
  let worker;
  try {
    worker = await getWorker();
  } catch {
    return;
  }

  while (isRunning()) {
    if (!video.videoWidth) {
      await wait(DETECT_PAUSE);
      continue;
    }

    try {
      const frame = detectionFrame(video);
      const { data } = await worker.recognize(frame, {}, DETECT_OUTPUT);
      if (!isRunning()) return;

      const words = wordBoxes(data.blocks);
      const transform = coverTransform(frame.width, frame.height, canvas.clientWidth, canvas.clientHeight);

      drawWords(
        canvas,
        words.map((word) => ({ box: projectBox(word.bbox, transform), confidence: word.confidence }))
      );
      hint.textContent = qualityHint(readingQuality(words));

      frame.width = 0;
      frame.height = 0;
    } catch {
      // A dropped frame is not worth reacting to; the next pass will retry.
    }

    await wait(DETECT_PAUSE);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opens the camera and keeps it open so pages can be shot one after another:
 * the point of scanning a book is not stopping after every page.
 *
 * Resolves with an array of captured images, with `null` if the user backs
 * out, and with `"files"` if they ask to pick existing images instead.
 */
export async function captureFromCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      // A page of body text needs the detail; the browser clamps this down to
      // whatever the camera actually supports.
      width: { ideal: 3840 },
      height: { ideal: 2160 },
    },
  });

  const overlay = buildOverlay();
  const video = overlay.querySelector(".camera-video");
  video.srcObject = stream;
  document.body.appendChild(overlay);

  let running = true;

  try {
    await video.play();
    trackTextBlocks(
      video,
      overlay.querySelector(".camera-boxes"),
      overlay.querySelector(".camera-hint"),
      () => running
    );

    const captured = [];
    const counter = overlay.querySelector(".camera-count");
    const done = overlay.querySelector(".camera-done");
    const flash = overlay.querySelector(".camera-flash");

    const showCount = () => {
      counter.hidden = captured.length === 0;
      counter.textContent = `${captured.length} page${captured.length === 1 ? "" : "s"} captured`;
      done.disabled = captured.length === 0;
    };

    // Brief blink so a capture is unmistakable without a preview interrupting
    // the run of shots.
    const blink = () => {
      flash.hidden = false;
      setTimeout(() => {
        flash.hidden = true;
      }, 90);
    };

    return await new Promise((resolve) => {
      overlay.querySelector(".camera-cancel").addEventListener("click", () => {
        const lost = captured.length;
        if (lost && !window.confirm(`Discard ${lost} captured page${lost === 1 ? "" : "s"}?`)) return;
        resolve(null);
      });

      overlay.querySelector(".camera-pick").addEventListener("click", () => resolve("files"));
      done.addEventListener("click", () => resolve(captured));

      overlay.querySelector(".camera-shutter").addEventListener("click", async (event) => {
        const shutter = event.currentTarget;
        // Only for the moment the frame is read; the camera stays live so the
        // next page can be shot straight away.
        shutter.disabled = true;
        const blob = await grabFrame(video);
        shutter.disabled = false;

        if (blob) {
          captured.push(blob);
          showCount();
          blink();
        }
      });
    });
  } finally {
    running = false;
    stream.getTracks().forEach((track) => track.stop());
    overlay.remove();
  }
}
