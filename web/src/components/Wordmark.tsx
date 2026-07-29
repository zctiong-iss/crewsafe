import "./Wordmark.css";

/**
 * The product mark.
 *
 * The glyph is a WBGT band scale stacked into a square — four rungs running from safe to
 * extreme, the reading the whole product exists to act on. It is the one decorative
 * element in the app, and it is decorative only in the sense that it is small: the
 * gradient is the real risk scale from tokens.css, not an arbitrary brand colour.
 */
export function Wordmark({ tone = "light" }: { tone?: "light" | "dark" }) {
  return (
    <div className={`wordmark wordmark--${tone}`}>
      <span className="wordmark__glyph" aria-hidden="true">
        <span className="wordmark__rung wordmark__rung--low" />
        <span className="wordmark__rung wordmark__rung--moderate" />
        <span className="wordmark__rung wordmark__rung--high" />
        <span className="wordmark__rung wordmark__rung--extreme" />
      </span>
      <span className="wordmark__text">
        <strong className="wordmark__name">CrewSafe SG</strong>
        <span className="wordmark__tagline">Heat safety operations</span>
      </span>
    </div>
  );
}
