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
