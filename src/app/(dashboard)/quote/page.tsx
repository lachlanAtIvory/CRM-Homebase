/**
 * Quote Builder — the internal pricing calculator, embedded as-is.
 *
 * The tool lives at public/hq/quote-calculator.html as a self-contained
 * HTML file (own styles, fonts, and logic; assumptions persist to
 * localStorage). It's embedded rather than rewritten so the quoting maths
 * and layout stay byte-identical to the standalone version. To update it,
 * replace that file with the new export.
 *
 * Auth: middleware protects /hq/* like every other non-public path, so the
 * calculator (and its internal margins view) is only reachable logged in.
 */
export default function QuotePage() {
  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)]">
      <iframe
        src="/hq/quote-calculator.html"
        title="Agent Ivory Quote Builder"
        className="h-full w-full border-0"
      />
    </div>
  );
}
