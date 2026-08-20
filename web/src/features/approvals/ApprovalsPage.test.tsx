/** @author Tang Chee Seng (with assistance from Claude and Codex) */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider } from "@/auth/AuthProvider";
import { fakeUserManager } from "@/test/fakeUserManager";
import { server } from "@/test/mocks/server";
import { App } from "@/app/App";
import "@testing-library/jest-dom/vitest";

const BASE = "http://localhost:8080";

const renderApprovals = () =>
  render(
    <MemoryRouter initialEntries={["/approvals"]}>
      <AuthProvider userManager={fakeUserManager({})}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

// One pending recommendation on site-1's shift-1; site-2 has no shifts, so exactly one card.
function onePendingRecommendation({
  category = "Rest & Recovery",
  appliesTo = null,
}: Readonly<{
  category?: string | null;
  appliesTo?: string[] | null;
}> = {}) {
  server.use(
    http.get(`${BASE}/api/v1/sites/:siteId/shifts`, ({ params }) =>
      params.siteId === "site-1"
        ? HttpResponse.json([
            {
              id: "shift-1",
              siteId: "site-1",
              startsAt: "2026-08-10T00:00:00Z",
              endsAt: "2026-08-10T08:00:00Z",
              status: "PLANNED",
              assignments: [],
            },
          ])
        : HttpResponse.json([]),
    ),
    http.get(
      `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations`,
      ({ params }) =>
        params.siteId === "site-1"
          ? HttpResponse.json([
              {
                id: "rec-1",
                shiftId: "shift-1",
                policyVersion: "v1",
                status: "PENDING_APPROVAL",
                rationale:
                  "WBGT trending into the amber band over the next half hour.",
                createdAt: "2026-08-10T00:05:00Z",
                mitigations: [
                  {
                    priority: "MANDATORY",
                    action: "Rotate crew every 45 minutes",
                    rationale: "Heat load",
                    estimatedImpact: "Lower core temp",
                    actionCode: "ROTATE_CREW",
                    origin: "MANDATORY",
                    ruleReference: "HS-33-HEAVY",
                    category,
                    appliesTo,
                    timing: { durationMinutes: null, everyMinutes: 45, startByUtc: null },
                  },
                ],
                approval: null,
                evidence: {
                  observedWbgt: 32.5,
                  forecastWbgt30m: 33.1,
                  currentBand: "MODERATE",
                  forecastBand: "HIGH",
                  observedAt: "2026-08-10T00:00:00Z",
                  freshness: "LIVE",
                  source: "NEA",
                  stationId: "S50",
                  lightningState: "CLEAR",
                },
                modelVersion: "bedrock-claude-x",
              },
            ])
          : HttpResponse.json([]),
    ),
  );
}

describe("ApprovalsPage", () => {
  // Freeze "now" to 04:00 SGT-equivalent on 10 Aug — mid-way through the fixture shift (00:00–08:00Z),
  // so it counts as live and the queue behaves as these tests expect regardless of the wall clock.
  // Spying Date.now (not fake timers) leaves setTimeout, msw and user-event untouched.
  let nowSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2026-08-10T04:00:00Z").getTime());
  });
  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("lists a pending recommendation with its shift, evidence and mitigation", async () => {
    onePendingRecommendation();
    renderApprovals();
    expect(await screen.findByText(/10 Aug/)).toBeInTheDocument();
    expect(screen.getByText("Bishan Park Landscaping")).toBeInTheDocument();
    expect(screen.getByText("32.5°C")).toBeInTheDocument();
    expect(
      screen.getByText(/Rotate crew every 45 minutes/),
    ).toBeInTheDocument();
  });

  it("groups mitigations and reveals their supporting detail on request", async () => {
    onePendingRecommendation();
    const user = userEvent.setup();
    renderApprovals();

    expect(await screen.findByRole("heading", { name: "Rest & Recovery" })).toBeInTheDocument();
    expect(screen.getByText("Everyone on this shift")).toBeInTheDocument();
    expect(screen.queryByText("Heat load")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByText("Heat load")).toBeInTheDocument();
    expect(screen.getByText("HS-33-HEAVY")).toBeInTheDocument();
    expect(screen.getByText("Lower core temp")).toBeInTheDocument();
  });

  it("renders an uncategorised mitigation without inventing a group heading", async () => {
    onePendingRecommendation({ category: null });
    renderApprovals();

    expect(await screen.findByText("Rotate crew every 45 minutes")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "General" })).not.toBeInTheDocument();
  });

  it("uses names for the first four applies-to chips and collapses the remainder", async () => {
    onePendingRecommendation({
      appliesTo: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "worker-three",
        "worker-four",
        "worker-five",
      ],
    });
    renderApprovals();

    expect(await screen.findByText("Worker One")).toBeInTheDocument();
    expect(screen.getByText("Worker Two")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.queryByText("worker-five")).not.toBeInTheDocument();
  });

  it("lets a supervisor expand the recommendation rationale", async () => {
    onePendingRecommendation();
    const user = userEvent.setup();
    renderApprovals();

    await user.click(await screen.findByRole("button", { name: "Read more" }));

    expect(screen.getByRole("button", { name: "Read less" })).toBeInTheDocument();
  });

  it("approves a recommendation and removes its card", async () => {
    onePendingRecommendation();
    const decide = vi.fn();
    server.use(
      http.post(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations/:recId/decision`,
        async ({ request, params }) => {
          decide(await request.json());
          return HttpResponse.json({
            id: params.recId,
            shiftId: "shift-1",
            policyVersion: "v1",
            status: "APPROVED",
            rationale: null,
            createdAt: "2026-08-10T00:05:00Z",
            mitigations: [],
            approval: null,
            evidence: null,
            modelVersion: null,
          });
        },
      ),
    );

    const user = userEvent.setup();
    renderApprovals();
    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(decide).toHaveBeenCalledWith({ decision: "APPROVED" });
    expect(
      await screen.findByText("You're all caught up!"),
    ).toBeInTheDocument();
  });

  it("sends an edited plan when the supervisor edits a mitigation", async () => {
    onePendingRecommendation();
    let sent: unknown = null;
    server.use(
      http.post(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations/:recId/decision`,
        async ({ request, params }) => {
          sent = await request.json();
          return HttpResponse.json({
            id: params.recId,
            shiftId: "shift-1",
            policyVersion: "v1",
            status: "APPROVED",
            rationale: null,
            createdAt: "2026-08-10T00:05:00Z",
            mitigations: [],
            approval: null,
            evidence: null,
            modelVersion: null,
          });
        },
      ),
    );

    const user = userEvent.setup();
    renderApprovals();
    await user.click(await screen.findByRole("button", { name: "Edit Plan" }));
    const actionInput = screen.getByLabelText("Action");
    await user.clear(actionInput);
    await user.type(actionInput, "Rotate crew every 30 minutes");
    await user.click(screen.getByRole("button", { name: "Save Edited Plan" }));

    expect(sent).toMatchObject({
      decision: "EDITED",
      editedPlan: [{ action: "Rotate crew every 30 minutes" }],
    });
  });

  it("shows a safety manager a read-only notice, not the decision buttons", async () => {
    onePendingRecommendation();
    // The queue is the same; only the role changes. A safety manager reads plans but cannot
    // decide on them — parity with the mobile detail screen, where the backend is the real gate.
    server.use(
      http.get(`${BASE}/api/v1/me`, () =>
        HttpResponse.json({
          id: "u-2",
          username: "manager",
          displayName: "Safety Manager",
          role: "SAFETY_MANAGER",
          siteIds: ["site-1"],
        }),
      ),
    );

    renderApprovals();

    // The plan itself still renders — read access is unchanged.
    expect(await screen.findByText(/Rotate crew every 45 minutes/)).toBeInTheDocument();
    expect(
      screen.getByText("You can read this plan but not decide on it."),
    ).toBeInTheDocument();
    // None of the three decision controls are offered.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Plan" })).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing is pending", async () => {
    server.use(
      http.get(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations`,
        () => HttpResponse.json([]),
      ),
    );
    renderApprovals();
    expect(
      await screen.findByText("You're all caught up!"),
    ).toBeInTheDocument();
  });

  it("requires a non-blank rejection reason", async () => {
    onePendingRecommendation();
    const sent = vi.fn();
    server.use(
      http.post(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations/:recId/decision`,
        async ({ request, params }) => {
          sent(await request.json());
          return HttpResponse.json({
            id: params.recId,
            shiftId: "shift-1",
            policyVersion: "v1",
            status: "REJECTED",
            rationale: null,
            createdAt: "2026-08-10T00:05:00Z",
            mitigations: [],
            approval: null,
            evidence: null,
            modelVersion: null,
          });
        },
      ),
    );

    const user = userEvent.setup();
    renderApprovals();
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const reason = screen.getByRole("textbox", { name: "Reason (Required)" });
    const confirm = screen.getByRole("button", { name: "Confirm Rejection" });
    expect(confirm).toBeDisabled();
    await user.type(reason, "   ");
    expect(confirm).toBeDisabled();
    await user.clear(reason);
    await user.type(reason, "The proposed plan is unsafe.");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        decision: "REJECTED",
        reason: "The proposed plan is unsafe.",
      });
    });
  });

  it("shows an error when accessible sites cannot be loaded", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );

    renderApprovals();

    expect(await screen.findByText("Could Not Load Plans")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Something went wrong on our end. Try again in a moment.",
      ),
    ).toBeInTheDocument();
  });

  it("queues pending and auto-dispatched plans but drops approved and draft ones", async () => {
    onePendingRecommendation();
    server.use(
      http.get(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations`,
        () =>
          HttpResponse.json([
            {
              id: "rec-pending",
              shiftId: "shift-1",
              policyVersion: "v1",
              status: "PENDING_APPROVAL",
              rationale: "This recommendation is still awaiting review.",
              createdAt: "2026-08-10T00:05:00Z",
              mitigations: [],
              approval: null,
              evidence: null,
              modelVersion: null,
            },
            {
              id: "rec-auto",
              shiftId: "shift-1",
              policyVersion: "v1",
              status: "AUTO_DISPATCHED",
              rationale: "Lightning within 8 km — stop-work sent to workers.",
              createdAt: "2026-08-10T00:06:00Z",
              mitigations: [],
              approval: null,
              evidence: null,
              modelVersion: null,
            },
            {
              id: "rec-approved",
              shiftId: "shift-1",
              policyVersion: "v1",
              status: "APPROVED",
              rationale: "This recommendation was already approved.",
              createdAt: "2026-08-10T00:05:00Z",
              mitigations: [],
              approval: null,
              evidence: null,
              modelVersion: null,
            },
            {
              id: "rec-draft",
              shiftId: "shift-1",
              policyVersion: "v1",
              status: "DRAFT",
              rationale: "This recommendation is only a draft.",
              createdAt: "2026-08-10T00:05:00Z",
              mitigations: [],
              approval: null,
              evidence: null,
              modelVersion: null,
            },
          ]),
      ),
    );

    renderApprovals();
    // Pending and auto-dispatched both reach the queue.
    expect(
      await screen.findByText("This recommendation is still awaiting review."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Lightning within 8 km — stop-work sent to workers."),
    ).toBeInTheDocument();
    // Approved and draft are dropped — nothing to act on.
    expect(
      screen.queryByText("This recommendation was already approved."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("This recommendation is only a draft."),
    ).not.toBeInTheDocument();
  });

  it("shows an auto-dispatched stop-work with a danger banner and no decision buttons", async () => {
    onePendingRecommendation();
    server.use(
      http.get(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations`,
        () =>
          HttpResponse.json([
            {
              id: "rec-auto",
              shiftId: "shift-1",
              policyVersion: "v1",
              status: "AUTO_DISPATCHED",
              rationale: "Lightning within 8 km — stop-work sent to workers.",
              createdAt: "2026-08-10T00:06:00Z",
              mitigations: [],
              approval: null,
              evidence: null,
              modelVersion: "bedrock-claude-x",
            },
          ]),
      ),
    );

    renderApprovals();

    // The card carries the verbatim mobile copy, announced as an alert, and the status pill.
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(
      "This stop-work order was sent to workers automatically — no approval was required.",
    );
    expect(screen.getByText("Stop-work dispatched")).toBeInTheDocument();
    // A dispatched stop-work has nothing to decide — none of the controls are offered, even to a
    // supervisor who could otherwise decide.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Plan" })).not.toBeInTheDocument();
  });

  it("lists a superseded plan in a muted note, not as a decision card", async () => {
    onePendingRecommendation();
    server.use(
      http.get(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations`,
        () =>
          HttpResponse.json([
            {
              id: "rec-superseded",
              shiftId: "shift-1",
              policyVersion: "v1",
              status: "SUPERSEDED",
              rationale: "A newer draft replaced this one.",
              createdAt: "2026-08-10T00:05:00Z",
              mitigations: [],
              approval: null,
              evidence: null,
              modelVersion: null,
            },
          ]),
      ),
    );

    renderApprovals();

    // The queue is empty (nothing to decide), but the superseded plan is surfaced in its own note so
    // it doesn't just vanish.
    const note = await screen.findByRole("region", { name: "Recently superseded" });
    expect(note).toHaveTextContent("replaced by a newer plan");
    expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
    // It is a note, not a decision card — no buttons.
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("stamps each card with when the plan was drafted", async () => {
    onePendingRecommendation();
    renderApprovals();

    // 'now' is frozen at 04:00Z 10 Aug; the plan was drafted at 00:05Z the same day → ~3h earlier.
    const drafted = await screen.findByText("Drafted 3 hours ago");
    // Precise, clear DD MMM YYYY date + time and a machine-readable stamp ride the <time> element.
    expect(drafted.tagName).toBe("TIME");
    expect(drafted).toHaveAttribute("dateTime", "2026-08-10T00:05:00Z");
    expect(drafted).toHaveAttribute("title", "10 Aug 2026, 08:05");
  });

  it("moves a plan whose shift has ended into a collapsed Past shifts section", async () => {
    server.use(
      // A shift that ended before the frozen 'now' (04:00Z 10 Aug) — so its plan is past, not live.
      http.get(`${BASE}/api/v1/sites/:siteId/shifts`, ({ params }) =>
        params.siteId === "site-1"
          ? HttpResponse.json([
              {
                id: "shift-past",
                siteId: "site-1",
                startsAt: "2026-08-09T12:00:00Z",
                endsAt: "2026-08-09T20:00:00Z",
                status: "PLANNED",
                assignments: [],
              },
            ])
          : HttpResponse.json([]),
      ),
      http.get(
        `${BASE}/api/v1/sites/:siteId/shifts/:shiftId/recommendations`,
        ({ params }) =>
          params.siteId === "site-1"
            ? HttpResponse.json([
                {
                  id: "rec-past",
                  shiftId: "shift-past",
                  policyVersion: "v1",
                  status: "PENDING_APPROVAL",
                  rationale: "Drafted for a shift that has since ended.",
                  createdAt: "2026-08-09T11:55:00Z",
                  mitigations: [],
                  approval: null,
                  evidence: null,
                  modelVersion: null,
                },
              ])
            : HttpResponse.json([]),
      ),
    );

    const user = userEvent.setup();
    renderApprovals();

    // The live queue is empty, so the supervisor is caught up on current work…
    expect(await screen.findByText("You're all caught up!")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Plans Awaiting Review" })).not.toBeInTheDocument();

    // …but the past plan is gathered under a count-labelled disclosure, collapsed by default.
    const summary = screen.getByText("Past shifts (1)");
    const disclosure = summary.closest("details") as HTMLDetailsElement;
    expect(disclosure.open).toBe(false);

    // The plan lives inside that disclosure as a full, still-actionable card.
    const region = screen.getByRole("region", { name: "Past shifts" });
    expect(region).toHaveTextContent("Drafted for a shift that has since ended.");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();

    // And it opens on demand.
    await user.click(summary);
    expect(disclosure.open).toBe(true);
  });
});
