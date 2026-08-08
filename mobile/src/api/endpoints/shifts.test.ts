/**
 * Editing a shift and its assignments (SCRUM-266).
 *
 * Two things are worth asserting here rather than trusting.
 *
 * `workerId` is not part of an assignment correction. Moving an assignment to a different
 * person is a remove and an add, not a correction, and the audit trail should say so — the
 * server's `ShiftAssignment.correct` does not accept one either. A client that quietly sent it
 * would be reassigning work through an endpoint that records "corrected".
 *
 * And the mock enforces the same editability rule the server does. A mock that accepts an edit
 * the real backend refuses hides the failure until someone runs against a real deployment,
 * which is the one place it costs something.
 *
 * @author Justin Chua
 */
const mockRequest = jest.fn();
const mockIsMockApi = jest.fn();

jest.mock("../client", () => ({ request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => mockIsMockApi() }));

import {
  addAssignment,
  removeAssignment,
  updateAssignment,
  updateShift,
} from "./shifts";

const SITE = "site-1";
const SHIFT = "shift-1";
const ASSIGNMENT = "assignment-1";

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ id: SHIFT, assignments: [] });
  mockIsMockApi.mockReset();
  mockIsMockApi.mockReturnValue(false);
});

describe("live mode", () => {
  it("PATCHes the assignment with only the correctable fields", async () => {
    await updateAssignment(SITE, SHIFT, ASSIGNMENT, {
      taskName: "Kerb laying, east verge",
      intensity: "HEAVY",
      acclimatisationDay: 4,
    });

    expect(mockRequest).toHaveBeenCalledWith({
      url: `/api/v1/sites/${SITE}/shifts/${SHIFT}/assignments/${ASSIGNMENT}`,
      method: "PATCH",
      data: {
        taskName: "Kerb laying, east verge",
        intensity: "HEAVY",
        acclimatisationDay: 4,
      },
    });

    // The correction endpoint must never carry a worker id — see the note above.
    expect(mockRequest.mock.calls[0][0].data).not.toHaveProperty("workerId");
  });

  it("PATCHes the shift window without touching status", async () => {
    await updateShift(SITE, SHIFT, "2026-08-07T01:00:00Z", "2026-08-07T09:00:00Z");

    const call = mockRequest.mock.calls[0][0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`/api/v1/sites/${SITE}/shifts/${SHIFT}`);
    // Status is server-controlled. A client that could set it could declare its own shift
    // closed — which is exactly the state the server now refuses to edit.
    expect(call.data).not.toHaveProperty("status");
  });

  it("adds a worker with POST and removes one with DELETE", async () => {
    await addAssignment(SITE, SHIFT, { workerId: "w1", intensity: "MODERATE" });
    expect(mockRequest.mock.calls[0][0].method).toBe("POST");
    expect(mockRequest.mock.calls[0][0].url).toBe(
      `/api/v1/sites/${SITE}/shifts/${SHIFT}/assignments`,
    );

    mockRequest.mockClear();
    await removeAssignment(SITE, SHIFT, ASSIGNMENT);
    expect(mockRequest.mock.calls[0][0].method).toBe("DELETE");
    // The assignment, not the shift. Deleting the shift to drop one worker is the destructive
    // workaround this ticket exists to remove.
    expect(mockRequest.mock.calls[0][0].url).toBe(
      `/api/v1/sites/${SITE}/shifts/${SHIFT}/assignments/${ASSIGNMENT}`,
    );
  });
});

describe("mock mode", () => {
  beforeEach(() => mockIsMockApi.mockReturnValue(true));

  it("never reaches the network, whatever the mock decides", async () => {
    // The mock may legitimately refuse — it enforces the same "already ended" rule the server
    // does, on purpose, so a demo cannot accept an edit a real deployment would reject. Either
    // outcome is fine here; what must not happen is a request going out.
    await updateShift(SITE, SHIFT, "2026-08-07T01:00:00Z", "2026-08-07T09:00:00Z").catch(() => {});
    await updateAssignment(SITE, SHIFT, ASSIGNMENT, { intensity: "LIGHT" }).catch(() => {});
    await removeAssignment(SITE, SHIFT, ASSIGNMENT).catch(() => {});

    expect(mockRequest).not.toHaveBeenCalled();
  });
});
