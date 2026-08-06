/** @author Tang Chee Seng (with assistance from Claude) */

import { apiFetch } from "./client";

export interface SiteWorker {
    id: string;
    displayName: string;
}

export function fetchSiteWorkers(siteId: string):
    Promise<SiteWorker []> {
        return apiFetch<SiteWorker[]>(`/api/v1/sites/${siteId}/workers`);
    }