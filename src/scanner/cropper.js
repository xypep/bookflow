// Corner-drag crop. The captured photo is shown with four handles the user
// pulls onto the page corners; everything outside is discarded and the
// remaining quadrilateral is straightened into a rectangle.

import { warpQuadToRect, rectSizeForQuad } from "./warp.js";

// Matches the cap used elsewhere in the scanner: past this, Safari starts
// refusing to allocate the canvas.
const MAX_EDGE = 2400;

// Safari hands back a blank canvas past roughly 16.7 megapixels, which a photo
// straight from the library can exceed. Sampling from anything beyond this is
// wasted anyway, since the straightened result is capped at MAX_EDGE.
const MAX_SOURCE_EDGE = 4000;

const CORNER_LABELS = ["top-left", "top-right", "bottom-right", "bottom-left"];

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "cropper-overlay";
  overlay.innerHTML = `
    <div class="cropper-stage">
      <!-- The frame is sized to the drawn photo so handle coordinates and
           image coordinates are the same thing; positioning them against the
           stage instead leaves them offset by however far the photo is
           centred, which puts them out of reach off-screen. -->
      <div class="cropper-frame">
        <canvas class="cropper-canvas"></canvas>
        ${CORNER_LABELS.map(
          (label, index) => `<button type="button" class="cropper-handle" data-corner="${index}" aria-label="Move ${label} corner"></button>`
        ).join("")}
      </div>
    </div>
    <p class="cropper-hint">Drag the corners onto the page, then straighten</p>
    <div class="cropper-controls">
      <button type="button" class="cropper-cancel">Cancel</button>
      <button type="button" class="cropper-confirm">Straighten</button>
    </div>
  `;
  return overlay;
}

// Starts inset from the edges rather than at them, so every handle is
// immediately grabbable instead of sitting under the screen bezel.
function initialQuad(width, height) {
  const insetX = width * 0.08;
  const insetY = height * 0.08;
  return [
    { x: insetX, y: insetY },
    { x: width - insetX, y: insetY },
    { x: width - insetX, y: height - insetY },
    { x: insetX, y: height - insetY },
  ];
}

function drawGuides(ctx, quad) {
  ctx.beginPath();
  quad.forEach(({ x, y }, index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();

  ctx.strokeStyle = "#4ade80";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Shows the crop screen and resolves with the straightened page, or `null` if
 * cancelled.
 *
 * `detectedQuad` optionally pre-positions the handles, in the same coordinate
 * space as the image. Pass `null` to start from the default inset box — the
 * handles behave identically either way, so a missed or wrong detection costs
 * nothing beyond a drag. `position` labels which page of a batch this is.
 */
export function cropAndStraighten(imageBitmap, { detectedQuad = null, position = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = buildOverlay();
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector(".cropper-canvas");
    const stage = overlay.querySelector(".cropper-stage");
    const frame = overlay.querySelector(".cropper-frame");
    const handles = [...overlay.querySelectorAll(".cropper-handle")];

    // The photo is drawn at a size that fits the screen; the quad is tracked in
    // that same displayed space and only scaled back to sensor pixels when the
    // warp actually runs.
    const fit = Math.min(
      stage.clientWidth / imageBitmap.width,
      stage.clientHeight / imageBitmap.height,
      1
    );
    const shownWidth = Math.round(imageBitmap.width * fit);
    const shownHeight = Math.round(imageBitmap.height * fit);

    canvas.width = shownWidth;
    canvas.height = shownHeight;
    canvas.style.width = `${shownWidth}px`;
    canvas.style.height = `${shownHeight}px`;
    frame.style.width = `${shownWidth}px`;
    frame.style.height = `${shownHeight}px`;

    // Detected corners arrive in image coordinates and have to follow the same
    // scaling the photo does to reach the screen.
    const quad = detectedQuad
      ? detectedQuad.map(({ x, y }) => ({ x: x * fit, y: y * fit }))
      : initialQuad(shownWidth, shownHeight);

    overlay.querySelector(".cropper-hint").textContent = detectedQuad
      ? `Page detected${position} — adjust if needed, then straighten`
      : `Drag the corners onto the page${position}, then straighten`;

    const render = () => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, shownWidth, shownHeight);
      ctx.drawImage(imageBitmap, 0, 0, shownWidth, shownHeight);
      drawGuides(ctx, quad);

      quad.forEach(({ x, y }, index) => {
        handles[index].style.left = `${x}px`;
        handles[index].style.top = `${y}px`;
      });
    };

    const stageBox = () => canvas.getBoundingClientRect();

    const moveCorner = (index, clientX, clientY) => {
      const box = stageBox();
      quad[index] = {
        x: Math.min(shownWidth, Math.max(0, clientX - box.left)),
        y: Math.min(shownHeight, Math.max(0, clientY - box.top)),
      };
      render();
    };

    handles.forEach((handle, index) => {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", (event) => {
        if (!handle.hasPointerCapture(event.pointerId)) return;
        event.preventDefault();
        moveCorner(index, event.clientX, event.clientY);
      });
    });

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector(".cropper-cancel").addEventListener("click", () => finish(null));
    overlay.querySelector(".cropper-confirm").addEventListener("click", () => {
      finish(straighten(imageBitmap, quad, fit));
    });

    render();
  });
}

function straighten(imageBitmap, quad, fit) {
  const sourceScale = Math.min(
    1,
    MAX_SOURCE_EDGE / Math.max(imageBitmap.width, imageBitmap.height)
  );
  const sourceWidth = Math.round(imageBitmap.width * sourceScale);
  const sourceHeight = Math.round(imageBitmap.height * sourceScale);

  const source = document.createElement("canvas");
  source.width = sourceWidth;
  source.height = sourceHeight;

  const sourceCtx = source.getContext("2d");
  sourceCtx.drawImage(imageBitmap, 0, 0, sourceWidth, sourceHeight);
  const sourceData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight);

  // The quad was tracked on the displayed image; `fit` scales it back to the
  // captured photo and `sourceScale` on to the buffer actually being sampled.
  // Straightening from the full-detail photo rather than the preview is the
  // whole point, so both steps matter.
  const sourceQuad = quad.map(({ x, y }) => ({
    x: (x / fit) * sourceScale,
    y: (y / fit) * sourceScale,
  }));
  const { width, height } = rectSizeForQuad(sourceQuad, MAX_EDGE);

  const warped = warpQuadToRect(sourceData.data, sourceWidth, sourceHeight, sourceQuad, width, height);

  source.width = 0;
  source.height = 0;

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  output.getContext("2d").putImageData(new ImageData(warped, width, height), 0, 0);

  return output;
}
