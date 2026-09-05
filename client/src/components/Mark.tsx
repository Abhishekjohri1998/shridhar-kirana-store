/**
 * The wordmark's glyph: an open ledger with a rule line and a tick.
 *
 * Drawn rather than imported so it inherits `currentColor` and stays crisp at 26px on a phone and
 * 46px on the sign-in card. A shop that has kept a paper khata for thirty years should recognise
 * what this is before it reads the name next to it.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* The two leaves of an open book, meeting at the spine. */}
      <path d="M16 8.4C13.6 6.4 10.6 5.4 6.5 5.4A1.5 1.5 0 0 0 5 6.9v16.7a1.5 1.5 0 0 0 1.5 1.5c4.1 0 7.1 1 9.5 3 2.4-2 5.4-3 9.5-3a1.5 1.5 0 0 0 1.5-1.5V6.9a1.5 1.5 0 0 0-1.5-1.5c-4.1 0-7.1 1-9.5 3Z" />
      <path d="M16 8.4v19.7" />
      {/* A settled line, ticked. */}
      <path d="M8.8 12.6h4.1M8.8 17.1h4.1" strokeWidth="1.6" opacity="0.55" />
      <path d="M19.4 15.2l2.1 2.2 4-4.4" strokeWidth="1.9" />
    </svg>
  );
}
