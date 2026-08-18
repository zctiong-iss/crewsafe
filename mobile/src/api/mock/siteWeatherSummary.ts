/**
 * Per-site conditions for `mock` auth mode.
 *
 * Deliberately gives each demo site a *different* band, and one site no reading at all. A
 * fixture where every site sat in the same band would render the picker as a column of
 * identical green rows — which is exactly the case the picker is useless for, and would hide
 * whether the band colouring and the "no reading" row work at all.
 *
 * @author Justin Chua
 */
import { DEMO_SITES } from "@/auth/demoUsers";
import type { SiteWeatherSummary } from "../endpoints/siteWeatherSummary";
import type { WbgtBand } from "@/types/domain";

/** Spread across the bands, so the picker's whole colour range is exercised in mock mode. */
const SCENARIOS: { wbgt: number | null; band: WbgtBand | null }[] = [
  { wbgt: 26.7, band: "BELOW_31" },
  { wbgt: 32.4, band: "32_TO_BELOW_33" },
  // A site the ingestion has nothing for. Rendered as "no reading", never as a cool one.
  { wbgt: null, band: null },
];

export function mockSiteWeatherSummary(): SiteWeatherSummary[] {
  const observedAt = new Date(Date.now() - 4 * 60_000).toISOString();

  return Object.values(DEMO_SITES).map((site, index) => {
    const scenario = SCENARIOS[index % SCENARIOS.length];
    return {
      siteId: site.id,
      wbgt: scenario.wbgt,
      band: scenario.band,
      observedAt: scenario.wbgt === null ? null : observedAt,
      freshness: scenario.wbgt === null ? null : "LIVE",
    };
  });
}
