/**
 * BB monogram — golf-inspired, minimal mark for headers and manifest.
 */

type BrandLogoProps = {
  className?: string;
  /** Accessible label; omit when decorative (parent link has text). */
  title?: string;
};

export function BrandLogo({ className = "h-8 w-8", title }: BrandLogoProps) {
  const decorative = !title;

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={decorative ? "img" : undefined}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        className="fill-fairway-700 stroke-fairway-600"
        strokeWidth="0.5"
      />
      <path
        d="M8.5 22.5V9.5h4.2c2.8 0 4.3 1.35 4.3 3.45 0 1.55-0.85 2.65-2.35 3.05L18.2 22.5h-3.1l-3.35-5.35H11.5v5.35H8.5zM11.5 14.2h2.9c1.15 0 1.75-0.5 1.75-1.35s-0.6-1.35-1.75-1.35H11.5v2.7z"
        className="fill-cream"
      />
      <path
        d="M17.5 22.5V9.5h4.2c2.8 0 4.3 1.35 4.3 3.45 0 1.55-0.85 2.65-2.35 3.05L27.2 22.5h-3.1l-3.35-5.35H20.5v5.35h-3zM20.5 14.2h2.9c1.15 0 1.75-0.5 1.75-1.35s-0.6-1.35-1.75-1.35H20.5v2.7z"
        className="fill-cream"
      />
      <circle cx="16" cy="5.5" r="1.25" className="fill-gold" />
    </svg>
  );
}
