/** @author Tang Chee Seng (with assistance from Claude) */

export interface SupersededItem {
  id: string;
  shiftLabel: string;
  siteName: string;
}

// A superseded plan has nothing to decide, so it does not belong among the actionable cards. But if it
// just vanished, a supervisor would only notice by its absence — so it recedes into a compact, muted
// note below the queue: enough to say "conditions changed and a newer plan replaced this one" without
// competing with the plans still awaiting a decision. Mirrors mobile's SUPERSEDED treatment (a quiet
// notice, not a danger signal).
export function SupersededList({ items }: Readonly<{ items: SupersededItem[] }>) {
  if (items.length === 0) return null;

  return (
    <section className="approvals__superseded" aria-label="Recently superseded">
      <h2 className="approvals__superseded-title">Recently superseded</h2>
      <ul className="approvals__superseded-list">
        {items.map((item) => (
          <li key={item.id} className="approvals__superseded-item">
            {item.shiftLabel} · {item.siteName} — replaced by a newer plan
          </li>
        ))}
      </ul>
    </section>
  );
}
