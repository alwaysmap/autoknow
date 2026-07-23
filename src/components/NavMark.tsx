// The AutoKnow app mark for the nav: JUST the hill curve — the app's signature
// progress visual — inked from `currentColor`. This is the GLYPH, not the app-ICON
// tile in `public/logo.svg`: that asset bakes in navy `#1F2A44` / off-white
// `#E8ECF4` for a favicon/PWA field, and a navy tile reads as a foreign object
// against the warm-stone (light) / roast-brown (dark) nav — design.md §8b forbids a
// hard-coded colour "including inside SVG". Stroked from `currentColor`, it inherits
// the nav's foreground and works in BOTH themes and BOTH styles, following §8c's
// "the app's OWN gauge" precedent (monochrome, takes the surrounding ink).
//
// The path and 512 viewBox are lifted unchanged from `public/logo.svg`; only the
// `<rect>` tile is dropped. `aria-hidden` keeps the brand link's accessible name
// exactly "AutoKnow" (the link's text) rather than doubling it.
export default function NavMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth={40}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M64 372 C 168 372, 178 200, 256 200 C 334 200, 344 372, 448 372" />
    </svg>
  );
}
