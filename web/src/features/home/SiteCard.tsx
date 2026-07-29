/**
 * @author Jemilin Beulah
 */
import type { Site } from "@/api/identity";
import "./SiteCard.css";

/**
 * One site on the live board.
 *
 * Today it carries the site's identity and an honest statement that monitoring is not
 * connected. The slot marked below is where the WBGT reading, forecast band and crew
 * status from the design go — the card is laid out for them now so that adding them is a
 * change to this component alone.
 */
export function SiteCard({ site }: { site: Site }) {
  return (
    <article className="site-card card">
      <header className="site-card__header">
        <h2 className="site-card__name">{site.name}</h2>
        <p className="site-card__location">
          <span className="code">
            {site.latitude}, {site.longitude}
          </span>
          <span aria-hidden="true"> · </span>
          {site.timezone}
        </p>
      </header>

      {/* Readings slot — WBGT, forecast band and crew status land here. */}
      <div className="site-card__pending">
        <p className="eyebrow">Live conditions</p>
        <p className="site-card__pending-text">
          Not connected yet. Weather ingest and the WBGT reading arrive with the monitoring
          service; this card will show the current band, the forecast and crew status once
          it does.
        </p>
      </div>
    </article>
  );
}
