/**
 * @author Jemilin Beulah
 */
import { useSelectedSite } from "@/site/useSelectedSite";
import "./SitePicker.css";

/**
 * The switch for a screen that shows one site at a time (Conditions, Policy).
 *
 * A single-site user still gets the site's name shown as plain text — there was previously
 * no indication anywhere on these screens of which site was being displayed, even before a
 * second site made that ambiguous.
 */
export function SitePicker() {
  const { sites, siteId, selectSite } = useSelectedSite();

  if (siteId === null) return null;

  if (sites.length <= 1) {
    const name = sites.find((site) => site.id === siteId)?.name;
    return name ? <p className="site-picker site-picker--single">{name}</p> : null;
  }

  return (
    <select
      className="site-picker"
      aria-label="Site"
      value={siteId}
      onChange={(event) => selectSite(event.target.value)}
    >
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.name}
        </option>
      ))}
    </select>
  );
}
