export type ImageSwipeDirection = -1 | 0 | 1;

const MIN_DISTANCE = 48;
const HORIZONTAL_RATIO = 1.25;

/**
 * Which way a finger moved the pictures: 1 is the next picture, -1 the one
 * before, 0 no swipe at all.
 *
 * ⚠️ **It follows the reading direction, because the pictures do.** The
 * content follows the finger, the way every phone gallery works: you drag the
 * picture in front of you away, and the one waiting on the far side slides in.
 * On an English page the next picture waits on the right, so a leftward drag
 * brings it. On an Arabic page the strip runs right to left — the thumbnails,
 * the dots and the "next" arrow all sit on the left — so the next picture
 * waits on the LEFT and a rightward drag brings it.
 *
 * The first version answered "left means next" in both scripts, which on the
 * Arabic page (the default) dragged the picture one way and showed the one
 * from the other side. The shop reported it as swiping backwards to every
 * other app on the phone, which is exactly what it was.
 */
export function imageSwipeDirection(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  rtl = false,
): ImageSwipeDirection {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (
    Math.abs(deltaX) < MIN_DISTANCE ||
    Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_RATIO
  ) {
    return 0;
  }
  const leftward: ImageSwipeDirection = deltaX < 0 ? 1 : -1;
  return rtl ? (-leftward as ImageSwipeDirection) : leftward;
}

/**
 * Which way an arrow key moves through the pictures, by the same rule: the
 * key that points at the next picture shows it. Null for any other key.
 */
export function arrowKeyDirection(key: string, rtl = false): ImageSwipeDirection | null {
  if (key !== "ArrowRight" && key !== "ArrowLeft") return null;
  const right: ImageSwipeDirection = key === "ArrowRight" ? 1 : -1;
  return rtl ? (-right as ImageSwipeDirection) : right;
}
