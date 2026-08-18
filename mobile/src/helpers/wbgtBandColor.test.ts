/**
 * The band-to-colour mapping, against MOM's "Heat Stress Measures for Outdoor Work".
 *
 * Worth its own test because the mapping is a claim about an external document. If someone
 * later decides amber should only cover 31–32, that is a decision to make deliberately against
 * the poster, not one to discover from a screenshot.
 *
 * @author Justin Chua
 */
import { buildTheme, defaultTheme } from "@/styles/theme";
import { wbgtBandColor } from "./wbgtBandColor";

describe("wbgtBandColor", () => {
  const { colors } = defaultTheme;

  it("uses green below 31", () => {
    expect(wbgtBandColor("BELOW_31", colors)).toBe(colors.success);
  });

  /*
   * The poster has one amber column for 31 to 33; our bands split it at 32, because the required
   * rest changes there. So two bands share a colour and the label carries the difference.
   */
  it("uses amber across both middle bands, matching the poster's single column", () => {
    expect(wbgtBandColor("31_TO_BELOW_32", colors)).toBe(colors.warning);
    expect(wbgtBandColor("32_TO_BELOW_33", colors)).toBe(colors.warning);
  });

  it("uses red at 33 and above", () => {
    expect(wbgtBandColor("33_AND_ABOVE", colors)).toBe(colors.danger);
  });

  /*
   * The one that matters most. A missing band must not fall through to green: an unknown
   * reading drawn as a safe one is the failure this whole screen family is careful about.
   */
  it.each([[null], [undefined]])("returns null for %p rather than defaulting to green", (band) => {
    expect(wbgtBandColor(band, colors)).toBeNull();
  });

  it("resolves through the high-contrast palette too", () => {
    // The semantic colours darken in high contrast; the mapping must read whichever palette it
    // is handed rather than closing over one.
    const hc = buildTheme(true, 1).colors;
    expect(wbgtBandColor("33_AND_ABOVE", hc)).toBe(hc.danger);
    expect(wbgtBandColor("33_AND_ABOVE", hc)).not.toBe(colors.danger);
  });
});
