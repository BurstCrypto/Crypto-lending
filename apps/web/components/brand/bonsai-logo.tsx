type BonsaiLogoProps = {
  /** Rendered pixel size (width and height). Defaults to 1em so it scales with font size. */
  size?: number | string;
  className?: string;
  /**
   * Accessible label. When provided the SVG is exposed as an image with this title;
   * when omitted the SVG is decorative (aria-hidden) and should sit next to a text label.
   */
  title?: string;
};

/**
 * Bonsai Lending brand mark: a stylised bonsai — a bent trunk rising into three
 * rounded foliage canopies above a shallow pot. Drawn in `currentColor` so it
 * inherits the surrounding text color (near-black on the mint brand chip, mint
 * when standing alone).
 */
export function BonsaiLogo({ size = '1em', className, title }: BonsaiLogoProps) {
  const decorative = title === undefined;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      {!decorative ? <title>{title}</title> : null}

      {/* Foliage canopies */}
      <circle cx="10.5" cy="9.5" r="5" fill="currentColor" />
      <circle cx="20" cy="7.5" r="5.5" fill="currentColor" />
      <circle cx="23" cy="14" r="4.5" fill="currentColor" />

      {/* Bent trunk rising from the pot into the canopy */}
      <path
        d="M16 26 C16 21 12.5 19 13 14.5 C13.4 11 16.5 10 19 9.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* A branch reaching to the right canopy */}
      <path
        d="M14.4 16.5 C17 15.5 20 15 22.5 14.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* Shallow pot */}
      <path
        d="M9.5 25.5 L22.5 25.5 L20.5 29.5 L11.5 29.5 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default BonsaiLogo;
