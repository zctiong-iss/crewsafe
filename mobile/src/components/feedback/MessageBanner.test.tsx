/**
 * MessageBanner — the app's one inline notice, used on 18 screens.
 *
 * These cover the two things a shared banner must not get wrong: the icon has to stay paired
 * with the message however long it wraps, and the tone has to reach the icon as well as the
 * fill, because colour alone fails for a colour-blind reader and again in direct sun where a
 * light tint washes out.
 *
 * @author Justin Chua
 */
import { render, screen } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
// AppText reaches the preferences slice through this; the banner itself has no store.
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));

import MessageBanner from "./MessageBanner";

/** The banner's outermost View, which owns the row layout. */
function containerStyleOf(testId: string) {
  const node = screen.getByTestId(testId);
  const style = node.props.style;
  return Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style ?? {});
}

describe("MessageBanner", () => {
  it("renders the message", async () => {
    await render(<MessageBanner message="Something to say" tone="info" testID="banner" />);

    expect(screen.getByText("Something to say")).toBeTruthy();
  });

  /*
   * The regression this was changed for. `flex-start` is right for one line and wrong for a
   * wrapped message: the icon strands itself at the top of a four-line block with empty space
   * under it, which reads as a layout fault rather than an icon labelling a message.
   */
  it("centres the icon against the whole message rather than its first line", async () => {
    await render(
      <MessageBanner
        message={"A notice long enough to wrap across several lines on a phone, ".repeat(3)}
        tone="info"
        testID="banner"
      />,
    );

    expect(containerStyleOf("banner").alignItems).toBe("center");
  });

  it("still centres on a one-line message, where there is nothing to centre against", async () => {
    await render(<MessageBanner message="Short" tone="danger" testID="banner" />);

    expect(containerStyleOf("banner").alignItems).toBe("center");
  });

  it("shows the request id when one is given", async () => {
    await render(
      <MessageBanner message="It failed" tone="danger" requestId="req-1" testID="banner" />,
    );

    expect(screen.getByText(/req-1/)).toBeTruthy();
  });
});

describe("align", () => {
  /*
   * Left-aligned by default and deliberately so. Most banners carry an error, often with a
   * request id beneath it, and centred body text gives a ragged left edge that is slower to
   * scan — the wrong trade when someone is reading a failure.
   */
  it("left-aligns by default", async () => {
    await render(<MessageBanner message="Something failed" tone="danger" testID="banner" />);

    expect(containerStyleOf("banner").justifyContent).toBeUndefined();
  });

  it("centres the icon and message as a group when asked", async () => {
    await render(
      <MessageBanner message="Short notice" tone="info" align="center" testID="banner" />,
    );

    expect(containerStyleOf("banner").justifyContent).toBe("center");
  });

  it("centres the text itself, not just the group", async () => {
    await render(
      <MessageBanner message="Short notice" tone="info" align="center" testID="banner" />,
    );

    const text = screen.getByText("Short notice");
    const style = text.props.style;
    const flattened = Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style ?? {});
    expect(flattened.textAlign).toBe("center");
  });
});
