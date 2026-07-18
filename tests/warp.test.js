import test from "node:test";
import assert from "node:assert/strict";

import { solveHomography, project, warpQuadToRect, rectSizeForQuad } from "../src/scanner/warp.js";

const point = (x, y) => ({ x, y });
const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} !== ${expected}`);

const UNIT = [point(0, 0), point(1, 0), point(1, 1), point(0, 1)];

test("an unchanged mapping is the identity", () => {
  const h = solveHomography(UNIT, UNIT);
  const result = project(h, 0.25, 0.75);

  close(result.x, 0.25);
  close(result.y, 0.75);
});

test("a pure scale is recovered", () => {
  const scaled = [point(0, 0), point(10, 0), point(10, 20), point(0, 20)];
  const h = solveHomography(UNIT, scaled);
  const result = project(h, 0.5, 0.5);

  close(result.x, 5);
  close(result.y, 10);
});

test("a translation is recovered", () => {
  const moved = UNIT.map(({ x, y }) => point(x + 7, y - 3));
  const h = solveHomography(UNIT, moved);
  const result = project(h, 0, 0);

  close(result.x, 7);
  close(result.y, -3);
});

test("every corner lands exactly on its counterpart", () => {
  // A trapezoid, as produced by shooting a page at an angle.
  const trapezoid = [point(20, 10), point(180, 30), point(200, 260), point(5, 240)];
  const h = solveHomography(UNIT, trapezoid);

  UNIT.forEach((corner, index) => {
    const result = project(h, corner.x, corner.y);
    close(result.x, trapezoid[index].x, 1e-6);
    close(result.y, trapezoid[index].y, 1e-6);
  });
});

test("a perspective mapping is not merely affine", () => {
  // With converging sides, the centre of the quad is not the average of its
  // corners — that difference is exactly what the correction undoes.
  const trapezoid = [point(0, 0), point(100, 0), point(80, 100), point(20, 100)];
  const h = solveHomography(UNIT, trapezoid);
  const centre = project(h, 0.5, 0.5);

  assert.notEqual(centre.x, 50);
  close(centre.x, 50, 1);
  assert.ok(centre.y > 50, "the vanishing side should push the centre down");
});

test("collinear corners are rejected rather than producing nonsense", () => {
  const degenerate = [point(0, 0), point(1, 1), point(2, 2), point(3, 3)];

  assert.throws(() => solveHomography(UNIT, degenerate), /Degenerate/);
});

// A 4x4 image split into four solid quadrants, used to check that warping
// moves pixels where they belong.
function quadrantImage() {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const value = x < 2 ? (y < 2 ? 0 : 85) : y < 2 ? 170 : 255;
      const index = (y * 4 + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return data;
}

test("warping the full frame to its own size preserves the image", () => {
  const source = quadrantImage();
  const quad = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
  const result = warpQuadToRect(source, 4, 4, quad, 4, 4);

  assert.deepEqual([...result], [...source]);
});

test("warping a sub-quad crops to it", () => {
  const source = quadrantImage();
  // The bottom-right quadrant only, which is solid 255.
  const quad = [point(2, 2), point(4, 2), point(4, 4), point(2, 4)];
  const result = warpQuadToRect(source, 4, 4, quad, 2, 2);

  assert.deepEqual([...result], Array.from({ length: 2 * 2 * 4 }, () => 255));
});

test("warping enlarges when the output is bigger than the quad", () => {
  const source = quadrantImage();
  const quad = [point(0, 0), point(2, 0), point(2, 2), point(0, 2)];
  const result = warpQuadToRect(source, 4, 4, quad, 4, 4);
  const pixel = (x, y) => result[(y * 4 + x) * 4];

  assert.equal(result.length, 4 * 4 * 4);
  // The top-left quadrant is solid 0, so an upscale of its interior stays 0.
  // The outermost samples sit close enough to the quad's edge that bilinear
  // interpolation reaches the neighbouring quadrant, which is ordinary
  // resampling behaviour rather than a leak.
  assert.equal(pixel(0, 0), 0);
  assert.equal(pixel(1, 1), 0);
  assert.equal(pixel(2, 2), 0);
});

test("output stays fully opaque", () => {
  const source = quadrantImage();
  const quad = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
  const result = warpQuadToRect(source, 4, 4, quad, 3, 3);

  for (let i = 3; i < result.length; i += 4) assert.equal(result[i], 255);
});

test("a rectangle keeps its own proportions", () => {
  const quad = [point(0, 0), point(200, 0), point(200, 100), point(0, 100)];

  assert.deepEqual(rectSizeForQuad(quad), { width: 200, height: 100 });
});

test("opposite sides are averaged for a skewed quad", () => {
  // Top edge 100 wide, bottom edge 200: the result splits the difference.
  const quad = [point(50, 0), point(150, 0), point(200, 100), point(0, 100)];
  const size = rectSizeForQuad(quad);

  assert.equal(size.width, 150);
});

test("the output size is capped", () => {
  const quad = [point(0, 0), point(8000, 0), point(8000, 4000), point(0, 4000)];
  const size = rectSizeForQuad(quad, 2400);

  assert.equal(size.width, 2400);
  assert.equal(size.height, 1200);
});

test("a degenerate quad still yields a usable size", () => {
  const quad = [point(0, 0), point(0, 0), point(0, 0), point(0, 0)];

  assert.deepEqual(rectSizeForQuad(quad, 2400), { width: 1, height: 1 });
});
