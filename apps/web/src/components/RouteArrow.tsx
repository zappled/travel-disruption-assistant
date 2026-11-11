/**
 * The "→" between airport codes. In the signage font the arrow glyph sits
 * below the middle of the capitals, so it's nudged up (see .route-arrow).
 * Screen readers hear "to" instead of "right arrow".
 */
export function RouteArrow() {
  return (
    <>
      <span className="route-arrow" aria-hidden="true">
        →
      </span>
      <span className="sr-only">to</span>
    </>
  );
}
