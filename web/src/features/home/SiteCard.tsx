/**
 * @author Jemilin Beulah
 */
import type { Site } from "@/api/identity";
import type { subscribeToConditions } from "@/api/conditionsStream";
import { SiteConditionsSummary } from "./SiteConditionsSummary";
import "./SiteCard.css";
/**
 * One site on the live board.
 *
 * Today it carries the site's identity and an honest statement that monitoring is not
 * connected. The slot marked below is where the WBGT reading, forecast band and crew
 * status from the design go — the card is laid out for them now so that adding them is a
 * change to this component alone.
 */
export function SiteCard({
  site,
  subscribe,
}: Readonly<{ site: Site; subscribe?: typeof subscribeToConditions }>) {
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

      <div className="site-card__body">
        <SiteConditionsSummary siteId={site.id} subscribe={subscribe} />
      </div>
    </article>
  );
}