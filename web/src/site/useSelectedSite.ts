/**
 * @author Jemilin Beulah
 */
import { useContext } from "react";
import { SiteContext, type SiteContextValue } from "./SiteProvider";

export function useSelectedSite(): SiteContextValue {
  const context = useContext(SiteContext);
  if (!context) {
    throw new Error("useSelectedSite must be used inside <SiteProvider>");
  }
  return context;
}
