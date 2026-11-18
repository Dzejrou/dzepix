// Part of a jump clip spent off the ground, as fractions of its length, from
// the lowest opaque row ("bottom") of each frame and the standing foot line:
// from half a frame before the feet first leave the foot line to half a
// frame after they are last above it, widened to at least MIN_AIR around its
// middle (long robes hide the feet). Null if the feet never lift.
const MIN_AIR = 0.45;

export function airborne(bottoms, foot) {
  const up = bottoms.map((b, i) => (b < foot - 3 ? i : -1)).filter((i) => i >= 0);
  if (!up.length) return null;
  const n = bottoms.length;
  let a = Math.max(0, up[0] - 0.5) / n, b = Math.min(n, up.at(-1) + 1.5) / n;
  if (b - a < MIN_AIR) {
    const mid = Math.min(1 - MIN_AIR / 2, Math.max(MIN_AIR / 2, (a + b) / 2));
    a = mid - MIN_AIR / 2; b = mid + MIN_AIR / 2;
  }
  return [a, b];
}
