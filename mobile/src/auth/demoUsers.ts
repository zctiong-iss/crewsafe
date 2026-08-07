/**
 * The fixtures `mock` mode signs in as.
 *
 * Deliberately shaped like the real seeded accounts rather than invented from scratch:
 * `DemoDataSeeder` reconciles `synthetic-*@synthetic.crewsafe.invalid` users whose display
 * names begin with "Synthetic ", across exactly two sites — Bishan Park Landscaping and
 * NUS Campus Maintenance. Matching that means a screen built against mock data does not
 * quietly depend on a shape the backend never produces.
 *
 * The second site exists for the same reason it does in the seeder: with only one site,
 * "a user cannot reach a site they are not assigned to" is unfalsifiable. The supervisor
 * here belongs to one site, not both, so a cross-site 403 stays reproducible in mock mode.
 *
 * The ids are fixed rather than generated so that a persisted reference to one survives a
 * reload. They are not real database ids and mean nothing to the backend — in mock mode
 * nothing here is ever sent to it.
 *
 * @author Justin Chua
 */
import type { CurrentUser, Role, Site } from "@/types/domain";

export const DEMO_SITES: Record<"bishan" | "campus", Site> = {
  bishan: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bishan Park Landscaping",
    latitude: "1.362200",
    longitude: "103.845500",
    timezone: "Asia/Singapore",
  },
  campus: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "NUS Campus Maintenance",
    latitude: "1.296600",
    longitude: "103.776400",
    timezone: "Asia/Singapore",
  },
};

export interface DemoUser extends CurrentUser {
  /** Shown in the picker under the display name, so the role is obvious before signing in. */
  role: Role;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    username: "synthetic-worker@synthetic.crewsafe.invalid",
    displayName: "Synthetic Worker",
    role: "WORKER",
    siteIds: [DEMO_SITES.bishan.id],
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    username: "synthetic-supervisor@synthetic.crewsafe.invalid",
    displayName: "Synthetic Supervisor",
    role: "SUPERVISOR",
    siteIds: [DEMO_SITES.bishan.id],
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    username: "synthetic-safety@synthetic.crewsafe.invalid",
    displayName: "Synthetic Safety Manager",
    role: "SAFETY_MANAGER",
    // Both sites: a safety manager reports across teams (FR-32), so this is the account
    // that makes a multi-site view testable.
    siteIds: [DEMO_SITES.bishan.id, DEMO_SITES.campus.id],
  },
];

export function findDemoUser(id: string): DemoUser | undefined {
  return DEMO_USERS.find((user) => user.id === id);
}
