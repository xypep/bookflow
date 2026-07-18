// Geometry for the live text-block overlay. Kept free of DOM access so the
// coordinate mapping — the part that is easy to get subtly wrong — can be
// tested directly.

// Blocks smaller than this share of the frame are speckle rather than text,
// and drawing them would just make the overlay twitch.
const MIN_BLOCK_AREA_RATIO = 0.005;

/**
 * The video fills its element with `object-fit: cover`: scaled up until both
 * axes are covered, then centre-cropped. Boxes measured on the analysed frame
 * have to follow that same transform to line up with what is on screen.
 */
export function coverTransform(sourceWidth, sourceHeight, displayWidth, displayHeight) {
  const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
  return {
    scale,
    offsetX: (displayWidth - sourceWidth * scale) / 2,
    offsetY: (displayHeight - sourceHeight * scale) / 2,
  };
}

export function projectBox(bbox, { scale, offsetX, offsetY }) {
  return {
    left: bbox.x0 * scale + offsetX,
    top: bbox.y0 * scale + offsetY,
    width: (bbox.x1 - bbox.x0) * scale,
    height: (bbox.y1 - bbox.y0) * scale,
  };
}

export function significantBlocks(blocks, sourceWidth, sourceHeight) {
  const frameArea = sourceWidth * sourceHeight;
  if (!frameArea) return [];

  return (blocks ?? []).filter(({ bbox }) => {
    if (!bbox) return false;
    const area = (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0);
    return area > 0 && area / frameArea >= MIN_BLOCK_AREA_RATIO;
  });
}

/**
 * Text framed well reads as one large block. Several scattered blocks usually
 * means page edges or the facing page are being picked up too, which is
 * exactly what degrades the scan.
 */
export function framingQuality(blocks, sourceWidth, sourceHeight) {
  if (!blocks.length) return "none";

  const frameArea = sourceWidth * sourceHeight;
  const largest = Math.max(
    ...blocks.map(({ bbox }) => (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0))
  );

  if (largest / frameArea < 0.15) return "small";
  return blocks.length <= 2 ? "good" : "cluttered";
}
