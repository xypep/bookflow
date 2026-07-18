// Image cleanup for OCR, kept free of any canvas/DOM access so the algorithm
// can be exercised directly on pixel arrays.

export function toGrayscale(rgba, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    gray[p] = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
  }
  return gray;
}

function buildIntegral(gray, width, height) {
  // One extra row/column of zeros so the area lookup below needs no bounds
  // checks. Values stay well inside uint32: 255 * 2400 * 1800 ≈ 1.1e9.
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
    }
  }
  return integral;
}

// Bradley-Roth adaptive threshold: each pixel is compared against the mean of
// its own neighbourhood rather than one global cutoff. A photographed page
// almost always has a lighting gradient or a shadow along the spine, and a
// global threshold turns the darker half into a solid block. This keeps thin
// strokes of unusual typefaces intact, which a contrast stretch tends to eat.
export function adaptiveThreshold(gray, width, height, { windowSize, tolerance = 0.15 } = {}) {
  const integral = buildIntegral(gray, width, height);
  const stride = width + 1;
  const size = windowSize || Math.max(16, Math.round(width / 16));
  const half = size >> 1;
  const out = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    const y1 = Math.max(0, y - half);
    const y2 = Math.min(height - 1, y + half);

    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - half);
      const x2 = Math.min(width - 1, x + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);

      const sum =
        integral[(y2 + 1) * stride + (x2 + 1)] -
        integral[y1 * stride + (x2 + 1)] -
        integral[(y2 + 1) * stride + x1] +
        integral[y1 * stride + x1];

      const index = y * width + x;
      out[index] = gray[index] * count <= sum * (1 - tolerance) ? 0 : 255;
    }
  }
  return out;
}

export function grayToRgba(gray, rgba) {
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    rgba[i] = gray[p];
    rgba[i + 1] = gray[p];
    rgba[i + 2] = gray[p];
    rgba[i + 3] = 255;
  }
  return rgba;
}
