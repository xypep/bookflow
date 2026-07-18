// Perspective correction. A page photographed by hand is a quadrilateral on
// the sensor, not a rectangle: held at any angle, the far edge is shorter than
// the near one and the text lines converge. Mapping the four page corners back
// onto a true rectangle undoes that, which is what lets a page inside a bound
// book read like a flat sheet.

/**
 * Solves the 3x3 projective transform taking the four `from` points onto the
 * four `to` points. Returns the eight free coefficients; the ninth is fixed at
 * 1 by convention.
 */
export function solveHomography(from, to) {
  // Each correspondence contributes two rows:
  //   h0*x + h1*y + h2 - h6*x*u - h7*y*u = u
  //   h3*x + h4*y + h5 - h6*x*v - h7*y*v = v
  const matrix = [];
  const rhs = [];

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];

    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    rhs.push(v);
  }

  return solveLinearSystem(matrix, rhs);
}

// Gauss-Jordan with partial pivoting. The system is only 8x8, so clarity beats
// any cleverness here.
function solveLinearSystem(matrix, rhs) {
  const size = rhs.length;
  const rows = matrix.map((row, i) => [...row, rhs[i]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }

    if (Math.abs(rows[pivot][column]) < 1e-12) {
      throw new Error("Degenerate quadrilateral: corners are collinear or coincident");
    }

    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];

    const divisor = rows[column][column];
    for (let i = column; i <= size; i += 1) rows[column][i] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (!factor) continue;
      for (let i = column; i <= size; i += 1) rows[row][i] -= factor * rows[column][i];
    }
  }

  return rows.map((row) => row[size]);
}

export function project(h, x, y) {
  const denominator = h[6] * x + h[7] * y + 1;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / denominator,
    y: (h[3] * x + h[4] * y + h[5]) / denominator,
  };
}

function sampleBilinear(source, width, height, x, y, target, targetIndex) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  for (let channel = 0; channel < 4; channel += 1) {
    let total = 0;
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        // Clamp at the border so sampling just outside the quad repeats the
        // edge pixel rather than wrapping or reading zeroes.
        const sx = Math.min(width - 1, Math.max(0, x0 + dx));
        const sy = Math.min(height - 1, Math.max(0, y0 + dy));
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
        total += source[(sy * width + sx) * 4 + channel] * weight;
      }
    }
    target[targetIndex + channel] = total;
  }
}

/**
 * Maps `quad` — four source points ordered top-left, top-right, bottom-right,
 * bottom-left — onto a `outWidth` x `outHeight` rectangle.
 */
export function warpQuadToRect(source, sourceWidth, sourceHeight, quad, outWidth, outHeight) {
  // Solved from destination to source, so each output pixel can look up where
  // it came from directly and no inversion is needed.
  const corners = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];
  const h = solveHomography(corners, quad);
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const { x: sx, y: sy } = project(h, x + 0.5, y + 0.5);
      sampleBilinear(source, sourceWidth, sourceHeight, sx - 0.5, sy - 0.5, out, (y * outWidth + x) * 4);
    }
  }
  return out;
}

/**
 * Output size for a quad: each side is measured and opposite sides averaged,
 * so a page shot at an angle comes back at roughly its true proportions rather
 * than the squashed ones the camera saw.
 */
export function rectSizeForQuad(quad, maxEdge = Infinity) {
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;

  const width = (distance(topLeft, topRight) + distance(bottomLeft, bottomRight)) / 2;
  const height = (distance(topLeft, bottomLeft) + distance(topRight, bottomRight)) / 2;
  const scale = Math.min(1, maxEdge / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
