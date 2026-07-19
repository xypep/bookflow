// Books have no artwork, so each one gets a cover derived from its title:
// the same title always produces the same colours, which is what makes the
// library recognizable at a glance rather than just decorative.

// FNV-1a. Small, and it spreads short similar titles ("Book 1" / "Book 2")
// across the hue circle instead of clustering them.
function hashTitle(title) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < title.length; i += 1) {
    hash ^= title.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function coverStyle(title) {
  const hash = hashTitle(title.trim().toLowerCase());
  const hue = hash % 360;
  // A second hue close by keeps the gradient a shade of one colour rather
  // than a rainbow, and the offset direction varies so covers don't all lean
  // the same way.
  const drift = 25 + (hash % 30);
  const second = (hue + (hash & 1 ? drift : -drift) + 360) % 360;
  const tilt = 135 + ((hash >> 3) % 90);

  return `--cover-a: hsl(${hue} 52% 32%); --cover-b: hsl(${second} 58% 18%); --cover-tilt: ${tilt}deg;`;
}

// The spine sits a fixed distance from the left edge on every cover, so a
// shelf of them lines up the way real books do.
export function coverInitials(title) {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
