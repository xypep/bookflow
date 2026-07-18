// Live capture with a framing guide. Most OCR failures on photographed pages
// trace back to how the shot was framed — page edges, the facing page and the
// surrounding table all end up as invented words — so it is worth steering the
// shot rather than repairing it afterwards.

import { getWorker } from "./scanner.js";
import { coverTransform, projectBox, significantBlocks, framingQuality } from "./detect.js";

// getUserMedia is only exposed in a secure context, which rules out the plain
// http origin used when testing over the local network.
export function isCameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

const CAPTURE_TYPE = "image/jpeg";
const CAPTURE_QUALITY = 0.95;

// Layout analysis is run on a heavily reduced frame — it only has to locate
// text, not read it, and this keeps the preview responsive.
const DETECT_EDGE = 800;
const DETECT_PAUSE = 250;

// Only layout is requested. Any output that needs actual recognition would
// pull in the expensive pass and make the preview unusable.
const DETECT_OUTPUT = { text: false, blocks: false, layoutBlocks: true };

const QUALITY_HINTS = {
  none: "Point the camera at a page",
  small: "Move closer — the text should fill the frame",
  cluttered: "Page edges are in shot — frame the text block alone",
  good: "Looks good — hold steady and shoot",
};

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "camera-overlay";
  overlay.innerHTML = `
    <video class="camera-video" playsinline muted autoplay></video>
    <canvas class="camera-boxes"></canvas>
    <p class="camera-hint">Point the camera at a page</p>
    <div class="camera-controls">
      <button type="button" class="camera-cancel">Cancel</button>
      <button type="button" class="camera-shutter" aria-label="Take picture"></button>
      <button type="button" class="camera-pick">Files</button>
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

function drawBoxes(canvas, boxes, quality) {
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

  ctx.strokeStyle = quality === "good" ? "#4ade80" : "#fbbf24";
  ctx.lineWidth = 3;
  ctx.setLineDash(quality === "good" ? [] : [10, 8]);

  for (const box of boxes) {
    ctx.strokeRect(box.left, box.top, box.width, box.height);
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

      const blocks = significantBlocks(data.layoutBlocks, frame.width, frame.height);
      const quality = framingQuality(blocks, frame.width, frame.height);
      const transform = coverTransform(frame.width, frame.height, canvas.clientWidth, canvas.clientHeight);

      drawBoxes(canvas, blocks.map(({ bbox }) => projectBox(bbox, transform)), quality);
      hint.textContent = QUALITY_HINTS[quality];

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
 * Opens the camera and resolves with the captured image.
 * Resolves with `null` if the user cancels, and with `"files"` if they ask to
 * pick an existing image instead.
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

    return await new Promise((resolve) => {
      overlay.querySelector(".camera-cancel").addEventListener("click", () => resolve(null));
      overlay.querySelector(".camera-pick").addEventListener("click", () => resolve("files"));
      overlay.querySelector(".camera-shutter").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        resolve(await grabFrame(video));
      });
    });
  } finally {
    running = false;
    stream.getTracks().forEach((track) => track.stop());
    overlay.remove();
  }
}
