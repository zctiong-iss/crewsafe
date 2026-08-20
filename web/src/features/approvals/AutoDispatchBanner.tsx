/** @author Tang Chee Seng (with assistance from Claude) */

// A lightning-immediate stop-work skips approval entirely and is already sent to workers, so there is
// nothing to approve or reject — the most urgent thing this queue can show. This banner says so in the
// same danger register as the conditions StopWorkBanner (⚡, --band-extreme). Copy is kept verbatim with
// the mobile detail screen (recommendations.autoDispatchedNotice) so both clients say the one thing.
export function AutoDispatchBanner() {
  return (
    <p className="approvals__auto-dispatch-banner" role="alert">
      This stop-work order was sent to workers automatically — no approval was required.
    </p>
  );
}
