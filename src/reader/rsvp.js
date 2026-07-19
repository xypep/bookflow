// How many leading letters to embolden so the eye can complete the word from
// its opening rather than reading every letter. Short words take a single
// letter — emboldening half of a three-letter word emphasises nothing.
export function getBionicLength(word) {
  const length = word.length;
  if (length <= 1) return length;
  if (length <= 3) return 1;
  // Leaves the tail visibly lighter at every length; a straight half would
  // make long words almost entirely bold.
  return Math.min(Math.round(length * 0.4), length - 1);
}

// Optimal Recognition Point: the letter index the eye should fixate on,
// so the word can be read without moving the eye left-to-right.
export function getOrpIndex(word) {
  const length = word.length;
  if (length <= 1) return 0;
  if (length <= 4) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
}
