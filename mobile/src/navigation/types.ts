/**
 * Navigation shape.
 *
 * Bottom tabs, with a stack inside each tab rather than one stack above the tabs. That
 * keeps a push (Shifts → Create shift → Shift detail) inside its own tab, so switching
 * tabs and coming back returns to where you were instead of resetting — which matters on a
 * site, where the app is put down and picked up constantly.
 *
 * Worker and supervisor get different tab sets. That is not cosmetic: `POST /shifts` is
 * role-gated to SUPERVISOR/SAFETY_MANAGER/ADMIN in `ShiftController`, so showing a worker
 * a "create shift" tab would be offering them a guaranteed 403.
 *
 * @author Justin Chua
 */

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
};

/* ----------------------------- Worker ----------------------------- */

export type MyShiftStackParamList = {
  MyShift: undefined;
};

export type InboxStackParamList = {
  Inbox: undefined;
};

export type WorkerTabParamList = {
  MyShiftTab: undefined;
  InboxTab: undefined;
  WeatherTab: undefined;
  ProfileTab: undefined;
};

/* --------------------------- Supervisor --------------------------- */

export type ShiftsStackParamList = {
  ShiftList: undefined;
  CreateShift: { siteId: string } | undefined;
  ShiftDetail: { siteId: string; shiftId: string };
};

/** The supervisor's crew-wellbeing surface (US-11). */
export type ConcernsStackParamList = {
  Concerns: undefined;
};

/**
 * The supervisor's decision surface (SCRUM-119).
 *
 * `RecommendationDetail` carries the site and shift as well as the recommendation, because the
 * endpoint is nested under both — a recommendation id alone cannot be fetched or decided on.
 */
export type RecommendationsStackParamList = {
  RecommendationList: undefined;
  RecommendationDetail: { siteId: string; shiftId: string; recommendationId: string };
};

export type SupervisorTabParamList = {
  ShiftsTab: undefined;
  RecommendationsTab: undefined;
  ConcernsTab: undefined;
  WeatherTab: undefined;
  ProfileTab: undefined;
};

/**
 * A safety manager's tabs (SCRUM-TBD-90).
 *
 * No ShiftsTab: a manager oversees sites they do not run, and `ShiftController`'s write
 * endpoints refuse the role outright, so the tab would offer controls the server answers 403
 * to. Oversight takes its place.
 */
export type SafetyManagerTabParamList = {
  OversightTab: undefined;
  ConcernsTab: undefined;
  RecommendationsTab: undefined;
  WeatherTab: undefined;
  ProfileTab: undefined;
};

export type OversightStackParamList = {
  Oversight: undefined;
};

/* ---------------------------- Shared ----------------------------- */

export type WeatherStackParamList = {
  Weather: undefined;
  /**
   * The WBGT forecast for a site (SCRUM-365 / US-06).
   *
   * `siteId` is a route param rather than something the screen reads back out of the store,
   * so the forecast can never be shown for a site other than the one the user tapped from —
   * including in the window after they change site on the weather screen behind it.
   */
  Forecast: { siteId: string };
};

/**
 * Profile, and the administrative surfaces reached from it.
 *
 * The heat policy screens (SCRUM-120) live here rather than in a tab of their own: configuration
 * is rare and done sitting down, and a sixth supervisor tab would also appear for supervisors, who
 * may read the policy but not change it. Settings is here for the same reason.
 *
 * One stack rather than a nested policy navigator — three routes do not need their own navigator,
 * and nesting one would put a second header bar above screens that already have one.
 */
export type ProfileStackParamList = {
  Profile: undefined;
  Settings: undefined;
  PolicyVersions: undefined;
  PolicyVersionDetail: { versionId: string };
  NewPolicyVersion: undefined;
};
