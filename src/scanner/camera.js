// Live capture with a framing guide. Most OCR failures on photographed pages
// trace back to how the shot was framed — page edges, the facing page and the
// surrounding table all end up as invented words — so it is worth steering the
// shot rather than repairing it afterwards.

// getUserMedia is only exposed in a secure context, which rules out the plain
// http origin used when testing over the local network.
export function isCameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

const CAPTURE_TYPE = "image/jpeg";
const CAPTURE_QUALITY = 0.95;

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "camera-overlay";
  overlay.innerHTML = `
    <video class="camera-video" playsinline muted autoplay></video>
    <div class="camera-guide">
      <span class="camera-corner top-left"></span>
      <span class="camera-corner top-right"></span>
      <span class="camera-corner bottom-left"></span>
      <span class="camera-corner bottom-right"></span>
    </div>
    <p class="camera-hint">Fill the frame with the text block only — no page edges</p>
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

  try {
    await video.play();

    return await new Promise((resolve) => {
      overlay.querySelector(".camera-cancel").addEventListener("click", () => resolve(null));
      overlay.querySelector(".camera-pick").addEventListener("click", () => resolve("files"));
      overlay.querySelector(".camera-shutter").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        resolve(await grabFrame(video));
      });
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    overlay.remove();
  }
}
