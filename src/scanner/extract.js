// Rebuilds page text from Tesseract's word-level output instead of taking its
// plain-text rendering, so unreliable words can be dropped on the way.
//
// Photographing a book almost always catches more than the text block: the
// page edge, the curve towards the spine, the facing page. Tesseract reports
// those as words too, which is where the stray "SS", "DZ", "NG" columns down
// a margin come from. They differ from real text mainly in confidence.

// Deliberately low. These thresholds were set when page edges were still in
// frame and inventing words; cropping now removes that at the source, so the
// filter only has to catch outright rubbish.
//
// The bar matters more than it looks: a dropped word leaves no trace, so
// silently deleting real text is worse than passing through an obvious mangle
// the reader can see and fix. Measured on a real page, a floor of 60 removed
// "zwar", "schnell", "musste" and "Ihren" along with the noise.
const MIN_WORD_CONFIDENCE = 30;

// Very short tokens are the most common shape for edge noise, so they carry a
// slightly higher bar — but not so high that a confidently-read "es" or "in"
// gets thrown away with them.
const SHORT_WORD_LENGTH = 2;
const MIN_SHORT_WORD_CONFIDENCE = 50;

function isReliable(word, minConfidence, minShortConfidence) {
  const text = word.text.trim();
  if (!text) return false;

  const required = text.length <= SHORT_WORD_LENGTH ? minShortConfidence : minConfidence;
  return word.confidence >= required;
}

export function extractText(blocks, options = {}) {
  const minConfidence = options.minWordConfidence ?? MIN_WORD_CONFIDENCE;
  const minShortConfidence = options.minShortWordConfidence ?? MIN_SHORT_WORD_CONFIDENCE;
  const paragraphs = [];

  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      const lines = [];

      for (const line of paragraph.lines ?? []) {
        const words = (line.words ?? [])
          .filter((word) => isReliable(word, minConfidence, minShortConfidence))
          .map((word) => word.text.trim());

        if (words.length) lines.push(words.join(" "));
      }

      if (lines.length) paragraphs.push(lines.join("\n"));
    }
  }

  return paragraphs.join("\n\n");
}

// Rejoins words split by a line-break hyphen. Anything the confidence filter
// left behind between the hyphen and the break is tolerated, since margin
// noise regularly lands exactly there.
//
// Matching is on the Unicode letter property rather than \w, which covers only
// ASCII — German text breaks across umlauts often enough that leaving them out
// silently kept those words split.
export function dehyphenate(text) {
  return text.replace(/(\p{L})-[^\S\n]*\n[^\S\n]*(\p{L})/gu, "$1$2");
}
