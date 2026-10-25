/** The brand mark: two arrows passing each other, for a trade between two people. */
export function LogoMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 9h12l-3.5-3.5" />
        <path d="M19 15H7l3.5 3.5" />
      </svg>
    </span>
  );
}
