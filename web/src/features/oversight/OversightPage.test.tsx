/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { useAuth } from "@/auth/useAuth";
import { expectNoA11yViolations } from "@/test/a11y";
import { ApiError } from "@/api/errors";
import type { SitePlanSummary } from "@/api/oversight";
import { OversightPage } from "./OversightPage";
import "@testing-library/jest-dom/vitest";

const { fetchPlanSummary, fetchAccessibleSites } = vi.hoisted(() => ({
  fetchPlanSummary: vi.fn(),
  fetchAccessibleSites: vi.fn(),
}));

vi.mock("@/api/oversight", () => ({ fetchPlanSummary }));
vi.mock("@/api/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/identity")>()),
  fetchAccessibleSites,
}));

function WhenSignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  return state.status === "signed-in" ? <>{children}</> : null;
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AuthProvider userManager={fakeUserManager({})}>
        <WhenSignedIn>
          <OversightPage />
        </WhenSignedIn>
      </AuthProvider>
    </MemoryRouter>,
  );

const summary = (
  siteId: string,
  awaitingDecision: number,
  totalPlans: number,
  supervisors: SitePlanSummary["supervisors"] = [],
): SitePlanSummary => ({ siteId, awaitingDecision, totalPlans, supervisors });

describe("OversightPage", () => {
  beforeEach(() => {
    fetchPlanSummary.mockReset();
    // Default: no names resolve, so cards fall back to the site id — which is what the
    // id-based assertions below rely on. The name-resolution test overrides this.
    fetchAccessibleSites.mockReset().mockResolvedValue([]);
  });

  it("renders one card per site, sorted by awaitingDecision descending", async () => {
    fetchPlanSummary.mockResolvedValue([
      summary("site-low", 1, 5, [{ id: "u-1", displayName: "Ravi" }]),
      summary("site-high", 8, 12, [{ id: "u-2", displayName: "Meng Hui" }]),
      summary("site-mid", 4, 6),
    ]);

    renderPage();

    const cards = await screen.findAllByRole("article");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("site-high"),
      expect.stringContaining("site-mid"),
      expect.stringContaining("site-low"),
    ]);
  });

  it("shows awaitingDecision as primary, totalPlans as secondary, and supervisors as accountable-for-site", async () => {
    fetchPlanSummary.mockResolvedValue([
      summary("site-a", 3, 9, [{ id: "u-1", displayName: "Meng Hui" }]),
    ]);

    renderPage();

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("Accountable: Meng Hui")).toBeInTheDocument();
    expect(screen.queryByText(/created by/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/author/i)).not.toBeInTheDocument();
  });

  it("renders the resolved site name, not the raw site id, when a name is available", async () => {
    fetchPlanSummary.mockResolvedValue([summary("site-uuid-1", 2, 5)]);
    fetchAccessibleSites.mockResolvedValue([
      { id: "site-uuid-1", name: "Marina Bay Tower" } as Awaited<
        ReturnType<typeof fetchAccessibleSites>
      >[number],
    ]);

    renderPage();

    expect(await screen.findByText("Marina Bay Tower")).toBeInTheDocument();
    expect(screen.queryByText("site-uuid-1")).not.toBeInTheDocument();
  });

  it("falls back to the site id when its name cannot be resolved", async () => {
    fetchPlanSummary.mockResolvedValue([summary("site-orphan", 1, 1)]);
    fetchAccessibleSites.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("site-orphan")).toBeInTheDocument();
  });

  it("still renders a site with awaitingDecision: 0", async () => {
    fetchPlanSummary.mockResolvedValue([summary("site-quiet", 0, 4)]);

    renderPage();

    expect(await screen.findByText("site-quiet")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("No supervisor assigned")).toBeInTheDocument();
  });

  it("shows an EmptyState, not a blank screen or spinner, when there are no sites", async () => {
    fetchPlanSummary.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No sites under your oversight")).toBeInTheDocument();
    expect(screen.queryByText("Loading your sites")).not.toBeInTheDocument();
  });

  it("renders the ApiError message and requestId on failure, without crashing", async () => {
    fetchPlanSummary.mockRejectedValue(new ApiError("server", "boom", 500, "req-123"));

    renderPage();

    expect(await screen.findByText("Could not load oversight data")).toBeInTheDocument();
    expect(
      screen.getByText(/Something went wrong on our end\. Try again in a moment\./),
    ).toBeInTheDocument();
    expect(screen.getByText("req-123")).toBeInTheDocument();
  });

  it("has no accessibility violations once loaded", async () => {
    fetchPlanSummary.mockResolvedValue([
      summary("site-a", 2, 5, [{ id: "u-1", displayName: "Meng Hui" }]),
    ]);

    const { container } = renderPage();
    await screen.findByText("site-a");
    await expectNoA11yViolations(container);
  });

  describe("polling", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("refreshes on a 30s interval and clears the interval on unmount", async () => {
      fetchPlanSummary.mockResolvedValue([summary("site-a", 1, 1)]);

      const { unmount } = renderPage();

      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchPlanSummary).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(fetchPlanSummary).toHaveBeenCalledTimes(2);

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await Promise.resolve();
      });
      expect(fetchPlanSummary).toHaveBeenCalledTimes(2);
    });

    it("does not fetch on the poll tick while the document is hidden", async () => {
      fetchPlanSummary.mockResolvedValue([summary("site-a", 1, 1)]);

      Object.defineProperty(document, "hidden", { configurable: true, value: true });

      renderPage();

      await act(async () => {
        await Promise.resolve();
      });
      const callsAfterMount = fetchPlanSummary.mock.calls.length;

      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      expect(fetchPlanSummary).toHaveBeenCalledTimes(callsAfterMount);

      Object.defineProperty(document, "hidden", { configurable: true, value: false });
    });
  });
});
