/**
 * Role decides the tab set (SCRUM-TBD-90 / SCRUM-TBD-92).
 *
 * Until this change `RootNavigator` handed SUPERVISOR, SAFETY_MANAGER and ADMIN the identical
 * `SupervisorTabs`, which is the only reason a safety manager ever saw a Shifts tab and a Plan
 * a shift button. Nobody decided they should; the role had nowhere else to go.
 *
 * Three things are worth pinning:
 *
 *   a SAFETY_MANAGER gets Oversight and NOT Shifts — the change itself;
 *   a SUPERVISOR is untouched — this removes one role from a surface, not the surface;
 *   an ADMIN stays on the supervisor tabs — it holds shift-write permission server-side, so
 *   moving it to a read-only screen would take away access the server still grants, which is
 *   the opposite of the safety manager's case and the easiest thing to get wrong here.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

/* The tab sets are stubbed to their names: this is a routing decision, and rendering the real
   navigators would drag in every screen behind them to answer a question about one `if`. */
jest.mock("./WorkerTabs", () => {
  const { Text } = jest.requireActual("react-native");
  return { __esModule: true, default: () => <Text>WORKER_TABS</Text> };
});
jest.mock("./SupervisorTabs", () => {
  const { Text } = jest.requireActual("react-native");
  return { __esModule: true, default: () => <Text>SUPERVISOR_TABS</Text> };
});
jest.mock("./SafetyManagerTabs", () => {
  const { Text } = jest.requireActual("react-native");
  return { __esModule: true, default: () => <Text>SAFETY_MANAGER_TABS</Text> };
});
jest.mock("./AuthStack", () => {
  const { Text } = jest.requireActual("react-native");
  return { __esModule: true, default: () => <Text>AUTH_STACK</Text> };
});

const mockDispatch = jest.fn();
let mockState: unknown;
jest.mock("@/store/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (fn: (s: unknown) => unknown) => fn(mockState),
}));
jest.mock("@/store/reducers/authSlice", () => ({
  restoreSession: () => ({ type: "auth/restoreSession" }),
}));

import RootNavigator from "./RootNavigator";
import type { Role } from "@/types/domain";

function stateFor(role: Role | null) {
  return {
    auth: {
      status: "signed-in",
      user: role ? { id: "u-1", username: "u", displayName: "U", role, siteIds: ["site-1"] } : null,
    },
  };
}

async function tabsFor(role: Role | null) {
  mockState = stateFor(role);
  const { queryByText } = await render(<RootNavigator />);
  for (const name of ["SAFETY_MANAGER_TABS", "SUPERVISOR_TABS", "WORKER_TABS", "AUTH_STACK"]) {
    if (queryByText(name)) return name;
  }
  return null;
}

beforeEach(() => jest.clearAllMocks());

it("gives a safety manager the oversight tabs, not the supervisor's", async () => {
  expect(await tabsFor("SAFETY_MANAGER")).toBe("SAFETY_MANAGER_TABS");
});

it("leaves a supervisor on the supervisor tabs", async () => {
  expect(await tabsFor("SUPERVISOR")).toBe("SUPERVISOR_TABS");
});

it("leaves an admin on the supervisor tabs", async () => {
  // ADMIN keeps shift-write permission server-side. Routing it to a read-only oversight
  // surface would remove access the API still grants.
  expect(await tabsFor("ADMIN")).toBe("SUPERVISOR_TABS");
});

it("leaves a worker on the worker tabs", async () => {
  expect(await tabsFor("WORKER")).toBe("WORKER_TABS");
});

it("falls back to the worker tabs for an unrecognised role", async () => {
  // The allow-list property the original code was written for: a role this build predates
  // must land on the least-privileged surface, not on one offering shift creation.
  expect(await tabsFor("SITE_ENGINEER" as Role)).toBe("WORKER_TABS");
});
