/** @author Tang Chee Seng (with assistance from Claude and Codex) */
import { describe, it, expect, vi } from "vitest";
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
function onePendingRecommendation() {
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
});
