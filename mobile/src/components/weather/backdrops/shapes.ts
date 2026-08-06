/**
 * Small compositions built out of motes.
 *
 * A cloud is not one shape. Drawn as a single rounded rectangle it reads as a UI panel that
 * has drifted onto the card — which is exactly what the first pass looked like on device —
 * so a cloud here is three overlapping circles sharing one motion, the way a cloud is drawn
 * by hand.
 *
 * These are helpers, not a second layer of abstraction: they return plain `BackdropMote[]`
 * and the registry stays a list of motes. Anything a helper produces could have been typed
 * out by hand, which is what keeps `registry.ts` swappable — nothing here has to be
 * understood to replace a backdrop.
 *
 * @author Justin Chua
 */
import type { BackdropMote, MoteMotion } from "./types";

interface CloudOptions {
  /** Centre, percent of card. */
  x: number;
  y: number;
  /** Overall width, percent of card width. */
  size: number;
  color?: string;
  opacity: number;
  motion?: MoteMotion;
  duration?: number;
  delay?: number;
}

/**
 * Three overlapping circles: a tall one in the middle, two lower and wider at the sides.
 *
 * Each puff is a separate mote with the same motion and delay, so they travel as one. They
 * overlap, which the contrast test accounts for by compositing every mote covering a point
 * — a cloud is therefore priced at its true opacity where the puffs stack, not at one puff's.
 */
export function cloud({
  x,
  y,
  size,
  color = "#FFFFFF",
  opacity,
  motion = "drift",
  duration = 9000,
  delay = 0,
}: CloudOptions): BackdropMote[] {
  const shared = { color, opacity, motion, duration, delay, rounding: 0.5 };
  return [
    { ...shared, x: x - size * 0.28, y: y + size * 0.06, size: size * 0.5, aspect: 1 },
    { ...shared, x, y: y - size * 0.05, size: size * 0.62, aspect: 1 },
    { ...shared, x: x + size * 0.3, y: y + size * 0.08, size: size * 0.46, aspect: 1 },
  ];
}

interface RainOptions {
  /** Percent-of-card x positions, one drop each. */
  columns: number[];
  /** Where the drops sit when still. Varied per drop so a stopped frame is not a row. */
  rows: number[];
  color: string;
  opacity: number;
  /** Drop width, percent of card width. Thin — a fat drop reads as a grey bar. */
  size?: number;
  /** Length as a multiple of width. */
  aspect?: number;
  /** Fall time in ms, cycled across the drops so they do not descend in lockstep. */
  durations: number[];
}

/**
 * A field of drops.
 *
 * The still frame matters more than the falling one here, because Reduce Motion defaults to
 * on: with every drop parked at the same height it reads as a row of dashes, so `rows`
 * scatters them.
 */
export function rain({
  columns,
  rows,
  color,
  opacity,
  size = 1.1,
  aspect = 6,
  durations,
}: RainOptions): BackdropMote[] {
  return columns.map((x, index) => ({
    x,
    y: rows[index % rows.length],
    size,
    aspect,
    rounding: 0.5,
    color,
    // Alternating slightly, so the field has depth instead of reading as one flat screen.
    opacity: index % 3 === 0 ? opacity : opacity * 0.8,
    motion: "fall" as const,
    duration: durations[index % durations.length],
    delay: index * 220,
  }));
}
