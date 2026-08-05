/** The Agent Farm mark, per docs/brand-agent-farm.md's simplified spec:
 *  a single barn silhouette with one square window, THREE compute lanes,
 *  THREE connection nodes, no trees. Drawn in currentColor so it works
 *  monochrome anywhere; wrap in a gradient-text container for the brand
 *  gradient variant.
 *
 *  Geometry notes (reference board, image 82): the barn owns the upper
 *  right at ~55% of the canvas with a gambrel roof; the lanes fan wide
 *  across the full lower half so the mark reads as fields, not whiskers. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={className}
      role="img"
    >
      {/* gambrel barn silhouette, one window knocked out */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M25 20 31 12h12l6 8 3 4v14H22V24l3-4Zm9 6h9v9h-9v-9Z"
        fill="currentColor"
      />
      {/* three compute lanes fanning across the lower half */}
      <path
        d="M56 44c-18-2-36 0-48 7"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M52 51c-14-1-27 1.5-36 6.5"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M46 58c-9-.5-17 1-23 4"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* three connection nodes at the lane tips */}
      <circle cx="6" cy="52" r="3.5" fill="currentColor" />
      <circle cx="13.5" cy="58.5" r="3.5" fill="currentColor" />
      <circle cx="21" cy="62.5" r="3" fill="currentColor" />
    </svg>
  );
}
