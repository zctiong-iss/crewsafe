/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { fetchShiftSummary, downloadShiftSummaryCsv } from "./shiftSummary";

const BASE = "http://localhost:8080";

describe("shiftSummary api", () => {
  it("fetchShiftSummary GETs the shift-scoped summary URL", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites/site-1/shifts/s-1/summary`, () =>
        HttpResponse.json({ shiftId: "s-1", totalAuditEvents: 21 })),
    );

    const result = await fetchShiftSummary("site-1", "s-1");

    expect(result.totalAuditEvents).toBe(21);
  });

  it("downloadShiftSummaryCsv hits the shift-scoped export URL and reads the filename", async () => {
    server.use(
      http.get(`${BASE}/api/v1/sites/site-1/shifts/s-1/summary/export.csv`, () =>
        new HttpResponse("occurred_at,actor\r\n", {
          headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": 'attachment; filename="crewsafe-shift-s-1-closeout.csv"',
          },
        })),
    );

    const { filename } = await downloadShiftSummaryCsv("site-1", "s-1");

    expect(filename).toBe("crewsafe-shift-s-1-closeout.csv");
  });
});
