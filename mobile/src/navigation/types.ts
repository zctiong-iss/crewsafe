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

export type SupervisorTabParamList = {
  ShiftsTab: undefined;
  WeatherTab: undefined;
  ProfileTab: undefined;
};

/* ---------------------------- Shared ----------------------------- */

export type WeatherStackParamList = {
  Weather: undefined;
};

export type ProfileStackParamList = {
  Profile: undefined;
  Settings: undefined;
};
