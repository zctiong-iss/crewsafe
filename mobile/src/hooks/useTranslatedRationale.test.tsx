/**
 * Fetching the model's rationale in the reader's language.
 *
 * Every failure guarded here is silent by construction. A stale frame looks like a working
 * translation of the wrong plan; a swallowed race looks like a working translation of the
 * previous language; an unguarded unmount looks like nothing at all until it warns in a log
 * nobody reads. None of them throw.
 *
 * @author Justin Chua
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/api/endpoints/recommendations", () => ({
  fetchRationale: jest.fn(),
}));

import i18n from "@/localization/i18n";
import { fetchRationale } from "@/api/endpoints/recommendations";
import { useTranslatedRationale } from "./useTranslatedRationale";

const mockFetch = fetchRationale as jest.MockedFunction<typeof fetchRationale>;

const ENGLISH = "The current WBGT reading of 24.7°C is below the 31°C threshold.";
const CHINESE = "当前湿球黑球温度为 24.7°C，低于 31°C 阈值。";

function ok(text: string, locale: string, translated = true) {
  return { recommendationId: "rec-1", text, locale, translated };
}

function render(original: string | null = ENGLISH) {
  return renderHook(() => useTranslatedRationale("site-1", "shift-1", "rec-1", original));
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("when the reader is already reading the source language", () => {
  it("does not call the server at all", async () => {
    // The stored prose IS English. A request would spend a model call to change nothing.
    const { result } = await act(async () => render());

    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.translated).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("when the reader has switched language", () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });
  });

  it("shows the English original first, then the translation", async () => {
    /*
     * The ordering that keeps a supervisor unblocked. The summary above this paragraph is
     * already in their language; waiting on the network before showing anything here would
     * make a translation outage look like missing content.
     */
    let resolve: (value: ReturnType<typeof ok>) => void = () => {};
    mockFetch.mockReturnValue(new Promise((r) => { resolve = r; }));

    const { result } = await act(async () => render());

    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve(ok(CHINESE, "zh-Hans"));
    });

    await waitFor(() => expect(result.current.translated).toBe(true));
    expect(result.current.text).toBe(CHINESE);
  });

  it("asks for the language the reader actually set", async () => {
    mockFetch.mockResolvedValue(ok(CHINESE, "zh-Hans"));

    await act(async () => render());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("site-1", "shift-1", "rec-1", "zh-Hans"));
  });

  it("keeps the English original when the server reports a degraded read", async () => {
    // §7.1. ml-service returns the original with translated=false when Bedrock is down, and
    // the screen labels it as the model's original wording rather than as a failure.
    mockFetch.mockResolvedValue(ok(ENGLISH, "zh-Hans", false));

    const { result } = await act(async () => render());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.translated).toBe(false);
  });

  it("keeps the English original when the request fails outright", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    const { result } = await act(async () => render());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.translated).toBe(false);
  });

  it("treats an empty translation as no translation", async () => {
    // Rendering a blank paragraph would silently remove the model's reasoning from the screen.
    mockFetch.mockResolvedValue(ok("   ", "zh-Hans", true));

    const { result } = await act(async () => render());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.translated).toBe(false);
  });

  it("does nothing when there is no prose to translate", async () => {
    const { result } = await act(async () => render(null));

    expect(result.current.text).toBe("");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("switching language under a mounted screen", () => {
  it("never leaves the previous language's translation on screen", async () => {
    /*
     * The heart of the original bug report, one layer up. If the state were not reset
     * synchronously, a reader switching from Chinese to Malay would sit looking at Chinese
     * text while the Malay request was in flight — a stale frame that looks exactly like a
     * translation that ignored their setting.
     */
    mockFetch.mockResolvedValue(ok(CHINESE, "zh-Hans"));

    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });
    const { result } = await act(async () => render());
    await waitFor(() => expect(result.current.text).toBe(CHINESE));

    let resolveMalay: (value: ReturnType<typeof ok>) => void = () => {};
    mockFetch.mockReturnValue(new Promise((r) => { resolveMalay = r; }));

    await act(async () => {
      await i18n.changeLanguage("ms");
    });

    // Mid-flight: the Chinese must be gone already, not still sitting there.
    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.translated).toBe(false);

    await act(async () => {
      resolveMalay(ok("Bacaan WBGT semasa 24.7°C berada di bawah ambang 31°C.", "ms"));
    });
    await waitFor(() => expect(result.current.translated).toBe(true));
  });

  it("drops the translation when the reader switches BACK to English", async () => {
    /*
     * THE CASE THE SYNCHRONOUS RESET ACTUALLY EXISTS FOR, and the one an earlier version of
     * this file failed to cover. Switching between two non-English languages re-runs the
     * effect all the way to its loading state, which resets the text as a side effect — so
     * that path passes with or without the reset, and it did.
     *
     * Switching to English returns early instead. Without the reset there is no setState on
     * that path at all, so the Chinese paragraph stays on screen for a reader who just asked
     * for English. The same holds when the prose or the ids go away.
     */
    mockFetch.mockResolvedValue(ok(CHINESE, "zh-Hans"));

    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });
    const { result } = await act(async () => render());
    await waitFor(() => expect(result.current.text).toBe(CHINESE));

    await act(async () => {
      await i18n.changeLanguage("en");
    });

    expect(result.current.text).toBe(ENGLISH);
    expect(result.current.translated).toBe(false);
  });

  it("re-requests for the new language", async () => {
    mockFetch.mockResolvedValue(ok(CHINESE, "zh-Hans"));

    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });
    await act(async () => render());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      await i18n.changeLanguage("ta");
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith("site-1", "shift-1", "rec-1", "ta");
  });
});

describe("the late-response race", () => {
  it("ignores a response that lands after unmount", async () => {
    /*
     * Without the `active` guard this sets state on a torn-down tree. The same shape of race
     * had to be fixed in the notification-response path, so it is guarded here by construction
     * rather than after someone sees the warning.
     */
    await act(async () => {
      await i18n.changeLanguage("zh-Hans");
    });

    let resolve: (value: ReturnType<typeof ok>) => void = () => {};
    mockFetch.mockReturnValue(new Promise((r) => { resolve = r; }));

    const { unmount, result } = await act(async () => render());
    await act(async () => {
      unmount();
    });

    await act(async () => {
      resolve(ok(CHINESE, "zh-Hans"));
    });

    // The last state the hook published while mounted was the English original.
    expect(result.current.text).toBe(ENGLISH);
  });
});
