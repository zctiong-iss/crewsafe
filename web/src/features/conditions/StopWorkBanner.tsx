/** @author Tang Chee Seng (with assistance from Claude) */
import type { LightningRiskPayload } from "@/api/conditionsStream";

const timeFormat = new Intl.DateTimeFormat("en-SG", {
  hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore",
});

export function StopWorkBanner({ lightning }: { lightning: LightningRiskPayload }) {
  return (
    <p className="stop-work-banner" role="alert">
      Stop work — lightning {lightning.nearestStrikeKm} km away.
      In effect until {timeFormat.format(new Date(lightning.validUntil))}.
    </p>
  );
}