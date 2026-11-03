import { cn } from "@/lib/utils";

/** The NYATI logo supplied in public/ ("nyati logo.avif"); emblem = the circle without the wordmark. */
export const LOGO_SRC = "/nyati%20logo.avif";
export const LOGO_PNG = "/nyati-logo.png"; // for emails and PDFs (AVIF isn't supported there)
export const EMBLEM_SRC = "/nyati-emblem.png";
const LOGO_RATIO = 384 / 399; // width / height of the supplied artwork

/** Full logo (emblem + wordmark), true colours. `height` in px. */
export function Logo({ height = 48, className }: { height?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_SRC} alt="NYATI" width={Math.round(height * LOGO_RATIO)} height={height} className={className} />;
}

/**
 * The logo is blue on transparent with a white "N", so on dark surfaces it sits on a white tile
 * (inverting it to white would erase the N).
 */
export function LogoTile({ height = 48, emblemOnly, className }: { height?: number; emblemOnly?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center rounded-lg bg-white p-1.5 shadow-sm", className)}>
      {emblemOnly ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={EMBLEM_SRC} alt="NYATI" width={height} height={height} />
      ) : (
        <Logo height={height} />
      )}
    </span>
  );
}
