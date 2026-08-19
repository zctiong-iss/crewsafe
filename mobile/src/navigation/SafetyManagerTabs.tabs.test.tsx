/**
 * Which tabs a safety manager actually gets, and the one that is deliberately absent.
 *
 * ── WHY THIS IS ASSERTED RATHER THAN EYEBALLED ──────────────────────────────────────────
 * `features.safetyManagerPlansTab` is off, and the whole point of hiding a surface behind a
 * flag rather than deleting it is that the code stays compiled — which also means `tsc` will
 * never tell anyone whether the tab is actually gone. A flag with nothing asserting its effect
 * is a flag that silently stops working.
 *
 * The stacks are stubbed: this is a test about the tab bar's contents, and rendering the real
 * screens would pull in polling and four screens' worth of unrelated failure modes.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { render } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import { Provider } from "react-redux";

import i18n from "@/localization/i18n";
import preferences from "@/store/reducers/preferencesSlice";
import auth from "@/store/reducers/authSlice";

jest.mock("./stacks", () => {
  const { Text: RNText } = require("react-native");
  const stub = (label: string) => () => <RNText>{label}</RNText>;
  return {
    OversightStack: stub("oversight"),
    ConcernsStack: stub("concerns"),
    RecommendationsStack: stub("plans"),
    WeatherStack: stub("weather"),
    ProfileStack: stub("profile"),
  };
});

// Loading concerns would fire a network call at a stub; the count itself is tested by the slice.
jest.mock("@/store/reducers/wellbeingSlice", () => ({
  loadConcerns: () => ({ type: "wellbeing/noop" }),
  selectOpenConcernCount: () => 0,
}));

import SafetyManagerTabs from "./SafetyManagerTabs";
import { features } from "@/constants/features";

async function renderTabs() {
  const navigationRef = createNavigationContainerRef();
  const store = configureStore({
    reducer: {
      preferences,
      auth,
      shifts: (state = { selectedSiteId: "site-1" } as unknown) => state,
      wellbeing: (state = { concerns: [] } as unknown) => state,
    },
  });

  // Awaited: RNTL 14 renders asynchronously, and the container ref is not attached until it
  // has. Reading `getRootState()` before that returns undefined, which reads as "no routes"
  // and would make every route assertion below pass vacuously.
  const queries = await render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <NavigationContainer ref={navigationRef}>
          <SafetyManagerTabs />
        </NavigationContainer>
      </I18nextProvider>
    </Provider>,
  );

  return { ...queries, navigationRef };
}

/** The tab navigator's registered route names, straight from navigation state. */
function routeNames(ref: ReturnType<typeof createNavigationContainerRef>): string[] {
  const root = ref.getRootState();
  return (root?.routes?.[0]?.state?.routeNames ?? root?.routeNames ?? []) as string[];
}

it("does not offer a Plans tab while the flag is off", async () => {
  /*
   * The requirement: invisible AND unreachable. This covers the visible half — the absence of
   * the route is covered below, and matters more, because a hidden tab button still leaves a
   * screen a deep link can open.
   */
  expect(features.safetyManagerPlansTab).toBe(false);

  const { queryByText } = await renderTabs();

  expect(queryByText(i18n.t("recommendations.tabTitle"))).toBeNull();
});

it("does not register the Plans route at all, so nothing can navigate to it", async () => {
  /*
   * The half that `tabBarButton: () => null` would have got wrong. Hidden from the tab bar is
   * not the same as unreachable: the route would still exist and a stray navigate() or a deep
   * link would still land on it.
   */
  const { navigationRef } = await renderTabs();

  /*
   * Read from navigation state rather than from the rendered tree.
   *
   * The first version of this looked for the stubbed stack's text and passed with the flag ON
   * as well as off — a stub only renders once its tab is FOCUSED, and Oversight is focused by
   * default, so the assertion could never fail. Route names are the thing that actually says
   * whether a screen can be navigated to.
   */
  expect(routeNames(navigationRef)).not.toContain("RecommendationsTab");
});

it("still gives the manager everything else", async () => {
  // Hiding one tab must not take the others with it — Oversight in particular, which is where
  // the plan a manager actually needs now lives (SCRUM-TBD-110).
  const { queryByText, navigationRef } = await renderTabs();

  for (const key of ["oversight.tabTitle", "wellbeing.concernsTab", "tabs.weather", "tabs.profile"]) {
    expect(queryByText(i18n.t(key))).not.toBeNull();
  }
  expect(routeNames(navigationRef)).toEqual(
    expect.arrayContaining(["OversightTab", "ConcernsTab", "WeatherTab", "ProfileTab"]),
  );
});
