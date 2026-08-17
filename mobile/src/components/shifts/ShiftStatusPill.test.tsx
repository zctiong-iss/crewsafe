/**
 * ShiftStatusPill — first test coverage, added with the ADR-0017 migration.
 *
 * This component shipped untested. It is worth covering now for a specific reason: SCRUM-441
 * added a scheduler that transitions PLANNED shifts to ACTIVE on its own, so the statuses this
 * pill renders now change without anyone touching the client. A status the map does not handle
 * would be a crash on the shift list rather than a cosmetic miss.
 */
import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme } from "@/styles/theme";
import type { ShiftStatus } from "@/types/domain";

const mockTheme = buildTheme(false, 1);

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import ShiftStatusPill from "./ShiftStatusPill";

/** Every status the server can produce — the scheduler moves shifts between them unattended. */
const ALL_STATUSES: ShiftStatus[] = ["PLANNED", "ACTIVE", "CLOSED"];

async function surfaceOf(status: ShiftStatus) {
  const { getByText } = await render(<ShiftStatusPill status={status} />);
  let node = getByText(`shifts.status.${status}`).parent;
  while (node) {
    const flat = StyleSheet.flatten(node.props?.style);
    if (flat && flat.borderWidth !== undefined) return flat;
    node = node.parent;
  }
  throw new Error("no pill surface found");
}

it.each(ALL_STATUSES)("renders %s with its own label", async (status) => {
  // SCRUM-441 regression guard: the scheduler can move a shift into any of these unattended,
  // so every one must render rather than falling through or throwing.
  const { getByText } = await render(<ShiftStatusPill status={status} />);
  expect(getByText(`shifts.status.${status}`)).toBeTruthy();
});

it("fills ONLY the ACTIVE pill", async () => {
  // People are on site right now — the one row worth spotting while scrolling.
  expect((await surfaceOf("ACTIVE")).backgroundColor).toBe(mockTheme.colors.success);
  expect((await surfaceOf("PLANNED")).backgroundColor).toBe("transparent");
  expect((await surfaceOf("CLOSED")).backgroundColor).toBe("transparent");
});

it("mutes PLANNED and CLOSED rather than colouring them", async () => {
  // Neither is a state anyone needs to act on; a semantic colour here would compete with the
  // WBGT band and the recommendation pill on the same row.
  expect((await surfaceOf("PLANNED")).borderColor).toBe(mockTheme.colors.textSecondary);
  expect((await surfaceOf("CLOSED")).borderColor).toBe(mockTheme.colors.textSecondary);
});

it("keeps every status pill bordered in high contrast", async () => {
  // The palette collapses fills in high contrast; the border is what survives.
  const highContrast = buildTheme(true, 1);
  Object.assign(mockTheme, highContrast);

  for (const status of ALL_STATUSES) {
    const style = await surfaceOf(status);
    expect({ status, width: style.borderWidth }).toEqual({ status, width: 2 });
  }

  Object.assign(mockTheme, buildTheme(false, 1));
});
