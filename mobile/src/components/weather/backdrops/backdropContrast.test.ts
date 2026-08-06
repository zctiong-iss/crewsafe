/**
 * The backdrop's contrast budget (SCRUM-209 Part 3).
 *
 * The plan names legibility as the whole risk, and asks for the *busiest* frame to be
 * checked rather than the calmest — "a light rain animation with a bright flash is readable
 * for 90% of its loop and not for the rest". A reviewer cannot reliably eyeball the worst
 * frame of a loop, so it is computed.
 *
 * ── HOW THE WORST FRAME IS FOUND ────────────────────────────────────────────────────────
 * The card is sampled on a grid. At each point, every mote whose travel envelope can reach
 * that point is composited over the wash, over the surface — so a point under three
 * overlapping clouds is measured with all three, and a point beside a raindrop is not
 * charged for it. The darkest point on the grid is the frame that has to pass.
 *
 * The naive version of this test — stack every mote in the spec on one pixel — was tried
 * first and rejected. It is not conservative, it is *wrong*: rain is six drops spread across
 * the card that can never coincide, and pricing them as one pixel forces every drop down to
 * an alpha where rain is invisible. Modelling the geometry is what lets the backdrop be
 * visible and provably legible at the same time.
 *
 * A failure here is not a styling nit. It means the WBGT reading on the Conditions screen —
 * the number a supervisor decides whether work continues from — is below AA against its own
 * background.
 */
import { BACKDROPS } from "./registry";
import { palettes } from "@/styles/colors";
import type { BackdropMote, BackdropSpec } from "./types";

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Standard source-over compositing, per channel, in 0–255 space. */
function over(source: Rgb, backdrop: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => source[i] * alpha + backdrop[i] * (1 - alpha)) as Rgb;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The area a mote can occupy at any point in its loop, in percent-of-card space.
 *
 * Travel is added to the static box, because a drifting cloud shades every point it passes
 * over — not just where it starts. The numbers mirror `WeatherBackdrop`'s motion cases; if
 * one changes there, it changes here.
 *
 * `aspectRatio` is the card's own width ÷ height, needed because a mote's height is a
 * multiple of its *width*, so converting it into a percentage of the card's height depends
 * on the card's proportions.
 */
function envelope(mote: BackdropMote, aspectRatio: number) {
  const halfW = mote.size / 2;
  const halfH = ((mote.size * (mote.aspect ?? 1)) / 2) * aspectRatio;

  let padX = 0;
  let padY = 0;

  switch (mote.motion) {
    case "fall":
      // Sweeps the full height of the card, top to bottom, every loop.
      padY = 100;
      break;
    case "drift":
      padX = 8;
      break;
    case "sway":
      padX = 5;
      break;
    case "pulse":
      // Scales to 1.12, so it grows by 6% of its own size in every direction.
      padX = halfW * 0.12;
      padY = halfH * 0.12;
      break;
    case "flash":
    case "none":
      break;
  }

  return {
    left: mote.x - halfW - padX,
    right: mote.x + halfW + padX,
    top: mote.y - halfH - padY,
    bottom: mote.y + halfH + padY,
  };
}

/**
 * The darkest background any text on the card can find itself against.
 *
 * `flash` motes are composited at full opacity, which is the flash's peak rather than its
 * resting 0.15 — that peak is precisely the frame the plan says to check.
 */
function darkestBackground(spec: BackdropSpec, surface: string, aspectRatio: number): Rgb {
  const base = over(parseHex(spec.tint), parseHex(surface), spec.tintOpacity);
  const boxes = spec.motes.map((mote) => ({ mote, box: envelope(mote, aspectRatio) }));

  let darkest = base;
  let darkestLuminance = luminance(base);

  const STEP = 2; // percent — 51×51 samples, finer than any mote is small
  for (let x = 0; x <= 100; x += STEP) {
    for (let y = 0; y <= 100; y += STEP) {
      let point = base;
      for (const { mote, box } of boxes) {
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          point = over(parseHex(mote.color), point, mote.opacity);
        }
      }
      const l = luminance(point);
      if (l < darkestLuminance) {
        darkestLuminance = l;
        darkest = point;
      }
    }
  }

  return darkest;
}

/*
 * Only the standard palette is checked, because `WeatherBackdrop` returns null in high
 * contrast — there is no backdrop there to measure.
 */
const SURFACE = palettes.standard.surface;

/** Every colour the hero card draws text in. `textSecondary` is the tightest of them. */
const TEXT_COLOURS = {
  textPrimary: palettes.standard.textPrimary,
  textSecondary: palettes.standard.textSecondary,
};

/**
 * Card proportions to check at. The hero card is roughly square at default type and gets
 * taller as the font scale rises, and a taller card packs the same motes into less relative
 * height — so the extremes are checked rather than one comfortable middle.
 */
const ASPECT_RATIOS = [0.7, 1.15, 2.0];

const AA_NORMAL = 4.5;

describe("backdrop contrast", () => {
  const entries = Object.entries(BACKDROPS) as [string, BackdropSpec][];

  it("covers every condition the classifier can return", () => {
    // A missing key renders a plain card rather than failing, so this does not guard
    // against a crash — it guards against a condition quietly losing its backdrop in a
    // refactor, since the fallback is silent by design.
    for (const condition of [
      "FAIR",
      "PARTLY_CLOUDY",
      "CLOUDY",
      "WINDY",
      "RAIN",
      "THUNDERY_SHOWERS",
    ]) {
      expect(BACKDROPS[condition]).toBeDefined();
    }
  });

  describe.each(entries)("%s", (_key, spec) => {
    it.each(
      ASPECT_RATIOS.flatMap((ratio) =>
        Object.entries(TEXT_COLOURS).map(([name, colour]) => [name, ratio, colour] as const),
      ),
    )("keeps %s above AA (card ratio %s)", (_name, ratio, colour) => {
      const background = darkestBackground(spec, SURFACE, ratio);
      expect(contrast(parseHex(colour), background)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });
});
