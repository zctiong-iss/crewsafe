/**
 * The shape a weather backdrop is described in (SCRUM-209 Part 3).
 *
 * A backdrop is *data*, not a component. That is the whole point of the ticket: replacing
 * one condition's atmosphere is editing an entry in `registry.ts`, not writing a component
 * and wiring it into a switch. `WeatherBackdrop` is the only thing that knows how to draw
 * these, and it does not know what any particular condition looks like.
 *
 * The same reasoning as `WeatherIcon`'s swap note, one layer out: when designed Lottie
 * artwork is eventually commissioned, a spec is replaced by an asset reference in the same
 * registry, and nothing above it changes.
 */

/**
 * How one mote moves when motion is allowed.
 *
 * Named for what it depicts rather than the transform it uses, so the registry reads as a
 * description of weather and not as a list of translations.
 */
export type MoteMotion =
  /** Straight down, and repeats from the top. Rain. */
  | "fall"
  /** Slow horizontal travel. Cloud. */
  | "drift"
  /** Side to side without leaving. Wind through something rooted. */
  | "sway"
  /** Slow scale-and-fade in place. Sun, haze. */
  | "pulse"
  /** Held dim, then a sharp double blink. Lightning. */
  | "flash"
  /** Present in every state, animated in none. Fixed scenery. */
  | "none";

/**
 * One shape in a backdrop.
 *
 * Geometry is in percentages of the card, never in points, because the hero card's height
 * changes with the font scale — it grows by more than half at 1.5x — and a backdrop laid
 * out in points would detach from it at exactly the accessibility setting that most needs
 * the card to look intact.
 */
export interface BackdropMote {
  /** Centre, as a percentage of card width and height. May sit outside 0–100. */
  x: number;
  y: number;
  /** Width as a percentage of card width. */
  size: number;
  /**
   * Height as a multiple of width. 1 is a circle; below 1 a horizontal streak; above 1 a
   * vertical one, which is what a raindrop is.
   */
  aspect?: number;
  /** Illustration colour. Deliberately literal — see the note in `registry.ts`. */
  color: string;
  /**
   * Alpha. Every value here is part of the contrast budget the backdrop must stay inside,
   * and `backdropContrast.test.ts` is what enforces that rather than a reviewer's eye.
   */
  opacity: number;
  motion: MoteMotion;
  /** Loop length in ms. Ignored for `none`. */
  duration?: number;
  /** Start offset in ms. Rain that falls in lockstep reads as a grid, not as rain. */
  delay?: number;
  /** Corner rounding as a fraction of the smaller side. 0.5 is a full ellipse. */
  rounding?: number;
}

/**
 * A whole condition's atmosphere.
 *
 * `tint` and `tintOpacity` are the still state on their own: with Reduce Motion on — which
 * SCRUM-199 makes the default, so it is the *common* case, not the exception — the wash and
 * every mote still render, just fixed. The card looks designed rather than merely
 * unanimated, which is what makes the still the feature and the movement the enhancement.
 */
export interface BackdropSpec {
  /** Wash laid over the card surface, beneath every mote. */
  tint: string;
  tintOpacity: number;
  motes: BackdropMote[];
}
