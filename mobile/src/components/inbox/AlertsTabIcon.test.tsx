/**
 * The Alerts tab icon (SCRUM-208).
 *
 * The only behaviour worth asserting is the one the plan argued about: the tick appears when
 * everything is acknowledged and not otherwise, and the bell stays underneath either way — so
 * the icon gains a mark rather than becoming a different thing.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react-native";
import { Provider } from "react-redux";

import preferences from "@/store/reducers/preferencesSlice";
import { ThemeProvider } from "@/theme/ThemeProvider";
import AlertsTabIcon from "./AlertsTabIcon";

/*
 * A minimal store rather than the app's own.
 *
 * `ThemeProvider` reads only `preferences`, and importing the real store would drag in
 * redux-persist and AsyncStorage — a rehydrate cycle and an open handle, neither of which
 * this component has anything to do with.
 */
function renderIcon(allAcknowledged: boolean) {
  const store = configureStore({ reducer: { preferences } });
  return render(
    <Provider store={store}>
      <ThemeProvider>
        <AlertsTabIcon color="#000000" size={24} allAcknowledged={allAcknowledged} />
      </ThemeProvider>
    </Provider>,
  );
}

describe("AlertsTabIcon", () => {
  it("renders the bell alone while work is outstanding", async () => {
    const { queryByTestId } = await renderIcon(false);
    expect(queryByTestId("alerts-tab-bell")).not.toBeNull();
    expect(queryByTestId("alerts-tab-tick")).toBeNull();
  });

  it("adds the tick when everything is acknowledged", async () => {
    const { queryByTestId } = await renderIcon(true);
    expect(queryByTestId("alerts-tab-tick")).not.toBeNull();
  });

  it("keeps the bell underneath the tick", async () => {
    // Composed, not swapped: a different glyph would read as a different thing.
    const { queryByTestId } = await renderIcon(true);
    expect(queryByTestId("alerts-tab-bell")).not.toBeNull();
  });
});
